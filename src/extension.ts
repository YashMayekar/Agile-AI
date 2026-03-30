import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as http from 'http';

let httpServer: http.Server | null = null;
let serverPort: number | null = null;

// Map to store projectId per panel
const panelToProjectId = new Map<vscode.WebviewPanel, string>();
let globalContext: vscode.ExtensionContext;

async function handleMessage(text: string, projectId: string, panel: vscode.WebviewPanel) {
  try {
    const response = await fetch(`http://localhost:4000/api/project/${projectId}/m/s`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ userInput: text }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`HTTP error ${response.status}`);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let accumulatedMessage = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split('\n');
      buffer = lines.pop() || '';

      for (const line of lines) {
        if (line.trim() === '') { continue; };
        try {
          const chunk = JSON.parse(line);

          // 1. Handle status updates from the stream
          if (chunk.status) {
            panel.webview.postMessage({
              type: 'statusUpdate',
              data: { message: chunk.status }
            });
          }

          // 2. Handle errors from the stream
          if (chunk.error) {
            panel.webview.postMessage({
              type: 'error',
              message: chunk.error
            });
          }

          // 3. Handle message content (chunks)
          if (chunk.res !== null && chunk.res !== undefined) {
            accumulatedMessage += chunk.res;
            panel.webview.postMessage({
              type: 'botChunk',
              chunk: chunk.res
            });
          }

          // 4. Handle end-of-bunch (done marker)
          if (chunk.done === true) {
            panel.webview.postMessage({
              type: 'botMessage',
              message: accumulatedMessage,
              done: true,
              actions: []
            });
            // Reset for the next bunch if any
            accumulatedMessage = '';
          }
        } catch (err) {
          console.error('Failed to parse chunk:', line, err);
        }
      }
    }
  } catch (err: any) {
    panel.webview.postMessage({
      type: 'error',
      message: `❌ Error: ${err.message}`
    });
  }

  // Update local cache after message exchange is completed
  try {
    const histResp = await fetch(`http://localhost:4000/api/project/${projectId}/history`);
    if (histResp.ok) {
      const history = await histResp.json();
      globalContext.workspaceState.update(`chat_history_${projectId}`, history);
    }
  } catch (err) {
    // ignore
  }
}

export function activate(context: vscode.ExtensionContext) {
  globalContext = context;
  const sidebarProvider = new ChatSidebarProvider(context);

  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("chatSidebarView", sidebarProvider)
  );

  startTreeServer(context);

  context.subscriptions.push(
    vscode.commands.registerCommand('chat.newChat', async () => {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          vscode.window.showErrorMessage("No workspace folder open");
          return;
        }

        // Create panel with a temporary title
        const tempProjectId = "loading...";
        const panel = createChatPanel(context.extensionUri, tempProjectId);

        // Show loading indicator
        panel.webview.postMessage({
          type: 'statusUpdate',
          data: { message: 'INITIALING CHAT...' }
        });

        const rootPath = workspaceFolders[0].uri.fsPath;
        const tree = await buildTree(rootPath);

        const { projectId } = await vscode.window.withProgress(
          {
            location: vscode.ProgressLocation.Notification,
            title: "Starting new chat",
            cancellable: false,
          },
          async (progress) => {
            progress.report({ message: "Sending project structure..." });

            const response = await fetch('http://localhost:4000/api/project/init', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ tree }),
            });

            if (!response.ok) {
              throw new Error(`HTTP error ${response.status}`);
            }

            const data = await response.json();

            if (!data.projectId) {
              throw new Error("No projectId received");
            }

            progress.report({ message: "Project initialized successfully!" });

            return { projectId: data.projectId };
          }
        );

        // Update panel title and map
        panel.title = `Chat ${projectId.slice(0, 4)}`;
        panelToProjectId.set(panel, projectId);

        // Save chat session
        const savedChats = context.workspaceState.get<{ id: string, title: string }[]>('savedChats', []);
        savedChats.push({ id: projectId, title: panel.title });
        context.workspaceState.update('savedChats', savedChats);
        sidebarProvider.refresh();

        panel.onDidDispose(() => {
          panelToProjectId.delete(panel);
        });

        // Send initial greeting message to the LLM
        try {
          await handleMessage("greet the user and explain about how you can help him", projectId, panel);
        } catch (err) {
          console.error('Failed to send greeting:', err);
          panel.webview.postMessage({
            type: 'addMessage',
            sender: 'bot',
            message: '❌ Failed to get greeting from LLM.'
          });
        }

      } catch (err) {
        vscode.window.showErrorMessage("Failed to start new chat");
        console.error(err);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('chat.showServerUrl', () => {
      if (serverPort) {
        vscode.window.showInformationMessage(`Tree server running at http://localhost:${serverPort}/data/tree`);
      } else {
        vscode.window.showWarningMessage("Tree server is not running.");
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('chat.openChat', async (projectId: string) => {
      try {
        const savedChats = context.workspaceState.get<{ id: string, title: string }[]>('savedChats', []);
        const chatInfo = savedChats.find(c => c.id === projectId);
        const title = chatInfo ? chatInfo.title : `Chat ${projectId.slice(0, 4)}`;

        const panel = createChatPanel(context.extensionUri, projectId);
        panel.title = title;
        panelToProjectId.set(panel, projectId);

        panel.webview.postMessage({
          type: 'addMessage',
          sender: 'bot',
          message: '⏳ Loading chat history...'
        });

        // Fetch history, prioritize local then fallback to URL
        let history = context.workspaceState.get<any[]>(`chat_history_${projectId}`);
        if (!history || history.length === 0) {
          const resp = await fetch(`http://localhost:4000/api/project/${projectId}/history`);
          if (resp.ok) {
            history = await resp.json();
            context.workspaceState.update(`chat_history_${projectId}`, history);
          }
        }

        if (history) {
          // Clear loading message
          panel.webview.postMessage({ type: 'clearMessages' });
          // Restore messages 
          for (const entry of history) {
            if (entry.user && !entry.user.startsWith("greet the user and explain")) {
              panel.webview.postMessage({
                type: 'addMessage',
                sender: 'user',
                message: entry.user
              });
            }
            try {
              const agResObj = typeof entry.ag_res === 'string' ? JSON.parse(entry.ag_res) : entry.ag_res;
              panel.webview.postMessage({
                type: 'addMessage',
                sender: 'bot',
                message: agResObj.res ? agResObj.res : entry.ag_res
              });
            } catch (e) {
              panel.webview.postMessage({
                type: 'addMessage',
                sender: 'bot',
                message: entry.ag_res
              });
            }
          }
        } else {
          panel.webview.postMessage({ type: 'clearMessages' });
          panel.webview.postMessage({
            type: 'addMessage',
            sender: 'bot',
            message: '❌ Failed to load chat history.'
          });
        }

        panel.onDidDispose(() => {
          panelToProjectId.delete(panel);
        });

      } catch (err) {
        vscode.window.showErrorMessage("Failed to open chat");
        console.error(err);
      }
    })
  );

  context.subscriptions.push(
    vscode.commands.registerCommand('chat.deleteChat', async (projectId: string) => {
      const confirm = await vscode.window.showWarningMessage(
        "Are you sure you want to delete this chat?",
        { modal: true },
        "Yes"
      );
      if (confirm !== "Yes") { return; };

      let savedChats = context.workspaceState.get<{ id: string, title: string }[]>('savedChats', []);
      savedChats = savedChats.filter(c => c.id !== projectId);
      context.workspaceState.update('savedChats', savedChats);
      context.workspaceState.update(`chat_history_${projectId}`, undefined);
      sidebarProvider.refresh();

      try {
        await fetch(`http://localhost:4000/api/project/${projectId}`, { method: 'DELETE' });
      } catch (err) {
        console.error("Failed to delete chat from backend", err);
      }

      // Optionally notify the user
      vscode.window.showInformationMessage("Chat deleted from sidebar");
    })
  );
}

function startTreeServer(context: vscode.ExtensionContext) {
  const server = http.createServer(async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === 'GET' && req.url === '/data/tree') {
      try {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders || workspaceFolders.length === 0) {
          res.writeHead(404, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'No workspace folder open' }));
          return;
        }
        const rootPath = workspaceFolders[0].uri.fsPath;
        const tree = await buildTree(rootPath);

        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify(tree));
      } catch (error) {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error: 'Failed to build tree' }));
      }
    } else {
      res.writeHead(404);
      res.end();
    }
  });

  server.listen(4500, () => {
    const address = server.address();
    if (address && typeof address !== 'string') {
      serverPort = address.port;
      console.log(`Tree server listening on http://localhost:${serverPort}`);
      vscode.window.showInformationMessage(`Tree server ready at http://localhost:${serverPort}/data/tree`);
    }
  });

  httpServer = server;
  context.subscriptions.push({ dispose: () => server.close() });
}

async function buildTree(dirPath: string, relativePath: string = ""): Promise<any> {
  const name = path.basename(dirPath);
  const entries = await fs.promises.readdir(dirPath, { withFileTypes: true });
  const children = [];

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);
    const relPath = path.join(relativePath, entry.name);

    if (entry.isDirectory()) {
      if (entry.name === 'venv' || entry.name === 'node_modules' ||
        entry.name === '.git' || entry.name === '.vscode' || entry.name === '__pycache__'
      ) {
        continue;
      }
      const subTree = await buildTree(fullPath, relPath);
      children.push(subTree);
    } else {
      children.push({
        file: entry.name,
      });
    }
  }

  return {
    directory: name,
    children: children || null,
  };
}

class ChatSidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly _context: vscode.ExtensionContext) { }

  public refresh() {
    if (this._view) {
      const savedChats = this._context.workspaceState.get('savedChats', []);
      this._view.webview.postMessage({ type: 'updateChats', chats: savedChats });
    }
  }

  resolveWebviewView(webviewView: vscode.WebviewView) {
    this._view = webviewView;
    webviewView.webview.options = { enableScripts: true };

    const extensionUri = this._context.extensionUri;
    const htmlPath = vscode.Uri.joinPath(extensionUri, "media", "sidebar.html");
    try {
      let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
      const baseUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media"));
      html = html.replace(/{{baseUri}}/g, baseUri.toString());
      webviewView.webview.html = html;
    } catch {
      webviewView.webview.html = getSidebarHtml();
    }

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.command === "newChat") {
        vscode.commands.executeCommand('chat.newChat');
      } else if (msg.command === "openChat") {
        vscode.commands.executeCommand('chat.openChat', msg.projectId);
      } else if (msg.command === "deleteChat") {
        vscode.commands.executeCommand('chat.deleteChat', msg.projectId);
      } else if (msg.command === "ready") {
        this.refresh();
      }
    });
  }
}

function createChatPanel(extensionUri: vscode.Uri, projectId: string): vscode.WebviewPanel {
  const panel = vscode.window.createWebviewPanel(
    'chatPanel',
    `Chat ${projectId.slice(0, 6)}`,
    vscode.ViewColumn.One,
    { enableScripts: true }
  );

  const htmlPath = vscode.Uri.joinPath(extensionUri, "media", "chatbot.html");
  let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
  html = html.replace(/{{projectId}}/g, projectId);
  panel.webview.html = html;

  // Set up message listener
  panel.webview.onDidReceiveMessage(async msg => {
    if (msg.command === 'sendMessage') {
      const realProjectId = panelToProjectId.get(panel);
      if (!realProjectId) {
        panel.webview.postMessage({
          type: 'addMessage',
          sender: 'bot',
          message: '❌ Chat not properly initialized. Please start a new chat.'
        });
        return;
      }
      await handleMessage(msg.text, realProjectId, panel);
    }
  });

  // Start status polling
  const statusInterval = setInterval(async () => {
    const realProjectId = panelToProjectId.get(panel);
    if (!realProjectId) { return; };
    try {
      const resp = await fetch(`http://localhost:4000/api/project/${realProjectId}/status`);
      if (resp.ok) {
        const data = await resp.json();
        panel.webview.postMessage({ type: 'statusUpdate', data: data.status });
      }
    } catch {
      // ignore
    }
  }, 1000);

  panel.onDidDispose(() => {
    clearInterval(statusInterval);
  });

  return panel;
}

function getSidebarHtml() {
  return `
  <!DOCTYPE html>
  <html>
  <body style="background:#1e1e1e;color:white;padding:10px">
    <button id="btn">New Chat</button>
    <script>
      const vscode = acquireVsCodeApi();
      document.getElementById('btn').onclick = () => {
        vscode.postMessage({ command: 'newChat' });
      };
    </script>
  </body>
  </html>`;
}

export function deactivate() {
  if (httpServer) {
    httpServer.close();
    console.log('Tree server closed');
  }
}
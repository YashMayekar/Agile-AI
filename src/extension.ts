import * as vscode from 'vscode';
import * as fs from 'fs';
import { extractCommandBlocks, parseCommandBlock, normalizeRawCommand } from './commandParser';
import { executeParsedCommand } from './commandExecutor';
import { pushHistory, handleUndo, getHistory } from './undoManager';
import { AsyncQueue } from './asyncQueue';

const execQueue = new AsyncQueue();

// Store chat panel states
const chatPanelStates = new Map<string, any>();

class ChatSidebarProvider implements vscode.WebviewViewProvider {
  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri]
    };

    // Load the sidebar.html file
    const htmlPath = vscode.Uri.joinPath(this._extensionUri, "media", "sidebar.html");
    
    try {
      let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
      
      // Replace base URI placeholder if it exists
      const baseUri = webviewView.webview.asWebviewUri(vscode.Uri.joinPath(this._extensionUri, "media"));
      html = html.replace(/{{baseUri}}/g, baseUri.toString());
      
      webviewView.webview.html = html;
    } catch (error) {
      // Fallback HTML if sidebar.html is not found
      webviewView.webview.html = this.getFallbackSidebarHtml();
    }

    // Handle messages from sidebar
    webviewView.webview.onDidReceiveMessage(async (message: any) => {
      switch (message.command) {
        case "newChat":
          vscode.commands.executeCommand('chat.newChat');
          break;
        case "renameChat":
          vscode.commands.executeCommand('chat.renameChat', { id: message.id });
          break;
        case "deleteChat":
          vscode.commands.executeCommand('chat.deleteChat', { id: message.id });
          break;
        case "llm_output":
          await handleLlmOutput(message.text, webviewView.webview);
          break;
        case "refreshChats":
          this.refreshSidebarChats(webviewView.webview);
          break;
        case "loadChat":
          vscode.commands.executeCommand('chat.openExisting', { conversationId: message.conversationId });
          break;
      }
    });

    // Initial load of chats
    this.refreshSidebarChats(webviewView.webview);
  }

  private async refreshSidebarChats(webview: vscode.Webview) {
    try {
      // Fetch all conversations from backend
      const response = await fetch('http://localhost:8000/conversations');
      const conversations = await response.json();
      
      webview.postMessage({
        command: 'updateChatList',
        conversations: conversations
      });
    } catch (error) {
      console.error('Failed to fetch conversations:', error);
      webview.postMessage({
        command: 'updateChatList',
        conversations: []
      });
    }
  }

  private getFallbackSidebarHtml(): string {
    return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <style>
    body { color: white; background-color: #1e1e1e; padding: 1rem; font-family: sans-serif; }
    button { background: #7c5cff; width: 100%; border: none; padding: 0.5rem 1rem; border-radius: 5px; color: white; cursor: pointer; }
  </style>
</head>
<body>
  <button id="newChatBtn">New Chat</button>
  <script>
    const vscode = acquireVsCodeApi();
    document.getElementById("newChatBtn").addEventListener("click", () => {
      vscode.postMessage({ command: "newChat" });
    });
  </script>
</body>
</html>`;
  }
}

/** Activation: register a WebviewViewProvider for chatSidebarView */
export function activate(context: vscode.ExtensionContext) {
  console.log('Agile AI assistant extension activating...');

  // Register the sidebar webview provider
  const sidebarProvider = new ChatSidebarProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider("chatSidebarView", sidebarProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('chat.newChat', () => {
      createChatPanel(context.extensionUri, context);
    }),
    vscode.commands.registerCommand('chat.openExisting', async (data) => {
      createChatPanel(context.extensionUri, context, data.conversationId);
    }),
    vscode.commands.registerCommand('chat.renameChat', (node) => {
      vscode.window.showInformationMessage(`Rename Chat: ${node?.id || 'unknown'}`);
    }),
    vscode.commands.registerCommand('chat.deleteChat', (node) => {
      vscode.window.showInformationMessage(`Delete Chat: ${node?.id || 'unknown'}`);
    }),
    vscode.commands.registerCommand('agileAI.showHistory', () => {
      vscode.window.showInformationMessage(`Recent operations: ${getHistory().length}`);
    }),
    vscode.commands.registerCommand('agileAI.undoLast', async () => {
      const res = await handleUndo();
      vscode.window.showInformationMessage(`Undo result: ${JSON.stringify(res)}`);
    }),
    vscode.commands.registerCommand('agileAI.openChat', async () => {
      await vscode.commands.executeCommand('workbench.view.extension.chatActivityBar');
    })
  );
}

/** Deactivate */
export function deactivate() {
  // Cleanup if needed
}

/** Process LLM output: extract blocks, parse, validate, queue execution */
async function handleLlmOutput(text: string, webview?: vscode.Webview) {
  const blocks = extractCommandBlocks(text);
  console.log(`Found ${blocks.length} command blocks:`, blocks);
  
  if (!blocks.length) {
    webview?.postMessage({ source: 'extension', payload: { type: 'no_command', message: 'No command blocks found.' } });
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  console.log('Workspace root for LLM commands:', workspaceRoot?.fsPath);
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;

  // Process all blocks sequentially
  for (const [index, block] of blocks.entries()) {
    console.log(`Processing block ${index + 1}/${blocks.length}:`, block);
    
    const raw = parseCommandBlock(block);
    console.log('Parsed raw command:', raw);
    
    const { parsed, error } = normalizeRawCommand(raw, block);
    if (error) {
      console.error('Parse error:', error);
      webview?.postMessage({ 
        source: 'extension', 
        payload: { 
          type: 'parse_error', 
          message: error, 
          block,
          blockIndex: index 
        } 
      });
      continue;
    }

    console.log('Normalized command:', parsed);

    // Add each block to the execution queue
    execQueue.add(async () => {
      try {
        const res = await executeParsedCommand(parsed!, { workspaceRoot, activeEditorUri }, pushHistory);
        console.log('Execution result:', res);
        
        // If it's a read operation with content, send it to frontend as assistant response
        if (res.ok && res.readContent) {
          webview?.postMessage({ 
            source: 'extension', 
            payload: { 
              type: 'execute_result', 
              operation: 'read',
              result: res, 
              block,
              blockIndex: index,
              // Add this to display read content in chat
              assistantResponse: `🔧 **Command ${index + 1} Executed Successfully**\n\n**Operation:** ${res.operation}\n**File:** ${res.uri}\n\n${res.readContent}`
            } 
          });
        } else {
          webview?.postMessage({ 
            source: 'extension', 
            payload: { 
              type: 'execute_result', 
              result: res, 
              block,
              blockIndex: index,
              assistantResponse: `🔧 **Command ${index + 1} Executed Successfully**\n\n**Operation:** ${res.operation}\n**Result:** ${res.message}`
            } 
          });
        }
      } catch (e: any) {
        console.error('Execution error:', e);
        webview?.postMessage({ 
          source: 'extension', 
          payload: { 
            type: 'execute_error', 
            error: String(e), 
            block,
            blockIndex: index,
            assistantResponse: `❌ **Command ${index + 1} Execution Failed**\n\n**Error:** ${String(e)}`
          } 
        });
      }
    });
  }
}

/** Create chat panel function */
function createChatPanel(extensionUri: vscode.Uri, extensionContext: vscode.ExtensionContext, conversationId?: string) {
  const panelId = conversationId || `chat-${Date.now()}`;
  const panel = vscode.window.createWebviewPanel(
    'chatPanel',
    conversationId ? `Chat ${conversationId}` : 'New Chat',
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')],
      retainContextWhenHidden: true // This helps preserve state when panel is hidden
    }
  );
  const resolvedConversationId = conversationId || `chat-${Date.now()}`;
  vscode.window.showInformationMessage(`Chat panel opened with ID: ${resolvedConversationId}`);

  // Store panel reference
  chatPanelStates.set(resolvedConversationId, { panel, conversationId: resolvedConversationId });


  // Get the path to the chatbot HTML file
  const chatbotHtmlPath = vscode.Uri.joinPath(extensionUri, "media", "chatbot.html");
  
  try {
    let html = fs.readFileSync(chatbotHtmlPath.fsPath, 'utf8');
    
    // Replace base URI placeholder if it exists
    const baseUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media"));
    html = html.replace(/{{baseUri}}/g, baseUri.toString());
    
    // Add conversation ID to HTML
    html = html.replace(/{{conversationId}}/g, resolvedConversationId);
    
    panel.webview.html = html;
  } catch (error) {
    panel.webview.html = getFallbackChatHtml(conversationId);
  }

  // Handle messages from the chat panel
  panel.webview.onDidReceiveMessage(
    async message => {
      switch (message.command) {
        case 'sendMessage':
          await handleUserMessage(message.text, panel, conversationId);
          break;
        case 'alert':
          vscode.window.showErrorMessage(message.text);
          break;
        case 'llm_output':
          handleLlmOutput(message.text, panel.webview);
          console.log('\n\n\noutput from chat panel:\n'+ message.text);
          vscode.window.showInformationMessage('Executed OP from chat panel');
          break;
        case 'chatLoaded':
          // If we have a conversation ID, load the existing messages
          if (conversationId) {
            await loadExistingChat(conversationId, panel);
          }
          break;
      }
    },
    undefined,
    extensionContext.subscriptions
  );

  // Handle panel disposal
  panel.onDidDispose(() => {
    chatPanelStates.delete(panelId);
  }, null, extensionContext.subscriptions);
}

/** Load existing chat messages */
async function loadExistingChat(conversationId: string, panel: vscode.WebviewPanel) {
  try {
    const response = await fetch(`http://localhost:8000/conversation/${conversationId}`);
    const conversation = await response.json();
    
    // Send all messages to the webview
    conversation.messages.forEach((msg: any) => {
      panel.webview.postMessage({
        type: 'addMessage',
        sender: msg.sender,
        message: msg.message,
        isHistory: true
      });
    });
  } catch (error) {
    console.error('Failed to load chat:', error);
    vscode.window.showErrorMessage('Failed to load chat history');
  }
}

/** Handle user messages in chat panel */
async function handleUserMessage(message: string, panel: vscode.WebviewPanel, conversationId?: string) {
  // Show user message in the chat
  panel.webview.postMessage({
    type: 'addMessage',
    sender: 'user',
    message: message
  });

  // Here you would typically send to your LLM service
  // For now, just echo back
  setTimeout(() => {
    panel.webview.postMessage({
      type: 'addMessage',
      sender: 'bot',
      message: `I received: "${message}". This would be processed by the LLM.`
    });
  }, 1000);
}

/** Fallback chat HTML */
function getFallbackChatHtml(conversationId?: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>AI Chat</title>
    <style>
        body {
            font-family: var(--vscode-font-family);
            background: var(--vscode-editor-background);
            color: var(--vscode-editor-foreground);
            margin: 0;
            padding: 20px;
            height: 100vh;
        }
        .chat-container {
            display: flex;
            flex-direction: column;
            height: 100%;
        }
        .messages {
            flex: 1;
            overflow-y: auto;
            border: 1px solid var(--vscode-input-border);
            border-radius: 4px;
            padding: 10px;
            margin-bottom: 10px;
            background: var(--vscode-input-background);
        }
        .input-area {
            display: flex;
            gap: 10px;
        }
        input {
            flex: 1;
            padding: 8px;
            background: var(--vscode-input-background);
            color: var(--vscode-input-foreground);
            border: 1px solid var(--vscode-input-border);
            border-radius: 3px;
        }
        button {
            padding: 8px 16px;
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            border-radius: 3px;
            cursor: pointer;
        }
        .message {
            margin: 8px 0;
            padding: 8px;
            border-radius: 4px;
        }
        .user-message {
            background: var(--vscode-inputOption-activeBackground);
            margin-left: 20px;
        }
        .bot-message {
            background: var(--vscode-textBlockQuote-background);
            margin-right: 20px;
        }
    </style>
</head>
<body>
    <div class="chat-container">
        <div class="messages" id="messages">
            <div class="message bot-message">Hello! How can I help you today?</div>
        </div>
        <div class="input-area">
            <input type="text" id="userInput" placeholder="Type your message...">
            <button id="sendButton">Send</button>
        </div>
    </div>

    <script>
        const vscode = acquireVsCodeApi();
        const messagesContainer = document.getElementById('messages');
        const userInput = document.getElementById('userInput');
        const sendButton = document.getElementById('sendButton');

        function addMessage(text, isUser = false) {
            const messageDiv = document.createElement('div');
            messageDiv.className = isUser ? 'message user-message' : 'message bot-message';
            messageDiv.textContent = text;
            messagesContainer.appendChild(messageDiv);
            messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        function sendMessage() {
            const text = userInput.value.trim();
            if (text) {
                addMessage(text, true);
                vscode.postMessage({
                    command: 'sendMessage',
                    text: text
                });
                userInput.value = '';
            }
        }

        sendButton.addEventListener('click', sendMessage);
        userInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                sendMessage();
            }
        });

        // Notify extension that chat is loaded
        vscode.postMessage({ command: 'chatLoaded' });

        // Focus input on load
        userInput.focus();
    </script>
</body>
</html>`;
}
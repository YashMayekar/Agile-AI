import * as vscode from "vscode";
import * as fs from "fs";
import * as path from "path";

export function activate(context: vscode.ExtensionContext) {
  // Register the sidebar webview provider
  const sidebarProvider = new ChatSidebarProvider(context.extensionUri, context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(
      "chatSidebarView", sidebarProvider)
  );

  // Register commands
  context.subscriptions.push(
    vscode.commands.registerCommand('chat.newChat', () => {
      // Create and show a new chat panel
      createChatPanel(context.extensionUri, context);
    }),
    vscode.commands.registerCommand('chat.renameChat', (node) => {
      vscode.window.showInformationMessage(`Rename Chat: ${node?.id || 'unknown'}`);
    }),
    vscode.commands.registerCommand('chat.deleteChat', (node) => {
      vscode.window.showInformationMessage(`Delete Chat: ${node?.id || 'unknown'}`);
    })
  );
}

function createChatPanel(extensionUri: vscode.Uri, extensionContext: vscode.ExtensionContext) {
  // Create a new webview panel
  const panel = vscode.window.createWebviewPanel(
    'chatPanel', // Identifies the type of the webview
    'AI Chat', // Title of the panel displayed to the user
    vscode.ViewColumn.One, // Editor column to show the new webview panel in
    {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(extensionUri, 'media')]
    }
  );

  // Get the path to the chatbot HTML file
  const chatbotHtmlPath = vscode.Uri.joinPath(extensionUri, "media", "chatbot.html");
  
  try {
    // Read and set the HTML content
    let html = fs.readFileSync(chatbotHtmlPath.fsPath, 'utf8');
    
    // Replace base URI placeholder if it exists
    const baseUri = panel.webview.asWebviewUri(vscode.Uri.joinPath(extensionUri, "media"));
    html = html.replace(/{{baseUri}}/g, baseUri.toString());
    
    panel.webview.html = html;
  } catch (error) {
    // Fallback HTML if chatbot.html is not found
    panel.webview.html = getFallbackChatHtml();
  }

  // Handle messages from the chat panel
  panel.webview.onDidReceiveMessage(
    message => {
      switch (message.command) {
        case 'sendMessage':
          vscode.window.showInformationMessage(`Message sent: ${message.text}`);
          // Here you would typically send the message to your AI service
          break;
        case 'alert':
          vscode.window.showErrorMessage(message.text);
          break;
      }
    },
    undefined,
    extensionContext.subscriptions
  );
}

function getFallbackChatHtml(): string {
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

        // Focus input on load
        userInput.focus();
    </script>
</body>
</html>`;
}

class ChatSidebarProvider implements vscode.WebviewViewProvider {
  constructor(
    private readonly extensionUri: vscode.Uri,
    private readonly extensionContext: vscode.ExtensionContext
  ) {}

  // include the resolve context and token parameters to match the interface
  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    const webview = webviewView.webview;

    webview.options = {
      enableScripts: true,
      localResourceRoots: [this.extensionUri],
    };

    // Get the path to the HTML file
    const htmlPath = vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.html");
    
    // Read and set the HTML content
    let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
    
    webviewView.webview.html = html;
    
    // Handle messages from sidebar.html
    webview.onDidReceiveMessage((message: any) => {
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
      }
    });
  }
}

export function deactivate() {}












// import * as vscode from "vscode";
// import * as fs from "fs";
// import * as path from "path";

// export function activate(context: vscode.ExtensionContext) {
//   // Register the sidebar webview provider
//   const sidebarProvider = new ChatSidebarProvider(context.extensionUri, context);
//   context.subscriptions.push(
//     vscode.window.registerWebviewViewProvider(
//       "chatSidebarView", sidebarProvider)
//   );

//   // Register commands
//   context.subscriptions.push(
//     vscode.commands.registerCommand('chat.newChat', () => {
//       vscode.window.showInformationMessage("New Chat clicked!");
//     }),
//     vscode.commands.registerCommand('chat.renameChat', (node) => {
//       vscode.window.showInformationMessage(`Rename Chat: ${node?.id || 'unknown'}`);
//     }),
//     vscode.commands.registerCommand('chat.deleteChat', (node) => {
//       vscode.window.showInformationMessage(`Delete Chat: ${node?.id || 'unknown'}`);
//     })
//   );
// }

// class ChatSidebarProvider implements vscode.WebviewViewProvider {
//   constructor(
//     private readonly extensionUri: vscode.Uri,
//     private readonly extensionContext: vscode.ExtensionContext
//   ) {}

//   // include the resolve context and token parameters to match the interface
//   resolveWebviewView(
//     webviewView: vscode.WebviewView,
//     _context: vscode.WebviewViewResolveContext,
//     _token: vscode.CancellationToken
//   ) {
//     const webview = webviewView.webview;

//     webview.options = {
//       enableScripts: true,
//       localResourceRoots: [this.extensionUri],
//     };

//     // Get the path to the HTML file
//     const htmlPath = vscode.Uri.joinPath(this.extensionUri, "media", "sidebar.html");
    
//     // Read and set the HTML content
//     let html = fs.readFileSync(htmlPath.fsPath, 'utf8');
//     // fs.readFile(htmlPath.fsPath, "utf8", (err, html) => {
//     //   if (err) {
//     //     console.error(`Error reading HTML file: ${err}`);
//     //     webview.html = `
//     //     <!DOCTYPE html>
//     //     <html lang="en">
//     //     <head>
//     //       <meta charset="UTF-8" />
//     //       <style>
//     //         body { color: white; background-color: #1e1e1e; padding: 1rem; font-family: sans-serif; }
//     //         button { background: #7c5cff; width: 100%; border: none; padding: 0.5rem 1rem; border-radius: 5px; color: white; cursor: pointer; }
//     //       </style>
//     //     </head>
//     //     <body>
//     //       <button id="newChatBtn">New Chat</button>
//     //       <script>
//     //         const vscode = acquireVsCodeApi();
//     //         document.getElementById("newChatBtn").addEventListener("click", () => {
//     //           vscode.postMessage({ command: "newChat" });
//     //         });
//     //       </script>
//     //     </body>
//     //     </html>
//     //   `;
//     //     return;
//     //   }

//     //   // Replace base URI placeholder if it exists
//     //   const baseUri = webview.asWebviewUri(vscode.Uri.joinPath(this.extensionUri, "media"));
//     //   html = html.replace(/{{baseUri}}/g, baseUri.toString());

//     //   webview.html = html;
//     // });
//     webviewView.webview.html = html;
//     // Handle messages from sidebar.html
//     webview.onDidReceiveMessage((message: any) => {
//       switch (message.command) {
//         case "newChat":
//           vscode.commands.executeCommand('chat.newChat');
//           break;
//         case "renameChat":
//           vscode.commands.executeCommand('chat.renameChat', { id: message.id });
//           break;
//         case "deleteChat":
//           vscode.commands.executeCommand('chat.deleteChat', { id: message.id });
//           break;
//       }
//     });
//   }
// }

// export function deactivate() {}
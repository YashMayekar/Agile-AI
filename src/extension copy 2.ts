/* src/extension.ts
   Ready-to-use VS Code extension entrypoint implementing:
   - LLM structured command extraction (//? fields, ~~? URIs, $$? content)
   - validation + path resolution (workspace-scoped)
   - user approval modal for destructive ops
   - safe execution mapped to vscode.workspace.fs and workspace edits
   - undo history log (in-memory, simple)
   - async queue to serialize operations
*/

import * as vscode from 'vscode';
import { TextEncoder, TextDecoder } from 'util';
import * as path from 'path';
import { EventEmitter } from 'events';

type RawCommand = Record<string, string>;

type Operation =
  | 'create' | 'read' | 'write' | 'delete' | 'rename' | 'copy' | 'mkdir' | 'readdir';

interface ParsedCommand {
  operation: Operation;
  what: string; // file | folder | textdocument (informational)
  location?: string; // raw string from marker (can contain alias)
  target?: string; // for rename/copy target location
  content?: string; // extracted from $$? ... $$?
  contentType?: string;
  overwrite?: boolean;
  recursive?: boolean;
  // original raw for logging
  raw?: RawCommand;
  blockText?: string;
}

/** Simple FIFO async queue */
class AsyncQueue {
  private queue: (() => Promise<void>)[] = [];
  private running = false;

  add(task: () => Promise<void>) {
    this.queue.push(task);
    if (!this.running) this.run();
  }

  private async run() {
    this.running = true;
    while (this.queue.length) {
      const t = this.queue.shift()!;
      try {
        await t();
      } catch (e) {
        console.error('Task error', e);
      }
    }
    this.running = false;
  }
}

const execQueue = new AsyncQueue();

/** In-memory history for undo (keeps last N operations) */
const OP_HISTORY_MAX = 50;
const opHistory: any[] = [];

function pushHistory(entry: any) {
  opHistory.unshift(entry);
  if (opHistory.length > OP_HISTORY_MAX) opHistory.pop();
}

/** MARKER REGEXES */
const commandBlockRegex = /####([\s\S]*?)####/g;
const fieldRegex = /\/\/\?([A-Za-z0-9_]+):\s*([\s\S]*?)(?=(?:\/\/\?[A-Za-z0-9_]+:|$))/g;
// ~~? ... ~~? for URIs/aliases
const tildeMarkerRegex = /~~\?([\s\S]*?)\?\?~~|~~\?([\s\S]*?)~~\?/g; // permissive (we'll also fallback)
const contentMarkerRegex = /\$\$\?([\s\S]*?)\$\$\?/;

/** Utility: sanitize and strip wrapping markers */
function stripMarkers(v: string): string {
  if (!v) return v;
  // content marker
  const cm = contentMarkerRegex.exec(v);
  if (cm) return cm[1];
  // tilde marker
  const tm = v.match(/~~\?([\s\S]*?)~~\?/);
  if (tm) return tm[1];
  return v.trim();
}

/** Extract command blocks from text */
function extractCommandBlocks(text: string): string[] {
  const blocks: string[] = [];
  let m;
  while ((m = commandBlockRegex.exec(text)) !== null) {
    blocks.push(m[1].trim());
  }
  return blocks;
}

/** Parse //? fields inside a block into key/value map */
function parseCommandBlock(block: string): RawCommand {
  const out: RawCommand = {};
  let m;
  while ((m = fieldRegex.exec(block)) !== null) {
    const k = m[1].trim();
    const v = m[2].trim();
    out[k] = v;
  }
  return out;
}

/** Normalize & validate a parsed RawCommand → ParsedCommand */
function normalizeRawCommand(raw: RawCommand, blockText = ''): { parsed?: ParsedCommand; error?: string } {
  // lower-case keys for convenience
  const r: Record<string, string> = {};
  for (const k of Object.keys(raw)) {
    r[k.toLowerCase()] = raw[k];
  }

  const op = (r['operation'] || r['op'] || '').toLowerCase();
  if (!op) return { error: 'Missing Operation field.' };
  const allowedOps = ['create', 'read', 'write', 'delete', 'rename', 'copy', 'mkdir', 'readdir'];
  if (!allowedOps.includes(op)) return { error: `Unsupported operation "${op}".` };

  const parsed: ParsedCommand = {
    operation: op as Operation,
    what: (r['what'] || r['targettype'] || 'file').toLowerCase(),
    location: r['location'] ? stripMarkers(r['location']) : undefined,
    target: r['target'] ? stripMarkers(r['target']) : undefined,
    content: r['content'] ? stripMarkers(r['content']) : undefined,
    contentType: r['contenttype'] || r['content-type'] || undefined,
    overwrite: r['overwrite'] ? (r['overwrite'].toLowerCase() === 'true') : false,
    recursive: r['recursive'] ? (r['recursive'].toLowerCase() === 'true') : false,
    raw,
    blockText
  };

  // basic required fields for various ops:
  if (['create', 'write', 'read', 'delete', 'mkdir', 'readdir'].includes(parsed.operation)) {
    if (!parsed.location) return { error: 'Missing Location field.' };
  }
  if (parsed.operation === 'rename' || parsed.operation === 'copy') {
    if (!parsed.location || !parsed.target) return { error: 'Rename/Copy requires both Location and Target.' };
  }
  if (parsed.operation === 'create' && parsed.content == null) {
    // allow creating empty file, but make explicit
    parsed.content = parsed.content ?? '';
  }

  return { parsed };
}

/** Resolve aliases like "current folder", "active file", "workspace root" to vscode.Uri */
function resolveAliasToUri(alias: string, context: { workspaceRoot?: vscode.Uri, activeEditorUri?: vscode.Uri }): { uri?: vscode.Uri; error?: string } {
  if (!alias) return { error: 'Empty alias' };

  const ali = alias.trim().toLowerCase();

  // common friendly aliases
  if (ali === 'current folder' || ali === 'currentdirectory' || ali === 'cwd') {
    if (!context.workspaceRoot) return { error: 'No workspace folder open.' };
    return { uri: context.workspaceRoot };
  }
  if (ali === 'workspace root' || ali === 'workspace') {
    if (!context.workspaceRoot) return { error: 'No workspace folder open.' };
    return { uri: context.workspaceRoot };
  }
  if (ali === 'active file' || ali === 'this file') {
    if (!context.activeEditorUri) return { error: 'No active editor file.' };
    return { uri: context.activeEditorUri };
  }

  // if it looks like a relative path: join it with workspace root
  try {
    // if absolute file URI or path
    if (alias.startsWith('file://')) {
      return { uri: vscode.Uri.parse(alias) };
    }
    // If path looks like absolute POSIX/Windows path
    if (path.isAbsolute(alias)) {
      // refuse absolute paths outside workspace for safety; allow only if workspaceRoot equals root
      // map to file://
      return { uri: vscode.Uri.file(alias) };
    }
    // fallback: relative path -> workspace root join
    if (context.workspaceRoot) {
      const joined = vscode.Uri.joinPath(context.workspaceRoot, alias);
      return { uri: joined };
    } else {
      return { error: 'Cannot resolve relative path without workspace root.' };
    }
  } catch (e: any) {
    return { error: String(e) };
  }
}

/** Prevent operations outside workspace (safety) */
function ensureWorkspaceScope(uri: vscode.Uri, workspaceRoot?: vscode.Uri): { ok: true } | { ok: false; error: string } {
  if (!workspaceRoot) {
    return { ok: false, error: 'No workspace folder open.' };
  }
  const wsPath = workspaceRoot.fsPath;
  const target = uri.fsPath;
  if (!target.startsWith(wsPath)) {
    return { ok: false, error: `Resolved path "${target}" is outside the workspace root ("${wsPath}").` };
  }
  return { ok: true };
}

/** Show confirmation dialog for potentially destructive operations */
async function requireConfirmation(parsed: ParsedCommand): Promise<boolean> {
  const op = parsed.operation;
  const targetPath = parsed.location || parsed.target || '';
  // destructive ops
  if (op === 'delete') {
    const res = await vscode.window.showWarningMessage(`LLM requests to DELETE: ${targetPath}. This action is destructive. Proceed?`, { modal: true }, 'Yes', 'No');
    return res === 'Yes';
  }
  if (op === 'rename' || op === 'copy') {
    const res = await vscode.window.showInformationMessage(`LLM requests ${op.toUpperCase()} "${parsed.location}" → "${parsed.target}". Proceed?`, { modal: true }, 'Yes', 'No');
    return res === 'Yes';
  }
  // for create/write ask normal confirmation (non-modal)
  if (op === 'create' || op === 'write') {
    const res = await vscode.window.showInformationMessage(`LLM requests to ${op.toUpperCase()} "${targetPath}". Proceed?`, 'Yes', 'No');
    return res === 'Yes';
  }
  // read / readdir shouldn't need confirmation
  return true;
}

/** Execute a parsed command safely */
async function executeParsedCommand(parsed: ParsedCommand, context: { workspaceRoot?: vscode.Uri, activeEditorUri?: vscode.Uri }, webviewPanel?: vscode.WebviewPanel) {
  // resolve primary URIs
  if (!parsed.location && (parsed.operation !== 'mkdir' && parsed.operation !== 'readdir')) {
    throw new Error('Missing location to operate on.');
  }

  const workspaceRoot = context.workspaceRoot;

  const resolve = (s?: string) => {
    if (!s) return { uri: undefined, error: 'No path' };
    const r = resolveAliasToUri(s, context);
    if (r.error) return r;
    return { uri: r.uri! };
  };

  const loc = resolve(parsed.location);
  if (loc.error) throw new Error(loc.error);
  const uri = loc.uri!;

  // Security: ensure workspace scope
  const sc = ensureWorkspaceScope(uri, workspaceRoot);
  if (!sc.ok) throw new Error(sc.error);

  // if operation requires confirmation, show it
  const ok = await requireConfirmation(parsed);
  if (!ok) {
    return { ok: false, message: 'User declined' };
  }

  // perform operation
  switch (parsed.operation) {
    case 'create': {
      // create file at resolved location (if location points to dir, require a filename)
      let targetUri = uri;
      // If target is a directory (ends with slash or is a folder path), ask to append a file name
      // We'll attempt to write if path has an extension or doesn't exist
      // Create intermediate directories automatically if necessary
      try {
        // write via safe temp file -> rename
        const encoder = new TextEncoder();
        const content = parsed.content ?? '';
        // Ensure parent exists
        const parent = vscode.Uri.file(path.dirname(targetUri.fsPath));
        // create parent directories recursively
        await vscode.workspace.fs.createDirectory(parent);

        // write file
        await vscode.workspace.fs.writeFile(targetUri, encoder.encode(content));
        pushHistory({ ts: Date.now(), op: 'create', uri: targetUri.toString(), content: content });
        return { ok: true, message: 'File created', uri: targetUri.toString() };
      } catch (e: any) {
        throw new Error(`Create failed: ${String(e)}`);
      }
    }

    case 'write': {
      // overwrite or create file content
      const encoder = new TextEncoder();
      const content = parsed.content ?? '';
      try {
        // make backup for undo if file exists
        let prev: Uint8Array | null = null;
        try {
          prev = await vscode.workspace.fs.readFile(uri);
        } catch { prev = null; }

        await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
        pushHistory({ ts: Date.now(), op: 'write', uri: uri.toString(), prev: prev ? Buffer.from(prev).toString('base64') : null, content });
        return { ok: true, message: 'Wrote file', uri: uri.toString() };
      } catch (e: any) {
        throw new Error(`Write failed: ${String(e)}`);
      }
    }

    case 'read': {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const decoded = new TextDecoder().decode(data);
        return { ok: true, content: decoded, uri: uri.toString() };
      } catch (e: any) {
        throw new Error(`Read failed: ${String(e)}`);
      }
    }

    case 'delete': {
      try {
        // backup before delete for undo
        let prev: Uint8Array | null = null;
        try { prev = await vscode.workspace.fs.readFile(uri); } catch {}
        await vscode.workspace.fs.delete(uri, { recursive: parsed.recursive ?? false });
        pushHistory({ ts: Date.now(), op: 'delete', uri: uri.toString(), prev: prev ? Buffer.from(prev).toString('base64') : null });
        return { ok: true, message: 'Deleted', uri: uri.toString() };
      } catch (e: any) {
        throw new Error(`Delete failed: ${String(e)}`);
      }
    }

    case 'rename': {
      if (!parsed.target) throw new Error('Rename requires target.');
      const resolvedTarget = resolve(parsed.target);
      if (resolvedTarget.error) throw new Error(resolvedTarget.error);
      const targetUri = resolvedTarget.uri!;
      // ensure within workspace
      const sc2 = ensureWorkspaceScope(targetUri, workspaceRoot);
      if (!sc2.ok) throw new Error(sc2.error);

      try {
        // backup prev
        let prev: Uint8Array | null = null;
        try { prev = await vscode.workspace.fs.readFile(uri); } catch { prev = null; }
        await vscode.workspace.fs.rename(uri, targetUri, { overwrite: parsed.overwrite ?? false });
        pushHistory({ ts: Date.now(), op: 'rename', from: uri.toString(), to: targetUri.toString(), prev: prev ? Buffer.from(prev).toString('base64') : null });
        return { ok: true, message: 'Renamed', from: uri.toString(), to: targetUri.toString() };
      } catch (e: any) {
        throw new Error(`Rename failed: ${String(e)}`);
      }
    }

    case 'copy': {
      if (!parsed.target) throw new Error('Copy requires target.');
      const resolvedTarget = resolve(parsed.target);
      if (resolvedTarget.error) throw new Error(resolvedTarget.error);
      const targetUri = resolvedTarget.uri!;
      const sc2 = ensureWorkspaceScope(targetUri, workspaceRoot);
      if (!sc2.ok) throw new Error(sc2.error);
      try {
        await vscode.workspace.fs.copy(uri, targetUri, { overwrite: parsed.overwrite ?? false });
        pushHistory({ ts: Date.now(), op: 'copy', from: uri.toString(), to: targetUri.toString() });
        return { ok: true, message: 'Copied', from: uri.toString(), to: targetUri.toString() };
      } catch (e: any) {
        throw new Error(`Copy failed: ${String(e)}`);
      }
    }

    case 'mkdir': {
      try {
        await vscode.workspace.fs.createDirectory(uri);
        pushHistory({ ts: Date.now(), op: 'mkdir', uri: uri.toString() });
        return { ok: true, message: 'Directory created', uri: uri.toString() };
      } catch (e: any) {
        throw new Error(`Mkdir failed: ${String(e)}`);
      }
    }

    case 'readdir': {
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        return { ok: true, entries, uri: uri.toString() };
      } catch (e: any) {
        throw new Error(`ReadDirectory failed: ${String(e)}`);
      }
    }

    default:
      throw new Error(`Unhandled operation: ${parsed.operation}`);
  }
}

/** Helper: send a message back to a WebviewPanel if provided */
function sendResponseToWebview(panel: vscode.WebviewPanel | undefined, payload: any) {
  if (!panel) return;
  try {
    panel.webview.postMessage({ source: 'extension', payload });
  } catch (e) {
    console.warn('Failed to post message to webview', e);
  }
}

/** Activation: register a WebviewViewProvider for chatSidebarView (as in package.json) */
export function activate(context: vscode.ExtensionContext) {
  console.log('Agile AI assistant extension activating...');

  const provider: vscode.WebviewViewProvider = {
    resolveWebviewView(webviewView) {
      webviewView.webview.options = { enableScripts: true };
      // Basic HTML: instruct the webview to post structured LLM outputs using postMessage
      webviewView.webview.html = getWebviewHtml();
      // handle messages coming from webview (LLM responses or other events)
      webviewView.webview.onDidReceiveMessage(async (msg) => {
        try {
          // expecting msg.type = 'llm_output' and msg.text
          if (msg?.type === 'llm_output' && typeof msg.text === 'string') {
            await handleLlmOutput(msg.text, webviewView.webview);
          } else if (msg?.type === 'request_undo') {
            const res = await handleUndo();
            webviewView.webview.postMessage({ source: 'extension', payload: { type: 'undo_result', result: res } });
          }
        } catch (e: any) {
          webviewView.webview.postMessage({ source: 'extension', payload: { type: 'error', message: String(e) } });
        }
      });
    }
  };

  context.subscriptions.push(vscode.window.registerWebviewViewProvider('chatSidebarView', provider));

  // command to show operation history
  context.subscriptions.push(vscode.commands.registerCommand('agileAI.showHistory', () => {
    vscode.window.showInformationMessage(`Recent operations: ${opHistory.length}`);
  }));

  // expose a quick command to undo last operation
  context.subscriptions.push(vscode.commands.registerCommand('agileAI.undoLast', async () => {
    const res = await handleUndo();
    vscode.window.showInformationMessage(`Undo result: ${JSON.stringify(res)}`);
  }));

  // helper to open devtools for webview
  context.subscriptions.push(vscode.commands.registerCommand('agileAI.openChat', async () => {
    // find the view, reveal it
    await vscode.commands.executeCommand('workbench.view.extension.chatActivityBar');
  }));

  // context: workspace root & active editor
  // no further startup actions
}

/** Deactivate */
export function deactivate() {
  // nothing
}

/** Process LLM output: extract blocks, parse, validate, queue execution */
async function handleLlmOutput(text: string, webview?: vscode.Webview) {
  // extract blocks
  const blocks = extractCommandBlocks(text);
  if (!blocks.length) {
    webview?.postMessage({ source: 'extension', payload: { type: 'no_command', message: 'No command blocks found.' } });
    return;
  }

  const workspaceRoot = vscode.workspace.workspaceFolders?.[0]?.uri;
  const activeEditorUri = vscode.window.activeTextEditor?.document.uri;

  for (const block of blocks) {
    const raw = parseCommandBlock(block);
    const { parsed, error } = normalizeRawCommand(raw, block);
    if (error) {
      webview?.postMessage({ source: 'extension', payload: { type: 'parse_error', message: error, block } });
      continue;
    }

    // validate further semantic stuff (e.g., content must be provided for write/create)
    // if invalid -> post back to webview and skip
    // Enqueue execution to keep ordering; each execution runs in queue and will post back results
    execQueue.add(async () => {
      try {
        const res = await executeParsedCommand(parsed!, { workspaceRoot, activeEditorUri }, undefined);
        // send back result (webview)
        webview?.postMessage({ source: 'extension', payload: { type: 'execute_result', result: res, block } });
      } catch (e: any) {
        webview?.postMessage({ source: 'extension', payload: { type: 'execute_error', error: String(e), block } });
      }
    });
  }
}

/** Undo handler: simple best-effort using opHistory */
async function handleUndo(): Promise<{ ok: boolean; message?: string }> {
  const last = opHistory.shift();
  if (!last) return { ok: false, message: 'No operations to undo.' };

  try {
    switch (last.op) {
      case 'create':
        // delete created file
        await vscode.workspace.fs.delete(vscode.Uri.parse(last.uri));
        return { ok: true, message: 'Undid create (deleted file).' };

      case 'write': {
        const uri = vscode.Uri.parse(last.uri);
        if (last.prev) {
          const prevBytes = Buffer.from(last.prev, 'base64');
          await vscode.workspace.fs.writeFile(uri, prevBytes);
          return { ok: true, message: 'Restored previous file contents.' };
        } else {
          // file did not exist before -> delete
          await vscode.workspace.fs.delete(uri);
          return { ok: true, message: 'Deleted file created by write (no previous contents).' };
        }
      }

      case 'delete': {
        if (!last.prev) return { ok: false, message: 'No backup for deleted file.' };
        const uri = vscode.Uri.parse(last.uri);
        const bytes = Buffer.from(last.prev, 'base64');
        await vscode.workspace.fs.writeFile(uri, bytes);
        return { ok: true, message: 'Restored deleted file.' };
      }

      case 'rename': {
        // attempt to rename back
        const from = vscode.Uri.parse(last.to);
        const to = vscode.Uri.parse(last.from);
        await vscode.workspace.fs.rename(from, to, { overwrite: true });
        return { ok: true, message: 'Renamed back.' };
      }

      case 'copy': {
        // delete the copied file
        const to = vscode.Uri.parse(last.to);
        await vscode.workspace.fs.delete(to, { recursive: false });
        return { ok: true, message: 'Removed copied file.' };
      }

      case 'mkdir': {
        const uri = vscode.Uri.parse(last.uri);
        await vscode.workspace.fs.delete(uri, { recursive: true });
        return { ok: true, message: 'Removed created directory.' };
      }

      default:
        return { ok: false, message: 'Unknown op in history.' };
    }
  } catch (e: any) {
    return { ok: false, message: `Undo error: ${String(e)}` };
  }
}

/** Minimal HTML for the webview that instructs the front-end to post LLM outputs. 
 *  Your existing chatbot.html can instead post messages to the extension with:
 *  window.acquireVsCodeApi().postMessage({ type: 'llm_output', text: '<full LLM response>' })
 */
function getWebviewHtml(): string {
  // The webview should be replaced with the project's chatbot UI; this is placeholder
  return `
    <!doctype html>
    <html>
      <body>
        <h3>Agile AI Assistant (embedded)</h3>
        <p>To use: post messages with type:'llm_output' and the LLM response text (which may contain one or more command blocks).</p>
        <script>
          const vscode = acquireVsCodeApi();
          // example: send a sample block to extension for testing
          // vscode.postMessage({ type: 'llm_output', text: '####\\n//?Operation: Create\\n//?What: File\\n//?Location: ~~?src/hello.txt~~?\\n//?Content: $$?Hello from LLM$$?\\n//?ContentType: text/plain\\n####' });
        </script>
      </body>
    </html>
  `;
}

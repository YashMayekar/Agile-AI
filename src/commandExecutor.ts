/* src/commandExecutor.ts
   Handles execution of parsed commands with user confirmation and safety checks
*/
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { TextEncoder, TextDecoder } from 'util';
import { ParsedCommand } from './commandParser';
import { resolveAliasToUri, ensureWorkspaceScope, ResolutionContext } from './pathResolver';

export interface ExecutionResult {
  ok: boolean;
  message?: string;
  content?: string;
  uri?: string;
  from?: string;
  to?: string;
  entries?: [string, vscode.FileType][];
  operation?: string;
  readContent?: string; // Store read content for frontend display
}


/** Show confirmation dialog for potentially destructive operations */
export async function requireConfirmation(parsed: ParsedCommand): Promise<boolean> {
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

/** Store read content in a temporary file and return the path */
function storeReadContent(content: string, filename: string): string {
  const tempDir = path.join(__dirname, '..', 'temp');
  
  // Ensure temp directory exists
  if (!fs.existsSync(tempDir)) {
    fs.mkdirSync(tempDir, { recursive: true });
  }
  
  const tempFilePath = path.join(tempDir, `read_${filename}_${Date.now()}.txt`);
  fs.writeFileSync(tempFilePath, content, 'utf8');
  
  return tempFilePath;
}

/** Format file content for display in frontend */
function formatContentForDisplay(content: string, uri: string, maxLength: number = 2000): string {
  const filename = path.basename(uri);
  
  if (content.length <= maxLength) {
    return `📖 **Read Operation Result - ${filename}**\n\n\`\`\`\n${content}\n\`\`\``;
  } else {
    const truncated = content.substring(0, maxLength) + '... [content truncated]';
    return `📖 **Read Operation Result - ${filename}** (truncated)\n\n\`\`\`\n${truncated}\n\`\`\``;
  }
}

/** Format directory listing for display */
function formatDirectoryListing(entries: [string, vscode.FileType][], uri: string): string {
  const dirName = path.basename(uri);
  const fileList = entries.map(([name, type]) => {
    const icon = type === vscode.FileType.Directory ? '📁' : 
                type === vscode.FileType.SymbolicLink ? '🔗' : '📄';
    return `${icon} ${name}`;
  }).join('\n');
  
  return `📁 **Directory Listing - ${dirName}**\n\n${fileList}`;
}

/** Execute a parsed command safely */
export async function executeParsedCommand(
  parsed: ParsedCommand, 
  context: ResolutionContext, 
  onHistoryPush?: (entry: any) => void
): Promise<ExecutionResult> {
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
        onHistoryPush?.({ ts: Date.now(), op: 'create', uri: targetUri.toString(), content: content });
        return { 
          ok: true, 
          message: 'File created', 
          uri: targetUri.toString(),
          operation: 'create'
        };
      } catch (e: any) {
        throw new Error(`Create failed: ${String(e)}`);
      }
    }

    case 'write': {
  const encoder = new TextEncoder();
  const decoder = new TextDecoder();
  let content = parsed.content ?? '';

  try {
    // Backup for undo if file exists
    let prev: Uint8Array | null = null;
    try {
      prev = await vscode.workspace.fs.readFile(uri);
    } catch {
      prev = null;
    }

    const existingContent = prev ? decoder.decode(prev) : '';
    const lines = existingContent.split(/\r?\n/);

    const appendPrefix = 'Append: ';
    const replacePrefix = 'Replace Line ';
    const insertPrefix = 'Insert Line ';

    // --- Append Mode ---
    if (content.startsWith(appendPrefix)) {
      const appendText = content.slice(appendPrefix.length).trimStart();
      const newContent =
        existingContent.length > 0
          ? `${existingContent}\n${appendText}`
          : appendText;

      await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));
      onHistoryPush?.({
        ts: Date.now(),
        op: 'append',
        uri: uri.toString(),
        prev: prev ? Buffer.from(prev).toString('base64') : null,
        content: appendText,
      });

      return {
        ok: true,
        message: 'Appended to file',
        uri: uri.toString(),
        operation: 'append',
      };
    }

    // --- Replace Line Mode ---
    if (content.startsWith(replacePrefix)) {
      const match = content.match(/^Replace Line (\d+):\s*(.*)$/s);
      if (!match) throw new Error('Invalid Replace Line format.');
      const lineNum = parseInt(match[1], 10);
      const newLine = match[2] ?? '';

      // If the file has fewer lines, pad with empty lines
      while (lines.length < lineNum) lines.push('');

      lines[lineNum - 1] = newLine;
      const newContent = lines.join('\n');

      await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));
      onHistoryPush?.({
        ts: Date.now(),
        op: 'replace-line',
        uri: uri.toString(),
        prev: prev ? Buffer.from(prev).toString('base64') : null,
        content: newLine,
      });

      return {
        ok: true,
        message: `Replaced line ${lineNum}`,
        uri: uri.toString(),
        operation: 'replace-line',
      };
    }

    // --- Insert Line Mode ---
    if (content.startsWith(insertPrefix)) {
      const match = content.match(/^Insert Line (\d+):\s*(.*)$/s);
      if (!match) throw new Error('Invalid Insert Line format.');
      const lineNum = parseInt(match[1], 10);
      const insertLine = match[2] ?? '';

      // Clamp line number between 1 and lines.length + 1
      const index = Math.max(0, Math.min(lineNum - 1, lines.length));
      lines.splice(index, 0, insertLine);
      const newContent = lines.join('\n');

      await vscode.workspace.fs.writeFile(uri, encoder.encode(newContent));
      onHistoryPush?.({
        ts: Date.now(),
        op: 'insert-line',
        uri: uri.toString(),
        prev: prev ? Buffer.from(prev).toString('base64') : null,
        content: insertLine,
      });

      return {
        ok: true,
        message: `Inserted line at ${lineNum}`,
        uri: uri.toString(),
        operation: 'insert-line',
      };
    }

    // --- Default Write (overwrite) ---
    await vscode.workspace.fs.writeFile(uri, encoder.encode(content));
    onHistoryPush?.({
      ts: Date.now(),
      op: 'write',
      uri: uri.toString(),
      prev: prev ? Buffer.from(prev).toString('base64') : null,
      content,
    });
    return {
      ok: true,
      message: 'Wrote file',
      uri: uri.toString(),
      operation: 'write',
    };
  } catch (e: any) {
    throw new Error(`Write failed: ${String(e)}`);
  }
}



    case 'read': {
      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const decoded = new TextDecoder().decode(data);
        
        // Store the read content for frontend display
        const filename = path.basename(uri.fsPath);
        const tempFilePath = storeReadContent(decoded, filename);
        const formattedContent = formatContentForDisplay(decoded, uri.fsPath);
        
        // Show brief notification
        vscode.window.showInformationMessage(`Read ${filename} (${decoded.length} chars)`);
        
        return { 
          ok: true, 
          content: decoded, 
          uri: uri.toString(),
          readContent: formattedContent, // This will be sent to frontend
          operation: 'read',
          message: `Read ${filename} successfully`
        };
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
        onHistoryPush?.({ ts: Date.now(), op: 'delete', uri: uri.toString(), prev: prev ? Buffer.from(prev).toString('base64') : null });
        return { 
          ok: true, 
          message: 'Deleted', 
          uri: uri.toString(),
          operation: 'delete'
        };
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
        onHistoryPush?.({ ts: Date.now(), op: 'rename', from: uri.toString(), to: targetUri.toString(), prev: prev ? Buffer.from(prev).toString('base64') : null });
        return { 
          ok: true, 
          message: 'Renamed', 
          from: uri.toString(), 
          to: targetUri.toString(),
          operation: 'rename'
        };
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
        onHistoryPush?.({ ts: Date.now(), op: 'copy', from: uri.toString(), to: targetUri.toString() });
        return { 
          ok: true, 
          message: 'Copied', 
          from: uri.toString(), 
          to: targetUri.toString(),
          operation: 'copy'
        };
      } catch (e: any) {
        throw new Error(`Copy failed: ${String(e)}`);
      }
    }

    case 'mkdir': {
      try {
        await vscode.workspace.fs.createDirectory(uri);
        onHistoryPush?.({ ts: Date.now(), op: 'mkdir', uri: uri.toString() });
        return { 
          ok: true, 
          message: 'Directory created', 
          uri: uri.toString(),
          operation: 'mkdir'
        };
      } catch (e: any) {
        throw new Error(`Mkdir failed: ${String(e)}`);
      }
    }

    case 'readdir': {
      try {
        const entries = await vscode.workspace.fs.readDirectory(uri);
        const formattedListing = formatDirectoryListing(entries, uri.fsPath);
        
        return { 
          ok: true, 
          entries, 
          uri: uri.toString(),
          readContent: formattedListing, // Send formatted directory listing to frontend
          operation: 'readdir',
          message: `Read directory ${path.basename(uri.fsPath)}`
        };
      } catch (e: any) {
        throw new Error(`ReadDirectory failed: ${String(e)}`);
      }
    }
        case 'append': {
      // Append to a YAML array (e.g., 'documents')
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const yamlText = decoder.decode(data);
        const yaml = require('js-yaml');

        let doc = yaml.load(yamlText) || {};
        const target = parsed.target;
        if (!target) {
            throw new Error('Target is required for append operation');
        }
        const content = yaml.load(parsed.content ?? '') || {};

        // Ensure target exists and is an array
        if (!doc[target]) doc[target] = [];
        if (!Array.isArray(doc[target])) {
          throw new Error(`Target "${target}" is not an array`);
        }

        doc[target].push(content);

        const newYaml = yaml.dump(doc, { lineWidth: 120 });
        await vscode.workspace.fs.writeFile(uri, encoder.encode(newYaml));

        onHistoryPush?.({
          ts: Date.now(),
          op: 'append-yaml',
          uri: uri.toString(),
          target,
          content,
        });

        return {
          ok: true,
          message: `Appended new entry to ${target}`,
          uri: uri.toString(),
          operation: 'append',
        };
      } catch (e: any) {
        throw new Error(`Append failed: ${String(e)}`);
      }
    }

    case 'update': {
      // Update nested YAML field (supports agents[name=analyst] and current)
      const decoder = new TextDecoder();
      const encoder = new TextEncoder();

      try {
        const data = await vscode.workspace.fs.readFile(uri);
        const yamlText = decoder.decode(data);
        const yaml = require('js-yaml');

        let doc = yaml.load(yamlText) || {};
        const target = parsed.target?.replace(/~~\?|\\?|~~/g, '').trim();
        const content = yaml.load(parsed.content ?? '') || {};

        if (!target) throw new Error('Missing target for update.');

        if (target.startsWith('agents[')) {
          // e.g. agents[name=analyst]
          const match = target.match(/agents\[name=([^\]]+)\]/);
          if (!match) throw new Error('Invalid agents selector');
          const name = match[1];

          const idx = (doc.agents || []).findIndex((a: any) => a.name === name);
          if (idx === -1) throw new Error(`No agent found with name=${name}`);

          Object.assign(doc.agents[idx], content);
        } else {
          // Direct update of simple object (e.g. current)
          if (!doc[target] || typeof doc[target] !== 'object') {
            throw new Error(`Target "${target}" not found or invalid.`);
          }
          Object.assign(doc[target], content);
        }

        const newYaml = yaml.dump(doc, { lineWidth: 120 });
        await vscode.workspace.fs.writeFile(uri, encoder.encode(newYaml));

        onHistoryPush?.({
          ts: Date.now(),
          op: 'update-yaml',
          uri: uri.toString(),
          target,
          content,
        });

        return {
          ok: true,
          message: `Updated YAML section ${target}`,
          uri: uri.toString(),
          operation: 'update',
        };
      } catch (e: any) {
        throw new Error(`Update failed: ${String(e)}`);
      }
    }


    default:
      throw new Error(`Unhandled operation: ${parsed.operation}`);
  }
}
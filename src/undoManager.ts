/* src/undoManager.ts
   Handles undo operations and history management
*/

import * as vscode from 'vscode';
import { TextEncoder } from 'util';

export interface HistoryEntry {
  ts: number;
  op: string;
  uri?: string;
  from?: string;
  to?: string;
  prev?: string; // base64 encoded previous content
  content?: string;
}

const OP_HISTORY_MAX = 50;
const opHistory: HistoryEntry[] = [];

export function pushHistory(entry: HistoryEntry) {
  opHistory.unshift(entry);
  if (opHistory.length > OP_HISTORY_MAX) opHistory.pop();
}

export function getHistory(): HistoryEntry[] {
  return [...opHistory];
}

export function clearHistory() {
  opHistory.length = 0;
}

/** Undo handler: simple best-effort using opHistory */
export async function handleUndo(): Promise<{ ok: boolean; message?: string }> {
  const last = opHistory.shift();
  if (!last) return { ok: false, message: 'No operations to undo.' };

  try {
    switch (last.op) {
      case 'create':
        // delete created file
        await vscode.workspace.fs.delete(vscode.Uri.parse(last.uri!));
        return { ok: true, message: 'Undid create (deleted file).' };

      case 'write': {
        const uri = vscode.Uri.parse(last.uri!);
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
        const uri = vscode.Uri.parse(last.uri!);
        const bytes = Buffer.from(last.prev, 'base64');
        await vscode.workspace.fs.writeFile(uri, bytes);
        return { ok: true, message: 'Restored deleted file.' };
      }

      case 'rename': {
        // attempt to rename back
        const from = vscode.Uri.parse(last.to!);
        const to = vscode.Uri.parse(last.from!);
        await vscode.workspace.fs.rename(from, to, { overwrite: true });
        return { ok: true, message: 'Renamed back.' };
      }

      case 'copy': {
        // delete the copied file
        const to = vscode.Uri.parse(last.to!);
        await vscode.workspace.fs.delete(to, { recursive: false });
        return { ok: true, message: 'Removed copied file.' };
      }

      case 'mkdir': {
        const uri = vscode.Uri.parse(last.uri!);
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
/* src/pathResolver.ts
   Handles path resolution and workspace safety checks
*/

import * as vscode from 'vscode';
import * as path from 'path';

export interface ResolutionContext {
  workspaceRoot?: vscode.Uri;
  activeEditorUri?: vscode.Uri;
}

/** Resolve aliases like "current folder", "active file", "workspace root" to vscode.Uri */
export function resolveAliasToUri(alias: string, context: ResolutionContext): { uri?: vscode.Uri; error?: string } {
  if (!alias) return { error: 'Empty alias' };

  const ali = alias.trim();

  // Handle WorkspaceRoot replacement first
  if (ali.includes('WorkspaceRoot')) {
    if (!context.workspaceRoot) return { error: 'No workspace folder open.' };
    const relativePath = ali.replace(/WorkspaceRoot\/?/i, '');
    return { uri: vscode.Uri.joinPath(context.workspaceRoot, relativePath) };
  }

  const aliLower = ali.toLowerCase();

  // common friendly aliases
  if (aliLower === 'current folder' || aliLower === 'currentdirectory' || aliLower === 'cwd') {
    if (!context.workspaceRoot) return { error: 'No workspace folder open.' };
    return { uri: context.workspaceRoot };
  }
  if (aliLower === 'workspace root' || aliLower === 'workspace') {
    if (!context.workspaceRoot) return { error: 'No workspace folder open.' };
    return { uri: context.workspaceRoot };
  }
  if (aliLower === 'active file' || aliLower === 'this file') {
    if (!context.activeEditorUri) return { error: 'No active editor file.' };
    return { uri: context.activeEditorUri };
  }

  // if it looks like a relative path: join it with workspace root
  try {
    // if absolute file URI or path
    if (ali.startsWith('file://')) {
      return { uri: vscode.Uri.parse(ali) };
    }
    // If path looks like absolute POSIX/Windows path
    if (path.isAbsolute(ali)) {
      // refuse absolute paths outside workspace for safety; allow only if workspaceRoot equals root
      // map to file://
      return { uri: vscode.Uri.file(ali) };
    }
    // fallback: relative path -> workspace root join
    if (context.workspaceRoot) {
      const joined = vscode.Uri.joinPath(context.workspaceRoot, ali);
      return { uri: joined };
    } else {
      return { error: 'Cannot resolve relative path without workspace root.' };
    }
  } catch (e: any) {
    return { error: String(e) };
  }
}

/** Prevent operations outside workspace (safety) */
export function ensureWorkspaceScope(uri: vscode.Uri, workspaceRoot?: vscode.Uri): { ok: true } | { ok: false; error: string } {
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
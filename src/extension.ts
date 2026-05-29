import * as vscode from 'vscode';
import { hasConflictMarkers } from './conflictParser';
import { openMergeEditor, sendCommandToActivePanel, isOpenForUri } from './mergeEditorProvider';
import { SidebarProvider } from './sidebarProvider';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = () => vscode.workspace.getConfiguration('monkeyMerge');

  // ── Sidebar panel ─────────────────────────────────────────────────────────
  const sidebarProvider = new SidebarProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('monkeyMerge.panel', sidebarProvider)
  );

  // ── Commands ─────────────────────────────────────────────────────────────

  context.subscriptions.push(
    vscode.commands.registerCommand('monkeyMerge.openMergeEditor', async (uri?: vscode.Uri) => {
      const target = uri ?? vscode.window.activeTextEditor?.document.uri;
      if (!target) {
        vscode.window.showErrorMessage('Open a file with merge conflicts first.');
        return;
      }
      await openMergeEditor(target, context);
    }),

    vscode.commands.registerCommand('monkeyMerge.acceptYours',
      () => sendCommandToActivePanel('acceptYours')),
    vscode.commands.registerCommand('monkeyMerge.acceptTheirs',
      () => sendCommandToActivePanel('acceptTheirs')),
    vscode.commands.registerCommand('monkeyMerge.acceptBoth',
      () => sendCommandToActivePanel('acceptBoth')),
    vscode.commands.registerCommand('monkeyMerge.nextConflict',
      () => sendCommandToActivePanel('nextConflict')),
    vscode.commands.registerCommand('monkeyMerge.previousConflict',
      () => sendCommandToActivePanel('previousConflict')),
  );

  // ── Auto-open when switching to a file that has conflicts ─────────────────

  async function maybeAutoOpen(doc: vscode.TextDocument): Promise<void> {
    if (!cfg().get<boolean>('autoDetect', true)) return;
    if (doc.uri.scheme !== 'file') return;
    if (isOpenForUri(doc.uri)) return;
    if (!hasConflictMarkers(doc.getText())) return;
    await openMergeEditor(doc.uri, context);
  }

  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (!editor) return;
      await maybeAutoOpen(editor.document);
    })
  );

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async doc => {
      await new Promise(r => setTimeout(r, 100));
      await maybeAutoOpen(doc);
    })
  );

  const active = vscode.window.activeTextEditor;
  if (active) {
    maybeAutoOpen(active.document);
  }
}

export function deactivate(): void {}

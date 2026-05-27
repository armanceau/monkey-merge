import * as vscode from 'vscode';
import { hasConflictMarkers } from './conflictParser';
import { openMergeEditor, sendCommandToActivePanel, isOpenForUri } from './mergeEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = () => vscode.workspace.getConfiguration('monkeyMerge');

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
  // No prompt: open immediately (IntelliJ behaviour), beside the current file.

  async function maybeAutoOpen(doc: vscode.TextDocument): Promise<void> {
    if (!cfg().get<boolean>('autoDetect', true)) return;
    if (doc.uri.scheme !== 'file') return;
    if (isOpenForUri(doc.uri)) return;       // already open
    if (!hasConflictMarkers(doc.getText())) return;
    await openMergeEditor(doc.uri, context);
  }

  // Fires when the user focuses a different editor tab
  context.subscriptions.push(
    vscode.window.onDidChangeActiveTextEditor(async editor => {
      if (!editor) return;
      await maybeAutoOpen(editor.document);
    })
  );

  // Fires when a document is first loaded (e.g. opened via git status click)
  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async doc => {
      // Give VS Code a tick so the editor is visible before we open beside it
      await new Promise(r => setTimeout(r, 100));
      await maybeAutoOpen(doc);
    })
  );

  // Check the currently active editor at activation time
  const active = vscode.window.activeTextEditor;
  if (active) {
    maybeAutoOpen(active.document);
  }
}

export function deactivate(): void {}

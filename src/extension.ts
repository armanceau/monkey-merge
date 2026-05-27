import * as vscode from 'vscode';
import { hasConflictMarkers } from './conflictParser';
import { openMergeEditor, sendCommandToActivePanel } from './mergeEditorProvider';

export function activate(context: vscode.ExtensionContext): void {
  const cfg = () => vscode.workspace.getConfiguration('monkeyMerge');

  // ── Commands ────────────────────────────────────────────────────────────────

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

  // ── Auto-detect conflicts on file open ──────────────────────────────────────

  context.subscriptions.push(
    vscode.workspace.onDidOpenTextDocument(async doc => {
      if (!cfg().get<boolean>('autoDetect', true)) return;
      if (doc.uri.scheme !== 'file') return;
      if (!hasConflictMarkers(doc.getText())) return;

      const choice = await vscode.window.showInformationMessage(
        `"${doc.fileName.split(/[\\/]/).pop()}" has merge conflicts.`,
        'Open Merge Editor',
        'Dismiss'
      );
      if (choice === 'Open Merge Editor') {
        await openMergeEditor(doc.uri, context);
      }
    })
  );

  // Prompt for any already-open conflicted file at activation
  for (const doc of vscode.workspace.textDocuments) {
    if (doc.uri.scheme === 'file' && hasConflictMarkers(doc.getText())) {
      vscode.window.showInformationMessage(
        `"${doc.fileName.split(/[\\/]/).pop()}" has merge conflicts.`,
        'Open Merge Editor',
        'Dismiss'
      ).then(choice => {
        if (choice === 'Open Merge Editor') openMergeEditor(doc.uri, context);
      });
      break; // one prompt is enough on startup
    }
  }
}

export function deactivate(): void {}

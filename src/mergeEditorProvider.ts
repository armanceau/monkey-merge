import * as vscode from 'vscode';
import * as path from 'path';
import { parseConflicts, hasConflictMarkers } from './conflictParser';
import { MergeDocument } from './mergeDocument';

// One active webview panel per file URI
const openPanels = new Map<string, { panel: vscode.WebviewPanel; doc: MergeDocument }>();
// The most recently focused merge editor panel (for keyboard commands)
let activePanelKey: string | undefined;

export async function openMergeEditor(
  uri: vscode.Uri,
  context: vscode.ExtensionContext
): Promise<void> {
  const key = uri.toString();

  if (openPanels.has(key)) {
    openPanels.get(key)!.panel.reveal(vscode.ViewColumn.One);
    return;
  }

  const rawBytes = await vscode.workspace.fs.readFile(uri);
  const text = Buffer.from(rawBytes).toString('utf-8');

  if (!hasConflictMarkers(text)) {
    vscode.window.showInformationMessage('No git conflict markers found in this file.');
    return;
  }

  // Detect binary content heuristically (null bytes)
  if (text.includes('\0')) {
    vscode.window.showWarningMessage('Binary file detected — cannot display merge editor.');
    return;
  }

  const parseResult = parseConflicts(text);
  const doc = new MergeDocument(parseResult);
  const fileName = path.basename(uri.fsPath);

  const panel = vscode.window.createWebviewPanel(
    'monkeyMergeEditor',
    `⚡ Merge: ${fileName}`,
    vscode.ViewColumn.One,
    {
      enableScripts: true,
      retainContextWhenHidden: true,
      localResourceRoots: [
        vscode.Uri.joinPath(context.extensionUri, 'src', 'webview'),
      ],
    }
  );

  openPanels.set(key, { panel, doc });
  activePanelKey = key;

  vscode.commands.executeCommand('setContext', 'monkeyMergeEditorActive', true);

  panel.onDidChangeViewState(e => {
    if (e.webviewPanel.active) {
      activePanelKey = key;
      vscode.commands.executeCommand('setContext', 'monkeyMergeEditorActive', true);
    }
  });

  panel.onDidDispose(() => {
    openPanels.delete(key);
    if (activePanelKey === key) {
      activePanelKey = undefined;
      if (openPanels.size === 0) {
        vscode.commands.executeCommand('setContext', 'monkeyMergeEditorActive', false);
      }
    }
  });

  panel.webview.html = buildHtml(panel.webview, context);

  panel.webview.onDidReceiveMessage(async msg => {
    switch (msg.type) {
      case 'ready':
        panel.webview.postMessage({
          type: 'init',
          state: doc.getWebviewState(),
          filePath: uri.fsPath,
          fileName,
        });
        break;

      case 'resolve':
        doc.resolve(msg.conflictIndex, msg.resolutionType, msg.customLines);
        panel.webview.postMessage({ type: 'stateUpdate', state: doc.getWebviewState() });
        break;

      case 'unresolve':
        doc.unresolve(msg.conflictIndex);
        panel.webview.postMessage({ type: 'stateUpdate', state: doc.getWebviewState() });
        break;

      case 'apply':
        await applyMerge(uri, doc);
        panel.dispose();
        break;

      case 'abort': {
        const choice = await vscode.window.showWarningMessage(
          'Abort merge? All resolution progress will be lost.',
          { modal: true },
          'Abort'
        );
        if (choice === 'Abort') panel.dispose();
        break;
      }
    }
  });
}

export function sendCommandToActivePanel(command: string): void {
  if (!activePanelKey) return;
  const entry = openPanels.get(activePanelKey);
  entry?.panel.webview.postMessage({ type: 'command', command });
}

async function applyMerge(uri: vscode.Uri, doc: MergeDocument): Promise<void> {
  if (!doc.isFullyResolved) {
    const choice = await vscode.window.showWarningMessage(
      `${doc.totalConflicts - doc.resolvedCount} conflict(s) still unresolved. Apply anyway (unresolved conflicts will keep their markers)?`,
      'Apply Anyway',
      'Cancel'
    );
    if (choice !== 'Apply Anyway') return;
  }

  const merged = doc.getMergedContent();
  await vscode.workspace.fs.writeFile(uri, Buffer.from(merged, 'utf-8'));

  const textDoc = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(textDoc, { preview: false });

  vscode.window.showInformationMessage(
    doc.isFullyResolved ? '✓ Merge applied — all conflicts resolved.' : '⚠ Merge applied with unresolved conflicts.'
  );
}

function buildHtml(webview: vscode.Webview, context: vscode.ExtensionContext): string {
  const css = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'mergeEditor.css')
  );
  const js = webview.asWebviewUri(
    vscode.Uri.joinPath(context.extensionUri, 'src', 'webview', 'mergeEditor.js')
  );
  const nonce = crypto.randomUUID().replace(/-/g, '');

  return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none';
             style-src ${webview.cspSource} 'unsafe-inline';
             script-src 'nonce-${nonce}';">
  <link rel="stylesheet" href="${css}">
  <title>Merge Editor</title>
</head>
<body>
<div id="app">

  <!-- ── Toolbar ──────────────────────────────────── -->
  <div id="toolbar">
    <div class="tb-group">
      <button id="btn-prev" class="tb-btn" title="Previous conflict (Alt+↑)">&#9664; Prev</button>
      <span id="conflict-counter" class="tb-counter">—</span>
      <button id="btn-next" class="tb-btn" title="Next conflict (Alt+↓)">Next &#9654;</button>
    </div>
    <div class="tb-group tb-center">
      <div id="progress-wrap">
        <div id="progress-fill"></div>
      </div>
      <span id="progress-label">0%</span>
    </div>
    <div class="tb-group">
      <button id="btn-apply" class="tb-btn tb-apply" title="Save merged result">&#10003; Apply</button>
      <button id="btn-abort" class="tb-btn tb-abort" title="Discard and close">&#10007; Abort</button>
    </div>
  </div>

  <!-- ── Panel headers ────────────────────────────── -->
  <div id="panel-headers">
    <div class="ph ph-left">
      <span class="ph-arrow">&#9668;&#9668;</span>
      <span id="lbl-yours">Yours</span>
    </div>
    <div class="ph ph-center">Result</div>
    <div class="ph ph-right">
      <span id="lbl-theirs">Theirs</span>
      <span class="ph-arrow">&#9658;&#9658;</span>
    </div>
  </div>

  <!-- ── Three-way editor ─────────────────────────── -->
  <div id="editor-wrap">
    <table id="merge-table">
      <colgroup>
        <col class="col-gutter"> <!-- left gutter -->
        <col class="col-pane">   <!-- left content -->
        <col class="col-gutter"> <!-- center gutter -->
        <col class="col-pane">   <!-- center content -->
        <col class="col-gutter"> <!-- right gutter -->
        <col class="col-pane">   <!-- right content -->
      </colgroup>
      <tbody id="merge-body"></tbody>
    </table>
  </div>

  <!-- ── Status bar ───────────────────────────────── -->
  <div id="status-bar">
    <span id="status-msg"></span>
    <span id="status-file"></span>
  </div>

</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

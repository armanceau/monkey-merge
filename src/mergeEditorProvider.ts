import * as vscode from 'vscode';
import * as path from 'path';
import { parseConflicts, hasConflictMarkers } from './conflictParser';
import { MergeDocument } from './mergeDocument';

// One active webview panel per file URI
const openPanels = new Map<string, { panel: vscode.WebviewPanel; doc: MergeDocument }>();
// The most recently focused merge editor panel (for keyboard commands)
let activePanelKey: string | undefined;

export function isOpenForUri(uri: vscode.Uri): boolean {
  return openPanels.has(uri.toString());
}

export async function openMergeEditor(
  uri: vscode.Uri,
  context: vscode.ExtensionContext
): Promise<void> {
  const key = uri.toString();

  if (openPanels.has(key)) {
    openPanels.get(key)!.panel.reveal(vscode.ViewColumn.Beside, true);
    return;
  }

  const rawBytes = await vscode.workspace.fs.readFile(uri);
  // Strip UTF-8 BOM if present, normalize CRLF → LF
  const text = Buffer.from(rawBytes)
    .toString('utf-8')
    .replace(/^﻿/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n');

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

  // Debug output visible in "Extension Host" output panel
  console.log(`[MonkeyMerge] ${path.basename(uri.fsPath)}: ${parseResult.conflicts.length} conflict(s), ${parseResult.lines.length} lines`);
  if (parseResult.conflicts.length === 0) {
    const sample = text.split('\n').slice(0, 20).join(' | ');
    console.log(`[MonkeyMerge] WARNING — 0 conflicts detected. First 20 lines: ${sample}`);
  }
  const fileName = path.basename(uri.fsPath);

  const panel = vscode.window.createWebviewPanel(
    'monkeyMergeEditor',
    ` Merge: ${fileName}`,
    { viewColumn: vscode.ViewColumn.Beside, preserveFocus: true },
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

      case 'toggleLine':
        doc.resolveLines(msg.conflictIndex, msg.yoursSelected, msg.theirsSelected, msg.yoursBelow, msg.theirsBelow);
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

  <!-- §3 Toolbar (36px) -->
  <div id="toolbar">
    <button id="btn-prev"  class="tb-icon" title="Previous conflict (Alt+↑)">↑</button>
    <button id="btn-next"  class="tb-icon" title="Next conflict (Alt+↓)">↓</button>
    <button class="tb-icon" title="Jump to conflict">↗</button>
    <div class="tb-sep"></div>
    <span class="tb-label">Apply non-conflicting changes:</span>
    <button id="btn-apply-left"  class="tb-btn">Left</button>
    <button id="btn-apply-all"   class="tb-btn">All</button>
    <button id="btn-apply-right" class="tb-btn">Right</button>
    <div class="tb-sep"></div>
    <button class="tb-dropdown">Do not ignore</button>
    <button class="tb-dropdown">Highlight words</button>
    <div class="tb-spacer"></div>
    <span id="conflict-counter">— / —</span>
  </div>

  <!-- §4 Column headers (28px) -->
  <div id="column-headers">
    <div class="col-header" id="header-left">
      Changes from <strong id="branch-left">yours</strong>
      <a class="show-details" href="#">Show Details</a>
    </div>
    <div class="col-header-gutter"></div>
    <div class="col-header" id="header-center">Result</div>
    <div class="col-header-gutter"></div>
    <div class="col-header" id="header-right">
      Changes from <strong id="branch-right">theirs</strong>
      <a class="show-details" href="#">Show Details</a>
    </div>
  </div>

  <!-- §1 Three-panel merge container (flex: 1) -->
  <div id="merge-container">

    <!-- LEFT panel (read-only) -->
    <div id="panel-left" class="merge-panel">
      <div class="panel-content" id="content-left"></div>
    </div>

    <!-- §6 Left gutter (LEFT ↔ CENTER, 32px) -->
    <div id="gutter-left" class="gutter">
      <canvas id="canvas-left"></canvas>
    </div>

    <!-- CENTER panel (editable) -->
    <div id="panel-center" class="merge-panel">
      <div class="panel-content" id="content-center"></div>
    </div>

    <!-- §7 Right gutter (CENTER ↔ RIGHT, 32px) -->
    <div id="gutter-right" class="gutter">
      <canvas id="canvas-right"></canvas>
    </div>

    <!-- RIGHT panel (read-only) -->
    <div id="panel-right" class="merge-panel">
      <div class="panel-content" id="content-right"></div>
    </div>

  </div>

  <!-- §11 Footer (48px) -->
  <div id="footer">
    <div id="footer-left">
      <button id="btn-accept-left"  class="btn-secondary">Accept Left</button>
      <button id="btn-accept-right" class="btn-secondary">Accept Right</button>
    </div>
    <div id="footer-right">
      <button id="btn-cancel" class="btn-cancel">Cancel</button>
      <button id="btn-apply"  class="btn-primary">Apply</button>
    </div>
  </div>

  <!-- §12 Status bar (24px) -->
  <div id="status-bar">
    <span id="status-conflicts">Pending Unresolved conflicts // <a href="#" id="status-resolve">Resolve...</a></span>
    <span id="status-info">
      <span id="cursor-pos">1:1</span>
      <span>LF</span>
      <span>UTF-8</span>
      <span>4 spaces</span>
      <span class="merge-branch" id="merge-branch">▲ Merging</span>
    </span>
  </div>

</div>
<script nonce="${nonce}" src="${js}"></script>
</body>
</html>`;
}

import * as vscode from 'vscode';

export class SidebarProvider implements vscode.WebviewViewProvider {
  private _view?: vscode.WebviewView;

  constructor(private readonly context: vscode.ExtensionContext) {}

  resolveWebviewView(
    webviewView: vscode.WebviewView,
    _ctx: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken,
  ): void {
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this.context.extensionUri],
    };

    webviewView.webview.html = this._buildHtml();

    webviewView.webview.onDidReceiveMessage(msg => {
      if (msg.type === 'openMergeEditor') {
        vscode.commands.executeCommand('monkeyMerge.openMergeEditor');
      }
    });
  }

  private _buildHtml(): string {
    const nonce = crypto.randomUUID().replace(/-/g, '');
    return /* html */`<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy"
    content="default-src 'none'; style-src 'unsafe-inline'; script-src 'nonce-${nonce}';">
  <style>
    body {
      font-family: var(--vscode-font-family);
      font-size: var(--vscode-font-size);
      color: var(--vscode-foreground);
      padding: 12px;
      margin: 0;
    }
    h3 {
      font-size: 11px;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.5px;
      color: var(--vscode-descriptionForeground);
      margin: 0 0 12px 0;
    }
    .btn {
      display: block;
      width: 100%;
      padding: 6px 10px;
      margin-bottom: 8px;
      border: 1px solid var(--vscode-button-border, transparent);
      border-radius: 3px;
      background: var(--vscode-button-background);
      color: var(--vscode-button-foreground);
      cursor: pointer;
      font-size: var(--vscode-font-size);
      text-align: left;
    }
    .btn:hover { background: var(--vscode-button-hoverBackground); }
    .tip {
      font-size: 11px;
      color: var(--vscode-descriptionForeground);
      line-height: 1.5;
      margin-top: 16px;
    }
    .tip kbd {
      background: var(--vscode-keybindingLabel-background);
      border: 1px solid var(--vscode-keybindingLabel-border);
      border-radius: 3px;
      padding: 1px 5px;
      font-size: 10px;
    }
    .shortcut-row { margin-bottom: 6px; }
  </style>
</head>
<body>
  <h3>Monkey Merge</h3>

  <button class="btn" id="btn-open">⚡ Open Merge Editor</button>

  <div class="tip">
    <div class="shortcut-row"><kbd>Alt+↓</kbd> Next conflict</div>
    <div class="shortcut-row"><kbd>Alt+↑</kbd> Previous conflict</div>
    <div class="shortcut-row"><kbd>Ctrl+Alt+Y</kbd> Accept Yours</div>
    <div class="shortcut-row"><kbd>Ctrl+Alt+T</kbd> Accept Theirs</div>
    <div class="shortcut-row"><kbd>Ctrl+Alt+B</kbd> Accept Both</div>
  </div>

  <div class="tip" style="margin-top:20px">
    <strong>Per-line buttons</strong><br>
    <div class="shortcut-row">▷ / ◁  — Add line in-place</div>
    <div class="shortcut-row">▽ — Append line at end of result</div>
    <div class="shortcut-row">× — Remove from result</div>
  </div>

  <script nonce="${nonce}">
    const vscode = acquireVsCodeApi();
    document.getElementById('btn-open').addEventListener('click', () => {
      vscode.postMessage({ type: 'openMergeEditor' });
    });
  </script>
</body>
</html>`;
  }
}

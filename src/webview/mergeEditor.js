// @ts-check
/// <reference lib="dom" />
'use strict';

(function () {
  // ── VS Code API ────────────────────────────────────────────────────────────
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────
  /** @type {{ lines: string[], conflicts: any[], resolutions: any[], totalConflicts: number,
   *           resolvedCount: number, progressPercent: number, isFullyResolved: boolean,
   *           yoursBranchName: string, theirsBranchName: string } | null} */
  let state = null;
  let activeIdx = 0;   // currently focused conflict index
  let filePath = '';

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const mergeBody      = /** @type {HTMLElement} */ (document.getElementById('merge-body'));
  const counter        = /** @type {HTMLElement} */ (document.getElementById('conflict-counter'));
  const progressFill   = /** @type {HTMLElement} */ (document.getElementById('progress-fill'));
  const progressLabel  = /** @type {HTMLElement} */ (document.getElementById('progress-label'));
  const statusMsg      = /** @type {HTMLElement} */ (document.getElementById('status-msg'));
  const statusFile     = /** @type {HTMLElement} */ (document.getElementById('status-file'));
  const lblYours       = /** @type {HTMLElement} */ (document.getElementById('lbl-yours'));
  const lblTheirs      = /** @type {HTMLElement} */ (document.getElementById('lbl-theirs'));
  const btnPrev        = /** @type {HTMLButtonElement} */ (document.getElementById('btn-prev'));
  const btnNext        = /** @type {HTMLButtonElement} */ (document.getElementById('btn-next'));
  const btnApply       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-apply'));
  const btnAbort       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-abort'));

  // ── Toolbar wiring ────────────────────────────────────────────────────────
  btnPrev.addEventListener('click', () => navigate(-1));
  btnNext.addEventListener('click', () => navigate(+1));
  btnApply.addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
  btnAbort.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));

  // ── Keyboard shortcuts ────────────────────────────────────────────────────
  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowDown')          { e.preventDefault(); navigate(+1); }
    else if (e.altKey && e.key === 'ArrowUp')       { e.preventDefault(); navigate(-1); }
    else if (e.ctrlKey && e.altKey && e.key === 'y') { e.preventDefault(); resolveActive('yours'); }
    else if (e.ctrlKey && e.altKey && e.key === 't') { e.preventDefault(); resolveActive('theirs'); }
    else if (e.ctrlKey && e.altKey && e.key === 'b') { e.preventDefault(); resolveActive('both'); }
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(delta) {
    if (!state) return;
    const next = activeIdx + delta;
    if (next >= 0 && next < state.totalConflicts) {
      setActive(next);
      scrollTo(next);
    }
  }

  function setActive(idx) {
    activeIdx = idx;
    document.querySelectorAll('.active-conflict').forEach(el => el.classList.remove('active-conflict'));
    document.querySelectorAll(`[data-ci="${idx}"]`).forEach(el => el.classList.add('active-conflict'));
    updateToolbar();
  }

  function scrollTo(idx) {
    const el = document.querySelector(`tr.row-actions[data-ci="${idx}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Resolution helpers ────────────────────────────────────────────────────
  function resolveActive(type) {
    resolveConflict(activeIdx, type);
  }

  function resolveConflict(idx, type) {
    vscode.postMessage({ type: 'resolve', conflictIndex: idx, resolutionType: type });
    // Optimistically advance to next unresolved
    setTimeout(() => {
      if (!state) return;
      const next = findNextUnresolved(idx + 1) ?? findNextUnresolved(0);
      if (next !== null && next !== idx) {
        setActive(next);
        scrollTo(next);
      } else {
        setActive(idx);
      }
    }, 80);
  }

  /** @returns {number|null} */
  function findNextUnresolved(start) {
    if (!state) return null;
    for (let i = start; i < state.totalConflicts; i++) {
      if (state.resolutions[i]?.type === 'unresolved') return i;
    }
    return null;
  }

  // ── Toolbar update ────────────────────────────────────────────────────────
  function updateToolbar() {
    if (!state) return;
    const { totalConflicts, resolvedCount, progressPercent, isFullyResolved } = state;
    counter.textContent = `Conflict ${activeIdx + 1} of ${totalConflicts}  ·  ${resolvedCount}/${totalConflicts} resolved`;
    progressFill.style.width = `${progressPercent}%`;
    progressLabel.textContent = `${progressPercent}%`;

    if (isFullyResolved) {
      statusMsg.textContent = 'All conflicts resolved ✓  —  Click Apply to save';
      statusMsg.className = 'status-done';
      btnApply.removeAttribute('disabled');
    } else {
      statusMsg.textContent = `${totalConflicts - resolvedCount} conflict(s) remaining`;
      statusMsg.className = '';
    }
    statusFile.textContent = filePath ? filePath.split(/[\\/]/).pop() ?? '' : '';
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const { lines, conflicts, resolutions } = state;
    const frag = document.createDocumentFragment();

    let lineIdx = 0;
    let lNum = 1;   // left/right line number (shared for non-conflict lines)

    for (const c of conflicts) {
      // ── Normal lines before this conflict ──
      while (lineIdx < c.startLine) {
        frag.appendChild(normalRow(lines[lineIdx], lNum++));
        lineIdx++;
      }

      // ── Conflict block ──
      const res = resolutions[c.index] ?? { type: 'unresolved' };
      frag.appendChild(actionsRow(c, res));

      if (res.type === 'unresolved') {
        appendUnresolvedRows(frag, c);
      } else {
        appendResolvedRows(frag, c, res);
      }

      lineIdx = c.endLine + 1;
    }

    // Remaining normal lines
    while (lineIdx < lines.length) {
      frag.appendChild(normalRow(lines[lineIdx], lNum++));
      lineIdx++;
    }

    mergeBody.innerHTML = '';
    mergeBody.appendChild(frag);

    // Wire up event listeners for conflict buttons
    mergeBody.querySelectorAll('[data-action]').forEach(btn => {
      btn.addEventListener('click', () => {
        const ci = parseInt(/** @type {HTMLElement} */(btn).dataset['ci'] ?? '0', 10);
        const action = /** @type {HTMLElement} */(btn).dataset['action'] ?? '';
        if (action === 'undo') {
          vscode.postMessage({ type: 'unresolve', conflictIndex: ci });
          setActive(ci);
        } else {
          resolveConflict(ci, action);
        }
      });
    });

    // Re-apply active highlight
    setActive(activeIdx);
  }

  // ── Row builders ──────────────────────────────────────────────────────────

  /** @param {string} line @param {number} num */
  function normalRow(line, num) {
    const tr = mktr('row-normal');
    tr.innerHTML =
      gutter(num) + pane('pane-left',   esc(line)) +
      gutter('')  + pane('pane-center', esc(line)) +
      gutter(num) + pane('pane-right',  esc(line));
    return tr;
  }

  function actionsRow(c, res) {
    const isResolved = res.type !== 'unresolved';
    const tr = mktr(`row-actions${isResolved ? ' resolved' : ''}`, c.index);

    if (!isResolved) {
      tr.innerHTML =
        `<td class="gutter"></td>
         <td class="pane pane-left">
           <div class="action-bar yours-bar">
             <span class="conflict-label">&lt;&lt;&lt;&lt;&lt;&lt;&lt; ${esc(c.yoursBranch)}</span>
             <button class="btn-arrow btn-yours" data-action="yours" data-ci="${c.index}"
               title="Accept Yours (Ctrl+Alt+Y)">Accept Yours &#9658;</button>
           </div>
         </td>
         <td class="gutter"></td>
         <td class="pane pane-center">
           <div class="action-bar center-bar">
             <span class="conflict-num">Conflict ${c.index + 1}</span>
             <div class="act-btns">
               <button class="act-btn btn-yours"  data-action="yours"  data-ci="${c.index}" title="Ctrl+Alt+Y">Accept Yours</button>
               <button class="act-btn btn-theirs" data-action="theirs" data-ci="${c.index}" title="Ctrl+Alt+T">Accept Theirs</button>
               <button class="act-btn btn-both"   data-action="both"   data-ci="${c.index}" title="Ctrl+Alt+B">Accept Both</button>
               <button class="act-btn btn-ignore" data-action="ignored" data-ci="${c.index}">Ignore</button>
             </div>
           </div>
         </td>
         <td class="gutter"></td>
         <td class="pane pane-right">
           <div class="action-bar theirs-bar">
             <button class="btn-arrow btn-theirs" data-action="theirs" data-ci="${c.index}"
               title="Accept Theirs (Ctrl+Alt+T)">&#9664; Accept Theirs</button>
             <span class="conflict-label">${esc(c.theirsBranch)} &gt;&gt;&gt;&gt;&gt;&gt;&gt;</span>
           </div>
         </td>`;
    } else {
      const label = { yours: 'Accepted Yours', theirs: 'Accepted Theirs', both: 'Accepted Both', ignored: 'Ignored' }[res.type] ?? res.type;
      tr.innerHTML =
        `<td class="gutter"></td>
         <td class="pane pane-left"><div class="action-bar resolved-bar"></div></td>
         <td class="gutter"></td>
         <td class="pane pane-center">
           <div class="action-bar resolved-bar" style="justify-content:space-between">
             <span class="conflict-num resolved-num">&#10003; Conflict ${c.index + 1} — ${label}</span>
             <button class="act-btn btn-undo" data-action="undo" data-ci="${c.index}">Undo</button>
           </div>
         </td>
         <td class="gutter"></td>
         <td class="pane pane-right"><div class="action-bar resolved-bar"></div></td>`;
    }
    return tr;
  }

  function appendUnresolvedRows(frag, c) {
    const max = Math.max(c.yoursLines.length, c.theirsLines.length);
    for (let i = 0; i < max; i++) {
      const yL = c.yoursLines[i];
      const tL = c.theirsLines[i];
      const tr = mktr('row-conflict', c.index);
      tr.innerHTML =
        `<td class="gutter yours-line" data-ci="${c.index}"></td>` +
        (yL !== undefined
          ? `<td class="pane pane-left yours-line" data-ci="${c.index}">${esc(yL)}</td>`
          : `<td class="pane pane-left conflict-padding" data-ci="${c.index}"></td>`) +
        `<td class="gutter conflict-unresolved" data-ci="${c.index}"></td>` +
        `<td class="pane pane-center conflict-unresolved" data-ci="${c.index}">${centerDiff(yL, tL)}</td>` +
        `<td class="gutter theirs-line" data-ci="${c.index}"></td>` +
        (tL !== undefined
          ? `<td class="pane pane-right theirs-line" data-ci="${c.index}">${esc(tL)}</td>`
          : `<td class="pane pane-right conflict-padding" data-ci="${c.index}"></td>`);
      frag.appendChild(tr);
    }
    if (max === 0) {
      const tr = mktr('row-conflict', c.index);
      tr.innerHTML =
        gutter('') + `<td class="pane pane-left yours-line" data-ci="${c.index}"></td>` +
        gutter('') + `<td class="pane pane-center conflict-unresolved" data-ci="${c.index}"><em style="opacity:.5">empty</em></td>` +
        gutter('') + `<td class="pane pane-right theirs-line" data-ci="${c.index}"></td>`;
      frag.appendChild(tr);
    }
  }

  function appendResolvedRows(frag, c, res) {
    let resolved = [];
    if (res.type === 'yours')        resolved = c.yoursLines;
    else if (res.type === 'theirs')  resolved = c.theirsLines;
    else if (res.type === 'both')    resolved = [...c.yoursLines, ...c.theirsLines];
    else if (res.type === 'custom')  resolved = res.customLines ?? [];
    // 'ignored' → empty

    const max = Math.max(c.yoursLines.length, c.theirsLines.length, resolved.length, 1);
    for (let i = 0; i < max; i++) {
      const yL = c.yoursLines[i];
      const tL = c.theirsLines[i];
      const rL = resolved[i];
      const tr = mktr('row-conflict', c.index);
      tr.innerHTML =
        `<td class="gutter resolved-yours-dim" data-ci="${c.index}"></td>` +
        `<td class="pane pane-left resolved-yours-dim" data-ci="${c.index}">${yL !== undefined ? esc(yL) : ''}</td>` +
        `<td class="gutter resolved-line" data-ci="${c.index}"></td>` +
        `<td class="pane pane-center resolved-line" data-ci="${c.index}">${
          res.type === 'ignored'
            ? (i === 0 ? '<em class="ignored-cell">— ignored —</em>' : '')
            : (rL !== undefined ? esc(rL) : '')
        }</td>` +
        `<td class="gutter resolved-theirs-dim" data-ci="${c.index}"></td>` +
        `<td class="pane pane-right resolved-theirs-dim" data-ci="${c.index}">${tL !== undefined ? esc(tL) : ''}</td>`;
      frag.appendChild(tr);
    }
  }

  // ── Helpers ───────────────────────────────────────────────────────────────

  /** Inline diff display for the center pane of unresolved conflicts */
  function centerDiff(yLine, tLine) {
    if (yLine === undefined && tLine === undefined) return '';
    if (yLine === undefined) return `<span class="diff-add">${esc(tLine)}</span>`;
    if (tLine === undefined) return `<span class="diff-del">${esc(yLine)}</span>`;
    if (yLine === tLine)     return esc(yLine);
    // Simple char-level diff isn't practical here; show both with labels
    return `<span class="diff-del">${esc(yLine)}</span>`;
  }

  /** @param {string|number} n */
  function gutter(n) {
    return `<td class="gutter">${n !== '' ? n : ''}</td>`;
  }

  /** @param {string} cls @param {string} content */
  function pane(cls, content) {
    return `<td class="pane ${cls}">${content}</td>`;
  }

  /** @param {string} classes @param {number} [ci] */
  function mktr(classes, ci) {
    const tr = document.createElement('tr');
    tr.className = classes;
    if (ci !== undefined) tr.dataset['ci'] = String(ci);
    return tr;
  }

  /** @param {string} s */
  function esc(s) {
    if (s === undefined || s === null) return '';
    return s
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/\t/g, '    ');
  }

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;
    switch (msg.type) {
      case 'init':
        filePath = msg.filePath ?? '';
        state = msg.state;
        lblYours.textContent   = state.yoursBranchName;
        lblTheirs.textContent  = state.theirsBranchName;
        activeIdx = 0;
        render();
        updateToolbar();
        if (state.totalConflicts > 0) {
          requestAnimationFrame(() => scrollTo(0));
        }
        break;

      case 'stateUpdate':
        state = msg.state;
        render();
        updateToolbar();
        break;

      case 'command':
        handleCommand(msg.command);
        break;
    }
  });

  function handleCommand(cmd) {
    switch (cmd) {
      case 'acceptYours':     resolveActive('yours');   break;
      case 'acceptTheirs':    resolveActive('theirs');  break;
      case 'acceptBoth':      resolveActive('both');    break;
      case 'nextConflict':    navigate(+1);             break;
      case 'previousConflict': navigate(-1);            break;
    }
  }

  // ── Signal ready ──────────────────────────────────────────────────────────
  vscode.postMessage({ type: 'ready' });
})();

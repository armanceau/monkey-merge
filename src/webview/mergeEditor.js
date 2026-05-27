// @ts-check
'use strict';

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────
  /** @type {any} */  let state = null;
  let activeIdx  = 0;
  let filePath   = '';

  // ── DOM refs ───────────────────────────────────────────────────────────────
  const mergeBody     = /** @type {HTMLElement} */ (document.getElementById('merge-body'));
  const counter       = /** @type {HTMLElement} */ (document.getElementById('conflict-counter'));
  const progressFill  = /** @type {HTMLElement} */ (document.getElementById('progress-fill'));
  const progressLabel = /** @type {HTMLElement} */ (document.getElementById('progress-label'));
  const statusMsg     = /** @type {HTMLElement} */ (document.getElementById('status-msg'));
  const statusFile    = /** @type {HTMLElement} */ (document.getElementById('status-file'));
  const lblYours      = /** @type {HTMLElement} */ (document.getElementById('lbl-yours'));
  const lblTheirs     = /** @type {HTMLElement} */ (document.getElementById('lbl-theirs'));
  const btnPrev       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-prev'));
  const btnNext       = /** @type {HTMLButtonElement} */ (document.getElementById('btn-next'));
  const btnApply      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-apply'));
  const btnAbort      = /** @type {HTMLButtonElement} */ (document.getElementById('btn-abort'));

  // ── Toolbar ────────────────────────────────────────────────────────────────
  btnPrev.addEventListener('click',  () => navigate(-1));
  btnNext.addEventListener('click',  () => navigate(+1));
  btnApply.addEventListener('click', () => vscode.postMessage({ type: 'apply' }));
  btnAbort.addEventListener('click', () => vscode.postMessage({ type: 'abort' }));

  document.addEventListener('keydown', e => {
    if (e.altKey  && e.key === 'ArrowDown')            { e.preventDefault(); navigate(+1); }
    if (e.altKey  && e.key === 'ArrowUp')              { e.preventDefault(); navigate(-1); }
    if (e.ctrlKey && e.altKey && e.key === 'y')        { e.preventDefault(); blockResolveActive('yours'); }
    if (e.ctrlKey && e.altKey && e.key === 't')        { e.preventDefault(); blockResolveActive('theirs'); }
    if (e.ctrlKey && e.altKey && e.key === 'b')        { e.preventDefault(); blockResolveActive('both'); }
  });

  // ── Navigation ────────────────────────────────────────────────────────────
  function navigate(d) {
    if (!state) return;
    const next = activeIdx + d;
    if (next >= 0 && next < state.totalConflicts) { setActive(next); scrollToConflict(next); }
  }

  function setActive(idx) {
    activeIdx = idx;
    document.querySelectorAll('.active-conflict').forEach(el => el.classList.remove('active-conflict'));
    document.querySelectorAll(`[data-ci="${idx}"]`).forEach(el => el.classList.add('active-conflict'));
    updateToolbar();
  }

  function scrollToConflict(idx) {
    const el = document.querySelector(`tr.row-action[data-ci="${idx}"]`);
    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── Resolution helpers ────────────────────────────────────────────────────

  /** Convert any resolution type → {yoursSelected[], theirsSelected[]} */
  function getLineState(ci) {
    if (!state) return { yoursSelected: [], theirsSelected: [] };
    const c   = state.conflicts[ci];
    const res = state.resolutions[ci] ?? { type: 'unresolved' };
    const nY  = c.yoursLines.length;
    const nT  = c.theirsLines.length;
    switch (res.type) {
      case 'yours':          return { yoursSelected: fill(nY, true),  theirsSelected: fill(nT, false) };
      case 'theirs':         return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, true)  };
      case 'both':           return { yoursSelected: fill(nY, true),  theirsSelected: fill(nT, true)  };
      case 'ignored':        return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, false) };
      case 'line-selection': return {
        yoursSelected:  res.yoursSelected  ?? fill(nY, false),
        theirsSelected: res.theirsSelected ?? fill(nT, false),
      };
      default:               return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, false) };
    }
  }

  /** Ordered list of result lines for a conflict */
  function getResultLines(ci) {
    if (!state) return [];
    const c  = state.conflicts[ci];
    const ls = getLineState(ci);
    const r  = [];
    c.yoursLines.forEach((line, i)  => { if (ls.yoursSelected[i])  r.push({ line, src: 'yours',  si: i }); });
    c.theirsLines.forEach((line, i) => { if (ls.theirsSelected[i]) r.push({ line, src: 'theirs', si: i }); });
    return r;
  }

  function isResolved(ci) { return state?.resolutions[ci]?.type !== 'unresolved'; }

  function fill(n, v) { return Array(n).fill(v); }

  // ── Line-level toggle (per-line >> / << button) ───────────────────────────

  function toggleLine(ci, source, li) {
    const ls = getLineState(ci);
    if (source === 'yours')  ls.yoursSelected[li]  = !ls.yoursSelected[li];
    else                     ls.theirsSelected[li]  = !ls.theirsSelected[li];
    applyLineState(ci, ls);
  }

  function removeResultLine(ci, src, si) {
    const ls = getLineState(ci);
    if (src === 'yours')  ls.yoursSelected[si]  = false;
    else                  ls.theirsSelected[si]  = false;
    applyLineState(ci, ls);
  }

  function applyLineState(ci, ls) {
    // Optimistic update so UI is instant
    state.resolutions[ci] = { type: 'line-selection', yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected };
    recomputeMeta();
    render(); updateToolbar();
    // Sync to extension (authoritative save)
    vscode.postMessage({ type: 'toggleLine', conflictIndex: ci, yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected });
  }

  // ── Block-level resolution (Accept All Yours / Theirs / Both / Skip) ──────

  function blockResolve(ci, type) {
    state.resolutions[ci] = { type };
    recomputeMeta();
    render(); updateToolbar();
    vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: type });
    // Auto-advance to next unresolved
    const next = findNextUnresolved(ci + 1) ?? findNextUnresolved(0);
    if (next !== null && next !== ci) { setTimeout(() => { setActive(next); scrollToConflict(next); }, 80); }
  }

  function blockResolveActive(type) { if (state) blockResolve(activeIdx, type); }

  function blockUndo(ci) {
    state.resolutions[ci] = { type: 'unresolved' };
    recomputeMeta();
    render(); updateToolbar();
    vscode.postMessage({ type: 'unresolve', conflictIndex: ci });
  }

  function findNextUnresolved(start) {
    if (!state) return null;
    for (let i = start; i < state.totalConflicts; i++) {
      if (state.resolutions[i]?.type === 'unresolved') return i;
    }
    return null;
  }

  function recomputeMeta() {
    state.resolvedCount   = state.resolutions.filter(r => r.type !== 'unresolved').length;
    state.progressPercent = state.totalConflicts > 0
      ? Math.round(state.resolvedCount / state.totalConflicts * 100) : 100;
    state.isFullyResolved = state.resolvedCount === state.totalConflicts;
  }

  // ── Toolbar update ────────────────────────────────────────────────────────
  function updateToolbar() {
    if (!state) return;
    const { totalConflicts, resolvedCount, progressPercent, isFullyResolved } = state;
    counter.textContent = `Conflict ${activeIdx + 1} / ${totalConflicts}  ·  ${resolvedCount} resolved`;
    progressFill.style.width = `${progressPercent}%`;
    progressLabel.textContent = `${progressPercent}%`;
    if (isFullyResolved) {
      statusMsg.textContent = 'All conflicts resolved ✓  —  click Apply to save';
      statusMsg.className = 'status-done';
    } else {
      statusMsg.textContent = `${totalConflicts - resolvedCount} conflict(s) remaining`;
      statusMsg.className = '';
    }
    statusFile.textContent = filePath.split(/[\\/]/).pop() ?? '';
  }

  // ── Rendering ─────────────────────────────────────────────────────────────
  function render() {
    if (!state) return;
    const frag = document.createDocumentFragment();
    let lineIdx = 0, lNum = 1;

    for (const c of state.conflicts) {
      while (lineIdx < c.startLine) { frag.appendChild(normalRow(state.lines[lineIdx], lNum++)); lineIdx++; }
      appendConflict(frag, c);
      lineIdx = c.endLine + 1;
    }
    while (lineIdx < state.lines.length) { frag.appendChild(normalRow(state.lines[lineIdx], lNum++)); lineIdx++; }

    mergeBody.innerHTML = '';
    mergeBody.appendChild(frag);
    wireButtons();
    // Restore active highlight without scrolling
    document.querySelectorAll(`[data-ci="${activeIdx}"]`).forEach(el => el.classList.add('active-conflict'));
  }

  // ── Normal (non-conflict) row ─────────────────────────────────────────────
  function normalRow(line, num) {
    const tr = mktr('row-normal');
    const t = esc(line);
    tr.innerHTML =
      `<td class="gu"><div class="gi"><span class="ln">${num}</span></div></td>` +
      `<td class="pa pl">${t}</td>` +
      `<td class="gu gc"></td>` +
      `<td class="pa pc">${t}</td>` +
      `<td class="gu"><div class="gi gi-r"><span class="ln">${num}</span></div></td>` +
      `<td class="pa pr">${t}</td>`;
    return tr;
  }

  // ── Conflict block ────────────────────────────────────────────────────────
  function appendConflict(frag, c) {
    const ci   = c.index;
    const ls   = getLineState(ci);
    const rl   = getResultLines(ci);
    const res  = isResolved(ci);
    frag.appendChild(actionRow(c, rl, res));
    const nRows = Math.max(c.yoursLines.length, c.theirsLines.length, rl.length, 1);
    for (let i = 0; i < nRows; i++) frag.appendChild(conflictRow(c, i, ls, rl, res));
  }

  // ── Conflict header / action row ──────────────────────────────────────────
  function actionRow(c, rl, resolved) {
    const ci = c.index;
    const tr = mktr('row-action', ci);

    const centerContent = resolved
      ? `<span class="cnum resolved-cnum">✓ Conflict ${ci + 1}</span>
         <div class="bbtns">
           <button class="abtn btn-undo"   data-ci="${ci}" data-action="undo">Undo</button>
         </div>`
      : `<span class="cnum">Conflict ${ci + 1}</span>
         <div class="bbtns">
           <button class="abtn btn-y"  data-ci="${ci}" data-action="blockYours"  title="Accept all yours (Ctrl+Alt+Y)">▶ Yours</button>
           <button class="abtn btn-t"  data-ci="${ci}" data-action="blockTheirs" title="Accept all theirs (Ctrl+Alt+T)">◀ Theirs</button>
           <button class="abtn btn-b"  data-ci="${ci}" data-action="blockBoth"   title="Accept both (Ctrl+Alt+B)">Both</button>
           <button class="abtn btn-sk" data-ci="${ci}" data-action="blockSkip">Skip</button>
         </div>`;

    tr.innerHTML =
      `<td class="gu action-gu yours-gu"></td>` +
      `<td class="pa pl action-pl"><div class="abar yours-abar"></div></td>` +
      `<td class="gu gc action-gu"></td>` +
      `<td class="pa pc action-pc"><div class="abar center-abar">${centerContent}</div></td>` +
      `<td class="gu action-gu theirs-gu"></td>` +
      `<td class="pa pr action-pr"><div class="abar theirs-abar"></div></td>`;
    return tr;
  }

  // ── Per-line conflict row ─────────────────────────────────────────────────
  function conflictRow(c, i, ls, rl, resolved) {
    const ci = c.index;
    const yL = c.yoursLines[i];
    const tL = c.theirsLines[i];
    const rL = rl[i]; // { line, src, si }
    const yS = ls.yoursSelected[i]  ?? false;
    const tS = ls.theirsSelected[i] ?? false;
    const tr = mktr('row-conflict', ci);

    // ── Left gutter: ▷ toggle button ──
    const lgHTML = yL !== undefined
      ? `<td class="gu gu-l${yS ? ' gu-yours-sel' : ' gu-yours'}">
           <div class="gi">
             <button class="lb${yS ? ' lb-on' : ''}" data-ci="${ci}" data-action="toggleYours" data-li="${i}"
               title="${yS ? 'Remove from result' : 'Add to result'}">▷</button>
             <span class="ln">${i + 1}</span>
           </div>
         </td>`
      : `<td class="gu gu-pad"></td>`;

    // ── Left content ──
    const lcHTML = yL !== undefined
      ? `<td class="pa pl${yS ? ' yours-sel' : ' yours-line'}" data-ci="${ci}">${esc(yL)}</td>`
      : `<td class="pa pl cpad" data-ci="${ci}"></td>`;

    // ── Center gutter: × button if result line present ──
    const cgHTML = rL
      ? `<td class="gu gc">
           <button class="xb" data-ci="${ci}" data-action="removeResult" data-src="${rL.src}" data-si="${rL.si}"
             title="Remove from result">×</button>
         </td>`
      : `<td class="gu gc"></td>`;

    // ── Center content: result line ──
    const ccHTML = rL
      ? `<td class="pa pc result-line result-${rL.src}" data-ci="${ci}">${esc(rL.line)}</td>`
      : `<td class="pa pc" data-ci="${ci}"></td>`;

    // ── Right gutter: ◁ toggle button ──
    const rgHTML = tL !== undefined
      ? `<td class="gu gu-r${tS ? ' gu-theirs-sel' : ' gu-theirs'}">
           <div class="gi gi-r">
             <span class="ln">${i + 1}</span>
             <button class="lb lb-r${tS ? ' lb-r-on' : ''}" data-ci="${ci}" data-action="toggleTheirs" data-li="${i}"
               title="${tS ? 'Remove from result' : 'Add to result'}">◁</button>
           </div>
         </td>`
      : `<td class="gu gu-pad"></td>`;

    // ── Right content ──
    const rcHTML = tL !== undefined
      ? `<td class="pa pr${tS ? ' theirs-sel' : ' theirs-line'}" data-ci="${ci}">${esc(tL)}</td>`
      : `<td class="pa pr cpad" data-ci="${ci}"></td>`;

    tr.innerHTML = lgHTML + lcHTML + cgHTML + ccHTML + rgHTML + rcHTML;
    return tr;
  }

  // ── Event wiring (delegated) ──────────────────────────────────────────────
  function wireButtons() {
    mergeBody.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const ci     = parseInt(/** @type {any} */(el).dataset['ci'], 10);
        const action = /** @type {any} */(el).dataset['action'];
        switch (action) {
          case 'toggleYours':  toggleLine(ci, 'yours',  parseInt(/** @type {any} */(el).dataset['li'],  10)); break;
          case 'toggleTheirs': toggleLine(ci, 'theirs', parseInt(/** @type {any} */(el).dataset['li'],  10)); break;
          case 'removeResult': removeResultLine(ci, /** @type {any} */(el).dataset['src'], parseInt(/** @type {any} */(el).dataset['si'], 10)); break;
          case 'blockYours':   blockResolve(ci, 'yours');   break;
          case 'blockTheirs':  blockResolve(ci, 'theirs');  break;
          case 'blockBoth':    blockResolve(ci, 'both');    break;
          case 'blockSkip':    blockResolve(ci, 'ignored'); break;
          case 'undo':         blockUndo(ci);               break;
        }
        setActive(ci);
      });
    });
  }

  // ── DOM helpers ───────────────────────────────────────────────────────────
  function mktr(cls, ci) {
    const tr = document.createElement('tr');
    tr.className = cls;
    if (ci !== undefined) tr.dataset['ci'] = String(ci);
    return tr;
  }

  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/\t/g, '    ');
  }

  // ── Message handler ───────────────────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'init') {
      filePath = msg.filePath ?? '';
      state = msg.state;
      // Show branch names but hide raw "HEAD"
      const yn = state.yoursBranchName;
      const tn = state.theirsBranchName;
      lblYours.textContent  = (!yn || yn === 'HEAD') ? 'Yours'   : yn;
      lblTheirs.textContent = (!tn || tn === 'HEAD') ? 'Theirs'  : tn;
      activeIdx = 0;
      render(); updateToolbar();
      requestAnimationFrame(() => scrollToConflict(0));
    } else if (msg.type === 'stateUpdate') {
      // Server confirmed state — only update if not already optimistically applied
      state = msg.state;
      render(); updateToolbar();
    } else if (msg.type === 'command') {
      handleCommand(msg.command);
    }
  });

  function handleCommand(cmd) {
    switch (cmd) {
      case 'acceptYours':      blockResolveActive('yours');  break;
      case 'acceptTheirs':     blockResolveActive('theirs'); break;
      case 'acceptBoth':       blockResolveActive('both');   break;
      case 'nextConflict':     navigate(+1);                 break;
      case 'previousConflict': navigate(-1);                 break;
    }
  }

  vscode.postMessage({ type: 'ready' });
})();

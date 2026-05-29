// @ts-check
'use strict';

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── State ──────────────────────────────────────────────────────────────────
  /** @type {any} */  let state = null;
  let activeIdx = 0;
  let filePath  = '';

  // Client-side only: rejected marks (visual, don't affect output)
  // { [ci]: { yours: boolean[], theirs: boolean[] } }
  const rejectedLines = {};

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
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
    if (e.altKey && e.key === 'ArrowUp')   { e.preventDefault(); navigate(-1); }
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

  // ── Rejected state helpers (client-side only) ─────────────────────────────
  function getRejected(ci) {
    if (!state) return { yours: [], theirs: [] };
    if (!rejectedLines[ci]) {
      const c = state.conflicts[ci];
      rejectedLines[ci] = {
        yours:  fill(c.yoursLines.length,  false),
        theirs: fill(c.theirsLines.length, false),
      };
    }
    return rejectedLines[ci];
  }

  // ── Resolution helpers ────────────────────────────────────────────────────
  function getLineState(ci) {
    if (!state) return { yoursSelected: [], theirsSelected: [], yoursBelow: [], theirsBelow: [] };
    const c   = state.conflicts[ci];
    const res = state.resolutions[ci] ?? { type: 'unresolved' };
    const nY  = c.yoursLines.length;
    const nT  = c.theirsLines.length;
    switch (res.type) {
      case 'yours':
        return { yoursSelected: fill(nY, true),  theirsSelected: fill(nT, false), yoursBelow: fill(nY, false), theirsBelow: fill(nT, false) };
      case 'theirs':
        return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, true),  yoursBelow: fill(nY, false), theirsBelow: fill(nT, false) };
      case 'both':
      case 'both-reversed':
        return { yoursSelected: fill(nY, true),  theirsSelected: fill(nT, true),  yoursBelow: fill(nY, false), theirsBelow: fill(nT, false) };
      case 'ignored':
        return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, false), yoursBelow: fill(nY, false), theirsBelow: fill(nT, false) };
      case 'line-selection':
        return {
          yoursSelected:  res.yoursSelected  ?? fill(nY, false),
          theirsSelected: res.theirsSelected ?? fill(nT, false),
          yoursBelow:     res.yoursBelow     ?? fill(nY, false),
          theirsBelow:    res.theirsBelow    ?? fill(nT, false),
        };
      default:
        return { yoursSelected: fill(nY, false), theirsSelected: fill(nT, false), yoursBelow: fill(nY, false), theirsBelow: fill(nT, false) };
    }
  }

  function getResultLines(ci) {
    if (!state) return [];
    const c  = state.conflicts[ci];
    const ls = getLineState(ci);
    const r  = [];
    c.yoursLines.forEach((line, i) => {
      if (ls.yoursSelected[i] && !ls.yoursBelow[i]) r.push({ line, src: 'yours', si: i, below: false });
    });
    c.theirsLines.forEach((line, i) => {
      if (ls.theirsSelected[i] && !ls.theirsBelow[i]) r.push({ line, src: 'theirs', si: i, below: false });
    });
    c.yoursLines.forEach((line, i) => {
      if (ls.yoursSelected[i] && ls.yoursBelow[i]) r.push({ line, src: 'yours', si: i, below: true });
    });
    c.theirsLines.forEach((line, i) => {
      if (ls.theirsSelected[i] && ls.theirsBelow[i]) r.push({ line, src: 'theirs', si: i, below: true });
    });
    return r;
  }

  function isResolved(ci) { return state?.resolutions[ci]?.type !== 'unresolved'; }
  function resType(ci)    { return state?.resolutions[ci]?.type ?? 'unresolved'; }
  function fill(n, v)     { return Array(n).fill(v); }

  // ── Per-line toggle inline (▷ / ◁) ────────────────────────────────────────
  function toggleLine(ci, source, li) {
    const ls = getLineState(ci);
    const rj = getRejected(ci);
    if (source === 'yours') {
      rj.yours[li] = false; // clear reject mark when adding
      if (ls.yoursSelected[li] && ls.yoursBelow[li]) {
        ls.yoursBelow[li] = false;          // was below → move inline
      } else if (ls.yoursSelected[li]) {
        ls.yoursSelected[li] = false;       // was inline → remove
        ls.yoursBelow[li]    = false;
      } else {
        ls.yoursSelected[li] = true;        // off → add inline
        ls.yoursBelow[li]    = false;
      }
    } else {
      rj.theirs[li] = false;
      if (ls.theirsSelected[li] && ls.theirsBelow[li]) {
        ls.theirsBelow[li] = false;
      } else if (ls.theirsSelected[li]) {
        ls.theirsSelected[li] = false;
        ls.theirsBelow[li]    = false;
      } else {
        ls.theirsSelected[li] = true;
        ls.theirsBelow[li]    = false;
      }
    }
    applyLineState(ci, ls);
  }

  // ── Per-line toggle below (▽) ─────────────────────────────────────────────
  function toggleBelow(ci, source, li) {
    const ls = getLineState(ci);
    const rj = getRejected(ci);
    if (source === 'yours') {
      rj.yours[li] = false;
      if (ls.yoursSelected[li] && ls.yoursBelow[li]) {
        ls.yoursSelected[li] = false; ls.yoursBelow[li] = false; // toggle off
      } else {
        ls.yoursSelected[li] = true; ls.yoursBelow[li] = true;   // add below
      }
    } else {
      rj.theirs[li] = false;
      if (ls.theirsSelected[li] && ls.theirsBelow[li]) {
        ls.theirsSelected[li] = false; ls.theirsBelow[li] = false;
      } else {
        ls.theirsSelected[li] = true; ls.theirsBelow[li] = true;
      }
    }
    applyLineState(ci, ls);
  }

  // ── Per-line reject (×) ────────────────────────────────────────────────────
  function rejectLine(ci, source, li) {
    const ls = getLineState(ci);
    const rj = getRejected(ci);
    if (source === 'yours') {
      // Remove from result if it was selected
      if (ls.yoursSelected[li]) {
        ls.yoursSelected[li] = false;
        ls.yoursBelow[li]    = false;
        state.resolutions[ci] = { type: 'line-selection', yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected, yoursBelow: ls.yoursBelow, theirsBelow: ls.theirsBelow };
        recomputeMeta();
        vscode.postMessage({ type: 'toggleLine', conflictIndex: ci, yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected, yoursBelow: ls.yoursBelow, theirsBelow: ls.theirsBelow });
      }
      rj.yours[li] = !rj.yours[li]; // toggle rejected mark
    } else {
      if (ls.theirsSelected[li]) {
        ls.theirsSelected[li] = false;
        ls.theirsBelow[li]    = false;
        state.resolutions[ci] = { type: 'line-selection', yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected, yoursBelow: ls.yoursBelow, theirsBelow: ls.theirsBelow };
        recomputeMeta();
        vscode.postMessage({ type: 'toggleLine', conflictIndex: ci, yoursSelected: ls.yoursSelected, theirsSelected: ls.theirsSelected, yoursBelow: ls.yoursBelow, theirsBelow: ls.theirsBelow });
      }
      rj.theirs[li] = !rj.theirs[li];
    }
    render(); updateToolbar();
  }

  // ── Remove result line (× in center gutter) ────────────────────────────────
  function removeResultLine(ci, src, si) {
    const ls = getLineState(ci);
    if (src === 'yours')  { ls.yoursSelected[si]  = false; ls.yoursBelow[si]  = false; }
    else                  { ls.theirsSelected[si] = false; ls.theirsBelow[si] = false; }
    applyLineState(ci, ls);
  }

  function applyLineState(ci, ls) {
    state.resolutions[ci] = {
      type: 'line-selection',
      yoursSelected:  ls.yoursSelected,
      theirsSelected: ls.theirsSelected,
      yoursBelow:     ls.yoursBelow,
      theirsBelow:    ls.theirsBelow,
    };
    recomputeMeta();
    render(); updateToolbar();
    vscode.postMessage({
      type: 'toggleLine',
      conflictIndex:  ci,
      yoursSelected:  ls.yoursSelected,
      theirsSelected: ls.theirsSelected,
      yoursBelow:     ls.yoursBelow,
      theirsBelow:    ls.theirsBelow,
    });
  }

  // ── Undo block resolution ─────────────────────────────────────────────────
  function blockUndo(ci) {
    state.resolutions[ci] = { type: 'unresolved' };
    recomputeMeta();
    render(); updateToolbar();
    vscode.postMessage({ type: 'unresolve', conflictIndex: ci });
  }

  function blockSkip(ci) {
    state.resolutions[ci] = { type: 'ignored' };
    recomputeMeta();
    render(); updateToolbar();
    vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'ignored' });
    const next = findNextUnresolved(ci + 1) ?? findNextUnresolved(0);
    if (next !== null && next !== ci) { setTimeout(() => { setActive(next); scrollToConflict(next); }, 80); }
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

  // ── Toolbar ────────────────────────────────────────────────────────────────
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
    document.querySelectorAll(`[data-ci="${activeIdx}"]`).forEach(el => el.classList.add('active-conflict'));
  }

  // ── Normal row ─────────────────────────────────────────────────────────────
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

  // ── Conflict block ─────────────────────────────────────────────────────────
  function appendConflict(frag, c) {
    const ci  = c.index;
    const ls  = getLineState(ci);
    const rl  = getResultLines(ci);
    const res = isResolved(ci);
    frag.appendChild(actionRow(c, res));
    const nRows = Math.max(c.yoursLines.length, c.theirsLines.length, rl.length, 1);
    for (let i = 0; i < nRows; i++) frag.appendChild(conflictRow(c, i, ls, rl, res));
  }

  // ── Action row (conflict header) — NO block buttons ────────────────────────
  function actionRow(c, resolved) {
    const ci  = c.index;
    const rt  = resType(ci);
    const tr  = mktr('row-action', ci);

    let centerContent;
    if (!resolved) {
      centerContent =
        `<span class="cnum">Conflict ${ci + 1}</span>
         <div class="bbtns">
           <button class="abtn btn-sk" data-ci="${ci}" data-action="skip" title="Skip this conflict">Skip</button>
         </div>`;
    } else {
      const labels = {
        'yours':          'Yours',
        'theirs':         'Theirs',
        'both':           'Yours + Theirs',
        'both-reversed':  'Theirs + Yours',
        'ignored':        'Skipped',
        'line-selection': 'Custom',
        'custom':         'Custom',
      };
      const label = labels[rt] ?? 'Resolved';
      centerContent =
        `<span class="cnum resolved-cnum">✓ ${ci + 1} <em class="res-label">${label}</em></span>
         <div class="bbtns">
           <button class="abtn btn-undo" data-ci="${ci}" data-action="undo">Undo</button>
         </div>`;
    }

    tr.innerHTML =
      `<td class="gu action-gu yours-gu"></td>` +
      `<td class="pa pl action-pl"><div class="abar yours-abar"></div></td>` +
      `<td class="gu gc action-gu"></td>` +
      `<td class="pa pc action-pc"><div class="abar center-abar">${centerContent}</div></td>` +
      `<td class="gu action-gu theirs-gu"></td>` +
      `<td class="pa pr action-pr"><div class="abar theirs-abar"></div></td>`;
    return tr;
  }

  // ── Per-line conflict row ──────────────────────────────────────────────────
  function conflictRow(c, i, ls, rl, resolved) {
    const ci   = c.index;
    const yL   = c.yoursLines[i];
    const tL   = c.theirsLines[i];
    const rL   = rl[i];
    const rj   = getRejected(ci);

    const yInline = ls.yoursSelected[i]  && !ls.yoursBelow[i];
    const yBelow  = ls.yoursSelected[i]  && ls.yoursBelow[i];
    const tInline = ls.theirsSelected[i] && !ls.theirsBelow[i];
    const tBelow  = ls.theirsSelected[i] && ls.theirsBelow[i];
    const yRej    = rj.yours[i]  ?? false;
    const tRej    = rj.theirs[i] ?? false;

    const tr = mktr('row-conflict', ci);

    // ── Left gutter: ▷ (inline) ▽ (below) × (reject) ──
    let lgHTML;
    if (yL !== undefined) {
      let guClass = 'gu gu-l';
      if      (yInline) guClass += ' gu-yours-sel';
      else if (yBelow)  guClass += ' gu-yours-below';
      else if (yRej)    guClass += ' gu-yours-rej';
      else              guClass += ' gu-yours';

      const inClass  = 'lb'          + (yInline ? ' lb-on'           : '');
      const dnClass  = 'lb lb-down'  + (yBelow  ? ' lb-down-on'      : '');
      const rejClass = 'lb lb-reject'+ (yRej    ? ' lb-reject-on'    : '');

      lgHTML = `<td class="${guClass}">
        <div class="gi">
          <div class="line-btns">
            <button class="${inClass}"  data-ci="${ci}" data-action="toggleYours"  data-li="${i}" title="${yInline ? 'Remove from result' : 'Add to result'}">▷</button>
            <button class="${dnClass}"  data-ci="${ci}" data-action="addBelowYours" data-li="${i}" title="${yBelow  ? 'Remove from end'  : 'Add at end of result'}">▽</button>
            <button class="${rejClass}" data-ci="${ci}" data-action="rejectYours"  data-li="${i}" title="${yRej    ? 'Clear rejection'   : 'Reject this line'}">✕</button>
          </div>
          <span class="ln">${i + 1}</span>
        </div>
      </td>`;
    } else {
      lgHTML = `<td class="gu gu-pad"></td>`;
    }

    // ── Left content ──
    let lcHTML;
    if (yL !== undefined) {
      let cls = 'pa pl';
      if      (yInline) cls += ' yours-sel';
      else if (yBelow)  cls += ' yours-below';
      else if (yRej)    cls += ' yours-rej';
      else              cls += ' yours-line';
      lcHTML = `<td class="${cls}" data-ci="${ci}">${esc(yL)}</td>`;
    } else {
      lcHTML = `<td class="pa pl cpad" data-ci="${ci}"></td>`;
    }

    // ── Center gutter ──
    let cgHTML;
    if (rL) {
      const xCls = 'xb' + (rL.below ? ' xb-below' : '');
      cgHTML = `<td class="gu gc">
        <button class="${xCls}" data-ci="${ci}" data-action="removeResult" data-src="${rL.src}" data-si="${rL.si}"
          title="Remove from result">×</button>
      </td>`;
    } else {
      cgHTML = `<td class="gu gc"></td>`;
    }

    // ── Center content ──
    let ccHTML;
    if (rL) {
      let cls = `pa pc result-line result-${rL.src}` + (rL.below ? ' result-below' : '');
      ccHTML = `<td class="${cls}" data-ci="${ci}">${esc(rL.line)}</td>`;
    } else {
      ccHTML = `<td class="pa pc" data-ci="${ci}"></td>`;
    }

    // ── Right gutter: × (reject) ▽ (below) ◁ (inline) ──
    let rgHTML;
    if (tL !== undefined) {
      let guClass = 'gu gu-r';
      if      (tInline) guClass += ' gu-theirs-sel';
      else if (tBelow)  guClass += ' gu-theirs-below';
      else if (tRej)    guClass += ' gu-theirs-rej';
      else              guClass += ' gu-theirs';

      const rejClass = 'lb lb-reject lb-reject-r' + (tRej    ? ' lb-reject-on'    : '');
      const dnClass  = 'lb lb-down lb-down-r'      + (tBelow  ? ' lb-down-r-on'    : '');
      const inClass  = 'lb lb-r'                   + (tInline ? ' lb-r-on'         : '');

      rgHTML = `<td class="${guClass}">
        <div class="gi gi-r">
          <span class="ln">${i + 1}</span>
          <div class="line-btns">
            <button class="${rejClass}" data-ci="${ci}" data-action="rejectTheirs"   data-li="${i}" title="${tRej   ? 'Clear rejection'   : 'Reject this line'}">✕</button>
            <button class="${dnClass}"  data-ci="${ci}" data-action="addBelowTheirs" data-li="${i}" title="${tBelow ? 'Remove from end'    : 'Add at end of result'}">▽</button>
            <button class="${inClass}"  data-ci="${ci}" data-action="toggleTheirs"   data-li="${i}" title="${tInline ? 'Remove from result' : 'Add to result'}">◁</button>
          </div>
        </div>
      </td>`;
    } else {
      rgHTML = `<td class="gu gu-pad"></td>`;
    }

    // ── Right content ──
    let rcHTML;
    if (tL !== undefined) {
      let cls = 'pa pr';
      if      (tInline) cls += ' theirs-sel';
      else if (tBelow)  cls += ' theirs-below';
      else if (tRej)    cls += ' theirs-rej';
      else              cls += ' theirs-line';
      rcHTML = `<td class="${cls}" data-ci="${ci}">${esc(tL)}</td>`;
    } else {
      rcHTML = `<td class="pa pr cpad" data-ci="${ci}"></td>`;
    }

    tr.innerHTML = lgHTML + lcHTML + cgHTML + ccHTML + rgHTML + rcHTML;
    return tr;
  }

  // ── Event wiring ──────────────────────────────────────────────────────────
  function wireButtons() {
    mergeBody.querySelectorAll('[data-action]').forEach(el => {
      el.addEventListener('click', e => {
        e.stopPropagation();
        const d      = /** @type {any} */(el).dataset;
        const ci     = parseInt(d['ci'], 10);
        const li     = parseInt(d['li'], 10);
        const action = d['action'];
        switch (action) {
          case 'toggleYours':    toggleLine(ci, 'yours',  li); break;
          case 'toggleTheirs':   toggleLine(ci, 'theirs', li); break;
          case 'addBelowYours':  toggleBelow(ci, 'yours',  li); break;
          case 'addBelowTheirs': toggleBelow(ci, 'theirs', li); break;
          case 'rejectYours':    rejectLine(ci, 'yours',  li); break;
          case 'rejectTheirs':   rejectLine(ci, 'theirs', li); break;
          case 'removeResult':   removeResultLine(ci, d['src'], parseInt(d['si'], 10)); break;
          case 'skip':           blockSkip(ci);  break;
          case 'undo':           blockUndo(ci);  break;
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
      const yn = state.yoursBranchName;
      const tn = state.theirsBranchName;
      lblYours.textContent  = (!yn || yn === 'HEAD') ? 'Yours'  : yn;
      lblTheirs.textContent = (!tn || tn === 'HEAD') ? 'Theirs' : tn;
      activeIdx = 0;
      render(); updateToolbar();
      requestAnimationFrame(() => scrollToConflict(0));
    } else if (msg.type === 'stateUpdate') {
      state = msg.state;
      render(); updateToolbar();
    } else if (msg.type === 'command') {
      handleCommand(msg.command);
    }
  });

  function handleCommand(cmd) {
    switch (cmd) {
      case 'nextConflict':     navigate(+1); break;
      case 'previousConflict': navigate(-1); break;
    }
  }

  vscode.postMessage({ type: 'ready' });
})();

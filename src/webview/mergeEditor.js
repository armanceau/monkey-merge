// @ts-check
'use strict';

(function () {
  // @ts-ignore
  const vscode = acquireVsCodeApi();

  // ── Constants ──────────────────────────────────────────────
  const LINE_H = 20; // must match --line-height: 20px in CSS

  // ── State ──────────────────────────────────────────────────
  /** @type {any} */       let rawState = null;
  /** @type {Array<any>}*/ let segments = [];
  let activeConflictIdx = 0;
  let isSyncing = false;

  // Per-conflict resolution: { type:'empty'|'accepted-left'|'accepted-right'|'both'|'manual', lines:string[] }
  /** @type {Record<number,{type:string,lines:string[]}>} */
  const localRes = {};

  // ── DOM refs ───────────────────────────────────────────────
  const panelLeft    = /** @type {HTMLElement} */ (document.getElementById('panel-left'));
  const panelCenter  = /** @type {HTMLElement} */ (document.getElementById('panel-center'));
  const panelRight   = /** @type {HTMLElement} */ (document.getElementById('panel-right'));
  const contentLeft  = /** @type {HTMLElement} */ (document.getElementById('content-left'));
  const contentCenter= /** @type {HTMLElement} */ (document.getElementById('content-center'));
  const contentRight = /** @type {HTMLElement} */ (document.getElementById('content-right'));
  const gutterLeft   = /** @type {HTMLElement} */ (document.getElementById('gutter-left'));
  const gutterRight  = /** @type {HTMLElement} */ (document.getElementById('gutter-right'));
  const canvasLeft   = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas-left'));
  const canvasRight  = /** @type {HTMLCanvasElement} */ (document.getElementById('canvas-right'));
  const counter      = /** @type {HTMLElement} */ (document.getElementById('conflict-counter'));
  const branchLeft   = /** @type {HTMLElement} */ (document.getElementById('branch-left'));
  const branchRight  = /** @type {HTMLElement} */ (document.getElementById('branch-right'));
  const statusEl     = /** @type {HTMLElement} */ (document.getElementById('status-conflicts'));
  const mergeBranch  = /** @type {HTMLElement} */ (document.getElementById('merge-branch'));

  // ── §15 Toolbar buttons ────────────────────────────────────
  document.getElementById('btn-prev').addEventListener('click', () => navigate(-1));
  document.getElementById('btn-next').addEventListener('click', () => navigate(+1));
  document.getElementById('btn-accept-left').addEventListener('click',  acceptAllLeft);
  document.getElementById('btn-accept-right').addEventListener('click', acceptAllRight);
  document.getElementById('btn-cancel').addEventListener('click', () => vscode.postMessage({ type: 'abort' }));
  document.getElementById('btn-apply').addEventListener('click',  () => vscode.postMessage({ type: 'apply' }));
  document.getElementById('btn-apply-left').addEventListener('click',  acceptAllLeft);
  document.getElementById('btn-apply-right').addEventListener('click', acceptAllRight);
  document.getElementById('btn-apply-all').addEventListener('click',   () => { acceptAllLeft(); acceptAllRight(); });

  document.addEventListener('keydown', e => {
    if (e.altKey && e.key === 'ArrowDown') { e.preventDefault(); navigate(+1); }
    if (e.altKey && e.key === 'ArrowUp')   { e.preventDefault(); navigate(-1); }
  });

  // ── §14 Scroll sync ─────────────────────────────────────────
  function setupScrollSync() {
    const panels = [panelLeft, panelCenter, panelRight];
    panels.forEach(src => {
      src.addEventListener('scroll', () => {
        if (isSyncing) return;
        isSyncing = true;
        const top = src.scrollTop;
        panels.forEach(dst => { if (dst !== src) dst.scrollTop = top; });
        isSyncing = false;
        requestAnimationFrame(refreshGutter);
      });
    });
  }

  function refreshGutter() {
    updateGutterButtons();
    drawConnections();
    updateCursorIndicator();
  }

  // ── Gutter event delegation — set up ONCE, never re-attached ─
  function setupGutterDelegation() {
    gutterLeft.addEventListener('click', e => {
      const btn = /** @type {HTMLElement} */ (e.target);
      const action = btn.dataset['action'];
      if (!action) return;
      e.stopPropagation();
      const ci = parseInt(btn.dataset['ci'], 10);
      dispatchAction(action, ci);
    });

    gutterRight.addEventListener('click', e => {
      const btn = /** @type {HTMLElement} */ (e.target);
      const action = btn.dataset['action'];
      if (!action) return;
      e.stopPropagation();
      const ci = parseInt(btn.dataset['ci'], 10);
      dispatchAction(action, ci);
    });
  }

  function dispatchAction(action, ci) {
    switch (action) {
      case 'accept-left':  acceptLeft(ci);     break;
      case 'accept-right': acceptRight(ci);    break;
      case 'reject':       rejectConflict(ci); break;
    }
    // setActive est déjà appelé dans applyResolution — pas de double appel
  }

  // ── Message handler ─────────────────────────────────────────
  window.addEventListener('message', ev => {
    const msg = ev.data;
    if (msg.type === 'init') {
      rawState = msg.state;
      const yn = rawState.yoursBranchName;
      const tn = rawState.theirsBranchName;
      branchLeft.textContent  = (!yn || yn === 'HEAD') ? 'yours'  : yn;
      branchRight.textContent = (!tn || tn === 'HEAD') ? 'theirs' : tn;
      if (mergeBranch) mergeBranch.textContent = `▲ Merging ${yn || ''}`;
      syncResFromState();   // une seule fois, à l'init
      buildSegments();
      renderAll();
      updateUI();
      setupScrollSync();
      setupGutterDelegation();
      requestAnimationFrame(() => scrollToConflict(0));
    } else if (msg.type === 'stateUpdate') {
      // On met à jour rawState (pour Apply/save) mais on ne re-rend pas :
      // les résolutions locales font autorité et ont déjà été appliquées.
      rawState = msg.state;
      updateUI();
    } else if (msg.type === 'command') {
      if (msg.command === 'nextConflict')     navigate(+1);
      if (msg.command === 'previousConflict') navigate(-1);
    }
  });

  // ── Sync extension resolutions into localRes ───────────────
  function syncResFromState() {
    if (!rawState) return;
    rawState.resolutions.forEach((res, ci) => {
      if (localRes[ci] && localRes[ci].type !== 'empty') return; // keep local decision
      const c = rawState.conflicts[ci];
      switch (res.type) {
        case 'yours':
          localRes[ci] = { type: 'accepted-left',  lines: [...c.yoursLines] };
          break;
        case 'theirs':
          localRes[ci] = { type: 'accepted-right', lines: [...c.theirsLines] };
          break;
        case 'both':
          localRes[ci] = { type: 'both', lines: [...c.yoursLines, ...c.theirsLines] };
          break;
        case 'both-reversed':
          localRes[ci] = { type: 'both', lines: [...c.theirsLines, ...c.yoursLines] };
          break;
        default:
          if (!localRes[ci]) localRes[ci] = { type: 'empty', lines: [] };
          break;
      }
    });
  }

  // ── Build aligned segments ──────────────────────────────────
  // La hauteur de chaque bloc = max(yours, theirs, resolvedLines, 1) * LINE_H
  // Ainsi, quand on accepte les deux côtés, le bloc grandit et décale le code en dessous.
  function buildSegments() {
    if (!rawState) return;
    segments = [];
    let lineIdx = 0, leftNum = 1, rightNum = 1;

    for (const c of rawState.conflicts) {
      if (c.startLine > lineIdx) {
        const lines = rawState.lines.slice(lineIdx, c.startLine);
        segments.push({ type: 'normal', lines, leftNum, rightNum });
        leftNum  += lines.length;
        rightNum += lines.length;
        lineIdx   = c.startLine;
      }
      // La hauteur tient compte des lignes résolues pour que le résultat puisse
      // grandir au-delà du max(yours, theirs) d'origine.
      const resolvedCount = (localRes[c.index]?.lines ?? []).length;
      const h = Math.max(c.yoursLines.length, c.theirsLines.length, resolvedCount, 1) * LINE_H;
      segments.push({ type: 'conflict', conflict: c, h, leftNum, rightNum });
      leftNum  += c.yoursLines.length;
      rightNum += c.theirsLines.length;
      lineIdx   = c.endLine + 1;
    }
    if (lineIdx < rawState.lines.length) {
      segments.push({ type: 'normal', lines: rawState.lines.slice(lineIdx), leftNum, rightNum });
    }
  }

  // ── Render all three panels ──────────────────────────────────
  function renderAll() {
    if (!rawState) return;

    const fL = document.createDocumentFragment();
    const fC = document.createDocumentFragment();
    const fR = document.createDocumentFragment();

    for (const seg of segments) {
      if (seg.type === 'normal') {
        renderNormal(fL, fC, fR, seg);
      } else {
        renderConflict(fL, fC, fR, seg);
      }
    }

    contentLeft.innerHTML   = '';
    contentCenter.innerHTML = '';
    contentRight.innerHTML  = '';
    contentLeft.appendChild(fL);
    contentCenter.appendChild(fC);
    contentRight.appendChild(fR);

    requestAnimationFrame(refreshGutter);
  }

  // ── Normal lines ─────────────────────────────────────────────
  function renderNormal(fL, fC, fR, seg) {
    seg.lines.forEach((line, i) => {
      const lN = seg.leftNum  + i;
      const rN = seg.rightNum + i;
      const t  = esc(line);
      fL.appendChild(mkRow(`<span class="ln">${lN}</span><span class="line-content">${t}</span>`, 'normal-line'));
      fC.appendChild(mkRow(`<span class="ln">${lN}</span><span class="ln">${rN}</span><span class="line-content">${t}</span>`, 'normal-line'));
      fR.appendChild(mkRow(`<span class="ln">${rN}</span><span class="line-content">${t}</span>`, 'normal-line'));
    });
  }

  function mkRow(inner, cls) {
    const d = document.createElement('div');
    d.className = 'line-row' + (cls ? ' ' + cls : '');
    d.innerHTML = inner;
    return d;
  }

  // ── Conflict blocks ──────────────────────────────────────────
  // seg.h = max(yours, theirs, resolved, 1) * LINE_H   (calculé dans buildSegments)
  // Les 3 blocs utilisent tous cette même hauteur → alignement parfait même si
  // le résultat a plus de lignes que la version d'origine.
  function renderConflict(fL, fC, fR, seg) {
    const c   = seg.conflict;
    const ci  = c.index;
    const h   = seg.h;
    const res = localRes[ci] ?? { type: 'empty', lines: [] };

    // ── LEFT (lecture seule) ─────────────────────────────────
    const bL = mkBlock('conflict-block-left', ci, h);
    c.yoursLines.forEach((line, i) => {
      bL.appendChild(mkRow(
        `<span class="ln">${seg.leftNum + i}</span><span class="line-content">${esc(line)}</span>`
      ));
    });
    padBlock(bL, c.yoursLines.length, h);   // lignes vides si yours < h
    fL.appendChild(bL);

    // ── CENTER (résultat, hauteur dynamique) ─────────────────
    const wrap = mkBlock('conflict-center-wrap', ci, h);
    wrap.style.maxHeight = h + 'px';
    if (res.type !== 'empty') wrap.classList.add('resolved');
    const bC = document.createElement('div');
    bC.className = 'conflict-block-center' + (res.type !== 'empty' ? ' resolved' : '');
    bC.style.minHeight = h + 'px';
    if (res.type !== 'empty') {
      res.lines.forEach((line, i) => {
        bC.appendChild(mkRow(
          `<span class="ln">${seg.leftNum + i}</span>` +
          `<span class="ln">${seg.rightNum + i}</span>` +
          `<span class="line-content">${esc(line)}</span>`
        ));
      });
    }
    wrap.appendChild(bC);
    fC.appendChild(wrap);

    // ── RIGHT (lecture seule) ────────────────────────────────
    const bR = mkBlock('conflict-block-right', ci, h);
    c.theirsLines.forEach((line, i) => {
      bR.appendChild(mkRow(
        `<span class="ln">${seg.rightNum + i}</span><span class="line-content">${esc(line)}</span>`
      ));
    });
    padBlock(bR, c.theirsLines.length, h);   // lignes vides si theirs < h
    fR.appendChild(bR);
  }

  function mkBlock(cls, ci, h) {
    const d = document.createElement('div');
    d.className = 'conflict-block ' + cls;
    d.dataset['ci'] = String(ci);
    d.style.height = h + 'px';
    return d;
  }

  function padBlock(el, usedLines, totalH) {
    for (let y = usedLines * LINE_H; y < totalH; y += LINE_H) {
      const p = document.createElement('div');
      p.className = 'line-row';
      p.style.height = LINE_H + 'px';
      el.appendChild(p);
    }
  }

  // ── §15 Actions ──────────────────────────────────────────────
  // Chaque action recalcule la hauteur des blocs (buildSegments) et re-rend
  // les 3 panneaux (renderAll) pour que le code en dessous se décale correctement.

  function acceptLeft(ci) {
    if (!rawState) return;
    const c   = rawState.conflicts[ci];
    const cur = localRes[ci];
    if (cur && cur.type === 'accepted-right') {
      localRes[ci] = { type: 'both', lines: [...c.yoursLines, ...c.theirsLines] };
      vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'both' });
    } else {
      localRes[ci] = { type: 'accepted-left', lines: [...c.yoursLines] };
      vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'yours' });
    }
    applyResolution(ci);
  }

  function acceptRight(ci) {
    if (!rawState) return;
    const c   = rawState.conflicts[ci];
    const cur = localRes[ci];
    if (cur && cur.type === 'accepted-left') {
      localRes[ci] = { type: 'both', lines: [...c.yoursLines, ...c.theirsLines] };
      vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'both' });
    } else {
      localRes[ci] = { type: 'accepted-right', lines: [...c.theirsLines] };
      vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'theirs' });
    }
    applyResolution(ci);
  }

  function rejectConflict(ci) {
    localRes[ci] = { type: 'empty', lines: [] };
    vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'ignored' });
    applyResolution(ci);
  }

  // Recalcule les hauteurs et re-rend tout — le code en dessous se décale automatiquement.
  function applyResolution(ci) {
    buildSegments();   // hauteurs recalculées avec resolvedCount
    renderAll();       // 3 panneaux re-rendus avec les nouvelles hauteurs
    updateUI();
    setActive(ci);
  }

  function acceptAllLeft() {
    if (!rawState) return;
    rawState.conflicts.forEach(c => {
      if (!localRes[c.index] || localRes[c.index].type === 'empty') {
        const ci = c.index;
        localRes[ci] = { type: 'accepted-left', lines: [...c.yoursLines] };
        vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'yours' });
      }
    });
    buildSegments(); renderAll(); updateUI();
  }

  function acceptAllRight() {
    if (!rawState) return;
    rawState.conflicts.forEach(c => {
      if (!localRes[c.index] || localRes[c.index].type === 'empty') {
        const ci = c.index;
        localRes[ci] = { type: 'accepted-right', lines: [...c.theirsLines] };
        vscode.postMessage({ type: 'resolve', conflictIndex: ci, resolutionType: 'theirs' });
      }
    });
    buildSegments(); renderAll(); updateUI();
  }

  // ── Navigation ───────────────────────────────────────────────
  function navigate(d) {
    if (!rawState) return;
    const next = activeConflictIdx + d;
    if (next >= 0 && next < rawState.totalConflicts) {
      setActive(next);
      scrollToConflict(next);
    }
  }

  function setActive(idx) {
    activeConflictIdx = idx;
    document.querySelectorAll('.conflict-active').forEach(el => el.classList.remove('conflict-active'));
    contentLeft.querySelector(`.conflict-block[data-ci="${idx}"]`)?.classList.add('conflict-active');
    contentCenter.querySelector(`.conflict-center-wrap[data-ci="${idx}"]`)?.classList.add('conflict-active');
    contentRight.querySelector(`.conflict-block[data-ci="${idx}"]`)?.classList.add('conflict-active');
    updateUI();
    requestAnimationFrame(() => { updateGutterButtons(); updateCursorIndicator(); });
  }

  function scrollToConflict(idx) {
    const b = contentLeft.querySelector(`.conflict-block[data-ci="${idx}"]`);
    if (b) b.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  // ── §6/§7 Gutter buttons — pure DOM, no listeners (delegation handles clicks) ─
  function updateGutterButtons() {
    gutterLeft.querySelectorAll('.gutter-actions').forEach(el => el.remove());
    gutterRight.querySelectorAll('.gutter-actions').forEach(el => el.remove());
    if (!rawState) return;

    const gLRect = gutterLeft.getBoundingClientRect();
    const gRRect = gutterRight.getBoundingClientRect();
    if (gLRect.height === 0) return;

    rawState.conflicts.forEach(c => {
      const ci = c.index;
      const bL = contentLeft.querySelector(`.conflict-block[data-ci="${ci}"]`);
      const bR = contentRight.querySelector(`.conflict-block[data-ci="${ci}"]`);
      const bC = contentCenter.querySelector(`.conflict-center-wrap[data-ci="${ci}"]`);
      if (!bL) return;

      const rL = bL.getBoundingClientRect();
      const rC = bC ? bC.getBoundingClientRect() : rL;
      const rR = bR ? bR.getBoundingClientRect() : rL;

      const midL = (rL.top + rL.bottom) / 2 - gLRect.top;
      const midR = (rC.top + rC.bottom) / 2 - gRRect.top;

      // Only render if at least partially visible
      if (rL.bottom - gLRect.top < 0 || rL.top - gLRect.top > gLRect.height) return;

      // Left gutter: [×] then [»]
      const grpL = document.createElement('div');
      grpL.className = 'gutter-actions';
      grpL.style.top = `${midL - 20}px`;
      grpL.innerHTML =
        `<button class="g-btn g-btn-reject"      data-ci="${ci}" data-action="reject"       title="Reject">×</button>` +
        `<button class="g-btn g-btn-accept-left" data-ci="${ci}" data-action="accept-left"  title="Accept Left">»</button>`;
      gutterLeft.appendChild(grpL);

      // Right gutter: [«] then [×]
      if (rR.bottom - gRRect.top >= 0 && rR.top - gRRect.top <= gRRect.height) {
        const grpR = document.createElement('div');
        grpR.className = 'gutter-actions';
        grpR.style.top = `${midR - 20}px`;
        grpR.innerHTML =
          `<button class="g-btn g-btn-accept-right" data-ci="${ci}" data-action="accept-right" title="Accept Right">«</button>` +
          `<button class="g-btn g-btn-reject"        data-ci="${ci}" data-action="reject"        title="Reject">×</button>`;
        gutterRight.appendChild(grpR);
      }
    });
  }

  // ── Cursor indicator ▶ ───────────────────────────────────────
  function updateCursorIndicator() {
    gutterLeft.querySelectorAll('.cursor-ind').forEach(el => el.remove());
    if (!rawState) return;
    const bL = contentLeft.querySelector(`.conflict-block[data-ci="${activeConflictIdx}"]`);
    if (!bL) return;
    const gRect = gutterLeft.getBoundingClientRect();
    const bRect = bL.getBoundingClientRect();
    const top   = (bRect.top + bRect.bottom) / 2 - gRect.top;
    const ind   = document.createElement('div');
    ind.className = 'cursor-ind';
    ind.style.top = `${top}px`;
    gutterLeft.appendChild(ind);
  }

  // ── §8 Canvas connections (trapeze) ─────────────────────────
  function drawConnections() {
    if (!rawState) return;
    drawCanvas(canvasLeft,  gutterLeft,  'left');
    drawCanvas(canvasRight, gutterRight, 'right');
  }

  function drawCanvas(canvas, gutter, side) {
    const gRect = gutter.getBoundingClientRect();
    const W = Math.round(gRect.width);
    const H = Math.round(gRect.height);
    if (W === 0 || H === 0) return;

    canvas.width  = W;
    canvas.height = H;
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);

    rawState.conflicts.forEach(c => {
      const ci = c.index;
      const srcEl = side === 'left'
        ? contentLeft.querySelector(`.conflict-block[data-ci="${ci}"]`)
        : contentCenter.querySelector(`.conflict-center-wrap[data-ci="${ci}"]`);
      const dstEl = side === 'left'
        ? contentCenter.querySelector(`.conflict-center-wrap[data-ci="${ci}"]`)
        : contentRight.querySelector(`.conflict-block[data-ci="${ci}"]`);
      if (!srcEl || !dstEl) return;

      const rS = srcEl.getBoundingClientRect();
      const rD = dstEl.getBoundingClientRect();
      const sT = rS.top    - gRect.top;
      const sB = rS.bottom - gRect.top;
      const dT = rD.top    - gRect.top;
      const dB = rD.bottom - gRect.top;

      const fill   = side === 'left' ? 'rgba(133,74,50,0.15)'  : 'rgba(50,80,130,0.15)';
      const stroke = side === 'left' ? '#855a3a' : '#4a6fa5';
      drawTrapeze(ctx, W, sT, sB, dT, dB, fill, stroke, side);
    });
  }

  function drawTrapeze(ctx, W, sT, sB, dT, dB, fill, stroke, side) {
    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(0, sT); ctx.lineTo(W, dT);
      ctx.lineTo(W, dB); ctx.lineTo(0, sB);
    } else {
      ctx.moveTo(0, dT); ctx.lineTo(W, sT);
      ctx.lineTo(W, sB); ctx.lineTo(0, dB);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.strokeStyle = stroke;
    ctx.lineWidth   = 1;
    ctx.beginPath();
    if (side === 'left') {
      ctx.moveTo(0, sT); ctx.lineTo(W, dT);
      ctx.moveTo(0, sB); ctx.lineTo(W, dB);
    } else {
      ctx.moveTo(0, dT); ctx.lineTo(W, sT);
      ctx.moveTo(0, dB); ctx.lineTo(W, sB);
    }
    ctx.stroke();
  }

  // ── UI counter + status ──────────────────────────────────────
  function updateUI() {
    if (!rawState) return;
    const total    = rawState.totalConflicts;
    const resolved = Object.values(localRes).filter(r => r.type !== 'empty').length;
    const remaining = total - resolved;
    counter.textContent = `${activeConflictIdx + 1} / ${total}`;
    if (remaining === 0) {
      statusEl.textContent = 'All conflicts resolved ✓';
    } else {
      statusEl.innerHTML =
        `${remaining} unresolved conflict${remaining > 1 ? 's' : ''} // ` +
        `<a href="#" id="status-resolve">Resolve...</a>`;
    }
  }

  // ── Escape HTML ──────────────────────────────────────────────
  function esc(s) {
    if (s == null) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;')
      .replace(/>/g, '&gt;').replace(/"/g, '&quot;')
      .replace(/\t/g, '    ');
  }

  // ── Resize ───────────────────────────────────────────────────
  window.addEventListener('resize', () => requestAnimationFrame(refreshGutter));

  // ── Ready ────────────────────────────────────────────────────
  vscode.postMessage({ type: 'ready' });
})();

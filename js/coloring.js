// Экран раскраски по номерам: кисть красит только области выбранного номера,
// от 90 % область засчитывается (цифра исчезает, остаток докрашивается), подсказка, масштаб, отмена, сохранение.
import * as db from './db.js';
import { decodeMap, luminance } from './pbn.js';
import { icon } from './icons.js';
import { h, esc, toast, sheet, dialog, confirmDialog, saveFile } from './ui.js';

const DONE_AT = 0.9;
const MAX_ZOOM = 8;
const PEN_GUARD_MS = 350;
const PAPER = '#FFFBF6';

export async function loadPicture(id, level) {
  const base = `data/${id}-${level}`;
  const [meta, bin] = await Promise.all([
    fetch(base + '.json').then((r) => { if (!r.ok) throw new Error('нет данных картинки'); return r.json(); }),
    fetch(base + '.bin').then((r) => { if (!r.ok) throw new Error('нет карты картинки'); return r.arrayBuffer(); }),
  ]);
  meta.map = decodeMap(new Uint16Array(bin), meta.w * meta.h);
  return meta;
}

export async function openColoring(root, { id, level, info }, { onBack, settings }) {
  root.innerHTML = '<div class="loading">Раскладываю краски…</div>';
  let pic;
  try { pic = await loadPicture(id, level); } catch (e) { toast('Не получилось открыть картинку: ' + e.message); onBack(); return () => {}; }
  const { w: W, h: H, map, regions, palette } = pic;
  const key = `${id}:${level}`;
  const saved = await db.get('coloring', key);

  // ---------- разметка ----------
  root.innerHTML = '';
  const screen = h('div', { class: 'nb-screen color-screen' });
  const top = h('header', { class: 'nb-top' });
  const btnBack = h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'К раскраскам' }, `${icon('back')}<span class="hide-narrow">Раскраски</span>`);
  const title = h('div', { class: 'nb-title' }, `<div class="nb-name">${esc(info.title)}</div>`);
  const prog = h('div', { class: 'pager progress-pill', 'aria-live': 'polite' });
  title.append(prog);
  const actions = h('div', { class: 'nb-actions' });
  const btnUndo = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Отменить' }, icon('undo'));
  const btnRedo = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Повторить' }, icon('redo'));
  const btnHint = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Подсказка: где этот номер', 'aria-pressed': 'false' }, icon('bulb'));
  const btnExport = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Сохранить как PNG' }, icon('share'));
  const btnMore = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ещё' }, icon('more'));
  actions.append(btnUndo, btnRedo, btnHint, btnExport, btnMore);
  top.append(btnBack, title, actions);

  const vp = h('div', { class: 'nb-viewport', 'aria-label': 'Картина для раскрашивания' });
  const stage = h('div', { class: 'nb-stage' });
  const picEl = h('div', { class: 'cl-pic', style: `width:${W}px;height:${H}px` });
  const paintCv = h('canvas', { class: 'cl-layer', width: W, height: H });
  const hintCv = h('canvas', { class: 'cl-layer cl-hint', width: W, height: H, hidden: true });
  const lineCv = h('canvas', { class: 'cl-layer', width: W, height: H });
  picEl.append(paintCv, hintCv, lineCv);
  stage.append(picEl);
  const numCv = h('canvas', { class: 'cl-numbers' });
  vp.append(stage, numCv);

  const dock = h('div', { class: 'dock cl-dock', role: 'toolbar', 'aria-label': 'Краски' });
  const chips = h('div', { class: 'cl-chips', role: 'radiogroup', 'aria-label': 'Номера красок' });
  const toolBox = h('div', { class: 'cl-tools' });
  const btnBrush = h('button', { class: 'tool-btn on', type: 'button', 'aria-label': 'Кисть' }, `${icon('brush', 24)}<span>Кисть</span>`);
  const btnErase = h('button', { class: 'tool-btn', type: 'button', 'aria-label': 'Ластик' }, `${icon('eraser', 24)}<span>Ластик</span>`);
  const sizeBox = h('label', { class: 'dock-size' });
  const sizeDot = h('span', { class: 'size-dot', 'aria-hidden': 'true' });
  const range = h('input', { type: 'range', min: 8, max: 70, 'aria-label': 'Размер кисти' });
  sizeBox.append(sizeDot, range);
  toolBox.append(btnBrush, btnErase, sizeBox);
  dock.append(chips, h('span', { class: 'dock-sep' }), toolBox);
  screen.append(top, vp, dock);
  root.append(screen);

  const paint = paintCv.getContext('2d', { willReadFrequently: true });
  const hintCtx = hintCv.getContext('2d');
  const lineCtx = lineCv.getContext('2d');
  const numCtx = numCv.getContext('2d');

  // ---------- подготовка ----------
  const nReg = regions.length;
  const areaOf = new Int32Array(nReg);
  regions.forEach((r, i) => { areaOf[i] = r.a; });
  const filled = new Uint8Array(W * H);     // точка закрашена (непрозрачная краска)
  const count = new Int32Array(nReg);       // закрашенных точек в области
  const done = new Uint8Array(nReg);
  const rgb = palette.map((p) => { const n = parseInt(p.hex.slice(1), 16); return [(n >> 16) & 255, (n >> 8) & 255, n & 255]; });
  const regionsOfColor = palette.map(() => []);
  regions.forEach((r, i) => regionsOfColor[r.c].push(i));

  // контуры: граница между разными областями
  {
    const img = lineCtx.createImageData(W, H);
    const d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, r = map[p];
      if ((x < W - 1 && map[p + 1] !== r) || (y < H - 1 && map[p + W] !== r)) {
        const o = p * 4; d[o] = 96; d[o + 1] = 78; d[o + 2] = 86; d[o + 3] = 150;
      }
    }
    lineCtx.putImageData(img, 0, 0);
  }

  if (saved && saved.paint) {
    try {
      // прогресс хранится байтами PNG: Blob в IndexedDB Safari сохраняет не всегда (например, в приватном режиме)
      const blob = saved.paint instanceof Blob ? saved.paint : new Blob([saved.paint], { type: 'image/png' });
      const bmp = await createImageBitmap(blob);
      paint.drawImage(bmp, 0, 0);
    } catch { /* картинка прогресса не прочиталась — начнём с чистой */ }
  }
  recount(0, 0, W, H);

  // ---------- состояние ----------
  let sel = Math.max(0, palette.findIndex((_, c) => !colorDone(c)));
  let tool = 'brush';
  let brushPt = settings.brushPt || 26;   // размер кисти в точках экрана: при увеличении кисть тоньше
  let hintOn = false;
  const view = { s: 1, tx: 0, ty: 0, fit: 1 };
  const history = [], future = [];

  function colorDone(c) { return regionsOfColor[c].every((r) => done[r]); }

  // ---------- маска выбранного номера ----------
  const maskCache = new Map();
  function maskFor(c) {
    if (maskCache.has(c)) return maskCache.get(c);
    const cv = document.createElement('canvas'); cv.width = W; cv.height = H;
    const g = cv.getContext('2d');
    const img = g.createImageData(W, H), d = img.data;
    const [r, gg, b] = rgb[c];
    for (let i = 0; i < map.length; i++) if (regions[map[i]].c === c) { const o = i * 4; d[o] = r; d[o + 1] = gg; d[o + 2] = b; d[o + 3] = 255; }
    g.putImageData(img, 0, 0);
    maskCache.set(c, cv);
    if (maskCache.size > 3) maskCache.delete(maskCache.keys().next().value);
    return cv;
  }

  function renderHint() {
    hintCtx.clearRect(0, 0, W, H);
    if (!hintOn) { hintCv.hidden = true; return; }
    const img = hintCtx.createImageData(W, H), d = img.data;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const i = y * W + x, r = map[i];
      if (regions[r].c !== sel || done[r]) continue;
      const o = i * 4;
      const stripe = ((x + y) >> 3) & 1; // мягкая диагональная штриховка
      d[o] = 169; d[o + 1] = 86; d[o + 2] = 111; d[o + 3] = stripe ? 70 : 28;
    }
    hintCtx.putImageData(img, 0, 0);
    hintCv.hidden = false;
  }

  // ---------- подсчёт закрашенного ----------
  function recount(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 <= x0 || y1 <= y0) return [];
    const d = paint.getImageData(x0, y0, x1 - x0, y1 - y0).data;
    const touched = new Set();
    for (let y = y0, k = 3; y < y1; y++) for (let x = x0; x < x1; x++, k += 4) {
      const i = y * W + x;
      const f = d[k] > 128 ? 1 : 0;
      if (f !== filled[i]) { filled[i] = f; const r = map[i]; count[r] += f ? 1 : -1; touched.add(map[i]); }
    }
    const changed = [];
    for (let r = 0; r < nReg; r++) {
      if (!touched.has(r) && !(x0 === 0 && y0 === 0 && x1 === W && y1 === H)) continue;
      const nd = count[r] >= areaOf[r] * DONE_AT ? 1 : 0;
      if (nd !== done[r]) { done[r] = nd; changed.push(r); }
    }
    return changed;
  }

  // докрасить область целиком, когда она засчитана
  function fillRegion(r) {
    const [bx0, by0, bx1, by1] = regions[r].b;
    const w = bx1 - bx0 + 1, hh = by1 - by0 + 1;
    const img = paint.getImageData(bx0, by0, w, hh), d = img.data;
    const [cr, cg, cb] = rgb[regions[r].c];
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (by0 + y) * W + bx0 + x;
      if (map[i] !== r) continue;
      const o = (y * w + x) * 4;
      d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255;
      if (!filled[i]) { filled[i] = 1; count[r]++; }
    }
    paint.putImageData(img, bx0, by0);
    return [bx0, by0, bx1 + 1, by1 + 1];
  }

  // ---------- вид ----------
  function applyView() {
    stage.style.transform = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    drawNumbers();
  }
  function availH() {
    const vr = vp.getBoundingClientRect(), dr = dock.getBoundingClientRect();
    return vp.clientHeight - Math.max(0, vr.bottom - dr.top);
  }
  function fitView() {
    const w = vp.clientWidth, avail = availH(), pad = 18;
    view.fit = Math.min((w - pad * 2) / W, (avail - pad * 2) / H);
    view.s = view.fit;
    view.tx = (w - W * view.s) / 2;
    view.ty = (avail - H * view.s) / 2;
    sizeNumbers();
    applyView();
  }
  function clampView() {
    const w = vp.clientWidth, hgt = vp.clientHeight, avail = availH(), m = 60;
    view.s = Math.min(Math.max(view.s, view.fit * 0.9), view.fit * MAX_ZOOM);
    const pw = W * view.s, ph = H * view.s;
    view.tx = pw + m * 2 <= w ? (w - pw) / 2 : Math.min(m, Math.max(w - pw - m, view.tx));
    view.ty = ph + m * 2 <= avail ? (avail - ph) / 2 : Math.min(m, Math.max(hgt - ph - m, view.ty));
    applyView();
  }
  function sizeNumbers() {
    const dpr = window.devicePixelRatio || 1;
    numCv.width = Math.round(vp.clientWidth * dpr);
    numCv.height = Math.round(vp.clientHeight * dpr);
    numCv.style.width = vp.clientWidth + 'px';
    numCv.style.height = vp.clientHeight + 'px';
  }
  const toPic = (cx, cy) => { const r = vp.getBoundingClientRect(); return { x: (cx - r.left - view.tx) / view.s, y: (cy - r.top - view.ty) / view.s }; };

  // цифры рисуются поверх картинки в разрешении экрана — всегда чёткие
  let rafNum = 0;
  function drawNumbers() {
    if (rafNum) return;
    rafNum = requestAnimationFrame(() => {
      rafNum = 0;
      const dpr = window.devicePixelRatio || 1;
      numCtx.setTransform(1, 0, 0, 1, 0, 0);
      numCtx.clearRect(0, 0, numCv.width, numCv.height);
      numCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
      numCtx.textAlign = 'center';
      numCtx.textBaseline = 'middle';
      const vw = vp.clientWidth, vh = vp.clientHeight;
      for (let r = 0; r < nReg; r++) {
        if (done[r]) continue;
        const g = regions[r];
        const sx = view.tx + (g.x + 0.5) * view.s, sy = view.ty + (g.y + 0.5) * view.s;
        if (sx < -20 || sy < -20 || sx > vw + 20 || sy > vh + 20) continue;
        const fs = Math.min(30, g.rad * view.s * 1.05);
        if (fs < 7.5) continue;
        const mine = g.c === sel;
        numCtx.font = `${mine ? 800 : 600} ${fs.toFixed(1)}px Nunito, system-ui, sans-serif`;
        numCtx.fillStyle = mine ? '#A9566F' : 'rgba(96,78,86,.78)';
        numCtx.fillText(String(g.c + 1), sx, sy + fs * 0.04);
      }
    });
  }

  // ---------- краски внизу ----------
  const chipEls = [];
  palette.forEach((p, c) => {
    const lightText = luminance(p.hex) < 140;
    const b = h('button', { class: 'cl-chip', type: 'button', role: 'radio', style: `--c:${p.hex};--t:${lightText ? '#FFF8F2' : '#3A3236'}`, 'aria-label': `Номер ${c + 1}${p.name ? ', ' + p.name : ''}` },
      `<span class="cl-num">${c + 1}</span>`);
    b.addEventListener('click', () => { sel = c; tool = 'brush'; syncDock(); renderHint(); drawNumbers(); });
    chipEls.push(b);
    chips.append(b);
  });
  function syncDock() {
    chipEls.forEach((b, c) => {
      const on = c === sel; b.classList.toggle('on', on); b.setAttribute('aria-checked', on);
      b.classList.toggle('done', colorDone(c));
    });
    chipEls[sel] && chipEls[sel].scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'smooth' });
    btnBrush.classList.toggle('on', tool === 'brush');
    btnErase.classList.toggle('on', tool === 'erase');
    range.value = brushPt;
    const px = Math.max(6, Math.min(30, brushPt * 0.55));
    sizeDot.style.width = sizeDot.style.height = px + 'px';
    sizeDot.style.background = tool === 'erase' ? 'transparent' : palette[sel].hex;
    sizeDot.classList.toggle('eraser', tool === 'erase');
    updateProgress();
  }
  function updateProgress() {
    let d = 0; for (let r = 0; r < nReg; r++) d += done[r];
    const pct = Math.floor((d / nReg) * 100);
    prog.innerHTML = `<span class="page-label">${pct}%</span>`;
    btnUndo.disabled = !history.length;
    btnRedo.disabled = !future.length;
    return d;
  }
  btnBrush.addEventListener('click', () => { tool = 'brush'; syncDock(); });
  btnErase.addEventListener('click', () => { tool = 'erase'; syncDock(); });
  range.addEventListener('input', () => { brushPt = +range.value; settings.brushPt = brushPt; syncDock(); });
  range.addEventListener('change', () => db.setMeta('brushPt', brushPt));

  // ---------- кисть ----------
  const scratch = document.createElement('canvas'); scratch.width = W; scratch.height = H;
  const scr = scratch.getContext('2d');
  const before = document.createElement('canvas'); before.width = W; before.height = H;
  const bef = before.getContext('2d');
  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d');
  let stroke = null, strokePtr = null, penUntil = 0;

  function startStroke(e) {
    const p = toPic(e.clientX, e.clientY);
    const wpx = brushPt / view.s; // толщина в точках картинки
    stroke = { tool, c: sel, w: wpx, last: p, box: [p.x - wpx, p.y - wpx, p.x + wpx, p.y + wpx] };
    strokePtr = e.pointerId;
    bef.clearRect(0, 0, W, H);
    bef.drawImage(paintCv, 0, 0);
    scr.clearRect(0, 0, W, H);
    scr.lineCap = scr.lineJoin = 'round';
    scr.strokeStyle = scr.fillStyle = tool === 'erase' ? '#000' : palette[sel].hex;
    scr.lineWidth = wpx;
    scr.beginPath(); scr.arc(p.x, p.y, wpx / 2, 0, Math.PI * 2); scr.fill();
    composite(p.x - wpx, p.y - wpx, p.x + wpx, p.y + wpx);
  }
  function moveStroke(e) {
    const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    scr.beginPath();
    scr.moveTo(stroke.last.x, stroke.last.y);
    for (const ev of list) {
      const p = toPic(ev.clientX, ev.clientY);
      scr.lineTo(p.x, p.y);
      x0 = Math.min(x0, p.x, stroke.last.x); y0 = Math.min(y0, p.y, stroke.last.y);
      x1 = Math.max(x1, p.x, stroke.last.x); y1 = Math.max(y1, p.y, stroke.last.y);
      stroke.last = p;
    }
    scr.stroke();
    const w = stroke.w;
    composite(x0 - w, y0 - w, x1 + w, y1 + w);
    const b = stroke.box;
    b[0] = Math.min(b[0], x0 - w); b[1] = Math.min(b[1], y0 - w); b[2] = Math.max(b[2], x1 + w); b[3] = Math.max(b[3], y1 + w);
  }
  // кусок штриха → только внутри областей выбранного номера → на картину
  function composite(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const w = x1 - x0, hh = y1 - y0;
    if (w <= 0 || hh <= 0) return;
    if (stroke.tool === 'erase') {
      paint.save(); paint.globalCompositeOperation = 'destination-out';
      paint.drawImage(scratch, x0, y0, w, hh, x0, y0, w, hh);
      paint.restore();
      return;
    }
    if (tmp.width < w || tmp.height < hh) { tmp.width = Math.max(tmp.width, w); tmp.height = Math.max(tmp.height, hh); }
    tmpCtx.globalCompositeOperation = 'source-over';
    tmpCtx.clearRect(0, 0, w, hh);
    tmpCtx.drawImage(maskFor(stroke.c), x0, y0, w, hh, 0, 0, w, hh);
    tmpCtx.globalCompositeOperation = 'destination-in';
    tmpCtx.drawImage(scratch, x0, y0, w, hh, 0, 0, w, hh);
    tmpCtx.globalCompositeOperation = 'source-over';
    paint.drawImage(tmp, 0, 0, w, hh, x0, y0, w, hh);
  }
  function endStroke() {
    const s = stroke; stroke = null; strokePtr = null;
    if (!s) return;
    let [x0, y0, x1, y1] = s.box;
    const changed = recount(x0, y0, x1, y1);
    const newlyDone = changed.filter((r) => done[r]);
    for (const r of newlyDone) {
      const b = fillRegion(r);
      x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]);
    }
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    if (x1 > x0 && y1 > y0) {
      history.push({ x: x0, y: y0, before: bef.getImageData(x0, y0, x1 - x0, y1 - y0), after: paint.getImageData(x0, y0, x1 - x0, y1 - y0) });
      if (history.length > 30) history.shift();
      future.length = 0;
    }
    afterChange(changed.length > 0);
    if (newlyDone.length) celebrateIfComplete();
  }
  function afterChange(regionsChanged) {
    if (regionsChanged) { renderHint(); drawNumbers(); syncDock(); } else updateProgress();
    scheduleSave();
  }
  function restore(step, which) {
    const img = step[which];
    paint.putImageData(img, step.x, step.y);
    const changed = recount(step.x, step.y, step.x + img.width, step.y + img.height);
    afterChange(true || changed.length);
  }
  function undo() { if (stroke) return; const s = history.pop(); if (!s) return; future.push(s); restore(s, 'before'); }
  function redo() { if (stroke) return; const s = future.pop(); if (!s) return; history.push(s); restore(s, 'after'); }

  let celebrated = false;
  function celebrateIfComplete() {
    if (celebrated || updateProgress() < nReg) return;
    celebrated = true;
    scheduleSave(0);
    dialog({
      title: 'Картина готова',
      render: (body) => body.append(h('p', { class: 'dialog-text' }, `«${esc(info.title)}» раскрашена целиком. Можно сохранить её в Фото.`)),
      actions: [{ label: 'Полюбоваться', value: false }, { label: 'Сохранить PNG', value: true, primary: true }],
    }).then((v) => { if (v) exportPng(); });
  }

  // ---------- сохранение ----------
  let saveTimer = 0, savePending = false;
  function scheduleSave(delay = 1200) { savePending = true; clearTimeout(saveTimer); saveTimer = setTimeout(flushSave, delay); }
  async function flushSave() {
    if (!savePending) return;
    savePending = false; clearTimeout(saveTimer);
    const blob = await new Promise((res) => paintCv.toBlob(res, 'image/png'));
    let d = 0; for (let r = 0; r < nReg; r++) d += done[r];
    try { await db.put('coloring', { key, id, level, paint: await blob.arrayBuffer(), done: d, total: nReg, updatedAt: Date.now() }); }
    catch (e) { toast('Не получилось сохранить: ' + (e && e.message ? e.message : 'хранилище')); }
  }
  const onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushSave);

  // ---------- экспорт ----------
  async function exportPng() {
    await flushSave();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const g = c.getContext('2d');
    g.fillStyle = PAPER; g.fillRect(0, 0, W, H);
    g.drawImage(paintCv, 0, 0);
    g.globalAlpha = 0.55; g.drawImage(lineCv, 0, 0); g.globalAlpha = 1;
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    const how = await saveFile(blob, `${info.title.replace(/[\\/:*?"<>|]+/g, ' ')} — раскраска.png`);
    if (how === 'downloaded') toast('PNG сохранён');
  }

  // ---------- жесты ----------
  const touches = new Map();
  let gesture = null, lastTap = 0;
  const capture = (pid) => { try { vp.setPointerCapture(pid); } catch { /* не страшно */ } };
  function canPaint(e) {
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return e.button === 0;
    return settings.fingerDraw && touches.size === 0 && performance.now() > penUntil;
  }
  function gStart() {
    const pts = [...touches.values()], r = vp.getBoundingClientRect(), t0 = performance.now();
    if (pts.length === 1) gesture = { kind: 'one', sx: pts[0].x, sy: pts[0].y, tx: view.tx, ty: view.ty, t0, moved: false, fingers: 1 };
    else {
      const [a, b] = pts, cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      gesture = { kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: view.s, px: (cx - view.tx) / view.s, py: (cy - view.ty) / view.s,
        t0: gesture && t0 - gesture.t0 < 120 ? gesture.t0 : t0, moved: gesture ? gesture.moved : false, fingers: Math.max(pts.length, gesture ? gesture.fingers : 0), c0: [cx, cy] };
    }
  }
  function gMove() {
    if (!gesture) return;
    const pts = [...touches.values()], r = vp.getBoundingClientRect();
    if (gesture.kind === 'one' && pts.length === 1) {
      const dx = pts[0].x - gesture.sx, dy = pts[0].y - gesture.sy;
      if (Math.hypot(dx, dy) > 8) gesture.moved = true;
      view.tx = gesture.tx + dx; view.ty = gesture.ty + dy; applyView();
    } else if (gesture.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts, d = Math.hypot(a.x - b.x, a.y - b.y), cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      if (Math.abs(d - gesture.d0) > 10 || Math.hypot(cx - gesture.c0[0], cy - gesture.c0[1]) > 8) gesture.moved = true;
      view.s = Math.min(Math.max(gesture.s0 * (d / gesture.d0), view.fit * 0.6), view.fit * MAX_ZOOM);
      view.tx = cx - gesture.px * view.s; view.ty = cy - gesture.py * view.s; applyView();
    }
  }
  function gEnd() {
    if (!gesture) return;
    const g = gesture, quick = performance.now() - g.t0 < 300;
    if (touches.size > 0) { if (g.kind === 'pinch' && (g.moved || !quick)) { gStart(); gesture.moved = true; gesture.fingers = g.fingers; gesture.t0 = g.t0; } return; }
    gesture = null;
    if (!g.moved && quick && g.fingers === 2) { undo(); toast('Отменено'); }
    else if (!g.moved && quick && g.fingers >= 3) { redo(); toast('Повторено'); }
    else if (g.kind === 'one' && !g.moved && quick) {
      const now = performance.now();
      if (now - lastTap < 320) { fitView(); lastTap = 0; return; }
      lastTap = now;
    }
    clampView();
  }
  vp.addEventListener('pointerdown', (e) => {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke) return;
    if (canPaint(e)) {
      if (e.pointerType === 'pen' && touches.size) { touches.clear(); gesture = null; clampView(); }
      e.preventDefault(); capture(e.pointerId); startStroke(e); return;
    }
    if (e.pointerType === 'touch') {
      if (performance.now() < penUntil) return;
      e.preventDefault(); touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); capture(e.pointerId); gStart();
    }
  });
  vp.addEventListener('pointermove', (e) => {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke && e.pointerId === strokePtr) { e.preventDefault(); moveStroke(e); return; }
    if (touches.has(e.pointerId)) { e.preventDefault(); touches.set(e.pointerId, { x: e.clientX, y: e.clientY }); gMove(); }
  });
  const up = (e) => {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke && e.pointerId === strokePtr) { endStroke(); return; }
    if (touches.has(e.pointerId)) { touches.delete(e.pointerId); gEnd(); }
  };
  vp.addEventListener('pointerup', up);
  vp.addEventListener('pointercancel', up);
  const stopTouch = (e) => { if (e.cancelable) e.preventDefault(); };
  vp.addEventListener('touchstart', stopTouch, { passive: false });
  vp.addEventListener('touchmove', stopTouch, { passive: false });
  const stopGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stopGesture);
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const cx = e.clientX - r.left, cy = e.clientY - r.top, px = (cx - view.tx) / view.s, py = (cy - view.ty) / view.s;
      view.s = Math.min(Math.max(view.s * Math.exp(-e.deltaY * 0.01), view.fit * 0.9), view.fit * MAX_ZOOM);
      view.tx = cx - px * view.s; view.ty = cy - py * view.s;
    } else { view.tx -= e.deltaX; view.ty -= e.deltaY; }
    clampView();
  }, { passive: false });
  const onKey = (e) => { if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); } };
  document.addEventListener('keydown', onKey);

  // ---------- кнопки ----------
  btnBack.addEventListener('click', async () => { await flushSave(); onBack(); });
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnHint.addEventListener('click', () => { hintOn = !hintOn; btnHint.classList.toggle('on', hintOn); btnHint.setAttribute('aria-pressed', hintOn); renderHint(); if (hintOn) toast(`Номер ${sel + 1}: подсвечено, где он остался`); });
  btnExport.addEventListener('click', exportPng);
  btnMore.addEventListener('click', () => sheet({
    title: info.title,
    items: [
      { label: 'Вся картина целиком', icon: 'fit', onClick: fitView },
      { label: 'Рисовать пальцем', icon: 'hand', checked: !!settings.fingerDraw, onClick: () => { settings.fingerDraw = !settings.fingerDraw; db.setMeta('fingerDraw', settings.fingerDraw); } },
      ...(info.credit ? [{ label: 'О картине', icon: 'info', onClick: () => dialog({ title: info.title, render: (b) => b.append(h('p', { class: 'dialog-text' }, esc(info.credit))), actions: [{ label: 'Закрыть', value: true, primary: true }] }) }] : []),
      { separator: true },
      { label: 'Начать заново', icon: 'clear', danger: true, onClick: async () => {
        if (!(await confirmDialog('Начать заново?', 'Вся краска с этой картины исчезнет.', 'Начать заново'))) return;
        paint.clearRect(0, 0, W, H); history.length = 0; future.length = 0; celebrated = false;
        recount(0, 0, W, H); afterChange(true);
      } },
    ],
  }));

  const ro = new ResizeObserver(() => fitView());
  ro.observe(vp);
  settings.brushPt = brushPt;
  syncDock();
  fitView();
  renderHint();

  window.__coloring = { get done() { let d = 0; for (let r = 0; r < nReg; r++) d += done[r]; return d; }, total: nReg, get sel() { return sel; }, regions, palette, W, H, get view() { return { ...view }; }, flushSave, fill: (r) => { fillRegion(r); recount(0, 0, W, H); afterChange(true); } };

  return async function cleanup() {
    await flushSave();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushSave);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('gesturestart', stopGesture);
    delete window.__coloring;
  };
}

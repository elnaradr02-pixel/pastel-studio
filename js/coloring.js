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
const WATER_BODY = 0.56;     // плотность одного мазка акварели (доля полного цвета)
const WATER_RIM = 0.7;       // насколько темнеет край высохшего мазка
const FILLED_ALPHA = 90;     // с какой плотности точка считается закрашенной
const WASH_ALPHA = 150;      // плотность «заливки» при засчитанной области
const SPR = 64;              // размер отпечатка кисти

function rnd(seed) { let a = seed | 0; return () => { a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }

// Зерно акварельной бумаги: плитка 256×256, повторяется по всей картине
let paperTileCache = null;
export function paperTile() {
  if (paperTileCache) return paperTileCache;
  const S = 256, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), img = g.createImageData(S, S), d = img.data, r = rnd(11);
  const v = new Float32Array(S * S);
  for (let i = 0; i < v.length; i++) v[i] = r();
  // сглаживание шума — мягкие «холмики» бумаги холодного прессования
  for (let pass = 0; pass < 2; pass++) for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const i = y * S + x;
    v[i] = (v[i] * 2 + v[y * S + (x + 1) % S] + v[y * S + (x + S - 1) % S] + v[((y + 1) % S) * S + x] + v[((y + S - 1) % S) * S + x]) / 6;
  }
  for (let i = 0; i < v.length; i++) {
    const k = 255 - Math.max(0, (v[i] - 0.38)) * 70 - (r() < 0.004 ? 18 : 0);
    d[i * 4] = k; d[i * 4 + 1] = k - 2; d[i * 4 + 2] = k - 5; d[i * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  paperTileCache = { canvas: c, url: c.toDataURL('image/png'), grain: v };
  return paperTileCache;
}

// Акварельный отпечаток: неровный край, мягкая кромка. Это только форма — цвет и плотность задаются позже
function waterSprite(seed) {
  const S = SPR, a = new Uint8Array(S * S), r = rnd(seed);
  const k1 = r() * 6.28, k2 = r() * 6.28, k3 = r() * 6.28;
  for (let y = 0; y < S; y++) for (let x = 0; x < S; x++) {
    const dx = (x + 0.5) / S * 2 - 1, dy = (y + 0.5) / S * 2 - 1, q = Math.hypot(dx, dy), ang = Math.atan2(dy, dx);
    const edge = 0.84 + 0.06 * Math.sin(3 * ang + k1) + 0.05 * Math.sin(5 * ang + k2) + 0.03 * Math.sin(9 * ang + k3);
    if (q >= edge) continue;
    a[y * S + x] = Math.round(255 * Math.min(1, (edge - q) / 0.09));
  }
  return a;
}

// Неравномерность пигмента: зерно бумаги (мелко) и «облачка» размывки (крупно, у каждого мазка свои)
function pigment(grain, x, y, ox, oy) {
  const g1 = grain[(y & 255) * 256 + (x & 255)];
  const g2 = grain[((((y >> 2) + oy) & 255) * 256) + (((x >> 2) + ox) & 255)];
  return (1 + (g1 - 0.5) * 0.8) * (1 + (g2 - 0.5) * 1.1);
}

export async function loadPicture(id, level) {
  if (id.startsWith('u-')) {
    // своя картинка: собрана на iPad и лежит только в его хранилище
    const u = await db.get('userpics', id);
    if (!u) throw new Error('картинка не найдена');
    return { w: u.w, h: u.h, palette: u.palette, regions: u.regions, map: decodeMap(new Uint16Array(u.rle), u.w * u.h) };
  }
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
  const liveCv = h('canvas', { class: 'cl-layer cl-live', width: W, height: H });
  const paperEl = h('div', { class: 'cl-layer cl-paper', style: `background-image:url(${paperTile().url})` });
  picEl.append(paintCv, liveCv, paperEl, hintCv, lineCv);
  stage.append(picEl);
  const numCv = h('canvas', { class: 'cl-numbers' });
  vp.append(stage, numCv);

  const dock = h('div', { class: 'dock cl-dock', role: 'toolbar', 'aria-label': 'Краски' });
  const chips = h('div', { class: 'cl-chips', role: 'radiogroup', 'aria-label': 'Номера красок' });
  const toolBox = h('div', { class: 'cl-tools' });
  const btnWater = h('button', { class: 'tool-btn on', type: 'button', 'aria-label': 'Акварель' }, `${icon('drop', 24)}<span>Акварель</span>`);
  const btnBrush = h('button', { class: 'tool-btn', type: 'button', 'aria-label': 'Ровная заливка' }, `${icon('brush', 24)}<span>Заливка</span>`);
  const btnErase = h('button', { class: 'tool-btn', type: 'button', 'aria-label': 'Ластик' }, `${icon('eraser', 24)}<span>Ластик</span>`);
  const sizeBox = h('label', { class: 'dock-size' });
  const sizeDot = h('span', { class: 'size-dot', 'aria-hidden': 'true' });
  const range = h('input', { type: 'range', min: 8, max: 70, 'aria-label': 'Размер кисти' });
  sizeBox.append(sizeDot, range);
  toolBox.append(btnWater, btnBrush, btnErase, sizeBox);
  dock.append(chips, h('span', { class: 'dock-sep' }), toolBox);
  screen.append(top, vp, dock);
  root.append(screen);

  const paint = paintCv.getContext('2d', { willReadFrequently: true });
  const live = liveCv.getContext('2d');
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
        const o = p * 4; d[o] = 112; d[o + 1] = 98; d[o + 2] = 104; d[o + 3] = 112;
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
  let tool = 'brush';   // 'brush' | 'erase'
  let brushKind = settings.colorBrush || 'water'; // 'water' — акварель, 'flat' — ровная заливка
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
      const f = d[k] > FILLED_ALPHA ? 1 : 0;
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
    const grain = paperTile().grain;
    const water = brushKind === 'water';
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (by0 + y) * W + bx0 + x;
      if (map[i] !== r) continue;
      const o = (y * w + x) * 4;
      if (water) {
        // пробелы заливаются лёгкой размывкой: светлее на «холмиках» бумаги
        const wash = Math.min(255, Math.round(WASH_ALPHA * pigment(grain, bx0 + x, by0 + y, r * 37, r * 91)));
        if (d[o + 3] < wash) { d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = wash; }
      } else { d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = 255; }
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
    btnWater.classList.toggle('on', tool === 'brush' && brushKind === 'water');
    btnBrush.classList.toggle('on', tool === 'brush' && brushKind === 'flat');
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
  const setKind = (k) => { tool = 'brush'; brushKind = k; settings.colorBrush = k; db.setMeta('colorBrush', k); syncDock(); };
  btnWater.addEventListener('click', () => setKind('water'));
  btnBrush.addEventListener('click', () => setKind('flat'));
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
  const cov = new Uint8Array(W * H); // покрытие текущего акварельного мазка

  function startStroke(e) {
    const p = toPic(e.clientX, e.clientY);
    const wpx = brushPt / view.s; // толщина в точках картинки
    const water = tool === 'brush' && brushKind === 'water';
    stroke = { tool, water, c: sel, w: wpx, last: p, carry: 0, box: [p.x - wpx, p.y - wpx, p.x + wpx, p.y + wpx] };
    strokePtr = e.pointerId;
    bef.clearRect(0, 0, W, H);
    bef.drawImage(paintCv, 0, 0);
    scr.clearRect(0, 0, W, H);
    if (water) {
      // у каждого мазка чуть свой оттенок — как у настоящей акварели
      const seed = (Math.random() * 1e9) | 0, rr = rnd(seed), k = 1 + (rr() - 0.5) * 0.12;
      stroke.rgb = rgb[sel].map((v) => Math.max(0, Math.min(255, Math.round(v * k))));
      stroke.spr = waterSprite(seed);
      stroke.rng = rr;
      stroke.ox = (rr() * 256) | 0; stroke.oy = (rr() * 256) | 0;
      stroke.inSel = new Uint8Array(regions.length);
      regions.forEach((rg, i) => { if (rg.c === sel) stroke.inSel[i] = 1; });
      stamp(p.x, p.y);
      previewWater(p.x - wpx, p.y - wpx, p.x + wpx, p.y + wpx);
      return;
    }
    scr.lineCap = scr.lineJoin = 'round';
    scr.strokeStyle = scr.fillStyle = tool === 'erase' ? '#000' : palette[sel].hex;
    scr.lineWidth = wpx;
    scr.beginPath(); scr.arc(p.x, p.y, wpx / 2, 0, Math.PI * 2); scr.fill();
    composite(p.x - wpx, p.y - wpx, p.x + wpx, p.y + wpx);
  }
  function moveStroke(e) {
    const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    if (stroke.water) {
      for (const ev of list) {
        const p = toPic(ev.clientX, ev.clientY), a = stroke.last;
        const dist = Math.hypot(p.x - a.x, p.y - a.y), step = Math.max(0.8, stroke.w * 0.14);
        let t = step - stroke.carry;
        while (t <= dist) { stamp(a.x + (p.x - a.x) * (t / dist), a.y + (p.y - a.y) * (t / dist)); t += step; }
        stroke.carry = dist - (t - step);
        x0 = Math.min(x0, p.x, a.x); y0 = Math.min(y0, p.y, a.y); x1 = Math.max(x1, p.x, a.x); y1 = Math.max(y1, p.y, a.y);
        stroke.last = p;
      }
      const w = stroke.w;
      previewWater(x0 - w, y0 - w, x1 + w, y1 + w);
      const b = stroke.box;
      b[0] = Math.min(b[0], x0 - w); b[1] = Math.min(b[1], y0 - w); b[2] = Math.max(b[2], x1 + w); b[3] = Math.max(b[3], y1 + w);
      return;
    }
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
  // один отпечаток: покрытие мазка растёт по максимуму, а не складывается — один мазок = один ровный слой
  function stamp(x, y) {
    const s = stroke, w = s.w * (0.9 + s.rng() * 0.2), R = w / 2 + 1, th = s.rng() * Math.PI * 2;
    const cs = Math.cos(th), sn = Math.sin(th), k = SPR / w, half = SPR / 2, spr = s.spr;
    const xa = Math.max(0, Math.floor(x - R)), xb = Math.min(W - 1, Math.ceil(x + R));
    const ya = Math.max(0, Math.floor(y - R)), yb = Math.min(H - 1, Math.ceil(y + R));
    for (let py = ya; py <= yb; py++) {
      const dy = py + 0.5 - y, row = py * W;
      for (let px = xa; px <= xb; px++) {
        const dx = px + 0.5 - x;
        const u = (dx * cs + dy * sn) * k + half, v = (dy * cs - dx * sn) * k + half;
        if (u < 0 || v < 0 || u >= SPR || v >= SPR) continue;
        const a = spr[(v | 0) * SPR + (u | 0)];
        if (a > cov[row + px]) cov[row + px] = a;
      }
    }
  }
  // мокрый мазок поверх картины (только в областях номера); край «высохнет» и ляжет на картину, когда карандаш поднят
  function waterImage(x0, y0, w, hh, rim) {
    const s = stroke, img = live.createImageData(w, hh), d = img.data, grain = paperTile().grain;
    const [cr, cg, cb] = s.rgb;
    for (let y = 0; y < hh; y++) {
      const row = (y0 + y) * W;
      for (let x = 0; x < w; x++) {
        const i = row + x0 + x, c = cov[i];
        if (!c || !s.inSel[map[i]]) continue;
        let a = c * WATER_BODY * pigment(grain, x0 + x, y0 + y, s.ox, s.oy);
        if (rim) a += rim[y * w + x] * WATER_RIM;
        const o = (y * w + x) * 4;
        d[o] = cr; d[o + 1] = cg; d[o + 2] = cb; d[o + 3] = a > 255 ? 255 : a;
      }
    }
    return img;
  }
  function previewWater(x0, y0, x1, y1) {
    x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0));
    x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
    const w = x1 - x0, hh = y1 - y0;
    if (w <= 0 || hh <= 0) return;
    live.putImageData(waterImage(x0, y0, w, hh, null), x0, y0);
  }
  // кайма высохшего мазка: пигмент собирается у края мокрого пятна и у контура области
  function dryRim(x0, y0, w, hh, rad) {
    const s = stroke, n = w * hh, m = new Float32Array(n), t = new Float32Array(n), out = new Float32Array(n);
    for (let y = 0; y < hh; y++) for (let x = 0; x < w; x++) {
      const i = (y0 + y) * W + x0 + x;
      if (s.inSel[map[i]]) m[y * w + x] = cov[i];
    }
    const span = 2 * rad + 1;
    for (let y = 0; y < hh; y++) { // по горизонтали
      let acc = 0; const o = y * w;
      for (let x = -rad; x < w + rad; x++) {
        acc += (x + rad < w && x + rad >= 0) ? m[o + x + rad] : 0;
        if (x - rad - 1 >= 0 && x - rad - 1 < w) acc -= m[o + x - rad - 1];
        if (x >= 0 && x < w) t[o + x] = acc / span;
      }
    }
    for (let x = 0; x < w; x++) { // по вертикали
      let acc = 0;
      for (let y = -rad; y < hh + rad; y++) {
        acc += (y + rad < hh && y + rad >= 0) ? t[(y + rad) * w + x] : 0;
        if (y - rad - 1 >= 0 && y - rad - 1 < hh) acc -= t[(y - rad - 1) * w + x];
        if (y >= 0 && y < hh) { const i = y * w + x, e = m[i] - acc / span; out[i] = e > 0 ? Math.min(255, e * 1.3) : 0; }
      }
    }
    return out;
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
    if (s.water) {
      // лессировка: новый слой умножается на старый — второй проход делает цвет гуще
      const bx = Math.max(0, Math.floor(x0)), by = Math.max(0, Math.floor(y0)), bw = Math.min(W, Math.ceil(x1)) - bx, bh = Math.min(H, Math.ceil(y1)) - by;
      if (bw > 0 && bh > 0) {
        stroke = s;
        const rad = Math.max(2, Math.min(7, Math.round(s.w * 0.07)));
        live.putImageData(waterImage(bx, by, bw, bh, dryRim(bx, by, bw, bh, rad)), bx, by);
        stroke = null;
        for (let y = by; y < by + bh; y++) cov.fill(0, y * W + bx, y * W + bx + bw);
        paint.save(); paint.globalCompositeOperation = 'multiply';
        paint.drawImage(liveCv, bx, by, bw, bh, bx, by, bw, bh);
        paint.restore();
        live.clearRect(bx, by, bw, bh);
      }
    }
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
    g.save(); g.globalCompositeOperation = 'multiply'; g.globalAlpha = 0.55; g.fillStyle = g.createPattern(paperTile().canvas, 'repeat'); g.fillRect(0, 0, W, H); g.restore();
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

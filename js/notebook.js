// Экран блокнота: рисование Apple Pencil, жесты пальцами, страницы, отмена, автосохранение, экспорт.
import * as db from './db.js';
import * as ink from './ink.js';
import { icon } from './icons.js';
import { h, esc, toast, sheet, dialog, confirmDialog, saveFile } from './ui.js';
import { recognize, SHAPE_NAMES } from './shapes.js';
import * as stk from './stickers.js';

const { PAGE_W, PAGE_H, STRIDE } = ink;
const RS = 2;                 // пикселей растра на единицу страницы
const PEN_GUARD_MS = 350;     // после касания карандашом пальцы какое-то время не считаются (ладонь)
const MAX_ZOOM = 5;

export async function openNotebook(root, notebookId, { onBack, settings }) {
  const nb = await db.get('notebooks', notebookId);
  if (!nb) { onBack(); return () => {}; }
  const pageRows = await db.pagesOf(notebookId);
  const byId = new Map(pageRows.map((p) => [p.id, p]));
  let pages = nb.pageIds.map((id) => byId.get(id)).filter(Boolean);
  if (!pages.length) {
    const p = newPage(nb.id, nb.paper || 'blank');
    pages = [p];
    nb.pageIds = [p.id];
    await db.put('pages', p);
    await db.put('notebooks', nb);
  }
  let idx = Math.min(nb.lastPage || 0, pages.length - 1);

  // инструменты запоминаются между запусками
  const prefs = Object.assign({ tool: 'pen', color: ink.PALETTE[0].hex, sizes: {} }, await db.getMeta('toolPrefs', {}));
  for (const k of Object.keys(ink.TOOLS)) if (!prefs.sizes[k]) prefs.sizes[k] = ink.TOOLS[k].def;

  // ---------- разметка ----------
  root.innerHTML = '';
  const screen = h('div', { class: 'nb-screen' });
  const top = h('header', { class: 'nb-top' });
  const btnBack = h('button', { class: 'chip-btn', type: 'button', 'aria-label': 'К блокнотам' }, `${icon('back')}<span class="hide-narrow">Блокноты</span>`);
  const titleBox = h('div', { class: 'nb-title' }, `<div class="nb-name">${esc(nb.title)}</div>`);
  const pager = h('div', { class: 'pager' });
  const btnPrev = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Предыдущая страница' }, icon('prev'));
  const pageLabel = h('span', { class: 'page-label', 'aria-live': 'polite' });
  const btnNext = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Следующая страница' }, icon('next'));
  const btnAdd = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Добавить страницу' }, icon('plus'));
  pager.append(btnPrev, pageLabel, btnNext, btnAdd);
  titleBox.append(pager);
  const actions = h('div', { class: 'nb-actions' });
  const btnSticker = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Стикеры' }, icon('sticker'));
  const btnUndo = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Отменить' }, icon('undo'));
  const btnRedo = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Повторить' }, icon('redo'));
  const btnExport = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Сохранить страницу как PNG' }, icon('share'));
  const btnMore = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'Ещё' }, icon('more'));
  actions.append(btnSticker, btnUndo, btnRedo, btnExport, btnMore);
  top.append(btnBack, titleBox, actions);

  const vp = h('div', { class: 'nb-viewport', 'aria-label': 'Страница для рисования' });
  const stage = h('div', { class: 'nb-stage' });
  const pageEl = h('div', { class: 'nb-page' });
  const inkCanvas = h('canvas', { class: 'nb-ink', width: PAGE_W * RS, height: PAGE_H * RS });
  const stickerLayer = h('div', { class: 'nb-stickers' });
  pageEl.append(stickerLayer, inkCanvas);
  stage.append(pageEl);
  const detail = h('canvas', { class: 'nb-detail', hidden: true });
  const stage2 = h('div', { class: 'nb-stage nb-stage-live' });
  const liveCanvas = h('canvas', { class: 'nb-live', width: PAGE_W * RS, height: PAGE_H * RS });
  const selBox = h('div', { class: 'sel-box', hidden: true }, '<span class="sel-h sel-del">×</span><span class="sel-h sel-scale"></span><span class="sel-h sel-text">Aa</span>');
  stage2.append(liveCanvas, selBox);
  vp.append(stage, detail, stage2);

  const dock = buildDock();
  screen.append(top, vp, dock.el);
  root.append(screen);

  const inkCtx = inkCanvas.getContext('2d');
  const liveCtx = liveCanvas.getContext('2d');
  inkCtx.setTransform(RS, 0, 0, RS, 0, 0);
  liveCtx.setTransform(RS, 0, 0, RS, 0, 0);
  const detailCtx = detail.getContext('2d');
  const tmp = document.createElement('canvas');
  const tmpCtx = tmp.getContext('2d');

  // ---------- состояние страницы ----------
  let page = pages[idx];
  let history = [];   // {type:'add'} | {type:'clear', strokes}
  let future = [];
  const view = { s: 1, tx: 0, ty: 0, fit: 1 };

  function newPage(notebookId, paper) {
    return { id: db.uid(), notebookId, paper, strokes: [], updatedAt: Date.now() };
  }

  // ---------- вид: масштаб и сдвиг ----------
  function applyView() {
    const t = `translate(${view.tx}px, ${view.ty}px) scale(${view.s})`;
    stage.style.transform = t;
    stage2.style.transform = t;
    if (selected) updateSel();
  }
  function fitView() {
    const w = vp.clientWidth, hgt = vp.clientHeight;
    const pad = 20;
    const avail = availH();
    view.fit = Math.min((w - pad * 2) / PAGE_W, (avail - pad * 2) / PAGE_H);
    view.s = view.fit;
    view.tx = (w - PAGE_W * view.s) / 2;
    view.ty = (avail - PAGE_H * view.s) / 2;
    applyView();
  }
  // панель инструментов лежит поверх низа экрана — страница целиком помещается над ней
  function availH() {
    const vr = vp.getBoundingClientRect(), dr = dock.el.getBoundingClientRect();
    return vp.clientHeight - Math.max(0, vr.bottom - dr.top);
  }
  function clampView() {
    const w = vp.clientWidth, hgt = vp.clientHeight, avail = availH();
    view.s = Math.min(Math.max(view.s, view.fit * 0.9), view.fit * MAX_ZOOM);
    const pw = PAGE_W * view.s, ph = PAGE_H * view.s;
    const margin = 60;
    view.tx = pw + margin * 2 <= w ? (w - pw) / 2 : Math.min(margin, Math.max(w - pw - margin, view.tx));
    view.ty = ph + margin * 2 <= avail ? (avail - ph) / 2 : Math.min(margin, Math.max(hgt - ph - margin, view.ty));
    applyView();
  }
  function toPage(clientX, clientY) {
    const r = vp.getBoundingClientRect();
    return { x: (clientX - r.left - view.tx) / view.s, y: (clientY - r.top - view.ty) / view.s };
  }
  const isZoomed = () => view.s > view.fit * 1.04;

  // ---------- отрисовка ----------
  function renderInk() {
    inkCtx.save();
    inkCtx.setTransform(1, 0, 0, 1, 0, 0);
    inkCtx.clearRect(0, 0, inkCanvas.width, inkCanvas.height);
    inkCtx.restore();
    for (const s of page.strokes) ink.renderStroke(inkCtx, s);
  }

  // При сильном увеличении растр страницы мягчает — рисуем видимый кусок заново в полном разрешении.
  let detailTimer = 0;
  function hideDetail() {
    clearTimeout(detailTimer);
    detail.hidden = true;
    inkCanvas.style.visibility = 'visible';
  }
  function scheduleDetail(delay = 140) {
    clearTimeout(detailTimer);
    detailTimer = setTimeout(renderDetail, delay);
  }
  function renderDetail() {
    const dpr = window.devicePixelRatio || 1;
    if (view.s * dpr <= RS * 1.05) { hideDetail(); return; }
    const w = vp.clientWidth, hgt = vp.clientHeight;
    const W = Math.round(w * dpr), H = Math.round(hgt * dpr);
    if (detail.width !== W || detail.height !== H) { detail.width = W; detail.height = H; tmp.width = W; tmp.height = H; }
    detail.style.width = w + 'px';
    detail.style.height = hgt + 'px';
    const ux0 = -view.tx / view.s, uy0 = -view.ty / view.s, ux1 = (w - view.tx) / view.s, uy1 = (hgt - view.ty) / view.s;
    const m = [dpr * view.s, 0, 0, dpr * view.s, dpr * view.tx, dpr * view.ty];
    detailCtx.setTransform(1, 0, 0, 1, 0, 0);
    detailCtx.clearRect(0, 0, W, H);
    // бумага — фон страницы, стикеры — отдельный слой под чернилами; здесь только чернила
    tmpCtx.setTransform(1, 0, 0, 1, 0, 0);
    tmpCtx.clearRect(0, 0, W, H);
    tmpCtx.setTransform(...m);
    for (const s of page.strokes) {
      const b = ink.bounds(s);
      if (b.x1 < ux0 || b.x0 > ux1 || b.y1 < uy0 || b.y0 > uy1) continue;
      ink.renderStroke(tmpCtx, s);
    }
    detailCtx.setTransform(...m);
    detailCtx.save();
    detailCtx.beginPath();
    if (detailCtx.roundRect) detailCtx.roundRect(0, 0, PAGE_W, PAGE_H, 18); else detailCtx.rect(0, 0, PAGE_W, PAGE_H);
    detailCtx.clip();
    detailCtx.setTransform(1, 0, 0, 1, 0, 0);
    detailCtx.drawImage(tmp, 0, 0);
    detailCtx.restore();
    detail.hidden = false;
    inkCanvas.style.visibility = 'hidden';
  }

  function showPage() {
    page = pages[idx];
    if (!page.stickers) page.stickers = [];
    selected = null;
    history = [];
    future = [];
    pageEl.setAttribute('style', ink.paperCss(page.paper));
    renderInk();
    renderStickers();
    hideDetail();
    pageLabel.textContent = `${idx + 1} / ${pages.length}`;
    btnPrev.disabled = idx === 0;
    btnNext.disabled = idx === pages.length - 1;
    updateUndo();
    if (nb.lastPage !== idx) { nb.lastPage = idx; saveNotebook(); }
  }

  function updateUndo() {
    btnUndo.disabled = !history.length;
    btnRedo.disabled = !future.length;
  }

  // ---------- сохранение ----------
  let saveTimer = 0;
  let savePending = false;
  function scheduleSave() {
    savePending = true;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(flushSave, 500);
  }
  async function flushSave() {
    if (!savePending) return;
    savePending = false;
    clearTimeout(saveTimer);
    page.updatedAt = Date.now();
    const clean = { ...page, strokes: page.strokes.map(({ _b, ...s }) => s) };
    try {
      await db.put('pages', clean);
      nb.updatedAt = Date.now();
      await db.put('notebooks', nb);
    } catch (e) {
      toast('Не получилось сохранить: ' + (e && e.message ? e.message : 'ошибка хранилища'));
    }
  }
  function saveNotebook() { nb.updatedAt = Date.now(); db.put('notebooks', nb); }
  const onHide = () => { if (document.visibilityState === 'hidden') flushSave(); };
  document.addEventListener('visibilitychange', onHide);
  window.addEventListener('pagehide', flushSave);

  // ---------- рисование ----------
  let stroke = null;      // текущий штрих
  let strokePtr = null;   // pointerId, который рисует
  let drawn = -1;         // до какой точки штрих уже нарисован
  let liveBox = null;     // область живого слоя, которую надо очистить/перенести
  let lastPt = null;
  let penUntil = 0;       // до какого времени пальцы игнорируются
  let hasPressure = settings.hasPressure || false;

  function canDraw(e) {
    if (e.pointerType === 'pen') return true;
    if (e.pointerType === 'mouse') return e.button === 0;
    return settings.fingerDraw && touches.size === 0 && performance.now() > penUntil;
  }

  function startStroke(e) {
    hideDetail(); // во время рисования показываем растр, после — снова чёткий слой
    const tool = prefs.tool;
    stroke = { tool, color: prefs.color, size: prefs.sizes[tool], seed: (Math.random() * 1e9) | 0, pts: [] };
    strokePtr = e.pointerId;
    drawn = -1;
    liveBox = null;
    lastPt = null;
    holdAt = null;
    clearTimeout(holdTimer);
    addPoints(e);
  }

  // ---------- фигуры: нарисовали и задержали карандаш ----------
  let holdTimer = 0, holdAt = null;
  function armHold(cx, cy) {
    if (!stroke || stroke.tool === 'eraser' || stroke.snapped || settings.shapes === false) return;
    if (holdAt && Math.hypot(cx - holdAt.x, cy - holdAt.y) < 4) return; // карандаш стоит — таймер идёт
    holdAt = { x: cx, y: cy };
    clearTimeout(holdTimer);
    holdTimer = setTimeout(trySnap, 550);
  }
  function trySnap() {
    if (!stroke || stroke.snapped) return;
    const res = recognize(stroke.pts, STRIDE);
    if (!res) return;
    const p = stroke.pts, ws = [];
    let as = 0;
    for (let i = 0; i < p.length; i += STRIDE) { ws.push(p[i + 2]); as += p[i + 3]; }
    ws.sort((a, b) => a - b);
    const w = stroke.tool === 'marker' ? stroke.size : ws[Math.floor(ws.length / 2)];
    const a = as / (p.length / STRIDE);
    clearLive(liveBox);
    liveBox = null;
    const pts = [];
    for (const [x, y] of res.outline) pts.push(x, y, w, a);
    stroke.pts = pts;
    stroke.snapped = res.type;
    for (let i = 0; i < pts.length; i += STRIDE) growBox(pts[i], pts[i + 1], w);
    const n = pts.length / STRIDE;
    if (stroke.tool === 'marker') ink.drawMarker(liveCtx, stroke, n);
    else ink.drawIncrement(liveCtx, stroke, 0, n - 1);
    drawn = n - 1;
    toast(SHAPE_NAMES[res.type] || 'Фигура');
  }

  function widthFor(e, x, y, t, tool) {
    const base = prefs.sizes[tool];
    if (tool === 'marker') return { w: base, a: 1 };
    if (tool === 'eraser') return { w: base, a: 1 };
    // нажим: у Apple Pencil (USB-C) его нет, поэтому по умолчанию толщину задаёт скорость
    let f;
    if (e.pointerType === 'pen' && hasPressure && e.pressure > 0) {
      f = 0.3 + e.pressure * 1.2;
    } else {
      let target = 1;
      if (lastPt) {
        const dt = Math.max(1, t - lastPt.t);
        const v = Math.hypot(x - lastPt.x, y - lastPt.y) / dt; // единиц страницы в мс
        target = Math.min(1.2, Math.max(0.5, 1.22 - v * 0.42));
      }
      f = lastPt ? lastPt.f * 0.72 + target * 0.28 : 0.85;
    }
    let w = base * f;
    let a = 1;
    if (tool === 'pencil') {
      // наклон карандаша: чем сильнее наклон, тем шире и светлее штрих — как штриховка грифелем
      const alt = altitude(e);
      const k = 1 - alt / (Math.PI / 2);
      w *= 1 + k * 2.2;
      a = 0.95 - k * 0.5;
    }
    return { w, a, f };
  }

  function altitude(e) {
    if (typeof e.altitudeAngle === 'number' && e.pointerType === 'pen') return e.altitudeAngle;
    if (e.pointerType === 'pen' && (e.tiltX || e.tiltY)) {
      const tx = Math.tan((e.tiltX * Math.PI) / 180), ty = Math.tan((e.tiltY * Math.PI) / 180);
      return Math.atan(1 / Math.max(1e-6, Math.hypot(tx, ty)));
    }
    return Math.PI / 2;
  }

  const pressures = [];
  function addPoints(e) {
    const list = (e.getCoalescedEvents && e.getCoalescedEvents().length) ? e.getCoalescedEvents() : [e];
    for (const ev of list) {
      if (ev.pointerType === 'pen' && !hasPressure) {
        pressures.push(ev.pressure);
        if (pressures.length > 12) pressures.shift();
        const mn = Math.min(...pressures), mx = Math.max(...pressures);
        if (pressures.length >= 8 && mx - mn > 0.08) { hasPressure = true; settings.hasPressure = true; db.setMeta('hasPressure', true); }
      }
      const { x, y } = toPage(ev.clientX, ev.clientY);
      const t = ev.timeStamp || performance.now();
      if (lastPt && Math.hypot(x - lastPt.x, y - lastPt.y) < 0.35) continue;
      const { w, a, f } = widthFor(ev, x, y, t, stroke.tool);
      // мягкий кончик в начале ручки
      const n = stroke.pts.length / STRIDE;
      const taper = stroke.tool === 'pen' && n < 4 ? 0.55 + n * 0.15 : 1;
      stroke.pts.push(x, y, w * taper, a);
      lastPt = { x, y, t, f: f || 1 };
      growBox(x, y, w);
    }
    const last = list[list.length - 1];
    if (last) armHold(last.clientX, last.clientY);
    paintLive();
  }

  function growBox(x, y, w) {
    const pad = Math.max(w, stroke.size) * (stroke.tool === 'pencil' ? 1.2 : 0.75) + 4;
    if (!liveBox) liveBox = { x0: x - pad, y0: y - pad, x1: x + pad, y1: y + pad };
    else {
      liveBox.x0 = Math.min(liveBox.x0, x - pad); liveBox.y0 = Math.min(liveBox.y0, y - pad);
      liveBox.x1 = Math.max(liveBox.x1, x + pad); liveBox.y1 = Math.max(liveBox.y1, y + pad);
    }
  }

  let rafLive = 0;
  function paintLive() {
    if (rafLive) return;
    rafLive = requestAnimationFrame(() => {
      rafLive = 0;
      if (!stroke) return;
      const n = stroke.pts.length / STRIDE;
      if (!n) return;
      if (stroke.tool === 'marker') {
        clearLive(liveBox);
        ink.drawMarker(liveCtx, stroke, n);
      } else if (stroke.tool === 'eraser') {
        ink.drawIncrement(inkCtx, stroke, drawn + 1, n - 1);
      } else {
        ink.drawIncrement(liveCtx, stroke, drawn + 1, n - 1);
      }
      drawn = n - 1;
    });
  }

  function boxPx(b) {
    const x = Math.max(0, Math.floor(b.x0 * RS)), y = Math.max(0, Math.floor(b.y0 * RS));
    const x1 = Math.min(PAGE_W * RS, Math.ceil(b.x1 * RS)), y1 = Math.min(PAGE_H * RS, Math.ceil(b.y1 * RS));
    return { x, y, w: Math.max(0, x1 - x), h: Math.max(0, y1 - y) };
  }
  function clearLive(b) {
    if (!b) return;
    const r = boxPx(b);
    liveCtx.save(); liveCtx.setTransform(1, 0, 0, 1, 0, 0); liveCtx.clearRect(r.x, r.y, r.w, r.h); liveCtx.restore();
  }

  function endStroke() {
    if (!stroke) return;
    cancelAnimationFrame(rafLive); rafLive = 0;
    clearTimeout(holdTimer);
    const s = stroke;
    stroke = null; strokePtr = null;
    delete s.snapped;
    const n = s.pts.length / STRIDE;
    if (!n) { clearLive(liveBox); return; }
    // дорисовать хвост
    if (s.tool === 'eraser') ink.drawIncrement(inkCtx, s, drawn + 1, n - 1);
    else if (s.tool !== 'marker') ink.drawIncrement(liveCtx, s, drawn + 1, n - 1);
    // перенести с живого слоя на страницу
    if (s.tool === 'pen' || s.tool === 'pencil') {
      const r = boxPx(liveBox);
      if (r.w && r.h) {
        inkCtx.save(); inkCtx.setTransform(1, 0, 0, 1, 0, 0);
        inkCtx.drawImage(liveCanvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
        inkCtx.restore();
      }
    } else if (s.tool === 'marker') {
      ink.renderStroke(inkCtx, { ...s, pts: s.pts });
    }
    clearLive(liveBox);
    s.pts = Float32Array.from(s.pts);
    page.strokes.push(s);
    history.push({ type: 'add' });
    future = [];
    updateUndo();
    scheduleSave();
    scheduleDetail();
  }

  function cancelStroke() {
    if (!stroke) return;
    clearTimeout(holdTimer);
    const s = stroke;
    stroke = null; strokePtr = null;
    clearLive(liveBox);
    if (s.tool === 'eraser') renderInk(); // ластик уже стирал по странице — вернуть как было
  }

  // ---------- отмена ----------
  function applySticker(step, dir) {
    // dir: 'undo' | 'redo'
    const list = page.stickers;
    const at = (id) => list.findIndex((x) => x.id === id);
    if (step.type === 'stAdd') { if (dir === 'undo') list.splice(at(step.st.id), 1); else list.push({ ...step.st }); }
    else if (step.type === 'stDel') { if (dir === 'undo') list.splice(step.index, 0, { ...step.st }); else list.splice(at(step.st.id), 1); }
    else if (step.type === 'stEdit') { const i = at(step.id); if (i >= 0) list[i] = { ...(dir === 'undo' ? step.before : step.after) }; }
    selected = null;
    renderStickers();
    updateUndo();
    scheduleSave();
  }
  function undo() {
    if (stroke || stickOp) return;
    const step = history.pop();
    if (!step) return;
    if (step.type.startsWith('st')) { future.push(step); applySticker(step, 'undo'); return; }
    if (step.type === 'add') future.push({ type: 'add', stroke: page.strokes.pop() });
    else if (step.type === 'clear') { future.push({ type: 'clear', strokes: page.strokes, stickers: page.stickers }); page.strokes = step.strokes; page.stickers = step.stickers || []; renderStickers(); }
    afterChange();
  }
  function redo() {
    if (stroke || stickOp) return;
    const step = future.pop();
    if (!step) return;
    if (step.type.startsWith('st')) { history.push(step); applySticker(step, 'redo'); return; }
    if (step.type === 'add') { page.strokes.push(step.stroke); history.push({ type: 'add' }); }
    else if (step.type === 'clear') { history.push({ type: 'clear', strokes: page.strokes, stickers: page.stickers }); page.strokes = []; page.stickers = []; renderStickers(); }
    afterChange();
  }
  function clearPage() {
    if (!page.strokes.length && !page.stickers.length) return;
    history.push({ type: 'clear', strokes: page.strokes, stickers: page.stickers });
    page.strokes = [];
    page.stickers = [];
    selected = null;
    renderStickers();
    future = [];
    afterChange();
    toast('Страница очищена. Отменить — стрелка назад');
  }
  function afterChange() {
    renderInk();
    updateUndo();
    scheduleSave();
    if (!detail.hidden || isZoomed()) scheduleDetail(30);
  }

  // ---------- жесты пальцами ----------
  const touches = new Map();
  let gesture = null;

  function gestureStart() {
    const pts = [...touches.values()];
    const r = vp.getBoundingClientRect();
    const t0 = performance.now();
    if (pts.length === 1) {
      gesture = { kind: 'one', sx: pts[0].x, sy: pts[0].y, tx: view.tx, ty: view.ty, t0, moved: false, fingers: 1 };
    } else {
      const [a, b] = pts;
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      gesture = {
        kind: 'pinch', d0: Math.hypot(a.x - b.x, a.y - b.y) || 1, s0: view.s,
        px: (cx - view.tx) / view.s, py: (cy - view.ty) / view.s,
        t0: gesture && gesture.t0 && t0 - gesture.t0 < 120 ? gesture.t0 : t0,
        moved: gesture ? gesture.moved : false, fingers: Math.max(pts.length, gesture ? gesture.fingers : 0),
      };
    }
    hideDetail();
  }

  function gestureMove() {
    if (!gesture) return;
    const pts = [...touches.values()];
    const r = vp.getBoundingClientRect();
    if (gesture.kind === 'one' && pts.length === 1) {
      const dx = pts[0].x - gesture.sx, dy = pts[0].y - gesture.sy;
      if (Math.hypot(dx, dy) > 8) gesture.moved = true;
      if (isZoomed()) { view.tx = gesture.tx + dx; view.ty = gesture.ty + dy; applyView(); }
      else { stage.style.transform = stage2.style.transform = `translate(${view.tx + dx * 0.35}px, ${view.ty}px) scale(${view.s})`; }
    } else if (gesture.kind === 'pinch' && pts.length >= 2) {
      const [a, b] = pts;
      const d = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2 - r.left, cy = (a.y + b.y) / 2 - r.top;
      if (Math.abs(d - gesture.d0) > 10) gesture.moved = true;
      view.s = Math.min(Math.max(gesture.s0 * (d / gesture.d0), view.fit * 0.6), view.fit * MAX_ZOOM);
      view.tx = cx - gesture.px * view.s;
      view.ty = cy - gesture.py * view.s;
      if (Math.hypot(cx - (gesture.lcx ?? cx), cy - (gesture.lcy ?? cy)) > 6) gesture.moved = true;
      gesture.lcx = gesture.lcx ?? cx; gesture.lcy = gesture.lcy ?? cy;
      applyView();
    }
  }

  let lastTap = 0;
  function gestureEnd(upPoint) {
    if (!gesture) return;
    const g = gesture;
    const quick = performance.now() - g.t0 < 300;
    if (touches.size > 0) {
      // Пальцы отрываются не одновременно. Если это было касание двумя-тремя пальцами (отмена/повтор),
      // ждём, пока поднимутся все. Если был щипок — оставшийся палец продолжает сдвигать страницу.
      if (g.kind === 'pinch' && (g.moved || !quick)) { gestureStart(); gesture.moved = true; gesture.fingers = g.fingers; gesture.t0 = g.t0; }
      return;
    }
    gesture = null;
    if (!g.moved && quick && g.fingers === 1 && upPoint) {
      const p = toPage(upPoint.x, upPoint.y);
      const st = topStickerAt(p.x, p.y);
      if (st || selected) { selected = st ? st.id : null; updateSel(); clampView(); return; }
    }
    if (!g.moved && quick && g.fingers === 2) { undo(); toast('Отменено'); }
    else if (!g.moved && quick && g.fingers >= 3) { redo(); toast('Повторено'); }
    else if (g.kind === 'one' && !isZoomed() && upPoint) {
      const dx = upPoint.x - g.sx, dy = upPoint.y - g.sy;
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.4) {
        if (dx < 0 && idx < pages.length - 1) goTo(idx + 1);
        else if (dx > 0 && idx > 0) goTo(idx - 1);
      } else if (!g.moved && quick) {
        const now = performance.now();
        if (now - lastTap < 320) { fitView(); hideDetail(); }
        lastTap = now;
      }
    } else if (g.kind === 'one' && !g.moved && quick) {
      const now = performance.now();
      if (now - lastTap < 320) { fitView(); hideDetail(); lastTap = 0; return; }
      lastTap = now;
    }
    clampView();
    scheduleDetail();
  }

  // ---------- стикеры ----------
  const stickerEls = new Map();
  let selected = null;   // id выбранного стикера
  let stickOp = null;    // перенос или поворот стикера
  function stickerById(id) { return page.stickers.find((x) => x.id === id); }
  function renderStickers() {
    stickerLayer.innerHTML = '';
    stickerEls.clear();
    for (const st of page.stickers) { const el = stk.renderSticker(st); stickerLayer.append(el); stickerEls.set(st.id, el); }
    updateSel();
  }
  function updateSel() {
    const st = selected && stickerById(selected);
    if (!st) { selBox.hidden = true; selected = null; return; }
    const { w, h: hh } = stk.baseSize(st);
    selBox.hidden = false;
    selBox.style.width = w + 'px';
    selBox.style.height = hh + 'px';
    selBox.style.transform = `translate(${st.x - w / 2}px, ${st.y - hh / 2}px) rotate(${st.r}rad) scale(${st.s})`;
    selBox.style.setProperty('--k', 1 / (st.s * view.s)); // ручки одного размера на экране при любом масштабе
    selBox.classList.toggle('has-text', stk.isLabel(st.key));
  }
  function handleAt(st, x, y) {
    const { w, h: hh } = stk.baseSize(st);
    const R = 28 / view.s;
    const spots = [['del', -w / 2, -hh / 2], ['scale', w / 2, hh / 2]];
    if (stk.isLabel(st.key)) spots.push(['text', w / 2, -hh / 2]);
    for (const [k, lx, ly] of spots) { const p = stk.fromLocal(st, lx, ly); if (Math.hypot(p.x - x, p.y - y) < R) return k; }
    return stk.hit(st, x, y, 6 / view.s) ? 'move' : null;
  }
  function topStickerAt(x, y) {
    for (let i = page.stickers.length - 1; i >= 0; i--) if (stk.hit(page.stickers[i], x, y)) return page.stickers[i];
    return null;
  }
  function beginStickOp(kind, st, e, pt) {
    stickOp = { kind, id: st.id, pid: e.pointerId, before: { ...st }, start: pt };
    hideDetail();
  }
  function moveStickOp(e) {
    const st = stickerById(stickOp.id);
    if (!st) return;
    const p = toPage(e.clientX, e.clientY);
    const b = stickOp.before;
    if (stickOp.kind === 'move') {
      st.x = Math.min(PAGE_W, Math.max(0, b.x + p.x - stickOp.start.x));
      st.y = Math.min(PAGE_H, Math.max(0, b.y + p.y - stickOp.start.y));
    } else {
      // уголок: расстояние до центра — размер, угол — поворот (рядом с прямыми углами прилипает)
      const { w, h: hh } = stk.baseSize(st);
      const dx = p.x - st.x, dy = p.y - st.y;
      st.s = Math.min(6, Math.max(0.25, Math.hypot(dx, dy) / Math.hypot(w / 2, hh / 2)));
      let r = Math.atan2(dy, dx) - Math.atan2(hh / 2, w / 2);
      const snap = Math.round(r / (Math.PI / 4)) * (Math.PI / 4);
      if (Math.abs(r - snap) < 0.07) r = snap;
      st.r = r;
    }
    stk.placeSticker(stickerEls.get(st.id), st);
    updateSel();
  }
  function endStickOp() {
    const st = stickerById(stickOp.id), b = stickOp.before;
    stickOp = null;
    if (st && (b.x !== st.x || b.y !== st.y || b.s !== st.s || b.r !== st.r)) {
      history.push({ type: 'stEdit', id: st.id, before: b, after: { ...st } });
      future = [];
      updateUndo();
      scheduleSave();
    }
    scheduleDetail();
  }
  async function addSticker() {
    const key = await dialog({ title: 'Стикеры', render: stk.pickerBody, actions: [{ label: 'Закрыть', value: null }] });
    if (!key) return;
    const r = vp.getBoundingClientRect();
    const c = toPage(r.left + vp.clientWidth / 2, r.top + availH() / 2);
    const st = { id: db.uid(), key, x: Math.min(PAGE_W - 80, Math.max(80, c.x)), y: Math.min(PAGE_H - 80, Math.max(80, c.y)), s: 1, r: 0 };
    const { w, h: hh } = stk.baseSize(st);
    st.s = Math.min(2, Math.max(0.4, 160 / view.s / Math.max(w, hh))); // около 160 точек на экране
    page.stickers.push(st);
    const el = stk.renderSticker(st);
    stickerLayer.append(el);
    stickerEls.set(st.id, el);
    selected = st.id;
    updateSel();
    history.push({ type: 'stAdd', st: { ...st } });
    future = [];
    updateUndo();
    scheduleSave();
    toast('Тяните за середину, уголок — размер и поворот');
  }
  function deleteSticker(st) {
    const index = page.stickers.findIndex((x) => x.id === st.id);
    if (index < 0) return;
    page.stickers.splice(index, 1);
    stickerEls.get(st.id)?.remove();
    stickerEls.delete(st.id);
    selected = null;
    updateSel();
    history.push({ type: 'stDel', st: { ...st }, index });
    future = [];
    updateUndo();
    scheduleSave();
  }
  async function editText(st) {
    const value = await dialog({
      title: 'Текст метки',
      render: (body) => {
        const input = h('input', { class: 'field', type: 'text', maxlength: 24, value: stk.labelInfo(st).text, 'aria-label': 'Текст метки' });
        body.append(input);
        setTimeout(() => { input.focus(); input.select(); }, 50);
        return { value: () => input.value };
      },
      actions: [{ label: 'Отмена', value: null }, { label: 'Готово', primary: true }],
    });
    if (value == null) return;
    const before = { ...st };
    st.text = value.trim() || stk.labelInfo({ key: st.key }).text;
    const old = stickerEls.get(st.id);
    const el = stk.renderSticker(st);
    old.replaceWith(el);
    stickerEls.set(st.id, el);
    updateSel();
    history.push({ type: 'stEdit', id: st.id, before, after: { ...st } });
    future = [];
    updateUndo();
    scheduleSave();
  }

  // ---------- указатели ----------
  const capture = (id) => { try { vp.setPointerCapture(id); } catch { /* указатель уже отпущен — не страшно */ } };
  function onDown(e) {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke || stickOp) return; // уже рисуем или двигаем стикер
    if (selected && !(e.pointerType === 'touch' && (touches.size || performance.now() < penUntil))) {
      const st = stickerById(selected);
      const pt = toPage(e.clientX, e.clientY);
      const hnd = st && handleAt(st, pt.x, pt.y);
      if (hnd === 'del') { e.preventDefault(); deleteSticker(st); return; }
      if (hnd === 'text') { e.preventDefault(); editText(st); return; }
      if (hnd === 'move' || hnd === 'scale') { e.preventDefault(); capture(e.pointerId); beginStickOp(hnd, st, e, pt); return; }
      if (e.pointerType !== 'touch') { selected = null; updateSel(); } // карандашом мимо — снять выбор и рисовать
    }
    if (canDraw(e)) {
      if (e.pointerType === 'pen' && touches.size) { touches.clear(); gesture = null; clampView(); }
      e.preventDefault();
      capture(e.pointerId);
      startStroke(e);
      return;
    }
    if (e.pointerType === 'touch') {
      if (performance.now() < penUntil) return; // ладонь, пока рядом карандаш
      e.preventDefault();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      capture(e.pointerId);
      gestureStart();
    }
  }
  function onMove(e) {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke && e.pointerId === strokePtr) { e.preventDefault(); if (!stroke.snapped) addPoints(e); return; }
    if (stickOp && e.pointerId === stickOp.pid) { e.preventDefault(); moveStickOp(e); return; }
    if (touches.has(e.pointerId)) {
      e.preventDefault();
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      gestureMove();
    }
  }
  function onUp(e) {
    if (e.pointerType === 'pen') penUntil = performance.now() + PEN_GUARD_MS;
    if (stroke && e.pointerId === strokePtr) {
      if (e.type === 'pointercancel') cancelStroke(); else endStroke();
      return;
    }
    if (stickOp && e.pointerId === stickOp.pid) { endStickOp(); return; }
    if (touches.has(e.pointerId)) {
      touches.delete(e.pointerId);
      gestureEnd({ x: e.clientX, y: e.clientY });
    }
  }
  vp.addEventListener('pointerdown', onDown);
  vp.addEventListener('pointermove', onMove);
  vp.addEventListener('pointerup', onUp);
  vp.addEventListener('pointercancel', onUp);
  // Safari: не давать странице масштабироваться и выделять текст под пальцем и карандашом
  const stopTouch = (e) => { if (e.cancelable) e.preventDefault(); };
  vp.addEventListener('touchstart', stopTouch, { passive: false });
  vp.addEventListener('touchmove', stopTouch, { passive: false });
  const stopGesture = (e) => e.preventDefault();
  document.addEventListener('gesturestart', stopGesture);
  document.addEventListener('gesturechange', stopGesture);

  // колесо и трекпад (для проверки на компьютере)
  vp.addEventListener('wheel', (e) => {
    e.preventDefault();
    hideDetail();
    const r = vp.getBoundingClientRect();
    if (e.ctrlKey || e.metaKey) {
      const cx = e.clientX - r.left, cy = e.clientY - r.top;
      const px = (cx - view.tx) / view.s, py = (cy - view.ty) / view.s;
      view.s = Math.min(Math.max(view.s * Math.exp(-e.deltaY * 0.01), view.fit * 0.9), view.fit * MAX_ZOOM);
      view.tx = cx - px * view.s; view.ty = cy - py * view.s;
    } else { view.tx -= e.deltaX; view.ty -= e.deltaY; }
    clampView();
    scheduleDetail(180);
  }, { passive: false });

  const onKey = (e) => {
    if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
  };
  document.addEventListener('keydown', onKey);

  // ---------- страницы ----------
  async function goTo(i) {
    if (i === idx || i < 0 || i >= pages.length) return;
    await flushSave();
    idx = i;
    fitView();
    showPage();
  }
  async function addPage(paper) {
    await flushSave();
    const p = newPage(nb.id, paper);
    pages.splice(idx + 1, 0, p);
    nb.pageIds = pages.map((x) => x.id);
    nb.paper = paper;
    await db.put('pages', p);
    await db.put('notebooks', nb);
    idx += 1;
    fitView();
    showPage();
    toast(`Новая страница: ${ink.PAPERS[paper].toLowerCase()}`);
  }
  async function deletePage() {
    if (pages.length === 1) { toast('Это единственная страница — её можно очистить'); return; }
    const ok = await confirmDialog('Удалить страницу?', `Страница ${idx + 1} исчезнет вместе с рисунком. Вернуть её не получится.`);
    if (!ok) return;
    const [gone] = pages.splice(idx, 1);
    nb.pageIds = pages.map((x) => x.id);
    savePending = false;
    await db.del('pages', gone.id);
    await db.put('notebooks', nb);
    idx = Math.min(idx, pages.length - 1);
    showPage();
  }
  function choosePaper() {
    sheet({
      title: 'Новая страница',
      items: Object.entries(ink.PAPERS).map(([k, label]) => ({ label, icon: 'page', onClick: () => addPage(k) })),
    });
  }

  // ---------- экспорт ----------
  async function exportPng() {
    await flushSave();
    const c = document.createElement('canvas');
    c.width = PAGE_W * RS; c.height = PAGE_H * RS;
    const g = c.getContext('2d');
    g.setTransform(RS, 0, 0, RS, 0, 0);
    ink.drawPaper(g, page.paper);
    await stk.drawStickers(g, page.stickers);
    g.setTransform(1, 0, 0, 1, 0, 0);
    g.drawImage(inkCanvas, 0, 0);
    const blob = await new Promise((res) => c.toBlob(res, 'image/png'));
    if (!blob) { toast('Не получилось сделать картинку'); return; }
    const name = `${nb.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Блокнот'} — стр ${idx + 1}.png`;
    const how = await saveFile(blob, name);
    if (how === 'downloaded') toast('PNG сохранён');
  }

  // ---------- меню ----------
  function moreMenu() {
    sheet({
      title: nb.title,
      items: [
        { label: 'Добавить страницу', icon: 'plus', onClick: choosePaper },
        { label: 'Очистить страницу', icon: 'clear', onClick: clearPage },
        { label: 'Удалить страницу', icon: 'trash', danger: true, onClick: deletePage },
        { separator: true },
        { label: 'Рисовать пальцем', icon: 'hand', checked: !!settings.fingerDraw, onClick: () => { settings.fingerDraw = !settings.fingerDraw; db.setMeta('fingerDraw', settings.fingerDraw); toast(settings.fingerDraw ? 'Палец рисует, двумя пальцами — листать и масштаб' : 'Палец листает и масштабирует, рисует только карандаш'); } },
        { label: 'Фигуры по удержанию', icon: 'shape', checked: settings.shapes !== false, onClick: () => { settings.shapes = settings.shapes === false; db.setMeta('shapes', settings.shapes); toast(settings.shapes ? 'Нарисуйте фигуру и задержите карандаш — она выровняется' : 'Фигуры остаются как нарисованы'); } },
        { label: 'Вся страница целиком', icon: 'fit', onClick: () => { fitView(); hideDetail(); } },
      ],
    });
  }

  // ---------- панель инструментов ----------
  function buildDock() {
    const el = h('div', { class: 'dock', role: 'toolbar', 'aria-label': 'Инструменты' });
    const tools = h('div', { class: 'dock-tools' });
    const toolBtns = {};
    for (const [k, t] of Object.entries(ink.TOOLS)) {
      const b = h('button', { class: 'tool-btn', type: 'button', 'aria-label': t.name, title: t.name, 'data-tool': k }, `${icon(k, 24)}<span>${t.name}</span>`);
      b.addEventListener('click', () => { prefs.tool = k; syncDock(); savePrefs(); });
      toolBtns[k] = b;
      tools.append(b);
    }
    const swatches = h('div', { class: 'dock-swatches', role: 'radiogroup', 'aria-label': 'Цвет' });
    const swBtns = [];
    for (const c of ink.PALETTE) {
      const b = h('button', { class: 'swatch', type: 'button', role: 'radio', 'aria-label': c.name, title: c.name, style: `--c:${c.hex}` });
      b.addEventListener('click', () => { prefs.color = c.hex; if (prefs.tool === 'eraser') prefs.tool = 'pen'; syncDock(); savePrefs(); });
      swBtns.push([c.hex, b]);
      swatches.append(b);
    }
    const sizeBox = h('label', { class: 'dock-size' });
    const dot = h('span', { class: 'size-dot', 'aria-hidden': 'true' });
    const range = h('input', { type: 'range', min: 1, max: 100, 'aria-label': 'Толщина' });
    range.addEventListener('input', () => {
      const t = ink.TOOLS[prefs.tool];
      prefs.sizes[prefs.tool] = Math.round(t.min + (t.max - t.min) * (range.value / 100) ** 1.6);
      syncDot();
    });
    range.addEventListener('change', savePrefs);
    sizeBox.append(dot, range);
    el.append(tools, h('span', { class: 'dock-sep' }), swatches, h('span', { class: 'dock-sep' }), sizeBox);

    function syncDot() {
      const sz = prefs.sizes[prefs.tool];
      const px = Math.max(3, Math.min(30, sz * 0.75));
      dot.style.width = dot.style.height = px + 'px';
      dot.style.background = prefs.tool === 'eraser' ? 'transparent' : prefs.color;
      dot.style.opacity = prefs.tool === 'marker' ? 0.5 : 1;
      dot.classList.toggle('eraser', prefs.tool === 'eraser');
    }
    function syncDock() {
      for (const [k, b] of Object.entries(toolBtns)) { b.classList.toggle('on', k === prefs.tool); b.setAttribute('aria-pressed', k === prefs.tool); }
      for (const [hex, b] of swBtns) { const on = hex === prefs.color; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); }
      swatches.classList.toggle('muted', prefs.tool === 'eraser');
      const t = ink.TOOLS[prefs.tool];
      range.value = Math.round(100 * ((prefs.sizes[prefs.tool] - t.min) / (t.max - t.min)) ** (1 / 1.6));
      syncDot();
    }
    return { el, sync: syncDock };
  }
  function savePrefs() { db.setMeta('toolPrefs', prefs); }

  // ---------- кнопки ----------
  btnBack.addEventListener('click', async () => { await flushSave(); onBack(); });
  btnPrev.addEventListener('click', () => goTo(idx - 1));
  btnNext.addEventListener('click', () => goTo(idx + 1));
  btnAdd.addEventListener('click', choosePaper);
  btnUndo.addEventListener('click', undo);
  btnRedo.addEventListener('click', redo);
  btnExport.addEventListener('click', exportPng);
  btnMore.addEventListener('click', moreMenu);
  btnSticker.addEventListener('click', addSticker);

  const ro = new ResizeObserver(() => { fitView(); hideDetail(); });
  ro.observe(vp);

  dock.sync();
  fitView();
  showPage();

  // для автотестов: состояние без доступа к внутренностям
  window.__pastel = { get stickers() { return page.stickers.length; }, get selected() { return selected; }, get lastShape() { const s = page.strokes[page.strokes.length - 1]; return s ? s.pts.length / STRIDE : 0; }, get strokes() { return page.strokes.length; }, get page() { return idx; }, get pages() { return pages.length; }, get zoom() { return view.s / view.fit; }, flushSave };

  return async function cleanup() {
    await flushSave();
    ro.disconnect();
    document.removeEventListener('visibilitychange', onHide);
    window.removeEventListener('pagehide', flushSave);
    document.removeEventListener('keydown', onKey);
    document.removeEventListener('gesturestart', stopGesture);
    document.removeEventListener('gesturechange', stopGesture);
    delete window.__pastel;
  };
}

export function blankPage(notebookId, paper) {
  return { id: db.uid(), notebookId, paper, strokes: [], updatedAt: Date.now() };
}

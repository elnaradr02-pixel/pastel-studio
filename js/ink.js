// Движок штрихов: как рисуются ручка, карандаш, маркер и ластик.
// Штрих хранится как список точек в единицах страницы: x, y, ширина, прозрачность (по 4 числа на точку).
// Одна и та же функция рисует штрих вживую, при отмене и при экспорте, поэтому картинка всегда совпадает.

export const PAGE_W = 1200;
export const PAGE_H = 1600;
export const STRIDE = 4; // x, y, w, a

// 12 цветов под тёплую пастельную бумагу: тёмные для письма, мягкие для заметок и выделения.
export const PALETTE = [
  { hex: '#3A3236', name: 'Графит' },
  { hex: '#6B4F3F', name: 'Кофе' },
  { hex: '#8E3B5A', name: 'Ягода' },
  { hex: '#C8775A', name: 'Терракота' },
  { hex: '#D48A9E', name: 'Пыльная роза' },
  { hex: '#EDA98C', name: 'Персик' },
  { hex: '#E3B85C', name: 'Мёд' },
  { hex: '#8FAE8B', name: 'Шалфей' },
  { hex: '#5F7A55', name: 'Оливка' },
  { hex: '#86AECB', name: 'Голубая дымка' },
  { hex: '#4F5D8A', name: 'Сумерки' },
  { hex: '#B39DD3', name: 'Лаванда' },
];

export const TOOLS = {
  pen: { name: 'Ручка', min: 1, max: 20, def: 4 },
  pencil: { name: 'Карандаш', min: 2, max: 24, def: 6 },
  marker: { name: 'Маркер', min: 8, max: 60, def: 24 },
  eraser: { name: 'Ластик', min: 8, max: 120, def: 36 },
};

// ---------- случайные числа с зерном: карандаш выглядит одинаково при каждой перерисовке ----------
export function rng(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ---------- зерно карандаша: маленький шершавый «отпечаток», окрашенный в цвет ----------
const dabCache = new Map();
function pencilDab(hex) {
  if (dabCache.has(hex)) return dabCache.get(hex);
  const S = 64;
  const c = document.createElement('canvas');
  c.width = c.height = S;
  const g = c.getContext('2d');
  const r = rng(7);
  g.fillStyle = hex;
  for (let i = 0; i < 1100; i++) {
    const ang = r() * Math.PI * 2;
    const rad = Math.sqrt(r()) * (S / 2 - 2);
    const x = S / 2 + Math.cos(ang) * rad;
    const y = S / 2 + Math.sin(ang) * rad;
    g.globalAlpha = 0.18 + r() * 0.5 * (1 - rad / (S / 2));
    g.fillRect(x, y, 1.6, 1.6);
  }
  dabCache.set(hex, c);
  return c;
}

function hexToRgba(hex, a) {
  const n = parseInt(hex.slice(1), 16);
  return `rgba(${(n >> 16) & 255},${(n >> 8) & 255},${n & 255},${a})`;
}

// ---------- рисование частей штриха ----------
// Ручка и ластик: сглаженные кривые через середины соседних точек, ширина меняется от точки к точке.
function drawSmoothSegments(ctx, p, from, to) {
  // рисует куски между точками from..to (индексы точек), каждый кусок — своей ширины
  for (let i = Math.max(from, 1); i <= to; i++) {
    const i0 = (i - 1) * STRIDE;
    const i1 = i * STRIDE;
    const x0 = p[i0], y0 = p[i0 + 1], x1 = p[i1], y1 = p[i1 + 1];
    ctx.lineWidth = (p[i0 + 2] + p[i1 + 2]) / 2;
    ctx.beginPath();
    if (i >= 2) {
      const ip = (i - 2) * STRIDE;
      const mx0 = (p[ip] + x0) / 2, my0 = (p[ip + 1] + y0) / 2;
      ctx.moveTo(mx0, my0);
    } else {
      ctx.moveTo(x0, y0);
    }
    const mx1 = (x0 + x1) / 2, my1 = (y0 + y1) / 2;
    ctx.quadraticCurveTo(x0, y0, mx1, my1);
    if (i === to) ctx.lineTo(x1, y1);
    ctx.stroke();
  }
  if (to === 0) {
    // одна точка — аккуратная капля
    ctx.beginPath();
    ctx.arc(p[0], p[1], p[2] / 2, 0, Math.PI * 2);
    ctx.fill();
  }
}

// Карандаш: шершавые отпечатки вдоль линии, частые наложения дают тон, как у грифеля.
function drawPencilDabs(ctx, s, from, to) {
  const p = s.pts;
  const dab = pencilDab(s.color);
  for (let i = Math.max(from, 1); i <= to; i++) {
    const r = rng(s.seed + i * 131); // своё зерно у каждого куска: вживую и при перерисовке выходит одинаково
    const i0 = (i - 1) * STRIDE, i1 = i * STRIDE;
    const x0 = p[i0], y0 = p[i0 + 1], x1 = p[i1], y1 = p[i1 + 1];
    const w0 = p[i0 + 2], w1 = p[i1 + 2], a0 = p[i0 + 3], a1 = p[i1 + 3];
    const dist = Math.hypot(x1 - x0, y1 - y0);
    const step = Math.max(0.5, Math.min(w0, w1) * 0.16);
    const n = Math.max(1, Math.ceil(dist / step));
    for (let k = 0; k < n; k++) {
      const t = k / n;
      const x = x0 + (x1 - x0) * t, y = y0 + (y1 - y0) * t;
      const w = w0 + (w1 - w0) * t;
      ctx.globalAlpha = (a0 + (a1 - a0) * t) * (0.5 + r() * 0.35);
      const rot = r() * Math.PI * 2;
      ctx.save();
      ctx.translate(x, y);
      ctx.rotate(rot);
      ctx.drawImage(dab, -w / 2, -w / 2, w, w);
      ctx.restore();
    }
  }
  if (to === 0) {
    ctx.globalAlpha = p[3] * 0.7;
    ctx.drawImage(dab, p[0] - p[2] / 2, p[1] - p[2] / 2, p[2], p[2]);
  }
  ctx.globalAlpha = 1;
}

// Маркер: одна линия постоянной ширины одним мазком — прозрачность не темнеет на изгибах.
function markerPath(ctx, p, n) {
  ctx.beginPath();
  ctx.moveTo(p[0], p[1]);
  if (n === 1) { ctx.lineTo(p[0] + 0.01, p[1]); return; }
  for (let i = 1; i < n; i++) {
    const i0 = (i - 1) * STRIDE, i1 = i * STRIDE;
    const mx = (p[i0] + p[i1]) / 2, my = (p[i0 + 1] + p[i1 + 1]) / 2;
    ctx.quadraticCurveTo(p[i0], p[i0 + 1], mx, my);
  }
  const last = (n - 1) * STRIDE;
  ctx.lineTo(p[last], p[last + 1]);
}

export const MARKER_ALPHA = 0.38;

function prep(ctx, s) {
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = 'source-over';
  if (s.tool === 'eraser') {
    ctx.globalCompositeOperation = 'destination-out';
    ctx.strokeStyle = ctx.fillStyle = '#000';
  } else {
    ctx.strokeStyle = ctx.fillStyle = s.color;
  }
}

// Дорисовать новые точки штриха (живое рисование). Маркер так не рисуется — его перерисовывают целиком.
export function drawIncrement(ctx, s, from, to) {
  ctx.save();
  prep(ctx, s);
  if (s.tool === 'pencil') drawPencilDabs(ctx, s, from, to);
  else drawSmoothSegments(ctx, s.pts, from, to);
  ctx.restore();
}

export function drawMarker(ctx, s, n) {
  ctx.save();
  prep(ctx, s);
  ctx.globalAlpha = MARKER_ALPHA;
  ctx.globalCompositeOperation = 'multiply';
  ctx.lineWidth = s.size;
  markerPath(ctx, s.pts, n);
  ctx.stroke();
  ctx.restore();
}

// Полная отрисовка готового штриха.
export function renderStroke(ctx, s) {
  const n = s.pts.length / STRIDE;
  if (!n) return;
  if (s.tool === 'marker') return drawMarker(ctx, s, n);
  drawIncrement(ctx, s, 0, n - 1);
}

// Границы штриха (для обрезки при перерисовке), кэшируются на объекте.
export function bounds(s) {
  if (s._b) return s._b;
  const p = s.pts;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, wmax = s.tool === 'marker' ? s.size : 0;
  for (let i = 0; i < p.length; i += STRIDE) {
    if (p[i] < x0) x0 = p[i];
    if (p[i] > x1) x1 = p[i];
    if (p[i + 1] < y0) y0 = p[i + 1];
    if (p[i + 1] > y1) y1 = p[i + 1];
    if (p[i + 2] > wmax) wmax = p[i + 2];
  }
  const pad = wmax / 2 + 2;
  s._b = { x0: x0 - pad, y0: y0 - pad, x1: x1 + pad, y1: y1 + pad };
  return s._b;
}

// ---------- бумага ----------
export const PAPERS = {
  blank: 'Пустая',
  grid: 'Клетка',
  dots: 'Точки',
  lines: 'Линейка',
  week: 'Неделя',
  todo: 'Список дел',
  habits: 'Привычки',
  cornell: 'Корнелл',
};
// шаблоны с надписями рисуются один раз на холсте и дальше служат фоном страницы
export const TEMPLATES = ['week', 'todo', 'habits', 'cornell'];
export function isTemplate(type) { return TEMPLATES.includes(type); }
export const PAPER_BG = '#FFFBF6';
const GRID = 50;
const LINE_GAP = 56;
const LINE_TOP = 168;
const MARGIN_X = 112;

// ---------- шаблоны страниц ----------
const T_LINE = 'rgba(176,128,140,0.30)';
const T_BOX = 'rgba(176,128,140,0.45)';
const T_HEAD = '#A9566F';
const T_LABEL = '#8C7B80';
const TPL_SCALE = 2;
const tplCache = new Map();

function tplTitle(g, text, right) {
  g.fillStyle = T_HEAD; g.font = '700 54px Comfortaa, Nunito, sans-serif'; g.textBaseline = 'alphabetic';
  g.fillText(text, 80, 128);
  if (right) {
    g.fillStyle = T_LABEL; g.font = '700 26px Nunito, sans-serif';
    const w = g.measureText(right).width;
    g.fillText(right, 760 - w - 14, 124);
    g.strokeStyle = T_BOX; g.lineWidth = 2; g.beginPath(); g.moveTo(760, 128); g.lineTo(1120, 128); g.stroke();
  }
}
function tplBox(g, x, y, w, hh, label, lines = 0, gap = 54, top = 74) {
  g.strokeStyle = T_BOX; g.lineWidth = 2.4; g.beginPath(); g.roundRect(x, y, w, hh, 22); g.stroke();
  if (label) { g.fillStyle = T_HEAD; g.font = '800 26px Nunito, sans-serif'; g.textBaseline = 'alphabetic'; g.fillText(label, x + 24, y + 44); }
  if (lines) {
    g.strokeStyle = T_LINE; g.lineWidth = 1.6; g.beginPath();
    for (let yy = y + top; yy < y + hh - 18; yy += gap) { g.moveTo(x + 22, yy); g.lineTo(x + w - 22, yy); }
    g.stroke();
  }
}
const TPL_DRAW = {
  week(g) {
    tplTitle(g, 'Неделя', 'даты');
    const days = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье', 'Заметки'];
    const x0 = 70, y0 = 180, cw = 520, gx = 20, ch = 320, gy = 20;
    days.forEach((d, i) => tplBox(g, x0 + (i % 2) * (cw + gx), y0 + Math.floor(i / 2) * (ch + gy), cw, ch, d, 1, 52, 96));
  },
  todo(g) {
    tplTitle(g, 'Список дел', 'дата');
    tplBox(g, 70, 180, 1060, 250, 'Главное на сегодня');
    g.strokeStyle = T_LINE; g.lineWidth = 1.6;
    for (let i = 0; i < 3; i++) {
      const y = 262 + i * 56;
      g.fillStyle = T_HEAD; g.font = '800 24px Nunito, sans-serif'; g.fillText(String(i + 1), 100, y + 4);
      g.beginPath(); g.moveTo(132, y + 10); g.lineTo(1100, y + 10); g.stroke();
    }
    g.fillStyle = T_HEAD; g.font = '800 26px Nunito, sans-serif'; g.fillText('Дела', 94, 500);
    for (let y = 560; y < 1540; y += 62) {
      g.strokeStyle = T_BOX; g.lineWidth = 2.2; g.beginPath(); g.roundRect(92, y - 34, 30, 30, 8); g.stroke();
      g.strokeStyle = T_LINE; g.lineWidth = 1.6; g.beginPath(); g.moveTo(140, y); g.lineTo(1110, y); g.stroke();
    }
  },
  habits(g) {
    tplTitle(g, 'Привычки', 'месяц');
    const x0 = 70, nameW = 300, x1 = 1130, y0 = 190, rows = 14, rh = 70;
    const dw = (x1 - x0 - nameW) / 31;
    g.fillStyle = T_LABEL; g.font = '700 17px Nunito, sans-serif'; g.textAlign = 'center';
    for (let d = 1; d <= 31; d++) g.fillText(String(d), x0 + nameW + dw * (d - 0.5), y0 + 40);
    g.textAlign = 'left';
    g.fillStyle = T_HEAD; g.font = '800 24px Nunito, sans-serif'; g.fillText('Привычка', x0 + 20, y0 + 42);
    const top = y0 + 60, bottom = top + rows * rh;
    g.strokeStyle = T_BOX; g.lineWidth = 2.4; g.beginPath(); g.roundRect(x0, y0, x1 - x0, bottom - y0, 22); g.stroke();
    g.strokeStyle = T_LINE; g.lineWidth = 1.4; g.beginPath();
    for (let r = 0; r <= rows; r++) { g.moveTo(x0, top + r * rh); g.lineTo(x1, top + r * rh); }
    for (let d = 0; d < 31; d++) { const x = x0 + nameW + dw * d; g.moveTo(x, y0 + 8); g.lineTo(x, bottom); }
    g.stroke();
    tplBox(g, x0, bottom + 40, x1 - x0, 1540 - bottom - 40, 'Заметки месяца', 1, 54, 96);
  },
  cornell(g) {
    g.fillStyle = T_LABEL; g.font = '700 26px Nunito, sans-serif'; g.textBaseline = 'alphabetic';
    g.fillText('Тема', 80, 110); g.fillText('Дата', 820, 110);
    g.strokeStyle = T_BOX; g.lineWidth = 2; g.beginPath(); g.moveTo(160, 114); g.lineTo(780, 114); g.moveTo(896, 114); g.lineTo(1120, 114); g.stroke();
    const top = 170, split = 380, bottom = 1250;
    g.strokeStyle = T_BOX; g.lineWidth = 2.4; g.beginPath(); g.roundRect(70, top, 1060, bottom - top, 22); g.moveTo(split, top); g.lineTo(split, bottom); g.stroke();
    g.fillStyle = T_HEAD; g.font = '800 24px Nunito, sans-serif';
    g.fillText('Вопросы, слова', 92, top + 44); g.fillText('Конспект', split + 24, top + 44);
    g.strokeStyle = T_LINE; g.lineWidth = 1.6; g.beginPath();
    for (let y = top + 96; y < bottom - 16; y += 54) { g.moveTo(92, y); g.lineTo(split - 20, y); g.moveTo(split + 22, y); g.lineTo(1108, y); }
    g.stroke();
    tplBox(g, 70, bottom + 30, 1060, 1540 - bottom - 30, 'Итог', 1, 54, 96);
  },
};
// нарисовать шаблон (один раз): ждём шрифты, иначе надписи выйдут запасным шрифтом
export async function ensurePaper(type) {
  if (!isTemplate(type) || tplCache.has(type)) return;
  try { await Promise.all([document.fonts.load('700 54px Comfortaa', 'Неделя Aa'), document.fonts.load('800 26px Nunito', 'Понедельник 123'), document.fonts.load('700 26px Nunito', 'дата 123')]); } catch { /* запасной шрифт */ }
  if (tplCache.has(type)) return;
  const c = document.createElement('canvas');
  c.width = PAGE_W * TPL_SCALE; c.height = PAGE_H * TPL_SCALE;
  const g = c.getContext('2d');
  g.scale(TPL_SCALE, TPL_SCALE);
  g.fillStyle = PAPER_BG; g.fillRect(0, 0, PAGE_W, PAGE_H);
  TPL_DRAW[type](g);
  tplCache.set(type, { canvas: c, url: c.toDataURL('image/png') });
}
export function ensureAllPapers() { return Promise.all(TEMPLATES.map(ensurePaper)); }

// Бумага для экспорта и для чёткой отрисовки при увеличении.
export function drawPaper(ctx, type, x0 = 0, y0 = 0, x1 = PAGE_W, y1 = PAGE_H) {
  ctx.save();
  ctx.fillStyle = PAPER_BG;
  ctx.fillRect(0, 0, PAGE_W, PAGE_H);
  if (isTemplate(type)) {
    const t = tplCache.get(type);
    if (t) ctx.drawImage(t.canvas, 0, 0, PAGE_W, PAGE_H);
  } else if (type === 'grid') {
    ctx.strokeStyle = 'rgba(176,128,140,0.22)';
    ctx.lineWidth = 1.4;
    ctx.beginPath();
    for (let x = GRID; x < PAGE_W; x += GRID) if (x >= x0 - GRID && x <= x1 + GRID) { ctx.moveTo(x, 0); ctx.lineTo(x, PAGE_H); }
    for (let y = GRID; y < PAGE_H; y += GRID) if (y >= y0 - GRID && y <= y1 + GRID) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    ctx.stroke();
  } else if (type === 'dots') {
    ctx.fillStyle = 'rgba(150,112,124,0.42)';
    for (let y = GRID; y < PAGE_H; y += GRID) {
      if (y < y0 - GRID || y > y1 + GRID) continue;
      for (let x = GRID; x < PAGE_W; x += GRID) {
        if (x < x0 - GRID || x > x1 + GRID) continue;
        ctx.beginPath(); ctx.arc(x, y, 2.4, 0, Math.PI * 2); ctx.fill();
      }
    }
  } else if (type === 'lines') {
    ctx.strokeStyle = 'rgba(120,150,190,0.30)';
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    for (let y = LINE_TOP; y < PAGE_H - 40; y += LINE_GAP) { ctx.moveTo(0, y); ctx.lineTo(PAGE_W, y); }
    ctx.stroke();
    ctx.strokeStyle = 'rgba(214,122,138,0.42)';
    ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(MARGIN_X, 0); ctx.lineTo(MARGIN_X, PAGE_H); ctx.stroke();
  }
  ctx.restore();
}

// Та же бумага как CSS-фон. k — масштаб: 1 для страницы (элемент PAGE_W×PAGE_H), меньше — для маленьких образцов.
export function paperCss(type, k = 1) {
  const base = `background-color:${PAPER_BG};`;
  if (isTemplate(type)) {
    const t = tplCache.get(type);
    return t ? base + `background-image:url(${t.url});background-size:100% 100%;background-repeat:no-repeat;` : base;
  }
  const px = (v) => +(v * k).toFixed(2);
  const lw = (v) => Math.max(1, px(v));
  if (type === 'grid') {
    const g = px(GRID), t = lw(1.4);
    return base + `background-image:linear-gradient(to right, rgba(176,128,140,.22) ${t}px, transparent ${t}px),linear-gradient(to bottom, rgba(176,128,140,.22) ${t}px, transparent ${t}px);background-size:${g}px ${g}px;background-position:-${t / 2}px -${t / 2}px;`;
  }
  if (type === 'dots') {
    const g = px(GRID), r = Math.max(0.9, px(2.4));
    return base + `background-image:radial-gradient(circle, rgba(150,112,124,.42) ${r}px, transparent ${r + 0.5}px);background-size:${g}px ${g}px;background-position:-${g / 2}px -${g / 2}px;`;
  }
  if (type === 'lines') {
    // линии начинаются с LINE_TOP и кончаются за 40 единиц до низа — так же, как в drawPaper
    const gap = px(LINE_GAP), t = lw(1.6), m = px(MARGIN_X), mt = lw(2);
    const boxTop = px(LINE_TOP - LINE_GAP) + t / 2;
    const boxH = px(PAGE_H - 40) - boxTop;
    return base + `background-image:linear-gradient(to right, transparent ${m - mt / 2}px, rgba(214,122,138,.42) ${m - mt / 2}px, rgba(214,122,138,.42) ${m + mt / 2}px, transparent ${m + mt / 2}px),repeating-linear-gradient(to bottom, transparent 0, transparent ${gap - t}px, rgba(120,150,190,.30) ${gap - t}px, rgba(120,150,190,.30) ${gap}px);background-position:0 0, 0 ${boxTop}px;background-size:100% 100%, 100% ${boxH}px;background-repeat:no-repeat;`;
  }
  return base;
}

export { hexToRgba };

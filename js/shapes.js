// Распознавание фигур: нарисовали и задержали карандаш — штрих становится ровной фигурой.
// Открытые штрихи: прямая линия и стрелка. Замкнутые: круг/овал, прямоугольник, треугольник, сердечко, звезда.
// Замкнутые фигуры сравниваются с шаблонами облаком точек ($P), поэтому неважно, откуда и в какую сторону рисовали.

const N = 48;

export const SHAPE_NAMES = {
  line: 'Линия', arrow: 'Стрелка', circle: 'Круг', ellipse: 'Овал', rect: 'Прямоугольник',
  square: 'Квадрат', triangle: 'Треугольник', heart: 'Сердечко', star: 'Звёздочка',
};

// pts — плоский массив x, y, … с шагом stride. Возвращает { type, outline: [[x,y],…], closed } или null.
export function recognize(flat, stride = 4) {
  const raw = [];
  for (let i = 0; i < flat.length; i += stride) raw.push([flat[i], flat[i + 1]]);
  if (raw.length < 6) return null;
  const len = pathLength(raw);
  const bb = bbox(raw);
  const diag = Math.hypot(bb.w, bb.h);
  if (len < 40 || diag < 25) return null;
  const pts = resample(raw, N);
  const gap = dist(raw[0], raw[raw.length - 1]);

  // ---------- открытые ----------
  if (gap > diag * 0.36) {
    const a = raw[0], b = raw[raw.length - 1];
    const chord = dist(a, b);
    let dev = 0;
    for (const p of pts) dev = Math.max(dev, pointLine(p, a, b));
    if (chord > 30 && dev / chord < 0.07 && len / chord < 1.12) {
      return { type: 'line', outline: dense(snapLine(a, b), 3), closed: false };
    }
    const arrow = detectArrow(raw, diag);
    if (arrow) return arrow;
    return null;
  }

  // ---------- замкнутые ----------
  const cloud = resample(normalize(raw), N); // сначала растянуть в квадрат, потом расставить точки — стороны прямоугольника весят одинаково
  let best = null;
  for (const t of TEMPLATES) {
    const d = cloudMatch(cloud, t.cloud);
    if (!best || d < best.d) best = { name: t.name, d };
  }
  const corners = rdpClosed(raw, diag * 0.09);
  if (globalThis.__shapeDebug) globalThis.__shapeDebug({ best, nc: corners.length - 1, all: TEMPLATES.map((t) => [t.name, +cloudMatch(cloud, t.cloud).toFixed(3)]) });
  const nc = corners.length - 1; // кольцо: первая точка повторена в конце
  let type = best.name;
  if (best.d > 1.55) return null; // ни на что не похоже — оставляем как нарисовано
  if (type === 'rect' && !(nc >= 4 && nc <= 6)) type = best.d < 0.55 ? 'rect' : 'circle';
  if (type === 'triangle' && !(nc >= 3 && nc <= 4)) type = 'circle';
  if (type === 'circle' && nc === 3 && best.d > 0.5) type = 'triangle';
  if (type === 'circle' && nc === 4 && best.d > 0.55) type = 'rect';

  const { x0, y0, w, h } = bb;
  const cx = x0 + w / 2, cy = y0 + h / 2;
  let outline;
  if (type === 'circle') {
    const ratio = w / h;
    if (ratio > 0.82 && ratio < 1.22) { const r = (w + h) / 4; outline = ellipse(cx, cy, r, r); }
    else { outline = ellipse(cx, cy, w / 2, h / 2); type = 'ellipse'; }
  } else if (type === 'rect') {
    const ratio = w / h;
    let rw = w, rh = h;
    if (ratio > 0.88 && ratio < 1.14) { rw = rh = (w + h) / 2; type = 'square'; }
    outline = [[cx - rw / 2, cy - rh / 2], [cx + rw / 2, cy - rh / 2], [cx + rw / 2, cy + rh / 2], [cx - rw / 2, cy + rh / 2], [cx - rw / 2, cy - rh / 2]];
  } else if (type === 'triangle') {
    outline = bestTriangle(corners.slice(0, -1));
    outline.push(outline[0]);
  } else if (type === 'heart') {
    outline = heart(x0, y0, w, h);
  } else if (type === 'star') {
    const r = Math.max(w, h) / 2;
    outline = star(cx, cy + r * 0.05, r);
  }
  return { type, outline: dense(outline, 3), closed: true };
}

// ---------- стрелка: длинное древко и короткая «галочка» на конце ----------
function detectArrow(raw, diag) {
  const v = rdp(raw, diag * 0.07);
  if (v.length < 4) return null;
  const seg = [];
  for (let i = 1; i < v.length; i++) seg.push(dist(v[i - 1], v[i]));
  const total = seg.reduce((s, x) => s + x, 0);
  const shaft = seg[0];
  if (shaft < total * 0.5) return null;
  const tip = v[1];
  const rest = v.slice(2);
  if (!rest.every((p) => dist(p, tip) < shaft * 0.45)) return null;
  const headLen = Math.min(shaft * 0.35, Math.max(18, rest.reduce((s, p) => s + dist(p, tip), 0) / rest.length));
  const [a, b] = snapLine(v[0], tip);
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const l = [b[0] - headLen * Math.cos(ang - 0.5), b[1] - headLen * Math.sin(ang - 0.5)];
  const r = [b[0] - headLen * Math.cos(ang + 0.5), b[1] - headLen * Math.sin(ang + 0.5)];
  return { type: 'arrow', outline: [...dense([a, b], 3), ...dense([b, l], 3), ...dense([l, b], 3), ...dense([b, r], 3)], closed: false };
}

// ---------- шаблоны ----------
function templateCloud(points) { return resample(normalize(points), N); }
const TEMPLATES = [
  { name: 'circle', cloud: templateCloud(ellipse(0, 0, 1, 1, 64)) },
  { name: 'rect', cloud: templateCloud([[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]) },
  { name: 'triangle', cloud: templateCloud([[0.5, 0], [1, 1], [0, 1], [0.5, 0]]) },
  { name: 'heart', cloud: templateCloud(heart(0, 0, 1, 1)) },
  { name: 'star', cloud: templateCloud(star(0, 0, 1)) },
];

// ---------- построение идеальных фигур ----------
function ellipse(cx, cy, rx, ry, n = 0) {
  const k = n || Math.max(40, Math.round((rx + ry) * 0.6));
  const out = [];
  for (let i = 0; i <= k; i++) { const t = (i / k) * Math.PI * 2 - Math.PI / 2; out.push([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); }
  return out;
}
function heart(x0, y0, w, h) {
  // классическая кривая сердца, вписанная в рамку
  const raw = [];
  for (let i = 0; i <= 120; i++) {
    const t = (i / 120) * Math.PI * 2;
    raw.push([16 * Math.sin(t) ** 3, -(13 * Math.cos(t) - 5 * Math.cos(2 * t) - 2 * Math.cos(3 * t) - Math.cos(4 * t))]);
  }
  const b = bbox(raw);
  return raw.map(([x, y]) => [x0 + ((x - b.x0) / b.w) * w, y0 + ((y - b.y0) / b.h) * h]);
}
function star(cx, cy, r) {
  const out = [];
  for (let i = 0; i <= 10; i++) {
    const rr = i % 2 ? r * 0.45 : r;
    const t = -Math.PI / 2 + (i * Math.PI) / 5;
    out.push([cx + rr * Math.cos(t), cy + rr * Math.sin(t)]);
  }
  return out;
}
function bestTriangle(v) {
  if (v.length <= 3) return v.map((p) => [...p]);
  let best = null, bestA = -1;
  for (let i = 0; i < v.length; i++) for (let j = i + 1; j < v.length; j++) for (let k = j + 1; k < v.length; k++) {
    const a = Math.abs((v[j][0] - v[i][0]) * (v[k][1] - v[i][1]) - (v[k][0] - v[i][0]) * (v[j][1] - v[i][1]));
    if (a > bestA) { bestA = a; best = [v[i], v[j], v[k]]; }
  }
  return best.map((p) => [...p]);
}
// линии почти по горизонтали/вертикали/диагонали выравниваются
function snapLine(a, b) {
  const len = dist(a, b), ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  const step = Math.PI / 4, snapped = Math.round(ang / step) * step;
  const t = Math.abs(ang - snapped) < (6 * Math.PI) / 180 ? snapped : ang;
  return [[a[0], a[1]], [a[0] + len * Math.cos(t), a[1] + len * Math.sin(t)]];
}

// ---------- геометрия ----------
function dist(a, b) { return Math.hypot(a[0] - b[0], a[1] - b[1]); }
function pathLength(p) { let s = 0; for (let i = 1; i < p.length; i++) s += dist(p[i - 1], p[i]); return s; }
function bbox(p) {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const [x, y] of p) { if (x < x0) x0 = x; if (y < y0) y0 = y; if (x > x1) x1 = x; if (y > y1) y1 = y; }
  return { x0, y0, w: Math.max(1e-6, x1 - x0), h: Math.max(1e-6, y1 - y0) };
}
function pointLine(p, a, b) {
  const L = dist(a, b) || 1e-6;
  return Math.abs((b[0] - a[0]) * (a[1] - p[1]) - (a[0] - p[0]) * (b[1] - a[1])) / L;
}
function resample(p, n) {
  const I = pathLength(p) / (n - 1);
  const out = [p[0].slice()];
  let D = 0;
  const pts = p.map((q) => q.slice());
  for (let i = 1; i < pts.length; i++) {
    const d = dist(pts[i - 1], pts[i]);
    if (D + d >= I && d > 0) {
      const t = (I - D) / d;
      const q = [pts[i - 1][0] + t * (pts[i][0] - pts[i - 1][0]), pts[i - 1][1] + t * (pts[i][1] - pts[i - 1][1])];
      out.push(q); pts.splice(i, 0, q); D = 0;
    } else D += d;
  }
  while (out.length < n) out.push(p[p.length - 1].slice());
  return out.slice(0, n);
}
// облако точек: центр в нуле, каждая ось в масштабе 1 (овал = круг, прямоугольник = квадрат)
function normalize(p) {
  const b = bbox(p);
  return p.map(([x, y]) => [(x - b.x0) / b.w - 0.5, (y - b.y0) / b.h - 0.5]);
}
function cloudMatch(a, b) {
  const e = 0.5, step = Math.floor(Math.pow(a.length, 1 - e));
  let min = Infinity;
  for (let i = 0; i < a.length; i += step) {
    min = Math.min(min, greedy(a, b, i), greedy(b, a, i));
  }
  return min;
}
function greedy(a, b, start) {
  const n = a.length, matched = new Uint8Array(n);
  let sum = 0, i = start;
  do {
    let idx = -1, md = Infinity;
    for (let j = 0; j < n; j++) if (!matched[j]) { const d = dist(a[i], b[j]); if (d < md) { md = d; idx = j; } }
    matched[idx] = 1;
    const w = 1 - ((i - start + n) % n) / n;
    sum += w * md;
    i = (i + 1) % n;
  } while (i !== start);
  return sum;
}
// углы замкнутой фигуры: делим кольцо в самой дальней от начала точке и упрощаем обе половины
function rdpClosed(p, eps) {
  let k = 0, md = -1;
  for (let i = 1; i < p.length; i++) { const d = dist(p[0], p[i]); if (d > md) { md = d; k = i; } }
  const ring = p.map((q) => q.slice()); ring.push(p[0].slice());
  const a = rdp(ring.slice(0, k + 1), eps), b = rdp(ring.slice(k), eps);
  return a.slice(0, -1).concat(b);
}
function rdp(p, eps) {
  if (p.length < 3) return p.slice();
  let idx = 0, md = 0;
  for (let i = 1; i < p.length - 1; i++) { const d = pointLine(p[i], p[0], p[p.length - 1]); if (d > md) { md = d; idx = i; } }
  if (md > eps) { const a = rdp(p.slice(0, idx + 1), eps), b = rdp(p.slice(idx), eps); return a.slice(0, -1).concat(b); }
  return [p[0], p[p.length - 1]];
}
function dense(poly, step) {
  const out = [];
  for (let i = 1; i < poly.length; i++) {
    const a = poly[i - 1], b = poly[i], d = dist(a, b), n = Math.max(1, Math.ceil(d / step));
    for (let k = 0; k < n; k++) out.push([a[0] + ((b[0] - a[0]) * k) / n, a[1] + ((b[1] - a[1]) * k) / n]);
  }
  out.push(poly[poly.length - 1].slice());
  return out;
}

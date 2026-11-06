// Сборщик раскраски по номерам: картинка → карта областей, палитра, места для цифр.
// Работает в браузере (canvas). Им же заранее собираются картины художников и рисунки из кода,
// а позже — раскраски из своих фото прямо на iPad.

// ---------- 1. исходные данные → карта цветов ----------

// Векторная картинка: фигуры по порядку, у каждой свой цвет палитры. Возвращает карту «номер фигуры» и цвета фигур.
export function rasterShapes(pic, W, H) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.setTransform(W / pic.w, 0, 0, H / pic.h, 0, 0);
  pic.shapes.forEach((s, i) => {
    const id = i + 1;
    g.fillStyle = `rgb(${id & 255},${(id >> 8) & 255},91)`;
    g.fill(new Path2D(s.d));
  });
  const d = g.getImageData(0, 0, W, H).data;
  const map = new Int32Array(W * H);
  for (let i = 0, p = 0; i < map.length; i++, p += 4) {
    // края сглаживания дают смешанные цвета — такие точки пока «ничьи» (0)
    map[i] = d[p + 2] === 91 && d[p + 3] === 255 ? d[p] | (d[p + 1] << 8) : 0;
    if (map[i] > pic.shapes.length) map[i] = 0;
  }
  fillUnknown(map, W, H);
  const shapeColor = new Int32Array(pic.shapes.length + 1);
  pic.shapes.forEach((s, i) => { shapeColor[i + 1] = s.c; });
  return { map, shapeColor };
}

// Растровая картинка: сгладить, свести к K цветам (k-means в пространстве Lab), убрать «шум».
export function quantizeImage(img, W, H, K, { blur = 2, mode = 2, chroma = 1.14 } = {}) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const g = c.getContext('2d', { willReadFrequently: true });
  g.imageSmoothingQuality = 'high';
  g.drawImage(img, 0, 0, W, H);
  if (blur) { g.filter = `blur(${blur}px)`; g.drawImage(c, 0, 0); g.filter = 'none'; }
  const d = g.getImageData(0, 0, W, H).data;
  const N = W * H;
  const lab = new Float32Array(N * 3);
  for (let i = 0, p = 0; i < N; i++, p += 4) rgb2lab(d[p], d[p + 1], d[p + 2], lab, i * 3);
  const centers = kmeans(lab, N, K);
  const idx = new Int32Array(N);
  for (let i = 0; i < N; i++) idx[i] = nearest(lab, i * 3, centers, K);
  for (let k = 0; k < mode; k++) modeFilter(idx, W, H);
  const palette = [];
  // усреднение красок приглушает цвет — возвращаем немного насыщенности (каналы a и b в Lab)
  for (let k = 0; k < K; k++) palette.push(lab2hex(centers[k * 3], centers[k * 3 + 1] * chroma, centers[k * 3 + 2] * chroma));
  return { idx, palette };
}

// ---------- 2. области ----------

// Связные области (4 соседа) по карте меток. Возвращает карту номеров областей (с 1) и метку каждой области.
export function components(lbl, W, H) {
  const N = W * H;
  const reg = new Int32Array(N);
  const stack = new Int32Array(N);
  const regLabel = [0];
  let next = 1;
  for (let s = 0; s < N; s++) {
    if (reg[s]) continue;
    const L = lbl[s];
    reg[s] = next;
    let top = 0;
    stack[top++] = s;
    while (top) {
      const p = stack[--top];
      const x = p % W;
      if (x > 0 && !reg[p - 1] && lbl[p - 1] === L) { reg[p - 1] = next; stack[top++] = p - 1; }
      if (x < W - 1 && !reg[p + 1] && lbl[p + 1] === L) { reg[p + 1] = next; stack[top++] = p + 1; }
      if (p >= W && !reg[p - W] && lbl[p - W] === L) { reg[p - W] = next; stack[top++] = p - W; }
      if (p < N - W && !reg[p + W] && lbl[p + W] === L) { reg[p + W] = next; stack[top++] = p + W; }
    }
    regLabel.push(L);
    next++;
  }
  return { reg, regLabel, count: next - 1 };
}

// Слить мелкие и узкие области с соседом по самой длинной общей границе:
// в каждой оставшейся области помещается цифра радиусом не меньше minR точек.
export function mergeSmall(reg, regLabel, W, H, { minArea, minR }) {
  for (let pass = 0; pass < 4; pass++) {
    const n = regLabel.length;
    const area = new Int32Array(n);
    for (let i = 0; i < reg.length; i++) area[reg[i]]++;
    let small = new Uint8Array(n);
    let any = false;
    for (let r = 1; r < n; r++) if (area[r] > 0 && area[r] < minArea) { small[r] = 1; any = true; }
    if (minR) {
      const dt = distance(reg, W, H);
      const inR = new Float32Array(n);
      for (let i = 0; i < reg.length; i++) if (dt[i] > inR[reg[i]]) inR[reg[i]] = dt[i];
      for (let r = 1; r < n; r++) if (area[r] > 0 && inR[r] < minR) { small[r] = 1; any = true; }
    }
    if (!any) break;
    // общие границы мелких областей с соседями
    const border = new Map();
    const add = (a, b) => {
      if (!small[a] || a === b) return;
      let m = border.get(a); if (!m) border.set(a, (m = new Map()));
      m.set(b, (m.get(b) || 0) + 1);
    };
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x, a = reg[p];
      if (x < W - 1) { const b = reg[p + 1]; if (a !== b) { add(a, b); add(b, a); } }
      if (y < H - 1) { const b = reg[p + W]; if (a !== b) { add(a, b); add(b, a); } }
    }
    const parent = Int32Array.from({ length: n }, (_, i) => i);
    const find = (r) => { while (parent[r] !== r) { parent[r] = parent[parent[r]]; r = parent[r]; } return r; };
    const order = [...border.keys()].sort((a, b) => area[a] - area[b]);
    for (const a of order) {
      let best = -1, bestLen = -1;
      for (const [b, len] of border.get(a)) {
        const fb = find(b);
        if (fb === find(a)) continue;
        // предпочитаем соседа той же метки (цвета), иначе — самую длинную границу
        const score = len + (regLabel[fb] === regLabel[a] ? 1e6 : 0);
        if (score > bestLen) { bestLen = score; best = fb; }
      }
      if (best > 0) parent[find(a)] = best;
    }
    for (let i = 0; i < reg.length; i++) reg[i] = find(reg[i]);
  }
  return relabel(reg, regLabel);
}

// Перенумеровать области подряд, начиная с 1.
function relabel(reg, regLabel) {
  const map = new Map();
  const outLabel = [0];
  for (let i = 0; i < reg.length; i++) {
    const r = reg[i];
    let nr = map.get(r);
    if (nr === undefined) { nr = outLabel.length; map.set(r, nr); outLabel.push(regLabel[r]); }
    reg[i] = nr;
  }
  return { reg, regLabel: outLabel, count: outLabel.length - 1 };
}

// Расстояние каждой точки до границы её области (фаска 3-4, в пикселях).
export function distance(reg, W, H) {
  const N = W * H, INF = 1e9;
  const dt = new Float32Array(N);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const p = y * W + x, r = reg[p];
    const edge = x === 0 || y === 0 || x === W - 1 || y === H - 1 || reg[p - 1] !== r || reg[p + 1] !== r || reg[p - W] !== r || reg[p + W] !== r;
    dt[p] = edge ? 1 : INF;
  }
  for (let y = 1; y < H; y++) for (let x = 1; x < W - 1; x++) {
    const p = y * W + x;
    let v = dt[p];
    v = Math.min(v, dt[p - 1] + 1, dt[p - W] + 1, dt[p - W - 1] + 1.4142, dt[p - W + 1] + 1.4142);
    dt[p] = v;
  }
  for (let y = H - 2; y >= 0; y--) for (let x = W - 2; x >= 1; x--) {
    const p = y * W + x;
    let v = dt[p];
    v = Math.min(v, dt[p + 1] + 1, dt[p + W] + 1, dt[p + W + 1] + 1.4142, dt[p + W - 1] + 1.4142);
    dt[p] = v;
  }
  return dt;
}

// ---------- 3. сборка картинки ----------

// Итог: карта областей, цвет (номер) каждой области, площадь, рамка, место и размер цифры, палитра.
export function finish(reg, regLabel, W, H, paletteHex, names = []) {
  const n = regLabel.length;
  const area = new Int32Array(n);
  const box = new Int32Array(n * 4).fill(-1);
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const r = reg[y * W + x];
    area[r]++;
    const b = r * 4;
    if (box[b] < 0 || x < box[b]) box[b] = x;
    if (box[b + 1] < 0 || y < box[b + 1]) box[b + 1] = y;
    if (x > box[b + 2]) box[b + 2] = x;
    if (y > box[b + 3]) box[b + 3] = y;
  }
  const dt = distance(reg, W, H);
  const lx = new Int32Array(n), ly = new Int32Array(n), lr = new Float32Array(n);
  for (let i = 0; i < reg.length; i++) { const r = reg[i]; if (dt[i] > lr[r]) { lr[r] = dt[i]; lx[r] = i % W; ly[r] = (i / W) | 0; } }
  // палитра только из используемых цветов; номера по светлоте — от тёмного к светлому
  const used = [...new Set(regLabel.slice(1))];
  used.sort((a, b) => luminance(paletteHex[a]) - luminance(paletteHex[b]));
  const newIdx = new Map(used.map((c, i) => [c, i]));
  const palette = used.map((c, i) => ({ hex: paletteHex[c], name: names[c] || '' }));
  const regions = [];
  for (let r = 1; r < n; r++) {
    regions.push({ c: newIdx.get(regLabel[r]), a: area[r], x: lx[r], y: ly[r], rad: +lr[r].toFixed(1), b: [box[r * 4], box[r * 4 + 1], box[r * 4 + 2], box[r * 4 + 3]] });
  }
  const map = new Uint16Array(reg.length);
  for (let i = 0; i < reg.length; i++) map[i] = reg[i] - 1; // области с 0
  return { w: W, h: H, palette, regions, map };
}

// Векторная картинка из кода → раскраска.
export function buildFromShapes(pic, longSide = 1200, opts = {}) {
  const k = longSide / Math.max(pic.w, pic.h);
  const W = Math.round(pic.w * k), H = Math.round(pic.h * k);
  const { map, shapeColor } = rasterShapes(pic, W, H);
  const cc = components(map, W, H);
  const regColorByShape = cc.regLabel.map((shapeId) => shapeId); // метка — номер фигуры
  const merged = mergeSmall(cc.reg, regColorByShape, W, H, { minArea: opts.minArea || W * H * 0.0006, minR: opts.minR || 9 });
  const regLabel = merged.regLabel.map((shapeId) => (shapeId ? shapeColor[shapeId] : 0));
  return finish(merged.reg, regLabel, W, H, pic.palette.map((p) => p.hex), pic.palette.map((p) => p.name));
}

// Растровая картинка (картина, фото) → раскраска.
export function buildFromImage(img, { longSide = 1200, colors = 18, minArea, minR = 10, blur = 2, mode = 2, chroma = 1.14 } = {}) {
  const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
  const k = longSide / Math.max(iw, ih);
  const W = Math.round(iw * k), H = Math.round(ih * k);
  const q = quantizeImage(img, W, H, colors, { blur, mode, chroma });
  const cc = components(q.idx, W, H);
  const merged = mergeSmall(cc.reg, cc.regLabel, W, H, { minArea: minArea || W * H * 0.0008, minR });
  return finish(merged.reg, merged.regLabel, W, H, q.palette);
}

// ---------- хранение: карта областей сжимается в серии (длина, номер) ----------
export function encodeMap(map) {
  const out = [];
  let i = 0;
  while (i < map.length) {
    const v = map[i];
    let run = 1;
    while (i + run < map.length && map[i + run] === v && run < 65535) run++;
    out.push(run, v);
    i += run;
  }
  return new Uint16Array(out);
}
export function decodeMap(rle, size) {
  const map = new Uint16Array(size);
  let p = 0;
  for (let i = 0; i < rle.length; i += 2) { map.fill(rle[i + 1], p, p + rle[i]); p += rle[i]; }
  return map;
}

// ---------- вспомогательное ----------
function fillUnknown(map, W, H) {
  // точки на краях фигур забирает сосед, которого вокруг больше
  for (let pass = 0; pass < 6; pass++) {
    let left = 0;
    const copy = map.slice();
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
      const p = y * W + x;
      if (copy[p]) continue;
      const votes = new Map();
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const xx = x + dx, yy = y + dy;
        if (xx < 0 || yy < 0 || xx >= W || yy >= H) continue;
        const v = copy[yy * W + xx];
        if (v) votes.set(v, (votes.get(v) || 0) + 1);
      }
      let best = 0, bn = 0;
      for (const [v, n] of votes) if (n > bn || (n === bn && v > best)) { bn = n; best = v; }
      if (best) map[p] = best; else left++;
    }
    if (!left) break;
  }
}

function modeFilter(idx, W, H) {
  const copy = idx.slice();
  const cnt = new Map();
  for (let y = 1; y < H - 1; y++) for (let x = 1; x < W - 1; x++) {
    cnt.clear();
    let best = copy[y * W + x], bn = 0;
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
      const v = copy[(y + dy) * W + x + dx];
      const n = (cnt.get(v) || 0) + 1; cnt.set(v, n);
      if (n > bn) { bn = n; best = v; }
    }
    if (bn >= 5) idx[y * W + x] = best;
  }
}

function kmeans(lab, N, K) {
  const step = Math.max(1, Math.floor(N / 40000));
  const S = Math.floor(N / step);
  const samples = new Float32Array(S * 3);
  for (let i = 0; i < S; i++) { const j = i * step * 3; samples[i * 3] = lab[j]; samples[i * 3 + 1] = lab[j + 1]; samples[i * 3 + 2] = lab[j + 2]; }
  // k-means++: первые центры подальше друг от друга (детерминированно)
  const centers = new Float32Array(K * 3);
  centers.set(samples.subarray(0, 3), 0);
  const dist = new Float32Array(S).fill(Infinity);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  for (let k = 1; k < K; k++) {
    let sum = 0;
    for (let i = 0; i < S; i++) {
      const d = d2(samples, i * 3, centers, (k - 1) * 3);
      if (d < dist[i]) dist[i] = d;
      sum += dist[i];
    }
    let t = rnd() * sum, pick = 0;
    for (let i = 0; i < S; i++) { t -= dist[i]; if (t <= 0) { pick = i; break; } }
    centers.set(samples.subarray(pick * 3, pick * 3 + 3), k * 3);
  }
  const assign = new Int32Array(S);
  for (let it = 0; it < 14; it++) {
    const sums = new Float64Array(K * 3), counts = new Int32Array(K);
    for (let i = 0; i < S; i++) {
      const c = nearest(samples, i * 3, centers, K);
      assign[i] = c; counts[c]++;
      sums[c * 3] += samples[i * 3]; sums[c * 3 + 1] += samples[i * 3 + 1]; sums[c * 3 + 2] += samples[i * 3 + 2];
    }
    for (let k = 0; k < K; k++) if (counts[k]) { centers[k * 3] = sums[k * 3] / counts[k]; centers[k * 3 + 1] = sums[k * 3 + 1] / counts[k]; centers[k * 3 + 2] = sums[k * 3 + 2] / counts[k]; }
  }
  return centers;
}
function d2(a, i, b, j) { const x = a[i] - b[j], y = a[i + 1] - b[j + 1], z = a[i + 2] - b[j + 2]; return x * x + y * y + z * z; }
function nearest(a, i, centers, K) { let best = 0, bd = Infinity; for (let k = 0; k < K; k++) { const d = d2(a, i, centers, k * 3); if (d < bd) { bd = d; best = k; } } return best; }

function rgb2lab(r, g, b, out, o) {
  const f = (v) => { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
  const R = f(r), G = f(g), B = f(b);
  let x = (R * 0.4124 + G * 0.3576 + B * 0.1805) / 0.95047, y = R * 0.2126 + G * 0.7152 + B * 0.0722, z = (R * 0.0193 + G * 0.1192 + B * 0.9505) / 1.08883;
  const h = (t) => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  x = h(x); y = h(y); z = h(z);
  out[o] = 116 * y - 16; out[o + 1] = 500 * (x - y); out[o + 2] = 200 * (y - z);
}
function lab2hex(L, A, B) {
  let y = (L + 16) / 116, x = A / 500 + y, z = y - B / 200;
  const h = (t) => (t ** 3 > 0.008856 ? t ** 3 : (t - 16 / 116) / 7.787);
  x = h(x) * 0.95047; y = h(y); z = h(z) * 1.08883;
  let r = x * 3.2406 + y * -1.5372 + z * -0.4986, g = x * -0.9689 + y * 1.8758 + z * 0.0415, b = x * 0.0557 + y * -0.204 + z * 1.057;
  const f = (v) => Math.round(255 * Math.min(1, Math.max(0, v <= 0.0031308 ? 12.92 * v : 1.055 * v ** (1 / 2.4) - 0.055)));
  return '#' + [f(r), f(g), f(b)].map((v) => v.toString(16).padStart(2, '0')).join('');
}
export function luminance(hex) {
  const n = parseInt(hex.slice(1), 16);
  return 0.2126 * ((n >> 16) & 255) + 0.7152 * ((n >> 8) & 255) + 0.0722 * (n & 255);
}

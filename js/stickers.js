// Стикеры для блокнота: милые и «для конспекта». Все нарисованы здесь (SVG и CSS), поэтому работают офлайн.
// Стикер на странице: { id, key, x, y (центр), s (масштаб), r (поворот, радианы), text? }.
import { h, esc } from './ui.js';

const W = '#FFFFFF';
// у SVG-стикеров белая «вырубка» по краю, как у настоящих наклеек
const svgDefs = {
  heart: { w: 120, h: 108, svg: `<path d="M60 100C20 72 6 52 8 32 10 14 24 6 38 8c10 1 17 7 22 15 5-8 12-14 22-15 14-2 28 6 30 24 2 20-12 40-52 68z" fill="#E58FA6" stroke="${W}" stroke-width="7" stroke-linejoin="round"/><ellipse cx="34" cy="30" rx="9" ry="6" fill="#fff" opacity=".55" transform="rotate(-30 34 30)"/>` },
  bow: { w: 140, h: 100, svg: `<g stroke="${W}" stroke-width="7" stroke-linejoin="round"><path d="M70 44C52 18 14 8 10 30c-4 22 36 28 60 16z" fill="#D48A9E"/><path d="M70 44c18-26 56-36 60-14 4 22-36 28-60 16z" fill="#D48A9E"/><path d="M64 52L44 92l14-4 10 10 4-44zM76 52l20 40-14-4-10 10-4-44z" fill="#C97590"/></g><rect x="58" y="34" width="24" height="22" rx="9" fill="#B9667F" stroke="${W}" stroke-width="6"/><path d="M26 26c8 2 18 8 28 14M114 26c-8 2-18 8-28 14" stroke="#F3C6D2" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  star: { w: 120, h: 116, svg: `<path d="M60 8l14 30 33 4-24 23 6 33-29-16-29 16 6-33-24-23 33-4z" fill="#F3D27A" stroke="${W}" stroke-width="7" stroke-linejoin="round"/><circle cx="48" cy="58" r="4" fill="#7A5A2E"/><circle cx="72" cy="58" r="4" fill="#7A5A2E"/><path d="M52 70q8 7 16 0" stroke="#7A5A2E" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  flower: { w: 120, h: 120, svg: `<g stroke="${W}" stroke-width="6">${[0, 72, 144, 216, 288].map((a) => `<circle cx="${60 + 28 * Math.cos((a - 90) * Math.PI / 180)}" cy="${60 + 28 * Math.sin((a - 90) * Math.PI / 180)}" r="24" fill="#F4B6C2"/>`).join('')}</g><circle cx="60" cy="60" r="18" fill="#F3D27A" stroke="${W}" stroke-width="5"/>` },
  cloud: { w: 150, h: 96, svg: `<path d="M38 86c-18 0-30-12-30-28 0-15 12-27 27-27 4-14 18-23 33-23 18 0 32 12 35 28 2 0 3 0 5 0 16 0 28 12 28 26s-12 24-28 24z" fill="#DCE9F5" stroke="${W}" stroke-width="7"/><circle cx="58" cy="58" r="4" fill="#4F5D8A"/><circle cx="86" cy="58" r="4" fill="#4F5D8A"/><path d="M64 68q8 6 16 0" stroke="#4F5D8A" stroke-width="3" fill="none" stroke-linecap="round"/><circle cx="48" cy="68" r="6" fill="#F4B6C2" opacity=".7"/><circle cx="96" cy="68" r="6" fill="#F4B6C2" opacity=".7"/>` },
  strawberry: { w: 110, h: 130, svg: `<path d="M55 122C24 104 8 74 12 52 16 34 34 30 55 36 76 30 94 34 98 52c4 22-12 52-43 70z" fill="#E8737F" stroke="${W}" stroke-width="7" stroke-linejoin="round"/>${[[36, 58], [56, 54], [76, 58], [44, 78], [66, 78], [55, 98], [34, 92], [78, 92]].map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="2.6" ry="3.6" fill="#FFF3D6"/>`).join('')}<path d="M55 38c-14-2-26-10-28-20 10 2 18 0 28 8 10-8 18-10 28-8-2 10-14 18-28 20z" fill="#8FB98B" stroke="${W}" stroke-width="5" stroke-linejoin="round"/><path d="M55 30V8" stroke="#6E8F57" stroke-width="6" stroke-linecap="round"/>` },
  cherries: { w: 120, h: 126, svg: `<path d="M64 10c-10 30-22 50-34 70M64 10c4 30 14 52 30 66" stroke="#6E8F57" stroke-width="5" fill="none" stroke-linecap="round"/><path d="M64 12c14-8 32-6 40 6-14 6-28 4-40-6z" fill="#8FB98B" stroke="${W}" stroke-width="4"/><circle cx="30" cy="96" r="24" fill="#D9536B" stroke="${W}" stroke-width="7"/><circle cx="92" cy="92" r="24" fill="#D9536B" stroke="${W}" stroke-width="7"/><circle cx="22" cy="88" r="6" fill="#fff" opacity=".5"/><circle cx="84" cy="84" r="6" fill="#fff" opacity=".5"/>` },
  tulip: { w: 90, h: 140, svg: `<path d="M45 72v60" stroke="#6E8F57" stroke-width="6" stroke-linecap="round"/><path d="M45 118c-4-20-18-30-34-30 2 20 16 32 34 30z" fill="#8FB98B" stroke="${W}" stroke-width="5"/><path d="M14 18c8 6 14 12 18 20 4-12 8-22 13-30 5 8 9 18 13 30 4-8 10-14 18-20 4 30-6 56-31 56S10 48 14 18z" fill="#F29BB2" stroke="${W}" stroke-width="7" stroke-linejoin="round"/>` },
  moon: { w: 120, h: 120, svg: `<path d="M74 10A50 50 0 1 0 110 84 40 40 0 1 1 74 10z" fill="#F3D27A" stroke="${W}" stroke-width="7" stroke-linejoin="round"/><path d="M92 20l4 9 9 1-7 6 2 9-8-5-8 5 2-9-7-6 9-1z" fill="#F7E3A7"/><circle cx="46" cy="70" r="4" fill="#7A5A2E"/><path d="M36 82q8 6 16 0" stroke="#7A5A2E" stroke-width="3" fill="none" stroke-linecap="round"/>` },
  cat: { w: 130, h: 120, svg: `<path d="M18 50L14 8l34 22h34l34-22-4 42c8 10 12 22 12 32 0 22-24 32-59 32S6 104 6 82c0-10 4-22 12-32z" fill="#F6D7B8" stroke="${W}" stroke-width="7" stroke-linejoin="round"/><path d="M24 24l2 18 14-10zM106 24l-2 18-14-10z" fill="#F4B6C2"/><ellipse cx="44" cy="68" rx="6" ry="8" fill="#3A3236"/><ellipse cx="86" cy="68" rx="6" ry="8" fill="#3A3236"/><path d="M60 80h10l-5 6z" fill="#D48A9E"/><path d="M65 86q-5 8-12 4M65 86q5 8 12 4" stroke="#3A3236" stroke-width="2.5" fill="none" stroke-linecap="round"/><circle cx="32" cy="84" r="8" fill="#F4B6C2" opacity=".7"/><circle cx="98" cy="84" r="8" fill="#F4B6C2" opacity=".7"/>` },
  sparkles: { w: 120, h: 110, svg: `<path d="M44 8c4 24 10 30 34 34-24 4-30 10-34 34-4-24-10-30-34-34 24-4 30-10 34-34z" fill="#E3B85C" stroke="${W}" stroke-width="6" stroke-linejoin="round"/><path d="M92 50c2 14 6 18 20 20-14 2-18 6-20 20-2-14-6-18-20-20 14-2 18-6 20-20z" fill="#D48A9E" stroke="${W}" stroke-width="5" stroke-linejoin="round"/><path d="M84 6c1 8 4 10 12 12-8 1-11 4-12 12-1-8-4-11-12-12 8-2 11-4 12-12z" fill="#B39DD3" stroke="${W}" stroke-width="4" stroke-linejoin="round"/>` },
  sprig: { w: 80, h: 140, svg: `<path d="M40 136C40 90 42 50 46 8" stroke="#6E8F57" stroke-width="5" fill="none" stroke-linecap="round"/>${[[30, 30, -40], [56, 44, 40], [30, 66, -40], [56, 80, 40], [32, 102, -40]].map(([x, y, a]) => `<ellipse cx="${x}" cy="${y}" rx="17" ry="9" fill="#9CBF92" stroke="${W}" stroke-width="4" transform="rotate(${a} ${x} ${y})"/>`).join('')}` },
  // для конспекта
  check0: { w: 90, h: 90, svg: `<rect x="10" y="10" width="70" height="70" rx="16" fill="#FFFDF7" stroke="#8C7B80" stroke-width="6"/>` },
  check1: { w: 90, h: 90, svg: `<rect x="10" y="10" width="70" height="70" rx="16" fill="#E7F0E3" stroke="#6E8F57" stroke-width="6"/><path d="M26 46l14 14 26-30" stroke="#5F7A55" stroke-width="9" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` },
  arrow: { w: 170, h: 80, svg: `<path d="M12 46c40-14 90-16 132-6" stroke="#A9566F" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M124 18l26 22-30 18" stroke="#A9566F" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` },
  curved: { w: 130, h: 130, svg: `<path d="M24 110C14 60 40 22 92 20" stroke="#4F5D8A" stroke-width="8" fill="none" stroke-linecap="round"/><path d="M76 4l22 16-20 20" stroke="#4F5D8A" stroke-width="8" fill="none" stroke-linecap="round" stroke-linejoin="round"/>` },
  note: { w: 220, h: 220, svg: `<path d="M14 18h192v142l-46 46H14z" fill="#FBE7A6" stroke="${W}" stroke-width="6" stroke-linejoin="round"/><path d="M160 206v-36a10 10 0 0110-10h36z" fill="#F0D27C"/><rect x="86" y="4" width="52" height="24" rx="4" fill="#F6C9D3" opacity=".9" transform="rotate(-6 112 16)"/>` },
  tapePink: { w: 280, h: 56, svg: `<defs><pattern id="tp" width="20" height="56" patternUnits="userSpaceOnUse"><rect width="20" height="56" fill="#F6C9D3"/><rect width="10" height="56" fill="#FBE0E6"/></pattern></defs><path d="M8 6h264l-6 8 6 8-6 8 6 8-6 8 6 8H8l6-8-6-8 6-8-6-8 6-8z" fill="url(#tp)" opacity=".86"/>` },
  tapeSage: { w: 280, h: 56, svg: `<defs><pattern id="ts" width="18" height="18" patternUnits="userSpaceOnUse"><rect width="18" height="18" fill="#CFE0C8"/><circle cx="9" cy="9" r="3.2" fill="#FFFDF7"/></pattern></defs><path d="M8 6h264l-6 8 6 8-6 8 6 8-6 8 6 8H8l6-8-6-8 6-8-6-8 6-8z" fill="url(#ts)" opacity=".88"/>` },
  tapeLav: { w: 280, h: 56, svg: `<defs><pattern id="tl" width="16" height="16" patternUnits="userSpaceOnUse"><rect width="16" height="16" fill="#E6DDF4"/><rect width="8" height="16" fill="#CFC0E8" opacity=".7"/><rect width="16" height="8" fill="#CFC0E8" opacity=".7"/></pattern></defs><path d="M8 6h264l-6 8 6 8-6 8 6 8-6 8 6 8H8l6-8-6-8 6-8-6-8 6-8z" fill="url(#tl)" opacity=".88"/>` },
  clip: { w: 60, h: 140, svg: `<path d="M40 40v66a14 14 0 01-28 0V30a22 22 0 0144 0v76a30 30 0 01-60 0V44" stroke="#B8AEB3" stroke-width="7" fill="none" stroke-linecap="round" transform="translate(4 4)"/>` },
  pin: { w: 90, h: 120, svg: `<path d="M45 70v44" stroke="#8C7B80" stroke-width="5" stroke-linecap="round"/><circle cx="45" cy="44" r="34" fill="#E58FA6" stroke="${W}" stroke-width="7"/><circle cx="34" cy="32" r="10" fill="#fff" opacity=".5"/>` },
  bubble: { w: 240, h: 170, svg: `<path d="M30 12h180a20 20 0 0120 20v80a20 20 0 01-20 20H92l-40 30 8-30H30a20 20 0 01-20-20V32a20 20 0 0120-20z" fill="#FFFDF7" stroke="#D48A9E" stroke-width="6" stroke-linejoin="round"/>` },
};

// метки с текстом (текст можно поменять)
const labelDefs = {
  important: { text: 'Важно!', bg: '#F7C9D3', ink: '#8E3B5A', shape: 'tag' },
  remember: { text: 'Не забыть', bg: '#DCD2EE', ink: '#4F3F73', shape: 'tag' },
  idea: { text: 'Идея', bg: '#FBE7A6', ink: '#7A5A2E', shape: 'tag' },
  done: { text: 'Готово', bg: '#CFE0C8', ink: '#3F5A3C', shape: 'tag' },
  question: { text: 'Вопрос?', bg: '#D6E6F2', ink: '#3E5A75', shape: 'tag' },
  deadline: { text: 'Дедлайн', bg: '#F4C7B0', ink: '#7A3E2E', shape: 'pill' },
  banner: { text: 'Заголовок', bg: '#E8A9B8', ink: '#FFFBF6', shape: 'banner' },
  num: { text: '1', bg: '#A9566F', ink: '#FFFBF6', shape: 'circle' },
};

export const CATEGORIES = [
  { title: 'Милые', keys: ['heart', 'bow', 'star', 'flower', 'cloud', 'strawberry', 'cherries', 'tulip', 'moon', 'cat', 'sparkles', 'sprig'] },
  { title: 'Для конспекта', keys: ['L:important', 'L:remember', 'L:idea', 'L:done', 'L:question', 'L:deadline', 'L:banner', 'L:num', 'check0', 'check1', 'arrow', 'curved', 'note', 'bubble', 'tapePink', 'tapeSage', 'tapeLav', 'clip', 'pin'] },
];

const NAMES = {
  heart: 'Сердечко', bow: 'Бантик', star: 'Звёздочка', flower: 'Цветок', cloud: 'Облачко', strawberry: 'Клубничка', cherries: 'Вишенки',
  tulip: 'Тюльпан', moon: 'Месяц', cat: 'Котик', sparkles: 'Искорки', sprig: 'Веточка', check0: 'Пустой чекбокс', check1: 'Отмеченный чекбокс',
  arrow: 'Стрелка', curved: 'Изогнутая стрелка', note: 'Стикер-заметка', tapePink: 'Розовая лента', tapeSage: 'Шалфейная лента', tapeLav: 'Лавандовая лента',
  clip: 'Скрепка', pin: 'Кнопка', bubble: 'Облачко для текста',
};
export function stickerName(key) { return isLabel(key) ? `Метка «${labelDefs[key.slice(2)].text}»` : NAMES[key] || 'Стикер'; }

export function isLabel(key) { return key.startsWith('L:'); }
export function isText(key) { return key === 'T'; }
export function hasEditableText(key) { return isLabel(key) || isText(key); }

// ---------- текст с выбором шрифта ----------
// k выравнивает видимый размер: рукописные шрифты мельче при том же кегле
export const FONTS = [
  { id: 'nunito', name: 'Простой', family: "'Nunito', sans-serif", weight: 600, style: 'normal', k: 1 },
  { id: 'comfortaa', name: 'Округлый', family: "'Comfortaa', sans-serif", weight: 600, style: 'normal', k: 0.95 },
  { id: 'caveat', name: 'Рукописный', family: "'Caveat', cursive", weight: 500, style: 'normal', k: 1.3 },
  { id: 'bad-script', name: 'Каллиграфия', family: "'Bad Script', cursive", weight: 400, style: 'normal', k: 1.05 },
  { id: 'pangolin', name: 'Маркер', family: "'Pangolin', cursive", weight: 400, style: 'normal', k: 1.05 },
  { id: 'cormorant', name: 'Изящный', family: "'Cormorant Garamond', serif", weight: 600, style: 'italic', k: 1.2 },
  { id: 'pacifico', name: 'Леттеринг', family: "'Pacifico', cursive", weight: 400, style: 'normal', k: 0.9 },
  { id: 'yeseva', name: 'Заголовок', family: "'Yeseva One', serif", weight: 400, style: 'normal', k: 1 },
];
export const TEXT_SIZE = 44;   // кегль текста в единицах страницы при масштабе 1
const TEXT_PAD = 12;
export function fontOf(id) { return FONTS.find((f) => f.id === id) || FONTS[0]; }
export function fontCss(f, px) { return `${f.style} ${f.weight} ${px}px ${f.family}`; }
export function textLines(text) { return String(text || '').split('\n'); }

const measureCv = typeof document !== 'undefined' ? document.createElement('canvas').getContext('2d') : null;
const textBoxCache = new Map();
function textBox(st) {
  const key = `${st.font}|${st.text}`;
  if (textBoxCache.has(key)) return textBoxCache.get(key);
  const f = fontOf(st.font), px = TEXT_SIZE * f.k, lh = Math.round(px * 1.32);
  measureCv.font = fontCss(f, px);
  const lines = textLines(st.text);
  let w = 0;
  for (const ln of lines) w = Math.max(w, measureCv.measureText(ln || ' ').width);
  // запас справа: у курсивов и рукописных шрифтов хвосты букв выходят за измеренную ширину
  const box = { w: Math.ceil(w + px * 0.25) + TEXT_PAD * 2, h: lines.length * lh + TEXT_PAD * 2, px, lh, f, lines };
  textBoxCache.set(key, box);
  return box;
}
// шрифты грузятся лениво: перед показом и экспортом текста убеждаемся, что они готовы
export async function loadFonts(stickers) {
  const need = new Map();
  for (const st of stickers) if (isText(st.key)) { const f = fontOf(st.font); need.set(f.id + st.text, document.fonts.load(fontCss(f, 40), st.text || 'Aa')); }
  if (!need.size) return false;
  try { await Promise.all(need.values()); } catch { /* шрифт не загрузился — останется запасной */ }
  textBoxCache.clear();
  return true;
}

// размер стикера в единицах страницы при масштабе 1
export function baseSize(st) {
  if (isText(st.key)) { const b = textBox(st); return { w: b.w, h: b.h }; }
  if (isLabel(st.key)) {
    const d = labelDefs[st.key.slice(2)];
    const text = st.text ?? d.text;
    if (d.shape === 'circle') return { w: 90, h: 90 };
    const k = d.shape === 'banner' ? 34 : 30;
    return { w: Math.max(120, 52 + text.length * k * 0.62), h: d.shape === 'banner' ? 78 : 66 };
  }
  const d = svgDefs[st.key];
  return { w: d.w, h: d.h };
}

export function svgMarkup(key) {
  const d = svgDefs[key];
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${d.w} ${d.h}" width="${d.w}" height="${d.h}">${d.svg}</svg>`;
}

export function labelInfo(st) {
  const d = labelDefs[st.key.slice(2)];
  return { ...d, text: st.text ?? d.text };
}

// DOM-элемент стикера (внутри страницы, в единицах страницы)
export function renderSticker(st) {
  const { w, h: hh } = baseSize(st);
  const el = h('div', { class: 'sticker', 'data-id': st.id });
  el.style.width = w + 'px';
  el.style.height = hh + 'px';
  if (isText(st.key)) {
    const b = textBox(st);
    el.classList.add('textblock');
    el.style.font = fontCss(b.f, b.px);
    el.style.lineHeight = b.lh + 'px';
    el.style.color = st.color || '#3A3236';
    el.style.padding = TEXT_PAD + 'px';
    el.innerHTML = b.lines.map((ln) => `<span>${esc(ln) || '&nbsp;'}</span>`).join('');
  } else if (isLabel(st.key)) {
    const L = labelInfo(st);
    el.classList.add('label', 'label-' + L.shape);
    el.style.setProperty('--bg', L.bg);
    el.style.setProperty('--ink', L.ink);
    el.innerHTML = `<span>${esc(L.text)}</span>`;
  } else {
    el.innerHTML = svgMarkup(st.key);
  }
  placeSticker(el, st);
  return el;
}

export function placeSticker(el, st) {
  const { w, h: hh } = baseSize(st);
  el.style.transform = `translate(${st.x - w / 2}px, ${st.y - hh / 2}px) rotate(${st.r}rad) scale(${st.s})`;
}

// точка страницы → координаты внутри стикера (относительно центра, без поворота и масштаба)
export function toLocal(st, x, y) {
  const dx = x - st.x, dy = y - st.y, c = Math.cos(-st.r), s = Math.sin(-st.r);
  return { x: (dx * c - dy * s) / st.s, y: (dx * s + dy * c) / st.s };
}
export function fromLocal(st, lx, ly) {
  const c = Math.cos(st.r), s = Math.sin(st.r);
  return { x: st.x + (lx * c - ly * s) * st.s, y: st.y + (lx * s + ly * c) * st.s };
}
export function hit(st, x, y, pad = 0) {
  const { w, h: hh } = baseSize(st);
  const p = toLocal(st, x, y);
  return Math.abs(p.x) <= w / 2 + pad && Math.abs(p.y) <= hh / 2 + pad;
}

// ---------- для экспорта в PNG ----------
const imgCache = new Map();
function svgImage(key) {
  if (imgCache.has(key)) return imgCache.get(key);
  const p = new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(svgMarkup(key));
  });
  imgCache.set(key, p);
  return p;
}

export async function drawStickers(ctx, stickers) {
  for (const st of stickers) {
    const { w, h: hh } = baseSize(st);
    ctx.save();
    ctx.translate(st.x, st.y);
    ctx.rotate(st.r);
    ctx.scale(st.s, st.s);
    if (isText(st.key)) await drawText(ctx, st, w, hh);
    else if (isLabel(st.key)) drawLabel(ctx, labelInfo(st), w, hh);
    else { try { ctx.drawImage(await svgImage(st.key), -w / 2, -hh / 2, w, hh); } catch { /* картинка не загрузилась — пропускаем */ } }
    ctx.restore();
  }
}

async function drawText(ctx, st, w, hh) {
  const b = textBox(st);
  try { await document.fonts.load(fontCss(b.f, 40), st.text || 'Aa'); } catch { /* запасной шрифт */ }
  ctx.font = fontCss(b.f, b.px);
  ctx.fillStyle = st.color || '#3A3236';
  ctx.textAlign = 'left'; ctx.textBaseline = 'middle';
  b.lines.forEach((ln, i) => ctx.fillText(ln, -w / 2 + TEXT_PAD, -hh / 2 + TEXT_PAD + b.lh * (i + 0.5)));
}

function drawLabel(ctx, L, w, hh) {
  ctx.fillStyle = L.bg;
  ctx.shadowColor = 'rgba(122,78,90,.18)'; ctx.shadowBlur = 8; ctx.shadowOffsetY = 3;
  ctx.beginPath();
  if (L.shape === 'circle') ctx.arc(0, 0, w / 2 - 4, 0, Math.PI * 2);
  else if (L.shape === 'banner') {
    const x = -w / 2 + 4, y = -hh / 2 + 6, ww = w - 8, h2 = hh - 12;
    ctx.moveTo(x, y); ctx.lineTo(x + ww, y); ctx.lineTo(x + ww - 16, y + h2 / 2); ctx.lineTo(x + ww, y + h2); ctx.lineTo(x, y + h2); ctx.lineTo(x + 16, y + h2 / 2); ctx.closePath();
  } else {
    const r = L.shape === 'pill' ? (hh - 12) / 2 : 14;
    ctx.roundRect(-w / 2 + 4, -hh / 2 + 6, w - 8, hh - 12, r);
  }
  ctx.fill();
  ctx.shadowColor = 'transparent';
  if (L.shape === 'tag') { ctx.fillStyle = 'rgba(255,255,255,.75)'; ctx.beginPath(); ctx.arc(-w / 2 + 22, 0, 6, 0, Math.PI * 2); ctx.fill(); }
  ctx.fillStyle = L.ink;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.font = `700 ${L.shape === 'circle' ? 44 : L.shape === 'banner' ? 32 : 28}px Comfortaa, Nunito, sans-serif`;
  ctx.fillText(L.text, L.shape === 'tag' ? 10 : 0, 2);
}

// ---------- выбор стикера ----------
export function pickerBody(body, close) {
  for (const cat of CATEGORIES) {
    body.append(h('div', { class: 'field-label' }, esc(cat.title)));
    const grid = h('div', { class: 'sticker-grid' });
    for (const key of cat.keys) {
      const st = { key, text: undefined, x: 0, y: 0, s: 1, r: 0 };
      const b = h('button', { class: 'sticker-pick', type: 'button', 'aria-label': isLabel(key) ? labelInfo(st).text : stickerName(key), title: stickerName(key) });
      const el = renderSticker({ ...st, id: 'p' });
      const { w, h: hh } = baseSize(st);
      const k = Math.min(64 / w, 64 / hh);
      el.style.transform = `scale(${k})`;
      el.style.transformOrigin = '0 0';
      const box = h('span', { class: 'sticker-pick-box', style: `width:${w * k}px;height:${hh * k}px` });
      box.append(el);
      b.append(box);
      b.addEventListener('click', () => close(key));
      grid.append(b);
    }
    body.append(grid);
  }
  return null;
}

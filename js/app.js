// Главный экран: блокноты, создание и обложки, резервная копия, переходы между экранами.
import * as db from './db.js';
import * as ink from './ink.js';
import { COVERS, COVER_KEYS } from './covers.js';
import { icon } from './icons.js';
import { h, esc, toast, sheet, dialog, confirmDialog, saveFile } from './ui.js';
import { openNotebook, blankPage } from './notebook.js';
import { openColoring } from './coloring.js';
import { buildFromImage, encodeMap } from './pbn.js';

// номер версии совпадает с VERSION в sw.js (pastel-v7); виден на главном экране — так легко проверить, что iPad обновился
export const APP_VERSION = 7;
const root = document.getElementById('app');
const settings = { fingerDraw: false, hasPressure: false, version: APP_VERSION };
let cleanup = null;
let updateReady = false; // новая версия скачана и включится при ближайшем удобном моменте

async function boot() {
  settings.fingerDraw = await db.getMeta('fingerDraw', false);
  settings.hasPressure = await db.getMeta('hasPressure', false);
  settings.brushPt = await db.getMeta('brushPt', 26);
  settings.shapes = await db.getMeta('shapes', true);
  settings.colorBrush = await db.getMeta('colorBrush', 'water');
  settings.textFont = await db.getMeta('textFont', 'caveat');
  window.addEventListener('hashchange', route);
  // первое касание — просим постоянное хранилище (Safari решает сам, чаще соглашается для приложения с экрана «Домой»)
  window.addEventListener('pointerdown', async function once() {
    window.removeEventListener('pointerdown', once);
    settings.persist = await db.askPersistence();
  });
  settings.shapeDebug = await db.getMeta('shapeDebug', false);
  route();
  setTimeout(() => cleanImages().catch(() => {}), 4000);
  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    const hadController = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // новая версия скачалась: на главном экране перезагружаемся сразу,
    // в блокноте или раскраске — когда выйдешь из них или свернёшь приложение (после сохранения)
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || updateReady) return;
      updateReady = true;
      if (!cleanup) location.reload();
      else toast('Пастель обновилась — новая версия включится, когда выйдешь на главный экран');
    });
    document.addEventListener('visibilitychange', async () => {
      if (!updateReady || document.visibilityState !== 'hidden') return;
      if (cleanup) { const c = cleanup; cleanup = null; try { await c(); } catch { /* сохранение уже было */ } }
      location.reload();
    });
  }
}

async function route() {
  if (cleanup) { const c = cleanup; cleanup = null; await c(); }
  if (updateReady && !/^#\/(nb|color)\//.test(location.hash)) { location.reload(); return; }
  const m = location.hash.match(/^#\/nb\/([\w-]+)/);
  const c = location.hash.match(/^#\/color\/([\w-]+)\/([\w-]+)/);
  if (m) {
    cleanup = await openNotebook(root, m[1], { onBack: () => { location.hash = '#/'; }, settings });
  } else if (c) {
    const cat = await catalog();
    const own = c[1].startsWith('u-') ? await db.get('userpics', c[1]) : null;
    const info = own ? { title: own.title, kind: 'own', thumbBuf: own.thumb } : cat.find((p) => p.id === c[1]) || { title: 'Раскраска' };
    cleanup = await openColoring(root, { id: c[1], level: c[2], info }, { onBack: () => { location.hash = '#/colors'; }, settings });
  } else {
    await renderHome(location.hash.startsWith('#/colors') ? 'colors' : 'notebooks');
  }
}

// ---------- главный экран ----------
async function renderHome(tab = 'notebooks') {
  root.innerHTML = '';
  const screen = h('div', { class: 'home' });
  const tabs = h('div', { class: 'tabs', role: 'tablist' });
  for (const [k, label, ic] of [['notebooks', 'Блокноты', 'book'], ['colors', 'Раскраски', 'palette']]) {
    const t = h('button', { class: 'tab' + (k === tab ? ' on' : ''), type: 'button', role: 'tab', 'aria-selected': k === tab }, `${icon(ic, 20)}<span>${label}</span>`);
    t.addEventListener('click', () => { location.hash = k === 'colors' ? '#/colors' : '#/'; });
    tabs.append(t);
  }
  if (tab === 'colors') return renderGallery(screen, tabs);
  const notebooks = (await db.getAll('notebooks')).sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const head = h('header', { class: 'home-head' }, `
    <div>
      <div class="home-hello">привет, художница</div>
      <h1 class="home-title">Мои блокноты</h1>
    </div>`);
  const btnMenu = h('button', { class: 'icon-btn round', type: 'button', 'aria-label': 'Настройки и резервная копия' }, icon('more'));
  btnMenu.addEventListener('click', homeMenu);
  head.append(btnMenu);
  const grid = h('div', { class: 'nb-grid' });

  const add = h('button', { class: 'nb-card nb-new', type: 'button' }, `<span class="nb-new-plus">${icon('plus', 34)}</span><span>Новый блокнот</span>`);
  add.addEventListener('click', createNotebook);
  grid.append(add);

  for (const nb of notebooks) {
    const cover = COVERS[nb.cover] || COVERS.gingham;
    const card = h('div', { class: 'nb-card' });
    const open = h('button', { class: 'nb-cover', type: 'button', style: cover.css, 'aria-label': `Открыть блокнот «${nb.title}»` },
      `<span class="nb-spine"></span><span class="nb-label" style="color:${cover.ink === '#FFF6EE' || cover.ink === '#F8E9DC' ? '#3A3236' : cover.ink}">${esc(nb.title)}</span>`);
    open.addEventListener('click', () => { location.hash = `#/nb/${nb.id}`; });
    const meta = h('div', { class: 'nb-meta' }, `<span>${pagesWord(nb.pageIds.length)} · ${ink.PAPERS[nb.paper] ? ink.PAPERS[nb.paper].toLowerCase() : ''}</span>`);
    const more = h('button', { class: 'icon-btn small', type: 'button', 'aria-label': `Действия с блокнотом «${nb.title}»` }, icon('more', 18));
    more.addEventListener('click', () => notebookMenu(nb));
    meta.append(more);
    card.append(open, meta);
    grid.append(card);
  }
  const reminder = await backupReminder(notebooks);
  screen.append(head, tabs);
  if (reminder) screen.append(reminder);
  screen.append(grid);
  screen.append(h('p', { class: 'home-version' }, `Пастель · версия ${APP_VERSION}`));
  if (!notebooks.length) {
    screen.append(h('p', { class: 'home-empty' }, 'Здесь будут ваши блокноты. Создайте первый — выберите обложку и бумагу.'));
  }
  root.append(screen);
}

function pagesWord(n) {
  const f = n % 10 === 1 && n % 100 !== 11 ? 'страница' : n % 10 >= 2 && n % 10 <= 4 && (n % 100 < 10 || n % 100 >= 20) ? 'страницы' : 'страниц';
  return `${n} ${f}`;
}

// ---------- раскраски ----------
let catalogCache = null;
async function catalog() {
  if (catalogCache) return catalogCache;
  try { catalogCache = (await (await fetch('data/catalog.json')).json()).pictures; }
  catch { catalogCache = []; }
  return catalogCache;
}

const LEVELS = {
  easy: { label: 'Лёгкая', opts: { longSide: 1000, colors: 14, minArea: 2200, minR: 13, blur: 3, mode: 3 } },
  mid: { label: 'Средняя', opts: { longSide: 1200, colors: 20, minArea: 900, minR: 10, blur: 2, mode: 2 } },
  hard: { label: 'Сложная', opts: { longSide: 1400, colors: 28, minArea: 380, minR: 7.5, blur: 1.5, mode: 2 } },
};

// Своя картинка → раскраска прямо на iPad. Ничего никуда не отправляется: всё остаётся в хранилище браузера.
function addOwnPicture() {
  const input = h('input', { type: 'file', accept: 'image/*' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    const count = (await db.getAll('userpics')).length;
    const res = await dialog({
      title: 'Своя раскраска',
      render: (body) => {
        const state = { title: `Моя картинка ${count + 1}`, level: 'mid' };
        const name = h('input', { class: 'field', type: 'text', maxlength: 40, value: state.title, 'aria-label': 'Название' });
        name.addEventListener('input', () => { state.title = name.value; });
        body.append(h('p', { class: 'dialog-text' }, 'Картинка превратится в раскраску прямо на этом iPad и останется только здесь.'), h('label', { class: 'field-label' }, 'Название'), name, h('div', { class: 'field-label' }, 'Сложность'));
        const row = h('div', { class: 'level-pick', role: 'radiogroup' });
        for (const [k, l] of Object.entries(LEVELS)) {
          const b = h('button', { class: 'chip-btn level-opt', type: 'button', role: 'radio' }, esc(l.label));
          b.addEventListener('click', () => { state.level = k; row.querySelectorAll('.level-opt').forEach((x) => x.classList.toggle('on', x === b)); });
          if (k === state.level) b.classList.add('on');
          row.append(b);
        }
        body.append(row);
        return { value: () => state };
      },
      actions: [{ label: 'Отмена', value: null }, { label: 'Сделать раскраску', primary: true }],
    });
    if (!res) return;
    const wait = h('div', { class: 'scrim open busy' }, '<div class="busy-card">Раскладываю краски…</div>');
    document.body.append(wait);
    await new Promise((r) => setTimeout(r, 60)); // дать экрану показать «ждите»
    try {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.src = url;
      await img.decode();
      const pic = buildFromImage(img, LEVELS[res.level].opts);
      const t = document.createElement('canvas');
      const k = 520 / Math.max(img.naturalWidth, img.naturalHeight);
      t.width = Math.round(img.naturalWidth * k); t.height = Math.round(img.naturalHeight * k);
      t.getContext('2d').drawImage(img, 0, 0, t.width, t.height);
      URL.revokeObjectURL(url);
      const thumb = await new Promise((r) => t.toBlob(r, 'image/jpeg', 0.85));
      const id = 'u-' + db.uid();
      await db.put('userpics', {
        id, title: (res.title || '').trim() || 'Моя картинка', level: res.level, createdAt: Date.now(),
        w: pic.w, h: pic.h, palette: pic.palette, regions: pic.regions, rle: encodeMap(pic.map).buffer, thumb: await thumb.arrayBuffer(),
      });
      wait.remove();
      location.hash = `#/color/${id}/${res.level}`;
    } catch (e) {
      wait.remove();
      toast('Не получилось: ' + (e && e.message ? e.message : 'картинка не открылась'));
    }
  });
  input.click();
}

async function renderGallery(screen, tabs) {
  const pics = await catalog();
  const own = (await db.getAll('userpics')).sort((a, b) => b.createdAt - a.createdAt);
  const progress = new Map((await db.getAll('coloring')).map((r) => [r.key, r]));
  const head = h('header', { class: 'home-head' }, `
    <div>
      <div class="home-hello">раскрашиваем по номерам</div>
      <h1 class="home-title">Раскраски</h1>
    </div>`);
  const btnOwn = h('button', { class: 'chip-btn', type: 'button' }, `${icon('plus')}<span>Своя картинка</span>`);
  btnOwn.addEventListener('click', addOwnPicture);
  head.append(btnOwn);
  const search = h('input', { class: 'field search', type: 'search', placeholder: 'Найти: звёздная ночь, Ван Гог, кот…', 'aria-label': 'Поиск раскраски' });
  const grid = h('div', { class: 'pic-grid' });
  const cards = [];
  for (const u of own) {
    const pr = progress.get(`${u.id}:${u.level}`);
    const pct = pr ? Math.floor((pr.done / pr.total) * 100) : 0;
    const thumbUrl = URL.createObjectURL(new Blob([u.thumb], { type: 'image/jpeg' }));
    const card = h('button', { class: 'pic-card', type: 'button', 'aria-label': `${u.title}, своя картинка${pct ? `, раскрашено ${pct}%` : ''}` },
      `<span class="pic-thumb"><img src="${thumbUrl}" alt=""><span class="pic-badge own">моя</span>${pct ? `<span class="pic-bar"><i style="width:${pct}%"></i></span>` : ''}</span>
       <span class="pic-title">${esc(u.title)}</span><span class="pic-author">${esc(LEVELS[u.level] ? LEVELS[u.level].label : '')} · ${u.regions.length} областей</span>`);
    card.addEventListener('click', () => sheet({
      title: u.title,
      items: [
        { label: 'Раскрашивать', icon: 'palette', onClick: () => { location.hash = `#/color/${u.id}/${u.level}`; } },
        { label: 'Удалить картинку', icon: 'trash', danger: true, onClick: async () => {
          if (!(await confirmDialog('Удалить картинку?', `«${u.title}» и её раскраска исчезнут с этого iPad.`))) return;
          await db.del('userpics', u.id); await db.del('coloring', `${u.id}:${u.level}`); renderHome('colors');
        } },
      ],
    }));
    cards.push([card, `${u.title} моя своя`.toLowerCase()]);
    grid.append(card);
  }
  for (const p of pics) {
    const best = p.levels.map((l) => progress.get(`${p.id}:${l.key}`)).filter(Boolean).sort((a, b) => b.updatedAt - a.updatedAt)[0];
    const pct = best ? Math.floor((best.done / best.total) * 100) : 0;
    const card = h('button', { class: 'pic-card', type: 'button', 'aria-label': `${p.title}${p.author ? ', ' + p.author : ''}${pct ? `, раскрашено ${pct}%` : ''}` },
      `<span class="pic-thumb"><img src="${p.thumb}" alt="" loading="lazy">${p.kind === 'classic' ? '<span class="pic-badge">шедевр</span>' : ''}${pct ? `<span class="pic-bar"><i style="width:${pct}%"></i></span>` : ''}</span>
       <span class="pic-title">${esc(p.title)}</span>${p.author ? `<span class="pic-author">${esc(p.author)}${p.year ? ', ' + esc(p.year) : ''}</span>` : ''}`);
    card.addEventListener('click', () => {
      if (p.levels.length === 1) { location.hash = `#/color/${p.id}/${p.levels[0].key}`; return; }
      sheet({
        title: p.title,
        items: p.levels.map((l) => {
          const pr = progress.get(`${p.id}:${l.key}`);
          const tail = pr ? ` · ${Math.floor((pr.done / pr.total) * 100)}%` : '';
          return { label: `${l.label} — ${l.regions} областей${tail}`, icon: 'palette', onClick: () => { location.hash = `#/color/${p.id}/${l.key}`; } };
        }),
      });
    });
    cards.push([card, `${p.title} ${p.author} ${p.year} ${p.searchExtra || ''}`.toLowerCase().replace(/ё/g, 'е')]);
    grid.append(card);
  }
  const empty = h('p', { class: 'home-empty', hidden: true }, 'Ничего не нашлось. Можно добавить свою картинку кнопкой вверху.');
  search.addEventListener('input', () => {
    const q = search.value.trim().toLowerCase().replace(/ё/g, 'е');
    let shown = 0;
    for (const [card, text] of cards) { const on = !q || q.split(/\s+/).every((w) => text.includes(w)); card.hidden = !on; shown += on; }
    empty.hidden = shown > 0;
  });
  screen.append(head, tabs, h('p', { class: 'section-note' }, 'Выберите номер внизу и водите карандашом свободно: краска ложится только в области этого номера. Когда область закрашена почти целиком, цифра исчезает.'), search, grid, empty);
  if (!pics.length) screen.append(h('p', { class: 'home-empty' }, 'Раскраски не загрузились. Проверьте интернет и откройте ещё раз.'));
  root.append(screen);
}

// ---------- создание и правка блокнота ----------
function notebookForm(initial) {
  return (body) => {
    const state = { title: initial.title, cover: initial.cover, paper: initial.paper };
    const name = h('input', { class: 'field', type: 'text', maxlength: 60, value: state.title, 'aria-label': 'Название', placeholder: 'Например: Скетчи осени' });
    name.addEventListener('input', () => { state.title = name.value; });
    body.append(h('label', { class: 'field-label' }, 'Название'), name);
    body.append(h('div', { class: 'field-label' }, 'Обложка'));
    const covers = h('div', { class: 'cover-pick', role: 'radiogroup', 'aria-label': 'Обложка' });
    for (const k of COVER_KEYS) {
      const b = h('button', { class: 'cover-opt', type: 'button', role: 'radio', style: COVERS[k].css, title: COVERS[k].name, 'aria-label': COVERS[k].name });
      b.addEventListener('click', () => { state.cover = k; sync(); });
      covers.append(b);
    }
    body.append(covers);
    let papers = null;
    if (initial.withPaper) {
      body.append(h('div', { class: 'field-label' }, 'Бумага'));
      papers = h('div', { class: 'paper-pick', role: 'radiogroup', 'aria-label': 'Бумага' });
      for (const [k, label] of Object.entries(ink.PAPERS)) {
        const b = h('button', { class: 'paper-opt', type: 'button', role: 'radio', 'data-paper': k }, `<span class="paper-swatch" style="${ink.paperCss(k, 0.085)}"></span><span>${label}</span>`);
        b.addEventListener('click', () => { state.paper = k; sync(); });
        papers.append(b);
      }
      body.append(papers);
    }
    function sync() {
      covers.querySelectorAll('.cover-opt').forEach((b, i) => { const on = COVER_KEYS[i] === state.cover; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
      papers && papers.querySelectorAll('.paper-opt').forEach((b) => { const on = b.dataset.paper === state.paper; b.classList.toggle('on', on); b.setAttribute('aria-checked', on); });
    }
    sync();
    setTimeout(() => name.focus(), 50);
    return { value: () => state };
  };
}

async function createNotebook() {
  const count = (await db.getAll('notebooks')).length;
  await ink.ensureAllPapers(); // образцы шаблонов в выборе бумаги
  const res = await dialog({
    title: 'Новый блокнот',
    render: notebookForm({ title: `Блокнот ${count + 1}`, cover: COVER_KEYS[count % COVER_KEYS.length], paper: 'dots', withPaper: true }),
    actions: [{ label: 'Отмена', value: null }, { label: 'Создать', primary: true }],
  });
  if (!res) return;
  const now = Date.now();
  const nb = { id: db.uid(), title: (res.title || '').trim() || 'Без названия', cover: res.cover, paper: res.paper, pageIds: [], createdAt: now, updatedAt: now, lastPage: 0 };
  const p = blankPage(nb.id, res.paper);
  nb.pageIds = [p.id];
  await db.put('pages', p);
  await db.put('notebooks', nb);
  location.hash = `#/nb/${nb.id}`;
}

function notebookMenu(nb) {
  sheet({
    title: nb.title,
    items: [
      { label: 'Переименовать и сменить обложку', icon: 'edit', onClick: () => editNotebook(nb) },
      { label: 'Резервная копия блокнота', icon: 'download', onClick: () => exportBackup([nb.id]) },
      { label: 'Удалить блокнот', icon: 'trash', danger: true, onClick: async () => {
        const ok = await confirmDialog('Удалить блокнот?', `«${nb.title}» и все его страницы исчезнут с этого iPad. Если нужна копия, сначала сохраните резервную копию.`);
        if (ok) { await db.deleteNotebook(nb.id); toast('Блокнот удалён'); renderHome(); }
      } },
    ],
  });
}

async function editNotebook(nb) {
  const res = await dialog({
    title: 'Блокнот',
    render: notebookForm({ title: nb.title, cover: nb.cover, paper: nb.paper }),
    actions: [{ label: 'Отмена', value: null }, { label: 'Сохранить', primary: true }],
  });
  if (!res) return;
  nb.title = (res.title || '').trim() || nb.title;
  nb.cover = res.cover;
  nb.updatedAt = Date.now();
  await db.put('notebooks', nb);
  renderHome();
}

// ---------- напоминание о резервной копии ----------
// Safari может удалить данные сайта, если им долго не пользоваться. Раз в месяц мягко напоминаем сохранить копию в «Файлы».
const DAY = 24 * 3600 * 1000;
async function backupReminder(notebooks) {
  if (!notebooks.length) return null;
  const now = Date.now();
  let first = await db.getMeta('firstUse', 0);
  if (!first) { first = now; await db.setMeta('firstUse', now); }
  const last = await db.getMeta('lastBackup', 0);
  const snooze = await db.getMeta('backupSnooze', 0);
  const since = last || first;
  if (now - since < 30 * DAY || now < snooze) return null;
  const days = Math.floor((now - since) / DAY);
  const card = h('div', { class: 'backup-note', role: 'status' }, `
    <span class="backup-ic">${icon('shield', 22)}</span>
    <div class="backup-text"><b>${last ? `Последняя резервная копия — ${days} дн. назад` : 'Резервной копии ещё не было'}</b>
    <span>Safari иногда удаляет данные сайтов. Сохраните копию всех блокнотов в «Файлы» — это минута.</span></div>`);
  const actions = h('div', { class: 'backup-actions' });
  const save = h('button', { class: 'btn btn-primary', type: 'button' }, 'Сохранить копию');
  save.addEventListener('click', () => exportBackup(null));
  const later = h('button', { class: 'btn btn-ghost', type: 'button' }, 'Позже');
  later.addEventListener('click', async () => { await db.setMeta('backupSnooze', Date.now() + 7 * DAY); card.remove(); });
  actions.append(save, later);
  card.append(actions);
  return card;
}

// фото, на которые больше не ссылается ни одна страница, удаляем (не раньше чем через 2 дня — чтобы работала отмена)
async function cleanImages() {
  const used = new Set();
  for (const p of await db.getAll('pages')) for (const st of p.stickers || []) if (st.key === 'I') used.add(st.img);
  for (const im of await db.getAll('images')) if (!used.has(im.id) && Date.now() - (im.createdAt || 0) > 2 * DAY) await db.del('images', im.id);
}

// ---------- резервная копия ----------
// Файл .json со всеми штрихами. Его можно сохранить в «Файлы» и вернуть, если Safari что-то сотрёт.
async function exportBackup(ids) {
  const all = await db.getAll('notebooks');
  const list = ids ? all.filter((n) => ids.includes(n.id)) : all;
  const out = { app: 'pastel-studio', version: 2, savedAt: new Date().toISOString(), notebooks: [], images: [] };
  const imgIds = new Set();
  for (const nb of list) {
    const pages = await db.pagesOf(nb.id);
    for (const p of pages) for (const st of p.stickers || []) if (st.key === 'I') imgIds.add(st.img);
    out.notebooks.push({ ...nb, pages: pages.map((p) => ({ ...p, strokes: p.strokes.map((s) => ({ ...s, pts: Array.from(s.pts, (v) => Math.round(v * 10) / 10) })) })) });
  }
  // фото из блокнотов едут внутри файла, иначе после восстановления на их месте будет пусто
  for (const id of imgIds) {
    const rec = await db.get('images', id);
    if (rec) out.images.push({ id: rec.id, type: rec.type, w: rec.w, h: rec.h, data: toBase64(rec.buf) });
  }
  const blob = new Blob([JSON.stringify(out)], { type: 'application/json' });
  const date = new Date().toISOString().slice(0, 10);
  const name = ids && list.length === 1 ? `${list[0].title} — копия ${date}.json` : `Пастель — все блокноты ${date}.json`;
  const how = await saveFile(blob, name);
  if (how === 'cancelled') return;
  if (!ids || list.length === all.length) await db.setMeta('lastBackup', Date.now());
  if (how === 'downloaded') toast('Резервная копия сохранена');
  if (location.hash === '' || location.hash === '#/') renderHome();
}
function toBase64(buf) {
  const u = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64) {
  const s = atob(b64), u = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) u[i] = s.charCodeAt(i);
  return u.buffer;
}

function importBackup() {
  const input = h('input', { type: 'file', accept: 'application/json,.json' });
  input.addEventListener('change', async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      if (data.app !== 'pastel-studio' || !Array.isArray(data.notebooks)) throw new Error('это не резервная копия Пастели');
      let n = 0;
      for (const im of data.images || []) {
        if (!im || !im.id || !im.data || (await db.get('images', im.id))) continue;
        await db.put('images', { id: im.id, type: im.type || 'image/jpeg', w: im.w, h: im.h, buf: fromBase64(im.data), createdAt: Date.now() });
      }
      for (const nb of data.notebooks) {
        const newId = db.uid();
        const pageIds = [];
        for (const p of nb.pages || []) {
          const pid = db.uid();
          pageIds.push(pid);
          await db.put('pages', { id: pid, notebookId: newId, paper: p.paper || 'blank', updatedAt: Date.now(), strokes: (p.strokes || []).map((s) => ({ ...s, pts: Float32Array.from(s.pts || []) })), stickers: Array.isArray(p.stickers) ? p.stickers : [] });
        }
        const { pages, ...rest } = nb;
        await db.put('notebooks', { ...rest, id: newId, pageIds, lastPage: 0, updatedAt: Date.now() });
        n++;
      }
      toast(`Восстановлено блокнотов: ${n}`);
      renderHome();
    } catch (e) {
      toast('Не получилось открыть файл: ' + e.message);
    }
  });
  input.click();
}

async function homeMenu() {
  const persisted = navigator.storage && navigator.storage.persisted ? await navigator.storage.persisted().catch(() => false) : false;
  sheet({
    title: 'Пастель',
    items: [
      { label: 'Резервная копия всех блокнотов', icon: 'download', onClick: () => exportBackup(null) },
      { label: 'Восстановить из копии', icon: 'upload', onClick: importBackup },
      { separator: true },
      { label: 'Рисовать пальцем', icon: 'hand', checked: !!settings.fingerDraw, onClick: () => { settings.fingerDraw = !settings.fingerDraw; db.setMeta('fingerDraw', settings.fingerDraw); } },
      { label: persisted ? 'Хранилище защищено от очистки' : 'Хранилище: добавьте на экран «Домой»', icon: 'shield', onClick: async () => {
        const r = await db.askPersistence();
        toast(r === 'granted' ? 'Safari обещал не удалять данные' : 'Safari пока не разрешил. Откройте приложение с экрана «Домой» и делайте резервные копии');
      } },
    ],
  });
}

boot();

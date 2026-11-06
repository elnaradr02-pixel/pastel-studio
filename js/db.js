// Хранилище в браузере (IndexedDB): блокноты, страницы, служебные настройки.
// localStorage не подходит: в Safari он маленький, а штрихи страниц весят много.

const DB_NAME = 'pastel-studio';
const DB_VERSION = 4; // 2: раскраски (прогресс), 3: свои картинки, 4: фото в блокнотах
let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains('notebooks')) db.createObjectStore('notebooks', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('pages')) {
        const pages = db.createObjectStore('pages', { keyPath: 'id' });
        pages.createIndex('byNotebook', 'notebookId');
      }
      if (!db.objectStoreNames.contains('meta')) db.createObjectStore('meta', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('coloring')) db.createObjectStore('coloring', { keyPath: 'key' });
      if (!db.objectStoreNames.contains('userpics')) db.createObjectStore('userpics', { keyPath: 'id' });
      if (!db.objectStoreNames.contains('images')) db.createObjectStore('images', { keyPath: 'id' });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

function done(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function store(name, mode = 'readonly') {
  const db = await openDb();
  return db.transaction(name, mode).objectStore(name);
}

export async function getAll(name) { return done((await store(name)).getAll()); }
export async function get(name, id) { return done((await store(name)).get(id)); }
export async function put(name, value) { return done((await store(name, 'readwrite')).put(value)); }
export async function del(name, id) { return done((await store(name, 'readwrite')).delete(id)); }

export async function pagesOf(notebookId) {
  const s = await store('pages');
  return done(s.index('byNotebook').getAll(notebookId));
}

export async function deleteNotebook(notebookId) {
  const db = await openDb();
  const tx = db.transaction(['notebooks', 'pages'], 'readwrite');
  tx.objectStore('notebooks').delete(notebookId);
  const pages = tx.objectStore('pages');
  const keys = await done(pages.index('byNotebook').getAllKeys(notebookId));
  keys.forEach((k) => pages.delete(k));
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}

export async function getMeta(key, fallback = null) {
  const row = await get('meta', key);
  return row ? row.value : fallback;
}
export async function setMeta(key, value) { return put('meta', { key, value }); }

// Просим Safari не удалять данные при нехватке места. Чаще всего соглашается,
// когда приложение добавлено на экран «Домой». Ответ показываем в настройках.
export async function askPersistence() {
  try {
    if (!navigator.storage || !navigator.storage.persist) return 'unsupported';
    if (await navigator.storage.persisted()) return 'granted';
    return (await navigator.storage.persist()) ? 'granted' : 'denied';
  } catch {
    return 'unsupported';
  }
}

export function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

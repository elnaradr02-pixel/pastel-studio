// Сервис-воркер: держит всё приложение в кэше, чтобы оно открывалось без интернета.
// При изменении любого файла приложения поднимайте VERSION — так iPad скачает новую версию.
const VERSION = 'pastel-v5';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/db.js', 'js/ink.js', 'js/notebook.js', 'js/ui.js', 'js/icons.js', 'js/covers.js',
  'js/shapes.js', 'js/stickers.js', 'js/coloring.js', 'js/pbn.js', 'data/catalog.json',
  'fonts/comfortaa-latin.woff2', 'fonts/comfortaa-latin-ext.woff2', 'fonts/comfortaa-cyrillic.woff2', 'fonts/comfortaa-cyrillic-ext.woff2',
  'fonts/nunito-latin.woff2', 'fonts/nunito-latin-ext.woff2', 'fonts/nunito-cyrillic.woff2', 'fonts/nunito-cyrillic-ext.woff2',
  'fonts/caveat-latin.woff2', 'fonts/caveat-latin-ext.woff2', 'fonts/caveat-cyrillic.woff2', 'fonts/caveat-cyrillic-ext.woff2',
  'fonts/bad-script-latin.woff2', 'fonts/bad-script-latin-ext.woff2', 'fonts/bad-script-cyrillic.woff2', 'fonts/bad-script-cyrillic-ext.woff2',
  'fonts/pangolin-latin.woff2', 'fonts/pangolin-latin-ext.woff2', 'fonts/pangolin-cyrillic.woff2', 'fonts/pangolin-cyrillic-ext.woff2',
  'fonts/cormorant-latin.woff2', 'fonts/cormorant-latin-ext.woff2', 'fonts/cormorant-cyrillic.woff2', 'fonts/cormorant-cyrillic-ext.woff2',
  'fonts/pacifico-latin.woff2', 'fonts/pacifico-latin-ext.woff2', 'fonts/pacifico-cyrillic.woff2', 'fonts/pacifico-cyrillic-ext.woff2',
  'fonts/yeseva-latin.woff2', 'fonts/yeseva-latin-ext.woff2', 'fonts/yeseva-cyrillic.woff2', 'fonts/yeseva-cyrillic-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

// Раскраски тоже скачиваются сразу (около 5 МБ), чтобы все картины открывались без интернета.
async function libraryFiles() {
  const res = await fetch('data/catalog.json', { cache: 'no-cache' });
  const { pictures } = await res.json();
  const files = [];
  for (const p of pictures) {
    files.push(p.thumb);
    for (const l of p.levels) files.push(`data/${p.id}-${l.key}.json`, `data/${p.id}-${l.key}.bin`);
  }
  return files;
}

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const c = await caches.open(VERSION);
    await c.addAll(ASSETS);
    try { await c.addAll(await libraryFiles()); } catch { /* не страшно: картины докачаются при открытии */ }
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

// Сначала кэш, затем сеть. Открытие страницы без сети — всегда index.html из кэша.
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  if (req.mode === 'navigate') {
    e.respondWith(caches.match('index.html').then((r) => r || fetch(req)));
    return;
  }
  e.respondWith(
    caches.match(req, { ignoreSearch: true }).then((hit) => hit || fetch(req).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(VERSION).then((c) => c.put(req, copy)); }
      return res;
    }))
  );
});

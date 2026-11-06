// Сервис-воркер: держит всё приложение в кэше, чтобы оно открывалось без интернета.
// При изменении любого файла приложения поднимайте VERSION — так iPad скачает новую версию.
const VERSION = 'pastel-v1';
const ASSETS = [
  './', 'index.html', 'manifest.webmanifest',
  'css/app.css', 'css/fonts.css',
  'js/app.js', 'js/db.js', 'js/ink.js', 'js/notebook.js', 'js/ui.js', 'js/icons.js', 'js/covers.js',
  'fonts/comfortaa-latin.woff2', 'fonts/comfortaa-latin-ext.woff2', 'fonts/comfortaa-cyrillic.woff2', 'fonts/comfortaa-cyrillic-ext.woff2',
  'fonts/nunito-latin.woff2', 'fonts/nunito-latin-ext.woff2', 'fonts/nunito-cyrillic.woff2', 'fonts/nunito-cyrillic-ext.woff2',
  'icons/icon.svg', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/icon-maskable-512.png', 'icons/apple-touch-icon.png',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(VERSION).then((c) => c.addAll(ASSETS)).then(() => self.skipWaiting()));
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

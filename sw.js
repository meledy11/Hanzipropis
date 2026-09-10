/* Service Worker для Прописи HSK 1-3 */

const CACHE = 'hanzi-hsk13-v1';

// Что кэшируем при установке
const ASSETS = [
  './',
  './index.html',
  './hsk-data.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

// Установка — кэшируем статику
self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => c.addAll(ASSETS))
      .then(() => self.skipWaiting())
      .catch(() => {}) // не падаем, если CDN недоступен
  );
});

// Активация — чистим старые версии
self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

// Перехват запросов
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  e.respondWith(
    caches.match(e.request).then((cached) => {
      if (cached) return cached;

      return fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const url = new URL(e.request.url);
          const cacheable =
            url.origin === location.origin ||
            url.hostname.includes('jsdelivr.net');
          if (cacheable) {
            const clone = res.clone();
            caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
          }
        }
        return res;
      }).catch(() => {
        // офлайн-фолбэк
        if (e.request.mode === 'navigate') return caches.match('./index.html');
        return new Response('', { status: 503, statusText: 'Offline' });
      });
    })
  );
});

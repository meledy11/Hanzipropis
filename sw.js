/* sw.js — Service Worker
   Кэширует страницы, скрипты, стили, базы данных.
   Audio/* кэшируется по факту запроса (runtime).
*/
const CACHE_NAME = 'hanzi-app-v4';
const RUNTIME_CACHE = 'hanzi-runtime-v4';

// Файлы, которые кэшируем сразу при установке
const PRECACHE_ASSETS = [
  './',
  './index.html',
  './trainer.html',
  './trainer.js',
  './dictionary.html',
  './grammar.html',
  './dictionary-data.js',
  './hsk-data.js',
  './manifest.json'
];

// Установка
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => {
        console.log('[SW] Precache:', PRECACHE_ASSETS.length, 'файлов');
        return cache.addAll(PRECACHE_ASSETS).catch(err => {
          console.warn('[SW] Часть файлов не закэширована:', err);
        });
      })
      .then(() => self.skipWaiting())
  );
});

// Активация — чистим старые кэши
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((names) => {
      return Promise.all(
        names
          .filter((name) => name !== CACHE_NAME && name !== RUNTIME_CACHE)
          .map((name) => {
            console.log('[SW] Удаляем старый кэш:', name);
            return caches.delete(name);
          })
      );
    }).then(() => self.clients.claim())
  );
});

// Fetch
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  if (req.method !== 'GET') return;
  if (!url.protocol.startsWith('http')) return;

  // AUDIO — runtime cache
  if (url.pathname.includes('/Audio/') || url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((response) => {
            if (response && response.status === 200) {
              cache.put(req, response.clone());
            }
            return response;
          }).catch(() => {
            return new Response('', { status: 404, statusText: 'Audio offline' });
          });
        });
      })
    );
    return;
  }

  // CDN (hanzi-writer, pinyin-pro, Google Fonts) — network-first
  if (url.origin !== self.location.origin) {
    event.respondWith(
      fetch(req).then((response) => {
        if (response && response.status === 200) {
          const copy = response.clone();
          caches.open(RUNTIME_CACHE).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => caches.match(req))
    );
    return;
  }

  // Всё остальное (same-origin) — cache-first
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        fetch(req).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, response));
          }
        }).catch(() => {});
        return cached;
      }

      return fetch(req).then((response) => {
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => {
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Сообщение от страницы
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});
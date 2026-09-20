/* sw.js — Service Worker для офлайн-режима
   Кэширует все страницы, скрипты и стили.
   Audio/* кэшируется по мере запроса (runtime cache).
*/
const CACHE_NAME = 'hanzi-app-v3';
const RUNTIME_CACHE = 'hanzi-runtime-v3';

// Файлы, которые кэшируем СРАЗУ при установке
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

// Установка — кэшируем базовые файлы
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

// Fetch — стратегия:
//  - HTML, JS, CSS, JSON → cache-first (быстро + офлайн)
//  - Audio/*.mp3 → runtime cache (кэшируем по факту первого запроса)
//  - Google Fonts CDN → network-first с fallback на кэш
self.addEventListener('fetch', (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Только GET
  if (req.method !== 'GET') return;

  // Пропускаем chrome-extension и прочее
  if (!url.protocol.startsWith('http')) return;

  // ==== AUDIO: runtime cache ====
  if (url.pathname.includes('/Audio/') || url.pathname.endsWith('.mp3')) {
    event.respondWith(
      caches.open(RUNTIME_CACHE).then((cache) => {
        return cache.match(req).then((cached) => {
          if (cached) return cached;
          return fetch(req).then((response) => {
            // Кэшируем только успешные ответы
            if (response && response.status === 200) {
              cache.put(req, response.clone());
            }
            return response;
          }).catch(() => {
            // Офлайн и нет в кэше — возвращаем «пустой» ответ (вызовет fallback на браузерный голос)
            return new Response('', { status: 404, statusText: 'Audio offline' });
          });
        });
      })
    );
    return;
  }

  // ==== ВСЁ ОСТАЛЬНОЕ: cache-first ====
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) {
        // Обновляем в фоне (stale-while-revalidate)
        fetch(req).then((response) => {
          if (response && response.status === 200) {
            caches.open(CACHE_NAME).then((cache) => cache.put(req, response));
          }
        }).catch(() => {});
        return cached;
      }

      // Нет в кэше — идём в сеть
      return fetch(req).then((response) => {
        // Кэшируем только same-origin успешные
        if (response && response.status === 200 && url.origin === self.location.origin) {
          const copy = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(req, copy));
        }
        return response;
      }).catch(() => {
        // Офлайн — отдаём index.html для навигационных запросов
        if (req.mode === 'navigate') {
          return caches.match('./index.html');
        }
        return new Response('Offline', { status: 503 });
      });
    })
  );
});

// Сообщение от страницы: пропустить ожидание (мгновенное обновление SW)
self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

/* Service Worker: прописи + грамматика + словарь */

const CACHE = 'hanzi-hsk13-v5';

const ASSETS = [
  './',
  './index.html',
  './grammar.html',
  './dictionary.html',
  './hsk-data.js',
  './dictionary-data.js',
  './manifest.json',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

// Установка — кэшируем каждый файл отдельно, чтобы один сбой не сломал установку
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.warn('[sw] не удалось закэшировать', url, err))
      )
    );
    await self.skipWaiting();
  })());
});

// Активация — чистим старые версии
self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Сообщения со страниц
self.addEventListener('message', (e) => {
  if (e.data && e.data.type === 'SKIP_WAITING') self.skipWaiting();
  if (e.data && e.data.type === 'CLEAR_CACHE') {
    caches.delete(CACHE).then(() =>
      self.clients.matchAll().then(list => list.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' })))
    );
  }
});

// Перехват запросов
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname.endsWith('jsdelivr.net');

  // Навигация: сеть → кэш → index.html
  if (req.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const clone = fresh.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  if (!sameOrigin && !isCdn) return;

  // Остальное: cache-first, фоном обновляем
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req)
        .then(res => {
          if (res && res.status === 200 && res.type !== 'opaque') {
            caches.open(CACHE).then(c => c.put(req, res.clone())).catch(() => {});
          }
        })
        .catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.status === 200 && res.type !== 'opaque') {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    } catch {
      return caches.match('./index.html') || new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

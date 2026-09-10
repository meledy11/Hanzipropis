// ============================================================
// Service worker: офлайн-кэш для прописей + грамматики
// ============================================================

const CACHE = 'hanzi-app-v1';

// Файлы, которые кэшируем сразу
const CORE_ASSETS = [
  './',
  './index.html',
  './grammar.html',
  './hsk-data.js',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache =>
      // Каждый файл пытаемся положить отдельно, чтобы один сбой не сломал всю установку
      Promise.all(
        CORE_ASSETS.map(url =>
          cache.add(url).catch(err => console.warn('[sw] не удалось закэшировать', url, err))
        )
      )
    ).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const sameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname.endsWith('jsdelivr.net');

  // Для навигационных запросов: сначала сеть, при неудаче — кэш index.html
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
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

  // Для остальных: stale-while-revalidate
  event.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      fetch(req)
        .then(res => { if (res && res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); })
        .catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res && res.ok) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
      }
      return res;
    } catch (err) {
      return caches.match('./index.html');
    }
  })());
});

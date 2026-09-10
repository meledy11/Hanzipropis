// ============================================================
// Service worker: офлайн-кэш для прописей + грамматики.
// Иконки в манифесте — эмодзи, файлов-картинок нет.
// ============================================================

const CACHE = 'hanzi-app-v1';
const OFFLINE_URL = './index.html';

// Файлы, которые кэшируем при установке
const CORE_ASSETS = [
  './',
  './index.html',
  './grammar.html',
  './hsk-data.js',
  './manifest.webmanifest',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

// --- Установка: тянем всё сразу ---
self.addEventListener('install', event => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(
      CORE_ASSETS.map(url =>
        cache.add(new Request(url, { cache: 'reload' }))
          .catch(err => console.warn('[sw] не удалось закэшировать', url, err))
      )
    );
    await self.skipWaiting();
  })());
});

// --- Активация: чистим старые кэши ---
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)));
    if (self.registration.navigationPreload) {
      try { await self.registration.navigationPreload.disable(); } catch (e) {}
    }
    await self.clients.claim();
  })());
});

// --- Сообщения от страниц ---
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
  if (event.data?.type === 'CLEAR_CACHE') {
    caches.delete(CACHE).then(() => self.clients.matchAll()).then(clients =>
      clients.forEach(c => c.postMessage({ type: 'CACHE_CLEARED' }))
    );
  }
});

// --- Перехват запросов ---
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const isSameOrigin = url.origin === self.location.origin;
  const isCdn = url.hostname.endsWith('jsdelivr.net');

  // Навигация: сеть → кэш → офлайн-страница
  if (req.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const fresh = await fetch(req);
        const clone = fresh.clone();
        caches.open(CACHE).then(c => c.put(req, clone)).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(req);
        if (cached) return cached;
        const fallback = await caches.match(OFFLINE_URL);
        return fallback || new Response('Офлайн', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
      }
    })());
    return;
  }

  if (!isSameOrigin && !isCdn) return;

  // Остальное: сначала кэш, в фоне — обновление
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
    } catch {
      return caches.match(OFFLINE_URL) || new Response('Офлайн', { status: 503 });
    }
  })());
});

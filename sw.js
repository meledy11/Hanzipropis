/* Service Worker: одно приложение — прописи + грамматика */

const CACHE = 'hanzi-hsk13-v4';

const ASSETS = [
  './',
  './index.html',
  './grammar.html',
  './hsk-data.js',
  './manifest.json',
  './icon-boot.js',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE)
      .then((c) => Promise.all(
        ASSETS.map(url => c.add(url).catch(err => console.warn('[sw] skip', url, err)))
      ))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('message', (e) => {
  if (e.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  if (e.request.mode === 'navigate') {
    e.respondWith((async () => {
      try {
        const fresh = await fetch(e.request);
        const clone = fresh.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
        return fresh;
      } catch {
        const cached = await caches.match(e.request);
        return cached || caches.match('./index.html');
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const cached = await caches.match(e.request);
    if (cached) {
      fetch(e.request).then((res) => {
        if (res && res.status === 200 && res.type !== 'opaque') {
          const u = new URL(e.request.url);
          if (u.origin === location.origin || u.hostname.includes('jsdelivr.net')) {
            caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
          }
        }
      }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(e.request);
      if (res && res.status === 200 && res.type !== 'opaque') {
        const u = new URL(e.request.url);
        if (u.origin === location.origin || u.hostname.includes('jsdelivr.net')) {
          caches.open(CACHE).then((c) => c.put(e.request, res.clone())).catch(() => {});
        }
      }
      return res;
    } catch {
      return new Response('', { status: 503, statusText: 'Offline' });
    }
  })());
});

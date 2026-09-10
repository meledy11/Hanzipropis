const CACHE = 'hanzi-v1';
const ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './hsk-data.js',
  'https://cdn.jsdelivr.net/npm/hanzi-writer@3.7/dist/hanzi-writer.min.js',
  'https://cdn.jsdelivr.net/npm/pinyin-pro@3.26.0/dist/index.js'
];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(ASSETS)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys().then(keys =>
      Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k)))
    ).then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;

  // Cache-first для своих файлов, stale-while-revalidate для CDN
  e.respondWith((async () => {
    const cached = await caches.match(req);
    if (cached) {
      // тихо обновляем в фоне
      fetch(req).then(res => { if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone())); }).catch(() => {});
      return cached;
    }
    try {
      const res = await fetch(req);
      if (res.ok && (req.url.startsWith(self.location.origin) || req.url.includes('jsdelivr'))) {
        const clone = res.clone();
        caches.open(CACHE).then(c => c.put(req, clone));
      }
      return res;
    } catch {
      return caches.match('./index.html');
    }
  })());
});

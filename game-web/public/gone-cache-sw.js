const CACHE_PREFIX = 'gone-performance-pack-';
const CACHE_NAME = `${CACHE_PREFIX}2026-09-11-v1`;

function isCacheable(request) {
  if (request.method !== 'GET') return false;
  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return false;
  if (request.headers.has('range')) return false;
  const path = url.pathname;
  return (
    path.startsWith('/assets/') ||
    path.startsWith('/pkg/') ||
    /\.(?:js|css|wasm|glb|svg)$/i.test(path)
  );
}

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith(CACHE_PREFIX) && name !== CACHE_NAME)
        .map((name) => caches.delete(name)),
    );
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  if (!isCacheable(event.request)) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const cached = await cache.match(event.request);
    if (cached) return cached;

    const response = await fetch(event.request);
    if (response.ok) {
      event.waitUntil(cache.put(event.request, response.clone()));
    }
    return response;
  })());
});

self.addEventListener('message', (event) => {
  if (event.data?.type !== 'CACHE_PERFORMANCE_PACK') return;
  const port = event.ports?.[0];
  if (!port) return;

  event.waitUntil((async () => {
    const urls = [...new Set(Array.isArray(event.data.urls) ? event.data.urls : [])];
    if (event.data.refresh) await caches.delete(CACHE_NAME);
    const cache = await caches.open(CACHE_NAME);
    let done = 0;
    let failed = 0;
    let bytes = 0;

    for (const raw of urls) {
      try {
        const url = new URL(String(raw), self.location.origin);
        if (url.origin !== self.location.origin) throw new Error('cross-origin');
        const request = new Request(url.href, { credentials: 'same-origin', cache: 'reload' });
        const response = await fetch(request);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const length = Number(response.headers.get('content-length') || 0);
        if (Number.isFinite(length) && length > 0) bytes += length;
        await cache.put(request, response.clone());
      } catch {
        failed += 1;
      }

      done += 1;
      port.postMessage({ type: 'progress', done, total: urls.length, failed, bytes });
    }

    port.postMessage({ type: 'complete', done, total: urls.length, failed, bytes });
  })());
});

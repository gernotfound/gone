const PWA_SHELL_CACHE = 'gone-pwa-shell-v4';
const PWA_RUNTIME_CACHE = 'gone-pwa-runtime-v4';
const PERFORMANCE_CACHE_PREFIX = 'gone-performance-pack-';
const params = new URL(self.location.href).searchParams;
const rawVersion = params.get('v') || 'runtime-v2';
const safeVersion = rawVersion.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
const PERFORMANCE_CACHE_NAME = `${PERFORMANCE_CACHE_PREFIX}${safeVersion}`;

const APP_SHELL = [
  '/',
  '/manifest.webmanifest',
  '/favicon.svg',
  '/pwa-icon-192.png',
  '/pwa-icon-512.png',
  '/apple-touch-icon.png',
];

function sameOrigin(request) {
  try { return new URL(request.url).origin === self.location.origin; } catch { return false; }
}

function isStaticAsset(request) {
  if (request.method !== 'GET' || !sameOrigin(request)) return false;
  const path = new URL(request.url).pathname;
  return path.startsWith('/assets/') || path.startsWith('/pkg/') ||
    /\.(?:js|css|wasm|glb|svg|png|webp|jpg|jpeg|mp3|webmanifest)$/i.test(path);
}

async function firstCached(request) {
  const match = await caches.match(request, { ignoreSearch: false });
  return match || null;
}

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(PWA_SHELL_CACHE);
    await Promise.allSettled(APP_SHELL.map(async (path) => {
      const response = await fetch(path, { cache: 'reload' });
      if (response.ok) await cache.put(path, response);
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(names
      .filter((name) => name.startsWith('gone-pwa-') && name !== PWA_SHELL_CACHE && name !== PWA_RUNTIME_CACHE)
      .map((name) => caches.delete(name)));
    // Performance-pack caches are managed by cacheIntegrity.ts and are never
    // purged here, so the optional heavy asset preload remains compatible.
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET' || !sameOrigin(request)) return;
  if (request.headers.has('range')) return;

  if (request.mode === 'navigate') {
    event.respondWith((async () => {
      try {
        const response = await fetch(request);
        if (response.ok) {
          const cache = await caches.open(PWA_SHELL_CACHE);
          await cache.put('/', response.clone());
        }
        return response;
      } catch {
        return (await caches.match('/')) || Response.error();
      }
    })());
    return;
  }

  if (!isStaticAsset(request)) return;
  event.respondWith((async () => {
    const cached = await firstCached(request);
    if (cached) return cached;
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(PWA_RUNTIME_CACHE);
      await cache.put(request, response.clone());
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
    if (event.data.refresh) await caches.delete(PERFORMANCE_CACHE_NAME);
    const cache = await caches.open(PERFORMANCE_CACHE_NAME);
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
        await cache.put(url.href, response.clone());
      } catch {
        failed += 1;
      }
      done += 1;
      port.postMessage({ type: 'progress', done, total: urls.length, failed, bytes });
    }

    port.postMessage({ type: 'complete', done, total: urls.length, failed, bytes });
  })());
});

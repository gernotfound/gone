const params = new URL(self.location.href).searchParams;
const rawVersion = params.get('v') || 'runtime-v5';
const safeVersion = rawVersion.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80);
const PWA_SHELL_CACHE = `gone-pwa-shell-${safeVersion}`;
const PWA_RUNTIME_CACHE = `gone-pwa-runtime-${safeVersion}`;
const PERFORMANCE_CACHE_PREFIX = 'gone-performance-pack-';
const PERFORMANCE_CACHE_NAME = `${PERFORMANCE_CACHE_PREFIX}${safeVersion}`;
const MAX_PWA_CACHE_GENERATIONS = 4;

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

async function pruneOldPwaCaches() {
  const names = await caches.keys();
  const pwaNames = names.filter((name) => name.startsWith('gone-pwa-'));
  const keep = new Set([PWA_SHELL_CACHE, PWA_RUNTIME_CACHE]);
  for (let i = pwaNames.length - 1; i >= 0 && keep.size < MAX_PWA_CACHE_GENERATIONS * 2; i -= 1) {
    keep.add(pwaNames[i]);
  }
  await Promise.all(pwaNames.filter((name) => !keep.has(name)).map((name) => caches.delete(name)));
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
    // Keep a few previous build generations alive so an already-open PvP tab
    // can finish safely even after a new worker claims the scope.
    await pruneOldPwaCaches();
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
        const response = await fetch(request, { cache: 'no-store' });
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
  if (event.data?.type === 'SKIP_WAITING') {
    event.waitUntil(self.skipWaiting());
    return;
  }
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

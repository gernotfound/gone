import { browserLifecycle } from '../runtime/browserLifecycle.ts';

const PACK_SCHEMA_VERSION = 2;
const STORAGE_PREFIX = 'gone-performance-pack:';
const CACHE_PREFIX = 'gone-performance-pack-';
const STATIC_ASSETS = [
  '/assets/modello.glb', '/assets/assalto.glb', '/assets/cecchino.glb', '/assets/pompa.glb',
  '/assets/mitraglietta.glb', '/assets/coltello.glb', '/favicon.svg', '/icons.svg', '/Colossus March.mp3',
] as const;

type IntegrityState = {
  status: 'checking' | 'ready' | 'not-preloaded' | 'missing' | 'incomplete' | 'unsupported';
  buildToken: string;
  expected: number;
  cached: number;
  missing: string[];
  staleCachesRemoved: number;
  lastCheckAt: number;
};

let frozenBuildToken = '';
let state: IntegrityState = { status: 'checking', buildToken: '', expected: 0, cached: 0, missing: [], staleCachesRemoved: 0, lastCheckAt: 0 };
let integrityTimer: number | null = null;
let validationPromise: Promise<IntegrityState> | null = null;

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) { hash ^= text.charCodeAt(i); hash = Math.imul(hash, 0x01000193); }
  return (hash >>> 0).toString(36);
}
function addBuildCandidate(target: Set<string>, raw: string | null | undefined): void {
  if (!raw) return;
  try {
    const url = new URL(raw, location.href);
    if (url.origin === location.origin && /\/(?:assets|pkg)\//.test(url.pathname) && /\.(?:js|css|wasm)$/i.test(url.pathname)) target.add(url.pathname + url.search);
  } catch { /* malformed URL */ }
}
function buildToken(): string {
  const candidates = new Set<string>();
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => addBuildCandidate(candidates, el.src));
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((el) => addBuildCandidate(candidates, el.href));
  for (const entry of performance.getEntriesByType('resource')) addBuildCandidate(candidates, (entry as PerformanceResourceTiming).name);
  const signature = [...candidates].sort().join('|') || `${location.pathname}|runtime`;
  return `v${PACK_SCHEMA_VERSION}-${fingerprint(signature)}`;
}
function collectExpectedAssets(): string[] {
  const urls = new Set<string>(STATIC_ASSETS);
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname.startsWith('/assets/') || url.pathname.startsWith('/pkg/') || /\.(?:js|css|wasm|glb|svg|mp3)$/i.test(url.pathname)) urls.add(url.pathname + url.search);
    } catch { /* malformed URL */ }
  };
  for (const entry of performance.getEntriesByType('resource')) add((entry as PerformanceResourceTiming).name);
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => add(el.src));
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((el) => add(el.href));
  return [...urls];
}
function cacheName(token: string): string { return `${CACHE_PREFIX}${token.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`; }
function updateButtonForIncomplete(missing: number): void {
  const button = document.getElementById('btn-performance-pack') as HTMLButtonElement | null;
  const status = document.getElementById('performance-pack-status');
  if (!button || !status) return;
  button.textContent = 'AGGIORNA DATI PRECARICATI';
  status.textContent = `Cache incompleta: ${missing} asset da ripristinare.`;
  status.className = status.className.replace(/text-(?:emerald|slate)-\d+/g, 'text-amber-400');
}
async function validateInternal(): Promise<IntegrityState> {
  if (!frozenBuildToken) frozenBuildToken = buildToken();
  const token = frozenBuildToken;
  const expected = collectExpectedAssets();
  const markerKey = `${STORAGE_PREFIX}${token}`;
  state = { ...state, status: 'checking', buildToken: token, expected: expected.length, lastCheckAt: Date.now() };
  if (!('caches' in window)) return state = { ...state, status: 'unsupported', cached: 0, missing: [] };

  const currentName = cacheName(token);
  const names = await caches.keys();
  let staleRemoved = 0;
  await Promise.all(names.map(async (name) => {
    if (name.startsWith(CACHE_PREFIX) && name !== currentName && await caches.delete(name)) staleRemoved += 1;
  }));
  const staleTotal = state.staleCachesRemoved + staleRemoved;

  if (!localStorage.getItem(markerKey)) return state = { ...state, status: 'not-preloaded', cached: 0, missing: [], staleCachesRemoved: staleTotal };
  if (!(await caches.has(currentName))) {
    localStorage.removeItem(markerKey); updateButtonForIncomplete(expected.length);
    return state = { ...state, status: 'missing', cached: 0, missing: expected, staleCachesRemoved: staleTotal };
  }

  const cache = await caches.open(currentName);
  const keys = await cache.keys();
  const cachedPaths = new Set(keys.map((request) => { const url = new URL(request.url); return url.pathname + url.search; }));
  const missing = expected.filter((path) => { const url = new URL(path, location.href); return !cachedPaths.has(url.pathname + url.search); });
  if (missing.length > 0) { localStorage.removeItem(markerKey); updateButtonForIncomplete(missing.length); }
  return state = { ...state, status: missing.length ? 'incomplete' : 'ready', cached: expected.length - missing.length, missing, staleCachesRemoved: staleTotal };
}

function validate(): Promise<IntegrityState> {
  if (validationPromise) return validationPromise;
  validationPromise = validateInternal().finally(() => { validationPromise = null; });
  return validationPromise;
}

function runValidation(): void {
  void validate().catch(() => { state = { ...state, status: 'missing', lastCheckAt: Date.now() }; });
}

function stopIntegrityTimer(): void {
  if (integrityTimer !== null) window.clearInterval(integrityTimer);
  integrityTimer = null;
}

export function startCacheIntegrity(): void {
  if ((window as any).__goneCacheIntegrityStarted) return;
  (window as any).__goneCacheIntegrityStarted = true;
  runValidation();
  document.getElementById('btn-performance-pack')?.addEventListener('click', () => {
    window.setTimeout(runValidation, 1500);
    window.setTimeout(runValidation, 8000);
  });
  browserLifecycle.subscribe('visible', 'cacheIntegrity', runValidation, 5);
  browserLifecycle.subscribe('beforeunload', 'cacheIntegrity', stopIntegrityTimer, 5);
  integrityTimer = window.setInterval(runValidation, 30_000);
  (window as any).goneCacheIntegrity = { check: validate, snapshot: () => ({ ...state, missing: [...state.missing] }) };
}

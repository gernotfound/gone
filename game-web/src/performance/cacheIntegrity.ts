import { browserLifecycle } from '../runtime/browserLifecycle.ts';
import {
  PERFORMANCE_CACHE_PREFIX,
  collectPerformancePackAssets,
  performanceCacheName,
  performancePackToken,
  performanceStorageKey,
} from './performancePackManifest.ts';

type IntegrityState = {
  status: 'checking' | 'ready' | 'not-preloaded' | 'missing' | 'incomplete' | 'unsupported';
  buildToken: string;
  expected: number;
  cached: number;
  missing: string[];
  staleCachesRemoved: number;
  lastCheckAt: number;
};

let state: IntegrityState = {
  status: 'checking',
  buildToken: performancePackToken(),
  expected: 0,
  cached: 0,
  missing: [],
  staleCachesRemoved: 0,
  lastCheckAt: 0,
};
let integrityTimer: number | null = null;
let validationPromise: Promise<IntegrityState> | null = null;

function performancePackRunning(): boolean {
  return (window as any).gonePerformancePack?.snapshot?.().status === 'running';
}

function updateButtonForIncomplete(missing: number): void {
  if (performancePackRunning()) return;
  const button = document.getElementById('btn-performance-pack') as HTMLButtonElement | null;
  const status = document.getElementById('performance-pack-status');
  if (!button || !status) return;
  button.disabled = false;
  button.textContent = 'AGGIORNA DATI PRECARICATI';
  status.textContent = `Cache incompleta: ${missing} asset da ripristinare. Puoi aggiornare senza ricaricare il sito.`;
  status.className = status.className.replace(/text-(?:emerald|slate)-\d+/g, 'text-amber-400');
}

async function removeStaleCaches(currentName: string): Promise<number> {
  const names = await caches.keys();
  let removed = 0;
  await Promise.all(names.map(async (name) => {
    if (name.startsWith(PERFORMANCE_CACHE_PREFIX) && name !== currentName && await caches.delete(name)) removed += 1;
  }));
  return removed;
}

async function validateInternal(): Promise<IntegrityState> {
  // Never inspect or delete the pack while a preload transaction is replacing it.
  if (performancePackRunning()) return state;

  const token = performancePackToken();
  const expected = collectPerformancePackAssets();
  const markerKey = performanceStorageKey();
  state = { ...state, status: 'checking', buildToken: token, expected: expected.length, lastCheckAt: Date.now() };

  if (!('caches' in window)) {
    return state = { ...state, status: 'unsupported', cached: 0, missing: [] };
  }

  const currentName = performanceCacheName();
  const staleTotal = state.staleCachesRemoved + await removeStaleCaches(currentName);

  if (!localStorage.getItem(markerKey)) {
    return state = { ...state, status: 'not-preloaded', cached: 0, missing: [], staleCachesRemoved: staleTotal };
  }

  if (!(await caches.has(currentName))) {
    localStorage.removeItem(markerKey);
    updateButtonForIncomplete(expected.length);
    return state = {
      ...state,
      status: 'missing',
      cached: 0,
      missing: expected,
      staleCachesRemoved: staleTotal,
    };
  }

  const cache = await caches.open(currentName);
  const keys = await cache.keys();
  const cachedPaths = new Set(keys.map((request) => {
    const url = new URL(request.url);
    return url.pathname + url.search;
  }));
  const missing = expected.filter((path) => {
    const url = new URL(path, location.href);
    return !cachedPaths.has(url.pathname + url.search);
  });

  if (missing.length > 0) {
    localStorage.removeItem(markerKey);
    updateButtonForIncomplete(missing.length);
  }

  return state = {
    ...state,
    status: missing.length ? 'incomplete' : 'ready',
    cached: expected.length - missing.length,
    missing,
    staleCachesRemoved: staleTotal,
  };
}

function validate(): Promise<IntegrityState> {
  if (validationPromise) return validationPromise;
  validationPromise = validateInternal().finally(() => {
    validationPromise = null;
  });
  return validationPromise;
}

function runValidation(): void {
  void validate().catch(() => {
    state = { ...state, status: 'missing', lastCheckAt: Date.now() };
  });
}

function stopIntegrityTimer(): void {
  if (integrityTimer !== null) window.clearInterval(integrityTimer);
  integrityTimer = null;
}

export function startCacheIntegrity(): void {
  if ((window as any).__goneCacheIntegrityStarted) return;
  (window as any).__goneCacheIntegrityStarted = true;

  runValidation();
  window.addEventListener('gone-performance-pack-complete', runValidation);
  window.addEventListener('gone-performance-pack-error', runValidation);
  browserLifecycle.subscribe('visible', 'cacheIntegrity', runValidation, 5);
  browserLifecycle.subscribe('beforeunload', 'cacheIntegrity', stopIntegrityTimer, 5);
  integrityTimer = window.setInterval(runValidation, 30_000);

  (window as any).goneCacheIntegrity = {
    check: validate,
    snapshot: () => ({ ...state, missing: [...state.missing] }),
  };
}

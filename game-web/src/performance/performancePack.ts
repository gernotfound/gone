import { loadAllWeapons, loadRobotModel } from '../models/index.ts';
import initGameCore from '../../pkg/game_core.js';
import { BUILD_ID } from '../generated/buildVersion.ts';
import {
  PERFORMANCE_CACHE_PREFIX,
  PERFORMANCE_STORAGE_PREFIX,
  collectPerformancePackAssets,
  performanceCacheName,
  performanceStorageKey,
  performancePackToken,
} from './performancePackManifest.ts';

type PackProgress = {
  type: 'progress' | 'complete';
  done: number;
  total: number;
  failed: number;
  bytes: number;
};

type PackStatus = 'idle' | 'running' | 'ready' | 'error';

type PackState = {
  status: PackStatus;
  token: string;
  done: number;
  total: number;
  failed: number;
  bytes: number;
  lastError: string | null;
};

type PackUi = {
  button: HTMLButtonElement;
  status: HTMLDivElement;
  bar: HTMLDivElement;
};

let preloadPromise: Promise<PackProgress> | null = null;
let uiRef: PackUi | null = null;
let state: PackState = {
  status: 'idle',
  token: performancePackToken(),
  done: 0,
  total: 0,
  failed: 0,
  bytes: 0,
  lastError: null,
};

function workerVersion(worker: ServiceWorker): string | null {
  try {
    return new URL(worker.scriptURL).searchParams.get('v');
  } catch {
    return null;
  }
}

async function waitForWorkerActivation(worker: ServiceWorker): Promise<ServiceWorker> {
  if (worker.state === 'activated') return worker;

  return new Promise((resolve, reject) => {
    const timeout = window.setTimeout(() => {
      worker.removeEventListener('statechange', onStateChange);
      reject(new Error('Timeout attivazione cache worker.'));
    }, 15_000);

    const onStateChange = () => {
      if (worker.state === 'activated') {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', onStateChange);
        resolve(worker);
      } else if (worker.state === 'redundant') {
        window.clearTimeout(timeout);
        worker.removeEventListener('statechange', onStateChange);
        reject(new Error('Cache worker diventato ridondante.'));
      }
    };

    worker.addEventListener('statechange', onStateChange);
    onStateChange();
  });
}

/**
 * The PWA runtime and performance pack deliberately register the exact same
 * build-id worker. The performance pack must never replace the PWA worker with
 * a second fingerprint/version namespace.
 */
async function getCacheWorker(): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return null;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return null;

  const workerUrl = `/gone-cache-sw.js?v=${encodeURIComponent(BUILD_ID)}`;
  const registration = await navigator.serviceWorker.register(workerUrl, {
    scope: '/',
    updateViaCache: 'none',
  });

  const matchesBuild = (worker: ServiceWorker | null): worker is ServiceWorker =>
    !!worker && workerVersion(worker) === BUILD_ID;

  let target = [registration.installing, registration.waiting, registration.active].find(matchesBuild) ?? null;
  if (!target) {
    await registration.update().catch(() => {});
    target = [registration.installing, registration.waiting, registration.active].find(matchesBuild) ?? null;
  }
  if (!target) return null;
  return waitForWorkerActivation(target);
}

async function preloadParsedModels(): Promise<void> {
  await Promise.allSettled([
    loadRobotModel('assets/modello.glb'),
    loadAllWeapons('assets'),
  ]);
}

async function warmGameCore(): Promise<void> {
  try {
    await initGameCore();
  } catch (error) {
    console.warn('[PerformancePack] WASM warmup unavailable, fallback remains usable:', error);
  }
}

async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort only; browser may refuse persistent storage silently.
  }
}

function cacheViaWorker(
  worker: ServiceWorker,
  urls: string[],
  onProgress: (progress: PackProgress) => void,
): Promise<PackProgress> {
  return new Promise((resolve, reject) => {
    const channel = new MessageChannel();
    const timeout = window.setTimeout(() => {
      channel.port1.close();
      reject(new Error('Timeout durante la precarica.'));
    }, 120_000);

    channel.port1.onmessage = (event: MessageEvent<PackProgress>) => {
      const message = event.data;
      if (!message || (message.type !== 'progress' && message.type !== 'complete')) return;
      onProgress(message);
      if (message.type === 'complete') {
        window.clearTimeout(timeout);
        channel.port1.close();
        resolve(message);
      }
    };

    worker.postMessage({
      type: 'CACHE_PERFORMANCE_PACK',
      urls,
      refresh: true,
      cacheName: performanceCacheName(),
    }, [channel.port2]);
  });
}

/** CacheStorage fallback used if the worker is temporarily unavailable. */
async function cacheWithoutWorker(
  urls: string[],
  onProgress: (progress: PackProgress) => void,
): Promise<PackProgress> {
  let done = 0;
  let failed = 0;
  let bytes = 0;
  const cacheName = performanceCacheName();
  let cache: Cache | null = null;

  if ('caches' in window) {
    await caches.delete(cacheName).catch(() => false);
    cache = await caches.open(cacheName);
  }

  for (const path of urls) {
    try {
      const request = new Request(new URL(path, location.href).href, {
        credentials: 'same-origin',
        cache: 'reload',
      });
      const response = await fetch(request);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const copy = response.clone();
      const body = await response.arrayBuffer();
      bytes += body.byteLength;
      if (cache) await cache.put(request, copy);
    } catch {
      failed += 1;
    }
    done += 1;
    onProgress({ type: 'progress', done, total: urls.length, failed, bytes });
  }

  return { type: 'complete', done, total: urls.length, failed, bytes };
}

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function setCachedUi(ui: PackUi): void {
  ui.button.textContent = 'AGGIORNA DATI PRECARICATI';
  ui.status.textContent = 'Dati della build pronti: modelli, core e musica sono disponibili localmente.';
  ui.status.className = ui.status.className.replace(/text-(?:slate|amber)-\d+/g, 'text-emerald-400');
}

function createUi(): PackUi | null {
  const menu = document.getElementById('main-menu');
  const settingsButton = document.getElementById('btn-settings');
  if (!menu || !settingsButton || document.getElementById('btn-performance-pack')) return null;

  const wrapper = document.createElement('div');
  wrapper.id = 'performance-pack-controls';
  wrapper.className = 'w-full flex flex-col gap-2';

  const button = document.createElement('button');
  button.id = 'btn-performance-pack';
  button.type = 'button';
  button.className = 'w-full bg-slate-800 border border-cyan-500/40 hover:bg-slate-700 hover:border-cyan-400 text-white font-bold text-base py-3 rounded-xl transition-all active:scale-95 shadow-md';
  button.textContent = 'PRECARICA DATI';

  const status = document.createElement('div');
  status.id = 'performance-pack-status';
  status.className = 'text-[11px] text-slate-400 font-mono text-center tracking-wide px-2';
  status.textContent = 'Prepara modelli, musica e core prima del PvP.';

  const track = document.createElement('div');
  track.className = 'w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-700/70 hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full bg-cyan-400 transition-[width] duration-150';
  bar.style.width = '0%';
  track.appendChild(bar);

  wrapper.append(button, status, track);
  settingsButton.insertAdjacentElement('afterend', wrapper);

  const ui = { button, status, bar };
  const marker = localStorage.getItem(performanceStorageKey());
  if (marker) setCachedUi(ui);

  if ('caches' in window) {
    void caches.has(performanceCacheName()).then((exists) => {
      if (!exists && localStorage.getItem(performanceStorageKey())) {
        localStorage.removeItem(performanceStorageKey());
        button.textContent = 'PRECARICA DATI';
        status.textContent = 'I dati locali non sono più presenti: puoi ricrearli senza ricaricare la pagina.';
        status.className = status.className.replace('text-emerald-400', 'text-slate-400');
      }
    }).catch(() => {});
  }

  return ui;
}

function removeOldPackState(): void {
  const currentStorageKey = performanceStorageKey();
  const staleMarkers: string[] = [];
  for (let i = 0; i < localStorage.length; i += 1) {
    const key = localStorage.key(i);
    if (key?.startsWith(PERFORMANCE_STORAGE_PREFIX) && key !== currentStorageKey) staleMarkers.push(key);
  }
  staleMarkers.forEach((key) => localStorage.removeItem(key));

  if ('caches' in window) {
    void caches.keys().then((names) => Promise.all(
      names
        .filter((name) => name.startsWith(PERFORMANCE_CACHE_PREFIX) && name !== performanceCacheName())
        .map((name) => caches.delete(name)),
    )).catch(() => {});
  }
}

function updateProgress(progress: PackProgress): void {
  state = {
    ...state,
    done: progress.done,
    total: progress.total,
    failed: progress.failed,
    bytes: progress.bytes,
  };
  const ui = uiRef;
  if (!ui) return;
  const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 78) : 0;
  ui.bar.style.width = `${Math.max(2, percent)}%`;
  ui.status.textContent = `Cache dati ${progress.done}/${progress.total}${progress.failed ? ` · ${progress.failed} non disponibili` : ''}`;
}

async function performPreload(): Promise<PackProgress> {
  const ui = uiRef;
  if (!ui) throw new Error('Interfaccia precaricamento non disponibile.');

  const track = ui.bar.parentElement as HTMLDivElement | null;
  ui.button.disabled = true;
  ui.button.textContent = 'PRECARICO...';
  ui.status.className = ui.status.className.replace(/text-(?:emerald|amber)-\d+/g, 'text-slate-300');
  ui.status.textContent = 'Preparazione cache locale...';
  track?.classList.remove('hidden');
  ui.bar.style.width = '2%';

  state = { status: 'running', token: performancePackToken(), done: 0, total: 0, failed: 0, bytes: 0, lastError: null };
  window.dispatchEvent(new CustomEvent('gone-performance-pack-started', { detail: { ...state } }));

  try {
    await requestPersistentStorage();
    const urls = collectPerformancePackAssets();
    state = { ...state, total: urls.length };
    const worker = await getCacheWorker().catch((error) => {
      console.warn('[PerformancePack] Worker temporarily unavailable, using direct CacheStorage:', error);
      return null;
    });

    const result = worker
      ? await cacheViaWorker(worker, urls, updateProgress)
      : await cacheWithoutWorker(urls, updateProgress);

    if (result.failed > 0) {
      throw new Error(`${result.failed} asset non disponibili durante la precarica.`);
    }

    ui.bar.style.width = '82%';
    ui.status.textContent = 'Inizializzo core e modelli 3D...';
    await Promise.all([warmGameCore(), preloadParsedModels()]);

    localStorage.setItem(performanceStorageKey(), JSON.stringify({
      at: Date.now(),
      buildId: BUILD_ID,
      token: performancePackToken(),
      assets: urls.length,
    }));
    removeOldPackState();

    ui.bar.style.width = '100%';
    ui.button.textContent = 'DATI PRECARICATI ✓';
    ui.status.className = ui.status.className.replace('text-slate-300', 'text-emerald-400');
    ui.status.textContent = result.bytes > 0
      ? `Pronto: circa ${formatMb(result.bytes)} inclusa la musica del menu.`
      : 'Pronto: modelli, musica e core sono preparati localmente.';

    state = { ...state, status: 'ready', done: result.done, total: result.total, failed: 0, bytes: result.bytes, lastError: null };
    window.dispatchEvent(new CustomEvent('gone-performance-pack-complete', { detail: { ...state } }));
    return result;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error('[PerformancePack] Preload failed:', error);
    localStorage.removeItem(performanceStorageKey());
    ui.button.textContent = 'RIPROVA PRECARICA';
    ui.status.className = ui.status.className.replace('text-slate-300', 'text-amber-400');
    ui.status.textContent = `Precarica incompleta: ${message} Puoi riprovare senza ricaricare il sito.`;
    ui.bar.style.width = '0%';
    state = { ...state, status: 'error', lastError: message };
    window.dispatchEvent(new CustomEvent('gone-performance-pack-error', { detail: { ...state } }));
    throw error;
  } finally {
    ui.button.disabled = false;
  }
}

export function preloadPerformancePack(): Promise<PackProgress> {
  if (preloadPromise) return preloadPromise;
  preloadPromise = performPreload().finally(() => {
    preloadPromise = null;
  });
  return preloadPromise;
}

export function startPerformancePack(): void {
  if ((window as any).__gonePerformancePackStarted) return;
  (window as any).__gonePerformancePackStarted = true;

  uiRef = createUi();
  if (!uiRef) return;
  removeOldPackState();

  uiRef.button.addEventListener('click', () => {
    void preloadPerformancePack().catch(() => {
      // The UI already exposes a retryable error state.
    });
  });

  (window as any).gonePerformancePack = {
    preload: preloadPerformancePack,
    snapshot: () => ({ ...state, inFlight: Boolean(preloadPromise) }),
    assets: () => collectPerformancePackAssets(),
    cacheName: performanceCacheName(),
  };
}

import { loadAllWeapons, loadRobotModel } from '../models/index.ts';
import initGameCore from '../../pkg/game_core.js';

const PACK_SCHEMA_VERSION = 2;
const STORAGE_PREFIX = 'gone-performance-pack:';
const CACHE_PREFIX = 'gone-performance-pack-';

const STATIC_ASSETS = [
  '/assets/modello.glb',
  '/assets/assalto.glb',
  '/assets/cecchino.glb',
  '/assets/pompa.glb',
  '/assets/mitraglietta.glb',
  '/assets/coltello.glb',
  '/favicon.svg',
  '/icons.svg',
  '/Colossus March.mp3',
] as const;

type PackProgress = {
  type: 'progress' | 'complete';
  done: number;
  total: number;
  failed: number;
  bytes: number;
};

type PackUi = {
  button: HTMLButtonElement;
  status: HTMLDivElement;
  bar: HTMLDivElement;
};

function fingerprint(text: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(36);
}

function currentBuildToken(): string {
  const candidates = new Set<string>();
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return;
      if (/\/(?:assets|pkg)\//.test(url.pathname) && /\.(?:js|css|wasm)$/i.test(url.pathname)) {
        candidates.add(url.pathname + url.search);
      }
    } catch {
      // Ignore malformed resource URLs.
    }
  };

  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => add(el.src));
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((el) => add(el.href));
  for (const entry of performance.getEntriesByType('resource')) add((entry as PerformanceResourceTiming).name);

  const signature = [...candidates].sort().join('|') || `${location.pathname}|runtime`;
  return `v${PACK_SCHEMA_VERSION}-${fingerprint(signature)}`;
}

function storageKey(buildToken: string): string {
  return `${STORAGE_PREFIX}${buildToken}`;
}

function cacheName(buildToken: string): string {
  return `${CACHE_PREFIX}${buildToken.replace(/[^a-zA-Z0-9._-]/g, '_').slice(0, 80)}`;
}

function workerVersion(worker: ServiceWorker): string | null {
  try {
    return new URL(worker.scriptURL).searchParams.get('v');
  } catch {
    return null;
  }
}

function collectCurrentBuildAssets(): string[] {
  const urls = new Set<string>(STATIC_ASSETS);
  const add = (raw: string | null | undefined) => {
    if (!raw) return;
    try {
      const url = new URL(raw, location.href);
      if (url.origin !== location.origin) return;
      const path = url.pathname;
      if (
        path.startsWith('/assets/') ||
        path.startsWith('/pkg/') ||
        /\.(?:js|css|wasm|glb|svg|mp3)$/i.test(path)
      ) {
        urls.add(url.pathname + url.search);
      }
    } catch {
      // Ignore malformed/non-URL performance entries.
    }
  };

  for (const entry of performance.getEntriesByType('resource')) add((entry as PerformanceResourceTiming).name);
  document.querySelectorAll<HTMLScriptElement>('script[src]').forEach((el) => add(el.src));
  document.querySelectorAll<HTMLLinkElement>('link[href]').forEach((el) => add(el.href));
  return [...urls];
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

async function registerCacheWorker(buildToken: string): Promise<ServiceWorker | null> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return null;

  const workerUrl = `/gone-cache-sw.js?v=${encodeURIComponent(buildToken)}`;
  const registration = await navigator.serviceWorker.register(workerUrl, { scope: '/' });

  const matchesVersion = (worker: ServiceWorker | null): worker is ServiceWorker =>
    !!worker && workerVersion(worker) === buildToken;

  let target = [registration.installing, registration.waiting, registration.active].find(matchesVersion) ?? null;

  if (!target) {
    await new Promise<void>((resolve) => {
      const timeout = window.setTimeout(resolve, 5_000);
      const onUpdateFound = () => {
        window.clearTimeout(timeout);
        resolve();
      };
      registration.addEventListener('updatefound', onUpdateFound, { once: true });
    });
    target = [registration.installing, registration.waiting, registration.active].find(matchesVersion) ?? null;
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

    worker.postMessage({ type: 'CACHE_PERFORMANCE_PACK', urls, refresh: true }, [channel.port2]);
  });
}

async function cacheWithoutWorker(
  urls: string[],
  onProgress: (progress: PackProgress) => void,
): Promise<PackProgress> {
  let done = 0;
  let failed = 0;
  let bytes = 0;

  for (const path of urls) {
    try {
      const response = await fetch(path, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const body = await response.arrayBuffer();
      bytes += body.byteLength;
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
  ui.status.textContent = 'Pacchetto della build corrente già presente. Puoi aggiornarlo quando vuoi.';
  ui.status.className = ui.status.className.replace(/text-(?:slate|amber)-\d+/g, 'text-emerald-400');
}

function createUi(buildToken: string): PackUi | null {
  const menu = document.getElementById('main-menu');
  const musicButton = document.getElementById('btn-music-toggle');
  if (!menu || !musicButton || document.getElementById('btn-performance-pack')) return null;

  const wrapper = document.createElement('div');
  wrapper.className = 'w-full flex flex-col gap-2';

  const button = document.createElement('button');
  button.id = 'btn-performance-pack';
  button.type = 'button';
  button.className = 'w-full bg-slate-800 border border-cyan-500/40 hover:bg-slate-700 hover:border-cyan-400 text-white font-bold text-base py-3 rounded-xl transition-all active:scale-95 shadow-md';
  button.textContent = 'PRECARICA DATI';

  const status = document.createElement('div');
  status.id = 'performance-pack-status';
  status.className = 'text-[11px] text-slate-400 font-mono text-center tracking-wide px-2';
  status.textContent = 'Prepara modelli, audio e core del gioco prima del PvP.';

  const track = document.createElement('div');
  track.className = 'w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-700/70 hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full bg-cyan-400 transition-[width] duration-150';
  bar.style.width = '0%';
  track.appendChild(bar);

  wrapper.append(button, status, track);
  musicButton.parentElement?.insertBefore(wrapper, musicButton);

  const ui = { button, status, bar };
  if (localStorage.getItem(storageKey(buildToken))) setCachedUi(ui);

  if ('caches' in window) {
    void caches.has(cacheName(buildToken)).then((exists) => {
      if (!exists && localStorage.getItem(storageKey(buildToken))) {
        localStorage.removeItem(storageKey(buildToken));
        button.textContent = 'PRECARICA DATI';
        status.textContent = 'La cache locale è stata rimossa dal browser: puoi ricrearla.';
        status.className = status.className.replace('text-emerald-400', 'text-slate-400');
      }
    }).catch(() => {});
  }

  return ui;
}

function removeOldPackMarkers(currentKey: string): void {
  const stale: string[] = [];
  for (let i = 0; i < localStorage.length; i++) {
    const key = localStorage.key(i);
    if (key?.startsWith(STORAGE_PREFIX) && key !== currentKey) stale.push(key);
  }
  stale.forEach((key) => localStorage.removeItem(key));
}

export function startPerformancePack(): void {
  if ((window as any).__gonePerformancePackStarted) return;
  (window as any).__gonePerformancePackStarted = true;

  const buildToken = currentBuildToken();
  const currentStorageKey = storageKey(buildToken);
  const ui = createUi(buildToken);
  if (!ui) return;

  ui.button.addEventListener('click', async () => {
    const track = ui.bar.parentElement as HTMLDivElement | null;
    ui.button.disabled = true;
    ui.button.textContent = 'PRECARICO...';
    ui.status.className = ui.status.className.replace('text-emerald-400', 'text-slate-300');
    ui.status.textContent = 'Preparazione cache locale...';
    track?.classList.remove('hidden');
    ui.bar.style.width = '2%';

    try {
      await requestPersistentStorage();
      const urls = collectCurrentBuildAssets();
      const worker = await registerCacheWorker(buildToken);

      const result = worker
        ? await cacheViaWorker(worker, urls, (progress) => {
            const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 78) : 0;
            ui.bar.style.width = `${Math.max(2, percent)}%`;
            ui.status.textContent = `Cache dati ${progress.done}/${progress.total}${progress.failed ? ` · ${progress.failed} non disponibili` : ''}`;
          })
        : await cacheWithoutWorker(urls, (progress) => {
            const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 78) : 0;
            ui.bar.style.width = `${Math.max(2, percent)}%`;
            ui.status.textContent = `Cache browser ${progress.done}/${progress.total}${progress.failed ? ` · ${progress.failed} non disponibili` : ''}`;
          });

      ui.bar.style.width = '82%';
      ui.status.textContent = 'Inizializzo core e modelli 3D...';
      await Promise.all([warmGameCore(), preloadParsedModels()]);

      ui.bar.style.width = '100%';
      localStorage.setItem(currentStorageKey, JSON.stringify({ at: Date.now(), buildToken }));
      removeOldPackMarkers(currentStorageKey);
      ui.button.textContent = 'DATI PRECARICATI ✓';
      ui.status.className = ui.status.className.replace('text-slate-300', 'text-emerald-400');
      ui.status.textContent = result.bytes > 0
        ? `Pronto: circa ${formatMb(result.bytes)} trasferiti prima della fase realtime.`
        : 'Pronto: asset, audio, modelli e core sono preparati localmente.';
    } catch (error) {
      console.error('[PerformancePack] Preload failed:', error);
      ui.button.textContent = 'RIPROVA PRECARICA';
      ui.status.className = ui.status.className.replace('text-slate-300', 'text-amber-400');
      ui.status.textContent = 'Precarica incompleta. Il gioco resta utilizzabile normalmente.';
      ui.bar.style.width = '0%';
    } finally {
      ui.button.disabled = false;
    }
  });
}

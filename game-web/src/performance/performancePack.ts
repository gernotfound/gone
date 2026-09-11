import { loadAllWeapons, loadRobotModel } from '../models/index.ts';

const PACK_VERSION = '2026-09-11-v1';
const STORAGE_KEY = `gone-performance-pack:${PACK_VERSION}`;
const WORKER_URL = `/gone-cache-sw.js?v=${encodeURIComponent(PACK_VERSION)}`;

const STATIC_ASSETS = [
  '/assets/modello.glb',
  '/assets/assalto.glb',
  '/assets/cecchino.glb',
  '/assets/pompa.glb',
  '/assets/mitraglietta.glb',
  '/assets/coltello.glb',
  '/favicon.svg',
  '/icons.svg',
] as const;

const AUDIO_ASSETS = ['/Colossus March.mp3'] as const;

type PackProgress = {
  type: 'progress' | 'complete';
  done: number;
  total: number;
  failed: number;
  bytes: number;
};

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
        /\.(?:js|css|wasm|glb|svg)$/i.test(path)
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

async function registerCacheWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator) || !('caches' in window)) return null;
  const registration = await navigator.serviceWorker.register(WORKER_URL, { scope: '/' });
  return navigator.serviceWorker.ready.then(() => registration);
}

async function warmAudioCache(): Promise<number> {
  let bytes = 0;
  for (const path of AUDIO_ASSETS) {
    try {
      const response = await fetch(path, { cache: 'force-cache', credentials: 'same-origin' });
      if (!response.ok) continue;
      const body = await response.arrayBuffer();
      bytes += body.byteLength;
    } catch {
      // Audio warming is optional; the game can still stream it normally.
    }
  }
  return bytes;
}

async function preloadParsedModels(): Promise<void> {
  await Promise.allSettled([
    loadRobotModel('assets/modello.glb'),
    loadAllWeapons('assets'),
  ]);
}

async function requestPersistentStorage(): Promise<void> {
  try {
    await navigator.storage?.persist?.();
  } catch {
    // Best effort only; browser may refuse persistent storage silently.
  }
}

function cacheViaWorker(
  registration: ServiceWorkerRegistration,
  urls: string[],
  onProgress: (progress: PackProgress) => void,
): Promise<PackProgress> {
  return new Promise((resolve, reject) => {
    const worker = registration.active ?? registration.waiting ?? registration.installing;
    if (!worker) {
      reject(new Error('Cache worker non disponibile.'));
      return;
    }

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

function formatMb(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(bytes >= 10 * 1024 * 1024 ? 0 : 1)} MB`;
}

function createUi(): {
  button: HTMLButtonElement;
  status: HTMLDivElement;
  bar: HTMLDivElement;
} | null {
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
  status.textContent = 'Scarica prima modelli e dati pesanti per alleggerire la partita.';

  const track = document.createElement('div');
  track.className = 'w-full h-1.5 bg-slate-950 rounded-full overflow-hidden border border-slate-700/70 hidden';
  const bar = document.createElement('div');
  bar.className = 'h-full bg-cyan-400 transition-[width] duration-150';
  bar.style.width = '0%';
  track.appendChild(bar);

  wrapper.append(button, status, track);
  musicButton.parentElement?.insertBefore(wrapper, musicButton);

  const saved = localStorage.getItem(STORAGE_KEY);
  if (saved) {
    button.textContent = 'AGGIORNA DATI PRECARICATI';
    status.textContent = 'Pacchetto locale già presente. Puoi aggiornarlo quando vuoi.';
    status.className = status.className.replace('text-slate-400', 'text-emerald-400');
  }

  return { button, status, bar };
}

export function startPerformancePack(): void {
  if ((window as any).__gonePerformancePackStarted) return;
  (window as any).__gonePerformancePackStarted = true;

  const ui = createUi();
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
      const registration = await registerCacheWorker();
      const urls = collectCurrentBuildAssets();
      let networkBytes = 0;

      if (registration) {
        const result = await cacheViaWorker(registration, urls, (progress) => {
          const percent = progress.total > 0 ? Math.round((progress.done / progress.total) * 82) : 0;
          ui.bar.style.width = `${Math.max(2, percent)}%`;
          ui.status.textContent = `Cache dati ${progress.done}/${progress.total}${progress.failed ? ` · ${progress.failed} non disponibili` : ''}`;
        });
        networkBytes += result.bytes;
      } else {
        ui.status.textContent = 'Cache persistente non supportata: preparo comunque questa sessione.';
      }

      ui.bar.style.width = '86%';
      ui.status.textContent = 'Precarico audio e modelli 3D...';
      networkBytes += await warmAudioCache();
      await preloadParsedModels();

      ui.bar.style.width = '100%';
      localStorage.setItem(STORAGE_KEY, JSON.stringify({ at: Date.now(), version: PACK_VERSION }));
      ui.button.textContent = 'DATI PRECARICATI ✓';
      ui.status.className = ui.status.className.replace('text-slate-300', 'text-emerald-400');
      ui.status.textContent = networkBytes > 0
        ? `Pronto: circa ${formatMb(networkBytes)} trasferiti fuori dalla fase realtime.`
        : 'Pronto: asset di gioco e modelli sono precaricati localmente.';
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

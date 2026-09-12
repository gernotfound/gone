type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

const PWA_WORKER_VERSION = 'pwa-v4';
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;

function isIosLike(): boolean {
  const ua = navigator.userAgent;
  const iOS = /iPad|iPhone|iPod/.test(ua);
  const iPadDesktopMode = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return iOS || iPadDesktopMode;
}

function isStandalone(): boolean {
  return window.matchMedia('(display-mode: standalone)').matches ||
    window.matchMedia('(display-mode: fullscreen)').matches ||
    Boolean((navigator as Navigator & { standalone?: boolean }).standalone);
}

function ensureMeta(name: string, content: string): void {
  let meta = document.querySelector<HTMLMetaElement>(`meta[name="${name}"]`);
  if (!meta) {
    meta = document.createElement('meta');
    meta.name = name;
    document.head.appendChild(meta);
  }
  meta.content = content;
}

function ensureLink(rel: string, href: string): void {
  let link = document.querySelector<HTMLLinkElement>(`link[rel="${rel}"]`);
  if (!link) {
    link = document.createElement('link');
    link.rel = rel;
    document.head.appendChild(link);
  }
  link.href = href;
}

function hardenHeadForMobile(): void {
  const viewport = document.querySelector<HTMLMetaElement>('meta[name="viewport"]');
  if (viewport) {
    viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
  } else {
    ensureMeta('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content');
  }
  ensureMeta('theme-color', '#020617');
  ensureMeta('application-name', 'G.O.N.E.');
  ensureMeta('mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-capable', 'yes');
  ensureMeta('apple-mobile-web-app-status-bar-style', 'black-translucent');
  ensureMeta('apple-mobile-web-app-title', 'G.O.N.E.');
  ensureMeta('format-detection', 'telephone=no');
  ensureLink('manifest', '/manifest.webmanifest');
  ensureLink('apple-touch-icon', '/apple-touch-icon.png');
}

function closeInstallHelp(): void {
  document.getElementById('gone-ios-install-help')?.remove();
}

function showIosInstallHelp(): void {
  if (document.getElementById('gone-ios-install-help')) return;
  const root = document.createElement('div');
  root.id = 'gone-ios-install-help';
  root.setAttribute('role', 'dialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-label', 'Installa G.O.N.E.');
  root.innerHTML = `
    <div class="gone-install-card">
      <div class="gone-install-eyebrow">INSTALLAZIONE iOS / iPadOS</div>
      <div class="gone-install-title">Aggiungi G.O.N.E. alla Home</div>
      <div class="gone-install-steps">
        <div><b>1.</b> Apri il menu <b>Condividi</b> del browser.</div>
        <div><b>2.</b> Tocca <b>Aggiungi alla schermata Home</b>.</div>
        <div><b>3.</b> Avvia G.O.N.E. dalla nuova icona per giocare a schermo intero.</div>
      </div>
      <button type="button" id="gone-install-help-close">HO CAPITO</button>
    </div>`;
  document.body.appendChild(root);
  document.getElementById('gone-install-help-close')?.addEventListener('click', closeInstallHelp, { once: true });
  root.addEventListener('click', (event) => {
    if (event.target === root) closeInstallHelp();
  });
}

function installButton(): HTMLButtonElement | null {
  const menu = document.getElementById('main-menu');
  const anchor = document.getElementById('btn-multiplayer');
  const parent = anchor?.parentElement;
  if (!menu || !anchor || !parent) return null;

  let button = document.getElementById('btn-install-pwa') as HTMLButtonElement | null;
  if (button) return button;

  button = document.createElement('button');
  button.type = 'button';
  button.id = 'btn-install-pwa';
  button.className = 'hidden w-full bg-cyan-950/90 border border-cyan-400/50 hover:bg-cyan-900 text-cyan-100 font-black text-base py-3 rounded-xl transition-all active:scale-95 shadow-md uppercase tracking-widest';
  button.textContent = 'INSTALLA APP';
  anchor.insertAdjacentElement('afterend', button);
  return button;
}

function updateInstallButton(): void {
  const button = installButton();
  if (!button) return;

  if (isStandalone()) {
    button.classList.add('hidden');
    return;
  }

  if (deferredInstallPrompt || isIosLike()) {
    button.classList.remove('hidden');
    button.textContent = isIosLike() ? 'INSTALLA SU HOME' : 'INSTALLA APP';
  } else {
    button.classList.add('hidden');
  }
}

function bindInstallUi(): void {
  const button = installButton();
  if (!button || button.dataset.bound === '1') return;
  button.dataset.bound = '1';

  button.addEventListener('click', async (event) => {
    event.stopPropagation();
    if (isStandalone()) return;

    if (deferredInstallPrompt) {
      const prompt = deferredInstallPrompt;
      deferredInstallPrompt = null;
      try {
        await prompt.prompt();
        await prompt.userChoice;
      } catch {
        // Browser install UI can be dismissed or unavailable without affecting gameplay.
      }
      updateInstallButton();
      return;
    }

    if (isIosLike()) showIosInstallHelp();
  });

  window.addEventListener('beforeinstallprompt', (event) => {
    event.preventDefault();
    deferredInstallPrompt = event as BeforeInstallPromptEvent;
    updateInstallButton();
  });

  window.addEventListener('appinstalled', () => {
    deferredInstallPrompt = null;
    closeInstallHelp();
    updateInstallButton();
  });

  window.matchMedia('(display-mode: standalone)').addEventListener?.('change', updateInstallButton);
  updateInstallButton();
}

async function registerPwaWorker(): Promise<void> {
  if (!('serviceWorker' in navigator)) return;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return;

  try {
    await navigator.serviceWorker.register(`/gone-cache-sw.js?v=${PWA_WORKER_VERSION}`, { scope: '/' });
  } catch (error) {
    console.warn('[PWA] Service worker registration unavailable:', error);
  }
}

function installGlobalPwaStyle(): void {
  if (document.getElementById('gone-pwa-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-pwa-style';
  style.textContent = `
    #gone-ios-install-help{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:rgba(2,6,23,.82);backdrop-filter:blur(14px);color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif}
    .gone-install-card{width:min(92vw,430px);padding:24px;border-radius:22px;border:1px solid rgba(34,211,238,.5);background:rgba(15,23,42,.98);box-shadow:0 20px 60px rgba(0,0,0,.45)}
    .gone-install-eyebrow{font-size:11px;font-weight:900;letter-spacing:.15em;color:#67e8f9;margin-bottom:8px}.gone-install-title{font-size:24px;font-weight:950;line-height:1.1;margin-bottom:18px}.gone-install-steps{display:grid;gap:12px;font-size:15px;line-height:1.45;color:#cbd5e1}.gone-install-steps b{color:#fff}.gone-install-card button{width:100%;min-height:48px;margin-top:22px;border:1px solid rgba(34,211,238,.55);border-radius:14px;background:#0e7490;color:white;font-weight:900;letter-spacing:.08em}
  `;
  document.head.appendChild(style);
}

export function startPwaRuntime(): void {
  if ((window as any).__gonePwaRuntimeStarted) return;
  (window as any).__gonePwaRuntimeStarted = true;

  hardenHeadForMobile();
  installGlobalPwaStyle();
  bindInstallUi();
  void registerPwaWorker();

  (window as any).gonePwa = {
    isStandalone,
    isIosLike,
    workerVersion: PWA_WORKER_VERSION,
    showInstallHelp: showIosInstallHelp,
  };
}

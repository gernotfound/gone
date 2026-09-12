import { BUILD_ID } from '../generated/buildVersion.ts';

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: 'accepted' | 'dismissed'; platform: string }>;
};

type VersionBeacon = { buildId?: string; generatedAt?: string };

const VERSION_URL = '/version.json';
const UPDATE_CHECK_MS = 45_000;
let deferredInstallPrompt: BeforeInstallPromptEvent | null = null;
let registration: ServiceWorkerRegistration | null = null;
let pendingBuildId: string | null = null;
let lastRequestedBuildId: string | null = null;
let updateTimer: number | null = null;
let reloading = false;

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

function elementVisible(id: string): boolean {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('hidden')) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function liveGameplayActive(): boolean {
  return elementVisible('game-ui') &&
    !elementVisible('main-menu') &&
    !elementVisible('settings-menu') &&
    !elementVisible('multiplayer-lobby');
}

function safeToReload(): boolean {
  return !liveGameplayActive() && document.visibilityState === 'visible' && navigator.onLine;
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
  if (viewport) viewport.content = 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content';
  else ensureMeta('viewport', 'width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content');
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
  } else button.classList.add('hidden');
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
      } catch { /* install UI is optional */ }
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

function updateNotice(): HTMLElement {
  let notice = document.getElementById('gone-update-notice');
  if (!notice) {
    notice = document.createElement('div');
    notice.id = 'gone-update-notice';
    notice.setAttribute('role', 'status');
    notice.innerHTML = '<strong>NUOVA VERSIONE PRONTA</strong><span>Si applica automaticamente appena torni al menu.</span>';
    document.body.appendChild(notice);
  }
  return notice;
}

function hideUpdateNotice(): void {
  document.getElementById('gone-update-notice')?.classList.remove('is-visible');
}

function showUpdateNotice(): void {
  updateNotice().classList.add('is-visible');
}

function reloadForUpdate(): void {
  if (reloading || !pendingBuildId || !safeToReload()) return;
  reloading = true;
  hideUpdateNotice();
  window.location.reload();
}

function maybeApplyPendingUpdate(): void {
  if (!pendingBuildId) return;
  if (safeToReload()) reloadForUpdate();
  else showUpdateNotice();
}

async function registerWorkerForBuild(buildId: string): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return null;
  if (location.protocol !== 'https:' && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') return null;
  const url = `/gone-cache-sw.js?v=${encodeURIComponent(buildId)}`;
  registration = await navigator.serviceWorker.register(url, { scope: '/', updateViaCache: 'none' });
  return registration;
}

async function registerPwaWorker(): Promise<void> {
  try {
    await registerWorkerForBuild(BUILD_ID);
  } catch (error) {
    console.warn('[PWA] Service worker registration unavailable:', error);
  }
}

async function fetchVersionBeacon(): Promise<VersionBeacon | null> {
  try {
    const response = await fetch(`${VERSION_URL}?t=${Date.now()}`, {
      cache: 'no-store',
      credentials: 'same-origin',
      headers: { 'cache-control': 'no-cache' },
    });
    if (!response.ok) return null;
    return await response.json() as VersionBeacon;
  } catch {
    return null;
  }
}

async function checkForDeploymentUpdate(): Promise<void> {
  if (!navigator.onLine) return;
  const beacon = await fetchVersionBeacon();
  const remoteBuildId = String(beacon?.buildId ?? '').trim();
  if (!remoteBuildId || remoteBuildId === BUILD_ID) return;

  pendingBuildId = remoteBuildId;
  if (lastRequestedBuildId !== remoteBuildId) {
    lastRequestedBuildId = remoteBuildId;
    try {
      await registerWorkerForBuild(remoteBuildId);
      await registration?.update();
    } catch (error) {
      console.warn('[PWA] Update worker could not be prepared:', error);
    }
  }
  maybeApplyPendingUpdate();
}

function bindAutoUpdate(): void {
  if (!('serviceWorker' in navigator)) return;
  navigator.serviceWorker.addEventListener('controllerchange', maybeApplyPendingUpdate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      void checkForDeploymentUpdate();
      maybeApplyPendingUpdate();
    }
  });
  window.addEventListener('online', () => { void checkForDeploymentUpdate(); });
  window.addEventListener('focus', () => { void checkForDeploymentUpdate(); }, { passive: true });
  updateTimer = window.setInterval(() => { void checkForDeploymentUpdate(); }, UPDATE_CHECK_MS);
  window.setInterval(maybeApplyPendingUpdate, 1000);
  window.addEventListener('beforeunload', () => {
    if (updateTimer !== null) window.clearInterval(updateTimer);
    updateTimer = null;
  }, { once: true });
  window.setTimeout(() => { void checkForDeploymentUpdate(); }, 1500);
}

function installGlobalPwaStyle(): void {
  if (document.getElementById('gone-pwa-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-pwa-style';
  style.textContent = `
    #gone-ios-install-help{position:fixed;inset:0;z-index:1000;display:flex;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:rgba(2,6,23,.82);backdrop-filter:blur(14px);color:#e2e8f0;font-family:ui-sans-serif,system-ui,sans-serif}
    .gone-install-card{width:min(92vw,430px);padding:24px;border-radius:22px;border:1px solid rgba(34,211,238,.5);background:rgba(15,23,42,.98);box-shadow:0 20px 60px rgba(0,0,0,.45)}
    .gone-install-eyebrow{font-size:11px;font-weight:900;letter-spacing:.15em;color:#67e8f9;margin-bottom:8px}.gone-install-title{font-size:24px;font-weight:950;line-height:1.1;margin-bottom:18px}.gone-install-steps{display:grid;gap:12px;font-size:15px;line-height:1.45;color:#cbd5e1}.gone-install-steps b{color:#fff}.gone-install-card button{width:100%;min-height:48px;margin-top:22px;border:1px solid rgba(34,211,238,.55);border-radius:14px;background:#0e7490;color:white;font-weight:900;letter-spacing:.08em}
    #gone-update-notice{position:fixed;left:50%;bottom:max(14px,calc(env(safe-area-inset-bottom) + 10px));z-index:1200;display:flex;flex-direction:column;gap:2px;max-width:min(90vw,430px);padding:9px 13px;border:1px solid rgba(34,211,238,.55);border-radius:12px;background:rgba(2,6,23,.92);color:#cbd5e1;font:600 11px/1.3 ui-sans-serif,system-ui,sans-serif;letter-spacing:.03em;opacity:0;pointer-events:none;transform:translate(-50%,12px);transition:.2s ease;box-shadow:0 12px 32px rgba(0,0,0,.3)}
    #gone-update-notice.is-visible{opacity:1;transform:translate(-50%,0)}#gone-update-notice strong{color:#67e8f9;font-size:12px;letter-spacing:.08em}
  `;
  document.head.appendChild(style);
}

export function startPwaRuntime(): void {
  if ((window as any).__gonePwaRuntimeStarted) return;
  (window as any).__gonePwaRuntimeStarted = true;
  hardenHeadForMobile();
  installGlobalPwaStyle();
  bindInstallUi();
  void registerPwaWorker().finally(bindAutoUpdate);
  (window as any).gonePwa = {
    buildId: BUILD_ID,
    isStandalone,
    isIosLike,
    checkForUpdate: checkForDeploymentUpdate,
    pendingBuild: () => pendingBuildId,
    showInstallHelp: showIosInstallHelp,
  };
}

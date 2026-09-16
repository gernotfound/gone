import type { CombatHitEventDetail } from '../net/combatEventBridge.ts';

const STYLE_ID = 'gone-mobile-adaptive-presentation-style';
type AmmoReadabilityState = 'melee' | 'ready' | 'low' | 'empty' | 'dry' | 'reloading';

let hapticCount = 0;
let ammoStateUpdates = 0;
let lastAmmoState: AmmoReadabilityState = 'ready';
let ammoObserver: MutationObserver | null = null;
let ammoMountObserver: MutationObserver | null = null;

function gameplayVisible(): boolean {
  const gameUi = document.getElementById('game-ui');
  return Boolean(gameUi && !gameUi.classList.contains('hidden'));
}

function localPlayerSlot(): number | null {
  const api = (window as any).goneGame;
  if (api?.getP2PHost?.()) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : null;
}

function ensureStyle(): void {
  if (document.getElementById(STYLE_ID)) return;
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
html.gone-smartphone #gone-kill-feed {
  display: none !important;
  top: max(110px, calc(env(safe-area-inset-top) + 104px)) !important;
  right: max(8px, calc(env(safe-area-inset-right) + 6px)) !important;
  max-width: min(46dvw, 220px) !important;
  gap: 3px !important;
  align-items: flex-end !important;
  font-size: 8px !important;
  opacity: .92 !important;
}
html.gone-smartphone #gone-kill-feed:has(> .gone-kill-row) {
  display: flex !important;
}
html.gone-smartphone #gone-kill-feed > .gone-kill-row {
  max-width: 100% !important;
  overflow: hidden !important;
  padding: 3px 6px !important;
  border-radius: 5px !important;
  white-space: nowrap !important;
  text-overflow: ellipsis !important;
  backdrop-filter: blur(4px) !important;
}
html.gone-smartphone #gone-kill-feed > .gone-kill-row:nth-child(n+4) {
  display: none !important;
}

html.gone-smartphone #advanced-weapon-hud[data-gone-ammo-state="low"] > div:first-child {
  color: #fbbf24 !important;
  text-shadow: 0 0 10px rgba(251,191,36,.42) !important;
}
html.gone-smartphone #advanced-weapon-hud[data-gone-ammo-state="empty"] > div:first-child,
html.gone-smartphone #advanced-weapon-hud[data-gone-ammo-state="dry"] > div:first-child {
  color: #fb7185 !important;
  text-shadow: 0 0 11px rgba(251,113,133,.46) !important;
}
html.gone-smartphone #advanced-weapon-hud[data-gone-ammo-state="reloading"] > div:first-child {
  color: #fde68a !important;
}
html.gone-smartphone #mc-reload[data-gone-ammo-state="low"] {
  border-color: rgba(251,191,36,.82) !important;
  background: rgba(161,98,7,.42) !important;
  box-shadow: 0 0 0 2px rgba(251,191,36,.10), 0 4px 14px rgba(0,0,0,.20) !important;
}
html.gone-smartphone #mc-reload[data-gone-ammo-state="empty"] {
  border-color: rgba(251,146,60,.94) !important;
  background: rgba(154,52,18,.52) !important;
  box-shadow: 0 0 0 2px rgba(251,146,60,.16), 0 0 14px rgba(251,146,60,.18) !important;
}
html.gone-smartphone #mc-reload[data-gone-ammo-state="dry"] {
  border-color: rgba(251,113,133,.72) !important;
  background: rgba(127,29,29,.34) !important;
  opacity: .68 !important;
}
html.gone-smartphone #mc-reload[data-gone-ammo-state="reloading"] {
  border-color: rgba(253,230,138,.92) !important;
  background: rgba(133,77,14,.48) !important;
  box-shadow: 0 0 0 2px rgba(253,230,138,.12), 0 0 14px rgba(251,191,36,.20) !important;
}
html.gone-smartphone #mc-reload[data-gone-ammo-state="melee"] {
  opacity: .52 !important;
}

@media (orientation: portrait) and (max-width: 760px) {
  html.gone-smartphone #gone-mobile-controls {
    opacity: .12 !important;
    filter: saturate(.55) !important;
    pointer-events: none !important;
  }
  html.gone-smartphone #gone-mobile-controls * {
    pointer-events: none !important;
  }
  html.gone-smartphone #gone-rotate-phone.is-active {
    display: flex !important;
    position: fixed !important;
    inset: 0 !important;
    left: 0 !important;
    top: 0 !important;
    width: 100dvw !important;
    height: 100dvh !important;
    max-width: none !important;
    box-sizing: border-box !important;
    transform: none !important;
    align-items: center !important;
    justify-content: center !important;
    padding: max(28px, env(safe-area-inset-top)) max(24px, env(safe-area-inset-right)) max(28px, env(safe-area-inset-bottom)) max(24px, env(safe-area-inset-left)) !important;
    border: 0 !important;
    border-radius: 0 !important;
    background: radial-gradient(circle at center, rgba(15,23,42,.84), rgba(2,6,23,.96)) !important;
    color: #e2e8f0 !important;
    text-align: center !important;
    font-size: clamp(13px, 3.4vw, 17px) !important;
    letter-spacing: .09em !important;
    text-transform: uppercase !important;
    text-shadow: 0 0 18px rgba(103,232,249,.28) !important;
    pointer-events: auto !important;
  }
}
`;
  document.head.appendChild(style);
}

function syncRotateSemantics(): void {
  const rotate = document.getElementById('gone-rotate-phone');
  if (!rotate) return;
  rotate.setAttribute('role', 'status');
  rotate.setAttribute('aria-live', 'polite');
  rotate.setAttribute('aria-atomic', 'true');
  rotate.textContent = 'RUOTA IL TELEFONO · GIOCA IN ORIZZONTALE';
}

function pulseConfirmedHit(detail: CombatHitEventDetail): void {
  const hit = detail.hit;
  if (!document.documentElement.classList.contains('gone-smartphone')) return;
  if (!gameplayVisible() || localPlayerSlot() !== hit.shooterSlot) return;
  if (typeof navigator.vibrate !== 'function') return;

  const duration = hit.isFatalKill || hit.isFatal ? 14 : hit.isHeadshot ? 10 : hit.isShieldBlocked ? 4 : 6;
  try {
    const accepted = navigator.vibrate(duration);
    if (accepted !== false) hapticCount += 1;
  } catch {
    // Haptics are optional and must never affect combat presentation.
  }
}

function resolveAmmoReadabilityState(): AmmoReadabilityState {
  const game = (window as any).goneGame;
  const weapons = (window as any).goneWeapons;
  const key = String(game?.getActiveWeapon?.() ?? '');
  const cfg = weapons?.config?.[key];
  const state = weapons?.ammo?.[key];
  if (!cfg || !state) return 'ready';
  if (cfg.reloadStyle === 'none') return 'melee';
  if (weapons?.isReloading?.()) return 'reloading';

  const magazine = Math.max(0, Number(state.magazine) || 0);
  const reserve = Math.max(0, Number(state.reserve) || 0);
  if (magazine <= 0) return reserve > 0 ? 'empty' : 'dry';

  const magazineSize = Math.max(1, Number(cfg.magazineSize) || magazine);
  const lowThreshold = Math.max(2, Math.ceil(magazineSize * 0.25));
  return magazine <= lowThreshold ? 'low' : 'ready';
}

function ammoAriaLabel(state: AmmoReadabilityState): string {
  if (state === 'reloading') return 'Ricarica in corso';
  if (state === 'empty') return 'Caricatore vuoto, ricarica';
  if (state === 'dry') return 'Munizioni esaurite';
  if (state === 'low') return 'Munizioni basse, ricarica';
  if (state === 'melee') return 'Ricarica non disponibile per arma da mischia';
  return 'Ricarica';
}

function syncAmmoReadability(): void {
  if (!document.documentElement.classList.contains('gone-smartphone')) return;
  const hud = document.getElementById('advanced-weapon-hud');
  const reload = document.getElementById('mc-reload');
  if (!hud || !reload) return;

  const state = resolveAmmoReadabilityState();
  hud.dataset.goneAmmoState = state;
  reload.dataset.goneAmmoState = state;
  reload.setAttribute('aria-label', ammoAriaLabel(state));
  reload.setAttribute('aria-busy', state === 'reloading' ? 'true' : 'false');
  if (state !== lastAmmoState) {
    lastAmmoState = state;
    ammoStateUpdates += 1;
  }
}

function bindAmmoReadability(): boolean {
  const hud = document.getElementById('advanced-weapon-hud');
  if (!hud) return false;
  ammoObserver?.disconnect();
  ammoObserver = new MutationObserver(syncAmmoReadability);
  ammoObserver.observe(hud, { childList: true, subtree: true, characterData: true });
  syncAmmoReadability();
  return true;
}

function startAmmoReadability(): void {
  if (bindAmmoReadability()) return;
  ammoMountObserver?.disconnect();
  ammoMountObserver = new MutationObserver(() => {
    if (!bindAmmoReadability()) return;
    ammoMountObserver?.disconnect();
    ammoMountObserver = null;
  });
  if (document.body) ammoMountObserver.observe(document.body, { childList: true, subtree: true });
}

function snapshot() {
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const rotate = document.getElementById('gone-rotate-phone');
  const fire = document.getElementById('mc-fire');
  const feed = document.getElementById('gone-kill-feed');
  const reload = document.getElementById('mc-reload');
  return {
    portrait,
    rotateVisible: Boolean(rotate && getComputedStyle(rotate).display !== 'none'),
    firePointerEvents: fire ? getComputedStyle(fire).pointerEvents : 'missing',
    killFeedVisible: Boolean(feed && getComputedStyle(feed).display !== 'none'),
    hapticCount,
    ammoState: lastAmmoState,
    ammoStateUpdates,
    reloadAriaLabel: reload?.getAttribute('aria-label') ?? '',
  };
}

export function startMobileAdaptivePresentation(): void {
  if ((window as any).__goneMobileAdaptivePresentationStarted) return;
  (window as any).__goneMobileAdaptivePresentationStarted = true;

  ensureStyle();
  syncRotateSemantics();
  startAmmoReadability();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
      syncRotateSemantics();
      startAmmoReadability();
    }, { once: true });
  }

  window.addEventListener('gone-hit-confirmed', ((event: CustomEvent<CombatHitEventDetail>) => {
    pulseConfirmedHit(event.detail);
  }) as EventListener);

  (window as any).goneMobileAdaptivePresentation = { snapshot, syncAmmoReadability };
}

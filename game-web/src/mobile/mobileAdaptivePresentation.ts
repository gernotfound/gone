import type { CombatHitEventDetail } from '../net/combatEventBridge.ts';

const STYLE_ID = 'gone-mobile-adaptive-presentation-style';
let hapticCount = 0;

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

function snapshot() {
  const portrait = window.matchMedia('(orientation: portrait)').matches;
  const rotate = document.getElementById('gone-rotate-phone');
  const fire = document.getElementById('mc-fire');
  const feed = document.getElementById('gone-kill-feed');
  return {
    portrait,
    rotateVisible: Boolean(rotate && getComputedStyle(rotate).display !== 'none'),
    firePointerEvents: fire ? getComputedStyle(fire).pointerEvents : 'missing',
    killFeedVisible: Boolean(feed && getComputedStyle(feed).display !== 'none'),
    hapticCount,
  };
}

export function startMobileAdaptivePresentation(): void {
  if ((window as any).__goneMobileAdaptivePresentationStarted) return;
  (window as any).__goneMobileAdaptivePresentationStarted = true;

  ensureStyle();
  syncRotateSemantics();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', syncRotateSemantics, { once: true });
  }

  window.addEventListener('gone-hit-confirmed', ((event: CustomEvent<CombatHitEventDetail>) => {
    pulseConfirmedHit(event.detail);
  }) as EventListener);

  (window as any).goneMobileAdaptivePresentation = { snapshot };
}

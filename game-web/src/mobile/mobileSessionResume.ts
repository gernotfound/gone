import { resetInputState } from '../controls/playerInput.ts';
import { browserLifecycle } from '../runtime/browserLifecycle.ts';
import { useOnScreenControls } from './inputMode.ts';
import { isSmartphoneDevice } from './smartphoneProfile.ts';

type ResumeState = {
  repairs: number;
  resumes: number;
  reconnectRequests: number;
  lastReason: string;
  online: boolean;
  visibility: DocumentVisibilityState;
};

let repairs = 0;
let resumes = 0;
let reconnectRequests = 0;
let lastReason = 'startup';
let timer: number | null = null;

function enabled(): boolean {
  return isSmartphoneDevice() || useOnScreenControls();
}

function game(): any {
  return (window as any).goneGame;
}

function syncTouchUi(): void {
  (window as any).goneMobileControls?.sync?.();
}

function ensureStatusChip(): HTMLElement {
  let chip = document.getElementById('gone-mobile-resume-status');
  if (chip) return chip;
  chip = document.createElement('div');
  chip.id = 'gone-mobile-resume-status';
  chip.setAttribute('role', 'status');
  chip.style.cssText = [
    'position:fixed',
    'left:50%',
    'top:max(8px,calc(env(safe-area-inset-top) + 6px))',
    'z-index:1250',
    'transform:translate(-50%,-10px)',
    'padding:7px 11px',
    'border:1px solid rgba(251,191,36,.55)',
    'border-radius:999px',
    'background:rgba(2,6,23,.92)',
    'color:#fde68a',
    'font:800 10px/1.2 ui-sans-serif,system-ui,sans-serif',
    'letter-spacing:.08em',
    'opacity:0',
    'pointer-events:none',
    'transition:.18s ease',
  ].join(';');
  document.body.appendChild(chip);
  return chip;
}

function showStatus(message: string): void {
  if (!enabled()) return;
  const chip = ensureStatusChip();
  chip.textContent = message;
  chip.style.opacity = '1';
  chip.style.transform = 'translate(-50%,0)';
}

function hideStatus(): void {
  const chip = document.getElementById('gone-mobile-resume-status');
  if (!chip) return;
  chip.style.opacity = '0';
  chip.style.transform = 'translate(-50%,-10px)';
}

function suspendTransientState(reason: string): void {
  if (!enabled()) return;
  lastReason = reason;
  resetInputState();
  const client = game()?.getP2PClient?.();
  client?.stopStateTick?.();
  syncTouchUi();
  if (!navigator.onLine) showStatus('RETE ASSENTE · RIPRESA AUTOMATICA');
}

function repairClient(client: any): void {
  if (!client || client.status !== 'connected') return;
  const api = game();
  if (typeof client.config?.onWorldSnapshot !== 'function' && typeof api?.bindP2PClientNetworking === 'function') {
    api.bindP2PClientNetworking(client);
    repairs += 1;
  }
  client.startStateTick?.(30);
  client.sendCurrentState?.();
}

function repairHost(host: any): void {
  if (!host || typeof host.startSnapshotTick !== 'function') return;
  const adaptiveRate = Number((window as any).goneNetworkQuality?.snapshot?.().rateHz ?? 30);
  host.startSnapshotTick(Number.isFinite(adaptiveRate) ? adaptiveRate : 30);
}

function resumeSession(reason: string): void {
  if (!enabled() || document.visibilityState !== 'visible') return;
  lastReason = reason;
  syncTouchUi();
  if (!navigator.onLine) {
    showStatus('RETE ASSENTE · RIPRESA AUTOMATICA');
    return;
  }

  const api = game();
  const client = api?.getP2PClient?.();
  const host = api?.getP2PHost?.();
  if (client?.status === 'connected') {
    repairClient(client);
    hideStatus();
  } else if (client && client.status === 'disconnected') {
    reconnectRequests += 1;
    showStatus('SESSIONE DISCONNESSA · RICONNESSIONE RICHIESTA');
    window.dispatchEvent(new CustomEvent('gone-reconnect-requested', { detail: { reason } }));
  } else {
    hideStatus();
  }
  repairHost(host);
  resumes += 1;
  window.dispatchEvent(new CustomEvent('gone-mobile-session-resumed', {
    detail: { reason, clientStatus: String(client?.status ?? 'none'), host: Boolean(host) },
  }));
}

function scheduleResume(reason: string, delay = 220): void {
  if (!enabled()) return;
  if (timer !== null) window.clearTimeout(timer);
  timer = window.setTimeout(() => {
    timer = null;
    resumeSession(reason);
  }, delay);
}

function snapshot(): ResumeState {
  return {
    repairs,
    resumes,
    reconnectRequests,
    lastReason,
    online: navigator.onLine,
    visibility: document.visibilityState,
  };
}

export function startMobileSessionResume(): void {
  if ((window as any).__goneMobileSessionResumeStarted) return;
  (window as any).__goneMobileSessionResumeStarted = true;

  // Input release is delivered by playerInput at a higher lifecycle priority.
  // Session suspension/resume therefore sees a deterministic, already-safe
  // control state on every browser instead of racing native event listeners.
  browserLifecycle.subscribe('visible', 'mobileSessionResume', () => scheduleResume('visibility'), 60);
  browserLifecycle.subscribe('hidden', 'mobileSessionResume', () => suspendTransientState('hidden'), 60);
  browserLifecycle.subscribe('pageshow', 'mobileSessionResume', () => scheduleResume('pageshow', 120), 60);
  browserLifecycle.subscribe('focus', 'mobileSessionResume', () => scheduleResume('focus'), 50);
  browserLifecycle.subscribe('online', 'mobileSessionResume', () => {
    showStatus('RETE RIPRISTINATA · SINCRONIZZAZIONE');
    scheduleResume('online', 300);
  }, 60);
  browserLifecycle.subscribe('offline', 'mobileSessionResume', () => suspendTransientState('offline'), 80);

  window.addEventListener('gone-session-changed', () => scheduleResume('session-change', 80));
  window.addEventListener('gone-input-mode-changed', () => scheduleResume('input-mode', 80));

  scheduleResume('startup', 500);
  (window as any).goneMobileResume = { snapshot, resume: () => resumeSession('manual') };
}

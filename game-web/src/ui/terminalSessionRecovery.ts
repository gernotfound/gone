import { multiplayerSessionController } from '../net/multiplayerSessionController.ts';

let started = false;
let recoveryOverlay: HTMLDivElement | null = null;

function clearStaleDirectInvite(): void {
  const rawHash = window.location.hash.replace(/^#/, '');
  if (!rawHash) return;
  const params = new URLSearchParams(rawHash);
  if (!params.has('direct')) return;
  params.delete('direct');

  const url = new URL(window.location.href);
  const nextHash = params.toString();
  url.hash = nextHash ? `#${nextHash}` : '';
  window.history.replaceState({}, document.title, url.toString());
}

function removeRecoveryOverlay(): void {
  recoveryOverlay?.remove();
  recoveryOverlay = null;
}

function returnToCleanMenu(): void {
  multiplayerSessionController.reset();
  clearStaleDirectInvite();
  removeRecoveryOverlay();
  window.location.reload();
}

function ensureRecoveryOverlay(): HTMLDivElement {
  if (recoveryOverlay) return recoveryOverlay;

  const overlay = document.createElement('div');
  overlay.id = 'gone-terminal-session-recovery';
  overlay.setAttribute('role', 'alertdialog');
  overlay.setAttribute('aria-modal', 'true');
  overlay.setAttribute('aria-labelledby', 'gone-terminal-session-recovery-title');
  overlay.style.cssText = [
    'position:fixed',
    'inset:0',
    'z-index:1500',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'padding:max(18px,env(safe-area-inset-top)) max(18px,env(safe-area-inset-right)) max(18px,env(safe-area-inset-bottom)) max(18px,env(safe-area-inset-left))',
    'background:rgba(2,6,23,.86)',
    'backdrop-filter:blur(8px)',
    'pointer-events:auto',
  ].join(';');

  const card = document.createElement('div');
  card.style.cssText = [
    'width:min(430px,100%)',
    'padding:20px',
    'border:1px solid rgba(251,113,133,.65)',
    'border-radius:18px',
    'background:rgba(15,23,42,.97)',
    'box-shadow:0 0 34px rgba(244,63,94,.24)',
    'color:#e2e8f0',
    'font-family:ui-sans-serif,system-ui,sans-serif',
  ].join(';');

  const title = document.createElement('div');
  title.id = 'gone-terminal-session-recovery-title';
  title.textContent = 'CONNESSIONE DIRETTA TERMINATA';
  title.style.cssText = 'color:#fda4af;font-weight:900;font-size:18px;letter-spacing:.06em;margin-bottom:10px';

  const body = document.createElement('p');
  body.textContent = 'Questa sessione WebRTC non può essere riaperta automaticamente. Per continuare serve un nuovo invito generato dall’host.';
  body.style.cssText = 'margin:0 0 16px;line-height:1.5;color:#cbd5e1;font-size:14px';

  const hint = document.createElement('p');
  hint.textContent = 'Torna al menu, poi apri il nuovo link che riceverai dall’host.';
  hint.style.cssText = 'margin:0 0 18px;line-height:1.4;color:#67e8f9;font-size:12px;font-weight:800';

  const button = document.createElement('button');
  button.id = 'gone-terminal-session-recovery-exit';
  button.type = 'button';
  button.textContent = 'TORNA AL MENU';
  button.style.cssText = [
    'width:100%',
    'min-height:48px',
    'border:1px solid rgba(34,211,238,.65)',
    'border-radius:12px',
    'background:#0e7490',
    'color:white',
    'font-weight:900',
    'letter-spacing:.08em',
    'cursor:pointer',
    'touch-action:manipulation',
  ].join(';');
  button.addEventListener('click', returnToCleanMenu);

  card.append(title, body, hint, button);
  overlay.appendChild(card);
  document.body.appendChild(overlay);
  recoveryOverlay = overlay;
  return overlay;
}

function showRecoveryOverlay(): void {
  const snapshot = multiplayerSessionController.snapshot();
  if (snapshot.role !== 'client') return;
  ensureRecoveryOverlay();
}

export function startTerminalSessionRecovery(): void {
  if (started) return;
  started = true;
  window.addEventListener('gone-reconnect-requested', showRecoveryOverlay);
  window.addEventListener('gone-session-changed', () => {
    const snapshot = multiplayerSessionController.snapshot();
    if (snapshot.role !== 'client') removeRecoveryOverlay();
  });
}

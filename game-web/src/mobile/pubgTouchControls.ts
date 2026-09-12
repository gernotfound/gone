import './pubgTouchControls.css';
import { inputState } from '../controls/playerInput.ts';
import { getTouchPreferences } from './touchPreferences.ts';

type FireDragSnapshot = {
  enabled: boolean;
  attached: boolean;
  pointerActive: boolean;
  fireActive: boolean;
  yaw: number;
  pitch: number;
};

let activePointerId: number | null = null;
let lastX = 0;
let lastY = 0;
let attachedButton: HTMLButtonElement | null = null;
let observer: MutationObserver | null = null;

function applyLookDelta(dx: number, dy: number): void {
  const preferences = getTouchPreferences();
  const sensitivity = inputState.aim
    ? 0.0030 * preferences.adsSensitivity
    : 0.0042 * preferences.lookSensitivity;

  inputState.yaw -= dx * sensitivity;
  inputState.pitch -= dy * sensitivity;
  inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
  inputState.timestamp = performance.now();
}

function releaseDrag(button: HTMLButtonElement): void {
  activePointerId = null;
  button.classList.remove('is-fire-aiming', 'is-fire-dragging');
  button.closest('#gone-mobile-controls')?.classList.remove('pubg-fire-aim-active');
}

function bindPrimaryFireDrag(button: HTMLButtonElement): void {
  if (button.dataset.gonePubgFireDrag === '1') return;
  button.dataset.gonePubgFireDrag = '1';
  attachedButton = button;

  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0 && event.pointerType !== 'touch') return;
    activePointerId = event.pointerId;
    lastX = event.clientX;
    lastY = event.clientY;
    button.classList.add('is-fire-aiming');
    button.closest('#gone-mobile-controls')?.classList.add('pubg-fire-aim-active');
    try { button.setPointerCapture?.(event.pointerId); } catch { /* synthetic/legacy pointer */ }
  });

  button.addEventListener('pointermove', (event) => {
    if (activePointerId !== event.pointerId) return;
    event.preventDefault();
    const dx = event.clientX - lastX;
    const dy = event.clientY - lastY;
    lastX = event.clientX;
    lastY = event.clientY;
    if (Math.abs(dx) + Math.abs(dy) < 0.01) return;
    button.classList.add('is-fire-dragging');
    applyLookDelta(dx, dy);
  });

  const finish = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    releaseDrag(button);
  };
  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', finish);
  button.addEventListener('lostpointercapture', finish);
}

function attachWhenAvailable(): boolean {
  const button = document.getElementById('mc-fire') as HTMLButtonElement | null;
  if (!button) return false;
  bindPrimaryFireDrag(button);
  return true;
}

function snapshot(): FireDragSnapshot {
  return {
    enabled: true,
    attached: Boolean(attachedButton?.isConnected),
    pointerActive: activePointerId !== null,
    fireActive: inputState.fire,
    yaw: inputState.yaw,
    pitch: inputState.pitch,
  };
}

export function startPubgTouchControls(): void {
  if ((window as any).__gonePubgTouchControlsStarted) {
    attachWhenAvailable();
    return;
  }
  (window as any).__gonePubgTouchControlsStarted = true;

  attachWhenAvailable();
  observer = new MutationObserver(() => { attachWhenAvailable(); });
  observer.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('gone-input-mode-changed', () => {
    window.setTimeout(attachWhenAvailable, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible' && attachedButton) releaseDrag(attachedButton);
  });

  (window as any).gonePubgTouchControls = {
    enabled: true,
    snapshot,
    rebind: attachWhenAvailable,
  };
}

import './pubgTouchControls.css';
import { inputState } from '../controls/playerInput.ts';
import { getTouchPreferences } from './touchPreferences.ts';

type FireDragSnapshot = {
  enabled: boolean;
  attached: boolean;
  pointerActive: boolean;
  fireActive: boolean;
  secondaryFire: boolean;
  gyro: 'unknown' | 'granted' | 'denied' | 'unsupported';
  yaw: number;
  pitch: number;
};

type DragState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
  startedAt: number;
  dragging: boolean;
};

const primaryDrag: DragState = {
  pointerId: null,
  startX: 0,
  startY: 0,
  lastX: 0,
  lastY: 0,
  startedAt: 0,
  dragging: false,
};
const adsDrag: DragState = { ...primaryDrag };
const fireSources = new Set<number>();
let attachedButton: HTMLButtonElement | null = null;
let gyroPermission: FireDragSnapshot['gyro'] = 'unknown';
let gyroLastBeta: number | null = null;
let gyroLastGamma: number | null = null;

function gameplayActive(): boolean {
  if (document.documentElement.classList.contains('gone-touch-layout-edit')) return false;
  const snapshot = (window as any).goneMobileControls?.snapshot?.();
  if (snapshot && typeof snapshot.gameplayActive === 'boolean') return snapshot.gameplayActive && !snapshot.mapOpen;
  const gameUi = document.getElementById('game-ui');
  const map = document.getElementById('map-ui');
  return Boolean(gameUi && !gameUi.classList.contains('hidden') && (!map || map.classList.contains('hidden')));
}

function dispatchMouse(button: number, down: boolean): void {
  window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', {
    bubbles: true,
    cancelable: true,
    button,
    buttons: down ? (button === 0 ? 1 : 2) : 0,
    view: window,
  }));
}

function dispatchKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, cancelable: true, code }));
  window.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, cancelable: true, code }));
}

function beginFire(sourceId: number): void {
  const wasIdle = fireSources.size === 0;
  fireSources.add(sourceId);
  if (wasIdle) dispatchMouse(0, true);
}

function endFire(sourceId: number): void {
  fireSources.delete(sourceId);
  if (fireSources.size === 0) dispatchMouse(0, false);
}

function endAllFire(): void {
  if (fireSources.size === 0) return;
  fireSources.clear();
  dispatchMouse(0, false);
  attachedButton?.classList.remove('is-fire-aiming', 'is-fire-dragging');
  attachedButton?.closest('#gone-mobile-controls')?.classList.remove('pubg-fire-aim-active');
}

function applyLookDelta(dx: number, dy: number, sprayRamp = 1): void {
  const preferences = getTouchPreferences();
  const sensitivity = inputState.aim
    ? 0.0030 * preferences.adsSensitivity
    : 0.0042 * preferences.lookSensitivity;

  inputState.yaw -= dx * sensitivity * sprayRamp;
  inputState.pitch -= dy * sensitivity * sprayRamp;
  inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
  inputState.timestamp = performance.now();
}

function resetDrag(state: DragState): void {
  state.pointerId = null;
  state.startedAt = 0;
  state.dragging = false;
}

function startDrag(state: DragState, event: PointerEvent): void {
  state.pointerId = event.pointerId;
  state.startX = event.clientX;
  state.startY = event.clientY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  state.startedAt = performance.now();
  state.dragging = false;
}

function updateDrag(state: DragState, event: PointerEvent, useDeadZone: boolean, sprayCurve: boolean): boolean {
  if (state.pointerId !== event.pointerId) return false;
  const preferences = getTouchPreferences();
  const totalDistance = Math.hypot(event.clientX - state.startX, event.clientY - state.startY);
  if (useDeadZone && !state.dragging && totalDistance < preferences.fireDragDeadZone) {
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    return false;
  }

  const dx = event.clientX - state.lastX;
  const dy = event.clientY - state.lastY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  if (Math.abs(dx) + Math.abs(dy) < 0.01) return false;
  state.dragging = true;

  // Fine initial tracking reduces accidental over-aim at trigger contact; after
  // ~700 ms the curve reaches the configured sensitivity for sustained spray.
  const heldMs = Math.max(0, performance.now() - state.startedAt);
  const ramp = sprayCurve ? 0.82 + 0.18 * Math.min(1, heldMs / 700) : 1;
  applyLookDelta(dx, dy, ramp);
  return true;
}

function bindPrimaryFireDrag(button: HTMLButtonElement): void {
  if (button.dataset.gonePubgFireDrag === '2') return;
  button.dataset.gonePubgFireDrag = '2';
  attachedButton = button;

  // Capture phase intentionally replaces the legacy mobile FIRE handler. The
  // legacy handler writes inputState.fire, which lets engine.ts bypass the
  // authoritative magazine/reload controller during sustained touch fire.
  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || (event.button !== 0 && event.pointerType !== 'touch')) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    startDrag(primaryDrag, event);
    beginFire(event.pointerId);
    button.classList.add('is-fire-aiming');
    button.closest('#gone-mobile-controls')?.classList.add('pubg-fire-aim-active');
    try { button.setPointerCapture?.(event.pointerId); } catch { /* synthetic/legacy pointer */ }
  }, true);

  button.addEventListener('pointermove', (event) => {
    if (primaryDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    if (updateDrag(primaryDrag, event, true, true)) button.classList.add('is-fire-dragging');
  }, true);

  const finish = (event: PointerEvent) => {
    if (primaryDrag.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    endFire(event.pointerId);
    resetDrag(primaryDrag);
    button.classList.remove('is-fire-aiming', 'is-fire-dragging');
    button.closest('#gone-mobile-controls')?.classList.remove('pubg-fire-aim-active');
  };
  button.addEventListener('pointerup', finish, true);
  button.addEventListener('pointercancel', finish, true);
  button.addEventListener('lostpointercapture', finish, true);
}

function bindAdsDrag(button: HTMLButtonElement): void {
  if (button.dataset.gonePubgAdsDrag === '1') return;
  button.dataset.gonePubgAdsDrag = '1';
  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive()) return;
    startDrag(adsDrag, event);
  });
  button.addEventListener('pointermove', (event) => {
    if (adsDrag.pointerId !== event.pointerId || !gameplayActive()) return;
    event.preventDefault();
    updateDrag(adsDrag, event, false, false);
  });
  const finish = (event: PointerEvent) => {
    if (adsDrag.pointerId === event.pointerId) resetDrag(adsDrag);
  };
  button.addEventListener('pointerup', finish);
  button.addEventListener('pointercancel', finish);
  button.addEventListener('lostpointercapture', finish);
}

function ensureSecondaryFire(root: HTMLElement): HTMLButtonElement {
  let button = document.getElementById('mc-fire-left') as HTMLButtonElement | null;
  if (button) return button;
  button = document.createElement('button');
  button.type = 'button';
  button.id = 'mc-fire-left';
  button.className = 'mc-action mc-fire-left';
  button.setAttribute('aria-label', 'Fuoco secondario claw');
  button.textContent = 'FIRE';
  root.appendChild(button);
  return button;
}

function bindSecondaryFire(button: HTMLButtonElement): void {
  if (button.dataset.gonePubgSecondaryFire === '1') return;
  button.dataset.gonePubgSecondaryFire = '1';
  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    beginFire(event.pointerId);
    button.classList.add('is-held');
    try { button.setPointerCapture?.(event.pointerId); } catch { /* best effort */ }
  }, true);
  const finish = (event: PointerEvent) => {
    if (!fireSources.has(event.pointerId)) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    endFire(event.pointerId);
    button.classList.remove('is-held');
  };
  button.addEventListener('pointerup', finish, true);
  button.addEventListener('pointercancel', finish, true);
  button.addEventListener('lostpointercapture', finish, true);
}

function updateWeaponLabel(): void {
  const label = document.getElementById('mc-weapon-name');
  if (!label) return;
  const raw = String((window as any).goneGame?.getActiveWeapon?.() ?? 'assalto');
  const names: Record<string, string> = {
    assalto: 'AR', cecchino: 'SNIPER', pompa: 'SHOTGUN', mitraglietta: 'SMG', coltello: 'KNIFE',
  };
  label.textContent = names[raw] ?? raw.toUpperCase();
}

function switchWeapon(delta: number): void {
  const game = (window as any).goneGame;
  const count = Object.keys((window as any).goneWeapons?.config ?? {}).length || 5;
  const current = Number(game?.getActiveWeaponIndex?.() ?? 0);
  const next = ((current + delta) % count + count) % count;
  const result = game?.switchWeapon?.(next);
  void Promise.resolve(result).finally(() => window.setTimeout(updateWeaponLabel, 0));
}

function bindReliableTap(id: string, action: () => void): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (!button || button.dataset.goneReliablePointer === '1') return;
  button.dataset.goneReliablePointer = '1';
  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    action();
  }, true);
  // Prevent the compatibility click handler from firing the action a second time.
  button.addEventListener('click', (event) => {
    if (!gameplayActive()) return;
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
}

function bindActionButtons(): void {
  bindReliableTap('mc-reload', () => (window as any).goneWeapons?.reload?.());
  bindReliableTap('mc-prev', () => switchWeapon(-1));
  bindReliableTap('mc-next', () => switchWeapon(1));
  bindReliableTap('mc-map', () => dispatchKey('KeyM'));
  bindReliableTap('mc-menu', () => {
    const controls = (window as any).goneMobileControls;
    if (typeof controls?.pause === 'function') controls.pause();
    else dispatchKey('Escape');
  });
}

async function ensureGyroPermission(): Promise<void> {
  if (!getTouchPreferences().gyroEnabled) return;
  if (typeof DeviceOrientationEvent === 'undefined') {
    gyroPermission = 'unsupported';
    return;
  }
  try {
    const requestPermission = (DeviceOrientationEvent as any).requestPermission as (() => Promise<string>) | undefined;
    if (typeof requestPermission === 'function') {
      const result = await requestPermission.call(DeviceOrientationEvent);
      gyroPermission = result === 'granted' ? 'granted' : 'denied';
    } else {
      gyroPermission = 'granted';
    }
  } catch {
    gyroPermission = 'denied';
  }
  gyroLastBeta = null;
  gyroLastGamma = null;
}

function wrappedDelta(next: number, previous: number): number {
  let delta = next - previous;
  while (delta > 180) delta -= 360;
  while (delta < -180) delta += 360;
  return delta;
}

function onDeviceOrientation(event: DeviceOrientationEvent): void {
  const preferences = getTouchPreferences();
  if (!preferences.gyroEnabled || gyroPermission !== 'granted' || !gameplayActive() || (!inputState.aim && fireSources.size === 0)) {
    gyroLastBeta = null;
    gyroLastGamma = null;
    return;
  }
  if (event.beta === null || event.gamma === null) return;
  if (gyroLastBeta === null || gyroLastGamma === null) {
    gyroLastBeta = event.beta;
    gyroLastGamma = event.gamma;
    return;
  }

  const betaDelta = wrappedDelta(event.beta, gyroLastBeta);
  const gammaDelta = wrappedDelta(event.gamma, gyroLastGamma);
  gyroLastBeta = event.beta;
  gyroLastGamma = event.gamma;
  if (Math.abs(betaDelta) > 25 || Math.abs(gammaDelta) > 25) return;

  const angle = Number(screen.orientation?.angle ?? 0);
  let yawDegrees = gammaDelta;
  let pitchDegrees = betaDelta;
  if (Math.abs(angle) === 90 || Math.abs(angle) === 270) {
    const sign = angle === 90 || angle === -270 ? 1 : -1;
    yawDegrees = betaDelta * sign;
    pitchDegrees = -gammaDelta * sign;
  }

  inputState.yaw -= yawDegrees * 0.0018 * preferences.gyroSensitivity;
  inputState.pitch -= pitchDegrees * 0.0015 * preferences.gyroSensitivity;
  inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
  inputState.timestamp = performance.now();
}

function attachWhenAvailable(): boolean {
  const root = document.getElementById('gone-mobile-controls') as HTMLElement | null;
  const button = document.getElementById('mc-fire') as HTMLButtonElement | null;
  if (!root || !button) return false;
  bindPrimaryFireDrag(button);
  const aim = document.getElementById('mc-aim') as HTMLButtonElement | null;
  if (aim) bindAdsDrag(aim);
  bindSecondaryFire(ensureSecondaryFire(root));
  bindActionButtons();
  return true;
}

function snapshot(): FireDragSnapshot {
  return {
    enabled: true,
    attached: Boolean(attachedButton?.isConnected),
    pointerActive: primaryDrag.pointerId !== null,
    fireActive: fireSources.size > 0,
    secondaryFire: getTouchPreferences().secondaryFire,
    gyro: gyroPermission,
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
  const controlsObserver = new MutationObserver(() => { attachWhenAvailable(); });
  controlsObserver.observe(document.body, { childList: true, subtree: true });

  window.addEventListener('gone-input-mode-changed', () => {
    endAllFire();
    window.setTimeout(attachWhenAvailable, 0);
  });
  window.addEventListener('gone-touch-preferences-changed', () => {
    if (getTouchPreferences().gyroEnabled) void ensureGyroPermission();
    else {
      gyroLastBeta = null;
      gyroLastGamma = null;
    }
    window.setTimeout(attachWhenAvailable, 0);
  });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') {
      endAllFire();
      resetDrag(primaryDrag);
      resetDrag(adsDrag);
      gyroLastBeta = null;
      gyroLastGamma = null;
    }
  });
  window.addEventListener('deviceorientation', onDeviceOrientation, { passive: true });

  if (getTouchPreferences().gyroEnabled) void ensureGyroPermission();

  (window as any).gonePubgTouchControls = {
    enabled: true,
    snapshot,
    rebind: attachWhenAvailable,
    requestGyroPermission: ensureGyroPermission,
  };
}
import './competitiveTouchControls.css';
import { inputState } from '../controls/playerInput.ts';
import { useOnScreenControls } from './inputMode.ts';
import { getTouchPreferences } from './touchPreferences.ts';

type DragState = {
  pointerId: number | null;
  startX: number;
  startY: number;
  lastX: number;
  lastY: number;
};

const move = { pointerId: null as number | null, autoSprint: false };
const look: DragState = { pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
const ads: DragState = { pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
const mapFire: DragState = { pointerId: null, startX: 0, startY: 0, lastX: 0, lastY: 0 };
const manualSprintPointers = new Set<number>();
const jumpPointers = new Set<number>();
const crouchPointers = new Set<number>();
const firePointers = new Set<number>();
const nativePointerLockGetter = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement')?.get;
let pointerBridgeInstalled = false;

function visible(id: string): boolean {
  const element = document.getElementById(id);
  return Boolean(element && !element.classList.contains('hidden'));
}

function gameplayActive(): boolean {
  return visible('game-ui') &&
    !visible('main-menu') &&
    !visible('settings-menu') &&
    !visible('multiplayer-lobby') &&
    !visible('death-overlay') &&
    !document.documentElement.classList.contains('gone-touch-layout-edit');
}

function mapOpen(): boolean {
  return visible('map-ui') || Boolean((window as any).__goneMapOverlayOpen);
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
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}

function capture(element: Element | null, pointerId: number): void {
  try { (element as Element & { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(pointerId); } catch { /* best effort */ }
}

function stop(event: PointerEvent): void {
  event.preventDefault();
  event.stopImmediatePropagation();
}

function syncAdsButtonPresentation(): void {
  const aim = document.getElementById('mc-aim') as HTMLButtonElement | null;
  if (!aim) return;
  const mode = getTouchPreferences().adsMode;
  aim.dataset.goneAdsMode = mode;
  aim.classList.toggle('is-held', inputState.aim);
  aim.setAttribute('aria-pressed', String(inputState.aim));
  aim.setAttribute('aria-label', mode === 'toggle' ? 'Mira, tocca per attivare o disattivare' : 'Mira, tieni premuto');
}

function setAdsActive(active: boolean, forceDispatch = false): void {
  const changed = inputState.aim !== active;
  inputState.aim = active;
  inputState.timestamp = performance.now();
  syncAdsButtonPresentation();
  if (changed || forceDispatch) dispatchMouse(2, active);
}

function applyLookDelta(dx: number, dy: number, adsMode = inputState.aim): void {
  const prefs = getTouchPreferences();
  const sensitivity = adsMode
    ? 0.0030 * prefs.adsSensitivity
    : 0.0042 * prefs.lookSensitivity;
  inputState.yaw -= dx * sensitivity;
  inputState.pitch -= dy * sensitivity;
  inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
  inputState.timestamp = performance.now();
}

function updateSprintState(): void {
  inputState.shift = move.autoSprint || manualSprintPointers.size > 0;
  inputState.timestamp = performance.now();
}

function updateMovement(clientX: number, clientY: number): void {
  const stick = document.getElementById('mobile-stick') as HTMLElement | null;
  const knob = document.getElementById('mobile-stick-knob') as HTMLElement | null;
  if (!stick || !knob) return;
  const rect = stick.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(1, rect.width * 0.36);
  let dx = clientX - cx;
  let dy = clientY - cy;
  const length = Math.hypot(dx, dy);
  if (length > radius) {
    dx = dx / length * radius;
    dy = dy / length * radius;
  }
  const nx = dx / radius;
  const ny = dy / radius;
  const dead = 0.18;
  inputState.left = nx < -dead;
  inputState.right = nx > dead;
  inputState.forward = ny < -dead;
  inputState.backward = ny > dead;
  move.autoSprint = ny < -0.82;
  updateSprintState();
  knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function releaseMovement(): void {
  move.pointerId = null;
  move.autoSprint = false;
  inputState.forward = false;
  inputState.backward = false;
  inputState.left = false;
  inputState.right = false;
  document.getElementById('mobile-stick-knob')?.style.setProperty('transform', 'translate(-50%, -50%)');
  updateSprintState();
}

function startDrag(state: DragState, event: PointerEvent): void {
  state.pointerId = event.pointerId;
  state.startX = state.lastX = event.clientX;
  state.startY = state.lastY = event.clientY;
}

function moveDrag(state: DragState, event: PointerEvent, adsMode: boolean, deadZone = 0): void {
  if (state.pointerId !== event.pointerId) return;
  if (deadZone > 0 && Math.hypot(event.clientX - state.startX, event.clientY - state.startY) < deadZone) {
    state.lastX = event.clientX;
    state.lastY = event.clientY;
    return;
  }
  const dx = event.clientX - state.lastX;
  const dy = event.clientY - state.lastY;
  state.lastX = event.clientX;
  state.lastY = event.clientY;
  if (Math.abs(dx) + Math.abs(dy) > 0.01) applyLookDelta(dx, dy, adsMode);
}

function endDrag(state: DragState): void {
  state.pointerId = null;
}

function beginMapFire(event: PointerEvent, primary: boolean): void {
  firePointers.add(event.pointerId);
  if (firePointers.size === 1) dispatchMouse(0, true);
  if (primary) startDrag(mapFire, event);
}

function endMapFire(event: PointerEvent): void {
  firePointers.delete(event.pointerId);
  if (firePointers.size === 0) dispatchMouse(0, false);
  if (mapFire.pointerId === event.pointerId) endDrag(mapFire);
}

function selectWeapon(index: number): void {
  const game = (window as any).goneGame;
  const count = Object.keys((window as any).goneWeapons?.config ?? {}).length || 5;
  if (!Number.isInteger(index) || index < 0 || index >= count) return;
  const result = game?.switchWeapon?.(index);
  void Promise.resolve(result).finally(() => {
    // PUBG touch owns quick-slot label/class/ARIA presentation. Competitive map
    // input only notifies that owner after canonical selection has settled.
    (window as any).gonePubgTouchControls?.rebind?.();
  });
}

function switchWeapon(delta: number): void {
  const game = (window as any).goneGame;
  const count = Object.keys((window as any).goneWeapons?.config ?? {}).length || 5;
  const current = Number(game?.getActiveWeaponIndex?.() ?? 0);
  const next = ((current + delta) % count + count) % count;
  selectWeapon(next);
}

function installPointerLockBridge(): void {
  if (pointerBridgeInstalled) return;
  const previous = Object.getOwnPropertyDescriptor(document, 'pointerLockElement')?.get;
  try {
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get() {
        // The base mobile runtime already owns virtual pointer lock during normal
        // gameplay, including its forced-unlock pause path. We only bridge the
        // map-open gap so AdvancedWeaponController can keep processing combat.
        if (useOnScreenControls() && gameplayActive() && mapOpen()) return document.body;
        return previous?.call(document) ?? nativePointerLockGetter?.call(document) ?? null;
      },
    });
    pointerBridgeInstalled = true;
  } catch {
    // Preserve native pointer lock if the browser does not allow an own-property bridge.
    pointerBridgeInstalled = false;
  }
}

function onPointerDown(event: PointerEvent): void {
  if (!useOnScreenControls() || !gameplayActive()) return;
  const target = event.target instanceof Element ? event.target : null;
  if (!target?.closest('#gone-mobile-controls')) return;

  const mapButton = target.closest('#mc-map');
  if (mapButton) {
    stop(event);
    dispatchKey('KeyM');
    return;
  }

  const stick = target.closest('#mobile-stick');
  if (stick) {
    stop(event);
    move.pointerId = event.pointerId;
    capture(stick, event.pointerId);
    updateMovement(event.clientX, event.clientY);
    return;
  }

  const lookPad = target.closest('#mobile-look-pad');
  if (lookPad) {
    stop(event);
    startDrag(look, event);
    capture(lookPad, event.pointerId);
    return;
  }

  const aim = target.closest('#mc-aim');
  if (aim) {
    stop(event);
    startDrag(ads, event);
    capture(aim, event.pointerId);
    if (getTouchPreferences().adsMode === 'toggle') setAdsActive(!inputState.aim);
    else setAdsActive(true);
    return;
  }

  const sprint = target.closest('#mc-sprint');
  if (sprint) {
    stop(event);
    manualSprintPointers.add(event.pointerId);
    updateSprintState();
    capture(sprint, event.pointerId);
    (sprint as HTMLElement).classList.add('is-held');
    return;
  }

  const jump = target.closest('#mc-jump');
  if (jump) {
    stop(event);
    jumpPointers.add(event.pointerId);
    inputState.jump = true;
    inputState.timestamp = performance.now();
    capture(jump, event.pointerId);
    (jump as HTMLElement).classList.add('is-held');
    return;
  }

  const crouch = target.closest('#mc-crouch');
  if (crouch) {
    stop(event);
    crouchPointers.add(event.pointerId);
    inputState.ctrl = true;
    inputState.timestamp = performance.now();
    capture(crouch, event.pointerId);
    (crouch as HTMLElement).classList.add('is-held');
    return;
  }

  // The existing ammo-authoritative PUBG layer owns FIRE during normal play.
  // This branch only takes ownership while the live map is visible, because the
  // legacy touch runtime deliberately blocked map-open input.
  if (mapOpen()) {
    const primaryFire = target.closest('#mc-fire');
    const secondaryFire = target.closest('#mc-fire-left');
    if (primaryFire || secondaryFire) {
      stop(event);
      beginMapFire(event, Boolean(primaryFire));
      capture(primaryFire || secondaryFire, event.pointerId);
      (primaryFire || secondaryFire)?.classList.add('is-held');
      return;
    }

    const reload = target.closest('#mc-reload');
    if (reload) {
      stop(event);
      (window as any).goneWeapons?.reload?.();
      return;
    }

    const directWeapon = target.closest<HTMLElement>('[data-gone-weapon-index]');
    if (directWeapon) {
      stop(event);
      selectWeapon(Number(directWeapon.dataset.goneWeaponIndex));
      return;
    }

    if (target.closest('#mc-prev')) {
      stop(event);
      switchWeapon(-1);
      return;
    }
    if (target.closest('#mc-next')) {
      stop(event);
      switchWeapon(1);
    }
  }
}

function onPointerMove(event: PointerEvent): void {
  if (move.pointerId === event.pointerId) {
    stop(event);
    updateMovement(event.clientX, event.clientY);
    return;
  }
  if (look.pointerId === event.pointerId) {
    stop(event);
    moveDrag(look, event, inputState.aim);
    return;
  }
  if (ads.pointerId === event.pointerId) {
    stop(event);
    moveDrag(ads, event, inputState.aim);
    return;
  }
  if (mapFire.pointerId === event.pointerId) {
    stop(event);
    moveDrag(mapFire, event, inputState.aim, getTouchPreferences().fireDragDeadZone);
  }
}

function onPointerEnd(event: PointerEvent): void {
  let owned = false;
  if (move.pointerId === event.pointerId) {
    releaseMovement();
    owned = true;
  }
  if (look.pointerId === event.pointerId) {
    endDrag(look);
    owned = true;
  }
  if (ads.pointerId === event.pointerId) {
    endDrag(ads);
    if (getTouchPreferences().adsMode === 'hold') setAdsActive(false);
    else syncAdsButtonPresentation();
    owned = true;
  }
  if (manualSprintPointers.delete(event.pointerId)) {
    updateSprintState();
    document.getElementById('mc-sprint')?.classList.remove('is-held');
    owned = true;
  }
  if (jumpPointers.delete(event.pointerId)) {
    inputState.jump = jumpPointers.size > 0;
    inputState.timestamp = performance.now();
    document.getElementById('mc-jump')?.classList.remove('is-held');
    owned = true;
  }
  if (crouchPointers.delete(event.pointerId)) {
    inputState.ctrl = crouchPointers.size > 0;
    inputState.timestamp = performance.now();
    document.getElementById('mc-crouch')?.classList.remove('is-held');
    owned = true;
  }
  if (firePointers.has(event.pointerId)) {
    endMapFire(event);
    document.getElementById('mc-fire')?.classList.remove('is-held');
    document.getElementById('mc-fire-left')?.classList.remove('is-held');
    owned = true;
  }
  if (owned) stop(event);
}

function releaseAll(): void {
  releaseMovement();
  endDrag(look);
  endDrag(ads);
  endDrag(mapFire);
  manualSprintPointers.clear();
  jumpPointers.clear();
  crouchPointers.clear();
  firePointers.clear();
  inputState.jump = false;
  inputState.ctrl = false;
  inputState.shift = false;
  setAdsActive(false, true);
  dispatchMouse(0, false);
}

export function startCompetitiveTouchControls(): void {
  if ((window as any).__goneCompetitiveTouchControlsStarted) return;
  (window as any).__goneCompetitiveTouchControlsStarted = true;
  installPointerLockBridge();
  syncAdsButtonPresentation();

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState !== 'visible') releaseAll();
  });
  document.addEventListener('pointerlockchange', () => {
    if (!gameplayActive()) releaseAll();
  });
  window.addEventListener('gone-input-mode-changed', () => {
    releaseAll();
    installPointerLockBridge();
  });
  window.addEventListener('gone-touch-preferences-changed', () => {
    releaseAll();
    syncAdsButtonPresentation();
  });

  (window as any).goneCompetitiveTouchControls = {
    snapshot: () => ({
      enabled: useOnScreenControls(),
      gameplayActive: gameplayActive(),
      mapOpen: mapOpen(),
      autoSprint: move.autoSprint,
      movePointer: move.pointerId,
      lookPointer: look.pointerId,
      adsPointer: ads.pointerId,
      adsMode: getTouchPreferences().adsMode,
      adsActive: inputState.aim,
      mapFirePointers: firePointers.size,
      pointerBridgeInstalled,
    }),
  };
}

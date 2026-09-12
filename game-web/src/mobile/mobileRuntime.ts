import './mobile.css';
import { inputState, resetInputState } from '../controls/playerInput.ts';
import { sceneManager } from '../rendering/scene.ts';

type WakeLockSentinelLike = { release?: () => Promise<void>; addEventListener?: (type: string, cb: () => void) => void };

type MobileSnapshot = {
  enabled: boolean;
  gameplayActive: boolean;
  mapOpen: boolean;
  virtualPointerLock: boolean;
  shimInstalled: boolean;
  yaw: number;
  pitch: number;
  forward: boolean;
  backward: boolean;
  left: boolean;
  right: boolean;
  fire: boolean;
  aim: boolean;
  dpr: number | null;
};

const mobileCapable = navigator.maxTouchPoints > 0 && (
  window.matchMedia('(pointer: coarse)').matches ||
  window.matchMedia('(any-pointer: coarse)').matches ||
  /Android|iPhone|iPad|iPod/i.test(navigator.userAgent)
);

let root: HTMLDivElement | null = null;
let lookPad: HTMLDivElement | null = null;
let stickBase: HTMLDivElement | null = null;
let stickKnob: HTMLDivElement | null = null;
let forcedUnlock = false;
let pointerShimInstalled = false;
let lookPointerId: number | null = null;
let movePointerId: number | null = null;
let lookLastX = 0;
let lookLastY = 0;
let wakeLock: WakeLockSentinelLike | null = null;
let lastGameplayActive = false;

const nativePointerLockDescriptor = Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement');
const nativePointerLockGetter = nativePointerLockDescriptor?.get;

function elementVisible(id: string): boolean {
  const el = document.getElementById(id);
  return !!el && !el.classList.contains('hidden');
}

function mapOpen(): boolean {
  return elementVisible('map-ui');
}

function gameplayActive(): boolean {
  return elementVisible('game-ui') &&
    !elementVisible('main-menu') &&
    !elementVisible('settings-menu') &&
    !elementVisible('multiplayer-lobby') &&
    !elementVisible('death-overlay');
}

function virtualPointerLocked(): boolean {
  return mobileCapable && !forcedUnlock && gameplayActive() && !mapOpen();
}

function installVirtualPointerLock(): void {
  if (!mobileCapable || pointerShimInstalled) return;
  pointerShimInstalled = true;

  try {
    Object.defineProperty(document, 'pointerLockElement', {
      configurable: true,
      get() {
        if (virtualPointerLocked()) return document.body;
        return nativePointerLockGetter?.call(document) ?? null;
      },
    });
  } catch (error) {
    console.warn('[Mobile] Virtual pointer-lock compatibility shim unavailable:', error);
  }

  // iOS has no Pointer Lock API. Android browsers may expose it, but the game
  // does not need native pointer lock when touch look is active. A resolved
  // no-op keeps legacy desktop resume/map code safe on both platforms.
  try {
    Object.defineProperty(document.body, 'requestPointerLock', {
      configurable: true,
      writable: true,
      value: () => Promise.resolve(),
    });
  } catch {
    // If the browser makes this property non-configurable, the virtual getter
    // still handles the gameplay guards and rejected native requests are benign.
  }
}

function tryCapture(element: Element | null, pointerId: number): void {
  try { (element as Element & { setPointerCapture?: (id: number) => void } | null)?.setPointerCapture?.(pointerId); } catch { /* synthetic/legacy pointer */ }
}

function haptic(pattern: number | number[] = 10): void {
  try { navigator.vibrate?.(pattern); } catch { /* optional */ }
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

function releaseTransientInput(): void {
  inputState.forward = false;
  inputState.backward = false;
  inputState.left = false;
  inputState.right = false;
  inputState.shift = false;
  inputState.ctrl = false;
  inputState.jump = false;
  inputState.fire = false;
  inputState.aim = false;
  inputState.timestamp = performance.now();
  dispatchMouse(0, false);
  dispatchMouse(2, false);
  stickKnob?.style.setProperty('transform', 'translate(-50%, -50%)');
  movePointerId = null;
  lookPointerId = null;
}

function setMoveFromPointer(clientX: number, clientY: number): void {
  if (!stickBase || !stickKnob) return;
  const rect = stickBase.getBoundingClientRect();
  const cx = rect.left + rect.width / 2;
  const cy = rect.top + rect.height / 2;
  const radius = Math.max(1, rect.width * 0.34);
  let dx = clientX - cx;
  let dy = clientY - cy;
  const length = Math.hypot(dx, dy);
  if (length > radius) {
    dx = dx / length * radius;
    dy = dy / length * radius;
  }
  const nx = dx / radius;
  const ny = dy / radius;
  const deadZone = 0.22;
  inputState.left = nx < -deadZone;
  inputState.right = nx > deadZone;
  inputState.forward = ny < -deadZone;
  inputState.backward = ny > deadZone;
  inputState.timestamp = performance.now();
  stickKnob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
}

function bindMoveStick(): void {
  if (!stickBase) return;
  stickBase.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    movePointerId = event.pointerId;
    tryCapture(stickBase, event.pointerId);
    setMoveFromPointer(event.clientX, event.clientY);
  });
  stickBase.addEventListener('pointermove', (event) => {
    if (movePointerId !== event.pointerId) return;
    event.preventDefault();
    setMoveFromPointer(event.clientX, event.clientY);
  });
  const finish = (event: PointerEvent) => {
    if (movePointerId !== event.pointerId) return;
    movePointerId = null;
    inputState.forward = inputState.backward = inputState.left = inputState.right = false;
    inputState.timestamp = performance.now();
    stickKnob?.style.setProperty('transform', 'translate(-50%, -50%)');
  };
  stickBase.addEventListener('pointerup', finish);
  stickBase.addEventListener('pointercancel', finish);
}

function bindLookPad(): void {
  if (!lookPad) return;
  lookPad.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    lookPointerId = event.pointerId;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    tryCapture(lookPad, event.pointerId);
  });
  lookPad.addEventListener('pointermove', (event) => {
    if (lookPointerId !== event.pointerId || !gameplayActive() || mapOpen()) return;
    event.preventDefault();
    const dx = event.clientX - lookLastX;
    const dy = event.clientY - lookLastY;
    lookLastX = event.clientX;
    lookLastY = event.clientY;
    const sensitivity = inputState.aim ? 0.0030 : 0.0042;
    inputState.yaw -= dx * sensitivity;
    inputState.pitch -= dy * sensitivity;
    inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
    inputState.timestamp = performance.now();
  });
  const finish = (event: PointerEvent) => {
    if (lookPointerId === event.pointerId) lookPointerId = null;
  };
  lookPad.addEventListener('pointerup', finish);
  lookPad.addEventListener('pointercancel', finish);
}

function bindHoldButton(id: string, onDown: () => void, onUp: () => void): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (!button) return;
  let heldPointer: number | null = null;
  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    heldPointer = event.pointerId;
    tryCapture(button, event.pointerId);
    button.classList.add('is-held');
    haptic(8);
    onDown();
  });
  const release = (event: PointerEvent) => {
    if (heldPointer !== event.pointerId) return;
    heldPointer = null;
    button.classList.remove('is-held');
    onUp();
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
  button.addEventListener('lostpointercapture', () => {
    if (heldPointer === null) return;
    heldPointer = null;
    button.classList.remove('is-held');
    onUp();
  });
}

function bindTapButton(id: string, action: () => void): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (!button) return;
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    haptic(7);
    action();
  });
}

function switchWeapon(delta: number): void {
  const api = (window as any).goneGame;
  const count = Object.keys((window as any).goneWeapons?.config ?? {}).length || 5;
  const current = Number(api?.getActiveWeaponIndex?.() ?? 0);
  const next = ((current + delta) % count + count) % count;
  api?.switchWeapon?.(next);
  window.setTimeout(updateWeaponLabel, 0);
}

function updateWeaponLabel(): void {
  const label = document.getElementById('mc-weapon-name');
  if (!label) return;
  const api = (window as any).goneGame;
  const raw = String(api?.getActiveWeapon?.() ?? 'assalto');
  const names: Record<string, string> = {
    assalto: 'AR', cecchino: 'SNIPER', pompa: 'SHOTGUN', mitraglietta: 'SMG', coltello: 'KNIFE',
  };
  label.textContent = names[raw] ?? raw.toUpperCase();
}

function pauseToMenu(): void {
  if (!gameplayActive()) return;
  forcedUnlock = true;
  releaseTransientInput();
  resetInputState();
  document.dispatchEvent(new Event('pointerlockchange'));
  syncVisibility();
}

function createControls(): void {
  if (!mobileCapable || document.getElementById('gone-mobile-controls')) return;

  root = document.createElement('div');
  root.id = 'gone-mobile-controls';
  root.className = 'hidden';
  root.innerHTML = `
    <div id="mobile-look-pad" aria-label="Area visuale touch"></div>
    <div id="mobile-stick" aria-label="Joystick movimento"><div id="mobile-stick-knob"></div></div>
    <button type="button" id="mc-menu" class="mc-small" aria-label="Pausa">☰</button>
    <div id="mc-weapon-switcher" aria-label="Cambio arma">
      <button type="button" id="mc-prev" class="mc-small" aria-label="Arma precedente">‹</button>
      <div id="mc-weapon-name">AR</div>
      <button type="button" id="mc-next" class="mc-small" aria-label="Arma successiva">›</button>
    </div>
    <button type="button" id="mc-map" class="mc-small" aria-label="Mappa">MAP</button>
    <button type="button" id="mc-fire" class="mc-action mc-fire" aria-label="Fuoco">FIRE</button>
    <button type="button" id="mc-aim" class="mc-action mc-aim" aria-label="Mira">ADS</button>
    <button type="button" id="mc-jump" class="mc-action" aria-label="Salta">JUMP</button>
    <button type="button" id="mc-reload" class="mc-small" aria-label="Ricarica">R</button>
    <button type="button" id="mc-crouch" class="mc-small" aria-label="Accovacciati">C</button>
    <button type="button" id="mc-sprint" class="mc-small" aria-label="Scatta">RUN</button>
  `;
  document.body.appendChild(root);
  lookPad = document.getElementById('mobile-look-pad') as HTMLDivElement;
  stickBase = document.getElementById('mobile-stick') as HTMLDivElement;
  stickKnob = document.getElementById('mobile-stick-knob') as HTMLDivElement;

  bindMoveStick();
  bindLookPad();
  bindHoldButton('mc-fire', () => { inputState.fire = true; inputState.timestamp = performance.now(); dispatchMouse(0, true); }, () => { inputState.fire = false; inputState.timestamp = performance.now(); dispatchMouse(0, false); });
  bindHoldButton('mc-aim', () => { inputState.aim = true; inputState.timestamp = performance.now(); dispatchMouse(2, true); }, () => { inputState.aim = false; inputState.timestamp = performance.now(); dispatchMouse(2, false); });
  bindHoldButton('mc-jump', () => { inputState.jump = true; inputState.timestamp = performance.now(); }, () => { inputState.jump = false; inputState.timestamp = performance.now(); });
  bindHoldButton('mc-crouch', () => { inputState.ctrl = true; inputState.timestamp = performance.now(); }, () => { inputState.ctrl = false; inputState.timestamp = performance.now(); });
  bindHoldButton('mc-sprint', () => { inputState.shift = true; inputState.timestamp = performance.now(); }, () => { inputState.shift = false; inputState.timestamp = performance.now(); });
  bindTapButton('mc-reload', () => dispatchKey('KeyR'));
  bindTapButton('mc-map', () => dispatchKey('KeyM'));
  bindTapButton('mc-prev', () => switchWeapon(-1));
  bindTapButton('mc-next', () => switchWeapon(1));
  bindTapButton('mc-menu', pauseToMenu);
}

function createRotateHint(): void {
  if (document.getElementById('gone-rotate-phone')) return;
  const rotate = document.createElement('div');
  rotate.id = 'gone-rotate-phone';
  rotate.textContent = 'Per il controllo migliore, ruota il telefono in orizzontale.';
  document.body.appendChild(rotate);
}

async function requestWakeLock(): Promise<void> {
  if (!mobileCapable || document.visibilityState !== 'visible' || !gameplayActive()) return;
  if (wakeLock) return;
  try {
    const manager = (navigator as Navigator & { wakeLock?: { request: (type: 'screen') => Promise<WakeLockSentinelLike> } }).wakeLock;
    wakeLock = await manager?.request('screen') ?? null;
    wakeLock?.addEventListener?.('release', () => { wakeLock = null; });
  } catch {
    wakeLock = null;
  }
}

async function releaseWakeLock(): Promise<void> {
  const current = wakeLock;
  wakeLock = null;
  try { await current?.release?.(); } catch { /* optional */ }
}

async function requestImmersiveMode(): Promise<void> {
  if (!mobileCapable) return;
  forcedUnlock = false;
  try {
    const standalone = window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as any).standalone);
    if (!standalone && !document.fullscreenElement && document.documentElement.requestFullscreen) {
      await document.documentElement.requestFullscreen({ navigationUI: 'hide' });
    }
  } catch { /* iOS/PWA may not expose Fullscreen API */ }
  try {
    const orientation = screen.orientation as ScreenOrientation & { lock?: (orientation: string) => Promise<void> };
    await orientation.lock?.('landscape');
  } catch { /* orientation lock is best-effort */ }
}

function clampMobileDpr(): void {
  if (!mobileCapable) return;
  const renderer = sceneManager.renderer;
  if (!renderer) return;
  const target = Math.min(renderer.getPixelRatio(), window.devicePixelRatio || 1, 1.0);
  if (renderer.getPixelRatio() > target + 0.001) {
    renderer.setPixelRatio(target);
    renderer.setSize(window.innerWidth, window.innerHeight, false);
  }
}

function syncVisibility(): void {
  if (!root) return;
  const active = gameplayActive();
  const openMap = mapOpen();
  const rotate = document.getElementById('gone-rotate-phone');

  if (active) {
    forcedUnlock = false;
    root.classList.remove('hidden');
    root.classList.toggle('map-open', openMap);
    rotate?.classList.add('is-active');
    updateWeaponLabel();
    clampMobileDpr();
    if (!lastGameplayActive) void requestWakeLock();
  } else {
    root.classList.add('hidden');
    root.classList.remove('map-open');
    rotate?.classList.remove('is-active');
    if (lastGameplayActive) {
      releaseTransientInput();
      void releaseWakeLock();
    }
  }
  lastGameplayActive = active;
}

function observeGameUi(): void {
  const targets = ['game-ui', 'map-ui', 'main-menu', 'settings-menu', 'multiplayer-lobby', 'death-overlay']
    .map((id) => document.getElementById(id))
    .filter((el): el is HTMLElement => !!el);
  const observer = new MutationObserver(syncVisibility);
  targets.forEach((target) => observer.observe(target, { attributes: true, attributeFilter: ['class'] }));
  window.addEventListener('resize', () => { clampMobileDpr(); syncVisibility(); });
  window.addEventListener('orientationchange', syncVisibility);
  window.addEventListener('gone-render-scale-changed', clampMobileDpr as EventListener);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      syncVisibility();
      if (gameplayActive()) void requestWakeLock();
    } else {
      releaseTransientInput();
      void releaseWakeLock();
    }
  });
}

function snapshot(): MobileSnapshot {
  return {
    enabled: mobileCapable,
    gameplayActive: gameplayActive(),
    mapOpen: mapOpen(),
    virtualPointerLock: document.pointerLockElement === document.body,
    shimInstalled: pointerShimInstalled,
    yaw: inputState.yaw,
    pitch: inputState.pitch,
    forward: inputState.forward,
    backward: inputState.backward,
    left: inputState.left,
    right: inputState.right,
    fire: inputState.fire,
    aim: inputState.aim,
    dpr: sceneManager.renderer?.getPixelRatio?.() ?? null,
  };
}

export function startMobileRuntime(): void {
  if ((window as any).__goneMobileRuntimeStarted) return;
  (window as any).__goneMobileRuntimeStarted = true;

  if (!mobileCapable) {
    (window as any).goneMobileControls = { enabled: false, snapshot };
    return;
  }

  installVirtualPointerLock();
  createRotateHint();
  createControls();
  observeGameUi();

  for (const id of ['btn-enter', 'btn-play-multiplayer']) {
    document.getElementById(id)?.addEventListener('click', () => { void requestImmersiveMode(); }, { capture: true });
  }

  // Prevent iOS browser gestures/zoom from stealing active gameplay touches.
  document.addEventListener('touchmove', (event) => {
    if (gameplayActive() && !mapOpen()) event.preventDefault();
  }, { passive: false });
  document.addEventListener('gesturestart' as keyof DocumentEventMap, ((event: Event) => {
    if (gameplayActive()) event.preventDefault();
  }) as EventListener, { passive: false });

  syncVisibility();
  (window as any).goneMobileControls = {
    enabled: true,
    snapshot,
    pause: pauseToMenu,
    sync: syncVisibility,
  };
}

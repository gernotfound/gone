import { inputState, resetInputState } from '../controls/playerInput.ts';
import { isSmartphoneDevice } from './smartphoneProfile.ts';
import { getTouchPreferences } from './touchPreferences.ts';

type MobileControlsApi = {
  enabled?: boolean;
  sync?: () => void;
};

type TouchState = {
  movePointerId: number | null;
  lookPointerId: number | null;
  lookX: number;
  lookY: number;
};

const state: TouchState = {
  movePointerId: null,
  lookPointerId: null,
  lookX: 0,
  lookY: 0,
};

let fallbackRoot: HTMLDivElement | null = null;
let stick: HTMLDivElement | null = null;
let knob: HTMLDivElement | null = null;

function visible(id: string): boolean {
  const el = document.getElementById(id);
  if (!el || el.classList.contains('hidden')) return false;
  const style = window.getComputedStyle(el);
  return style.display !== 'none' && style.visibility !== 'hidden';
}

function gameplayActive(): boolean {
  return visible('game-ui') &&
    !visible('main-menu') &&
    !visible('settings-menu') &&
    !visible('multiplayer-lobby') &&
    !visible('death-overlay');
}

function mapOpen(): boolean {
  return visible('map-ui');
}

function releaseInputs(): void {
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
  state.movePointerId = null;
  state.lookPointerId = null;
  knob?.style.setProperty('transform', 'translate(-50%, -50%)');
  window.dispatchEvent(new MouseEvent('mouseup', { button: 0, buttons: 0, bubbles: true }));
  window.dispatchEvent(new MouseEvent('mouseup', { button: 2, buttons: 0, bubbles: true }));
}

function capture(el: Element, pointerId: number): void {
  try { (el as Element & { setPointerCapture?: (id: number) => void }).setPointerCapture?.(pointerId); } catch { /* best effort */ }
}

function dispatchKey(code: string): void {
  window.dispatchEvent(new KeyboardEvent('keydown', { code, bubbles: true, cancelable: true }));
  window.dispatchEvent(new KeyboardEvent('keyup', { code, bubbles: true, cancelable: true }));
}

function dispatchMouse(button: number, down: boolean): void {
  window.dispatchEvent(new MouseEvent(down ? 'mousedown' : 'mouseup', {
    button,
    buttons: down ? (button === 0 ? 1 : 2) : 0,
    bubbles: true,
    cancelable: true,
    view: window,
  }));
}

function bindMove(): void {
  if (!stick || !knob) return;

  const update = (clientX: number, clientY: number) => {
    if (!stick || !knob) return;
    const rect = stick.getBoundingClientRect();
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
    const dead = 0.22;
    inputState.left = nx < -dead;
    inputState.right = nx > dead;
    inputState.forward = ny < -dead;
    inputState.backward = ny > dead;
    inputState.timestamp = performance.now();
    knob.style.transform = `translate(calc(-50% + ${dx}px), calc(-50% + ${dy}px))`;
  };

  stick.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    state.movePointerId = event.pointerId;
    capture(stick!, event.pointerId);
    update(event.clientX, event.clientY);
  });

  stick.addEventListener('pointermove', (event) => {
    if (state.movePointerId !== event.pointerId) return;
    event.preventDefault();
    update(event.clientX, event.clientY);
  });

  const end = (event: PointerEvent) => {
    if (state.movePointerId !== event.pointerId) return;
    state.movePointerId = null;
    inputState.forward = inputState.backward = inputState.left = inputState.right = false;
    inputState.timestamp = performance.now();
    knob?.style.setProperty('transform', 'translate(-50%, -50%)');
  };

  stick.addEventListener('pointerup', end);
  stick.addEventListener('pointercancel', end);
}

function bindLook(): void {
  const pad = document.getElementById('mobile-look-pad') as HTMLDivElement | null;
  if (!pad) return;

  pad.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    state.lookPointerId = event.pointerId;
    state.lookX = event.clientX;
    state.lookY = event.clientY;
    capture(pad, event.pointerId);
  });

  pad.addEventListener('pointermove', (event) => {
    if (state.lookPointerId !== event.pointerId || !gameplayActive() || mapOpen()) return;
    event.preventDefault();
    const dx = event.clientX - state.lookX;
    const dy = event.clientY - state.lookY;
    state.lookX = event.clientX;
    state.lookY = event.clientY;
    const preferences = getTouchPreferences();
    const sensitivity = inputState.aim
      ? 0.003 * preferences.adsSensitivity
      : 0.0042 * preferences.lookSensitivity;
    inputState.yaw -= dx * sensitivity;
    inputState.pitch -= dy * sensitivity;
    inputState.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, inputState.pitch));
    inputState.timestamp = performance.now();
  });

  const end = (event: PointerEvent) => {
    if (state.lookPointerId === event.pointerId) state.lookPointerId = null;
  };
  pad.addEventListener('pointerup', end);
  pad.addEventListener('pointercancel', end);
}

function bindHold(id: string, onDown: () => void, onUp: () => void): void {
  const button = document.getElementById(id) as HTMLButtonElement | null;
  if (!button) return;
  let activePointer: number | null = null;

  button.addEventListener('pointerdown', (event) => {
    if (!gameplayActive() || mapOpen()) return;
    event.preventDefault();
    event.stopPropagation();
    activePointer = event.pointerId;
    capture(button, event.pointerId);
    button.classList.add('is-held');
    onDown();
  });

  const release = (event: PointerEvent) => {
    if (activePointer !== event.pointerId) return;
    activePointer = null;
    button.classList.remove('is-held');
    onUp();
  };
  button.addEventListener('pointerup', release);
  button.addEventListener('pointercancel', release);
}

function bindTap(id: string, action: () => void): void {
  document.getElementById(id)?.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
    action();
  });
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
  const api = (window as any).goneGame;
  const count = Object.keys((window as any).goneWeapons?.config ?? {}).length || 5;
  const current = Number(api?.getActiveWeaponIndex?.() ?? 0);
  api?.switchWeapon?.(((current + delta) % count + count) % count);
  window.setTimeout(updateWeaponLabel, 0);
}

function createFallbackControls(): void {
  if (document.getElementById('gone-mobile-controls')) return;

  fallbackRoot = document.createElement('div');
  fallbackRoot.id = 'gone-mobile-controls';
  fallbackRoot.className = 'hidden smartphone-fallback-controls';
  fallbackRoot.innerHTML = `
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
  document.body.appendChild(fallbackRoot);

  stick = document.getElementById('mobile-stick') as HTMLDivElement;
  knob = document.getElementById('mobile-stick-knob') as HTMLDivElement;
  bindMove();
  bindLook();
  bindHold('mc-fire', () => { inputState.fire = true; dispatchMouse(0, true); }, () => { inputState.fire = false; dispatchMouse(0, false); });
  bindHold('mc-aim', () => { inputState.aim = true; dispatchMouse(2, true); }, () => { inputState.aim = false; dispatchMouse(2, false); });
  bindHold('mc-jump', () => { inputState.jump = true; }, () => { inputState.jump = false; });
  bindHold('mc-crouch', () => { inputState.ctrl = true; }, () => { inputState.ctrl = false; });
  bindHold('mc-sprint', () => { inputState.shift = true; }, () => { inputState.shift = false; });
  bindTap('mc-reload', () => dispatchKey('KeyR'));
  bindTap('mc-map', () => dispatchKey('KeyM'));
  bindTap('mc-prev', () => switchWeapon(-1));
  bindTap('mc-next', () => switchWeapon(1));
  bindTap('mc-menu', () => {
    releaseInputs();
    resetInputState();
    document.dispatchEvent(new Event('pointerlockchange'));
  });
}

function syncFallbackVisibility(): void {
  if (!fallbackRoot) return;
  const active = gameplayActive();
  fallbackRoot.classList.toggle('hidden', !active);
  fallbackRoot.classList.toggle('map-open', active && mapOpen());
  if (active) updateWeaponLabel();
  else releaseInputs();
}

export function startSmartphoneControlsGuard(): void {
  if ((window as any).__goneSmartphoneControlsGuardStarted) return;
  (window as any).__goneSmartphoneControlsGuardStarted = true;
  if (!isSmartphoneDevice()) return;

  const primary = (window as any).goneMobileControls as MobileControlsApi | undefined;
  if (primary?.enabled === true) {
    primary.sync?.();
    return;
  }

  console.warn('[Mobile] Primary touch runtime unavailable on a smartphone; enabling fallback controls.');
  createFallbackControls();
  syncFallbackVisibility();

  const observer = new MutationObserver(syncFallbackVisibility);
  for (const id of ['game-ui', 'map-ui', 'main-menu', 'settings-menu', 'multiplayer-lobby', 'death-overlay']) {
    const el = document.getElementById(id);
    if (el) observer.observe(el, { attributes: true, attributeFilter: ['class', 'style'] });
  }

  window.addEventListener('resize', syncFallbackVisibility, { passive: true });
  window.addEventListener('orientationchange', syncFallbackVisibility, { passive: true });
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') syncFallbackVisibility();
    else releaseInputs();
  });

  (window as any).goneMobileControls = {
    enabled: true,
    fallback: true,
    sync: syncFallbackVisibility,
    snapshot: () => ({ enabled: true, fallback: true, gameplayActive: gameplayActive(), mapOpen: mapOpen() }),
  };
}

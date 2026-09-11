import * as THREE from 'three';
import {
  WEAPON_KEYS,
  WEAPON_RUNTIME,
  getWeaponRuntime,
  type WeaponKey,
  type WeaponRuntimeConfig,
} from '../weapons/weaponConfig.ts';

type AmmoState = { magazine: number; reserve: number };
type GoneGameApi = {
  fireWeapon?: () => void;
  switchWeapon?: (index: number) => void;
  getActiveWeapon?: () => string;
  getActiveWeaponIndex?: () => number;
  getShotCooldown?: () => number;
  viewmodelRoot?: THREE.Group;
  player?: { isAlive?: boolean };
  keys?: { yaw: number; pitch: number; timestamp: number };
  vfxManager?: { spawnTracer: (start: THREE.Vector3, end: THREE.Vector3, weapon: string) => void };
};

const HIP_FOV = 75;
const BASE_MOUSE_SENSITIVITY = 0.002;
const ammo: Record<WeaponKey, AmmoState> = Object.fromEntries(
  WEAPON_KEYS.map((key) => [key, {
    magazine: WEAPON_RUNTIME[key].magazineSize,
    reserve: WEAPON_RUNTIME[key].reserveAmmo,
  }]),
) as Record<WeaponKey, AmmoState>;

let rig: THREE.Group | null = null;
let triggerHeld = false;
let adsHeld = false;
let adsAlpha = 0;
let currentWeapon: WeaponKey = 'assalto';
let lastShotAt = -10000;
let actionImpulse = 0;
let wasAlive = true;
let reloadActive = false;
let reloadStartedAt = 0;
let reloadEndsAt = 0;
let nextShellAt = 0;
let reloadWeapon: WeaponKey = 'assalto';
let emptyReloadTimer: number | null = null;
let reticleRoot: HTMLDivElement | null = null;
let scopeOverlay: HTMLDivElement | null = null;
let ammoHud: HTMLDivElement | null = null;
let ammoPrimary: HTMLDivElement | null = null;
let ammoSecondary: HTMLDivElement | null = null;
let lastUiSignature = '';

const targetPosition = new THREE.Vector3();
const targetRotation = new THREE.Euler();
const tracerDelta = new THREE.Vector3();
const tracerEnd = new THREE.Vector3();

function api(): GoneGameApi | null {
  return (window as any).goneGame ?? null;
}

function isGameplayInputActive(): boolean {
  const gameUi = document.getElementById('game-ui');
  return document.pointerLockElement === document.body && !!gameUi && !gameUi.classList.contains('hidden');
}

function sanitizeWeapon(value: unknown): WeaponKey {
  const key = String(value ?? 'assalto') as WeaponKey;
  return WEAPON_KEYS.includes(key) ? key : 'assalto';
}

function resetAmmo(): void {
  for (const key of WEAPON_KEYS) {
    ammo[key].magazine = WEAPON_RUNTIME[key].magazineSize;
    ammo[key].reserve = WEAPON_RUNTIME[key].reserveAmmo;
  }
  cancelReload();
  refreshHud(true);
}

function cancelReload(): void {
  reloadActive = false;
  reloadStartedAt = 0;
  reloadEndsAt = 0;
  nextShellAt = 0;
  if (emptyReloadTimer !== null) {
    window.clearTimeout(emptyReloadTimer);
    emptyReloadTimer = null;
  }
}

function startReload(): void {
  const cfg = WEAPON_RUNTIME[currentWeapon];
  const state = ammo[currentWeapon];
  if (cfg.reloadStyle === 'none' || cfg.magazineSize <= 0) return;
  if (reloadActive || state.magazine >= cfg.magazineSize || state.reserve <= 0) return;

  triggerHeld = false;
  adsHeld = false;
  reloadActive = true;
  reloadWeapon = currentWeapon;
  reloadStartedAt = performance.now();
  reloadEndsAt = reloadStartedAt + cfg.reloadSeconds * 1000;
  nextShellAt = reloadEndsAt;
  refreshHud(true);
}

function finishMagazineReload(cfg: WeaponRuntimeConfig): void {
  const state = ammo[cfg.key];
  const needed = Math.max(0, cfg.magazineSize - state.magazine);
  const moved = Math.min(needed, state.reserve);
  state.magazine += moved;
  state.reserve -= moved;
  reloadActive = false;
  refreshHud(true);
}

function updateReload(now: number): void {
  if (!reloadActive) return;
  if (reloadWeapon !== currentWeapon) {
    cancelReload();
    return;
  }

  const cfg = WEAPON_RUNTIME[reloadWeapon];
  const state = ammo[reloadWeapon];
  if (cfg.reloadStyle === 'magazine') {
    if (now >= reloadEndsAt) finishMagazineReload(cfg);
    return;
  }

  if (cfg.reloadStyle === 'shell' && now >= nextShellAt) {
    if (state.magazine < cfg.magazineSize && state.reserve > 0) {
      state.magazine += 1;
      state.reserve -= 1;
      reloadStartedAt = now;
      nextShellAt = now + cfg.reloadSeconds * 1000;
      reloadEndsAt = nextShellAt;
      refreshHud(true);
    }
    if (state.magazine >= cfg.magazineSize || state.reserve <= 0) reloadActive = false;
  }
}

function scheduleEmptyReload(weapon: WeaponKey): void {
  if (emptyReloadTimer !== null) window.clearTimeout(emptyReloadTimer);
  emptyReloadTimer = window.setTimeout(() => {
    emptyReloadTimer = null;
    if (currentWeapon === weapon && ammo[weapon].magazine === 0) startReload();
  }, 180);
}

function attemptFire(): void {
  const game = api();
  if (!game?.fireWeapon || !isGameplayInputActive() || game.player?.isAlive === false) return;

  const cfg = WEAPON_RUNTIME[currentWeapon];
  const state = ammo[currentWeapon];
  if (reloadActive) {
    if (cfg.reloadStyle === 'shell' && state.magazine > 0) cancelReload();
    else return;
  }
  if (cfg.magazineSize > 0 && state.magazine <= 0) {
    startReload();
    return;
  }

  const before = game.getShotCooldown?.() ?? 0;
  if (before > 0.0001) return;
  game.fireWeapon();
  const after = game.getShotCooldown?.() ?? 0;
  if (after <= before && after <= 0.0001) return;

  if (cfg.magazineSize > 0) state.magazine = Math.max(0, state.magazine - 1);
  lastShotAt = performance.now();
  actionImpulse = 1;
  refreshHud(true);
  if (cfg.magazineSize > 0 && state.magazine === 0 && state.reserve > 0) scheduleEmptyReload(currentWeapon);
}

function ensureRig(): void {
  const root = api()?.viewmodelRoot;
  if (!root?.parent) return;
  if (!rig) {
    rig = new THREE.Group();
    rig.name = 'AdvancedWeaponRig';
  }
  if (root.parent !== rig) {
    const parent = root.parent;
    parent.add(rig);
    rig.add(root);
  }
}

function updateRig(delta: number, now: number): void {
  ensureRig();
  if (!rig) return;
  const cfg = WEAPON_RUNTIME[currentWeapon];
  const adsTarget = adsHeld && !reloadActive ? 1 : 0;
  adsAlpha = THREE.MathUtils.lerp(adsAlpha, adsTarget, Math.min(1, delta * 13));

  targetPosition.set(cfg.adsRigX * adsAlpha, cfg.adsRigY * adsAlpha, cfg.adsRigZ * adsAlpha);
  targetRotation.set(0, 0, 0);

  if (reloadActive) {
    const span = Math.max(1, reloadEndsAt - reloadStartedAt);
    const phase = Math.max(0, Math.min(1, (now - reloadStartedAt) / span));
    const arc = Math.sin(phase * Math.PI);
    if (cfg.reloadStyle === 'shell') {
      targetPosition.y -= 0.13 * arc;
      targetPosition.x += 0.055 * arc;
      targetRotation.z += 0.16 * arc;
      targetRotation.x += 0.08 * arc;
    } else {
      targetPosition.y -= 0.28 * arc;
      targetPosition.x += 0.12 * arc;
      targetPosition.z += 0.10 * arc;
      targetRotation.z += 0.34 * arc;
      targetRotation.x += 0.16 * arc;
    }
  }

  const sinceShot = (now - lastShotAt) / 1000;
  actionImpulse *= Math.exp(-delta * 14);
  if (currentWeapon === 'cecchino' && sinceShot < 0.62) {
    const bolt = Math.sin(Math.min(1, sinceShot / 0.62) * Math.PI);
    targetPosition.z += 0.11 * bolt;
    targetRotation.z -= 0.06 * bolt;
  } else if (currentWeapon === 'pompa' && sinceShot < 0.48) {
    const pump = Math.sin(Math.min(1, sinceShot / 0.48) * Math.PI);
    targetPosition.z += 0.14 * pump;
    targetRotation.x += 0.08 * pump;
  } else if (currentWeapon === 'coltello' && sinceShot < 0.42) {
    const slash = Math.sin(Math.min(1, sinceShot / 0.42) * Math.PI);
    targetPosition.x -= 0.19 * slash;
    targetPosition.z -= 0.08 * slash;
    targetRotation.z -= 0.72 * slash;
    targetRotation.y += 0.32 * slash;
  } else {
    targetPosition.z += actionImpulse * 0.018;
  }

  rig.position.lerp(targetPosition, Math.min(1, delta * 18));
  rig.rotation.x = THREE.MathUtils.lerp(rig.rotation.x, targetRotation.x, Math.min(1, delta * 18));
  rig.rotation.y = THREE.MathUtils.lerp(rig.rotation.y, targetRotation.y, Math.min(1, delta * 18));
  rig.rotation.z = THREE.MathUtils.lerp(rig.rotation.z, targetRotation.z, Math.min(1, delta * 18));

  const camera = rig.parent as THREE.PerspectiveCamera | null;
  if (camera?.isPerspectiveCamera) {
    const targetFov = THREE.MathUtils.lerp(HIP_FOV, cfg.adsFov, adsAlpha);
    if (Math.abs(camera.fov - targetFov) > 0.01) {
      camera.fov = THREE.MathUtils.lerp(camera.fov, targetFov, Math.min(1, delta * 15));
      camera.updateProjectionMatrix();
    }
  }
}

function ensureUi(): void {
  const gameUi = document.getElementById('game-ui');
  if (!gameUi) return;
  if (!reticleRoot) {
    reticleRoot = document.createElement('div');
    reticleRoot.id = 'advanced-weapon-reticle';
    Object.assign(reticleRoot.style, {
      position: 'fixed', left: '50%', top: '50%', width: '70px', height: '70px',
      transform: 'translate(-50%, -50%)', pointerEvents: 'none', zIndex: '28',
    });
    gameUi.appendChild(reticleRoot);
  }
  if (!scopeOverlay) {
    scopeOverlay = document.createElement('div');
    scopeOverlay.id = 'sniper-scope-overlay';
    Object.assign(scopeOverlay.style, {
      position: 'fixed', inset: '0', pointerEvents: 'none', zIndex: '27', opacity: '0',
      transition: 'opacity 100ms linear',
      background: 'radial-gradient(circle at 50% 50%, transparent 0 19%, rgba(0,0,0,.12) 19.3%, rgba(0,0,0,.94) 20.2%, rgba(0,0,0,.995) 55%)',
    });
    gameUi.appendChild(scopeOverlay);
  }
  if (!ammoHud) {
    ammoHud = document.createElement('div');
    ammoHud.id = 'advanced-weapon-hud';
    Object.assign(ammoHud.style, {
      position: 'fixed', right: '32px', bottom: '92px', zIndex: '26', pointerEvents: 'none',
      minWidth: '235px', padding: '10px 13px', border: '1px solid rgba(34,211,238,.35)',
      borderRadius: '12px', background: 'rgba(2,6,23,.72)', backdropFilter: 'blur(8px)',
      fontFamily: 'ui-monospace, SFMono-Regular, Menlo, monospace', textAlign: 'right',
    });
    ammoPrimary = document.createElement('div');
    ammoSecondary = document.createElement('div');
    ammoHud.append(ammoPrimary, ammoSecondary);
    gameUi.appendChild(ammoHud);
  }
  const originalCrosshair = gameUi.firstElementChild as HTMLElement | null;
  if (originalCrosshair && originalCrosshair !== reticleRoot && originalCrosshair !== scopeOverlay && originalCrosshair !== ammoHud) {
    originalCrosshair.style.opacity = '0';
  }
}

function reticleHtml(cfg: WeaponRuntimeConfig, aimed: boolean): string {
  const color = cfg.key === 'pompa' ? '#ff7a18' : cfg.key === 'mitraglietta' ? '#ffe600' : cfg.key === 'cecchino' ? '#d946ef' : '#22d3ee';
  const glow = `drop-shadow(0 0 5px ${color})`;
  const line = `position:absolute;background:${color};filter:${glow};border-radius:2px;`;
  if (cfg.key === 'cecchino' && aimed) {
    return `<span style="${line}left:34px;top:0;width:1px;height:70px;opacity:.9"></span><span style="${line}left:0;top:34px;width:70px;height:1px;opacity:.9"></span><span style="position:absolute;left:31px;top:31px;width:8px;height:8px;border:1px solid ${color};border-radius:50%;filter:${glow}"></span>`;
  }
  if (cfg.key === 'pompa') {
    const size = aimed ? 24 : 40;
    const offset = (70 - size) / 2;
    return `<span style="position:absolute;left:${offset}px;top:${offset}px;width:${size}px;height:${size}px;border:2px solid ${color};border-radius:50%;filter:${glow};opacity:.85"></span><span style="position:absolute;left:33px;top:33px;width:4px;height:4px;background:${color};border-radius:50%;filter:${glow}"></span>`;
  }
  if (cfg.key === 'coltello') {
    const spread = aimed ? 5 : 10;
    return `<span style="${line}left:${23 + spread / 2}px;top:34px;width:${24 - spread}px;height:2px;transform:rotate(-35deg)"></span><span style="${line}left:33px;top:${24 + spread / 2}px;width:2px;height:${22 - spread}px;transform:rotate(-35deg)"></span>`;
  }
  const gap = cfg.key === 'mitraglietta' && !aimed ? 8 : aimed ? 4 : 6;
  return `<span style="${line}left:34px;top:${12 + gap}px;width:2px;height:${16 - gap}px"></span><span style="${line}left:34px;bottom:${12 + gap}px;width:2px;height:${16 - gap}px"></span><span style="${line}top:34px;left:${12 + gap}px;height:2px;width:${16 - gap}px"></span><span style="${line}top:34px;right:${12 + gap}px;height:2px;width:${16 - gap}px"></span><span style="position:absolute;left:32px;top:32px;width:6px;height:6px;background:${color};border-radius:50%;filter:${glow}"></span>`;
}

function refreshHud(force = false): void {
  ensureUi();
  const cfg = WEAPON_RUNTIME[currentWeapon];
  const state = ammo[currentWeapon];
  const now = performance.now();
  const remaining = reloadActive ? Math.max(0, reloadEndsAt - now) / 1000 : 0;
  const signature = `${currentWeapon}:${state.magazine}:${state.reserve}:${reloadActive}:${remaining.toFixed(1)}:${adsAlpha.toFixed(1)}`;
  if (!force && signature === lastUiSignature) return;
  lastUiSignature = signature;

  if (reticleRoot) reticleRoot.innerHTML = reticleHtml(cfg, adsAlpha > 0.45);
  if (scopeOverlay) scopeOverlay.style.opacity = currentWeapon === 'cecchino' && adsAlpha > 0.55 ? String(Math.min(1, (adsAlpha - 0.55) * 2.3)) : '0';
  if (ammoPrimary) {
    ammoPrimary.style.cssText = 'font-size:22px;font-weight:900;color:#e2e8f0;letter-spacing:.05em;';
    ammoPrimary.textContent = cfg.reloadStyle === 'none' ? '∞  MELEE' : `${state.magazine.toString().padStart(2, '0')} / ${state.reserve}`;
  }
  if (ammoSecondary) {
    ammoSecondary.style.cssText = `font-size:11px;font-weight:800;margin-top:3px;letter-spacing:.12em;color:${reloadActive ? '#fbbf24' : '#67e8f9'};`;
    ammoSecondary.textContent = reloadActive
      ? `RICARICA ${remaining.toFixed(1)}s · ${cfg.reloadStyle === 'shell' ? 'CARTUCCIA' : 'CARICATORE'}`
      : `${cfg.role} · PORTATA ${cfg.maxRange}m · RMB MIRA · R RICARICA`;
  }
}

function installTracerRangeClamp(): void {
  const vfx = api()?.vfxManager as any;
  if (!vfx || vfx.__weaponRangeClampInstalled || typeof vfx.spawnTracer !== 'function') return;
  const original = vfx.spawnTracer.bind(vfx);
  vfx.spawnTracer = (start: THREE.Vector3, end: THREE.Vector3, weapon: string) => {
    const cfg = getWeaponRuntime(weapon);
    tracerDelta.subVectors(end, start);
    const length = tracerDelta.length();
    if (length > cfg.maxRange && length > 0.0001) {
      tracerEnd.copy(start).addScaledVector(tracerDelta, cfg.maxRange / length);
      original(start, tracerEnd, weapon);
    } else {
      original(start, end, weapon);
    }
  };
  vfx.__weaponRangeClampInstalled = true;
}

function updateWeaponSelection(): void {
  const next = sanitizeWeapon(api()?.getActiveWeapon?.());
  if (next === currentWeapon) return;
  currentWeapon = next;
  cancelReload();
  triggerHeld = false;
  adsHeld = false;
  refreshHud(true);
}

let previousFrameAt = 0;
function animationLoop(now: number): void {
  const game = api();
  updateWeaponSelection();
  installTracerRangeClamp();
  updateReload(now);
  const alive = game?.player?.isAlive !== false;
  if (alive && !wasAlive) resetAmmo();
  wasAlive = alive;
  if (triggerHeld && WEAPON_RUNTIME[currentWeapon].automatic) attemptFire();

  const delta = Math.min(0.05, previousFrameAt > 0 ? (now - previousFrameAt) / 1000 : 1 / 60);
  previousFrameAt = now;
  updateRig(delta, now);
  refreshHud();
  window.requestAnimationFrame(animationLoop);
}

function installInputOverrides(): void {
  window.addEventListener('mousedown', (event) => {
    if (!isGameplayInputActive()) return;
    if (event.button === 0) {
      event.preventDefault();
      event.stopImmediatePropagation();
      triggerHeld = true;
      attemptFire();
    } else if (event.button === 2) {
      event.preventDefault();
      adsHeld = true;
    }
  }, true);

  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) {
      if (isGameplayInputActive()) event.stopImmediatePropagation();
      triggerHeld = false;
    } else if (event.button === 2) {
      adsHeld = false;
    }
  }, true);

  window.addEventListener('mousemove', (event) => {
    if (!isGameplayInputActive()) return;
    const keys = api()?.keys;
    if (!keys) return;
    event.stopImmediatePropagation();
    const cfg = WEAPON_RUNTIME[currentWeapon];
    const sensitivity = BASE_MOUSE_SENSITIVITY * (adsHeld ? cfg.adsSensitivity : 1);
    keys.yaw -= event.movementX * sensitivity;
    keys.pitch -= event.movementY * sensitivity;
    keys.pitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, keys.pitch));
    keys.timestamp = performance.now();
  }, true);

  window.addEventListener('keydown', (event) => {
    if (!isGameplayInputActive()) return;
    if (event.code === 'KeyR' && !event.repeat) {
      event.preventDefault();
      event.stopImmediatePropagation();
      startReload();
    }
  }, true);

  window.addEventListener('blur', () => {
    triggerHeld = false;
    adsHeld = false;
  });
  window.addEventListener('contextmenu', (event) => {
    if (document.pointerLockElement === document.body) event.preventDefault();
  });
}

export function startAdvancedWeaponController(): void {
  if ((window as any).__goneAdvancedWeaponsStarted) return;
  (window as any).__goneAdvancedWeaponsStarted = true;
  installInputOverrides();
  ensureUi();
  refreshHud(true);
  (window as any).goneWeapons = {
    ammo,
    reload: startReload,
    isReloading: () => reloadActive,
    isAiming: () => adsHeld,
    config: WEAPON_RUNTIME,
  };
  window.requestAnimationFrame(animationLoop);
}

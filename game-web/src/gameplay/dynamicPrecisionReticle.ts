import { WEAPON_KEYS, type WeaponKey } from '../weapons/weaponConfig.ts';

type Vec3Like = { x?: number; y?: number; z?: number };
type PlayerLike = {
  isAlive?: boolean;
  isGrounded?: boolean;
  velocity?: Vec3Like;
};
type InputLike = {
  forward?: boolean;
  backward?: boolean;
  left?: boolean;
  right?: boolean;
  shift?: boolean;
  ctrl?: boolean;
};
type GameApi = {
  getActiveWeapon?: () => string;
  player?: PlayerLike;
  keys?: InputLike;
};
type WeaponsApi = {
  ammo?: Record<string, { magazine?: number }>;
  isAiming?: () => boolean;
  isReloading?: () => boolean;
};

type ReticleProfile = {
  hipGap: number;
  adsGap: number;
  maxGap: number;
  movePenalty: number;
  sprintPenalty: number;
  airPenalty: number;
  shotKick: number;
  recovery: number;
  lineLength: number;
  color: string;
};

const CENTER = 45;
const RETICLE_SIZE = 90;
const BASE_MOVE_SPEED = 12;

const PROFILES: Record<WeaponKey, ReticleProfile> = {
  assalto: {
    hipGap: 6,
    adsGap: 2.8,
    maxGap: 27,
    movePenalty: 7,
    sprintPenalty: 6,
    airPenalty: 10,
    shotKick: 4.8,
    recovery: 20,
    lineLength: 11,
    color: '#22d3ee',
  },
  cecchino: {
    hipGap: 11,
    adsGap: 1.5,
    maxGap: 36,
    movePenalty: 10,
    sprintPenalty: 9,
    airPenalty: 14,
    shotKick: 12,
    recovery: 15,
    lineLength: 14,
    color: '#d946ef',
  },
  pompa: {
    hipGap: 13,
    adsGap: 8,
    maxGap: 30,
    movePenalty: 6,
    sprintPenalty: 6,
    airPenalty: 9,
    shotKick: 4,
    recovery: 18,
    lineLength: 10,
    color: '#ff7a18',
  },
  mitraglietta: {
    hipGap: 8,
    adsGap: 4,
    maxGap: 31,
    movePenalty: 9,
    sprintPenalty: 7,
    airPenalty: 11,
    shotKick: 3.2,
    recovery: 24,
    lineLength: 9,
    color: '#ffe600',
  },
  coltello: {
    hipGap: 8,
    adsGap: 6,
    maxGap: 18,
    movePenalty: 2,
    sprintPenalty: 2,
    airPenalty: 3,
    shotKick: 1,
    recovery: 24,
    lineLength: 10,
    color: '#22d3ee',
  },
};

let root: HTMLDivElement | null = null;
let dot: HTMLDivElement | null = null;
let topArm: HTMLDivElement | null = null;
let bottomArm: HTMLDivElement | null = null;
let leftArm: HTMLDivElement | null = null;
let rightArm: HTMLDivElement | null = null;
let shotgunRing: HTMLDivElement | null = null;

let currentGap = PROFILES.assalto.hipGap;
let bloom = 0;
let previousFrameAt = 0;
let previousWeapon: WeaponKey = 'assalto';
let previousMagazine: number | null = null;

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

function sanitizeWeapon(value: unknown): WeaponKey {
  const key = String(value ?? 'assalto') as WeaponKey;
  return WEAPON_KEYS.includes(key) ? key : 'assalto';
}

function gameApi(): GameApi | null {
  return (window as any).goneGame ?? null;
}

function weaponsApi(): WeaponsApi | null {
  return (window as any).goneWeapons ?? null;
}

function makeArm(): HTMLDivElement {
  const element = document.createElement('div');
  Object.assign(element.style, {
    position: 'absolute',
    borderRadius: '2px',
    pointerEvents: 'none',
    willChange: 'left,top,width,height',
  });
  return element;
}

function ensureDom(): boolean {
  const gameUi = document.getElementById('game-ui');
  if (!gameUi) return false;
  if (root?.isConnected) return true;

  root = document.createElement('div');
  root.id = 'dynamic-precision-reticle';
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'fixed',
    left: '50%',
    top: '50%',
    width: `${RETICLE_SIZE}px`,
    height: `${RETICLE_SIZE}px`,
    transform: 'translate(-50%, -50%)',
    pointerEvents: 'none',
    zIndex: '29',
  });

  topArm = makeArm();
  bottomArm = makeArm();
  leftArm = makeArm();
  rightArm = makeArm();

  dot = document.createElement('div');
  Object.assign(dot.style, {
    position: 'absolute',
    width: '5px',
    height: '5px',
    left: `${CENTER - 2.5}px`,
    top: `${CENTER - 2.5}px`,
    borderRadius: '50%',
    pointerEvents: 'none',
  });

  shotgunRing = document.createElement('div');
  Object.assign(shotgunRing.style, {
    position: 'absolute',
    border: '2px solid',
    borderRadius: '50%',
    pointerEvents: 'none',
    boxSizing: 'border-box',
  });

  root.append(topArm, bottomArm, leftArm, rightArm, shotgunRing, dot);
  gameUi.appendChild(root);
  return true;
}

function updateShotBloom(weapon: WeaponKey, profile: ReticleProfile): void {
  const magazine = weaponsApi()?.ammo?.[weapon]?.magazine;
  if (!Number.isFinite(magazine)) {
    previousMagazine = null;
    previousWeapon = weapon;
    return;
  }

  const currentMagazine = Number(magazine);
  if (weapon !== previousWeapon) {
    previousWeapon = weapon;
    previousMagazine = currentMagazine;
    bloom *= 0.35;
    return;
  }

  if (previousMagazine !== null && currentMagazine < previousMagazine) {
    const shots = Math.max(1, previousMagazine - currentMagazine);
    bloom = Math.min(profile.maxGap, bloom + profile.shotKick * shots);
  }
  previousMagazine = currentMagazine;
}

function calculateTargetGap(weapon: WeaponKey, aiming: boolean): number {
  const profile = PROFILES[weapon];
  const game = gameApi();
  const player = game?.player;
  const keys = game?.keys;
  const velocity = player?.velocity;
  const horizontalSpeed = Math.hypot(Number(velocity?.x ?? 0), Number(velocity?.z ?? 0));
  const hasMoveInput = !!(keys?.forward || keys?.backward || keys?.left || keys?.right);

  let movementFactor = clamp(horizontalSpeed / BASE_MOVE_SPEED, 0, 1);
  if (hasMoveInput && movementFactor < 0.2) movementFactor = 0.2;

  const sprinting = !!keys?.shift && (hasMoveInput || horizontalSpeed > 1);
  const airborne = player?.isGrounded === false;
  const crouching = !!keys?.ctrl;
  const adsFactor = aiming ? 0.42 : 1;
  const stanceFactor = crouching ? 0.78 : 1;

  const base = aiming ? profile.adsGap : profile.hipGap;
  let dynamicPenalty = movementFactor * profile.movePenalty;
  if (sprinting) dynamicPenalty += profile.sprintPenalty;
  if (airborne) dynamicPenalty += profile.airPenalty;
  dynamicPenalty *= adsFactor * stanceFactor;

  const shotPenalty = bloom * (aiming ? 0.68 : 1);
  return clamp(base + dynamicPenalty + shotPenalty, 1.5, profile.maxGap);
}

function applyColor(element: HTMLElement | null, color: string): void {
  if (!element) return;
  element.style.background = color;
  element.style.filter = `drop-shadow(0 0 5px ${color})`;
}

function renderCross(profile: ReticleProfile, gap: number): void {
  if (!topArm || !bottomArm || !leftArm || !rightArm || !shotgunRing || !dot) return;
  const length = profile.lineLength;

  shotgunRing.style.display = 'none';
  for (const arm of [topArm, bottomArm, leftArm, rightArm]) arm.style.display = 'block';

  topArm.style.left = `${CENTER - 1}px`;
  topArm.style.top = `${CENTER - gap - length}px`;
  topArm.style.width = '2px';
  topArm.style.height = `${length}px`;

  bottomArm.style.left = `${CENTER - 1}px`;
  bottomArm.style.top = `${CENTER + gap}px`;
  bottomArm.style.width = '2px';
  bottomArm.style.height = `${length}px`;

  leftArm.style.left = `${CENTER - gap - length}px`;
  leftArm.style.top = `${CENTER - 1}px`;
  leftArm.style.width = `${length}px`;
  leftArm.style.height = '2px';

  rightArm.style.left = `${CENTER + gap}px`;
  rightArm.style.top = `${CENTER - 1}px`;
  rightArm.style.width = `${length}px`;
  rightArm.style.height = '2px';

  applyColor(topArm, profile.color);
  applyColor(bottomArm, profile.color);
  applyColor(leftArm, profile.color);
  applyColor(rightArm, profile.color);
  applyColor(dot, profile.color);
}

function renderShotgun(profile: ReticleProfile, gap: number): void {
  if (!topArm || !bottomArm || !leftArm || !rightArm || !shotgunRing || !dot) return;
  for (const arm of [topArm, bottomArm, leftArm, rightArm]) arm.style.display = 'none';

  const radius = clamp(gap + 3, 9, 34);
  const diameter = radius * 2;
  shotgunRing.style.display = 'block';
  shotgunRing.style.left = `${CENTER - radius}px`;
  shotgunRing.style.top = `${CENTER - radius}px`;
  shotgunRing.style.width = `${diameter}px`;
  shotgunRing.style.height = `${diameter}px`;
  shotgunRing.style.borderColor = profile.color;
  shotgunRing.style.filter = `drop-shadow(0 0 5px ${profile.color})`;
  applyColor(dot, profile.color);
}

function updateVisibility(weapon: WeaponKey, aiming: boolean): boolean {
  if (!root) return false;
  const gameUi = document.getElementById('game-ui');
  const original = document.getElementById('advanced-weapon-reticle') as HTMLElement | null;
  const gameplayVisible = !!gameUi && !gameUi.classList.contains('hidden');
  const useDynamic = gameplayVisible && weapon !== 'coltello' && !(weapon === 'cecchino' && aiming);

  root.style.display = useDynamic ? 'block' : 'none';
  if (original) original.style.opacity = useDynamic ? '0' : '1';
  return useDynamic;
}

function frame(now: number): void {
  if (!ensureDom()) {
    window.requestAnimationFrame(frame);
    return;
  }

  const delta = clamp(previousFrameAt > 0 ? (now - previousFrameAt) / 1000 : 1 / 60, 0, 0.05);
  previousFrameAt = now;

  const game = gameApi();
  const weapon = sanitizeWeapon(game?.getActiveWeapon?.());
  const profile = PROFILES[weapon];
  const aiming = weaponsApi()?.isAiming?.() === true;
  const reloading = weaponsApi()?.isReloading?.() === true;

  updateShotBloom(weapon, profile);
  bloom = Math.max(0, bloom - profile.recovery * delta);

  const targetGap = calculateTargetGap(weapon, aiming);
  const smoothing = 1 - Math.exp(-13 * delta);
  currentGap += (targetGap - currentGap) * smoothing;

  if (updateVisibility(weapon, aiming) && root) {
    root.style.opacity = reloading || game?.player?.isAlive === false ? '0.45' : '1';
    if (weapon === 'pompa') renderShotgun(profile, currentGap);
    else renderCross(profile, currentGap);

    const accuracy = 1 - clamp((currentGap - profile.adsGap) / Math.max(1, profile.maxGap - profile.adsGap), 0, 1);
    root.dataset.accuracy = accuracy.toFixed(3);
    root.dataset.gap = currentGap.toFixed(2);
    root.dataset.weapon = weapon;
  }

  window.requestAnimationFrame(frame);
}

/**
 * FPS-style precision reticle. Gap expands with movement, sprinting, airborne
 * state and repeated fire, then contracts smoothly while stationary/ADS.
 * The centre dot never moves; only the four arms (or shotgun ring) represent
 * current aiming stability.
 */
export function startDynamicPrecisionReticle(): void {
  if ((window as any).__goneDynamicPrecisionReticleStarted) return;
  (window as any).__goneDynamicPrecisionReticleStarted = true;
  ensureDom();
  window.requestAnimationFrame(frame);
}

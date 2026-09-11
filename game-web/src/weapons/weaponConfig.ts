export type WeaponKey = 'assalto' | 'cecchino' | 'pompa' | 'mitraglietta' | 'coltello';
export type ReloadStyle = 'magazine' | 'shell' | 'none';

export interface WeaponRuntimeConfig {
  id: number;
  key: WeaponKey;
  displayName: string;
  role: string;
  automatic: boolean;
  fireRateRps: number;
  maxRange: number;
  falloffStart: number;
  falloffEnd: number;
  bodyDamage: number;
  minDamage: number;
  headshotMultiplier: number;
  magazineSize: number;
  reserveAmmo: number;
  reloadSeconds: number;
  reloadStyle: ReloadStyle;
  adsFov: number;
  adsSensitivity: number;
  adsRigX: number;
  adsRigY: number;
  adsRigZ: number;
  hipReticle: string;
  adsReticle: string;
  spreadBaseRad: number;
  spreadMaxRad: number;
}

/**
 * Runtime weapon contract shared by browser combat validation, weapon UX and
 * reticle-driven hitscan spread. Distances are metres, times are seconds and
 * spread values are cone half-angles in radians.
 */
export const WEAPON_RUNTIME: Record<WeaponKey, WeaponRuntimeConfig> = {
  assalto: {
    id: 0,
    key: 'assalto',
    displayName: 'AR-42 Viper',
    role: 'FUCILE D’ASSALTO',
    automatic: true,
    fireRateRps: 6.25,
    maxRange: 180,
    falloffStart: 35,
    falloffEnd: 140,
    bodyDamage: 18,
    minDamage: 10,
    headshotMultiplier: 1.5,
    magazineSize: 30,
    reserveAmmo: 120,
    reloadSeconds: 2.15,
    reloadStyle: 'magazine',
    adsFov: 58,
    adsSensitivity: 0.72,
    adsRigX: -0.115,
    adsRigY: 0.055,
    adsRigZ: -0.035,
    hipReticle: 'cross',
    adsReticle: 'dot-ring',
    spreadBaseRad: 0.0035,
    spreadMaxRad: 0.045,
  },
  cecchino: {
    id: 1,
    key: 'cecchino',
    displayName: 'SR-99 Railphantom',
    role: 'FUCILE DI PRECISIONE',
    automatic: false,
    fireRateRps: 1,
    maxRange: 550,
    falloffStart: 180,
    falloffEnd: 450,
    bodyDamage: 70,
    minDamage: 50,
    headshotMultiplier: 2,
    magazineSize: 5,
    reserveAmmo: 25,
    reloadSeconds: 2.85,
    reloadStyle: 'magazine',
    adsFov: 24,
    adsSensitivity: 0.34,
    adsRigX: -0.215,
    adsRigY: 0.085,
    adsRigZ: -0.08,
    hipReticle: 'precision',
    adsReticle: 'scope',
    spreadBaseRad: 0.00035,
    spreadMaxRad: 0.075,
  },
  pompa: {
    id: 2,
    key: 'pompa',
    displayName: 'SG-12 Havoc',
    role: 'FUCILE A POMPA',
    automatic: false,
    fireRateRps: 1.25,
    maxRange: 42,
    falloffStart: 8,
    falloffEnd: 30,
    bodyDamage: 64,
    minDamage: 20,
    headshotMultiplier: 1.25,
    magazineSize: 6,
    reserveAmmo: 30,
    reloadSeconds: 0.68,
    reloadStyle: 'shell',
    adsFov: 62,
    adsSensitivity: 0.76,
    adsRigX: -0.105,
    adsRigY: 0.045,
    adsRigZ: -0.025,
    hipReticle: 'shotgun',
    adsReticle: 'shotgun-tight',
    spreadBaseRad: 0.045,
    spreadMaxRad: 0.11,
  },
  mitraglietta: {
    id: 3,
    key: 'mitraglietta',
    displayName: 'SMG-7 Neon Hornet',
    role: 'MITRAGLIETTA',
    automatic: true,
    fireRateRps: 10,
    maxRange: 90,
    falloffStart: 15,
    falloffEnd: 65,
    bodyDamage: 12,
    minDamage: 7,
    headshotMultiplier: 1.5,
    magazineSize: 36,
    reserveAmmo: 180,
    reloadSeconds: 1.85,
    reloadStyle: 'magazine',
    adsFov: 60,
    adsSensitivity: 0.78,
    adsRigX: -0.10,
    adsRigY: 0.045,
    adsRigZ: -0.02,
    hipReticle: 'smg',
    adsReticle: 'dot-ring',
    spreadBaseRad: 0.008,
    spreadMaxRad: 0.075,
  },
  coltello: {
    id: 4,
    key: 'coltello',
    displayName: 'CB-01 Shadowfang',
    role: 'LAMA DA MISCHIA',
    automatic: false,
    fireRateRps: 1.25,
    maxRange: 2.6,
    falloffStart: 2.6,
    falloffEnd: 2.6,
    bodyDamage: 50,
    minDamage: 0,
    headshotMultiplier: 1,
    magazineSize: 0,
    reserveAmmo: 0,
    reloadSeconds: 0,
    reloadStyle: 'none',
    adsFov: 68,
    adsSensitivity: 0.9,
    adsRigX: -0.035,
    adsRigY: 0.025,
    adsRigZ: 0.04,
    hipReticle: 'knife',
    adsReticle: 'knife',
    spreadBaseRad: 0,
    spreadMaxRad: 0,
  },
};

export const WEAPON_KEYS: readonly WeaponKey[] = [
  'assalto',
  'cecchino',
  'pompa',
  'mitraglietta',
  'coltello',
] as const;

export function getWeaponRuntimeById(id: number): WeaponRuntimeConfig {
  return WEAPON_RUNTIME[WEAPON_KEYS[id] ?? 'assalto'];
}

export function getWeaponRuntime(key: string): WeaponRuntimeConfig {
  return WEAPON_RUNTIME[(WEAPON_KEYS.includes(key as WeaponKey) ? key : 'assalto') as WeaponKey];
}

export function calculateWeaponDamageAtDistance(
  weaponId: number,
  distance: number,
  headshot: boolean,
): number {
  const cfg = getWeaponRuntimeById(weaponId);
  if (!Number.isFinite(distance) || distance < 0 || distance > cfg.maxRange) return 0;

  let bodyDamage = cfg.bodyDamage;
  if (cfg.falloffEnd > cfg.falloffStart && distance > cfg.falloffStart) {
    const t = Math.min(1, (distance - cfg.falloffStart) / (cfg.falloffEnd - cfg.falloffStart));
    bodyDamage = cfg.bodyDamage + (cfg.minDamage - cfg.bodyDamage) * t;
  } else if (cfg.falloffEnd === cfg.falloffStart && distance > cfg.falloffStart) {
    bodyDamage = cfg.minDamage;
  }

  return Math.max(0, bodyDamage * (headshot ? cfg.headshotMultiplier : 1));
}

/** Map a normalized FPS reticle accuracy value to the weapon's real spread cone. */
export function calculateWeaponSpreadAngle(weapon: string, accuracy: number): number {
  const cfg = getWeaponRuntime(weapon);
  const a = Number.isFinite(accuracy) ? Math.max(0, Math.min(1, accuracy)) : 1;
  return cfg.spreadBaseRad + (1 - a) * Math.max(0, cfg.spreadMaxRad - cfg.spreadBaseRad);
}

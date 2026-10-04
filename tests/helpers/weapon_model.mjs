// tests/helpers/weapon_model.mjs
// Test utilities derived from the live browser weapon contract. Do not duplicate
// damage/range/fire-rate constants here: import them from weaponConfig.ts so the
// executable model cannot silently drift away from gameplay.

import {
  WEAPON_KEYS,
  WEAPON_RUNTIME,
  calculateWeaponDamageAtDistance,
} from '../../game-web/src/weapons/weaponConfig.ts';

// Rust-only combat parameters mirrored from game-core/src/weapons.rs.
// spreadRecoveryRate is retained only for the historical linear recovery helper;
// the live browser reticle owns its own pixel-space recovery profile.
const RUST_EXTRAS = {
  assalto: {
    role: 'Assault Rifle',
    pellets: 1,
    spreadBloomRad: 0.0045,
    spreadRecoveryRate: 0.15,
    recoilPitchDeg: 1.10,
    recoilYawDeg: 0.35,
    recoilRecoveryRate: 8.0,
  },
  cecchino: {
    role: 'Sniper Rifle',
    pellets: 1,
    spreadBloomRad: 0.020,
    spreadRecoveryRate: 0.08,
    recoilPitchDeg: 5.50,
    recoilYawDeg: 0.80,
    recoilRecoveryRate: 3.5,
  },
  pompa: {
    role: 'Combat Shotgun',
    pellets: 8,
    spreadBloomRad: 0.008,
    spreadRecoveryRate: 0.0,
    recoilPitchDeg: 4.00,
    recoilYawDeg: 1.20,
    recoilRecoveryRate: 4.0,
  },
  mitraglietta: {
    role: 'Submachine Gun',
    pellets: 1,
    spreadBloomRad: 0.006,
    spreadRecoveryRate: 0.20,
    recoilPitchDeg: 0.55,
    recoilYawDeg: 0.65,
    recoilRecoveryRate: 10.0,
  },
  coltello: {
    role: 'Combat Knife',
    pellets: 1,
    spreadBloomRad: 0.0,
    spreadRecoveryRate: 0.0,
    recoilPitchDeg: 0.0,
    recoilYawDeg: 0.0,
    recoilRecoveryRate: 0.0,
  },
};

export const WEAPON_CONFIGS = Object.fromEntries(WEAPON_KEYS.map((key) => {
  const live = WEAPON_RUNTIME[key];
  const extra = RUST_EXTRAS[key];
  return [key, {
    id: live.id,
    name: live.displayName,
    role: extra.role,
    baseDamage: live.bodyDamage,
    mediumDamage: calculateWeaponDamageAtDistance(live.id, 20.0, false),
    meleeDamage: key === 'coltello' ? live.bodyDamage : undefined,
    fireRateRps: live.fireRateRps,
    pellets: extra.pellets,
    falloffStartM: live.falloffStart,
    falloffEndM: live.falloffEnd,
    minDamage: live.minDamage,
    headshotMultiplier: live.headshotMultiplier,
    spreadBaseRad: live.spreadBaseRad,
    spreadBloomRad: extra.spreadBloomRad,
    spreadMaxRad: live.spreadMaxRad,
    spreadRecoveryRate: extra.spreadRecoveryRate,
    recoilPitchDeg: extra.recoilPitchDeg,
    recoilYawDeg: extra.recoilYawDeg,
    recoilRecoveryRate: extra.recoilRecoveryRate,
    maxRangeM: live.maxRange,
  }];
}));

export const STANCE_MODIFIERS = {
  crouch: 0.75,
  stand: 1.0,
  walk: 1.4,
  sprint: 2.0,
  air: 2.5,
};

/**
 * Calculate live browser damage at a given distance with optional headshot multiplier.
 */
export function calculateDamage(weaponKey, distanceM, isHeadshot = false) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);
  return calculateWeaponDamageAtDistance(config.id, distanceM, isHeadshot);
}

/**
 * Mirror the Rust theoretical TTK contract.
 * hits = ceil(targetHp / damage), TTK = (hits - 1) / fireRateRps.
 */
export function calculateTheoreticalTTK(weaponKey, targetHp = 100.0, distanceM = 20.0, isHeadshot = false) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  const dmg = calculateDamage(weaponKey, distanceM, isHeadshot);
  if (!Number.isFinite(targetHp) || targetHp <= 0.0 || dmg <= 0.0 || config.fireRateRps <= 0.0) {
    return Infinity;
  }

  const hits = Math.ceil(targetHp / dmg);
  return hits <= 1 ? 0.0 : (hits - 1) / config.fireRateRps;
}

/**
 * Mirror the Rust burst spread helper for deterministic model tests.
 */
export function calculateSpreadAngle(weaponKey, shotsFired = 0, stance = 'stand') {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  const stanceMod = STANCE_MODIFIERS[stance] || 1.0;
  const unscaled = Math.min(config.spreadBaseRad + shotsFired * config.spreadBloomRad, config.spreadMaxRad);
  return Math.min(unscaled * stanceMod, config.spreadMaxRad);
}

export function calculateRecoveredSpread(weaponKey, currentSpreadRad, deltaTSeconds) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);
  return Math.max(config.spreadBaseRad, currentSpreadRad - config.spreadRecoveryRate * deltaTSeconds);
}

export function calculateRecoilDecay(weaponKey, currentPitch, currentYaw, deltaTSeconds) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  const decayFactor = Math.exp(-config.recoilRecoveryRate * deltaTSeconds);
  return {
    pitch: currentPitch * decayFactor,
    yaw: currentYaw * decayFactor,
  };
}

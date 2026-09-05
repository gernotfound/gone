// tests/helpers/weapon_model.mjs
// Authoritative mathematical specifications for G.O.N.E. weapons and combat dynamics.

export const WEAPON_CONFIGS = {
  assalto: {
    id: 0,
    name: 'AR-42 Viper',
    role: 'Assault Rifle',
    baseDamage: 18.0,
    mediumDamage: 17.0, // at 20m
    fireRateRps: 6.25, // 375 RPM
    pellets: 1,
    falloffStartM: 10.0,
    falloffEndM: 70.0,
    minDamage: 12.0,
    headshotMultiplier: 1.5,
    spreadBaseRad: 0.012,
    spreadBloomRad: 0.005,
    spreadMaxRad: 0.060,
    spreadRecoveryRate: 0.15,
    recoilPitchDeg: 1.1,
    recoilYawDeg: 0.35,
    recoilRecoveryRate: 8.0,
    maxRangeM: 100.0,
  },
  cecchino: {
    id: 1,
    name: 'SR-99 Railphantom',
    role: 'Sniper Rifle',
    baseDamage: 70.0,
    mediumDamage: 70.0, // at 20m
    fireRateRps: 1.00, // 60 RPM
    pellets: 1,
    falloffStartM: 100.0,
    falloffEndM: 300.0,
    minDamage: 55.0,
    headshotMultiplier: 2.0,
    spreadBaseRad: 0.0005,
    spreadBloomRad: 0.070,
    spreadMaxRad: 0.100,
    spreadRecoveryRate: 0.08,
    recoilPitchDeg: 5.5,
    recoilYawDeg: 0.80,
    recoilRecoveryRate: 3.5,
    maxRangeM: 300.0,
  },
  pompa: {
    id: 2,
    name: 'SG-12 Havoc',
    role: 'Combat Shotgun',
    baseDamage: 64.0, // 8 pellets * 8.0
    mediumDamage: 52.5, // 7 pellets * 7.5 at 20m
    fireRateRps: 1.25, // 75 RPM
    pellets: 8,
    falloffStartM: 10.0,
    falloffEndM: 30.0,
    minDamage: 41.0, // 8 pellets * 5.125
    headshotMultiplier: 1.5,
    spreadBaseRad: 0.075,
    spreadBloomRad: 0.0,
    spreadMaxRad: 0.075,
    spreadRecoveryRate: 0.0,
    recoilPitchDeg: 4.0,
    recoilYawDeg: 1.20,
    recoilRecoveryRate: 4.0,
    maxRangeM: 40.0,
  },
  mitraglietta: {
    id: 3,
    name: 'SMG-7 Neon Hornet',
    role: 'Submachine Gun',
    baseDamage: 12.0,
    mediumDamage: 10.0, // at 20m
    fireRateRps: 10.00, // 600 RPM
    pellets: 1,
    falloffStartM: 10.0,
    falloffEndM: 40.0,
    minDamage: 6.0,
    headshotMultiplier: 1.5,
    spreadBaseRad: 0.025,
    spreadBloomRad: 0.008,
    spreadMaxRad: 0.095,
    spreadRecoveryRate: 0.20,
    recoilPitchDeg: 0.55,
    recoilYawDeg: 0.65,
    recoilRecoveryRate: 10.0,
    maxRangeM: 50.0,
  },
  coltello: {
    id: 4,
    name: 'CB-01 Shadowfang',
    role: 'Combat Knife',
    baseDamage: 50.0,
    mediumDamage: 0.0, // Outside melee range (>2.5m)
    meleeDamage: 50.0, // Within melee range (<=2.5m)
    fireRateRps: 1.25, // 75 RPM
    pellets: 1,
    falloffStartM: 2.5,
    falloffEndM: 2.5,
    minDamage: 0.0,
    headshotMultiplier: 1.0,
    spreadBaseRad: 0.0,
    spreadBloomRad: 0.0,
    spreadMaxRad: 0.0,
    spreadRecoveryRate: 0.0,
    recoilPitchDeg: 0.0,
    recoilYawDeg: 0.0,
    recoilRecoveryRate: 0.0,
    maxRangeM: 2.5,
  },
};

export const STANCE_MODIFIERS = {
  crouch: 0.75,
  stand: 1.0,
  walk: 1.4,
  sprint: 2.0,
  air: 2.5,
};

/**
 * Calculate damage at a given distance with optional headshot multiplier.
 */
export function calculateDamage(weaponKey, distanceM, isHeadshot = false) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) {
    throw new Error(`Unknown weapon: ${weaponKey}`);
  }

  // Melee knife logic: strictly 0 outside 2.5m
  if (weaponKey === 'coltello') {
    if (distanceM > config.maxRangeM) {
      return 0.0;
    }
    return config.baseDamage * (isHeadshot ? config.headshotMultiplier : 1.0);
  }

  let damage;
  if (distanceM <= config.falloffStartM) {
    damage = config.baseDamage;
  } else if (distanceM >= config.falloffEndM) {
    damage = config.minDamage;
  } else {
    const fraction = (distanceM - config.falloffStartM) / (config.falloffEndM - config.falloffStartM);
    damage = config.baseDamage - (config.baseDamage - config.minDamage) * fraction;
  }

  if (isHeadshot) {
    damage *= config.headshotMultiplier;
  }

  return damage;
}

/**
 * Calculate theoretical Time-To-Kill (TTK) against a target with specified HP.
 * Formula: hits = ceil(targetHp / damage), TTK = (hits - 1) / fireRateRps
 */
export function calculateTheoreticalTTK(weaponKey, targetHp = 100.0, distanceM = 20.0, isHeadshot = false) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) {
    throw new Error(`Unknown weapon: ${weaponKey}`);
  }

  // For knife, medium range (20m) is out of range (infinite TTK),
  // but within melee range (<=2.5m) it deals 50 dmg per hit
  const effectiveDistance = (weaponKey === 'coltello' && distanceM > config.maxRangeM) ? 1.5 : distanceM;
  const dmg = calculateDamage(weaponKey, effectiveDistance, isHeadshot);

  if (dmg <= 0.0) {
    return Infinity;
  }

  const hits = Math.ceil(targetHp / dmg);
  if (hits <= 1) {
    return 0.0;
  }

  return (hits - 1) / config.fireRateRps;
}

/**
 * Calculate spread cone half-angle in radians given continuous shots and stance.
 */
export function calculateSpreadAngle(weaponKey, shotsFired = 0, stance = 'stand') {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  const stanceMod = STANCE_MODIFIERS[stance] || 1.0;
  const unscaled = Math.min(config.spreadBaseRad + shotsFired * config.spreadBloomRad, config.spreadMaxRad);
  return Math.min(unscaled * stanceMod, config.spreadMaxRad);
}

/**
 * Calculate spread recovery after a given idle time deltaT.
 */
export function calculateRecoveredSpread(weaponKey, currentSpreadRad, deltaTSeconds) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  return Math.max(config.spreadBaseRad, currentSpreadRad - config.spreadRecoveryRate * deltaTSeconds);
}

/**
 * Calculate exponential recoil decay over time deltaT.
 */
export function calculateRecoilDecay(weaponKey, currentPitch, currentYaw, deltaTSeconds) {
  const config = WEAPON_CONFIGS[weaponKey];
  if (!config) throw new Error(`Unknown weapon: ${weaponKey}`);

  const decayFactor = Math.exp(-config.recoilRecoveryRate * deltaTSeconds);
  return {
    pitch: currentPitch * decayFactor,
    yaw: currentYaw * decayFactor,
  };
}

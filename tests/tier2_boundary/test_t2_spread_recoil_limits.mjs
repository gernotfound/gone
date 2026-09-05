// tests/tier2_boundary/test_t2_spread_recoil_limits.mjs
// Tier 2 Boundary & Corner Cases: Spread Saturation, Recoil Bounds & Recovery Limits (F-11, F-12)

import {
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
  assertLessThan,
  assertLessThanOrEqual,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  STANCE_MODIFIERS,
  calculateSpreadAngle,
  calculateRecoveredSpread,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // Spread Saturation & Caps
  suite.test('T2-Spread: Assalto fired 10,000 continuous shots clamps strictly at spreadMaxRad (0.060 rad)', () => {
    const spread = calculateSpreadAngle('assalto', 10000, 'stand');
    assertEqual(spread, WEAPON_CONFIGS.assalto.spreadMaxRad);
    assertLessThanOrEqual(spread, 0.060);
  });

  suite.test('T2-Spread: Cecchino heavy sniper clamps strictly at spreadMaxRad (0.100 rad)', () => {
    const spread = calculateSpreadAngle('cecchino', 50, 'stand');
    assertEqual(spread, WEAPON_CONFIGS.cecchino.spreadMaxRad);
  });

  suite.test('T2-Spread: Zero continuous shots yields exactly spreadBaseRad for standard stance', () => {
    const spread = calculateSpreadAngle('assalto', 0, 'stand');
    assertEqual(spread, WEAPON_CONFIGS.assalto.spreadBaseRad);
  });

  // Stance Modifier Boundaries & Hierarchy
  suite.test('T2-Spread: Stance modifiers strictly adhere to hierarchy: crouch < stand < walk < sprint < air', () => {
    assertLessThan(STANCE_MODIFIERS.crouch, STANCE_MODIFIERS.stand);
    assertLessThan(STANCE_MODIFIERS.stand, STANCE_MODIFIERS.walk);
    assertLessThan(STANCE_MODIFIERS.walk, STANCE_MODIFIERS.sprint);
    assertLessThan(STANCE_MODIFIERS.sprint, STANCE_MODIFIERS.air);
  });

  suite.test('T2-Spread: Unknown or invalid stance safely falls back to standard 1.0x stance modifier', () => {
    const unknownSpread = calculateSpreadAngle('assalto', 0, 'invalid_stance_xyz');
    const standSpread = calculateSpreadAngle('assalto', 0, 'stand');
    assertEqual(unknownSpread, standSpread);
  });

  // Spread Recovery Limits
  suite.test('T2-Spread: Zero-time recovery (deltaT = 0s) leaves spread unchanged', () => {
    const initial = 0.045;
    const recovered = calculateRecoveredSpread('assalto', initial, 0.0);
    assertEqual(recovered, initial);
  });

  suite.test('T2-Spread: Massive idle time (10,000s) never reduces spread below spreadBaseRad floor', () => {
    const recovered = calculateRecoveredSpread('assalto', 0.055, 10000.0);
    assertEqual(recovered, WEAPON_CONFIGS.assalto.spreadBaseRad);
  });

  // Recoil Kick & Decay Limits
  suite.test('T2-Recoil: Zero-time recoil decay (deltaT = 0s) preserves exact initial kick', () => {
    const initialPitch = 4.5;
    const initialYaw = 1.2;
    const res = calculateRecoilDecay('assalto', initialPitch, initialYaw, 0.0);
    assertCloseTo(res.pitch, initialPitch, 1e-6);
    assertCloseTo(res.yaw, initialYaw, 1e-6);
  });

  suite.test('T2-Recoil: Long idle time (100s) decays recoil to virtually zero (< 1e-12)', () => {
    const res = calculateRecoilDecay('assalto', 10.0, 5.0, 100.0);
    assertLessThan(res.pitch, 1e-12);
    assertLessThan(res.yaw, 1e-12);
  });

  suite.test('T2-Recoil: Massive continuous recoil accumulation decays stably without NaN or Infinity', () => {
    const heavyPitch = 550.0; // 100 cecchino shots
    const heavyYaw = 80.0;
    const res = calculateRecoilDecay('cecchino', heavyPitch, heavyYaw, 1.0);
    assertEqual(Number.isFinite(res.pitch), true);
    assertEqual(Number.isFinite(res.yaw), true);
    assertLessThan(res.pitch, heavyPitch);
  });

  suite.test('T2-Recoil: All firearms define strictly positive recovery rate constants (> 0)', () => {
    const firearms = ['assalto', 'cecchino', 'pompa', 'mitraglietta'];
    for (const f of firearms) {
      assertGreaterThan(WEAPON_CONFIGS[f].recoilRecoveryRate, 0.0, `${f} recoil recovery rate must be > 0`);
    }
  });

  // Weapon-Specific Geometry Invariants
  suite.test('T2-Spread: Pompa combat shotgun has zero bloom (fixed choke spread pattern)', () => {
    assertEqual(WEAPON_CONFIGS.pompa.spreadBloomRad, 0.0);
    assertEqual(WEAPON_CONFIGS.pompa.spreadBaseRad, WEAPON_CONFIGS.pompa.spreadMaxRad);
    const spread1 = calculateSpreadAngle('pompa', 1, 'stand');
    const spread20 = calculateSpreadAngle('pompa', 20, 'stand');
    assertEqual(spread1, spread20);
  });

  suite.test('T2-Spread: Coltello has strictly zero spread and zero recoil under all conditions', () => {
    assertEqual(WEAPON_CONFIGS.coltello.spreadBaseRad, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadBloomRad, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadMaxRad, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.recoilPitchDeg, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.recoilYawDeg, 0.0);
    assertEqual(calculateSpreadAngle('coltello', 10, 'air'), 0.0);
  });
}

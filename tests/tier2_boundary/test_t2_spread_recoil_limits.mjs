// tests/tier2_boundary/test_t2_spread_recoil_limits.mjs
// Tier 2 Boundary & Corner Cases: canonical spread/recoil saturation and recovery.

import {
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
  assertLessThan,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  STANCE_MODIFIERS,
  calculateSpreadAngle,
  calculateRecoveredSpread,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('T2-Spread: Assalto saturates at 0.045 rad', () => {
    assertEqual(calculateSpreadAngle('assalto', 10_000, 'stand'), 0.045);
  });

  suite.test('T2-Spread: Cecchino saturates at 0.075 rad', () => {
    assertEqual(calculateSpreadAngle('cecchino', 50, 'stand'), 0.075);
  });

  suite.test('T2-Spread: Zero burst count yields each weapon base spread', () => {
    for (const key of ['assalto','cecchino','pompa','mitraglietta','coltello']) {
      assertEqual(calculateSpreadAngle(key, 0, 'stand'), WEAPON_CONFIGS[key].spreadBaseRad, key);
    }
  });

  suite.test('T2-Spread: Stance modifier ordering remains strict', () => {
    assertLessThan(STANCE_MODIFIERS.crouch, STANCE_MODIFIERS.stand);
    assertLessThan(STANCE_MODIFIERS.stand, STANCE_MODIFIERS.walk);
    assertLessThan(STANCE_MODIFIERS.walk, STANCE_MODIFIERS.sprint);
    assertLessThan(STANCE_MODIFIERS.sprint, STANCE_MODIFIERS.air);
  });

  suite.test('T2-Spread: Unknown stance falls back to stand', () => {
    assertEqual(
      calculateSpreadAngle('assalto', 0, 'invalid_stance_xyz'),
      calculateSpreadAngle('assalto', 0, 'stand'),
    );
  });

  suite.test('T2-Spread: Recovery leaves zero-delta unchanged and never crosses base floor', () => {
    const initial = 0.03;
    assertEqual(calculateRecoveredSpread('assalto', initial, 0), initial);
    assertEqual(
      calculateRecoveredSpread('assalto', initial, 10_000),
      WEAPON_CONFIGS.assalto.spreadBaseRad,
    );
  });

  suite.test('T2-Recoil: Exponential recoil recovery is finite and decays toward zero', () => {
    const zero = calculateRecoilDecay('assalto', 4.5, 1.2, 0);
    assertCloseTo(zero.pitch, 4.5, 1e-9);
    assertCloseTo(zero.yaw, 1.2, 1e-9);

    const long = calculateRecoilDecay('assalto', 10, 5, 100);
    assertLessThan(long.pitch, 1e-12);
    assertLessThan(long.yaw, 1e-12);

    const heavy = calculateRecoilDecay('cecchino', 550, 80, 1);
    assertEqual(Number.isFinite(heavy.pitch), true);
    assertEqual(Number.isFinite(heavy.yaw), true);
    assertLessThan(heavy.pitch, 550);
  });

  suite.test('T2-Recoil: All firearms retain positive recoil recovery constants', () => {
    for (const key of ['assalto','cecchino','pompa','mitraglietta']) {
      assertGreaterThan(WEAPON_CONFIGS[key].recoilRecoveryRate, 0, key);
    }
  });

  suite.test('T2-Spread: Pompa now blooms from 0.045 toward 0.110 instead of using the historical fixed choke', () => {
    assertEqual(WEAPON_CONFIGS.pompa.spreadBaseRad, 0.045);
    assertEqual(WEAPON_CONFIGS.pompa.spreadBloomRad, 0.008);
    assertEqual(WEAPON_CONFIGS.pompa.spreadMaxRad, 0.11);
    assertEqual(calculateSpreadAngle('pompa', 1, 'stand'), 0.053);
    assertEqual(calculateSpreadAngle('pompa', 20, 'stand'), 0.11);
  });

  suite.test('T2-Spread: Coltello remains zero-spread and zero-recoil', () => {
    assertEqual(WEAPON_CONFIGS.coltello.spreadBaseRad, 0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadBloomRad, 0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadMaxRad, 0);
    assertEqual(WEAPON_CONFIGS.coltello.recoilPitchDeg, 0);
    assertEqual(WEAPON_CONFIGS.coltello.recoilYawDeg, 0);
    assertEqual(calculateSpreadAngle('coltello', 10, 'air'), 0);
  });
}

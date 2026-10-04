// tests/tier3_combinations/test_t3_movement_combat.mjs
// Tier 3 Cross-Feature Combination: stance, weapon switching and current Rust spread/recoil model.

import {
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
  assertLessThan,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateSpreadAngle,
  calculateRecoveredSpread,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('T3-MoveCombat: Sprinting Assalto burst compounds the current spread cone', () => {
    const stand = calculateSpreadAngle('assalto', 3, 'stand');
    const sprint = calculateSpreadAngle('assalto', 3, 'sprint');
    assertGreaterThan(sprint, stand);
    assertCloseTo(stand, 0.0035 + 3 * 0.0045, 1e-6);
    assertCloseTo(sprint, 0.034, 1e-6);
  });

  suite.test('T3-MoveCombat: Weapon switch resets burst count into the SMG current base cone', () => {
    const assaltoSpread = calculateSpreadAngle('assalto', 4, 'sprint');
    assertGreaterThan(assaltoSpread, 0.04);
    assertCloseTo(calculateSpreadAngle('mitraglietta', 0, 'sprint'), 0.016, 1e-6);
  });

  suite.test('T3-MoveCombat: Sprint-to-crouch transition tightens sustained Assalto spread', () => {
    const sprint = calculateSpreadAngle('assalto', 2, 'sprint');
    const crouch = calculateSpreadAngle('assalto', 2, 'crouch');
    assertLessThan(crouch, sprint);
    assertCloseTo(sprint, 0.025, 1e-6);
    assertCloseTo(crouch, 0.009375, 1e-6);
  });

  suite.test('T3-MoveCombat: Coltello collapses modeled spread and recoil to zero', () => {
    assertEqual(calculateSpreadAngle('coltello', 5, 'sprint'), 0);
    const recoil = calculateRecoilDecay('coltello', 0, 0, 0.5);
    assertEqual(recoil.pitch, 0);
    assertEqual(recoil.yaw, 0);
  });

  suite.test('T3-MoveCombat: Airborne Cecchino applies the modeled 2.5x stance penalty', () => {
    const stand = calculateSpreadAngle('cecchino', 0, 'stand');
    const air = calculateSpreadAngle('cecchino', 0, 'air');
    assertCloseTo(stand, 0.00035, 1e-7);
    assertCloseTo(air, 0.000875, 1e-7);
  });

  suite.test('T3-MoveCombat: Burst recovery reduces spread and exponential recoil', () => {
    const burstSpread = calculateSpreadAngle('assalto', 5, 'stand');
    const initialPitch = 5 * WEAPON_CONFIGS.assalto.recoilPitchDeg;
    const recoveredSpread = calculateRecoveredSpread('assalto', burstSpread, 0.25);
    const recoveredRecoil = calculateRecoilDecay('assalto', initialPitch, 0, 0.25);
    assertLessThan(recoveredSpread, burstSpread);
    assertLessThan(recoveredRecoil.pitch, initialPitch);
    assertCloseTo(recoveredRecoil.pitch, initialPitch * Math.exp(-2), 0.1);
  });
}

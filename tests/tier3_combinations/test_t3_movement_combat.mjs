// tests/tier3_combinations/test_t3_movement_combat.mjs
// Tier 3 Cross-Feature Combination: Movement Stances, Weapon Switching & Recoil/Spread Dynamics

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
  suite.test('T3-MoveCombat: Sprinting while firing Assalto compounds spread cone by 2.0x stance modifier', () => {
    const standSpread3 = calculateSpreadAngle('assalto', 3, 'stand');
    const sprintSpread3 = calculateSpreadAngle('assalto', 3, 'sprint');

    assertGreaterThan(sprintSpread3, standSpread3);
    assertCloseTo(sprintSpread3, Math.min((0.012 + 3 * 0.005) * 2.0, 0.060), 1e-4);
  });

  suite.test('T3-MoveCombat: Weapon switch from blooming Assalto to SMG inherits SMG spread and sprint stance', () => {
    // Player fires 4 rounds of Assalto
    const assaltoSpread = calculateSpreadAngle('assalto', 4, 'sprint');
    assertGreaterThan(assaltoSpread, 0.04);

    // Switches weapon to Mitraglietta in mid-sprint (resets continuous shots to 0 for new weapon)
    const smgSpread = calculateSpreadAngle('mitraglietta', 0, 'sprint');
    // SMG base 0.025 * 2.0 = 0.050 rad
    assertCloseTo(smgSpread, 0.050, 1e-4);
  });

  suite.test('T3-MoveCombat: Transitioning from sprint to crouch during sustained fire tightens spread significantly', () => {
    const sprintBloom = calculateSpreadAngle('assalto', 2, 'sprint'); // (0.012 + 0.010) * 2.0 = 0.044
    const crouchBloom = calculateSpreadAngle('assalto', 2, 'crouch'); // (0.012 + 0.010) * 0.75 = 0.0165

    assertLessThan(crouchBloom, sprintBloom);
    assertCloseTo(crouchBloom, 0.022 * 0.75, 1e-4);
  });

  suite.test('T3-MoveCombat: Switching to Coltello in mid-sprint immediately collapses spread and recoil to zero', () => {
    const assaltoRecoil = 3.3; // 3 rounds fired
    const knifeSpread = calculateSpreadAngle('coltello', 5, 'sprint');
    const knifeRecoil = calculateRecoilDecay('coltello', 0, 0, 0.5);

    assertEqual(knifeSpread, 0.0);
    assertEqual(knifeRecoil.pitch, 0.0);
    assertEqual(knifeRecoil.yaw, 0.0);
  });

  suite.test('T3-MoveCombat: Airborne jump shot with Cecchino incurs 2.5x spread penalty', () => {
    const noscopeStand = calculateSpreadAngle('cecchino', 0, 'stand'); // 0.0005 rad
    const noscopeAir = calculateSpreadAngle('cecchino', 0, 'air'); // 0.00125 rad

    assertGreaterThan(noscopeAir, noscopeStand);
    assertCloseTo(noscopeAir, noscopeStand * 2.5, 1e-5);
  });

  suite.test('T3-MoveCombat: Burst-and-crouch recovery sequence restores reticle stability', () => {
    // 5-round burst standing: 0.012 + 5 * 0.005 = 0.037 rad
    const burstSpread = calculateSpreadAngle('assalto', 5, 'stand');
    const initialPitch = 5 * WEAPON_CONFIGS.assalto.recoilPitchDeg; // 5.5 deg

    // Cease fire and crouch for 0.25 seconds
    const recoveredSpread = calculateRecoveredSpread('assalto', burstSpread, 0.25);
    const recoveredRecoil = calculateRecoilDecay('assalto', initialPitch, 0, 0.25);

    assertLessThan(recoveredSpread, burstSpread);
    assertLessThan(recoveredRecoil.pitch, initialPitch);
    // After 0.25s at 8.0/s: decay factor is exp(-2.0) ~= 0.135
    assertCloseTo(recoveredRecoil.pitch, initialPitch * Math.exp(-2.0), 0.1);
  });
}

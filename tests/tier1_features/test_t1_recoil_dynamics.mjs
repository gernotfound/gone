// tests/tier1_features/test_t1_recoil_dynamics.mjs
// Tier 1 Feature Coverage: Exponential Recoil Dynamics & Pitch/Yaw Recovery (F-12)

import { assertEqual, assertCloseTo, assertGreaterThan, assertLessThan } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateRecoilDecay } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // Pitch Kick Parameters
  suite.test('F-12: Assalto adds 1.1 deg pitch kick per shot', () => {
    assertEqual(WEAPON_CONFIGS.assalto.recoilPitchDeg, 1.1);
  });

  suite.test('F-12: Cecchino heavy sniper kicks with massive 5.5 deg pitch per shot', () => {
    assertEqual(WEAPON_CONFIGS.cecchino.recoilPitchDeg, 5.5);
    assertGreaterThan(WEAPON_CONFIGS.cecchino.recoilPitchDeg, WEAPON_CONFIGS.assalto.recoilPitchDeg);
  });

  suite.test('F-12: Pompa shotgun kicks with 4.0 deg pitch and 1.2 deg yaw', () => {
    assertEqual(WEAPON_CONFIGS.pompa.recoilPitchDeg, 4.0);
    assertEqual(WEAPON_CONFIGS.pompa.recoilYawDeg, 1.20);
  });

  suite.test('F-12: SMG has low vertical kick (0.55 deg) but rapid horizontal vibration (0.65 deg)', () => {
    assertEqual(WEAPON_CONFIGS.mitraglietta.recoilPitchDeg, 0.55);
    assertEqual(WEAPON_CONFIGS.mitraglietta.recoilYawDeg, 0.65);
  });

  suite.test('F-12: Coltello melee weapon has zero recoil kick', () => {
    assertEqual(WEAPON_CONFIGS.coltello.recoilPitchDeg, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.recoilYawDeg, 0.0);
  });

  // Exponential Decay Over Time
  suite.test('F-12: Recoil recovers exponentially toward zero over time', () => {
    const initialPitch = 3.3; // 3 shots of assalto
    const initialYaw = 0.5;

    // After 0.1s: decay = exp(-8.0 * 0.1) = exp(-0.8) ~= 0.4493
    const after100ms = calculateRecoilDecay('assalto', initialPitch, initialYaw, 0.1);
    assertLessThan(after100ms.pitch, initialPitch);
    assertLessThan(after100ms.yaw, initialYaw);
    assertCloseTo(after100ms.pitch, initialPitch * Math.exp(-0.8), 1e-4);
  });

  suite.test('F-12: Cecchino with lower recovery rate (3.5 s^-1) settles slower than Assalto (8.0 s^-1)', () => {
    const p1 = calculateRecoilDecay('assalto', 5.0, 0, 0.2).pitch;
    const p2 = calculateRecoilDecay('cecchino', 5.0, 0, 0.2).pitch;
    // Lower rate means higher remaining recoil
    assertGreaterThan(p2, p1, 'Sniper should settle slower');
  });

  suite.test('F-12: SMG with high recovery rate (10.0 s^-1) settles quickly between bursts', () => {
    const decayed = calculateRecoilDecay('mitraglietta', 2.0, 0, 0.3).pitch;
    // exp(-10 * 0.3) = exp(-3.0) ~= 0.04978
    assertCloseTo(decayed, 2.0 * Math.exp(-3.0), 1e-4);
  });

  suite.test('F-12: Long idle time recovers reticle to near zero (< 0.001 deg)', () => {
    const settled = calculateRecoilDecay('assalto', 5.0, 2.0, 1.5);
    assertLessThan(settled.pitch, 0.001);
    assertLessThan(settled.yaw, 0.001);
  });
}

// tests/tier2_boundary/test_t2_falloff_limits.mjs
// Tier 2 Boundary & Corner Cases: current falloff inflections and hard ranges.

import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThan,
} from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateDamage } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('T2-Falloff: Point blank returns exact base damage for all weapons', () => {
    for (const key of Object.keys(WEAPON_CONFIGS)) {
      assertEqual(calculateDamage(key, 0.0), WEAPON_CONFIGS[key].baseDamage);
    }
  });

  suite.test('T2-Falloff: Invalid negative distance is rejected instead of treated as point blank', () => {
    assertEqual(calculateDamage('assalto', -0.001), 0.0);
    assertEqual(calculateDamage('cecchino', -5.0), 0.0);
    assertEqual(calculateDamage('coltello', -1.0), 0.0);
  });

  suite.test('T2-Falloff: Assalto transitions at 35m/140m and stops at 180m', () => {
    assertEqual(calculateDamage('assalto', 35.0), 18.0);
    const afterStart = calculateDamage('assalto', 35.001);
    assertLessThan(afterStart, 18.0);
    assertGreaterThan(afterStart, 17.99);
    assertEqual(calculateDamage('assalto', 140.0), 10.0);
    assertGreaterThan(calculateDamage('assalto', 139.999), 10.0);
    assertEqual(calculateDamage('assalto', 180.0), 10.0);
    assertEqual(calculateDamage('assalto', 180.001), 0.0);
  });

  suite.test('T2-Falloff: Cecchino transitions at 180m/450m and stops at 550m', () => {
    assertEqual(calculateDamage('cecchino', 180.0), 70.0);
    assertEqual(calculateDamage('cecchino', 450.0), 50.0);
    assertEqual(calculateDamage('cecchino', 550.0), 50.0);
    assertEqual(calculateDamage('cecchino', 550.001), 0.0);
  });

  suite.test('T2-Falloff: Every ranged weapon is zero strictly beyond its configured hard range', () => {
    for (const key of ['assalto', 'cecchino', 'pompa', 'mitraglietta']) {
      const cfg = WEAPON_CONFIGS[key];
      assertEqual(calculateDamage(key, cfg.maxRangeM), cfg.minDamage, key);
      assertEqual(calculateDamage(key, cfg.maxRangeM + 0.001), 0.0, key);
      assertEqual(calculateDamage(key, 10_000), 0.0, key);
    }
  });

  suite.test('T2-Falloff: Coltello boundary is exactly 2.6m', () => {
    assertEqual(calculateDamage('coltello', 2.6), 999.0);
    assertEqual(calculateDamage('coltello', 2.601), 0.0);
  });

  suite.test('T2-Falloff: Damage curves are monotonically non-increasing through and past hard range', () => {
    for (const key of ['assalto', 'cecchino', 'pompa', 'mitraglietta']) {
      const cfg = WEAPON_CONFIGS[key];
      const sampleDistances = [
        0,
        cfg.falloffStartM,
        (cfg.falloffStartM + cfg.falloffEndM) / 2,
        cfg.falloffEndM,
        cfg.maxRangeM,
        cfg.maxRangeM + 0.001,
        cfg.maxRangeM * 2,
      ];
      for (let i = 0; i < sampleDistances.length - 1; i += 1) {
        const d1 = sampleDistances[i];
        const d2 = sampleDistances[i + 1];
        assertGreaterThanOrEqual(calculateDamage(key, d1), calculateDamage(key, d2), key);
      }
    }
  });
}

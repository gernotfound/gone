// tests/tier2_boundary/test_t2_falloff_limits.mjs
// Tier 2 Boundary & Corner Cases: Extreme Distances, Falloff Limits & Knife Range (F-10)

import {
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThan,
  assertThrows,
} from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateDamage } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // Point Blank & Negative Distance
  suite.test('T2-Falloff: Point blank (0.0m) returns exact base damage for all weapons', () => {
    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    for (const key of weapons) {
      const dmg = calculateDamage(key, 0.0);
      assertEqual(dmg, WEAPON_CONFIGS[key].baseDamage, `0m damage must equal baseDamage for ${key}`);
    }
  });

  suite.test('T2-Falloff: Negative distance is treated as point blank base damage', () => {
    assertEqual(calculateDamage('assalto', -10.0), 18.0);
    assertEqual(calculateDamage('cecchino', -5.0), 70.0);
    assertEqual(calculateDamage('coltello', -1.0), 50.0);
  });

  // Assalto Falloff Inflexion Points
  suite.test('T2-Falloff: Assalto at exactly 10.0m (falloffStartM) deals full 18.0 HP', () => {
    assertEqual(calculateDamage('assalto', 10.0), 18.0);
  });

  suite.test('T2-Falloff: Assalto at 10.001m deals strictly less than 18.0 HP', () => {
    const dmg = calculateDamage('assalto', 10.001);
    assertLessThan(dmg, 18.0);
    assertGreaterThan(dmg, 17.99);
  });

  suite.test('T2-Falloff: Assalto at exactly 70.0m (falloffEndM) deals minimum 12.0 HP', () => {
    assertEqual(calculateDamage('assalto', 70.0), 12.0);
  });

  suite.test('T2-Falloff: Assalto at 69.999m deals strictly greater than 12.0 HP', () => {
    const dmg = calculateDamage('assalto', 69.999);
    assertGreaterThan(dmg, 12.0);
  });

  // Cecchino Falloff Inflexion Points
  suite.test('T2-Falloff: Cecchino at exactly 100.0m deals full 70.0 HP', () => {
    assertEqual(calculateDamage('cecchino', 100.0), 70.0);
  });

  suite.test('T2-Falloff: Cecchino at exactly 300.0m deals minimum 55.0 HP', () => {
    assertEqual(calculateDamage('cecchino', 300.0), 55.0);
  });

  // Extreme Distance Clamping
  suite.test('T2-Falloff: Extreme distance (500m) maintains minDamage clamp for all firearms', () => {
    assertEqual(calculateDamage('assalto', 500.0), WEAPON_CONFIGS.assalto.minDamage);
    assertEqual(calculateDamage('cecchino', 500.0), WEAPON_CONFIGS.cecchino.minDamage);
    assertEqual(calculateDamage('pompa', 500.0), WEAPON_CONFIGS.pompa.minDamage);
    assertEqual(calculateDamage('mitraglietta', 500.0), WEAPON_CONFIGS.mitraglietta.minDamage);
  });

  suite.test('T2-Falloff: Ultra-extreme distance (10,000m) never drops below minDamage or produces NaN', () => {
    const firearms = ['assalto', 'cecchino', 'pompa', 'mitraglietta'];
    for (const key of firearms) {
      const dmg = calculateDamage(key, 10000.0);
      assertEqual(dmg, WEAPON_CONFIGS[key].minDamage);
      assertEqual(Number.isNaN(dmg), false);
    }
  });

  // Knife Melee Boundary Invariants
  suite.test('T2-Falloff: Coltello deals 50.0 HP at exactly 2.500m', () => {
    assertEqual(calculateDamage('coltello', 2.5), 50.0);
  });

  suite.test('T2-Falloff: Coltello drops strictly to 0.0 HP at 2.501m (infinitesimal step past reach)', () => {
    assertEqual(calculateDamage('coltello', 2.501), 0.0);
  });

  suite.test('T2-Falloff: Coltello remains strictly 0.0 HP at all long ranges (10m, 50m, 500m)', () => {
    assertEqual(calculateDamage('coltello', 10.0), 0.0);
    assertEqual(calculateDamage('coltello', 50.0), 0.0);
    assertEqual(calculateDamage('coltello', 500.0), 0.0);
  });

  // Monotonicity Invariant
  suite.test('T2-Falloff: Damage curve is monotonically non-increasing from 0m to 500m', () => {
    const sampleDistances = [0, 5, 10, 20, 25, 30, 45, 65, 80, 100, 150, 200, 300, 500];
    const firearms = ['assalto', 'cecchino', 'pompa', 'mitraglietta'];
    for (const f of firearms) {
      for (let i = 0; i < sampleDistances.length - 1; i++) {
        const d1 = sampleDistances[i];
        const d2 = sampleDistances[i + 1];
        const dmg1 = calculateDamage(f, d1);
        const dmg2 = calculateDamage(f, d2);
        assertGreaterThanOrEqual(dmg1, dmg2, `Damage at ${d1}m (${dmg1}) must be >= damage at ${d2}m (${dmg2}) for ${f}`);
      }
    }
  });
}

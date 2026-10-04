// tests/tier1_features/test_t1_weapon_ttk.mjs
// Tier 1 Feature Coverage: canonical weapon damage and reference TTK math.

import { assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateDamage, calculateTheoreticalTTK } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('F-09: Assalto deals 18 HP at 20m and has 0.800s body TTK', () => {
    assertEqual(calculateDamage('assalto', 20.0), 18.0);
    assertEqual(Math.ceil(100.0 / calculateDamage('assalto', 20.0)), 6);
    assertCloseTo(calculateTheoreticalTTK('assalto', 100.0, 20.0), 0.800, 1e-6);
  });

  suite.test('F-09: Cecchino deals 70 HP at 20m and has 1.000s body TTK', () => {
    assertEqual(calculateDamage('cecchino', 20.0), 70.0);
    assertEqual(Math.ceil(100.0 / calculateDamage('cecchino', 20.0)), 2);
    assertCloseTo(calculateTheoreticalTTK('cecchino', 100.0, 20.0), 1.000, 1e-6);
  });

  suite.test('F-09: Pompa keeps 64 HP CQB damage but is deliberately 1.600s at the 20m benchmark', () => {
    assertEqual(WEAPON_CONFIGS.pompa.baseDamage, 64.0);
    assertEqual(WEAPON_CONFIGS.pompa.pellets, 8);
    assertCloseTo(calculateTheoreticalTTK('pompa', 100.0, 5.0), 0.800, 1e-6);
    assertEqual(calculateDamage('pompa', 20.0), 40.0);
    assertEqual(Math.ceil(100.0 / calculateDamage('pompa', 20.0)), 3);
    assertCloseTo(calculateTheoreticalTTK('pompa', 100.0, 20.0), 1.600, 1e-6);
  });

  suite.test('F-09: Mitraglietta deals 11.5 HP at 20m and has 0.800s body TTK', () => {
    assertEqual(WEAPON_CONFIGS.mitraglietta.fireRateRps, 10.0);
    assertEqual(calculateDamage('mitraglietta', 20.0), 11.5);
    assertEqual(Math.ceil(100.0 / calculateDamage('mitraglietta', 20.0)), 9);
    assertCloseTo(calculateTheoreticalTTK('mitraglietta', 100.0, 20.0), 0.800, 1e-6);
  });

  suite.test('F-09: Coltello is a one-hit 999-damage melee weapon through 2.6m', () => {
    assertEqual(calculateDamage('coltello', 2.0), 999.0);
    assertEqual(calculateDamage('coltello', 2.6), 999.0);
    assertEqual(Math.ceil(100.0 / calculateDamage('coltello', 2.0)), 1);
    assertEqual(calculateTheoreticalTTK('coltello', 100.0, 2.0), 0.0);
  });

  suite.test('F-09: Reference 20m body TTK table matches the live balance contract', () => {
    const expected = {
      assalto: 0.8,
      cecchino: 1.0,
      pompa: 1.6,
      mitraglietta: 0.8,
    };
    for (const [key, ttk] of Object.entries(expected)) {
      assertCloseTo(calculateTheoreticalTTK(key, 100.0, 20.0), ttk, 1e-6, key);
    }
    assertEqual(calculateTheoreticalTTK('coltello', 100.0, 2.0), 0.0);
  });
}

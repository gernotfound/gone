// tests/tier1_features/test_t1_damage_falloff.mjs
// Tier 1 Feature Coverage: canonical piecewise damage falloff and hard ranges.

import { assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { calculateDamage } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('F-10: Assalto uses 35m->140m falloff, 10 HP minimum, and 180m hard range', () => {
    assertEqual(calculateDamage('assalto', 35.0), 18.0);
    assertCloseTo(calculateDamage('assalto', 87.5), 14.0, 1e-6);
    assertEqual(calculateDamage('assalto', 140.0), 10.0);
    assertEqual(calculateDamage('assalto', 180.0), 10.0);
    assertEqual(calculateDamage('assalto', 180.001), 0.0);
  });

  suite.test('F-10: Cecchino uses 180m->450m falloff, 50 HP minimum, and 550m hard range', () => {
    assertEqual(calculateDamage('cecchino', 180.0), 70.0);
    assertCloseTo(calculateDamage('cecchino', 315.0), 60.0, 1e-6);
    assertEqual(calculateDamage('cecchino', 450.0), 50.0);
    assertEqual(calculateDamage('cecchino', 550.0), 50.0);
    assertEqual(calculateDamage('cecchino', 550.001), 0.0);
  });

  suite.test('F-10: Pompa uses 8m->30m falloff, 20 HP minimum, and 42m hard range', () => {
    assertEqual(calculateDamage('pompa', 8.0), 64.0);
    assertEqual(calculateDamage('pompa', 20.0), 40.0);
    assertEqual(calculateDamage('pompa', 30.0), 20.0);
    assertEqual(calculateDamage('pompa', 42.0), 20.0);
    assertEqual(calculateDamage('pompa', 42.001), 0.0);
  });

  suite.test('F-10: Mitraglietta uses 15m->65m falloff, 7 HP minimum, and 90m hard range', () => {
    assertEqual(calculateDamage('mitraglietta', 15.0), 12.0);
    assertEqual(calculateDamage('mitraglietta', 20.0), 11.5);
    assertEqual(calculateDamage('mitraglietta', 65.0), 7.0);
    assertEqual(calculateDamage('mitraglietta', 90.0), 7.0);
    assertEqual(calculateDamage('mitraglietta', 90.001), 0.0);
  });

  suite.test('F-10: Coltello is 999 damage through 2.6m and zero immediately beyond reach', () => {
    assertEqual(calculateDamage('coltello', 2.6), 999.0);
    assertEqual(calculateDamage('coltello', 2.601), 0.0);
    assertEqual(calculateDamage('coltello', 10.0), 0.0);
  });

  suite.test('F-10: Headshot multipliers apply to the current falloff damage', () => {
    assertEqual(calculateDamage('cecchino', 50.0, true), 140.0);
    assertEqual(calculateDamage('cecchino', 450.0, true), 100.0);
    assertEqual(calculateDamage('assalto', 35.0, true), 27.0);
    assertEqual(calculateDamage('assalto', 140.0, true), 15.0);
    assertEqual(calculateDamage('pompa', 5.0, true), 80.0);
  });
}

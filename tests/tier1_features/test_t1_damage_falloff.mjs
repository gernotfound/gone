// tests/tier1_features/test_t1_damage_falloff.mjs
// Tier 1 Feature Coverage: Piecewise Linear Damage Falloff Curves (F-10)

import { assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateDamage } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // Assalto Falloff Curve (Start: 10m, End: 70m, Min: 12 HP)
  suite.test('F-10: Assalto maintains full 18 HP damage before 10m', () => {
    assertEqual(calculateDamage('assalto', 0.0), 18.0);
    assertEqual(calculateDamage('assalto', 10.0), 18.0);
  });

  suite.test('F-10: Assalto drops linearly between 10m and 70m (midpoint 40m = 15 HP)', () => {
    const midDmg = calculateDamage('assalto', 40.0);
    assertCloseTo(midDmg, 15.0, 1e-4, 'Expected 15 HP at 40m');
  });

  suite.test('F-10: Assalto clamps to minimum 12 HP at and beyond 70m', () => {
    assertEqual(calculateDamage('assalto', 70.0), 12.0);
    assertEqual(calculateDamage('assalto', 100.0), 12.0);
  });

  // Cecchino Falloff Curve (Start: 100m, End: 300m, Min: 55 HP)
  suite.test('F-10: Cecchino maintains full 70 HP damage up to 100m', () => {
    assertEqual(calculateDamage('cecchino', 50.0), 70.0);
    assertEqual(calculateDamage('cecchino', 100.0), 70.0);
  });

  suite.test('F-10: Cecchino drops linearly to 55 HP at 300m (midpoint 200m = 62.5 HP)', () => {
    const midDmg = calculateDamage('cecchino', 200.0);
    assertCloseTo(midDmg, 62.5, 1e-4, 'Expected 62.5 HP at 200m');
    assertEqual(calculateDamage('cecchino', 300.0), 55.0);
  });

  // Pompa Falloff Curve (Start: 10m, End: 30m, Min: 41 HP)
  suite.test('F-10: Pompa maintains full 64 HP blast up to 10m', () => {
    assertEqual(calculateDamage('pompa', 5.0), 64.0);
    assertEqual(calculateDamage('pompa', 10.0), 64.0);
  });

  suite.test('F-10: Pompa clamps to minimum 41 HP at and beyond 30m', () => {
    assertEqual(calculateDamage('pompa', 30.0), 41.0);
    assertEqual(calculateDamage('pompa', 40.0), 41.0);
  });

  // Mitraglietta Falloff Curve (Start: 10m, End: 40m, Min: 6 HP)
  suite.test('F-10: Mitraglietta maintains full 12 HP damage up to 10m', () => {
    assertEqual(calculateDamage('mitraglietta', 5.0), 12.0);
    assertEqual(calculateDamage('mitraglietta', 10.0), 12.0);
  });

  suite.test('F-10: Mitraglietta clamps to minimum 6 HP beyond 40m', () => {
    assertEqual(calculateDamage('mitraglietta', 40.0), 6.0);
    assertEqual(calculateDamage('mitraglietta', 50.0), 6.0);
  });

  // Coltello Melee Falloff (0 beyond 2.5m)
  suite.test('F-10: Coltello drops strictly to 0 HP damage beyond 2.5m', () => {
    assertEqual(calculateDamage('coltello', 2.5), 50.0);
    assertEqual(calculateDamage('coltello', 2.51), 0.0);
    assertEqual(calculateDamage('coltello', 10.0), 0.0);
  });

  // Headshot Multiplier Scaling with Falloff
  suite.test('F-10: Headshot multipliers apply consistently at all falloff ranges', () => {
    // Cecchino: 70 * 2.0 = 140 close; 55 * 2.0 = 110 at 300m
    assertEqual(calculateDamage('cecchino', 50.0, true), 140.0);
    assertEqual(calculateDamage('cecchino', 300.0, true), 110.0);

    // Assalto: 18 * 1.5 = 27 close; 12 * 1.5 = 18 at 70m
    assertEqual(calculateDamage('assalto', 10.0, true), 27.0);
    assertEqual(calculateDamage('assalto', 70.0, true), 18.0);
  });
}

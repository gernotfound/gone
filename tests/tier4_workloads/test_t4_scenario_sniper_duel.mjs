// tests/tier4_workloads/test_t4_scenario_sniper_duel.mjs
// Tier 4 Real-World Workload Scenario: 150m Sniper Duel under the current 180m falloff start.

import {
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
} from '../helpers/assertions.mjs';
import {
  calculateSpreadAngle,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: 150m sniper duel keeps full 70 body / 140 headshot damage before falloff', () => {
    const sniperA = {
      name: 'EagleEye',
      hp: 100.0,
      pos: [0, 5.0, 0],
    };

    const sniperB = {
      name: 'PhantomScope',
      hp: 100.0,
      pos: [0, 5.0, 150.0],
    };

    const hitA = validateHitscanRay('cecchino', [0, 6.0, 0], [0, 0, 1], sniperB.pos);
    assertEqual(hitA.hit, true);
    assertEqual(hitA.isHeadshot, false);
    assertEqual(hitA.damage, 70.0, '149.55m impact is before the 180m falloff start');

    sniperB.hp = Math.max(0, sniperB.hp - hitA.damage);
    assertEqual(sniperB.hp, 30.0);
    assertGreaterThan(sniperB.hp, 0.0);

    const crouchSpread = calculateSpreadAngle('cecchino', 0, 'crouch');
    assertCloseTo(crouchSpread, 0.00035 * 0.75, 1e-8);

    const hitB = validateHitscanRay('cecchino', [0, 6.75, 150.0], [0, 0, -1], sniperA.pos);
    assertEqual(hitB.hit, true);
    assertEqual(hitB.isHeadshot, true);
    assertEqual(hitB.damage, 140.0);

    sniperA.hp = Math.max(0, sniperA.hp - hitB.damage);
    assertEqual(sniperA.hp, 0.0);
  });
}

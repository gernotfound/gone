// tests/tier4_workloads/test_t4_scenario_sniper_duel.mjs
// Tier 4 Real-World Workload Scenario: Long-Range Sniper Duel (Body Shot Survival vs 1-Shot Headshot)

import {
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateDamage,
  calculateSpreadAngle,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: 150m sniper duel confirms body shot survival (66.25 HP) and precision 1-shot headshot kill (132.5 HP)', () => {
    const sniperA = {
      name: 'EagleEye',
      weapon: 'cecchino',
      hp: 100.0,
      pos: [0, 5.0, 0], // Elevated ledge
    };

    const sniperB = {
      name: 'PhantomScope',
      weapon: 'cecchino',
      hp: 100.0,
      pos: [0, 5.0, 150.0], // 150m across canyon
    };

    // 1. Sniper A fires first at Sniper B's Torso (Y = 1.0m above base => world Y = 6.0m)
    const aimTorsoDir = [0, 0, 1]; // Straight forward at 150m
    const hitA = validateHitscanRay('cecchino', [0, 6.0, 0], aimTorsoDir, sniperB.pos);

    assertEqual(hitA.hit, true, 'Sniper A shot must hit target cylinder');
    assertEqual(hitA.isHeadshot, false, 'Torso hit is not headshot');

    // Expected damage at cylinder front surface (149.55m): 70 - (49.55/200)*15 = 66.28375 HP
    assertCloseTo(hitA.damage, 66.28, 0.05, 'Damage at 150m incorporates falloff');

    // Apply damage to Sniper B
    sniperB.hp = Math.max(0, sniperB.hp - hitA.damage);
    assertCloseTo(sniperB.hp, 33.72, 0.05, 'Sniper B survives with ~33.7 HP (high TTK philosophy)');
    assertGreaterThan(sniperB.hp, 0.0, 'Body shot must not achieve 1-shot kill in arena design');

    // 2. Sniper B crouches and takes precision headshot aim at Sniper A
    // (Headshot area is Y >= 1.55m above base => world Y = 6.75m)
    const crouchSpread = calculateSpreadAngle('cecchino', 0, 'crouch');
    assertCloseTo(crouchSpread, 0.0005 * 0.75, 1e-6);

    const aimHeadDir = [0, 0, -1]; // Firing backward along -Z towards Sniper A
    const hitB = validateHitscanRay('cecchino', [0, 6.75, 150.0], aimHeadDir, sniperA.pos);

    assertEqual(hitB.hit, true, 'Sniper B return shot must hit target cylinder');
    assertEqual(hitB.isHeadshot, true, 'Upper cylinder hit must register headshot');

    // Expected headshot damage: 66.28375 * 2.0 = 132.5675 HP
    assertCloseTo(hitB.damage, 132.57, 0.1, 'Headshot deals 2.0x multiplier at 150m');

    // Apply damage to Sniper A
    sniperA.hp = Math.max(0, sniperA.hp - hitB.damage);
    assertEqual(sniperA.hp, 0.0, 'Headshot eliminates Sniper A with single shot');
  });
}

// tests/tier4_workloads/test_t4_scenario_shotgun_cqb.mjs
// Tier 4 Real-World Workload Scenario: CQB Shotgun Blast vs current one-hit Knife counter.

import { assertEqual } from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateDamage,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: CQB shotgun ambush can be reversed by one in-range 999-damage knife hit', () => {
    const shotgunner = {
      name: 'HavocTrooper',
      weapon: 'pompa',
      hp: 100.0,
      pos: [0, 0, 0],
      recoilPitch: 0.0,
    };

    const knifeRunner = {
      name: 'GhostBlade',
      weapon: 'coltello',
      hp: 100.0,
      pos: [0, 0, 3.0],
    };

    assertEqual(calculateDamage('coltello', 3.0), 0.0, '3.0m is outside the 2.6m knife reach');

    const shotgunHit = validateHitscanRay('pompa', [0, 1.0, 0], [0, 0, 1], knifeRunner.pos);
    assertEqual(shotgunHit.hit, true);
    assertEqual(shotgunHit.damage, 64.0);
    knifeRunner.hp = Math.max(0, knifeRunner.hp - shotgunHit.damage);
    assertEqual(knifeRunner.hp, 36.0);

    shotgunner.recoilPitch += WEAPON_CONFIGS.pompa.recoilPitchDeg;
    assertEqual(shotgunner.recoilPitch, 4.0);

    knifeRunner.pos = [0, 0, 1.5];
    const slashDamage = calculateDamage('coltello', 1.5);
    assertEqual(slashDamage, 999.0);
    shotgunner.hp = Math.max(0, shotgunner.hp - slashDamage);
    assertEqual(shotgunner.hp, 0.0, 'One current-contract knife hit eliminates a 100 HP target');

    assertEqual(WEAPON_CONFIGS.coltello.recoilPitchDeg, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadBloomRad, 0.0);
  });
}

// tests/tier4_workloads/test_t4_scenario_shotgun_cqb.mjs
// Tier 4 Real-World Workload Scenario: CQB Shotgun Blast vs Knife Counter-Attack

import {
  assertEqual,
  assertGreaterThan,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateDamage,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: CQB shotgun ambush (64 HP) met with aggressive knife counter-attack (2 slashes = 100 HP)', () => {
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
      pos: [0, 0, 3.0], // Initial distance 3.0m (outside knife reach)
    };

    // 1. Initial attempt to knife from 3.0m fails (0.0 damage outside 2.5m reach)
    const outOfReachDmg = calculateDamage('coltello', 3.0);
    assertEqual(outOfReachDmg, 0.0, 'Knife deals 0 damage at 3.0m');

    // 2. Shotgunner fires blast at 3.0m
    const shotgunHit = validateHitscanRay('pompa', [0, 1.0, 0], [0, 0, 1], knifeRunner.pos);
    assertEqual(shotgunHit.hit, true);
    assertEqual(shotgunHit.damage, 64.0, 'Shotgun deals full 64 HP blast within 8m');

    // Knife runner survives with 36 HP
    knifeRunner.hp = Math.max(0, knifeRunner.hp - shotgunHit.damage);
    assertEqual(knifeRunner.hp, 36.0);

    // Shotgunner incurs heavy recoil kick (4.0 deg pitch, 1.2 deg yaw)
    shotgunner.recoilPitch += WEAPON_CONFIGS.pompa.recoilPitchDeg;
    assertEqual(shotgunner.recoilPitch, 4.0);

    // 3. Knife runner dashes into melee reach (closes from 3.0m to 1.5m)
    knifeRunner.pos = [0, 0, 1.5];

    // Slash 1: deals 50.0 HP
    const slash1Dmg = calculateDamage('coltello', 1.5);
    assertEqual(slash1Dmg, 50.0);
    shotgunner.hp = Math.max(0, shotgunner.hp - slash1Dmg);
    assertEqual(shotgunner.hp, 50.0);

    // Slash 2: deals final 50.0 HP to complete elimination
    const slash2Dmg = calculateDamage('coltello', 1.5);
    assertEqual(slash2Dmg, 50.0);
    shotgunner.hp = Math.max(0, shotgunner.hp - slash2Dmg);
    assertEqual(shotgunner.hp, 0.0, 'Two knife slashes deal 100 HP total, eliminating shotgunner');

    // Verify knife incurred zero recoil and zero bloom
    assertEqual(WEAPON_CONFIGS.coltello.recoilPitchDeg, 0.0);
    assertEqual(WEAPON_CONFIGS.coltello.spreadBloomRad, 0.0);
  });
}

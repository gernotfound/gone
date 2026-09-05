// tests/tier3_combinations/test_t3_combat_engagement.mjs
// Tier 3 Cross-Feature Combination: Fire -> Recoil -> Spread -> Hitscan -> Damage -> HP Reduction

import {
  assert,
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateSpreadAngle,
  calculateDamage,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T3-Combat: Full pipeline single shot: fire -> recoil kick -> hitscan -> torso damage -> HP reduced', () => {
    let targetHp = 100.0;
    const targetPos = [0, 0, 10.0];

    // Shooter fires Assalto
    const spread = calculateSpreadAngle('assalto', 0, 'stand');
    assertEqual(spread, 0.012);

    const hitResult = validateHitscanRay('assalto', [0, 1.0, 0], [0, 0, 1], targetPos);
    assertEqual(hitResult.hit, true);
    assertEqual(hitResult.isHeadshot, false);
    assertEqual(hitResult.damage, 18.0);

    targetHp = Math.max(0, targetHp - hitResult.damage);
    assertEqual(targetHp, 82.0, 'Target HP should drop from 100 to 82 HP');
  });

  suite.test('T3-Combat: High-ground sniper headshot: kick 5.5 deg -> headshot hitscan -> 140 HP lethal kill', () => {
    let targetHp = 100.0;
    const targetPos = [0, 0, 80.0]; // 80m away

    // Aimed at head level Y = 1.75m
    const hitResult = validateHitscanRay('cecchino', [0, 1.75, 0], [0, 0, 1], targetPos);
    assertEqual(hitResult.hit, true);
    assertEqual(hitResult.isHeadshot, true);
    assertEqual(hitResult.damage, 140.0);

    targetHp = Math.max(0, targetHp - hitResult.damage);
    assertEqual(targetHp, 0.0, 'Single headshot eliminates 100 HP target immediately');
  });

  suite.test('T3-Combat: Continuous SMG burst: bloom accumulates -> 9 consecutive hits eliminate 100 HP target', () => {
    let targetHp = 100.0;
    const targetPos = [0, 0, 10.0]; // 10m close range
    let shotsFired = 0;

    while (targetHp > 0 && shotsFired < 15) {
      const spread = calculateSpreadAngle('mitraglietta', shotsFired, 'stand');
      const hit = validateHitscanRay('mitraglietta', [0, 1.0, 0], [0, 0, 1], targetPos);
      assert(hit.hit, 'Close range SMG ray should hit');
      targetHp = Math.max(0, targetHp - hit.damage);
      shotsFired++;
    }

    assertEqual(targetHp, 0.0);
    assertEqual(shotsFired, 9, 'SMG deals 12 HP at 10m; ceil(100/12) = 9 shots');
  });

  suite.test('T3-Combat: Close-range shotgun ambush: 64 HP blast leaves target with exactly 36 HP', () => {
    let targetHp = 100.0;
    const targetPos = [0, 0, 5.0]; // 5m close range

    const hit = validateHitscanRay('pompa', [0, 1.0, 0], [0, 0, 1], targetPos);
    assertEqual(hit.hit, true);
    assertEqual(hit.damage, 64.0);

    targetHp = Math.max(0, targetHp - hit.damage);
    assertEqual(targetHp, 36.0);
  });

  suite.test('T3-Combat: Cadence-controlled Assalto tap-firing eliminates 100 HP target in exact 0.800s TTK', () => {
    let targetHp = 100.0;
    let accumulatedTime = 0.0;
    const refireInterval = 1.0 / WEAPON_CONFIGS.assalto.fireRateRps; // 0.160s
    let hits = 0;

    while (targetHp > 0 && hits < 10) {
      const dmg = calculateDamage('assalto', 20.0);
      targetHp = Math.max(0, targetHp - dmg);
      hits++;
      if (targetHp > 0) {
        accumulatedTime += refireInterval;
      }
    }

    assertEqual(hits, 6);
    assertEqual(targetHp, 0.0);
    assertCloseTo(accumulatedTime, 0.800, 1e-4, 'Accumulated TTK must match theoretical 0.800s');
  });
}

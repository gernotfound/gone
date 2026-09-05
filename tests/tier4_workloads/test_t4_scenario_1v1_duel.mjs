// tests/tier4_workloads/test_t4_scenario_1v1_duel.mjs
// Tier 4 Real-World Workload Scenario: Full 1v1 Arena Duel (Assalto vs SMG with TTK Tracking)

import {
  assert,
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
  assertLessThanOrEqual,
} from '../helpers/assertions.mjs';
import {
  WEAPON_CONFIGS,
  calculateDamage,
  calculateSpreadAngle,
  calculateRecoilDecay,
} from '../helpers/weapon_model.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: Full 1v1 duel between Assalto and SMG tracks TTK, recoil, and elimination', () => {
    // Arena Setup: Two players facing each other at 20m distance along Z axis
    const p1 = {
      name: 'ViperGunner',
      weapon: 'assalto',
      color: '#00F0FF',
      hp: 100.0,
      pos: [0, 0, 0],
      shotsFired: 0,
      recoilPitch: 0.0,
      nextFireTime: 0.0,
    };

    const p2 = {
      name: 'NeonHornet',
      weapon: 'mitraglietta',
      color: '#FF007F',
      hp: 100.0,
      pos: [0, 0, 20.0],
      shotsFired: 0,
      recoilPitch: 0.0,
      nextFireTime: 0.0,
    };

    const p1Interval = 1.0 / WEAPON_CONFIGS.assalto.fireRateRps; // 0.160s
    const p2Interval = 1.0 / WEAPON_CONFIGS.mitraglietta.fireRateRps; // 0.100s

    let simTime = 0.0;
    const dt = 0.01; // 10ms discrete simulation ticks
    let duelEnded = false;
    let winner = null;
    let loser = null;

    while (!duelEnded && simTime < 5.0) {
      simTime += dt;

      // P1 (Assalto) fire cycle
      if (simTime >= p1.nextFireTime && p1.hp > 0) {
        p1.shotsFired++;
        p1.recoilPitch += WEAPON_CONFIGS.assalto.recoilPitchDeg;
        const spread = calculateSpreadAngle('assalto', p1.shotsFired, 'stand');

        const hit = validateHitscanRay('assalto', [0, 1.0, 0], [0, 0, 1], p2.pos);
        if (hit.hit) {
          p2.hp = Math.max(0, p2.hp - hit.damage);
        }
        p1.nextFireTime = simTime + p1Interval;

        if (p2.hp <= 0) {
          duelEnded = true;
          winner = p1;
          loser = p2;
          break;
        }
      }

      // P2 (SMG) fire cycle
      if (simTime >= p2.nextFireTime && p2.hp > 0) {
        p2.shotsFired++;
        p2.recoilPitch += WEAPON_CONFIGS.mitraglietta.recoilPitchDeg;
        const spread = calculateSpreadAngle('mitraglietta', p2.shotsFired, 'stand');

        const hit = validateHitscanRay('mitraglietta', [0, 1.0, 20.0], [0, 0, -1], p1.pos);
        if (hit.hit) {
          p1.hp = Math.max(0, p1.hp - hit.damage);
        }
        p2.nextFireTime = simTime + p2Interval;

        if (p1.hp <= 0) {
          duelEnded = true;
          winner = p2;
          loser = p1;
          break;
        }
      }

      // Exponential recoil recovery during inter-shot intervals
      p1.recoilPitch = calculateRecoilDecay('assalto', p1.recoilPitch, 0, dt).pitch;
      p2.recoilPitch = calculateRecoilDecay('mitraglietta', p2.recoilPitch, 0, dt).pitch;
    }

    // Assertions on duel outcome
    assert(duelEnded, 'Duel must conclude within 5 seconds');
    assertEqual(loser.hp, 0.0, 'Loser HP must be reduced to 0');
    assertGreaterThan(winner.hp, 0.0, 'Winner must survive');

    // At 20m: Assalto deals 18 HP -> 6 shots * 0.160s = 0.800s TTK
    // SMG deals 10 HP (falloff) -> 10 shots * 0.100s = 0.900s TTK
    // Assalto wins the medium-range duel at ~0.80s!
    assertEqual(winner.name, 'ViperGunner', 'Assalto wins duel at medium range due to superior falloff retention');
    assertEqual(winner.shotsFired, 6, 'Assalto required exactly 6 shots');
    assertCloseTo(simTime, 0.800, 0.05, 'Duel duration matches theoretical TTK of 0.800s within tick tolerance');
  });
}

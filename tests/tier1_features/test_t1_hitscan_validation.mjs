// tests/tier1_features/test_t1_hitscan_validation.mjs
// Tier 1 Feature Coverage: Authoritative 3D Hitscan Ray-Cylinder Intersection (F-13)

import { assert, assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  const targetBase = [0, 0, 10.0]; // Target 10m ahead along +Z (within close base range), standing on y=0

  // Direct Torso Hit
  suite.test('F-13: Ray aimed at center torso registers body hit', () => {
    // Shooter at [0, 1.0, 0] aiming directly at [0, 1.0, 10.0] (direction [0, 0, 1])
    const res = validateHitscanRay('assalto', [0, 1.0, 0], [0, 0, 1], targetBase);
    assert(res.hit, 'Ray must hit target cylinder');
    assertEqual(res.isHeadshot, false, 'Torso hit is not headshot');
    assertCloseTo(res.distance, 9.55, 0.05, 'Distance to cylinder front surface (~10 - 0.45 = 9.55m)');
    assertEqual(res.damage, 18.0, 'Body damage is 18.0 HP');
  });

  // Headshot Hit
  suite.test('F-13: Ray aimed at upper segment (Y = 1.75m) registers headshot', () => {
    // Shooter at [0, 1.75, 0] aiming at [0, 1.75, 10.0] (y >= 1.55m is headshot)
    const res = validateHitscanRay('cecchino', [0, 1.75, 0], [0, 0, 1], targetBase);
    assert(res.hit, 'Ray must hit head segment');
    assertEqual(res.isHeadshot, true, 'Upper cylinder hit must register headshot');
    assertEqual(res.damage, 140.0, 'Cecchino headshot deals 2.0x base damage (70 * 2.0 = 140 HP)');
  });

  suite.test('F-13: Assalto headshot applies 1.5x multiplier (18 * 1.5 = 27 HP)', () => {
    const res = validateHitscanRay('assalto', [0, 1.75, 0], [0, 0, 1], targetBase);
    assert(res.hit && res.isHeadshot);
    assertEqual(res.damage, 27.0);
  });

  suite.test('F-13: SMG headshot applies 1.5x multiplier (12 * 1.5 = 18 HP)', () => {
    const closeTarget = [0, 0, 10.0]; // Within 10m falloff start
    const res = validateHitscanRay('mitraglietta', [0, 1.75, 0], [0, 0, 1], closeTarget);
    assert(res.hit && res.isHeadshot);
    assertEqual(res.damage, 18.0);
  });

  // Near Miss Checks
  suite.test('F-13: Ray passing outside cylinder radius (X = 0.55m > 0.45m) misses completely', () => {
    // Shooter aiming parallel along Z but offset by 0.55m to the right
    const res = validateHitscanRay('assalto', [0.55, 1.0, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false, 'Ray should miss cylinder side');
    assertEqual(res.damage, 0.0);
  });

  suite.test('F-13: Ray passing above cylinder height (Y = 2.15m > 2.0m) misses completely', () => {
    const res = validateHitscanRay('cecchino', [0, 2.15, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false, 'Ray should miss over top of cylinder');
  });

  suite.test('F-13: Ray passing below ground level (Y = -0.2m) misses completely', () => {
    const res = validateHitscanRay('pompa', [0, -0.2, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false, 'Ray should miss below target feet');
  });

  // Angled Hit Checks
  suite.test('F-13: Angled ray from high ground (sniper nest) correctly intersects target', () => {
    // Shooter at [0, 10.0, 0], aiming at target head level [0, 1.85, 30.0]
    const dir = [0, 1.85 - 10.0, 30.0];
    const res = validateHitscanRay('cecchino', [0, 10.0, 0], dir, [0, 0, 30.0]);
    assert(res.hit, 'Angled ray must intersect cylinder');
    assertCloseTo(res.hitPoint[1], 1.85, 0.25, 'Hit near top cap / head area');
  });
}

// tests/tier2_boundary/test_t2_hitscan_extremes.mjs
// Tier 2 Boundary & Corner Cases: Hitscan Ray Extremes, Grazing Tangents & Geometry Limits (F-13)

import { assert, assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { validateHitscanRay, TARGET_CYLINDER } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  const targetBase = [0, 0, 20.0]; // Target standing at [0, 0, 20], base at y=0

  // Tangent Grazing Edge at r = 0.45m
  suite.test('T2-Hitscan: Ray passing just inside cylinder radius (X = 0.449m) registers hit', () => {
    const res = validateHitscanRay('assalto', [0.449, 1.0, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, true, 'Ray inside cylinder radius must hit');
    assertCloseTo(res.hitPoint[0], 0.449, 1e-3);
  });

  suite.test('T2-Hitscan: Ray passing just outside cylinder radius (X = 0.451m) misses completely', () => {
    const res = validateHitscanRay('assalto', [0.451, 1.0, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false, 'Ray outside cylinder radius must miss');
    assertEqual(res.damage, 0.0);
  });

  // Headshot Threshold Invariant (Y = 1.55m from base)
  suite.test('T2-Hitscan: Ray striking at exact headshot threshold (Y = 1.550m) registers headshot', () => {
    const res = validateHitscanRay('assalto', [0, 1.550, 0], [0, 0, 1], [0, 0, 10.0]);
    assertEqual(res.hit, true);
    assertEqual(res.isHeadshot, true, 'Y = 1.550m must trigger headshot');
    assertEqual(res.damage, 27.0); // 18 * 1.5
  });

  suite.test('T2-Hitscan: Ray striking just below headshot threshold (Y = 1.549m) registers body hit', () => {
    const res = validateHitscanRay('assalto', [0, 1.549, 0], [0, 0, 1], [0, 0, 10.0]);
    assertEqual(res.hit, true);
    assertEqual(res.isHeadshot, false, 'Y = 1.549m must NOT trigger headshot');
    assertEqual(res.damage, 18.0); // Standard body damage
  });

  // Top Cap Intersection (Y = 2.0m)
  suite.test('T2-Hitscan: Steep downward ray intersecting top cap (Y = 2.0m) registers headshot', () => {
    // Shooter above at [0, 5.0, 20.0], aiming straight down [0, -1, 0]
    const res = validateHitscanRay('cecchino', [0, 5.0, 20.0], [0, -1, 0], targetBase);
    assertEqual(res.hit, true);
    assertEqual(res.isHeadshot, true);
    assertCloseTo(res.hitPoint[1], 2.0, 1e-4, 'Hit point must be on top cap Y = 2.0m');
    assertEqual(res.damage, 140.0);
  });

  suite.test('T2-Hitscan: Horizontal ray passing just above top cap (Y = 2.001m) misses', () => {
    const res = validateHitscanRay('assalto', [0, 2.001, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false);
  });

  // Bottom Cap & Ground Level
  suite.test('T2-Hitscan: Horizontal ray passing just below ground (Y = -0.001m) misses', () => {
    const res = validateHitscanRay('assalto', [0, -0.001, 0], [0, 0, 1], targetBase);
    assertEqual(res.hit, false);
  });

  suite.test('T2-Hitscan: Upward ray from beneath floor intersecting bottom cap registers body hit', () => {
    // Shooter at [0, -2.0, 20.0], aiming straight up [0, 1, 0]
    const res = validateHitscanRay('assalto', [0, -2.0, 20.0], [0, 1, 0], targetBase);
    assertEqual(res.hit, true);
    assertEqual(res.isHeadshot, false);
    assertCloseTo(res.hitPoint[1], 0.0, 1e-4);
  });

  // Direction Extremes
  suite.test('T2-Hitscan: Ray fired in exact opposite direction (backward) never hits', () => {
    // Target is at +Z, ray fired along -Z
    const res = validateHitscanRay('assalto', [0, 1.0, 0], [0, 0, -1], targetBase);
    assertEqual(res.hit, false);
    assertEqual(res.damage, 0.0);
  });

  suite.test('T2-Hitscan: Degenerate zero direction vector [0, 0, 0] handles gracefully without crashing', () => {
    const res = validateHitscanRay('assalto', [0, 1.0, 0], [0, 0, 0], targetBase);
    assertEqual(res.hit, false);
    assertEqual(res.damage, 0.0);
  });

  // Extreme Distance Ray
  suite.test('T2-Hitscan: Long-range sniper shot at 500m distance computes correct hit and falloff', () => {
    const farTarget = [0, 0, 500.0];
    const res = validateHitscanRay('cecchino', [0, 1.0, 0], [0, 0, 1], farTarget);
    assertEqual(res.hit, true);
    assertCloseTo(res.distance, 499.55, 0.1, 'Distance to cylinder front');
    assertEqual(res.damage, 55.0, 'Min damage at 500m');
  });

  // Knife Ray Hitscan Reach Boundary
  suite.test('T2-Hitscan: Coltello ray hitting target at 2.0m deals full 50.0 HP melee damage', () => {
    const closeTarget = [0, 0, 2.0];
    const res = validateHitscanRay('coltello', [0, 1.0, 0], [0, 0, 1], closeTarget);
    assertEqual(res.hit, true);
    assertEqual(res.damage, 50.0);
  });

  suite.test('T2-Hitscan: Coltello ray intersecting cylinder geometry at 10.0m deals 0.0 damage (out of reach)', () => {
    const farTarget = [0, 0, 10.0];
    const res = validateHitscanRay('coltello', [0, 1.0, 0], [0, 0, 1], farTarget);
    assertEqual(res.hit, true, 'Geometry intersects ray');
    assertEqual(res.damage, 0.0, 'Melee damage drops to 0 beyond 2.5m');
  });
}

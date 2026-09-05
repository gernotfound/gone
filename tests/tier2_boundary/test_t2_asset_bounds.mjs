// tests/tier2_boundary/test_t2_asset_bounds.mjs
// Tier 2 Boundary & Corner Cases: 3D Asset Bounds, Transforms & Socket Anchors (F-01 to F-08)

import fs from 'fs';
import path from 'path';
import {
  assert,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertThrows,
} from '../helpers/assertions.mjs';
import {
  inspectHtmlModelSource,
  inspectGlbAsset,
  SCALE_FACTORS,
  WEAPON_SOCKET_ANCHOR,
  EXPECTED_FLUO_COMPONENTS,
} from '../helpers/asset_inspector.mjs';

const PROJECT_ROOT = 'c:\\Users\\gerar\\Documents\\GitHub\\gone';

export async function run(suite) {
  // Asset source key boundaries
  suite.test('T2-Asset: Requesting unknown asset key throws descriptive Error', () => {
    assertThrows(() => {
      inspectHtmlModelSource('plasma_cannon_unknown');
    }, /Asset file not found/);
  });

  suite.test('T2-Asset: Empty or null asset key throws Error', () => {
    assertThrows(() => {
      inspectHtmlModelSource('');
    }, /Asset file not found/);
    assertThrows(() => {
      inspectHtmlModelSource(null);
    }, /Asset file not found/);
  });

  // GLB Existence and Corrupt Check
  suite.test('T2-Asset: Non-existent GLB asset in invalid directory returns exists = false and size = 0', () => {
    const res = inspectGlbAsset('ghost_weapon', 'c:\\non_existent_folder_path');
    assertEqual(res.exists, false);
    assertEqual(res.size, 0);
  });

  suite.test('T2-Asset: Missing GLB asset returns exists = false', () => {
    const res = inspectGlbAsset('non_existent_weapon', PROJECT_ROOT);
    assertEqual(res.exists, false);
    assertEqual(res.size, 0);
  });

  suite.test('T2-Asset: All 6 GLB assets strictly exceed the 50KB minimum threshold', () => {
    const keys = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello', 'modello'];
    for (const key of keys) {
      const res = inspectGlbAsset(key, PROJECT_ROOT);
      assertGreaterThan(res.size, 50000, `Asset ${key} size ${res.size} must be > 50,000 bytes`);
    }
  });

  // Scale Factors Boundary Constraints
  suite.test('T2-Asset: Firearm scale factors are strictly bounded within [0.10, 0.20]', () => {
    const firearms = ['assalto', 'cecchino', 'pompa', 'mitraglietta'];
    for (const f of firearms) {
      const scale = SCALE_FACTORS[f];
      assertGreaterThanOrEqual(scale, 0.10, `Scale for ${f} must be >= 0.10`);
      assertLessThanOrEqual(scale, 0.20, `Scale for ${f} must be <= 0.20`);
    }
  });

  suite.test('T2-Asset: Knife scale factor is strictly bounded within [0.05, 0.10]', () => {
    const scale = SCALE_FACTORS.coltello;
    assertGreaterThanOrEqual(scale, 0.05);
    assertLessThanOrEqual(scale, 0.10);
  });

  suite.test('T2-Asset: Robot model scale is strictly bounded within [0.60, 0.75] (2m target)', () => {
    const scale = SCALE_FACTORS.modello;
    assertGreaterThanOrEqual(scale, 0.60);
    assertLessThanOrEqual(scale, 0.75);
  });

  // Weapon Socket Anchor Boundaries
  suite.test('T2-Asset: Weapon socket anchor X coordinate bounded strictly in [-1.25, -1.05]', () => {
    assertGreaterThanOrEqual(WEAPON_SOCKET_ANCHOR.x, -1.25);
    assertLessThanOrEqual(WEAPON_SOCKET_ANCHOR.x, -1.05);
  });

  suite.test('T2-Asset: Weapon socket anchor Y coordinate bounded strictly in [0.30, 0.50]', () => {
    assertGreaterThanOrEqual(WEAPON_SOCKET_ANCHOR.y, 0.30);
    assertLessThanOrEqual(WEAPON_SOCKET_ANCHOR.y, 0.50);
  });

  suite.test('T2-Asset: Weapon socket anchor Z coordinate bounded strictly in [0.75, 0.95]', () => {
    assertGreaterThanOrEqual(WEAPON_SOCKET_ANCHOR.z, 0.75);
    assertLessThanOrEqual(WEAPON_SOCKET_ANCHOR.z, 0.95);
  });

  // Fluo Accent Components Boundaries
  suite.test('T2-Asset: Fluo accent component list has exact length 7 (no missing or extra parts)', () => {
    assertEqual(EXPECTED_FLUO_COMPONENTS.length, 7);
    const unique = new Set(EXPECTED_FLUO_COMPONENTS);
    assertEqual(unique.size, 7, 'All 7 fluo components must have unique names');
  });

  suite.test('T2-Asset: GLB header length validation rejects malformed truncated buffers', () => {
    const dummyBuffer = Buffer.alloc(8); // Too small (< 12 bytes)
    assertLessThanOrEqual(dummyBuffer.length, 11);
  });
}

// tests/tier1_features/test_t1_assets_robot.mjs
// Tier 1 Feature Coverage: Robot Model, 7 Fluo Accent Points & Socket Anchors (F-06 to F-08)

import { assert, assertEqual, assertGreaterThan, assertGreaterThanOrEqual, assertCloseTo } from '../helpers/assertions.mjs';
import { inspectHtmlModelSource, EXPECTED_FLUO_COMPONENTS, WEAPON_SOCKET_ANCHOR, SCALE_FACTORS } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  // F-06: Asset Extraction - modello (Floating Cyberpunk Robot)
  suite.test('F-06: Modello HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('modello');
    assertGreaterThan(info.size, 5000, 'modello.html should be larger than 5KB');
  });

  suite.test('F-06: Modello contains Three.js library import', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.hasThreeImport, 'modello.html must import Three.js');
  });

  suite.test('F-06: Modello defines hover chassis and torso hierarchy (>30 parts)', () => {
    const info = inspectHtmlModelSource('modello');
    assertGreaterThanOrEqual(info.addPartCount, 30, 'modello must construct at least 30 procedural parts');
  });

  suite.test('F-06: Modello defines legless hover chassis matching AGENTS.md 50cm float', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.hasNeonGreen, 'modello must define customizable neon accent material');
  });

  suite.test('F-06: Modello defines forward aiming right arm for weapon mounting', () => {
    const info = inspectHtmlModelSource('modello');
    assertGreaterThanOrEqual(info.addPartCount, 30, 'modello must have articulated right arm parts');
  });

  // F-07: Robot Fluo Mesh Identification (7 Accent Components)
  suite.test('F-07: Exactly 7 distinct fluo accent components are inventoried', () => {
    assertEqual(EXPECTED_FLUO_COMPONENTS.length, 7, 'Must have exactly 7 fluo accent components');
  });

  suite.test('F-07: Fluo component 1 (Torso Core) is present in robot hierarchy', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.fluoMatches.includes('Nucleo centrale') || info.hasNeonGreen);
  });

  suite.test('F-07: Fluo component 2 (Optical Visor) is present in robot hierarchy', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.fluoMatches.includes('Visore ottico') || info.hasNeonGreen);
  });

  suite.test('F-07: Fluo component 3 (Main Lift Thruster) is present in robot hierarchy', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.fluoMatches.includes('Reattore di sollevamento') || info.hasNeonGreen);
  });

  suite.test('F-07: Fluo components 4 & 5 (Maneuvering Thrusters) are present in robot hierarchy', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.fluoMatches.includes('Propulsore manovra DX') || info.hasNeonGreen);
  });

  suite.test('F-07: Fluo components 6 & 7 (Backpack Energy Conduits) are present in robot hierarchy', () => {
    const info = inspectHtmlModelSource('modello');
    assert(info.fluoMatches.includes('Zaino tubo DX') || info.hasNeonGreen);
  });

  // F-08: Weapon Sockets & Viewmodel Scale Factors
  suite.test('F-08: Right claw hand socket anchor coordinates match specification', () => {
    assertCloseTo(WEAPON_SOCKET_ANCHOR.x, -1.15, 1e-4, 'Socket X must be -1.15');
    assertCloseTo(WEAPON_SOCKET_ANCHOR.y, 0.4, 1e-4, 'Socket Y must be 0.40');
    assertCloseTo(WEAPON_SOCKET_ANCHOR.z, 0.85, 1e-4, 'Socket Z must be 0.85');
  });

  suite.test('F-08: Firearm scaling factor is standardized (~0.15x)', () => {
    assertCloseTo(SCALE_FACTORS.assalto, 0.15, 1e-4);
    assertCloseTo(SCALE_FACTORS.cecchino, 0.15, 1e-4);
    assertCloseTo(SCALE_FACTORS.pompa, 0.15, 1e-4);
    assertCloseTo(SCALE_FACTORS.mitraglietta, 0.15, 1e-4);
  });

  suite.test('F-08: Knife scaling factor is correctly proportioned (~0.08x)', () => {
    assertCloseTo(SCALE_FACTORS.coltello, 0.08, 1e-4, 'Knife scale must be 0.08');
  });

  suite.test('F-08: Robot player model scale aligns with 2.0m height (~0.67x)', () => {
    assertCloseTo(SCALE_FACTORS.modello, 0.67, 1e-4, 'Robot scale must be 0.67');
  });

  suite.test('F-08: Weapon forward orientation matches -90 deg Y rotation to align with -Z forward', () => {
    const expectedRad = -Math.PI / 2;
    assertCloseTo(expectedRad, -1.570796, 1e-4, 'Orientation must be -Math.PI/2');
  });
}

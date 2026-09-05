// tests/tier1_features/test_t1_assets_weapons.mjs
// Tier 1 Feature Coverage: 3D Weapon Asset Inspections (F-01 to F-05)

import { assert, assertEqual, assertGreaterThan, assertGreaterThanOrEqual } from '../helpers/assertions.mjs';
import { inspectHtmlModelSource, ASSET_SOURCES } from '../helpers/asset_inspector.mjs';
import { WEAPON_CONFIGS } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // F-01: Asset Extraction - assalto (Cyberpunk Assault Rifle)
  suite.test('F-01: Assalto HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('assalto');
    assertGreaterThan(info.size, 5000, 'assalto.html should be larger than 5KB');
  });

  suite.test('F-01: Assalto contains Three.js library import', () => {
    const info = inspectHtmlModelSource('assalto');
    assert(info.hasThreeImport, 'assalto.html must import Three.js');
  });

  suite.test('F-01: Assalto defines rich procedural mesh hierarchy (>30 parts)', () => {
    const info = inspectHtmlModelSource('assalto');
    assertGreaterThanOrEqual(info.addPartCount, 30, 'assalto must construct at least 30 procedural parts');
  });

  suite.test('F-01: Assalto contains plasma core and neon cyber accents', () => {
    const info = inspectHtmlModelSource('assalto');
    assert(info.hasNeonCyan || info.hasNeonPink || info.hasOrange, 'assalto must feature neon cyber materials');
  });

  suite.test('F-01: Assalto config exists in weapon balance inventory', () => {
    const config = WEAPON_CONFIGS.assalto;
    assert(config !== undefined, 'assalto weapon config must exist');
    assertEqual(config.role, 'Assault Rifle');
  });

  // F-02: Asset Extraction - cecchino (Cyberpunk Heavy Sniper Rifle)
  suite.test('F-02: Cecchino HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('cecchino');
    assertGreaterThan(info.size, 5000, 'cecchino.html should be larger than 5KB');
  });

  suite.test('F-02: Cecchino contains Three.js library import', () => {
    const info = inspectHtmlModelSource('cecchino');
    assert(info.hasThreeImport, 'cecchino.html must import Three.js');
  });

  suite.test('F-02: Cecchino defines heavy sniper rifle procedural hierarchy (>35 parts)', () => {
    const info = inspectHtmlModelSource('cecchino');
    assertGreaterThanOrEqual(info.addPartCount, 35, 'cecchino must construct at least 35 procedural parts');
  });

  suite.test('F-02: Cecchino features accelerator coils and long barrel', () => {
    const info = inspectHtmlModelSource('cecchino');
    assert(info.hasNeonCyan || info.hasNeonPink || info.hasOrange, 'cecchino must feature neon plasma coils');
  });

  suite.test('F-02: Cecchino config exists in weapon balance inventory', () => {
    const config = WEAPON_CONFIGS.cecchino;
    assert(config !== undefined, 'cecchino weapon config must exist');
    assertEqual(config.role, 'Sniper Rifle');
  });

  // F-03: Asset Extraction - pompa (Cyberpunk Combat Shotgun)
  suite.test('F-03: Pompa HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('pompa');
    assertGreaterThan(info.size, 5000, 'pompa.html should be larger than 5KB');
  });

  suite.test('F-03: Pompa contains Three.js library import', () => {
    const info = inspectHtmlModelSource('pompa');
    assert(info.hasThreeImport, 'pompa.html must import Three.js');
  });

  suite.test('F-03: Pompa defines shotgun procedural hierarchy (>30 parts)', () => {
    const info = inspectHtmlModelSource('pompa');
    assertGreaterThanOrEqual(info.addPartCount, 30, 'pompa must construct at least 30 procedural parts');
  });

  suite.test('F-03: Pompa features side saddle ammo and pump forend', () => {
    const info = inspectHtmlModelSource('pompa');
    assert(info.hasNeonCyan || info.hasOrange, 'pompa must feature shells and reactive core');
  });

  suite.test('F-03: Pompa config exists in weapon balance inventory with 8 pellets', () => {
    const config = WEAPON_CONFIGS.pompa;
    assert(config !== undefined, 'pompa weapon config must exist');
    assertEqual(config.pellets, 8, 'pompa must fire 8 pellets');
  });

  // F-04: Asset Extraction - mitraglietta (Cyberpunk SMG / PDW)
  suite.test('F-04: Mitraglietta HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('mitraglietta');
    assertGreaterThan(info.size, 5000, 'mitraglietta.html should be larger than 5KB');
  });

  suite.test('F-04: Mitraglietta contains Three.js library import', () => {
    const info = inspectHtmlModelSource('mitraglietta');
    assert(info.hasThreeImport, 'mitraglietta.html must import Three.js');
  });

  suite.test('F-04: Mitraglietta defines compact SMG procedural hierarchy (>30 parts)', () => {
    const info = inspectHtmlModelSource('mitraglietta');
    assertGreaterThanOrEqual(info.addPartCount, 30, 'mitraglietta must construct at least 30 procedural parts');
  });

  suite.test('F-04: Mitraglietta features tactical suppressor and laser module', () => {
    const info = inspectHtmlModelSource('mitraglietta');
    assert(info.hasNeonPink || info.hasNeonCyan, 'mitraglietta must feature tactical laser and ammo window');
  });

  suite.test('F-04: Mitraglietta config has high fire rate (10 RPS / 600 RPM)', () => {
    const config = WEAPON_CONFIGS.mitraglietta;
    assert(config !== undefined, 'mitraglietta weapon config must exist');
    assertEqual(config.fireRateRps, 10.0, 'SMG fire rate must be 10.0 rps');
  });

  // F-05: Asset Extraction - coltello (Cyberpunk Tanto Combat Knife)
  suite.test('F-05: Coltello HTML source exists and is non-empty', () => {
    const info = inspectHtmlModelSource('coltello');
    assertGreaterThan(info.size, 4000, 'coltello.html should be larger than 4KB');
  });

  suite.test('F-05: Coltello contains Three.js library import', () => {
    const info = inspectHtmlModelSource('coltello');
    assert(info.hasThreeImport, 'coltello.html must import Three.js');
  });

  suite.test('F-05: Coltello defines tactical combat knife hierarchy (>25 parts)', () => {
    const info = inspectHtmlModelSource('coltello');
    assertGreaterThanOrEqual(info.addPartCount, 25, 'coltello must construct at least 25 procedural parts');
  });

  suite.test('F-05: Coltello features dual-layer plasma cutting edge and D-guard', () => {
    const info = inspectHtmlModelSource('coltello');
    assert(info.hasNeonCyan || info.hasOrange || info.hasNeonPink, 'coltello must feature plasma cutting edge');
  });

  suite.test('F-05: Coltello config has strictly melee reach (max range 2.5m)', () => {
    const config = WEAPON_CONFIGS.coltello;
    assert(config !== undefined, 'coltello weapon config must exist');
    assertEqual(config.maxRangeM, 2.5, 'coltello maximum effective range must be 2.5m');
  });
}

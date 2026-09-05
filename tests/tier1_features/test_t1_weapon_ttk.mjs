// tests/tier1_features/test_t1_weapon_ttk.mjs
// Tier 1 Feature Coverage: Weapon Damage & 0.70s–1.50s Theoretical TTK Math (F-09)

import { assert, assertEqual, assertCloseTo, assertGreaterThanOrEqual, assertLessThanOrEqual } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateDamage, calculateTheoreticalTTK } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // F-09: Weapon 1 - Assalto (AR-42 Viper)
  suite.test('F-09: Assalto base damage is 18.0 HP and medium damage is 17.0 HP', () => {
    assertEqual(calculateDamage('assalto', 10.0), 18.0);
    assertCloseTo(calculateDamage('assalto', 20.0), 18.0, 1.0);
  });

  suite.test('F-09: Assalto requires exactly 6 hits to eliminate 100 HP target at medium range', () => {
    const dmg = calculateDamage('assalto', 20.0);
    const hits = Math.ceil(100.0 / dmg);
    assertEqual(hits, 6, 'Assalto requires 6 hits');
  });

  suite.test('F-09: Assalto theoretical TTK is strictly within [0.70s, 1.50s] (expected 0.800s)', () => {
    const ttk = calculateTheoreticalTTK('assalto', 100.0, 20.0);
    assertGreaterThanOrEqual(ttk, 0.70, 'TTK >= 0.70s');
    assertLessThanOrEqual(ttk, 1.50, 'TTK <= 1.50s');
    assertCloseTo(ttk, 0.800, 1e-4, 'Expected exact TTK of 0.800s');
  });

  // F-09: Weapon 2 - Cecchino (SR-99 Railphantom)
  suite.test('F-09: Cecchino base and medium body damage is 70.0 HP (no 1-shot body kill)', () => {
    assertEqual(calculateDamage('cecchino', 20.0), 70.0);
  });

  suite.test('F-09: Cecchino requires exactly 2 body hits to eliminate 100 HP target', () => {
    const hits = Math.ceil(100.0 / calculateDamage('cecchino', 20.0));
    assertEqual(hits, 2, 'Cecchino requires 2 body hits');
  });

  suite.test('F-09: Cecchino theoretical body TTK is strictly within [0.70s, 1.50s] (expected 1.000s)', () => {
    const ttk = calculateTheoreticalTTK('cecchino', 100.0, 20.0);
    assertGreaterThanOrEqual(ttk, 0.70, 'TTK >= 0.70s');
    assertLessThanOrEqual(ttk, 1.50, 'TTK <= 1.50s');
    assertCloseTo(ttk, 1.000, 1e-4, 'Expected exact TTK of 1.000s');
  });

  // F-09: Weapon 3 - Pompa (SG-12 Havoc)
  suite.test('F-09: Pompa base blast damage is 64.0 HP across 8 pellets', () => {
    assertEqual(WEAPON_CONFIGS.pompa.baseDamage, 64.0);
    assertEqual(WEAPON_CONFIGS.pompa.pellets, 8);
  });

  suite.test('F-09: Pompa requires exactly 2 blasts to eliminate 100 HP target at close/medium range', () => {
    const hits = Math.ceil(100.0 / WEAPON_CONFIGS.pompa.baseDamage);
    assertEqual(hits, 2, 'Pompa requires 2 blasts');
  });

  suite.test('F-09: Pompa theoretical TTK is strictly within [0.70s, 1.50s] (expected 0.800s)', () => {
    const ttk = calculateTheoreticalTTK('pompa', 100.0, 5.0);
    assertGreaterThanOrEqual(ttk, 0.70, 'TTK >= 0.70s');
    assertLessThanOrEqual(ttk, 1.50, 'TTK <= 1.50s');
    assertCloseTo(ttk, 0.800, 1e-4, 'Expected exact TTK of 0.800s');
  });

  // F-09: Weapon 4 - Mitraglietta (SMG-7 Neon Hornet)
  suite.test('F-09: Mitraglietta base damage is 12.0 HP and fire rate is 10.0 rps', () => {
    assertEqual(calculateDamage('mitraglietta', 10.0), 12.0);
    assertEqual(WEAPON_CONFIGS.mitraglietta.fireRateRps, 10.0);
  });

  suite.test('F-09: Mitraglietta theoretical TTK is strictly within [0.70s, 1.50s] (0.80s close, 0.90s med)', () => {
    const ttkClose = calculateTheoreticalTTK('mitraglietta', 100.0, 10.0);
    assertGreaterThanOrEqual(ttkClose, 0.70);
    assertLessThanOrEqual(ttkClose, 1.50);
    assertCloseTo(ttkClose, 0.800, 1e-4);

    const ttkMed = calculateTheoreticalTTK('mitraglietta', 100.0, 20.0);
    assertGreaterThanOrEqual(ttkMed, 0.70);
    assertLessThanOrEqual(ttkMed, 1.50);
    assertCloseTo(ttkMed, 0.900, 1e-4);
  });

  // F-09: Weapon 5 - Coltello (CB-01 Shadowfang)
  suite.test('F-09: Coltello deals 50.0 HP damage within effective melee range (<= 2.5m)', () => {
    assertEqual(calculateDamage('coltello', 1.5), 50.0);
    assertEqual(calculateDamage('coltello', 2.5), 50.0);
  });

  suite.test('F-09: Coltello requires exactly 2 slashes to eliminate 100 HP target', () => {
    const hits = Math.ceil(100.0 / calculateDamage('coltello', 2.0));
    assertEqual(hits, 2, 'Knife requires 2 slashes');
  });

  suite.test('F-09: Coltello theoretical melee TTK is strictly within [0.70s, 1.50s] (expected 0.800s)', () => {
    const ttk = calculateTheoreticalTTK('coltello', 100.0, 2.0);
    assertGreaterThanOrEqual(ttk, 0.70, 'TTK >= 0.70s');
    assertLessThanOrEqual(ttk, 1.50, 'TTK <= 1.50s');
    assertCloseTo(ttk, 0.800, 1e-4, 'Expected exact TTK of 0.800s');
  });

  // Global Requirement Check
  suite.test('F-09: ALL 5 weapons have theoretical TTK strictly within [0.70s, 1.50s]', () => {
    const weaponKeys = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    for (const key of weaponKeys) {
      const dist = key === 'coltello' ? 2.0 : (key === 'pompa' ? 8.0 : 20.0);
      const ttk = calculateTheoreticalTTK(key, 100.0, dist);
      assert(ttk >= 0.70 && ttk <= 1.50, `Weapon ${key} TTK (${ttk}s) must be in [0.70, 1.50]s`);
    }
  });
}

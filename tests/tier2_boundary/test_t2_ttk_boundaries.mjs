// tests/tier2_boundary/test_t2_ttk_boundaries.mjs
// Tier 2 Boundary & Corner Cases: Strict 0.70s–1.50s TTK Bounds & Target HP Extremes (F-09)

import {
  assert,
  assertEqual,
  assertCloseTo,
  assertGreaterThan,
  assertGreaterThanOrEqual,
  assertLessThanOrEqual,
  assertThrows,
} from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateTheoreticalTTK, calculateDamage } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  const allWeapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];

  // Strict 0.70s - 1.50s Arena Standard Bounds
  suite.test('T2-TTK: No weapon with >1 hit has body TTK < 0.70s against standard 100 HP target', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 2.0 : 20.0;
      const ttk = calculateTheoreticalTTK(key, 100.0, dist);
      assertGreaterThanOrEqual(ttk, 0.70, `Weapon ${key} body TTK (${ttk}s) must not fall below 0.70s`);
    }
  });

  suite.test('T2-TTK: No weapon exceeds 1.50s body TTK against standard 100 HP target at effective range', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 2.0 : (key === 'pompa' ? 8.0 : 20.0);
      const ttk = calculateTheoreticalTTK(key, 100.0, dist);
      assertLessThanOrEqual(ttk, 1.50, `Weapon ${key} body TTK (${ttk}s) must not exceed 1.50s`);
    }
  });

  // HP Boundary Conditions
  suite.test('T2-TTK: Target with 1 HP dies on first shot (TTK = 0.0s) for all weapons', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 1.0 : 20.0;
      const ttk = calculateTheoreticalTTK(key, 1.0, dist);
      assertEqual(ttk, 0.0, `Weapon ${key} against 1 HP must have 0.0s TTK`);
    }
  });

  suite.test('T2-TTK: Target with HP equal to exact base damage dies on first shot (TTK = 0.0s)', () => {
    for (const key of allWeapons) {
      const baseDmg = WEAPON_CONFIGS[key].baseDamage;
      const dist = key === 'coltello' ? 1.0 : (key === 'pompa' ? 5.0 : 10.0);
      const ttk = calculateTheoreticalTTK(key, baseDmg, dist);
      assertEqual(ttk, 0.0, `Weapon ${key} against ${baseDmg} HP must have 0.0s TTK`);
    }
  });

  suite.test('T2-TTK: Target with baseDamage + 0.01 HP strictly requires 2 shots (TTK = 1 / fireRate)', () => {
    for (const key of allWeapons) {
      const cfg = WEAPON_CONFIGS[key];
      const dist = key === 'coltello' ? 1.0 : (key === 'pompa' ? 5.0 : 10.0);
      const testHp = cfg.baseDamage + 0.01;
      const ttk = calculateTheoreticalTTK(key, testHp, dist);
      const expectedTTK = 1.0 / cfg.fireRateRps;
      assertCloseTo(ttk, expectedTTK, 1e-4, `Weapon ${key} should have TTK ${expectedTTK}s`);
    }
  });

  suite.test('T2-TTK: Target with 0 HP returns 0.0s TTK without NaN', () => {
    for (const key of allWeapons) {
      const ttk = calculateTheoreticalTTK(key, 0.0, 20.0);
      assertEqual(ttk, 0.0);
      assert(!Number.isNaN(ttk), 'TTK must not be NaN');
    }
  });

  suite.test('T2-TTK: Target with negative HP returns 0.0s TTK gracefully', () => {
    const ttk = calculateTheoreticalTTK('assalto', -50.0, 20.0);
    assertEqual(ttk, 0.0);
  });

  suite.test('T2-TTK: Extreme target HP (10,000 HP boss) scales linearly without overflow or infinity', () => {
    const ttk = calculateTheoreticalTTK('assalto', 10000.0, 20.0);
    assert(Number.isFinite(ttk), 'TTK for high HP must be finite');
    assertGreaterThan(ttk, 50.0, 'TTK should be substantial for 10k HP');
  });

  // Weapon Config & Input Validation
  suite.test('T2-TTK: Unknown weapon key throws Error', () => {
    assertThrows(() => {
      calculateTheoreticalTTK('super_laser', 100.0, 20.0);
    }, /Unknown weapon/);
  });

  suite.test('T2-TTK: All weapons define strictly positive fire rates (division by zero safeguard)', () => {
    for (const key of allWeapons) {
      assertGreaterThan(WEAPON_CONFIGS[key].fireRateRps, 0.0, `${key} fireRateRps must be > 0`);
    }
  });

  // Headshot TTK Limits
  suite.test('T2-TTK: Cecchino headshot deals 140 HP, achieving 0.0s TTK (1-shot lethal) on 100 HP target', () => {
    const dmg = calculateDamage('cecchino', 20.0, true);
    assertEqual(dmg, 140.0);
    const ttk = calculateTheoreticalTTK('cecchino', 100.0, 20.0, true);
    assertEqual(ttk, 0.0, 'Cecchino headshot against 100 HP is instant lethal (0.0s)');
  });

  suite.test('T2-TTK: Assalto headshot (27 HP) reduces required hits from 6 to 4 (TTK drops to 0.480s)', () => {
    const headDmg = calculateDamage('assalto', 10.0, true);
    assertEqual(headDmg, 27.0);
    const hits = Math.ceil(100.0 / headDmg);
    assertEqual(hits, 4);
    const ttk = calculateTheoreticalTTK('assalto', 100.0, 10.0, true);
    assertCloseTo(ttk, 3.0 / 6.25, 1e-4);
  });

  suite.test('T2-TTK: SMG headshot (18 HP) reduces required hits from 9 to 6 (TTK drops to 0.500s)', () => {
    const headDmg = calculateDamage('mitraglietta', 10.0, true);
    assertEqual(headDmg, 18.0);
    const hits = Math.ceil(100.0 / headDmg);
    assertEqual(hits, 6);
    const ttk = calculateTheoreticalTTK('mitraglietta', 100.0, 10.0, true);
    assertCloseTo(ttk, 5.0 / 10.0, 1e-4);
  });

  suite.test('T2-TTK: Pompa headshot at close range deals 96 HP (2 pellets short of 1-shot kill)', () => {
    const headDmg = calculateDamage('pompa', 5.0, true);
    assertEqual(headDmg, 96.0);
    const hits = Math.ceil(100.0 / headDmg);
    assertEqual(hits, 2, 'Pompa close headshot still requires 2 shots for 100 HP');
  });
}

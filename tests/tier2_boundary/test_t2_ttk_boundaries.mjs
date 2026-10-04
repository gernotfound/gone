// tests/tier2_boundary/test_t2_ttk_boundaries.mjs
// Tier 2 Boundary & Corner Cases: theoretical TTK and target HP extremes.

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

  suite.test('T2-TTK: Multi-hit weapons do not fall below 0.70s at their reference body range', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 2.0 : 20.0;
      const damage = calculateDamage(key, dist);
      const hits = Math.ceil(100 / damage);
      const ttk = calculateTheoreticalTTK(key, 100.0, dist);
      if (hits > 1) assertGreaterThanOrEqual(ttk, 0.70, `${key}: ${ttk}`);
      else assertEqual(ttk, 0.0, `${key} one-hit TTK`);
    }
  });

  suite.test('T2-TTK: Effective-range CQB/reference choices remain at or below 1.60s', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 2.0 : 20.0;
      assertLessThanOrEqual(calculateTheoreticalTTK(key, 100.0, dist), 1.60, key);
    }
  });

  suite.test('T2-TTK: Target with 1 HP dies on first damaging hit for all weapons', () => {
    for (const key of allWeapons) {
      const dist = key === 'coltello' ? 1.0 : 20.0;
      assertEqual(calculateTheoreticalTTK(key, 1.0, dist), 0.0, key);
    }
  });

  suite.test('T2-TTK: Target with HP equal to exact base damage dies on first shot', () => {
    for (const key of allWeapons) {
      const cfg = WEAPON_CONFIGS[key];
      const dist = key === 'coltello' ? 1.0 : (key === 'pompa' ? 5.0 : 10.0);
      assertEqual(calculateTheoreticalTTK(key, cfg.baseDamage, dist), 0.0, key);
    }
  });

  suite.test('T2-TTK: baseDamage + 0.01 HP requires exactly two shots', () => {
    for (const key of allWeapons) {
      const cfg = WEAPON_CONFIGS[key];
      const dist = key === 'coltello' ? 1.0 : (key === 'pompa' ? 5.0 : 10.0);
      assertCloseTo(
        calculateTheoreticalTTK(key, cfg.baseDamage + 0.01, dist),
        1.0 / cfg.fireRateRps,
        1e-6,
        key,
      );
    }
  });

  suite.test('T2-TTK: Non-positive target HP mirrors the Rust contract and returns Infinity', () => {
    assertEqual(calculateTheoreticalTTK('assalto', 0.0, 20.0), Infinity);
    assertEqual(calculateTheoreticalTTK('assalto', -50.0, 20.0), Infinity);
  });

  suite.test('T2-TTK: Out-of-range damage yields Infinity rather than a fake minimum-damage TTK', () => {
    assertEqual(calculateTheoreticalTTK('assalto', 100.0, 181.0), Infinity);
    assertEqual(calculateTheoreticalTTK('coltello', 100.0, 3.0), Infinity);
  });

  suite.test('T2-TTK: Extreme target HP scales without overflow', () => {
    const ttk = calculateTheoreticalTTK('assalto', 10_000.0, 20.0);
    assert(Number.isFinite(ttk));
    assertGreaterThan(ttk, 50.0);
  });

  suite.test('T2-TTK: Unknown weapon key throws Error', () => {
    assertThrows(() => calculateTheoreticalTTK('super_laser', 100.0, 20.0), /Unknown weapon/);
  });

  suite.test('T2-TTK: All weapons define positive fire rates', () => {
    for (const key of allWeapons) assertGreaterThan(WEAPON_CONFIGS[key].fireRateRps, 0.0, key);
  });

  suite.test('T2-TTK: Cecchino headshot remains a 140 HP one-shot at 20m', () => {
    assertEqual(calculateDamage('cecchino', 20.0, true), 140.0);
    assertEqual(calculateTheoreticalTTK('cecchino', 100.0, 20.0, true), 0.0);
  });

  suite.test('T2-TTK: Assalto headshot is 27 HP and four hits at 35m or closer', () => {
    const damage = calculateDamage('assalto', 20.0, true);
    assertEqual(damage, 27.0);
    assertEqual(Math.ceil(100 / damage), 4);
    assertCloseTo(calculateTheoreticalTTK('assalto', 100.0, 20.0, true), 3 / 6.25, 1e-6);
  });

  suite.test('T2-TTK: SMG headshot is 18 HP before its 15m falloff', () => {
    const damage = calculateDamage('mitraglietta', 10.0, true);
    assertEqual(damage, 18.0);
    assertEqual(Math.ceil(100 / damage), 6);
    assertCloseTo(calculateTheoreticalTTK('mitraglietta', 100.0, 10.0, true), 0.5, 1e-6);
  });

  suite.test('T2-TTK: Pompa close headshot uses the current 1.25x multiplier (80 HP)', () => {
    const damage = calculateDamage('pompa', 5.0, true);
    assertEqual(damage, 80.0);
    assertEqual(Math.ceil(100 / damage), 2);
  });
}

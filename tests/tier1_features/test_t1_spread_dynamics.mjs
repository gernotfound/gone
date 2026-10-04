// tests/tier1_features/test_t1_spread_dynamics.mjs
// Tier 1 Feature Coverage: Rust-aligned angular spread dynamics model.

import { assertCloseTo, assertGreaterThan, assertLessThanOrEqual } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateSpreadAngle, calculateRecoveredSpread } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  suite.test('F-11: Assalto base spread is 0.0035 radians', () => {
    assertCloseTo(calculateSpreadAngle('assalto', 0, 'stand'), 0.0035, 1e-6);
  });

  suite.test('F-11: Cecchino base spread is 0.00035 radians', () => {
    assertCloseTo(calculateSpreadAngle('cecchino', 0, 'stand'), 0.00035, 1e-7);
  });

  suite.test('F-11: Assalto bloom expands by 0.0045 radians per modeled burst shot', () => {
    const spread0 = calculateSpreadAngle('assalto', 0, 'stand');
    const spread3 = calculateSpreadAngle('assalto', 3, 'stand');
    const spread6 = calculateSpreadAngle('assalto', 6, 'stand');
    assertGreaterThan(spread3, spread0);
    assertGreaterThan(spread6, spread3);
    assertCloseTo(spread3, 0.0035 + 3 * 0.0045, 1e-6);
  });

  suite.test('F-11: Assalto spread clamps at the current 0.045 rad cap', () => {
    const spreadHeavy = calculateSpreadAngle('assalto', 50, 'stand');
    assertCloseTo(spreadHeavy, 0.045, 1e-6);
    assertLessThanOrEqual(spreadHeavy, 0.045);
  });

  suite.test('F-11: Stance multipliers preserve crouch/walk/sprint/air ordering in the Rust model', () => {
    const stand = calculateSpreadAngle('assalto', 2, 'stand');
    assertCloseTo(calculateSpreadAngle('assalto', 2, 'crouch'), stand * 0.75, 1e-6);
    const smgStand = calculateSpreadAngle('mitraglietta', 0, 'stand');
    assertCloseTo(calculateSpreadAngle('mitraglietta', 0, 'walk'), smgStand * 1.4, 1e-6);
    assertCloseTo(calculateSpreadAngle('mitraglietta', 0, 'sprint'), smgStand * 2.0, 1e-6);
    assertCloseTo(calculateSpreadAngle('assalto', 0, 'air'), 0.0035 * 2.5, 1e-6);
  });

  suite.test('F-11: Historical linear recovery helper returns toward the current base spread', () => {
    const expanded = calculateSpreadAngle('assalto', 5, 'stand');
    const recovered = calculateRecoveredSpread('assalto', expanded, 0.1);
    assertCloseTo(expanded, 0.026, 1e-6);
    assertCloseTo(recovered, 0.011, 1e-6);
    assertCloseTo(
      calculateRecoveredSpread('assalto', expanded, 10),
      WEAPON_CONFIGS.assalto.spreadBaseRad,
      1e-6,
    );
  });
}

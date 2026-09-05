// tests/tier1_features/test_t1_spread_dynamics.mjs
// Tier 1 Feature Coverage: Angular Spread Dynamics & Stance Modifiers (F-11)

import { assertCloseTo, assertGreaterThan, assertLessThanOrEqual } from '../helpers/assertions.mjs';
import { WEAPON_CONFIGS, calculateSpreadAngle, calculateRecoveredSpread } from '../helpers/weapon_model.mjs';

export async function run(suite) {
  // Base Spread Checks
  suite.test('F-11: Assalto initial base spread is 0.012 radians (0.7 deg)', () => {
    assertCloseTo(calculateSpreadAngle('assalto', 0, 'stand'), 0.012, 1e-4);
  });

  suite.test('F-11: Cecchino sniper rifle has ultra-tight base spread of 0.0005 radians', () => {
    assertCloseTo(calculateSpreadAngle('cecchino', 0, 'stand'), 0.0005, 1e-5);
  });

  // Bloom Dynamics
  suite.test('F-11: Continuous firing expands spread cone with bloom per shot', () => {
    const spread0 = calculateSpreadAngle('assalto', 0, 'stand');
    const spread3 = calculateSpreadAngle('assalto', 3, 'stand');
    const spread6 = calculateSpreadAngle('assalto', 6, 'stand');

    assertGreaterThan(spread3, spread0);
    assertGreaterThan(spread6, spread3);
    assertCloseTo(spread3, 0.012 + 3 * 0.005, 1e-4);
  });

  suite.test('F-11: Spread cone clamps to max spread cap (assalto 0.060 rad)', () => {
    const spreadHeavy = calculateSpreadAngle('assalto', 50, 'stand');
    assertCloseTo(spreadHeavy, 0.060, 1e-4);
    assertLessThanOrEqual(spreadHeavy, 0.060);
  });

  // Stance Multipliers
  suite.test('F-11: Crouch stance tightens spread cone by 0.75x', () => {
    const stand = calculateSpreadAngle('assalto', 2, 'stand');
    const crouch = calculateSpreadAngle('assalto', 2, 'crouch');
    assertCloseTo(crouch, stand * 0.75, 1e-4);
  });

  suite.test('F-11: Walking expands spread cone by 1.4x', () => {
    const stand = calculateSpreadAngle('mitraglietta', 0, 'stand');
    const walk = calculateSpreadAngle('mitraglietta', 0, 'walk');
    assertCloseTo(walk, stand * 1.4, 1e-4);
  });

  suite.test('F-11: Sprinting doubles base spread (2.0x)', () => {
    const stand = calculateSpreadAngle('mitraglietta', 0, 'stand');
    const sprint = calculateSpreadAngle('mitraglietta', 0, 'sprint');
    assertCloseTo(sprint, stand * 2.0, 1e-4);
  });

  suite.test('F-11: Airborne jumps apply severe 2.5x inaccuracy penalty', () => {
    const stand = calculateSpreadAngle('assalto', 0, 'stand');
    const air = calculateSpreadAngle('assalto', 0, 'air');
    assertCloseTo(air, stand * 2.5, 1e-4);
  });

  // Spread Recovery
  suite.test('F-11: Ceasing fire recovers spread cone linearly toward base spread', () => {
    const expanded = calculateSpreadAngle('assalto', 5, 'stand'); // 0.037 rad
    const recovered = calculateRecoveredSpread('assalto', expanded, 0.1); // 0.1s * 0.15 rad/s = 0.015
    assertCloseTo(recovered, expanded - 0.015, 1e-4);
  });

  suite.test('F-11: Spread recovery does not dip below base spread floor', () => {
    const expanded = calculateSpreadAngle('assalto', 5, 'stand');
    const fullyRecovered = calculateRecoveredSpread('assalto', expanded, 10.0); // 10s idle
    assertCloseTo(fullyRecovered, WEAPON_CONFIGS.assalto.spreadBaseRad, 1e-4);
  });
}

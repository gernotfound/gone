// tests/tier1_features/test_t1_color_registry.mjs
// Tier 1 Feature Coverage: Fluo Color Registry, Normalization & HSV Validation (F-14)

import { assert, assertEqual } from '../helpers/assertions.mjs';
import {
  normalizeHex,
  isValidHexFormat,
  hexToHsv,
  isFluorescent,
  SessionColorRegistry,
  CYBERPUNK_PALETTE,
} from '../helpers/color_registry_model.mjs';

export async function run(suite) {
  // Hex Normalization & Format
  suite.test('F-14: normalizeHex handles lowercase and missing hash prefix', () => {
    assertEqual(normalizeHex('00f0ff'), '#00F0FF');
    assertEqual(normalizeHex('#39ff14'), '#39FF14');
    assertEqual(normalizeHex('  #ff007f  '), '#FF007F');
  });

  suite.test('F-14: normalizeHex expands valid 3-digit shorthand hex (#0F0 -> #00FF00)', () => {
    assertEqual(normalizeHex('#0F0'), '#00FF00');
  });

  suite.test('F-14: isValidHexFormat validates strict 6-digit hex format', () => {
    assert(isValidHexFormat('#00F0FF'));
    assert(isValidHexFormat('#39FF14'));
    assertEqual(isValidHexFormat('#GGGGGG'), false);
    assertEqual(isValidHexFormat('#12345'), false);
  });

  // HSV Fluorescence Validation
  suite.test('F-14: hexToHsv accurately converts RGB to HSV color space', () => {
    const cyan = hexToHsv('#00FFFF');
    assertEqual(cyan.h, 180);
    assertEqual(cyan.s, 1.0);
    assertEqual(cyan.v, 1.0);
  });

  suite.test('F-14: isFluorescent approves all curated Cyberpunk neon colors', () => {
    for (const item of CYBERPUNK_PALETTE) {
      assert(isFluorescent(item.hex), `Color ${item.name} (${item.hex}) must be approved as fluorescent`);
    }
  });

  // SessionColorRegistry Operations
  suite.test('F-14: Registry registers valid fluo color for player', () => {
    const registry = new SessionColorRegistry();
    const res = registry.requestColor('player_1', '#00F0FF');
    assert(res.success, 'Color request should succeed');
    assertEqual(res.color, '#00F0FF');
    assertEqual(registry.activeCount, 1);
  });

  suite.test('F-14: Registry accepts distinct fluo colors for multiple players', () => {
    const registry = new SessionColorRegistry();
    const res1 = registry.requestColor('p1', '#00F0FF');
    const res2 = registry.requestColor('p2', '#FF007F');
    const res3 = registry.requestColor('p3', '#39FF14');

    assert(res1.success && res2.success && res3.success);
    assertEqual(registry.activeCount, 3);
  });

  suite.test('F-14: Registry isColorAvailable accurately reflects taken vs free colors', () => {
    const registry = new SessionColorRegistry();
    registry.requestColor('p1', '#00F0FF');

    assertEqual(registry.isColorAvailable('#00F0FF'), false, 'Taken color is unavailable');
    assertEqual(registry.isColorAvailable('#39FF14'), true, 'Free color is available');
  });

  suite.test('F-14: Releasing player makes their assigned color available again', () => {
    const registry = new SessionColorRegistry();
    registry.requestColor('p1', '#00F0FF');
    assertEqual(registry.isColorAvailable('#00F0FF'), false);

    registry.releasePlayer('p1');
    assertEqual(registry.isColorAvailable('#00F0FF'), true);
    assertEqual(registry.activeCount, 0);
  });

  suite.test('F-14: getAvailablePalette lists unassigned curated neon colors', () => {
    const registry = new SessionColorRegistry();
    registry.requestColor('p1', '#00F0FF');
    const available = registry.getAvailablePalette();

    assertEqual(available.includes('#00F0FF'), false);
    assertEqual(available.includes('#FF007F'), true);
    assertEqual(available.length, CYBERPUNK_PALETTE.length - 1);
  });
}

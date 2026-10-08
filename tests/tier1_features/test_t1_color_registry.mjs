// tests/tier1_features/test_t1_color_registry.mjs
// Tier 1 Feature Coverage: Fluo Color Registry, Normalization & HSV Validation (F-14)

import { assert, assertEqual } from '../helpers/assertions.mjs';
import { LocalColorRegistry, WasmColorRegistryAdapter } from '../../game-web/src/net/colorRegistry.ts';
import { LocalColorRegistry as HostLocalColorRegistry, WasmColorRegistryAdapter as HostWasmColorRegistryAdapter } from '../../game-web/src/net/p2pHost.ts';
import {
  normalizeHex,
  isValidHexFormat,
  hexToHsv,
  isFluorescent,
  SessionColorRegistry,
  CYBERPUNK_PALETTE,
} from '../helpers/color_registry_model.mjs';

export async function run(suite) {
  // Exercise production registries; the historical SessionColorRegistry model above
  // is not a substitute for testing the implementation used by P2PHost.
  suite.test('F-14: host color registry has one canonical module with stable facade exports', () => {
    assertEqual(HostLocalColorRegistry, LocalColorRegistry);
    assertEqual(HostWasmColorRegistryAdapter, WasmColorRegistryAdapter);
  });

  suite.test('F-14: real host registry prevents collisions and frees reassigned colors', () => {
    const registry = new LocalColorRegistry(['#00F0FF', '#FF007F']);
    assertEqual(registry.requestColor('host', '#00f0ff').color, '#00F0FF');
    assertEqual(registry.requestColor('guest', '00F0FF').error, 'COLOR_ALREADY_TAKEN');
    assertEqual(registry.requestColor('guest', '#888888').error, 'INVALID_FLUO_COLOR');
    assertEqual(registry.requestColor('guest', '#GG00FF').error, 'INVALID_HEX_FORMAT');
    assertEqual(registry.getAssignedColor('host'), '#00F0FF');
    assertEqual(registry.requestColor('host', '#FF007F').color, '#FF007F');
    assertEqual(registry.isColorAvailable('#00F0FF'), true);
    assertEqual(registry.isColorAvailable('#FF007F'), false);
    assertEqual(registry.getAvailablePalette().join(','), '#00F0FF');
    assertEqual(registry.releasePlayer('host'), '#FF007F');
    assertEqual(registry.releasePlayer('host'), null);
    assertEqual(registry.getAvailablePalette().length, 2);
  });

  suite.test('F-14: real WASM color adapter maintains assignments and returns rejected responses', () => {
    const released = [];
    const wasm = {
      request_color: (_id, hex) => JSON.stringify(hex === '#FF007F'
        ? { success: true, color: hex }
        : { success: false, error: 'COLOR_ALREADY_TAKEN', message: 'Taken' }),
      release_player: (id) => released.push(id),
      is_color_available: (hex) => hex === '#FF007F',
      get_available_palette: () => ['#FF007F'],
    };
    const registry = new WasmColorRegistryAdapter(wasm);
    assertEqual(registry.requestColor('guest', '#00F0FF').success, false);
    assertEqual(registry.requestColor('guest', '#00F0FF').error, 'COLOR_ALREADY_TAKEN');
    assertEqual(registry.requestColor('guest', '#FF007F').color, '#FF007F');
    assertEqual(registry.getAssignedColor('guest'), '#FF007F');
    assertEqual(registry.isColorAvailable('#FF007F'), true);
    assertEqual(registry.getAvailablePalette().join(','), '#FF007F');
    assertEqual(registry.releasePlayer('guest'), '#FF007F');
    assertEqual(registry.getAssignedColor('guest'), undefined);
    assertEqual(released.join(','), 'guest');
  });

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

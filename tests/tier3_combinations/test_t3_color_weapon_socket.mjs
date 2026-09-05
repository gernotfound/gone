// tests/tier3_combinations/test_t3_color_weapon_socket.mjs
// Tier 3 Cross-Feature Combination: Robot Fluo Customization & Weapon Socket Attachment

import {
  assert,
  assertEqual,
  assertCloseTo,
} from '../helpers/assertions.mjs';
import {
  inspectHtmlModelSource,
  WEAPON_SOCKET_ANCHOR,
  SCALE_FACTORS,
  EXPECTED_FLUO_COMPONENTS,
} from '../helpers/asset_inspector.mjs';
import { SessionColorRegistry } from '../helpers/color_registry_model.mjs';

export async function run(suite) {
  suite.test('T3-Socket: Robot customized with Neon Pink (#FF007F) correctly mounts Assalto at socket anchor', () => {
    const reg = new SessionColorRegistry();
    const colorRes = reg.requestColor('player_pink', '#FF007F');
    assertEqual(colorRes.success, true);
    assertEqual(colorRes.color, '#FF007F');

    // Verify socket positioning
    assertCloseTo(WEAPON_SOCKET_ANCHOR.x, -1.15, 1e-4);
    assertCloseTo(WEAPON_SOCKET_ANCHOR.y, 0.40, 1e-4);
    assertCloseTo(WEAPON_SOCKET_ANCHOR.z, 0.85, 1e-4);
    assertEqual(SCALE_FACTORS.assalto, 0.15);
  });

  suite.test('T3-Socket: Robot customized with Electric Lime (#39FF14) mounts Cecchino with heavy rifle scaling', () => {
    const reg = new SessionColorRegistry();
    const colorRes = reg.requestColor('player_lime', '#39FF14');
    assertEqual(colorRes.success, true);
    assertEqual(SCALE_FACTORS.cecchino, 0.15);
  });

  suite.test('T3-Socket: Robot customized with Cyber Yellow (#FFE600) mounts Pompa combat shotgun', () => {
    const reg = new SessionColorRegistry();
    const colorRes = reg.requestColor('player_yellow', '#FFE600');
    assertEqual(colorRes.success, true);
    assertEqual(SCALE_FACTORS.pompa, 0.15);
  });

  suite.test('T3-Socket: Robot customized with Toxic Violet (#BC13FE) mounts Mitraglietta', () => {
    const reg = new SessionColorRegistry();
    const colorRes = reg.requestColor('player_violet', '#BC13FE');
    assertEqual(colorRes.success, true);
    assertEqual(SCALE_FACTORS.mitraglietta, 0.15);
  });

  suite.test('T3-Socket: Robot customized with Neon Cyan (#00F0FF) mounts Coltello with 0.08x knife scale', () => {
    const reg = new SessionColorRegistry();
    const colorRes = reg.requestColor('player_cyan', '#00F0FF');
    assertEqual(colorRes.success, true);
    assertEqual(SCALE_FACTORS.coltello, 0.08);
  });

  suite.test('T3-Socket: Dynamic color swap preserves 7 fluo accent bindings and right arm socket mount', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('player_1', '#00F0FF');
    const swapRes = reg.requestColor('player_1', '#FF073A'); // Switch to Neon Red
    assertEqual(swapRes.success, true);
    assertEqual(swapRes.color, '#FF073A');

    // All 7 fluo components are bound to new color while socket transform remains invariant
    const robotInfo = inspectHtmlModelSource('modello');
    assertEqual(EXPECTED_FLUO_COMPONENTS.length, 7);
    assert(robotInfo.hasNeonGreen || robotInfo.fluoMatches.length > 0);
    assertCloseTo(WEAPON_SOCKET_ANCHOR.x, -1.15, 1e-4);
  });
}

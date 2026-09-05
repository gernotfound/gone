// tests/tier2_boundary/test_t2_color_rejections.mjs
// Tier 2 Boundary & Corner Cases: Non-Fluorescent Colors, Malformed Hex & Input Validation (F-14)

import { assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import {
  hexToHsv,
  isFluorescent,
  isValidHexFormat,
  SessionColorRegistry,
} from '../helpers/color_registry_model.mjs';

export async function run(suite) {
  // Dull & Non-Fluorescent Rejections
  suite.test('T2-Color: Pure Black (#000000) is rejected as non-fluorescent', () => {
    assertEqual(isFluorescent('#000000'), false);
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '#000000');
    assertEqual(res.success, false);
    assertEqual(res.error, 'NOT_FLUORESCENT');
  });

  suite.test('T2-Color: Pure White (#FFFFFF) is rejected due to zero saturation (S = 0.0 < 0.60)', () => {
    const hsv = hexToHsv('#FFFFFF');
    assertEqual(hsv.s, 0.0);
    assertEqual(isFluorescent('#FFFFFF'), false);
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '#FFFFFF');
    assertEqual(res.success, false);
    assertEqual(res.error, 'NOT_FLUORESCENT');
  });

  suite.test('T2-Color: Medium Grey (#808080) is rejected as non-fluorescent', () => {
    assertEqual(isFluorescent('#808080'), false);
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '#808080');
    assertEqual(res.success, false);
    assertEqual(res.error, 'NOT_FLUORESCENT');
  });

  suite.test('T2-Color: Dark brown / muted tone (#553311) is rejected', () => {
    assertEqual(isFluorescent('#553311'), false);
  });

  suite.test('T2-Color: Dark Navy (#000055) is rejected due to low brightness (V < 0.70)', () => {
    assertEqual(isFluorescent('#000055'), false);
  });

  // Strict HSV Threshold Boundaries (S >= 0.60, V >= 0.70)
  suite.test('T2-Color: Saturation below 0.60 threshold (S = 0.50) is rejected', () => {
    // #80BFFF: H=200, S=0.33, V=1.0 -> rejected
    assertEqual(isFluorescent('#80BFFF'), false);
  });

  suite.test('T2-Color: Value below 0.70 threshold (V = 0.60) is rejected despite high saturation', () => {
    // #009900: S=1.0, V=0.60 (153/255) -> rejected
    const hsv = hexToHsv('#009900');
    assertCloseTo(hsv.v, 0.60, 0.01);
    assertEqual(isFluorescent('#009900'), false);
  });

  suite.test('T2-Color: Color meeting both S >= 0.60 and V >= 0.70 is approved as fluorescent', () => {
    // #00F0FF: S=1.0, V=1.0 -> approved
    assertEqual(isFluorescent('#00F0FF'), true);
    // #39FF14: S=0.92, V=1.0 -> approved
    assertEqual(isFluorescent('#39FF14'), true);
  });

  // Malformed Hex String Formats
  suite.test('T2-Color: Truncated 5-digit hex (#FF007) is rejected as INVALID_FORMAT', () => {
    assertEqual(isValidHexFormat('#FF007'), false);
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '#FF007');
    assertEqual(res.success, false);
    assertEqual(res.error, 'INVALID_FORMAT');
  });

  suite.test('T2-Color: Invalid non-hex characters (#GG00FF) are rejected as INVALID_FORMAT', () => {
    assertEqual(isValidHexFormat('#GG00FF'), false);
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '#GG00FF');
    assertEqual(res.success, false);
    assertEqual(res.error, 'INVALID_FORMAT');
  });

  suite.test('T2-Color: Empty string is rejected as INVALID_FORMAT', () => {
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '');
    assertEqual(res.success, false);
    assertEqual(res.error, 'INVALID_FORMAT');
  });

  suite.test('T2-Color: Empty or null playerId is rejected as INVALID_PLAYER_ID', () => {
    const reg = new SessionColorRegistry();
    assertEqual(reg.requestColor('', '#00F0FF').error, 'INVALID_PLAYER_ID');
    assertEqual(reg.requestColor(null, '#00F0FF').error, 'INVALID_PLAYER_ID');
    assertEqual(reg.requestColor(undefined, '#00F0FF').error, 'INVALID_PLAYER_ID');
  });

  suite.test('T2-Color: Color with leading/trailing whitespace is normalized and accepted', () => {
    const reg = new SessionColorRegistry();
    const res = reg.requestColor('p1', '   #00f0ff   ');
    assertEqual(res.success, true);
    assertEqual(res.color, '#00F0FF');
  });
}

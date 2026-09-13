import fs from 'fs';
import path from 'path';
import { get_height_at } from '../../game-web/pkg/game_core.js';
import { assert, assertCloseTo } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Web terrain keeps the cratered battlefield profile', () => {
    const center = get_height_at(1200, 1200);
    const outer = [
      get_height_at(1575, 1200),
      get_height_at(825, 1200),
      get_height_at(1200, 1575),
      get_height_at(1200, 825),
    ];
    const outerAverage = outer.reduce((sum, value) => sum + value, 0) / outer.length;

    assert(
      outerAverage - center >= 80,
      `SE landmark crater must remain deeply carved; center=${center.toFixed(2)} outerAverage=${outerAverage.toFixed(2)}`,
    );
    assertCloseTo(get_height_at(0, 0), 15, 1e-6, 'Origin safe spawn platform must remain intact');
  });

  suite.test('Web fallback retains canonical small craters and trenches', () => {
    const source = fs.readFileSync(
      path.join(PROJECT_ROOT, 'game-web', 'pkg', 'game_core.js'),
      'utf8',
    );

    assert(source.includes('const smallGrid = 30'), 'Small impact crater grid must remain in the browser terrain fallback');
    assert(source.includes('smallRadius * 0.5'), 'Small crater cavity depth must remain aligned with the canonical core');
    assert(source.includes("const trench = Math.abs(fbm(x, z, 3, 0.005, 0.5, 2))"), 'Canonical trench relief must remain enabled');
    assert(source.includes('giantRadius * 0.5'), 'Giant crater cavity must keep canonical depth');
    assert(source.includes('ridged(x, z, 6, 0.0025, 0.5, 2) * 450'), 'NW massif relief must not regress to the softened fallback');
  });
}

import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  const aimMovement = source('game-web', 'src', 'gameplay', 'aimMovementTuning.ts');
  const engine = source('game-web', 'src', 'gameplay', 'engine.ts');
  const build = source('game-web', 'build.sh');

  suite.test('Menu-time runtime cannot call wasm-bindgen movement exports before init', () => {
    assert(build.includes('wasm-pack build --target web'), 'production build must be recognized as real wasm-bindgen output');
    assert(engine.includes('await init();') && engine.includes('hasInitializedWasm = true;'), 'engine must initialize WASM before marking it ready');
    assert(!aimMovement.includes("from '../../pkg/game_core.js'"), 'menu-time ADS tuning must not import callable game-core bindings');
    assert(!aimMovement.includes('requestAnimationFrame('), 'menu-time ADS tuning must not run an independent pre-init frame loop');
    assert(!aimMovement.includes('set_movement_scale('), 'menu-time ADS tuning must not call set_movement_scale before explicit WASM readiness exists');
  });
}

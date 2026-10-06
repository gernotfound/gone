import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const controlsCss = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.css'), 'utf8');
  const preferences = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'touchPreferences.ts'), 'utf8');
  const weaponController = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'advancedWeaponController.ts'), 'utf8');
  const scene = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'rendering', 'scene.ts'), 'utf8');

  suite.test('Phone HUD defaults to lower visual density without removing control ownership', () => {
    assert(preferences.includes('buttonOpacity: 0.82'), 'touch chrome should default below full opacity');
    assert(preferences.includes('secondaryFire: false'), 'optional claw FIRE should be opt-in by default');
    assert(controlsCss.includes('html.gone-smartphone #mc-sprint') && controlsCss.includes('pointer-events: none !important'), 'redundant manual sprint chrome should be suppressed while smart sprint remains');
    assert(controlsCss.includes('#mc-reload[data-gone-ammo-state="melee"]'), 'reload should disappear when melee makes it irrelevant');
    assert(controlsCss.includes('#mc-weapon-switcher') && controlsCss.includes('background: transparent !important'), 'weapon switching should keep its hit targets without a large backing panel');
  });

  suite.test('Gameplay hip FOV is widened consistently from camera creation through weapon control', () => {
    assert(scene.includes('new THREE.PerspectiveCamera(85,'), 'scene camera should initialize at 85 degree FOV');
    assert(weaponController.includes('const HIP_FOV = 85;'), 'weapon controller should return to the same widened hip FOV after ADS');
  });
}

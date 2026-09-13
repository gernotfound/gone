import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'pubgTouchControls.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'pubgTouchControls.css');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');
  const smokePath = path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_pwa_smoke.mjs');

  suite.test('PUBG-like fire control supports dead-zone aim drag while authoritative fire remains active', () => {
    const source = fs.readFileSync(runtimePath, 'utf-8');
    assert(source.includes("document.getElementById('mc-fire')"), 'PUBG layer must bind the primary fire button');
    assert(source.includes("button.addEventListener('pointermove'"), 'fire button must listen for drag movement');
    assert(source.includes('updateDrag(primaryDrag, event, true, true)'), 'fire drag must pass pointer deltas through the dead-zone/spray curve');
    assert(source.includes('applyLookDelta(dx, dy, ramp)'), 'drag processing must rotate the camera using look deltas');
    assert(source.includes('inputState.yaw') && source.includes('inputState.pitch'), 'fire drag must update yaw and pitch');
    assert(source.includes('preferences.adsSensitivity') && source.includes('preferences.lookSensitivity'), 'fire drag must respect touch sensitivity settings');
    assert(source.includes('fireDragDeadZone'), 'fire drag must use the configurable dead-zone');
    assert(source.includes('fireSources'), 'PUBG layer must own held trigger sources without the legacy continuous fire flag');
  });

  suite.test('PUBG touch layer starts after primary or fallback controls exist', () => {
    const source = fs.readFileSync(mainPath, 'utf-8');
    const client = source.indexOf('startClientRuntime();');
    const guard = source.indexOf("safeStart('smartphoneControlsGuard', startSmartphoneControlsGuard);");
    const pubg = source.indexOf("safeStart('pubgTouchControls', startPubgTouchControls);");
    assert(client >= 0 && guard > client && pubg > guard, 'PUBG fire-drag layer must attach after normal/fallback touch controls initialize');
  });

  suite.test('PUBG control styling enlarges fire control and adds claw fire', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    assert(css.includes('#mc-fire') && css.includes('84px'), 'primary fire target must be enlarged');
    assert(css.includes('is-fire-dragging'), 'dragging state must have visual feedback');
    assert(css.includes('#mobile-look-pad') && css.includes('32%'), 'phone free-look surface must be widened');
    assert(css.includes('#mc-fire-left') && css.includes('gone-touch-secondary-fire'), 'secondary claw FIRE styling must be present');
  });

  suite.test('Mobile browser smoke verifies finite ammo and camera rotation during held FIRE', () => {
    const smoke = fs.readFileSync(smokePath, 'utf-8');
    assert(smoke.includes('fireDragYawBefore') && smoke.includes('fireDuringDrag.yaw'), 'smoke must compare yaw during a held fire drag');
    assert(smoke.includes('fireDuringDrag.pubg.fireActive'), 'smoke must assert authoritative PUBG trigger ownership while dragging');
    assert(smoke.includes('magazine === 0'), 'smoke must prove sustained touch fire stops at an empty finite magazine');
    assert(smoke.includes('legacy continuous inputState.fire path must stay disabled'), 'smoke must guard against the legacy infinite-ammo bypass');
  });
}

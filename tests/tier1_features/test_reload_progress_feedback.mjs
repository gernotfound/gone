import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const controller = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'advancedWeaponController.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_reload_progress_smoke.mjs'), 'utf8');
  const workflow = fs.readFileSync(path.join(PROJECT_ROOT, '.github', 'workflows', 'rescue-ci.yml'), 'utf8');

  suite.test('Reload progress is presentation derived from the canonical weapon reload timer', () => {
    assert(controller.includes('function reloadProgress(now = performance.now()): number'), 'weapon owner must expose one reload progress helper');
    assert(controller.includes('reloadEndsAt - reloadStartedAt'), 'reload progress must derive from canonical reload timing');
    assert(controller.includes('const phase = reloadProgress(now);'), 'viewmodel reload animation must reuse canonical progress');
    assert(controller.includes('getReloadProgress: () => reloadProgress()'), 'diagnostics must expose the same canonical progress');
    assert(!controller.includes('setInterval('), 'reload presentation must not add a second timing loop');
  });

  suite.test('Reload bar is compact, non-interactive and preserves the mobile ammo text slot', () => {
    assert(controller.includes("ammoReloadTrack.id = 'advanced-weapon-reload-track'"), 'reload track must have a stable browser-test id');
    assert(controller.includes("ammoReloadFill.id = 'advanced-weapon-reload-fill'"), 'reload fill must have a stable browser-test id');
    assert(controller.includes("ammoReloadTrack.setAttribute('aria-hidden', 'true')"), 'decorative reload bar must stay out of the accessibility tree');
    assert(controller.includes("position: 'absolute'"), 'reload bar must be absolute so it cannot grow the HUD stack');
    assert(controller.includes('ammoHud.append(ammoPrimary, ammoReloadTrack, ammoSecondary)'), 'secondary ammo text must remain the final HUD child for smartphone compact CSS');
    assert(controller.includes("ammoReloadFill.style.transform = `scaleX(${visible ? progress.toFixed(3) : '0'})`"), 'reload fill must render canonical progress directly');
  });

  suite.test('Real iPhone browser smoke proves touch reload progress, stable HUD height and reset', () => {
    assert(smoke.includes("document.getElementById('mc-reload')"), 'smoke must start reload from the touch control');
    assert(smoke.includes('window.goneWeapons.getReloadProgress()'), 'smoke must observe canonical progress');
    assert(smoke.includes('reload progress must advance'), 'smoke must require progress to move forward');
    assert(smoke.includes('reload fill must mirror canonical progress'), 'smoke must compare rendered fill with canonical progress');
    assert(smoke.includes('reload bar must not grow HUD height'), 'smoke must guard the compact mobile scan stack');
    assert(smoke.includes('idle progress must reset to zero'), 'smoke must verify post-reload reset');
    assert(workflow.includes('run_smoke mobile_reload_progress_smoke.mjs rescue-mobile-reload-progress.log'), 'Rescue CI must execute reload progress smoke');
    assert(workflow.includes('rescue-mobile-reload-progress.log'), 'Rescue CI must archive reload progress diagnostics');
  });
}

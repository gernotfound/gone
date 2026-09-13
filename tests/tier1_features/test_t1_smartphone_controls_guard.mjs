import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Smartphone detection has UA/coarse-pointer fallbacks instead of requiring maxTouchPoints', () => {
    const profile = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneProfile.ts'), 'utf8');
    assert(profile.includes("'ontouchstart' in window"), 'smartphone detection should accept browser touch evidence');
    assert(profile.includes('uaDataMobile === true || phoneUa'), 'strong mobile UA signals should classify phones even if touch-point reporting is wrong');
    assert(!profile.includes('if (navigator.maxTouchPoints <= 0) return false;'), 'smartphone detection must not hard-fail solely on maxTouchPoints');
  });

  suite.test('Smartphone controls guard provides a functional fallback when primary mobile runtime is disabled', () => {
    const guard = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneControlsGuard.ts'), 'utf8');
    assert(guard.includes("primary?.enabled === true"), 'guard should prefer the primary mobile runtime when available');
    assert(guard.includes('createFallbackControls()'), 'guard should create fallback touch controls when primary runtime is unavailable');
    for (const id of ['mobile-stick', 'mobile-look-pad', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-map', 'mc-menu']) {
      assert(guard.includes(id), `fallback should include ${id}`);
    }
  });

  suite.test('Client startup runs smartphone controls guard after the normal client runtime', () => {
    const main = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts'), 'utf8');
    const clientIndex = main.indexOf('startClientRuntime();');
    const guardIndex = main.indexOf("safeStart('smartphoneControlsGuard', startSmartphoneControlsGuard);");
    assert(clientIndex >= 0 && guardIndex > clientIndex, 'guard must run after the primary client/mobile runtime has had a chance to initialize');
  });
}

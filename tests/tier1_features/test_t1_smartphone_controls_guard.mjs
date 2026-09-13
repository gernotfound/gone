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
    assert(guard.includes("controls?.enabled === true && controls.fallback !== true"), 'guard should prefer the primary mobile runtime when available');
    assert(guard.includes('installFallbackInfrastructure()'), 'guard should install fallback touch infrastructure when primary runtime is unavailable');
    assert(guard.includes('existing.remove();'), 'partially-owned primary control DOM must be replaced rather than patched');
    assert(guard.includes("goneFallbackBound === '1'"), 'fallback listener binding must be idempotent');
    for (const id of ['mobile-stick', 'mobile-look-pad', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-map', 'mc-menu']) {
      assert(guard.includes(id), `fallback should include ${id}`);
    }
  });

  suite.test('Touch guard starts only after the combat-safe core and reconciles without restart', () => {
    const main = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts'), 'utf8');
    const guard = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneControlsGuard.ts'), 'utf8');
    assert(main.includes("const COMBAT_SAFE_CORE = ['bootstrap', 'advancedWeaponController']"), 'device controls must require bootstrap and ammo authority');
    assert(main.includes("name: 'smartphoneControlsGuard'"), 'touch guard must be a device runtime module');
    assert(main.includes('dependsOn: COMBAT_SAFE_CORE'), 'touch guard must wait for the combat-safe core');
    assert(main.includes('reconcile: reconcileSmartphoneControlsGuard'), 'runtime must expose reconciliation instead of restart hacks');
    assert(guard.includes('if (guardStarted)') && guard.includes('reconcileSmartphoneControlsGuard();'), 'repeat starts must reconcile rather than duplicate listeners');
    assert(!guard.includes("window.addEventListener('gone-input-mode-changed'"), 'guard must not duplicate application-level configuration listeners');
    assert(!main.includes('__goneSmartphoneControlsGuardStarted = false'), 'main must not mutate guard startup flags');
  });
}

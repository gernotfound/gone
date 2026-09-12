import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const profilePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneProfile.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphone.css');
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobileRuntime.ts');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');

  suite.test('Smartphone profile uses touch, coarse pointer, UA hints and viewport fallback', () => {
    const source = fs.readFileSync(profilePath, 'utf-8');
    assert(source.includes('navigator.maxTouchPoints'), 'smartphone detection must require touch support');
    assert(source.includes("'(pointer: coarse)'") && source.includes("'(any-pointer: coarse)'"), 'smartphone detection must consider coarse pointers');
    assert(source.includes('userAgentData') && source.includes('Android.+Mobile') && source.includes('iPhone'), 'smartphone detection must include modern and fallback phone UA signals');
    assert(source.includes('viewportShortestSide() <= 720'), 'smartphone detection must include a viewport-size fallback');
    assert(source.includes('tabletLikeDevice()'), 'smartphone detection must explicitly avoid tablet-class devices');
  });

  suite.test('Smartphone profile is applied before PWA and gameplay runtime startup', () => {
    const source = fs.readFileSync(mainPath, 'utf-8');
    const smartphone = source.indexOf('startSmartphoneProfile();');
    const pwa = source.indexOf('startPwaRuntime();');
    const client = source.indexOf('startClientRuntime();');
    assert(smartphone >= 0 && smartphone < pwa && pwa < client, 'device profile must be available before PWA/game UI initializes');
  });

  suite.test('Smartphone HUD removes desktop-heavy information panels and compacts essentials', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    assert(css.includes('#gone-p2p-quality-hud') && css.includes('#gone-local-telemetry') && css.includes('#gone-kill-feed'), 'phone CSS must target nonessential desktop information panels');
    assert(css.includes('display: none !important'), 'phone CSS must remove nonessential information panels');
    assert(css.includes('#health-hud') && css.includes('transform: scale(.56)'), 'health HUD must be compact on phones');
    assert(css.includes('#advanced-weapon-hud') && css.includes('transform: scale(.52)'), 'weapon/ammo HUD must be compact on phones');
    assert(css.includes('#net-text') && css.includes('#network-status'), 'network status must collapse to a compact indicator');
  });

  suite.test('Smartphone controls preserve all FPS actions with thumb-sized targets', () => {
    const runtime = fs.readFileSync(runtimePath, 'utf-8');
    const css = fs.readFileSync(cssPath, 'utf-8');
    for (const id of ['mobile-stick', 'mobile-look-pad', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch', 'mc-sprint', 'mc-map', 'mc-menu', 'mc-prev', 'mc-next']) {
      assert(runtime.includes(id), `mobile runtime must retain ${id}`);
    }
    assert(css.includes('min-width: 48px !important') && css.includes('min-height: 48px !important'), 'phone action targets must stay at least 48 CSS px');
    assert(css.includes('env(safe-area-inset-right)') && css.includes('env(safe-area-inset-left)'), 'controls must respect phone safe areas');
  });

  suite.test('Phone map and death feedback are stripped of oversized desktop chrome', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    assert(css.includes('#map-ui > div > div.absolute.top-4.left-4'), 'phone map must target the large desktop map label');
    assert(css.includes('#death-overlay > div') && css.includes('width: min(84vw, 420px)'), 'death overlay must use a compact phone card');
  });
}

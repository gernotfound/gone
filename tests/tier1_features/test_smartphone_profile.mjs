import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const profilePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneProfile.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphone.css');
  const mobileCssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobile.css');
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobileRuntime.ts');
  const guardPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneControlsGuard.ts');
  const preferencesPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'touchPreferences.ts');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');

  suite.test('Smartphone profile uses touch, coarse pointer, UA hints and viewport fallback', () => {
    const source = fs.readFileSync(profilePath, 'utf-8');
    assert(source.includes('navigator.maxTouchPoints'), 'smartphone detection must retain touch evidence');
    assert(source.includes("'(pointer: coarse)'") && source.includes("'(any-pointer: coarse)'"), 'smartphone detection must consider coarse pointers');
    assert(source.includes('userAgentData') && source.includes('Android.+Mobile') && source.includes('iPhone'), 'smartphone detection must include modern and fallback phone UA signals');
    assert(source.includes('viewportShortestSide() <= 720'), 'smartphone detection must include a viewport-size fallback');
    assert(source.includes('tabletLikeDevice()'), 'smartphone detection must explicitly avoid tablet-class devices');
  });

  suite.test('Smartphone and touch preferences are declared before gameplay runtime startup', () => {
    const source = fs.readFileSync(mainPath, 'utf-8');
    const smartphone = source.indexOf("name: 'smartphoneProfile'");
    const inputMode = source.indexOf("name: 'inputModeSettings'");
    const touchPreferences = source.indexOf("name: 'touchPreferences'");
    const pwa = source.indexOf("name: 'pwaRuntime'");
    const startFoundation = source.indexOf("runtimeKernel.startPhase('foundation')");
    const client = source.indexOf('startClientRuntime();');
    assert(smartphone >= 0 && smartphone < inputMode && inputMode < touchPreferences && touchPreferences < pwa, 'shell module declaration must retain device preference dependency order');
    assert(pwa < startFoundation && startFoundation < client, 'shell foundation must start before the game composition root');
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

  suite.test('Touch preferences persist sensitivity, ADS mode, scale, opacity and handedness', () => {
    const prefs = fs.readFileSync(preferencesPath, 'utf-8');
    assert(prefs.includes("gone-touch-preferences-v1") && prefs.includes('localStorage.setItem'), 'touch preferences must persist locally');
    for (const key of ['lookSensitivity', 'adsSensitivity', 'adsMode', 'buttonScale', 'buttonOpacity', 'handedness']) {
      assert(prefs.includes(key), `touch preference ${key} must be present`);
    }
    assert(prefs.includes("adsMode: 'hold'") && prefs.includes("raw?.adsMode === 'toggle' ? 'toggle' : 'hold'"), 'ADS must default safely to HOLD while accepting persisted TOGGLE');
    assert(prefs.includes('touch-ads-mode-hold') && prefs.includes('touch-ads-mode-toggle'), 'touch settings must expose HOLD and TOGGLE ADS choices');
    assert(prefs.includes('goneTouchAdsMode'), 'active ADS preference must be exposed through a stable DOM dataset');
    assert(prefs.includes("buttonScale: clamp") && prefs.includes(', 1, 1.35)'), 'button scale must never shrink below the safe 100% baseline');
    assert(prefs.includes('gone-touch-left-handed') && prefs.includes('--gone-touch-scale') && prefs.includes('--gone-touch-opacity'), 'touch presentation must be applied through stable CSS hooks');
  });

  suite.test('Primary and fallback touch look both consume live sensitivity preferences', () => {
    const runtime = fs.readFileSync(runtimePath, 'utf-8');
    const guard = fs.readFileSync(guardPath, 'utf-8');
    for (const source of [runtime, guard]) {
      assert(source.includes('getTouchPreferences()'), 'every touch runtime must read current preferences');
      assert(source.includes('preferences.adsSensitivity') && source.includes('preferences.lookSensitivity'), 'ADS and hip-fire sensitivity must be independently configurable');
    }
  });

  suite.test('Left-handed layout mirrors movement, action cluster and compact HUD', () => {
    const css = fs.readFileSync(mobileCssPath, 'utf-8');
    assert(css.includes('html.gone-touch-left-handed #mobile-stick') && css.includes('right:max('), 'left-handed layout must move the movement stick to the right');
    assert(css.includes('html.gone-touch-left-handed #gone-mobile-controls .mc-fire') && css.includes('left:max('), 'left-handed layout must move fire controls to the left');
    assert(css.includes('html.gone-touch-left-handed #mobile-look-pad') && css.includes('right:36%'), 'left-handed layout must mirror the look interaction zone');
    assert(css.includes('gone-smartphone.gone-touch-left-handed #health-hud') && css.includes('gone-smartphone.gone-touch-left-handed #advanced-weapon-hud'), 'compact HUD anchors must follow handedness');
  });

  suite.test('Phone map and death feedback are stripped of oversized desktop chrome', () => {
    const css = fs.readFileSync(cssPath, 'utf-8');
    assert(css.includes('#map-ui > div > div.absolute.top-4.left-4'), 'phone map must target the large desktop map label');
    assert(css.includes('#death-overlay > div') && css.includes('width: min(84vw, 420px)'), 'death overlay must use a compact phone card');
  });
}

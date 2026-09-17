import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const compassPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'combatCompass.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'combatCompass.css');
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const competitiveCssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.css');
  const compass = fs.readFileSync(compassPath, 'utf-8');
  const css = fs.readFileSync(cssPath, 'utf-8');
  const runtime = fs.readFileSync(runtimePath, 'utf-8');
  const competitiveCss = fs.readFileSync(competitiveCssPath, 'utf-8');

  suite.test('Combat compass is presentation-only and derives heading from canonical input yaw', () => {
    assert(compass.includes("import { inputState } from '../controls/playerInput.ts'"), 'compass must consume canonical player yaw');
    assert(compass.includes('-inputState.yaw * 180 / Math.PI'), 'compass bearing must derive from canonical yaw');
    assert(!compass.includes('setInterval('), 'compass must not add repair/polling intervals');
    assert(compass.includes('requestAnimationFrame(paint)'), 'compass presentation must follow the render cadence');
  });

  suite.test('Combat compass starts through the presentation runtime phase', () => {
    assert(runtime.includes("import { startCombatCompass } from '../ui/combatCompass.ts'"), 'runtime must import the compass owner');
    assert(runtime.includes("name: 'combatCompass'"), 'runtime must register the compass module');
    assert(runtime.includes("phase: 'presentation'"), 'compass must remain presentation-owned');
    assert(runtime.includes('start: startCombatCompass'), 'registered compass must start its canonical owner');
  });

  suite.test('Compass reserves a responsive safe-area-aware upper navigation band', () => {
    assert(css.includes('env(safe-area-inset-top)'), 'compass must respect display cutouts');
    assert(css.includes('width: clamp(') && css.includes('html.gone-smartphone #gone-combat-compass'), 'compass width must adapt across desktop and phone');
    assert(css.includes('left: 50%') && css.includes('translateX(-50%)'), 'compass must remain centered');
    assert(css.includes('mask-image: linear-gradient'), 'compass track must fade instead of clipping hard at its edges');
  });

  suite.test('Competitive touch geometry scales from viewport variables instead of one fixed handset', () => {
    for (const variable of ['--gone-action-size', '--gone-fire-size', '--gone-stick-size', '--gone-health-width', '--gone-health-scale']) {
      assert(competitiveCss.includes(variable), `responsive geometry must define ${variable}`);
    }
    assert(competitiveCss.includes('clamp(48px'), 'interactive controls must retain a 48px minimum target');
    assert(competitiveCss.includes('dvh') && competitiveCss.includes('dvw'), 'competitive layout must adapt to both viewport axes');
    assert(competitiveCss.includes('env(safe-area-inset-left)') && competitiveCss.includes('env(safe-area-inset-right)'), 'competitive layout must remain notch/safe-area aware');
  });

  suite.test('Competitive HUD separates navigation, information and thumb-control bands', () => {
    assert(competitiveCss.includes('upper-center band is reserved for the compass'), 'layout ownership must document the upper navigation band');
    assert(competitiveCss.includes('#health-hud') && competitiveCss.includes('#advanced-weapon-hud') && competitiveCss.includes('#mc-weapon-switcher'), 'lower-center information stack must retain health, ammo and weapon selection');
    assert(competitiveCss.includes('#mc-fire') && competitiveCss.includes('#mobile-stick'), 'both thumb zones must remain explicit');
  });
}

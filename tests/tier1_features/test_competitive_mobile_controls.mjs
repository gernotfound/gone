import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.css');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');
  const runtime = fs.readFileSync(runtimePath, 'utf-8');
  const css = fs.readFileSync(cssPath, 'utf-8');
  const main = fs.readFileSync(mainPath, 'utf-8');

  suite.test('Competitive mobile layer preserves simultaneous movement and camera control', () => {
    assert(runtime.includes("target.closest('#mobile-stick')"), 'competitive layer must own the movement joystick');
    assert(runtime.includes("target.closest('#mobile-look-pad')"), 'competitive layer must own the right-thumb look surface');
    assert(runtime.includes('applyLookDelta'), 'competitive layer must update camera deltas directly');
  });

  suite.test('Joystick exposes a forward sprint zone like modern mobile shooters', () => {
    assert(runtime.includes('ny < -0.82'), 'forward joystick edge must activate auto sprint');
    assert(runtime.includes('move.autoSprint || manualSprintPointers.size > 0'), 'manual RUN and joystick sprint must compose safely');
    assert(css.includes("content: 'RUN'"), 'joystick must visually communicate the sprint zone');
  });

  suite.test('Live map remains a combat overlay instead of becoming a modal', () => {
    assert(runtime.includes('function mapOpen()'), 'competitive layer must track live map state');
    assert(runtime.includes('beginMapFire'), 'map-open fire must remain available');
    assert(runtime.includes("target.closest('#mc-map')"), 'MAP must remain independently toggleable while open');
    assert(css.includes('#gone-mobile-controls.map-open #mobile-stick'), 'movement controls must remain visible over the map');
    assert(css.includes('#gone-mobile-controls.map-open button'), 'combat buttons must remain visible over the map');
  });

  suite.test('Mobile map is more transparent while keeping world context visible', () => {
    assert(css.includes('background: rgba(2, 6, 23, .56)'), 'map scrim must be lighter than the previous 80% overlay');
    assert(css.includes('#minimap-canvas') && css.includes('opacity: .88'), 'map canvas must allow some world visibility through it');
  });

  suite.test('ADS remains dedicated hold-and-drag and FIRE stays ammo authoritative', () => {
    assert(runtime.includes("target.closest('#mc-aim')"), 'ADS must remain a dedicated control');
    assert(runtime.includes('dispatchMouse(2, true)'), 'ADS hold must feed the existing weapon controller');
    assert(runtime.includes('existing ammo-authoritative PUBG layer owns FIRE during normal play'), 'normal FIRE must stay delegated to the magazine-aware controller');
  });

  suite.test('Pointer-lock bridge preserves desktop and mobile pause behavior', () => {
    assert(runtime.includes("Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement')"), 'bridge must retain the native Document pointer-lock getter');
    assert(runtime.includes('previous?.call(document) ?? nativePointerLockGetter?.call(document) ?? null'), 'desktop and base-mobile behavior must delegate to the previous or native pointer lock getter');
    assert(runtime.includes('if (useOnScreenControls() && gameplayActive() && mapOpen()) return document.body'), 'extra virtual body lock must exist only while the live map is open');
  });

  suite.test('Competitive layer starts after primary and PUBG touch ownership', () => {
    const guard = main.indexOf('startSmartphoneControlsGuard();');
    const pubg = main.indexOf('startPubgTouchControls();');
    const competitive = main.indexOf('startCompetitiveTouchControls();');
    assert(guard >= 0 && pubg > guard && competitive > pubg, 'competitive layer must enhance existing controls after their primary owners attach');
  });
}

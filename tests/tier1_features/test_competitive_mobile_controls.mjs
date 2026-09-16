import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.ts');
  const cssPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.css');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');
  const smokePath = path.join(PROJECT_ROOT, 'game-web', 'scripts', 'competitive_mobile_controls_smoke.mjs');
  const runtime = fs.readFileSync(runtimePath, 'utf-8');
  const css = fs.readFileSync(cssPath, 'utf-8');
  const main = fs.readFileSync(mainPath, 'utf-8');
  const smoke = fs.readFileSync(smokePath, 'utf-8');

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
    assert(runtime.includes("target.closest<HTMLElement>('[data-gone-weapon-index]')"), 'direct weapon slots must remain usable while the live map is open');
    assert(runtime.includes('selectWeapon(Number(directWeapon.dataset.goneWeaponIndex))'), 'map-open quick switch must route to canonical indexed selection');
    assert(css.includes('#gone-mobile-controls.map-open #mobile-stick'), 'movement controls must remain visible over the map');
    assert(css.includes('#gone-mobile-controls.map-open button'), 'combat buttons must remain visible over the map');
  });

  suite.test('Mobile map keeps world context visible beneath tactical information', () => {
    assert(css.includes('background: rgba(2,6,23,.52)'), 'map scrim must remain substantially transparent');
    assert(css.includes('#minimap-canvas') && css.includes('opacity: .88'), 'map canvas must allow world visibility through it');
  });

  suite.test('ADS supports HOLD default and optional TOGGLE while preserving weapon authority', () => {
    assert(runtime.includes("target.closest('#mc-aim')"), 'ADS must remain a dedicated control');
    assert(runtime.includes('function setAdsActive(active: boolean, forceDispatch = false)'), 'ADS state changes must pass through one canonical touch helper');
    assert(runtime.includes("getTouchPreferences().adsMode === 'toggle'"), 'ADS pointer-down must honor TOGGLE preference');
    assert(runtime.includes("getTouchPreferences().adsMode === 'hold'"), 'ADS pointer-up must preserve HOLD semantics by default');
    assert(runtime.includes("aim.setAttribute('aria-pressed', String(inputState.aim))"), 'latched ADS state must be exposed accessibly');
    assert(runtime.includes("window.addEventListener('gone-touch-preferences-changed'"), 'preference changes must deterministically clear transient ADS state');
    assert(runtime.includes('setAdsActive(false, true)'), 'releaseAll must force a canonical ADS mouse-up even for a latched toggle');
    assert(runtime.includes('existing ammo-authoritative PUBG layer owns FIRE during normal play'), 'normal FIRE must stay delegated to the magazine-aware controller');
    assert(smoke.includes('assertAdsModes') && smoke.includes('TOGGLE ADS forced release'), 'real browser smoke must exercise both ADS modes and safety release');
  });

  suite.test('Pointer-lock bridge preserves desktop and mobile pause behavior', () => {
    assert(runtime.includes("Object.getOwnPropertyDescriptor(Document.prototype, 'pointerLockElement')"), 'bridge must retain the native Document pointer-lock getter');
    assert(runtime.includes('previous?.call(document) ?? nativePointerLockGetter?.call(document) ?? null'), 'desktop and base-mobile behavior must delegate to the previous or native pointer lock getter');
    assert(runtime.includes('if (useOnScreenControls() && gameplayActive() && mapOpen()) return document.body'), 'extra virtual body lock must exist only while the live map is open');
    assert(runtime.includes("document.addEventListener('pointerlockchange'"), 'pause/unlock transitions must clear any latched touch ADS state');
  });

  suite.test('Competitive layer depends on PUBG touch ownership and ammo authority', () => {
    assert(main.includes("name: 'pubgTouchControls'"), 'PUBG touch owner must be a device module');
    assert(main.includes("name: 'competitiveTouchControls'"), 'competitive layer must be a device module');
    assert(main.includes("dependsOn: ['pubgTouchControls', 'advancedWeaponController']"), 'competitive layer must require PUBG ownership and the combat-safe core');
    assert(main.includes("runtimeKernel.startPhase('device')"), 'device modules must start through dependency resolution rather than imperative ordering');
  });

  suite.test('Final smartphone geometry is viewport-adaptive and safe-area aware', () => {
    for (const variable of ['--gone-control-edge', '--gone-action-size', '--gone-fire-size', '--gone-stick-size']) {
      assert(css.includes(variable), `competitive geometry must expose ${variable}`);
    }
    assert(css.includes('clamp(48px') && css.includes('dvh') && css.includes('dvw'), 'controls must combine minimum hit targets with viewport-relative scaling');
    assert(css.includes('env(safe-area-inset-left)') && css.includes('env(safe-area-inset-right)'), 'thumb zones must respect notches and rounded-screen safe areas');
  });

  suite.test('Navigation and information bands no longer compete for upper center', () => {
    assert(css.includes('upper-center band is reserved for the compass'), 'competitive layout must reserve upper center for navigation');
    assert(css.includes("#mc-weapon-switcher") && css.includes('top: auto !important'), 'weapon switcher must move out of the upper navigation band');
    assert(css.includes('#advanced-weapon-hud') && css.includes('#health-hud'), 'combat information must remain in the lower-center scan band');
  });
}

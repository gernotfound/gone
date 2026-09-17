import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const competitive = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'competitiveTouchControls.ts'), 'utf8');
  const pubg = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'pubgTouchControls.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'scripts', 'competitive_mobile_controls_smoke.mjs'), 'utf8');
  const selectionStart = competitive.indexOf('function selectWeapon');
  const selectionEnd = competitive.indexOf('function switchWeapon', selectionStart);
  const selection = competitive.slice(selectionStart, selectionEnd);

  suite.test('Map-open weapon selection returns presentation ownership to the PUBG touch layer', () => {
    assert(selectionStart >= 0 && selectionEnd > selectionStart, 'competitive weapon selection helper must remain inspectable');
    assert(selection.includes('const result = game?.switchWeapon?.(index)'), 'competitive map selection must still call the canonical indexed weapon API');
    assert(selection.includes('Promise.resolve(result).finally'), 'presentation sync must wait until canonical selection settles');
    assert(selection.includes('(window as any).gonePubgTouchControls?.rebind?.()'), 'competitive layer must hand quick-slot presentation back to the PUBG owner');
    assert(!selection.includes("classList.toggle('is-active'"), 'weapon selection helper must not duplicate quick-slot visual ownership');
    assert(!selection.includes("setAttribute('aria-pressed'"), 'weapon selection helper must not duplicate quick-slot ARIA ownership');
  });

  suite.test('PUBG rebind derives quick-slot class and ARIA exclusively from canonical active weapon state', () => {
    assert(pubg.includes('const activeIndex = Number(game?.getActiveWeaponIndex?.() ?? 0)'), 'quick-slot presentation must read canonical active weapon index');
    assert(pubg.includes("button.classList.contains('is-active') !== active") && pubg.includes("button.classList.toggle('is-active', active)"), 'quick-slot class update must remain idempotent');
    assert(pubg.includes("button.getAttribute('aria-pressed') !== pressed") && pubg.includes("button.setAttribute('aria-pressed', pressed)"), 'quick-slot ARIA update must remain idempotent');
    assert(pubg.includes('rebind: attachWhenAvailable'), 'PUBG touch API must expose its idempotent presentation rebind');
  });

  suite.test('Real browser map smoke requires one visually and accessibly active quick slot', () => {
    assert(smoke.includes("'map-open direct weapon presentation sync'"), 'browser smoke must wait for map-open presentation synchronization');
    assert(smoke.includes("selected?.classList.contains('is-active')") && smoke.includes("selected?.getAttribute('aria-pressed') === 'true'"), 'browser smoke must verify selected slot visual and ARIA state');
    assert(smoke.includes("previous?.getAttribute('aria-pressed') === 'false'"), 'browser smoke must verify previous slot is released');
    assert(smoke.includes("querySelectorAll('#mc-weapon-slots .mc-weapon-slot.is-active').length === 1"), 'browser smoke must enforce exactly one active quick slot');
  });
}

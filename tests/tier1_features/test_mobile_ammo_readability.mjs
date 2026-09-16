import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const presentation = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobileAdaptivePresentation.ts'), 'utf8');
  const smoke = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_reload_progress_smoke.mjs'), 'utf8');

  suite.test('Mobile ammo readability derives semantic states from canonical weapon ownership', () => {
    assert(presentation.includes("type AmmoReadabilityState = 'melee' | 'ready' | 'low' | 'empty' | 'dry' | 'reloading'"), 'presentation must expose explicit ammo readability states');
    assert(presentation.includes("const weapons = (window as any).goneWeapons") && presentation.includes("weapons?.ammo?.[key]") && presentation.includes("weapons?.config?.[key]"), 'ammo presentation must read canonical ammo and weapon config');
    assert(presentation.includes("weapons?.isReloading?.()") && presentation.includes("return 'reloading'"), 'reloading state must come from canonical reload ownership');
    assert(presentation.includes("return reserve > 0 ? 'empty' : 'dry'"), 'empty magazine must distinguish reloadable and fully dry states');
    assert(presentation.includes('Math.ceil(magazineSize * 0.25)'), 'low ammo threshold must scale with magazine capacity');
  });

  suite.test('Ammo readability is event-driven and cannot create a MutationObserver feedback loop', () => {
    assert(presentation.includes("ammoObserver.observe(hud, { childList: true, subtree: true, characterData: true })"), 'ammo observer must react only to canonical HUD text changes');
    assert(!presentation.includes("ammoObserver.observe(hud, { attributes: true"), 'ammo observer must not watch attributes that presentation writes');
    assert(presentation.includes("hud.dataset.goneAmmoState = state") && presentation.includes("reload.dataset.goneAmmoState = state"), 'semantic state must be mirrored to HUD and reload control');
    assert(presentation.includes("reload.setAttribute('aria-label', ammoAriaLabel(state))") && presentation.includes("reload.setAttribute('aria-busy', state === 'reloading' ? 'true' : 'false')"), 'reload affordance must expose accessible state');
    assert(!presentation.includes('requestAnimationFrame(syncAmmoReadability') && !presentation.includes('setInterval(syncAmmoReadability'), 'ammo readability must not add polling');
  });

  suite.test('Peripheral ammo states are visually differentiated without changing target geometry', () => {
    for (const state of ['low', 'empty', 'dry', 'reloading']) {
      assert(presentation.includes(`data-gone-ammo-state=\"${state}\"`), `missing ${state} visual selector`);
    }
    assert(smoke.includes("setAmmoState(page, prepared.magazineSize, 20, 'ready')"), 'browser smoke must establish ready baseline');
    assert(smoke.includes("setAmmoState(page, 0, 20, 'empty')") && smoke.includes("setAmmoState(page, 0, 0, 'dry')"), 'browser smoke must cover empty and dry states');
    assert(smoke.includes('state.reloadWidth >= 48'), 'browser smoke must preserve minimum reload touch target');
    assert(smoke.includes('low.primaryColor !== ready.primaryColor') && smoke.includes('dry.reloadOpacity < ready.reloadOpacity'), 'browser smoke must verify peripheral visual differentiation');
  });
}

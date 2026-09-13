import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Local victim receives immediate damage feedback without changing combat authority', () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'combatFeedback.ts'), 'utf8');

    assert(source.includes('localPlayerSlot() !== hit.victimSlot'), 'incoming feedback must only render for the local victim');
    assert(source.includes("damageVignetteRoot.id = 'gone-damage-vignette'"), 'combat feedback must own a dedicated non-interactive damage vignette');
    assert(source.includes("damageVignetteRoot!.setAttribute('aria-hidden', 'true')"), 'purely visual damage feedback must stay out of the accessibility tree');
    assert(source.includes("hit.isShieldBlocked") && source.includes("'96,165,250'"), 'shield blocks must be visually distinct from hull damage');
    assert(source.includes('hit.isFatalKill || hit.isFatal') && source.includes("'244,63,94'"), 'fatal damage must have a stronger terminal treatment');
    assert(source.includes('Number(hit.newHp)') && source.includes('Number(hit.damage)'), 'feedback intensity must reflect authoritative hit severity');
    assert(source.includes("document.getElementById('health-hud')") && source.includes('healthHud?.animate?.('), 'incoming hits must reinforce the existing health HUD without creating a second health owner');
    assert(source.includes('@media (prefers-reduced-motion:reduce)'), 'combat feedback must respect reduced-motion preferences');
    assert(source.includes('showIncomingDamage(event.detail);'), 'the stable combat event bridge must drive victim feedback');
    assert(!source.includes('setInterval('), 'combat feedback must remain event-driven rather than polling gameplay state');
  });
}

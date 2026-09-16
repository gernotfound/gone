import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Local victim receives immediate directional impact feedback without duplicating the health vignette owner', () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'combatFeedback.ts'), 'utf8');
    const healthHud = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'healthHud.ts'), 'utf8');

    assert(source.includes('localPlayerSlot() !== hit.victimSlot'), 'incoming feedback must only render for the local victim');
    assert(source.includes("impactRoot.id = 'gone-incoming-impact'"), 'combat feedback must own one incoming impact indicator');
    assert(source.includes("impactRoot.setAttribute('aria-hidden', 'true')"), 'purely visual impact feedback must stay out of the accessibility tree');
    assert(source.includes("hit.isShieldBlocked") && source.includes("'#60a5fa'"), 'shield blocks must be visually distinct from hull damage');
    assert(source.includes('hit.isFatalKill || hit.isFatal') && source.includes("'#f43f5e'"), 'fatal damage must have a stronger terminal treatment');

    assert(source.includes('remotePlayers?.values?.()') && source.includes('Number(remote?.slot) !== shooterSlot'), 'direction must resolve the canonical remote player by combat slot');
    assert(source.includes('remote?.group?.position'), 'direction must use the interpolated remote presentation position');
    assert(source.includes('const worldAngle = Math.atan2(dx, -dz);'), 'yaw-zero direction must match engine forward on negative Z');
    assert(source.includes('worldAngle - yaw') && source.includes('Math.atan2(Math.sin('), 'relative direction must be normalized against canonical local yaw');
    assert(source.includes("classList.toggle('is-directional', direction !== null)") && source.includes("classList.toggle('is-omni', direction === null)"), 'impact UI must switch between directional arc and safe omnidirectional fallback');
    assert(source.includes("style.setProperty('--impact-angle', `${direction.toFixed(1)}deg`)") && source.includes("style.removeProperty('--impact-angle')"), 'directional rotation must be explicit and cleared for fallback hits');
    assert(source.includes('directionalIncomingCount') && source.includes('omnidirectionalIncomingCount') && source.includes('lastImpactAngleDegrees'), 'presentation diagnostics must expose directional and fallback outcomes');

    assert(source.includes("document.getElementById('health-hud')") && source.includes('healthHud?.animate?.('), 'incoming hits must reinforce the existing health HUD without creating a second health owner');
    assert(source.includes("filter: `brightness(${fatal ? 1.85 : shield ? 1.35 : 1.55})`"), 'health reinforcement must distinguish fatal and shield impacts');
    assert(source.includes('@media (prefers-reduced-motion:reduce)'), 'combat feedback must respect reduced-motion preferences');
    assert(source.includes('showIncomingImpact(event.detail);'), 'the stable combat event bridge must drive victim feedback');
    assert(!source.includes('gone-damage-vignette') && !source.includes("id = 'damage-vignette'"), 'combat feedback must not duplicate the health HUD damage vignette');
    assert(healthHud.includes("overlay.id = 'damage-vignette'"), 'health HUD must remain the sole owner of the existing damage vignette');
    assert(!source.includes('setInterval('), 'combat feedback must remain event-driven rather than polling gameplay state');
  });
}

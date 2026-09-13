import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Local fatal hits produce a compact authoritative killer recap inside the existing death overlay', () => {
    const feedback = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'gameplay', 'combatFeedback.ts'), 'utf8');
    const healthHud = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'healthHud.ts'), 'utf8');

    assert(feedback.includes("document.getElementById('death-overlay')"), 'death recap must reuse the existing death overlay');
    assert(feedback.includes("root.id = 'gone-death-recap'"), 'combat feedback must create one dedicated recap panel');
    assert(feedback.includes("root.setAttribute('aria-live', 'polite')"), 'recap must expose non-disruptive accessibility status');
    assert(feedback.includes("localPlayerSlot() !== hit.victimSlot"), 'recap must only render for the local victim');
    assert(feedback.includes('hit.isFatalKill || hit.isFatal'), 'nonfatal hits must not populate the death recap');
    assert(feedback.includes('nameForSlot(hit.shooterSlot)'), 'killer name must come from the current authoritative/session roster mapping');
    assert(feedback.includes("hit.isHeadshot ? 'HEADSHOT' : 'COLPO LETALE'"), 'recap must distinguish fatal headshots');
    assert(feedback.includes('Math.round(hit.damage)'), 'recap must display authoritative final-hit damage');
    assert(feedback.includes('showDeathRecap(event.detail);'), 'the stable combat event bridge must drive the recap');
    assert(feedback.includes('html.gone-smartphone #gone-death-recap'), 'recap must have explicit smartphone presentation bounds');
    assert(healthHud.includes('this.clearDeathRecap();'), 'death overlay lifecycle must clear stale recap state on respawn/reset');
    assert(healthHud.includes("document.getElementById('gone-death-recap')?.classList.remove('show')"), 'hidden death overlay must also hide the recap panel');
    assert(!feedback.includes('setInterval('), 'death recap must remain event-driven');
  });
}

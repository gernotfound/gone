import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const adaptivePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'mobileAdaptivePresentation.ts');
  const runtimePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const smokePath = path.join(PROJECT_ROOT, 'game-web', 'scripts', 'mobile_adaptive_layout_smoke.mjs');
  const workflowPath = path.join(PROJECT_ROOT, '.github', 'workflows', 'rescue-ci.yml');

  const adaptive = fs.readFileSync(adaptivePath, 'utf-8');
  const runtime = fs.readFileSync(runtimePath, 'utf-8');
  const smoke = fs.readFileSync(smokePath, 'utf-8');
  const workflow = fs.readFileSync(workflowPath, 'utf-8');

  suite.test('Portrait smartphone mode blocks accidental combat input behind a full-screen rotate guard', () => {
    assert(adaptive.includes('@media (orientation: portrait) and (max-width: 760px)'), 'adaptive presentation must define a portrait phone guard');
    assert(adaptive.includes('#gone-mobile-controls *') && adaptive.includes('pointer-events: none !important'), 'portrait guard must disable descendant touch targets');
    assert(adaptive.includes('width: 100dvw !important') && adaptive.includes('height: 100dvh !important'), 'rotate overlay must cover the dynamic viewport');
    assert(adaptive.includes("rotate.textContent = 'RUOTA IL TELEFONO · GIOCA IN ORIZZONTALE'"), 'portrait instruction must be concise and explicit');
  });

  suite.test('Mobile kill feed stays idle-hidden and becomes a compact three-row awareness channel when populated', () => {
    assert(adaptive.includes('html.gone-smartphone #gone-kill-feed {') && adaptive.includes('display: none !important'), 'empty smartphone kill feed must not occupy HUD space');
    assert(adaptive.includes('#gone-kill-feed:has(> .gone-kill-row)') && adaptive.includes('display: flex !important'), 'populated smartphone kill feed must become visible');
    assert(adaptive.includes('.gone-kill-row:nth-child(n+4)') && adaptive.includes('display: none !important'), 'smartphone kill feed must cap visible rows at three');
    assert(adaptive.includes('max-width: min(46dvw, 220px)'), 'kill feed width must scale with the phone viewport');
  });

  suite.test('Confirmed local hits may emit lightweight phone haptics without becoming combat authority', () => {
    assert(adaptive.includes("window.addEventListener('gone-hit-confirmed'"), 'mobile polish must consume the canonical hit-confirmed event');
    assert(adaptive.includes('localPlayerSlot() !== hit.shooterSlot'), 'haptics must only acknowledge hits fired by the local player');
    assert(adaptive.includes("typeof navigator.vibrate !== 'function'"), 'haptics must remain capability-gated');
    assert(!adaptive.includes('damage =') && !adaptive.includes('newHp ='), 'presentation module must not calculate or mutate combat damage state');
  });

  suite.test('Adaptive presentation is registered after the mobile gameplay runtime and combat event bridge', () => {
    assert(runtime.includes("import { startMobileAdaptivePresentation } from '../mobile/mobileAdaptivePresentation.ts'"), 'client composition must import adaptive mobile presentation');
    assert(runtime.includes("name: 'mobileAdaptivePresentation'"), 'adaptive presentation must be a named runtime module');
    assert(runtime.includes("dependsOn: ['bootstrap', 'mobileRuntime', 'combatEventBridge']"), 'adaptive presentation must depend on mobile DOM and canonical combat events');
  });

  suite.test('Real browser smoke covers live handedness mirroring and viewport reflow without runtime restart', () => {
    assert(smoke.includes('assertHandednessMirror') && smoke.includes("setHandedness(page, 'left')"), 'browser smoke must switch handedness in a live match');
    assert(smoke.includes('page.setViewportSize({ width: spec.width, height: spec.height })'), 'browser smoke must resize the active match across landscape phone sizes');
    assert(smoke.includes('assertPortraitSafety') && smoke.includes("pointerEvents === 'none'"), 'browser smoke must prove portrait input blocking');
    assert(smoke.includes("finalState.health.status === 'healthy'"), 'browser smoke must verify runtime health after adaptive transitions');
  });

  suite.test('Rescue CI executes and archives the adaptive mobile browser smoke', () => {
    assert(workflow.includes('run_smoke mobile_adaptive_layout_smoke.mjs rescue-mobile-adaptive.log'), 'Rescue CI must execute adaptive mobile smoke');
    assert(workflow.includes('rescue-mobile-adaptive.log'), 'adaptive smoke diagnostics must be uploaded');
  });
}

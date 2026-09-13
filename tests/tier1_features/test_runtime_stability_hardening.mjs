import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  const main = source('game-web', 'src', 'main.ts');
  const engine = source('game-web', 'src', 'gameplay', 'engine.ts');
  const input = source('game-web', 'src', 'controls', 'playerInput.ts');
  const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const diagnostics = source('game-web', 'src', 'observability', 'clientDiagnostics.ts');
  const telemetry = source('game-web', 'api', 'client-telemetry.js');
  const pwa = source('game-web', 'src', 'pwa', 'pwaRuntime.ts');

  suite.test('Top-level composition starts diagnostics first and isolates optional features', () => {
    assert(main.includes('startClientDiagnostics();'), 'diagnostics must start before optional top-level features');
    assert(main.includes("safeStart('smartphoneProfile', startSmartphoneProfile)"), 'smartphone profile startup must be isolated');
    assert(main.includes("safeStart('pwaRuntime', startPwaRuntime)"), 'PWA startup must be isolated');
    assert(main.includes("new CustomEvent('gone-runtime-start-error'"), 'top-level startup failures must emit diagnostics');
    assert(main.includes("console.error('[main] client runtime failed'"), 'core runtime failure must not prevent recovery surfaces from remaining alive');
  });

  suite.test('Gameplay preload is single-flight and render loop starts once', () => {
    assert(engine.includes('let preloadPromise: Promise<void> | null = null'), 'engine must track one in-flight preload');
    assert(engine.includes('if (preloadPromise) return preloadPromise'), 'repeated launch gestures must share the same preload promise');
    assert(engine.includes('let hasInitializedGame = false'), 'WASM readiness must be distinct from full game readiness');
    assert(engine.includes('if (!hasInitializedGame) void preLoadGame()'), 'menu launch must depend on full game readiness');
    assert(engine.includes('let renderLoopStarted = false'), 'engine must track render-loop startup');
    assert(engine.includes('if (!renderLoopStarted)'), 'engine must guard against duplicate render loops');
  });

  suite.test('Player input listeners are idempotent and reset on lifecycle suspension', () => {
    assert(input.includes('let inputListenersInstalled = false'), 'input runtime must guard duplicate browser listeners');
    assert(input.includes('if (inputListenersInstalled) return'), 'input reinitialization must only replace callbacks');
    assert(input.includes("window.addEventListener('pagehide', resetInputState)"), 'pagehide must release held inputs');
    assert(input.includes("document.addEventListener('visibilitychange'"), 'hidden tabs must release held inputs');
  });

  suite.test('Optional runtime starters fail independently and report the failing module', () => {
    assert(runtime.includes('__goneClientRuntimeStarted'), 'client composition root must be idempotent');
    assert(runtime.includes('function safeStart('), 'optional runtime modules must use isolated startup boundaries');
    assert(runtime.includes("new CustomEvent('gone-runtime-start-error'"), 'startup failures must publish a diagnostic event');
    assert(runtime.includes("requiredStart('bootstrap', bootstrap)"), 'menu bootstrap must remain a required core dependency');
  });

  suite.test('Runtime startup and WebGL restoration are observable through bounded telemetry', () => {
    assert(diagnostics.includes("| 'runtime_start_error'"), 'client diagnostics must classify runtime startup errors');
    assert(diagnostics.includes("| 'webgl_context_restored'"), 'client diagnostics must classify WebGL restoration');
    assert(diagnostics.includes("window.addEventListener('gone-runtime-start-error'"), 'runtime startup events must be captured');
    assert(diagnostics.includes("canvas.addEventListener('webglcontextrestored'"), 'WebGL recovery must be observed');
    assert(telemetry.includes("'runtime_start_error'"), 'Vercel telemetry endpoint must allow startup errors');
    assert(telemetry.includes("'webgl_context_restored'"), 'Vercel telemetry endpoint must allow recovery events');
  });

  suite.test('PWA version checks are coalesced, bounded and fully cleaned up', () => {
    assert(pwa.includes('VERSION_FETCH_TIMEOUT_MS = 8_000'), 'version beacon fetch must have a bounded timeout');
    assert(pwa.includes('new AbortController()'), 'version fetch timeout must actively abort the request');
    assert(pwa.includes('let updateCheckPromise: Promise<void> | null = null'), 'PWA runtime must coalesce concurrent update checks');
    assert(pwa.includes('if (updateCheckPromise) return updateCheckPromise'), 'focus/online/timer checks must share one in-flight request');
    assert(pwa.includes('pendingApplyTimer'), 'pending update polling timer must be tracked for cleanup');
    assert(pwa.includes('window.clearInterval(pendingApplyTimer)'), 'pending update timer must be cleared before unload');
  });
}

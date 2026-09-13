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
  const kernel = source('game-web', 'src', 'runtime', 'runtimeKernel.ts');
  const lifecycle = source('game-web', 'src', 'runtime', 'browserLifecycle.ts');
  const availability = source('game-web', 'src', 'ui', 'runtimeAvailabilityUi.ts');
  const diagnostics = source('game-web', 'src', 'observability', 'clientDiagnostics.ts');
  const telemetry = source('game-web', 'api', 'client-telemetry.js');
  const pwa = source('game-web', 'src', 'pwa', 'pwaRuntime.ts');

  suite.test('Composition uses one declarative runtime kernel instead of local safe-start wrappers', () => {
    assert(main.includes('runtimeKernel.registerMany(SHELL_MODULES)'), 'shell features must register with the shared kernel');
    assert(main.includes("runtimeKernel.startPhase('foundation')"), 'shell foundation must start through one owner');
    assert(runtime.includes('runtimeKernel.registerMany(CLIENT_RUNTIME_MODULES)'), 'game modules must register with the same kernel');
    assert(!main.includes('function safeStart(') && !runtime.includes('function safeStart('), 'duplicated startup wrappers must be removed');
    assert(kernel.includes("status: 'booting' | 'healthy' | 'degraded' | 'failed'"), 'kernel must expose explicit health states');
    assert(kernel.includes("record.state = 'blocked'"), 'dependency failures must block dependants explicitly');
    assert(kernel.includes("operation: 'start' | 'reconcile' | 'dependency'"), 'dependency failures must be observable through the same failure channel');
  });

  suite.test('Gameplay preload is single-flight and render loop starts once', () => {
    assert(engine.includes('let preloadPromise: Promise<void> | null = null'), 'engine must track one in-flight preload');
    assert(engine.includes('if (preloadPromise) return preloadPromise'), 'repeated launch gestures must share the same preload promise');
    assert(engine.includes('let hasInitializedGame = false'), 'WASM readiness must be distinct from full game readiness');
    assert(engine.includes('if (!hasInitializedGame) void preLoadGame()'), 'menu launch must depend on full game readiness');
    assert(engine.includes('let renderLoopStarted = false'), 'engine must track render-loop startup');
    assert(engine.includes('if (!renderLoopStarted)'), 'engine must guard against duplicate render loops');
  });

  suite.test('Player input listeners are idempotent and release through ordered lifecycle delivery', () => {
    assert(input.includes('let inputListenersInstalled = false'), 'input runtime must guard duplicate browser listeners');
    assert(input.includes('if (inputListenersInstalled) return'), 'input reinitialization must only replace callbacks');
    assert(input.includes("browserLifecycle.subscribe('pagehide', 'playerInput'"), 'pagehide must release held inputs through the lifecycle owner');
    assert(input.includes("browserLifecycle.subscribe('hidden', 'playerInput'"), 'hidden tabs must release held inputs through the lifecycle owner');
    assert(lifecycle.includes("document.addEventListener('visibilitychange'"), 'lifecycle broker must own the native visibility listener');
    assert(lifecycle.includes('current.sort((a, b) => b.priority - a.priority'), 'lifecycle handlers must have deterministic priority ordering');
  });

  suite.test('Critical runtime invariants fail closed instead of activating device combat partially', () => {
    assert(runtime.includes("name: 'bootstrap', phase: 'bootstrap', critical: true"), 'menu/game bootstrap must be critical');
    assert(runtime.includes("name: 'advancedWeaponController'"), 'ammo-authoritative weapon controller must be registered');
    assert(runtime.includes('critical: true') && runtime.includes("dependsOn: BOOTSTRAP_DEPENDENCY"), 'critical gameplay invariants must depend on bootstrap explicitly');
    assert(runtime.includes("new CustomEvent('gone-runtime-unavailable'"), 'core failure must publish an explicit unavailable state');
    assert(main.includes("const COMBAT_SAFE_CORE = ['bootstrap', 'advancedWeaponController']"), 'device modules must share one combat-safe dependency contract');
    assert(main.includes("if (runtimeKernel.isReady('advancedWeaponController'))"), 'device controls must not start if ammo authority failed');
    assert(availability.includes('AVVIO SICURO INTERROTTO') && availability.includes('window.location.reload()'), 'failed core must have an actionable fail-closed UI');
    assert(kernel.includes('criticalFailure'), 'kernel health must fail when a critical module is failed or blocked');
    assert(kernel.includes("new CustomEvent('gone-runtime-start-error'"), 'kernel failures must publish diagnostics');
  });

  suite.test('Runtime startup, lifecycle and WebGL recovery are observable through bounded telemetry', () => {
    assert(diagnostics.includes("| 'runtime_start_error'") && diagnostics.includes("| 'runtime_lifecycle_error'"), 'client diagnostics must classify startup and lifecycle failures');
    assert(diagnostics.includes("| 'webgl_context_restored'"), 'client diagnostics must classify WebGL restoration');
    assert(diagnostics.includes("window.addEventListener('gone-runtime-lifecycle-error'"), 'lifecycle subscriber failures must be captured');
    assert(diagnostics.includes("canvas.addEventListener('webglcontextrestored'"), 'WebGL recovery must be observed');
    assert(telemetry.includes("'runtime_lifecycle_error'"), 'Vercel telemetry endpoint must allow lifecycle failures');
  });

  suite.test('PWA version checks are coalesced, bounded and lifecycle-owned', () => {
    assert(pwa.includes('VERSION_FETCH_TIMEOUT_MS = 8_000'), 'version beacon fetch must have a bounded timeout');
    assert(pwa.includes('new AbortController()'), 'version fetch timeout must actively abort the request');
    assert(pwa.includes('let updateCheckPromise: Promise<void> | null = null'), 'PWA runtime must coalesce concurrent update checks');
    assert(pwa.includes('if (updateCheckPromise) return updateCheckPromise'), 'focus/online/timer checks must share one in-flight request');
    assert(pwa.includes("browserLifecycle.subscribe('visible', 'pwaUpdate'"), 'PWA foreground checks must use the lifecycle owner');
    assert(pwa.includes("browserLifecycle.subscribe('beforeunload', 'pwaUpdate', cleanupUpdateTimers"), 'PWA timer cleanup must use the lifecycle owner');
  });
}

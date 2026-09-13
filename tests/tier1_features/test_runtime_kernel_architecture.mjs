import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  const main = source('game-web', 'src', 'main.ts');
  const kernel = source('game-web', 'src', 'runtime', 'runtimeKernel.ts');
  const lifecycle = source('game-web', 'src', 'runtime', 'browserLifecycle.ts');
  const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const availabilityUi = source('game-web', 'src', 'ui', 'runtimeAvailabilityUi.ts');
  const guard = source('game-web', 'src', 'mobile', 'smartphoneControlsGuard.ts');
  const input = source('game-web', 'src', 'controls', 'playerInput.ts');
  const pwa = source('game-web', 'src', 'pwa', 'pwaRuntime.ts');
  const resume = source('game-web', 'src', 'mobile', 'mobileSessionResume.ts');
  const vite = source('game-web', 'vite.config.ts');

  suite.test('Runtime kernel owns module state, dependencies and health', () => {
    for (const state of ['registered', 'starting', 'ready', 'failed', 'blocked']) {
      assert(kernel.includes(`'${state}'`), `runtime kernel must model ${state} state`);
    }
    assert(kernel.includes('dependsOn?: readonly string[]'), 'runtime modules must declare dependencies');
    assert(kernel.includes('this.start(dependency, dependencyStack)'), 'dependencies must start through the kernel recursively');
    assert(kernel.includes('criticalFailure'), 'critical failures must affect global health');
    assert(kernel.includes("status: 'booting' | 'healthy' | 'degraded' | 'failed'"), 'runtime health must be externally meaningful');
    assert(kernel.includes('window.goneRuntimeHealth'), 'runtime health must have a stable diagnostics facade');
  });

  suite.test('Composition roots contain declarations, not duplicate failure wrappers', () => {
    assert(main.includes('const SHELL_MODULES') && main.includes('const DEVICE_MODULES'), 'main must be declarative composition');
    assert(runtime.includes('const CLIENT_RUNTIME_MODULES'), 'client runtime must be declarative composition');
    assert(!main.includes('function safeStart(') && !runtime.includes('function safeStart('), 'composition roots must not duplicate startup wrappers');
    assert(!main.includes('__goneSmartphoneControlsGuardStarted = false'), 'composition must not force module restarts by mutating private flags');
    assert(runtime.includes("name: 'bootstrap', phase: 'bootstrap', critical: true"), 'bootstrap criticality must be explicit');
    assert(runtime.includes("name: 'advancedWeaponController'") && runtime.includes('critical: true'), 'finite-ammo gameplay authority must be health-critical');
  });

  suite.test('Cross-system browser lifecycle has one ordered owner', () => {
    assert(lifecycle.includes("document.addEventListener('visibilitychange'"), 'broker must own native visibility changes');
    assert(lifecycle.includes("window.addEventListener('online'"), 'broker must own online delivery');
    assert(lifecycle.includes("window.addEventListener('offline'"), 'broker must own offline delivery');
    assert(lifecycle.includes('b.priority - a.priority'), 'subscribers must execute in deterministic priority order');
    assert(lifecycle.includes("new CustomEvent('gone-runtime-lifecycle-error'"), 'subscriber failures must be isolated and observable');
    for (const consumer of [input, pwa, resume]) {
      assert(consumer.includes("../runtime/browserLifecycle.ts") || consumer.includes("'./runtime/browserLifecycle.ts'"), 'cross-system lifecycle consumers must import the broker');
    }
  });

  suite.test('Touch fallback uses one kernel-owned reconciliation path', () => {
    assert(guard.includes('export function reconcileSmartphoneControlsGuard'), 'touch guard must expose reconciliation');
    assert(!guard.includes("window.addEventListener('gone-input-mode-changed'"), 'touch guard must not install a second mode-change owner');
    assert(guard.includes('if (guardStarted)') && guard.includes('reconcileSmartphoneControlsGuard();'), 'repeat start must be idempotent');
    assert(main.includes('reconcile: reconcileSmartphoneControlsGuard'), 'kernel must know the device module can reconcile');
    assert(main.includes("window.addEventListener('gone-input-mode-changed'"), 'composition must forward application configuration changes once');
    assert(main.includes("runtimeKernel.reconcilePhase('device')"), 'device reconciliation must run through the kernel');
  });

  suite.test('Critical core failure blocks device controls and exposes a safe recovery UI', () => {
    assert(main.includes("const COMBAT_SAFE_CORE = ['bootstrap', 'advancedWeaponController']"), 'device controls must depend on the combat-safe core');
    assert(main.includes("if (runtimeKernel.isReady('advancedWeaponController'))"), 'device phase must never activate over a failed ammo authority');
    assert(main.includes("name: 'runtimeAvailabilityUi'"), 'fail-closed recovery UI must start as shell infrastructure');
    assert(availabilityUi.includes("window.addEventListener('gone-runtime-unavailable'"), 'recovery UI must consume explicit runtime-unavailable events');
    assert(availabilityUi.includes('AVVIO SICURO INTERROTTO'), 'critical failure must present an actionable user-facing state');
    assert(availabilityUi.includes('window.location.reload()'), 'recovery UI must provide a deterministic reload action');
  });

  suite.test('Fallback replaces half-owned touch DOM instead of stacking listeners', () => {
    assert(guard.includes("existing.dataset.goneControlOwner === 'fallback'"), 'fallback must recognize its own control tree');
    assert(guard.includes('existing.remove();'), 'unknown or partial control ownership must be replaced rather than patched');
    assert(guard.includes("fallbackRoot.dataset.goneFallbackBound === '1'"), 'fallback handlers must be bound idempotently');
  });

  suite.test('Build isolates stable Three runtime without relaxing execution ordering', () => {
    assert(vite.includes('rolldownOptions'), 'Vite 8 bundle policy must use Rolldown output options');
    assert(vite.includes('codeSplitting'), 'bundle must use explicit code splitting rather than hiding the chunk warning');
    assert(vite.includes("name: 'three-vendor'"), 'Three.js must be isolated into a stable vendor cache unit');
    assert(vite.includes('strictExecutionOrder: true'), 'manual chunking must preserve module side-effect order');
  });
}

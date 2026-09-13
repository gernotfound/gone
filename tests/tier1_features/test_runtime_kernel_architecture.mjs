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

  suite.test('Touch fallback uses reconciliation instead of startup-flag reset', () => {
    assert(guard.includes('export function reconcileSmartphoneControlsGuard'), 'touch guard must expose reconciliation');
    assert(guard.includes("window.addEventListener('gone-input-mode-changed', reconcileSmartphoneControlsGuard)"), 'guard must own its mode transition');
    assert(guard.includes('if (guardStarted)') && guard.includes('reconcileSmartphoneControlsGuard();'), 'repeat start must be idempotent');
    assert(main.includes('reconcile: reconcileSmartphoneControlsGuard'), 'kernel must know the device module can reconcile');
  });

  suite.test('Build isolates stable Three runtime without relaxing execution ordering', () => {
    assert(vite.includes('rolldownOptions'), 'Vite 8 bundle policy must use Rolldown output options');
    assert(vite.includes('codeSplitting'), 'bundle must use explicit code splitting rather than hiding the chunk warning');
    assert(vite.includes("name: 'three-vendor'"), 'Three.js must be isolated into a stable vendor cache unit');
    assert(vite.includes('strictExecutionOrder: true'), 'manual chunking must preserve module side-effect order');
  });
}

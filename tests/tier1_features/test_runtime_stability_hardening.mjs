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
  const localPlayerLifecycle = source('game-web', 'src', 'gameplay', 'localPlayerLifecycle.ts');
  const bindings = source('game-web', 'src', 'gameplay', 'networkBindings.ts');
  const p2pHost = source('game-web', 'src', 'net', 'p2pHost.ts');
  const input = source('game-web', 'src', 'controls', 'playerInput.ts');
  const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const kernel = source('game-web', 'src', 'runtime', 'runtimeKernel.ts');
  const lifecycle = source('game-web', 'src', 'runtime', 'browserLifecycle.ts');
  const availability = source('game-web', 'src', 'ui', 'runtimeAvailabilityUi.ts');
  const diagnostics = source('game-web', 'src', 'observability', 'clientDiagnostics.ts');
  const telemetry = source('game-web', 'api', 'client-telemetry.js');
  const pwa = source('game-web', 'src', 'pwa', 'pwaRuntime.ts');
  const networkPatchPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'networkStabilityFix.ts');
  const precision = source('game-web', 'src', 'gameplay', 'precisionShotRuntime.ts');
  const roundLifecycle = source('game-web', 'src', 'gameplay', 'deathmatchRoundLifecycle.ts');
  const weapons = source('game-web', 'src', 'gameplay', 'advancedWeaponController.ts');

  suite.test('Host transport resilience belongs to P2PHost instead of a runtime monkey-patch', () => {
    assert(!fs.existsSync(networkPatchPath), 'networkStabilityFix prototype patch must stay deleted');
    assert(!runtime.includes('networkStabilityFix'), 'runtime composition must not register a host monkey-patch layer');
    assert(p2pHost.includes('const state = peer.channel.readyState'), 'host broadcast must inspect transport readiness directly');
    assert(p2pHost.includes("state === 'closing' || state === 'closed'"), 'host must identify terminal peer channels');
    assert(p2pHost.includes('this.handlePeerDisconnect(id)'), 'host must clean terminal peers through its own lifecycle');
  });

  suite.test('Local shots use one engine-owned pipeline, not competing runtime fireWeapon wrappers', () => {
    assert(engine.includes('if (!canFireLocalRoundShot()) return;'), 'engine must reject local shots while a deathmatch round is locked');
    assert(engine.includes('fireWithPrecision(currentWeaponType, commitWeaponShot);'), 'all local fire paths must apply spread before a shot commits');
    assert(engine.includes('function commitWeaponShot(): void {'), 'engine must own exactly one shot implementation');
    assert(!precision.includes('api.fireWeapon =') && !precision.includes('originalFireWeapon'), 'precision must not overwrite compatibility fire methods');
    assert(precision.includes('finally {') && precision.includes('camera.quaternion.copy(originalQuaternion)'), 'temporary shot spread must restore the camera on every exit path');
    assert(!roundLifecycle.includes('game.fireWeapon =') && !roundLifecycle.includes('setInterval('), 'round lock must not monkey-patch or poll for fire methods');
    assert(roundLifecycle.includes('export function canFireLocalRoundShot(): boolean'), 'round owner must expose an explicit synchronous shot gate');
    assert(roundLifecycle.includes('resetAllWeaponAmmoForRound()'), 'round owner must delegate ammo resets to the canonical inventory owner');
    assert(weapons.includes('export function resetAllWeaponAmmoForRound(): void'), 'ammo owner must atomically clear reload and restore inventory');
    assert(roundLifecycle.includes('configureRoundLocalRespawn(') && engine.includes('configureRoundLocalRespawn(handleLocalPlayerRespawn)'), 'round reset must call registered local lifecycle, not the window facade');
    assert(engine.includes('fireWeapon,') && precision.includes('api.getAimSpreadRadians ='), 'legacy browser diagnostics and fire method must remain available');
  });

  suite.test('Remote presentation reads typed session and registry owners, not the browser debug facade', () => {
    const migratedFiles = [
      ['gameplay', 'remoteRobotMotion.ts'],
      ['gameplay', 'killAmmoReset.ts'],
      ['net', 'pvpTuning.ts'],
      ['net', 'remoteShotPresentation.ts'],
      ['net', 'hostRemoteSync.ts'],
    ];
    for (const [domain, filename] of migratedFiles) {
      const code = source('game-web', 'src', domain, filename);
      assert(!code.includes('.goneGame'), `${filename} must not depend on window.goneGame`);
    }

    const remoteMotion = source('game-web', 'src', 'gameplay', 'remoteRobotMotion.ts');
    const hostSync = source('game-web', 'src', 'net', 'hostRemoteSync.ts');
    const shotPresentation = source('game-web', 'src', 'net', 'remoteShotPresentation.ts');
    const pvpTuning = source('game-web', 'src', 'net', 'pvpTuning.ts');

    assert(remoteMotion.includes("from './remotePlayerRegistry.ts'"), 'remote animation must use registry ownership');
    assert(hostSync.includes("from './multiplayerSessionController.ts'"), 'host rendering must read the authoritative session');
    assert(hostSync.includes('removeRemotePlayer(id)'), 'host rendering cleanup must go through registry disposal');
    assert(shotPresentation.includes("from '../gameplay/remotePlayerRegistry.ts'"), 'shot VFX must resolve actual remote instances');
    assert(pvpTuning.includes('const client = activeP2PClient'), 'network timing must read the active session directly');
  });

  suite.test('Local combat lifecycle has one focused owner outside engine and networking', () => {
    assert(localPlayerLifecycle.includes('class LocalPlayerLifecycleController'), 'local HP/death/respawn/shield lifecycle needs one owner');
    assert(localPlayerLifecycle.includes('public handleDeath()') && localPlayerLifecycle.includes('public handleRespawn('), 'lifecycle owner must expose explicit transitions');
    assert(localPlayerLifecycle.includes('public applyAuthoritativeState('), 'network snapshots must synchronize through the lifecycle owner');
    assert(engine.includes('new LocalPlayerLifecycleController({'), 'engine must compose the lifecycle owner instead of duplicating its state machine');
    assert(!engine.includes('player.deathTimer = Math.max(0, player.deathTimer - delta)'), 'engine loop must not own death countdown transitions');
    assert(bindings.includes('context.applyAuthoritativeLocalLifecycle({'), 'network binding must forward authoritative lifecycle state');
    assert(!bindings.includes('player.hp = state.hp'), 'network binding must not duplicate local HP ownership');
    assert(!bindings.includes('player.isInvulnerable = true'), 'network binding must not duplicate local shield ownership');
  });

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

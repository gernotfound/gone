import { bootstrap } from '../gameplay/engine.ts';
import { startAdvancedWeaponController } from '../gameplay/advancedWeaponController.ts';
import { startAimMovementTuning } from '../gameplay/aimMovementTuning.ts';
import { startCraterSupplyPickups } from '../gameplay/craterSupplyPickups.ts';
import { startDynamicPrecisionReticle } from '../gameplay/dynamicPrecisionReticle.ts';
import { startLocalMuzzleFlashBinding } from '../gameplay/localMuzzleFlashBinding.ts';
import { startPrecisionShotRuntime } from '../gameplay/precisionShotRuntime.ts';
import { startSpawnController } from '../gameplay/spawnController.ts';
import { startKillAmmoReset } from '../gameplay/killAmmoReset.ts';
import { startCombatFeedback } from '../gameplay/combatFeedback.ts';
import { startDeathmatchScore } from '../gameplay/deathmatchScore.ts';
import { startDeathmatchRoundLifecycle } from '../gameplay/deathmatchRoundLifecycle.ts';
import { startRemoteRobotMotion } from '../gameplay/remoteRobotMotion.ts';
import { startMapSpawnMarkers } from '../gameplay/mapSpawnMarkers.ts';
import { startHostRemoteSync } from '../net/hostRemoteSync.ts';
import { startLobbyPresenceSync } from '../net/lobbyPresenceSync.ts';
import { startPvpTimingTuning } from '../net/pvpTuning.ts';
import { startNetworkStabilityFix } from '../net/networkStabilityFix.ts';
import { startAdaptiveSnapshotRate } from '../net/adaptiveSnapshotRate.ts';
import { startCombatEventBridge } from '../net/combatEventBridge.ts';
import { startDeathmatchAuthority } from '../net/deathmatchAuthority.ts';
import { startSessionLifecycleHardening } from '../net/sessionLifecycleHardening.ts';
import { startRemoteShotPresentation } from '../net/remoteShotPresentation.ts';
import { startLiveMapOverlay } from '../gameplay/liveMapOverlay.ts';
import { startMusicSourceGain } from '../audio/musicSourceGain.ts';
import { startPerformancePack } from '../performance/performancePack.ts';
import { startCacheIntegrity } from '../performance/cacheIntegrity.ts';
import { startLocalTelemetry } from '../performance/localTelemetry.ts';
import { startAdaptiveRenderScale } from '../performance/adaptiveRenderScale.ts';
import { startTelemetryDetails } from '../performance/telemetryDetails.ts';
import { startP2PQualityHud } from '../ui/p2pQualityHud.ts';
import { startMobileRuntime } from '../mobile/mobileRuntime.ts';
import { runtimeKernel, type RuntimeModuleDefinition } from './runtimeKernel.ts';

const BOOTSTRAP_DEPENDENCY = ['bootstrap'] as const;

const CLIENT_RUNTIME_MODULES: readonly RuntimeModuleDefinition[] = [
  { name: 'networkStabilityFix', phase: 'foundation', start: startNetworkStabilityFix },
  { name: 'combatEventBridge', phase: 'foundation', start: startCombatEventBridge },
  { name: 'deathmatchAuthority', phase: 'foundation', start: startDeathmatchAuthority },

  { name: 'bootstrap', phase: 'bootstrap', critical: true, start: bootstrap },

  {
    name: 'sessionLifecycleHardening',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startSessionLifecycleHardening,
  },
  {
    name: 'precisionShotRuntime',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startPrecisionShotRuntime,
  },
  {
    name: 'localMuzzleFlashBinding',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startLocalMuzzleFlashBinding,
  },
  {
    name: 'advancedWeaponController',
    phase: 'gameplay',
    critical: true,
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startAdvancedWeaponController,
  },
  {
    name: 'aimMovementTuning',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startAimMovementTuning,
  },
  {
    name: 'dynamicPrecisionReticle',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startDynamicPrecisionReticle,
  },
  {
    name: 'mobileRuntime',
    phase: 'gameplay',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startMobileRuntime,
  },

  {
    name: 'lobbyPresenceSync',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startLobbyPresenceSync,
  },
  {
    name: 'pvpTimingTuning',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startPvpTimingTuning,
  },
  {
    name: 'hostRemoteSync',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startHostRemoteSync,
  },
  {
    name: 'adaptiveSnapshotRate',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startAdaptiveSnapshotRate,
  },
  {
    name: 'p2pQualityHud',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startP2PQualityHud,
  },
  {
    name: 'remoteShotPresentation',
    phase: 'network',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startRemoteShotPresentation,
  },

  {
    name: 'remoteRobotMotion',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startRemoteRobotMotion,
  },
  {
    name: 'killAmmoReset',
    phase: 'presentation',
    dependsOn: ['bootstrap', 'advancedWeaponController'],
    start: startKillAmmoReset,
  },
  {
    name: 'combatFeedback',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startCombatFeedback,
  },
  {
    name: 'deathmatchScore',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startDeathmatchScore,
  },
  {
    name: 'spawnController',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startSpawnController,
  },
  {
    name: 'craterSupplyPickups',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startCraterSupplyPickups,
  },
  {
    name: 'deathmatchRoundLifecycle',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startDeathmatchRoundLifecycle,
  },
  {
    name: 'liveMapOverlay',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startLiveMapOverlay,
  },
  {
    name: 'mapSpawnMarkers',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startMapSpawnMarkers,
  },
  {
    name: 'musicSourceGain',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startMusicSourceGain,
  },
  {
    name: 'performancePack',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startPerformancePack,
  },
  {
    name: 'cacheIntegrity',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startCacheIntegrity,
  },
  {
    name: 'localTelemetry',
    phase: 'presentation',
    dependsOn: BOOTSTRAP_DEPENDENCY,
    start: startLocalTelemetry,
  },
  {
    name: 'adaptiveRenderScale',
    phase: 'presentation',
    dependsOn: ['bootstrap', 'localTelemetry'],
    start: startAdaptiveRenderScale,
  },
  {
    name: 'telemetryDetails',
    phase: 'presentation',
    dependsOn: ['bootstrap', 'localTelemetry'],
    start: startTelemetryDetails,
  },
];

let clientModulesRegistered = false;

export function registerClientRuntimeModules(): void {
  if (clientModulesRegistered) return;
  clientModulesRegistered = true;
  runtimeKernel.registerMany(CLIENT_RUNTIME_MODULES);
}

/**
 * Browser/game composition root. Startup ordering is declarative in the kernel:
 * independent optional systems can fail without aborting siblings, while
 * critical invariants are reflected in the global runtime health snapshot.
 */
export function startClientRuntime(): void {
  registerClientRuntimeModules();
  runtimeKernel.startPhase('foundation');
  runtimeKernel.startPhase('bootstrap');

  const bootstrapReady = runtimeKernel.isReady('bootstrap');
  (window as any).__goneClientRuntimeStarted = bootstrapReady;
  if (!bootstrapReady) return;

  runtimeKernel.startPhases(['gameplay', 'network', 'presentation']);
}

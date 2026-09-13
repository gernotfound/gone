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
import { startClientDiagnostics } from '../observability/clientDiagnostics.ts';
import { startPerformancePack } from '../performance/performancePack.ts';
import { startCacheIntegrity } from '../performance/cacheIntegrity.ts';
import { startLocalTelemetry } from '../performance/localTelemetry.ts';
import { startAdaptiveRenderScale } from '../performance/adaptiveRenderScale.ts';
import { startTelemetryDetails } from '../performance/telemetryDetails.ts';
import { startP2PQualityHud } from '../ui/p2pQualityHud.ts';
import { startMobileRuntime } from '../mobile/mobileRuntime.ts';

type RuntimeStarter = () => void;

function startupError(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown startup error');
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[runtime] ${name} failed during startup`, error);
  window.dispatchEvent(new CustomEvent('gone-runtime-start-error', {
    detail: { name, message, stack },
  }));
}

function safeStart(name: string, starter: RuntimeStarter): void {
  try {
    starter();
  } catch (error) {
    startupError(name, error);
  }
}

function requiredStart(name: string, starter: RuntimeStarter): void {
  try {
    starter();
  } catch (error) {
    startupError(name, error);
    throw error;
  }
}

function installPreBootstrapGuards(): void {
  startClientDiagnostics();
  safeStart('networkStabilityFix', startNetworkStabilityFix);
  safeStart('combatEventBridge', startCombatEventBridge);
  safeStart('deathmatchAuthority', startDeathmatchAuthority);
}

function startCoreGameplayRuntime(): void {
  safeStart('sessionLifecycleHardening', startSessionLifecycleHardening);
  safeStart('precisionShotRuntime', startPrecisionShotRuntime);
  safeStart('localMuzzleFlashBinding', startLocalMuzzleFlashBinding);
  safeStart('advancedWeaponController', startAdvancedWeaponController);
  safeStart('aimMovementTuning', startAimMovementTuning);
  safeStart('dynamicPrecisionReticle', startDynamicPrecisionReticle);
}

function startNetworkRuntime(): void {
  safeStart('lobbyPresenceSync', startLobbyPresenceSync);
  safeStart('pvpTimingTuning', startPvpTimingTuning);
  safeStart('hostRemoteSync', startHostRemoteSync);
  safeStart('adaptiveSnapshotRate', startAdaptiveSnapshotRate);
  safeStart('p2pQualityHud', startP2PQualityHud);
  safeStart('remoteShotPresentation', startRemoteShotPresentation);
}

function startGameplayPresentation(): void {
  safeStart('remoteRobotMotion', startRemoteRobotMotion);
  safeStart('killAmmoReset', startKillAmmoReset);
  safeStart('combatFeedback', startCombatFeedback);
  safeStart('deathmatchScore', startDeathmatchScore);
  safeStart('spawnController', startSpawnController);
  safeStart('craterSupplyPickups', startCraterSupplyPickups);
  safeStart('deathmatchRoundLifecycle', startDeathmatchRoundLifecycle);
  safeStart('liveMapOverlay', startLiveMapOverlay);
  safeStart('mapSpawnMarkers', startMapSpawnMarkers);
}

function startPresentationAndDiagnostics(): void {
  safeStart('musicSourceGain', startMusicSourceGain);
  safeStart('performancePack', startPerformancePack);
  safeStart('cacheIntegrity', startCacheIntegrity);
  safeStart('localTelemetry', startLocalTelemetry);
  safeStart('adaptiveRenderScale', startAdaptiveRenderScale);
  safeStart('telemetryDetails', startTelemetryDetails);
}

/** Browser composition root. Core menu bootstrap is required; optional systems fail independently. */
export function startClientRuntime(): void {
  if ((window as any).__goneClientRuntimeStarted) return;

  installPreBootstrapGuards();
  requiredStart('bootstrap', bootstrap);
  (window as any).__goneClientRuntimeStarted = true;

  startCoreGameplayRuntime();
  safeStart('mobileRuntime', startMobileRuntime);
  startNetworkRuntime();
  startGameplayPresentation();
  startPresentationAndDiagnostics();
}

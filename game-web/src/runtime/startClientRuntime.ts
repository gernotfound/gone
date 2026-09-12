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

function installPreBootstrapGuards(): void {
  startClientDiagnostics();
  startNetworkStabilityFix();
  startCombatEventBridge();
  startDeathmatchAuthority();
}

function startCoreGameplayRuntime(): void {
  startSessionLifecycleHardening();
  startPrecisionShotRuntime();
  startLocalMuzzleFlashBinding();
  startAdvancedWeaponController();
  startAimMovementTuning();
  startDynamicPrecisionReticle();
}

function startNetworkRuntime(): void {
  startLobbyPresenceSync();
  startPvpTimingTuning();
  startHostRemoteSync();
  startAdaptiveSnapshotRate();
  startP2PQualityHud();
  startRemoteShotPresentation();
}

function startGameplayPresentation(): void {
  startRemoteRobotMotion();
  startKillAmmoReset();
  startCombatFeedback();
  startDeathmatchScore();
  startSpawnController();
  startCraterSupplyPickups();
  startDeathmatchRoundLifecycle();
  startLiveMapOverlay();
  startMapSpawnMarkers();
}

function startPresentationAndDiagnostics(): void {
  startMusicSourceGain();
  startPerformancePack();
  startCacheIntegrity();
  startLocalTelemetry();
  startAdaptiveRenderScale();
  startTelemetryDetails();
}

/** Browser composition root. Grouping is explicit; relative startup order stays stable. */
export function startClientRuntime(): void {
  installPreBootstrapGuards();
  bootstrap();
  startCoreGameplayRuntime();
  startMobileRuntime();
  startNetworkRuntime();
  startGameplayPresentation();
  startPresentationAndDiagnostics();
}
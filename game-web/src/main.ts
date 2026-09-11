import './style.css';
import { bootstrap } from './gameplay/engine.ts';
import { startAdvancedWeaponController } from './gameplay/advancedWeaponController.ts';
import { startSpawnController } from './gameplay/spawnController.ts';
import { startKillAmmoReset } from './gameplay/killAmmoReset.ts';
import { startHostRemoteSync } from './net/hostRemoteSync.ts';
import { startLobbyPresenceSync } from './net/lobbyPresenceSync.ts';
import { startPvpTimingTuning } from './net/pvpTuning.ts';
import { startNetworkStabilityFix } from './net/networkStabilityFix.ts';
import { startRemoteShotPresentation } from './net/remoteShotPresentation.ts';
import { startTracerPresentationFix } from './gameplay/tracerPresentationFix.ts';
import { startLiveMapOverlay } from './gameplay/liveMapOverlay.ts';
import { startMusicSourceGain } from './audio/musicSourceGain.ts';
import { startNaturalSunRays } from './world/naturalSunRays.ts';

// Install lightweight runtime patches before any game/session objects are created.
startNetworkStabilityFix();
startTracerPresentationFix();
startNaturalSunRays();

bootstrap();
startAdvancedWeaponController();
startLobbyPresenceSync();
startPvpTimingTuning();
startHostRemoteSync();
startRemoteShotPresentation();
startKillAmmoReset();
startSpawnController();
startLiveMapOverlay();
startMusicSourceGain();

import './style.css';
import { bootstrap } from './gameplay/engine.ts';
import { startAdvancedWeaponController } from './gameplay/advancedWeaponController.ts';
import { startHostRemoteSync } from './net/hostRemoteSync.ts';
import { startHostShotPresentation } from './net/hostShotPresentation.ts';
import { startLobbyPresenceSync } from './net/lobbyPresenceSync.ts';
import { startPvpTimingTuning } from './net/pvpTuning.ts';

bootstrap();
startAdvancedWeaponController();
startLobbyPresenceSync();
startPvpTimingTuning();
startHostRemoteSync();
startHostShotPresentation();
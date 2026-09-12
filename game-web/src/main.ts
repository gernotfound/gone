import './style.css';
import { startSmartphoneControlsGuard } from './mobile/smartphoneControlsGuard.ts';
import { startSmartphoneProfile } from './mobile/smartphoneProfile.ts';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';

startSmartphoneProfile();
startPwaRuntime();
startClientRuntime();
startSmartphoneControlsGuard();

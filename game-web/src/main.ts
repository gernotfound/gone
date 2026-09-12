import './style.css';
import { startSmartphoneProfile } from './mobile/smartphoneProfile.ts';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';

startSmartphoneProfile();
startPwaRuntime();
startClientRuntime();

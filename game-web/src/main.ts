import './style.css';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';

startPwaRuntime();
startClientRuntime();

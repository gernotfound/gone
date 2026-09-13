import './style.css';
import { startInputModeSettings } from './mobile/inputMode.ts';
import { startMobileSessionResume } from './mobile/mobileSessionResume.ts';
import { startPubgTouchControls } from './mobile/pubgTouchControls.ts';
import { startCompetitiveTouchControls } from './mobile/competitiveTouchControls.ts';
import {
  reconcileSmartphoneControlsGuard,
  startSmartphoneControlsGuard,
} from './mobile/smartphoneControlsGuard.ts';
import { startSmartphoneProfile } from './mobile/smartphoneProfile.ts';
import { startTouchLayoutEditor } from './mobile/touchLayoutEditor.ts';
import { startTouchPreferences } from './mobile/touchPreferences.ts';
import { startClientDiagnostics } from './observability/clientDiagnostics.ts';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startBrowserLifecycle } from './runtime/browserLifecycle.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';
import { runtimeKernel, type RuntimeModuleDefinition } from './runtime/runtimeKernel.ts';

const SHELL_MODULES: readonly RuntimeModuleDefinition[] = [
  { name: 'clientDiagnostics', phase: 'foundation', start: startClientDiagnostics },
  { name: 'browserLifecycle', phase: 'foundation', critical: true, start: startBrowserLifecycle },
  { name: 'smartphoneProfile', phase: 'foundation', start: startSmartphoneProfile },
  {
    name: 'inputModeSettings',
    phase: 'foundation',
    dependsOn: ['smartphoneProfile'],
    start: startInputModeSettings,
  },
  {
    name: 'touchPreferences',
    phase: 'foundation',
    dependsOn: ['inputModeSettings'],
    start: startTouchPreferences,
  },
  { name: 'pwaRuntime', phase: 'foundation', start: startPwaRuntime },
];

const DEVICE_MODULES: readonly RuntimeModuleDefinition[] = [
  {
    name: 'smartphoneControlsGuard',
    phase: 'device',
    dependsOn: ['bootstrap'],
    start: startSmartphoneControlsGuard,
    reconcile: reconcileSmartphoneControlsGuard,
  },
  {
    name: 'pubgTouchControls',
    phase: 'device',
    dependsOn: ['smartphoneControlsGuard'],
    start: startPubgTouchControls,
    reconcile: () => (window as any).gonePubgTouchControls?.rebind?.(),
  },
  {
    name: 'competitiveTouchControls',
    phase: 'device',
    dependsOn: ['pubgTouchControls'],
    start: startCompetitiveTouchControls,
  },
  {
    name: 'touchLayoutEditor',
    phase: 'device',
    dependsOn: ['smartphoneControlsGuard'],
    start: startTouchLayoutEditor,
  },
  {
    name: 'mobileSessionResume',
    phase: 'device',
    dependsOn: ['bootstrap'],
    start: startMobileSessionResume,
  },
];

// The shell remains usable even if the 3D/game runtime cannot start. The kernel
// records failures and dependency blocks instead of relying on nested try/catch
// wrappers or resetting module-global startup flags.
runtimeKernel.registerMany(SHELL_MODULES);
runtimeKernel.startPhase('foundation');

startClientRuntime();

runtimeKernel.registerMany(DEVICE_MODULES);
runtimeKernel.startPhase('device');

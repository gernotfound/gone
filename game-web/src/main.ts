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
import { startRuntimeAvailabilityUi } from './ui/runtimeAvailabilityUi.ts';

const SHELL_MODULES: readonly RuntimeModuleDefinition[] = [
  { name: 'clientDiagnostics', phase: 'foundation', start: startClientDiagnostics },
  { name: 'runtimeAvailabilityUi', phase: 'foundation', start: startRuntimeAvailabilityUi },
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

const COMBAT_SAFE_CORE = ['bootstrap', 'advancedWeaponController'] as const;

const DEVICE_MODULES: readonly RuntimeModuleDefinition[] = [
  {
    name: 'smartphoneControlsGuard',
    phase: 'device',
    dependsOn: COMBAT_SAFE_CORE,
    start: startSmartphoneControlsGuard,
    reconcile: reconcileSmartphoneControlsGuard,
  },
  {
    name: 'pubgTouchControls',
    phase: 'device',
    dependsOn: ['smartphoneControlsGuard', 'advancedWeaponController'],
    start: startPubgTouchControls,
    reconcile: () => (window as any).gonePubgTouchControls?.rebind?.(),
  },
  {
    name: 'competitiveTouchControls',
    phase: 'device',
    dependsOn: ['pubgTouchControls', 'advancedWeaponController'],
    start: startCompetitiveTouchControls,
  },
  {
    name: 'touchLayoutEditor',
    phase: 'device',
    dependsOn: COMBAT_SAFE_CORE,
    start: startTouchLayoutEditor,
  },
  {
    name: 'mobileSessionResume',
    phase: 'device',
    dependsOn: COMBAT_SAFE_CORE,
    start: startMobileSessionResume,
  },
];

// The shell remains usable even if the 3D/game runtime cannot start. The kernel
// records failures and dependency blocks instead of relying on nested try/catch
// wrappers or resetting module-global startup flags.
runtimeKernel.registerMany(SHELL_MODULES);
runtimeKernel.startPhase('foundation');

const foundationHealth = runtimeKernel.snapshot();
if (foundationHealth.status === 'failed') {
  window.dispatchEvent(new CustomEvent('gone-runtime-unavailable', { detail: foundationHealth }));
} else {
  startClientRuntime();
}

runtimeKernel.registerMany(DEVICE_MODULES);
if (runtimeKernel.isReady('advancedWeaponController')) {
  runtimeKernel.startPhase('device');
}

// Input mode is an application-level configuration transition. Reconciliation
// is delegated to modules that explicitly declare it; no module is restarted and
// no private "started" flag is reset.
window.addEventListener('gone-input-mode-changed', () => {
  if (runtimeKernel.isReady('advancedWeaponController')) runtimeKernel.reconcilePhase('device');
});

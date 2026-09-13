import './style.css';
import { startInputModeSettings } from './mobile/inputMode.ts';
import { startMobileSessionResume } from './mobile/mobileSessionResume.ts';
import { startPubgTouchControls } from './mobile/pubgTouchControls.ts';
import { startCompetitiveTouchControls } from './mobile/competitiveTouchControls.ts';
import { startSmartphoneControlsGuard } from './mobile/smartphoneControlsGuard.ts';
import { startSmartphoneProfile } from './mobile/smartphoneProfile.ts';
import { startTouchLayoutEditor } from './mobile/touchLayoutEditor.ts';
import { startTouchPreferences } from './mobile/touchPreferences.ts';
import { startClientDiagnostics } from './observability/clientDiagnostics.ts';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';

type Starter = () => void;

function reportStartupFailure(name: string, error: unknown): void {
  const message = error instanceof Error ? error.message : String(error ?? 'unknown startup error');
  const stack = error instanceof Error ? error.stack : undefined;
  console.error(`[main] ${name} failed during startup`, error);
  window.dispatchEvent(new CustomEvent('gone-runtime-start-error', {
    detail: { name, message, stack },
  }));
}

function safeStart(name: string, starter: Starter): void {
  try {
    starter();
  } catch (error) {
    reportStartupFailure(name, error);
  }
}

// Diagnostics must exist before any optional feature starts so synchronous boot
// failures are captured instead of terminating the remaining composition root.
startClientDiagnostics();
safeStart('smartphoneProfile', startSmartphoneProfile);
safeStart('inputModeSettings', startInputModeSettings);
safeStart('touchPreferences', startTouchPreferences);
safeStart('pwaRuntime', startPwaRuntime);

// The core runtime already classifies required bootstrap failures internally.
// Catch here only to keep recovery/install/mobile surfaces alive if core startup
// fails on an unsupported or temporarily broken browser environment.
try {
  startClientRuntime();
} catch (error) {
  console.error('[main] client runtime failed', error);
}

safeStart('smartphoneControlsGuard', startSmartphoneControlsGuard);
safeStart('pubgTouchControls', startPubgTouchControls);
safeStart('competitiveTouchControls', startCompetitiveTouchControls);
safeStart('touchLayoutEditor', startTouchLayoutEditor);
safeStart('mobileSessionResume', startMobileSessionResume);

// Reconcile the touch guard whenever the explicit control mode changes. Re-arming
// is safe because an existing primary/fallback API is reused; it also lets a
// user force on-screen controls when device heuristics originally returned false.
window.addEventListener('gone-input-mode-changed', () => {
  (window as any).__goneSmartphoneControlsGuardStarted = false;
  safeStart('smartphoneControlsGuard', startSmartphoneControlsGuard);
  safeStart('pubgTouchControls', startPubgTouchControls);
  safeStart('competitiveTouchControls', startCompetitiveTouchControls);
  safeStart('touchLayoutEditor', startTouchLayoutEditor);
});

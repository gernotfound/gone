import './style.css';
import { startInputModeSettings } from './mobile/inputMode.ts';
import { startMobileSessionResume } from './mobile/mobileSessionResume.ts';
import { startSmartphoneControlsGuard } from './mobile/smartphoneControlsGuard.ts';
import { startSmartphoneProfile } from './mobile/smartphoneProfile.ts';
import { startTouchPreferences } from './mobile/touchPreferences.ts';
import { startPwaRuntime } from './pwa/pwaRuntime.ts';
import { startClientRuntime } from './runtime/startClientRuntime.ts';

startSmartphoneProfile();
startInputModeSettings();
startTouchPreferences();
startPwaRuntime();
startClientRuntime();
startSmartphoneControlsGuard();
startMobileSessionResume();

// Reconcile the touch guard whenever the explicit control mode changes. Re-arming
// is safe because an existing primary/fallback API is reused; it also lets a
// user force on-screen controls when device heuristics originally returned false.
window.addEventListener('gone-input-mode-changed', () => {
  (window as any).__goneSmartphoneControlsGuardStarted = false;
  startSmartphoneControlsGuard();
});

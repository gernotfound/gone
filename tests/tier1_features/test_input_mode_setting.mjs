import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const inputModePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'inputMode.ts');
  const profilePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneProfile.ts');
  const guardPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneControlsGuard.ts');
  const mainPath = path.join(PROJECT_ROOT, 'game-web', 'src', 'main.ts');

  suite.test('Settings expose persistent keyboard and on-screen control modes', () => {
    const source = fs.readFileSync(inputModePath, 'utf-8');
    assert(source.includes("type InputMode = 'keyboard' | 'screen'"), 'input mode must have explicit keyboard and screen states');
    assert(source.includes("const STORAGE_KEY = 'gone-input-mode'"), 'input mode must persist under a stable key');
    assert(source.includes('localStorage.setItem(STORAGE_KEY, mode)'), 'input mode selection must be persisted');
    assert(source.includes('input-mode-keyboard') && source.includes('input-mode-screen'), 'settings must expose both input choices');
    assert(source.includes('Mouse + tastiera') && source.includes('Comandi a schermo'), 'settings labels must be user-facing and explicit');
  });

  suite.test('Smartphones default to on-screen controls and desktops to keyboard', () => {
    const source = fs.readFileSync(inputModePath, 'utf-8');
    assert(source.includes("isSmartphoneDevice() ? 'screen' : 'keyboard'"), 'default mode must follow the detected device class');
  });

  suite.test('Keyboard mode forcibly hides the mobile overlay', () => {
    const source = fs.readFileSync(inputModePath, 'utf-8');
    assert(source.includes('html.gone-input-keyboard #gone-mobile-controls'), 'keyboard mode must target the touch overlay');
    assert(source.includes('display: none !important') && source.includes('pointer-events: none !important'), 'keyboard mode must hide and disable touch controls');
  });

  suite.test('On-screen selection overrides failed smartphone heuristics', () => {
    const profile = fs.readFileSync(profilePath, 'utf-8');
    assert(profile.includes("localStorage.getItem('gone-input-mode') === 'screen'"), 'smartphone profile must honor the explicit on-screen override');
    assert(profile.includes('if (forcedOnScreenControls()) return true;'), 'explicit screen mode must win before UA/touch heuristics');
  });

  suite.test('Input mode changes reconcile touch ownership once without restarting modules', () => {
    const main = fs.readFileSync(mainPath, 'utf-8');
    const guard = fs.readFileSync(guardPath, 'utf-8');
    assert(main.includes("name: 'inputModeSettings'") && main.includes('start: startInputModeSettings'), 'input mode settings must be a declared shell module');
    assert(main.includes("name: 'smartphoneControlsGuard'") && main.includes('reconcile: reconcileSmartphoneControlsGuard'), 'touch guard must declare an explicit reconciliation operation');
    assert(main.includes("window.addEventListener('gone-input-mode-changed'"), 'composition must own the application-level mode change');
    assert(main.includes("runtimeKernel.reconcilePhase('device')"), 'mode changes must reconcile device modules through the kernel');
    assert(!guard.includes("window.addEventListener('gone-input-mode-changed'"), 'guard must not duplicate the composition listener');
    assert(!main.includes('__goneSmartphoneControlsGuardStarted = false'), 'composition must never reset startup flags to force a reinitialization');
  });
}

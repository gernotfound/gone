import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  const inputModePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'inputMode.ts');
  const profilePath = path.join(PROJECT_ROOT, 'game-web', 'src', 'mobile', 'smartphoneProfile.ts');
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

  suite.test('Input mode changes re-arm the touch controls guard without a reload', () => {
    const main = fs.readFileSync(mainPath, 'utf-8');
    assert(main.includes("safeStart('inputModeSettings', startInputModeSettings);"), 'input mode settings must start with the client');
    assert(main.includes("window.addEventListener('gone-input-mode-changed'"), 'runtime must react immediately to input mode changes');
    assert(main.includes('__goneSmartphoneControlsGuardStarted = false') && main.includes("safeStart('smartphoneControlsGuard', startSmartphoneControlsGuard);"), 'mode changes must re-arm the touch guard');
  });
}

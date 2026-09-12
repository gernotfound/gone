import { isSmartphoneDevice } from './smartphoneProfile.ts';

export type InputMode = 'keyboard' | 'screen';

const STORAGE_KEY = 'gone-input-mode';
let currentMode: InputMode = readStoredMode() ?? (isSmartphoneDevice() ? 'screen' : 'keyboard');

function readStoredMode(): InputMode | null {
  try {
    const value = window.localStorage.getItem(STORAGE_KEY);
    return value === 'keyboard' || value === 'screen' ? value : null;
  } catch {
    return null;
  }
}

function persistMode(mode: InputMode): void {
  try { window.localStorage.setItem(STORAGE_KEY, mode); } catch { /* storage may be blocked */ }
}

function ensureVisibilityStyle(): void {
  if (document.getElementById('gone-input-mode-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-input-mode-style';
  style.textContent = `
    html.gone-input-keyboard #gone-mobile-controls {
      display: none !important;
      pointer-events: none !important;
    }
  `;
  document.head.appendChild(style);
}

function buttonClasses(active: boolean): string {
  const base = 'min-h-12 rounded-xl border px-3 py-3 text-sm font-black uppercase tracking-wide transition-all active:scale-95';
  return active
    ? `${base} border-emerald-400 bg-emerald-500/20 text-emerald-100 shadow-[0_0_14px_rgba(16,185,129,0.2)]`
    : `${base} border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500 hover:bg-slate-800`;
}

function syncSettingsUi(): void {
  const keyboard = document.getElementById('input-mode-keyboard') as HTMLButtonElement | null;
  const screen = document.getElementById('input-mode-screen') as HTMLButtonElement | null;
  const status = document.getElementById('input-mode-status');
  if (!keyboard || !screen || !status) return;

  const keyboardActive = currentMode === 'keyboard';
  keyboard.className = buttonClasses(keyboardActive);
  screen.className = buttonClasses(!keyboardActive);
  keyboard.setAttribute('aria-pressed', String(keyboardActive));
  screen.setAttribute('aria-pressed', String(!keyboardActive));
  status.textContent = keyboardActive ? 'MOUSE + TASTIERA' : 'COMANDI A SCHERMO';
  status.className = keyboardActive ? 'text-sky-400' : 'text-emerald-400';
}

function ensureSettingsControl(): void {
  if (document.getElementById('input-mode-setting')) {
    syncSettingsUi();
    return;
  }

  const settings = document.getElementById('settings-menu');
  const stack = settings?.querySelector(':scope > .w-full.flex.flex-col');
  if (!settings || !stack) return;

  const section = document.createElement('div');
  section.id = 'input-mode-setting';
  section.className = 'flex flex-col gap-2 rounded-2xl border border-slate-700/70 bg-slate-950/45 p-3';
  section.innerHTML = `
    <div class="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-400">
      <span>Metodo di controllo</span>
      <span id="input-mode-status" class="text-emerald-400">COMANDI A SCHERMO</span>
    </div>
    <div class="grid grid-cols-2 gap-2" role="group" aria-label="Metodo di controllo">
      <button type="button" id="input-mode-keyboard" aria-pressed="false">Mouse + tastiera</button>
      <button type="button" id="input-mode-screen" aria-pressed="true">Comandi a schermo</button>
    </div>
    <p class="text-[11px] leading-4 text-slate-500">La scelta viene salvata e ha priorità sul rilevamento automatico del dispositivo.</p>
  `;
  stack.prepend(section);

  (document.getElementById('input-mode-keyboard') as HTMLButtonElement).addEventListener('click', () => setInputMode('keyboard'));
  (document.getElementById('input-mode-screen') as HTMLButtonElement).addEventListener('click', () => setInputMode('screen'));
  syncSettingsUi();
}

function applyMode(): void {
  ensureVisibilityStyle();
  const html = document.documentElement;
  html.classList.toggle('gone-input-keyboard', currentMode === 'keyboard');
  html.classList.toggle('gone-input-screen', currentMode === 'screen');
  html.dataset.goneInputMode = currentMode;
  syncSettingsUi();
  (window as any).goneInputMode = {
    mode: currentMode,
    setMode: setInputMode,
    useOnScreenControls,
    storageKey: STORAGE_KEY,
  };
}

export function getInputMode(): InputMode {
  return currentMode;
}

export function useOnScreenControls(): boolean {
  return currentMode === 'screen';
}

export function setInputMode(mode: InputMode): void {
  if (mode !== 'keyboard' && mode !== 'screen') return;
  const changed = currentMode !== mode;
  currentMode = mode;
  persistMode(mode);
  applyMode();
  if (changed) {
    window.dispatchEvent(new CustomEvent('gone-input-mode-changed', { detail: { mode } }));
  }
}

export function startInputModeSettings(): void {
  ensureVisibilityStyle();
  applyMode();
  ensureSettingsControl();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSettingsControl, { once: true });
  }
}

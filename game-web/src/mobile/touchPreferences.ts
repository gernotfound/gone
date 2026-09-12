export type TouchHandedness = 'right' | 'left';

export type TouchPreferences = {
  lookSensitivity: number;
  adsSensitivity: number;
  buttonScale: number;
  buttonOpacity: number;
  handedness: TouchHandedness;
};

const STORAGE_KEY = 'gone-touch-preferences-v1';
const DEFAULTS: TouchPreferences = {
  lookSensitivity: 1,
  adsSensitivity: 1,
  buttonScale: 1,
  buttonOpacity: 1,
  handedness: 'right',
};

let current: TouchPreferences = readStoredPreferences();

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function sanitize(raw: Partial<TouchPreferences> | null | undefined): TouchPreferences {
  return {
    lookSensitivity: clamp(Number(raw?.lookSensitivity ?? DEFAULTS.lookSensitivity) || DEFAULTS.lookSensitivity, 0.5, 2),
    adsSensitivity: clamp(Number(raw?.adsSensitivity ?? DEFAULTS.adsSensitivity) || DEFAULTS.adsSensitivity, 0.5, 1.5),
    buttonScale: clamp(Number(raw?.buttonScale ?? DEFAULTS.buttonScale) || DEFAULTS.buttonScale, 1, 1.35),
    buttonOpacity: clamp(Number(raw?.buttonOpacity ?? DEFAULTS.buttonOpacity) || DEFAULTS.buttonOpacity, 0.55, 1),
    handedness: raw?.handedness === 'left' ? 'left' : 'right',
  };
}

function readStoredPreferences(): TouchPreferences {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? sanitize(JSON.parse(raw)) : { ...DEFAULTS };
  } catch {
    return { ...DEFAULTS };
  }
}

function persist(): void {
  try { window.localStorage.setItem(STORAGE_KEY, JSON.stringify(current)); } catch { /* optional storage */ }
}

function percent(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function handednessClasses(active: boolean): string {
  const base = 'min-h-12 rounded-xl border px-3 py-2 text-xs font-black uppercase tracking-wide transition-all active:scale-95';
  return active
    ? `${base} border-emerald-400 bg-emerald-500/20 text-emerald-100`
    : `${base} border-slate-700 bg-slate-950/70 text-slate-300 hover:border-slate-500`;
}

function syncUi(): void {
  const mappings: Array<[string, keyof TouchPreferences, string]> = [
    ['touch-look-sensitivity', 'lookSensitivity', 'touch-look-value'],
    ['touch-ads-sensitivity', 'adsSensitivity', 'touch-ads-value'],
    ['touch-button-scale', 'buttonScale', 'touch-scale-value'],
    ['touch-button-opacity', 'buttonOpacity', 'touch-opacity-value'],
  ];
  for (const [inputId, key, valueId] of mappings) {
    const input = document.getElementById(inputId) as HTMLInputElement | null;
    const value = document.getElementById(valueId);
    if (input) input.value = String(current[key]);
    if (value) value.textContent = percent(Number(current[key]));
  }

  const right = document.getElementById('touch-handedness-right') as HTMLButtonElement | null;
  const left = document.getElementById('touch-handedness-left') as HTMLButtonElement | null;
  if (right && left) {
    const rightActive = current.handedness === 'right';
    right.className = handednessClasses(rightActive);
    left.className = handednessClasses(!rightActive);
    right.setAttribute('aria-pressed', String(rightActive));
    left.setAttribute('aria-pressed', String(!rightActive));
  }
}

function applyPreferences(): void {
  const html = document.documentElement;
  html.style.setProperty('--gone-touch-scale', String(current.buttonScale));
  html.style.setProperty('--gone-touch-opacity', String(current.buttonOpacity));
  html.classList.toggle('gone-touch-left-handed', current.handedness === 'left');
  html.dataset.goneTouchHandedness = current.handedness;
  syncUi();

  (window as any).goneTouchPreferences = {
    snapshot: getTouchPreferences,
    set: setTouchPreferences,
    reset: resetTouchPreferences,
    storageKey: STORAGE_KEY,
  };
}

function setOne<K extends keyof TouchPreferences>(key: K, value: TouchPreferences[K]): void {
  setTouchPreferences({ [key]: value } as Pick<TouchPreferences, K>);
}

function rangeRow(label: string, inputId: string, valueId: string, min: number, max: number, step: number): string {
  return `
    <label class="grid grid-cols-[1fr_auto] items-center gap-x-3 gap-y-1 text-xs font-bold text-slate-300" for="${inputId}">
      <span>${label}</span><span id="${valueId}" class="text-cyan-300">100%</span>
      <input id="${inputId}" class="col-span-2 h-10 w-full accent-cyan-400" type="range" min="${min}" max="${max}" step="${step}" />
    </label>`;
}

function ensureSettingsUi(): void {
  if (document.getElementById('touch-control-settings')) {
    syncUi();
    return;
  }

  const settings = document.getElementById('settings-menu');
  const stack = settings?.querySelector(':scope > .w-full.flex.flex-col');
  if (!settings || !stack) return;

  const section = document.createElement('div');
  section.id = 'touch-control-settings';
  section.className = 'flex flex-col gap-3 rounded-2xl border border-cyan-900/70 bg-slate-950/45 p-3';
  section.innerHTML = `
    <div class="flex items-center justify-between gap-3 text-xs font-black uppercase tracking-wider text-slate-400">
      <span>Comandi a schermo</span><span class="text-cyan-300">PERSONALIZZA</span>
    </div>
    ${rangeRow('Sensibilità visuale', 'touch-look-sensitivity', 'touch-look-value', 0.5, 2, 0.05)}
    ${rangeRow('Sensibilità ADS', 'touch-ads-sensitivity', 'touch-ads-value', 0.5, 1.5, 0.05)}
    ${rangeRow('Dimensione pulsanti', 'touch-button-scale', 'touch-scale-value', 1, 1.35, 0.05)}
    ${rangeRow('Opacità controlli', 'touch-button-opacity', 'touch-opacity-value', 0.55, 1, 0.05)}
    <div class="grid grid-cols-2 gap-2" role="group" aria-label="Mano dominante">
      <button type="button" id="touch-handedness-right">Destrimano</button>
      <button type="button" id="touch-handedness-left">Mancino</button>
    </div>
    <button type="button" id="touch-controls-reset" class="min-h-12 rounded-xl border border-slate-700 bg-slate-900/70 px-3 py-2 text-xs font-black uppercase tracking-wide text-slate-300">Ripristina controlli</button>
  `;

  const inputMode = document.getElementById('input-mode-setting');
  if (inputMode?.parentElement === stack) inputMode.insertAdjacentElement('afterend', section);
  else stack.prepend(section);

  const bindRange = (id: string, key: 'lookSensitivity' | 'adsSensitivity' | 'buttonScale' | 'buttonOpacity') => {
    const input = document.getElementById(id) as HTMLInputElement;
    input.addEventListener('input', () => setOne(key, Number(input.value)));
  };
  bindRange('touch-look-sensitivity', 'lookSensitivity');
  bindRange('touch-ads-sensitivity', 'adsSensitivity');
  bindRange('touch-button-scale', 'buttonScale');
  bindRange('touch-button-opacity', 'buttonOpacity');
  (document.getElementById('touch-handedness-right') as HTMLButtonElement).addEventListener('click', () => setOne('handedness', 'right'));
  (document.getElementById('touch-handedness-left') as HTMLButtonElement).addEventListener('click', () => setOne('handedness', 'left'));
  (document.getElementById('touch-controls-reset') as HTMLButtonElement).addEventListener('click', resetTouchPreferences);
  syncUi();
}

function ensureStyle(): void {
  if (document.getElementById('gone-touch-preferences-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-touch-preferences-style';
  style.textContent = `
    html.gone-input-keyboard #touch-control-settings { display: none !important; }
    #settings-menu { overflow-y: auto; }
  `;
  document.head.appendChild(style);
}

export function getTouchPreferences(): TouchPreferences {
  return { ...current };
}

export function setTouchPreferences(next: Partial<TouchPreferences>): void {
  const previous = JSON.stringify(current);
  current = sanitize({ ...current, ...next });
  persist();
  applyPreferences();
  if (JSON.stringify(current) !== previous) {
    window.dispatchEvent(new CustomEvent('gone-touch-preferences-changed', { detail: getTouchPreferences() }));
  }
}

export function resetTouchPreferences(): void {
  current = { ...DEFAULTS };
  persist();
  applyPreferences();
  window.dispatchEvent(new CustomEvent('gone-touch-preferences-changed', { detail: getTouchPreferences() }));
}

export function startTouchPreferences(): void {
  if ((window as any).__goneTouchPreferencesStarted) return;
  (window as any).__goneTouchPreferencesStarted = true;
  ensureStyle();
  applyPreferences();
  ensureSettingsUi();
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureSettingsUi, { once: true });
  }
}

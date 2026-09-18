import './controlsLegend.css';

const CONTROL_ROWS: readonly [string, string][] = [
  ['W A S D / Frecce', 'Muoviti'],
  ['Mouse', 'Ruota la visuale'],
  ['Click sinistro', 'Spara / attacca'],
  ['Click destro', 'Mira (ADS)'],
  ['R', 'Ricarica arma'],
  ['E', 'Raccogli l’item vicino'],
  ['Shift', 'Corri'],
  ['Spazio', 'Salta'],
  ['C / Ctrl', 'Accovacciati'],
  ['1 · 2 · 3 · 4 · 5', 'Seleziona arma'],
  ['M', 'Apri / chiudi mappa'],
  ['Esc', 'Pausa / torna al menu'],
] as const;

const TOUCH_GUIDANCE: readonly [string, string][] = [
  ['MOVE', 'Joystick sinistro · spingi verso il bordo con intenzione in avanti per lo smart sprint.'],
  ['AIM / FIRE', 'Swipe destro per la visuale · FIRE può trascinare la mira · ADS per mirare.'],
  ['AZIONI', 'TAKE · R · JUMP · C · RUN · MAP e cambio arma restano separati e combinabili.'],
] as const;

let started = false;

function createTouchGuidance(): HTMLElement {
  const touch = document.createElement('aside');
  touch.id = 'controls-legend-touch';
  touch.className = 'w-full rounded-xl border border-purple-500/30 bg-purple-950/20 px-3 py-3 text-xs leading-relaxed text-purple-100 mb-6';
  touch.setAttribute('aria-label', 'Comandi touch smartphone');

  const heading = document.createElement('div');
  heading.className = 'gone-controls-touch-title font-black tracking-[0.16em] text-purple-200 uppercase mb-2';
  heading.textContent = 'TOUCH FPS';
  touch.appendChild(heading);

  for (const [label, copy] of TOUCH_GUIDANCE) {
    const row = document.createElement('div');
    row.className = 'gone-controls-touch-row';

    const key = document.createElement('strong');
    key.className = 'gone-controls-touch-key';
    key.textContent = label;

    const text = document.createElement('span');
    text.className = 'gone-controls-touch-copy';
    text.textContent = copy;

    row.append(key, text);
    touch.appendChild(row);
  }

  return touch;
}

function createLegendPanel(): HTMLDivElement {
  const panel = document.createElement('div');
  panel.id = 'controls-menu';
  panel.className = 'hidden flex-col items-center bg-slate-900/90 p-8 rounded-[2rem] border border-cyan-500/30 shadow-[0_0_30px_rgba(34,211,238,0.15)] backdrop-blur-md absolute z-[100] w-full max-w-md max-h-[90vh] overflow-y-auto transition-all duration-300';
  panel.setAttribute('role', 'dialog');
  panel.setAttribute('aria-modal', 'true');
  panel.setAttribute('aria-labelledby', 'controls-menu-title');
  panel.setAttribute('aria-describedby', 'controls-menu-intro');

  const title = document.createElement('h2');
  title.id = 'controls-menu-title';
  title.className = 'text-3xl font-black mb-5 text-transparent bg-clip-text bg-gradient-to-r from-cyan-300 to-blue-500 uppercase';
  title.textContent = 'COMANDI';

  const intro = document.createElement('p');
  intro.id = 'controls-menu-intro';
  intro.className = 'w-full text-sm text-slate-300 mb-5 leading-relaxed';
  intro.textContent = 'Legenda completa per mouse e tastiera. Su smartphone gli stessi comandi sono disponibili tramite HUD touch.';

  const body = document.createElement('div');
  body.id = 'controls-legend-body';
  body.className = 'w-full flex flex-col';

  const list = document.createElement('div');
  list.id = 'controls-legend-grid';
  list.className = 'w-full flex flex-col gap-2 mb-6';
  for (const [key, action] of CONTROL_ROWS) {
    const row = document.createElement('div');
    row.className = 'gone-controls-row grid grid-cols-[minmax(112px,0.85fr)_1.4fr] gap-3 items-center rounded-xl border border-slate-700/60 bg-slate-950/55 px-3 py-2.5';

    const keyElement = document.createElement('kbd');
    keyElement.className = 'gone-controls-key text-cyan-300 font-black font-mono text-xs tracking-wide';
    keyElement.textContent = key;

    const actionElement = document.createElement('span');
    actionElement.className = 'gone-controls-action text-slate-200 text-sm';
    actionElement.textContent = action;
    row.append(keyElement, actionElement);
    list.appendChild(row);
  }

  body.append(list, createTouchGuidance());

  const back = document.createElement('button');
  back.id = 'btn-back-controls';
  back.type = 'button';
  back.className = 'w-full min-h-12 bg-slate-800 border border-slate-600/50 hover:bg-slate-700 text-white font-bold text-lg py-3 rounded-xl transition-all active:scale-95 shadow-md uppercase tracking-wider';
  back.textContent = 'INDIETRO';

  panel.append(title, intro, body, back);
  return panel;
}

function setOpen(open: boolean): void {
  const mainMenu = document.getElementById('main-menu');
  const panel = document.getElementById('controls-menu');
  if (!mainMenu || !panel) return;
  mainMenu.classList.toggle('hidden', open);
  panel.classList.toggle('hidden', !open);
  panel.classList.toggle('flex', open);
}

export function startControlsLegend(): void {
  if (started) return;
  started = true;

  const app = document.getElementById('app');
  const musicButton = document.getElementById('btn-music-toggle');
  if (!app || !musicButton) return;

  let button = document.getElementById('btn-controls') as HTMLButtonElement | null;
  if (!button) {
    button = document.createElement('button');
    button.id = 'btn-controls';
    button.type = 'button';
    button.className = 'w-full bg-slate-800 border border-slate-600/50 hover:bg-slate-700 hover:border-cyan-500/60 text-slate-200 font-bold text-lg py-3 rounded-xl transition-all active:scale-95 shadow-md';
    button.textContent = 'COMANDI';
    musicButton.parentElement?.insertBefore(button, musicButton);
  }

  let panel = document.getElementById('controls-menu') as HTMLDivElement | null;
  if (!panel) {
    panel = createLegendPanel();
    app.appendChild(panel);
  }

  button.addEventListener('click', () => setOpen(true));
  document.getElementById('btn-back-controls')?.addEventListener('click', () => setOpen(false));

  (window as any).goneControlsLegend = {
    open: () => setOpen(true),
    close: () => setOpen(false),
    rows: CONTROL_ROWS.map(([key, action]) => ({ key, action })),
  };
}

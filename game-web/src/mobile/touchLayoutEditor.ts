type Offset = { x: number; y: number };
type LayoutState = Record<string, Offset>;

const STORAGE_KEY = 'gone-touch-layout-v1';
const EDITABLE_IDS = [
  'mobile-stick',
  'mc-fire',
  'mc-fire-left',
  'mc-aim',
  'mc-jump',
  'mc-reload',
  'mc-crouch',
  'mc-sprint',
  'mc-map',
  'mc-weapon-switcher',
] as const;

let offsets: LayoutState = readStored();
let editing = false;
let activePointer: number | null = null;
let activeElement: HTMLElement | null = null;
let pointerStartX = 0;
let pointerStartY = 0;
let offsetStartX = 0;
let offsetStartY = 0;

function readStored(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : {};
    if (!parsed || typeof parsed !== 'object') return {};
    const safe: LayoutState = {};
    for (const id of EDITABLE_IDS) {
      const item = parsed[id];
      if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y))) continue;
      safe[id] = {
        x: Math.max(-500, Math.min(500, Number(item.x))),
        y: Math.max(-300, Math.min(300, Number(item.y))),
      };
    }
    return safe;
  } catch {
    return {};
  }
}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets)); } catch { /* optional storage */ }
}

function applyOffset(id: string): void {
  const element = document.getElementById(id) as HTMLElement | null;
  if (!element) return;
  const offset = offsets[id] ?? { x: 0, y: 0 };
  element.style.translate = `${offset.x}px ${offset.y}px`;
}

function applyAll(): void {
  for (const id of EDITABLE_IDS) applyOffset(id);
}

function ensureStyle(): void {
  if (document.getElementById('gone-touch-layout-editor-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-touch-layout-editor-style';
  style.textContent = `
    html.gone-touch-layout-edit #gone-mobile-controls,
    html.gone-touch-layout-edit #gone-mobile-controls.hidden {
      display: block !important;
      z-index: 1300 !important;
    }
    html.gone-touch-layout-edit #gone-mobile-controls #mobile-look-pad { pointer-events: none !important; }
    html.gone-touch-layout-edit #gone-mobile-controls button,
    html.gone-touch-layout-edit #gone-mobile-controls #mobile-stick,
    html.gone-touch-layout-edit #gone-mobile-controls #mc-weapon-switcher {
      pointer-events: auto !important;
      outline: 1px dashed rgba(103,232,249,.65);
      outline-offset: 3px;
    }
    #gone-touch-layout-toolbar {
      position: fixed; left: 50%; top: max(8px, calc(env(safe-area-inset-top) + 6px));
      z-index: 1500; transform: translateX(-50%); display: none; align-items: center; gap: 8px;
      padding: 8px 10px; border: 1px solid rgba(103,232,249,.55); border-radius: 14px;
      background: rgba(2,6,23,.94); color: #cffafe; font: 800 11px/1.2 ui-sans-serif,system-ui,sans-serif;
      box-shadow: 0 8px 30px rgba(0,0,0,.35);
    }
    html.gone-touch-layout-edit #gone-touch-layout-toolbar { display: flex; }
    #gone-touch-layout-toolbar button { min-height: 42px; padding: 0 12px; border-radius: 10px; border: 1px solid rgba(148,163,184,.45); background: rgba(15,23,42,.95); color: #f8fafc; font-weight: 900; }
  `;
  document.head.appendChild(style);
}

function ensureToolbar(): HTMLElement {
  let toolbar = document.getElementById('gone-touch-layout-toolbar');
  if (toolbar) return toolbar;
  toolbar = document.createElement('div');
  toolbar.id = 'gone-touch-layout-toolbar';
  toolbar.innerHTML = `
    <span>TRASCINA I COMANDI</span>
    <button type="button" id="gone-touch-layout-reset">RESET</button>
    <button type="button" id="gone-touch-layout-done">FATTO</button>
  `;
  document.body.appendChild(toolbar);
  document.getElementById('gone-touch-layout-reset')?.addEventListener('click', resetLayout);
  document.getElementById('gone-touch-layout-done')?.addEventListener('click', exitEditMode);
  return toolbar;
}

function editorTarget(target: EventTarget | null): HTMLElement | null {
  const element = target instanceof Element ? target : null;
  if (!element) return null;
  const switcher = element.closest('#mc-weapon-switcher') as HTMLElement | null;
  if (switcher) return switcher;
  for (const id of EDITABLE_IDS) {
    const match = element.closest(`#${id}`) as HTMLElement | null;
    if (match) return match;
  }
  return null;
}

function clampOffset(element: HTMLElement, wantedX: number, wantedY: number): Offset {
  const current = offsets[element.id] ?? { x: 0, y: 0 };
  const rect = element.getBoundingClientRect();
  const dx = wantedX - current.x;
  const dy = wantedY - current.y;
  const margin = 8;
  const minDx = margin - rect.left;
  const maxDx = window.innerWidth - margin - rect.right;
  const minDy = margin - rect.top;
  const maxDy = window.innerHeight - margin - rect.bottom;
  return {
    x: current.x + Math.max(minDx, Math.min(maxDx, dx)),
    y: current.y + Math.max(minDy, Math.min(maxDy, dy)),
  };
}

function onPointerDown(event: PointerEvent): void {
  if (!editing || activePointer !== null) return;
  const target = editorTarget(event.target);
  if (!target) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activePointer = event.pointerId;
  activeElement = target;
  pointerStartX = event.clientX;
  pointerStartY = event.clientY;
  const current = offsets[target.id] ?? { x: 0, y: 0 };
  offsetStartX = current.x;
  offsetStartY = current.y;
  try { target.setPointerCapture?.(event.pointerId); } catch { /* best effort */ }
}

function onPointerMove(event: PointerEvent): void {
  if (!editing || activePointer !== event.pointerId || !activeElement) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const wantedX = offsetStartX + event.clientX - pointerStartX;
  const wantedY = offsetStartY + event.clientY - pointerStartY;
  offsets[activeElement.id] = clampOffset(activeElement, wantedX, wantedY);
  applyOffset(activeElement.id);
}

function onPointerEnd(event: PointerEvent): void {
  if (activePointer !== event.pointerId) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  activePointer = null;
  activeElement = null;
  persist();
}

function enterEditMode(): void {
  if (editing) return;
  editing = true;
  activePointer = null;
  activeElement = null;
  document.documentElement.classList.add('gone-touch-layout-edit');
  const settings = document.getElementById('settings-menu');
  settings?.classList.remove('flex');
  settings?.classList.add('hidden');
  ensureToolbar();
  applyAll();
}

function exitEditMode(): void {
  if (!editing) return;
  editing = false;
  activePointer = null;
  activeElement = null;
  document.documentElement.classList.remove('gone-touch-layout-edit');
  const settings = document.getElementById('settings-menu');
  settings?.classList.remove('hidden');
  settings?.classList.add('flex');
  (window as any).goneMobileControls?.sync?.();
}

function resetLayout(): void {
  offsets = {};
  persist();
  applyAll();
}

function bindSettingsButton(): void {
  const button = document.getElementById('touch-layout-edit') as HTMLButtonElement | null;
  if (!button || button.dataset.goneLayoutBound === '1') return;
  button.dataset.goneLayoutBound = '1';
  button.addEventListener('click', enterEditMode);
}

export function startTouchLayoutEditor(): void {
  if ((window as any).__goneTouchLayoutEditorStarted) {
    bindSettingsButton();
    applyAll();
    return;
  }
  (window as any).__goneTouchLayoutEditorStarted = true;
  ensureStyle();
  ensureToolbar();
  bindSettingsButton();
  applyAll();

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('resize', applyAll, { passive: true });
  window.addEventListener('orientationchange', applyAll, { passive: true });

  const observer = new MutationObserver(() => {
    bindSettingsButton();
    applyAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  (window as any).goneTouchLayout = {
    snapshot: () => ({ editing, offsets: JSON.parse(JSON.stringify(offsets)), storageKey: STORAGE_KEY }),
    edit: enterEditMode,
    done: exitEditMode,
    reset: resetLayout,
  };
}
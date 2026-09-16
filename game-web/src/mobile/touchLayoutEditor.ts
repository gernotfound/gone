type Offset = { x: number; y: number };
type PixelOffset = { x: number; y: number };
type LayoutState = Record<string, Offset>;
type SafeInsets = { top: number; right: number; bottom: number; left: number };

const STORAGE_KEY = 'gone-touch-layout-v2';
const LEGACY_STORAGE_KEY = 'gone-touch-layout-v1';
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

let migratedLegacy = false;
let offsets: LayoutState = readStored();
let appliedOffsets: Record<string, PixelOffset> = {};
let editing = false;
let activePointer: number | null = null;
let activeElement: HTMLElement | null = null;
let pointerStartX = 0;
let pointerStartY = 0;
let offsetStartX = 0;
let offsetStartY = 0;
let safeAreaProbe: HTMLElement | null = null;

function clampUnit(value: number): number {
  return Math.max(-1, Math.min(1, value));
}

function sanitizeStored(parsed: any): LayoutState {
  if (!parsed || typeof parsed !== 'object') return {};
  const safe: LayoutState = {};
  for (const id of EDITABLE_IDS) {
    const item = parsed[id];
    if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y))) continue;
    safe[id] = {
      x: clampUnit(Number(item.x)),
      y: clampUnit(Number(item.y)),
    };
  }
  return safe;
}

function readStored(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) return sanitizeStored(JSON.parse(raw));

    const legacyRaw = localStorage.getItem(LEGACY_STORAGE_KEY);
    const legacy = legacyRaw ? JSON.parse(legacyRaw) : null;
    if (!legacy || typeof legacy !== 'object') return {};

    const width = Math.max(1, window.innerWidth || 1);
    const height = Math.max(1, window.innerHeight || 1);
    const migrated: LayoutState = {};
    for (const id of EDITABLE_IDS) {
      const item = legacy[id];
      if (!item || !Number.isFinite(Number(item.x)) || !Number.isFinite(Number(item.y))) continue;
      migrated[id] = {
        x: clampUnit(Number(item.x) / width),
        y: clampUnit(Number(item.y) / height),
      };
    }
    migratedLegacy = Object.keys(migrated).length > 0;
    return migrated;
  } catch {
    return {};
  }
}

function persist(): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(offsets)); } catch { /* optional storage */ }
}

function toPixels(offset: Offset): PixelOffset {
  return {
    x: offset.x * Math.max(1, window.innerWidth),
    y: offset.y * Math.max(1, window.innerHeight),
  };
}

function toUnit(offset: PixelOffset): Offset {
  const width = Math.max(1, window.innerWidth);
  const height = Math.max(1, window.innerHeight);
  return {
    x: clampUnit(offset.x / width),
    y: clampUnit(offset.y / height),
  };
}

function readSafeInsets(): SafeInsets {
  if (!document.body) return { top: 0, right: 0, bottom: 0, left: 0 };
  if (!safeAreaProbe) {
    safeAreaProbe = document.createElement('div');
    safeAreaProbe.id = 'gone-touch-layout-safe-area-probe';
    safeAreaProbe.setAttribute('aria-hidden', 'true');
    safeAreaProbe.style.cssText = [
      'position:fixed',
      'inset:0',
      'visibility:hidden',
      'pointer-events:none',
      'z-index:-1',
      'padding-top:env(safe-area-inset-top)',
      'padding-right:env(safe-area-inset-right)',
      'padding-bottom:env(safe-area-inset-bottom)',
      'padding-left:env(safe-area-inset-left)',
    ].join(';');
    document.body.appendChild(safeAreaProbe);
  }
  const style = getComputedStyle(safeAreaProbe);
  return {
    top: Number.parseFloat(style.paddingTop) || 0,
    right: Number.parseFloat(style.paddingRight) || 0,
    bottom: Number.parseFloat(style.paddingBottom) || 0,
    left: Number.parseFloat(style.paddingLeft) || 0,
  };
}

function bounds(): { top: number; right: number; bottom: number; left: number } {
  const safe = readSafeInsets();
  const margin = 8;
  return {
    top: safe.top + margin,
    right: window.innerWidth - safe.right - margin,
    bottom: window.innerHeight - safe.bottom - margin,
    left: safe.left + margin,
  };
}

function keepInsideViewport(element: HTMLElement, wanted: PixelOffset): PixelOffset {
  element.style.translate = `${wanted.x}px ${wanted.y}px`;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return wanted;
  const limit = bounds();
  let correctionX = 0;
  let correctionY = 0;
  if (rect.left < limit.left) correctionX = limit.left - rect.left;
  else if (rect.right > limit.right) correctionX = limit.right - rect.right;
  if (rect.top < limit.top) correctionY = limit.top - rect.top;
  else if (rect.bottom > limit.bottom) correctionY = limit.bottom - rect.bottom;
  const applied = { x: wanted.x + correctionX, y: wanted.y + correctionY };
  if (correctionX || correctionY) element.style.translate = `${applied.x}px ${applied.y}px`;
  return applied;
}

function applyOffset(id: string): void {
  const element = document.getElementById(id) as HTMLElement | null;
  if (!element) return;
  const wanted = toPixels(offsets[id] ?? { x: 0, y: 0 });
  appliedOffsets[id] = keepInsideViewport(element, wanted);
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

function clampDraggedOffset(element: HTMLElement, current: PixelOffset, wanted: PixelOffset): PixelOffset {
  const rect = element.getBoundingClientRect();
  const limit = bounds();
  const dx = wanted.x - current.x;
  const dy = wanted.y - current.y;
  const minDx = limit.left - rect.left;
  const maxDx = limit.right - rect.right;
  const minDy = limit.top - rect.top;
  const maxDy = limit.bottom - rect.bottom;
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
  const current = appliedOffsets[target.id] ?? toPixels(offsets[target.id] ?? { x: 0, y: 0 });
  offsetStartX = current.x;
  offsetStartY = current.y;
  try { target.setPointerCapture?.(event.pointerId); } catch { /* best effort */ }
}

function onPointerMove(event: PointerEvent): void {
  if (!editing || activePointer !== event.pointerId || !activeElement) return;
  event.preventDefault();
  event.stopImmediatePropagation();
  const wanted = {
    x: offsetStartX + event.clientX - pointerStartX,
    y: offsetStartY + event.clientY - pointerStartY,
  };
  const current = appliedOffsets[activeElement.id] ?? { x: offsetStartX, y: offsetStartY };
  const applied = clampDraggedOffset(activeElement, current, wanted);
  appliedOffsets[activeElement.id] = applied;
  offsets[activeElement.id] = toUnit(applied);
  activeElement.style.translate = `${applied.x}px ${applied.y}px`;
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
  appliedOffsets = {};
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
  if (migratedLegacy) persist();
  applyAll();

  document.addEventListener('pointerdown', onPointerDown, true);
  document.addEventListener('pointermove', onPointerMove, true);
  document.addEventListener('pointerup', onPointerEnd, true);
  document.addEventListener('pointercancel', onPointerEnd, true);
  window.addEventListener('resize', applyAll, { passive: true });
  window.addEventListener('orientationchange', applyAll, { passive: true });
  window.addEventListener('gone-touch-preferences-changed', applyAll as EventListener);

  const observer = new MutationObserver(() => {
    bindSettingsButton();
    applyAll();
  });
  observer.observe(document.body, { childList: true, subtree: true });

  (window as any).goneTouchLayout = {
    snapshot: () => ({
      editing,
      offsets: JSON.parse(JSON.stringify(offsets)),
      appliedOffsets: JSON.parse(JSON.stringify(appliedOffsets)),
      storageKey: STORAGE_KEY,
      legacyStorageKey: LEGACY_STORAGE_KEY,
      normalized: true,
    }),
    edit: enterEditMode,
    done: exitEditMode,
    reset: resetLayout,
  };
}

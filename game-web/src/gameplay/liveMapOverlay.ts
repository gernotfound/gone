import { DOM } from '../ui/menu.ts';
import { drawMinimap, GLOBAL_MAP_HALF_EXTENT } from '../ui/minimap.ts';
import { inputState } from '../controls/playerInput.ts';
import { getTerrainHeightAt } from '../world/chunkManager.ts';
import { PLAYER_SPAWN_X, PLAYER_SPAWN_Z } from '../gameplay/spawnController.ts';

let mapOpen = false;
let suppressPointerLossUntil = 0;
let lastTelemetryAt = 0;
let telemetryPanel: HTMLDivElement | null = null;
let mapDecorated = false;

const MAP_SIZE = GLOBAL_MAP_HALF_EXTENT * 2;

function gameplayActive(): boolean {
  return !!DOM.gameUi && !DOM.gameUi.classList.contains('hidden') && DOM.mainMenu.classList.contains('hidden');
}

function pct(value: number): number {
  return ((value + GLOBAL_MAP_HALF_EXTENT) / MAP_SIZE) * 100;
}

function headingInfo(yaw: number): { degrees: number; cardinal: string } {
  const degrees = ((-yaw * 180 / Math.PI) % 360 + 360) % 360;
  const names = ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'];
  return { degrees, cardinal: names[Math.round(degrees / 45) % 8] };
}

function quadrant(x: number, z: number): string {
  if (x >= 0 && z >= 0) return 'SE';
  if (x >= 0 && z < 0) return 'NE';
  if (x < 0 && z >= 0) return 'SW';
  return 'NW';
}

function addLandmark(container: HTMLElement, id: string, x: number, z: number, label: string, color: string): void {
  if (document.getElementById(id)) return;
  const marker = document.createElement('div');
  marker.id = id;
  marker.style.cssText = [
    'position:absolute', `left:${pct(x)}%`, `top:${pct(z)}%`, 'transform:translate(-50%,-50%)',
    'pointer-events:none', 'z-index:3', 'font-family:ui-monospace,SFMono-Regular,Menlo,monospace',
    'font-size:9px', 'font-weight:900', 'letter-spacing:.06em', 'white-space:nowrap',
    `color:${color}`, `filter:drop-shadow(0 0 4px ${color})`,
  ].join(';');
  marker.innerHTML = `<span style="display:inline-block;width:8px;height:8px;border:2px solid ${color};transform:rotate(45deg);margin-right:6px;background:rgba(2,6,23,.75)"></span>${label}`;
  container.appendChild(marker);
}

function ensureMapHud(): void {
  const container = DOM.minimapCanvas?.parentElement as HTMLElement | null;
  if (!container) return;

  if (!telemetryPanel) {
    telemetryPanel = document.createElement('div');
    telemetryPanel.id = 'map-live-telemetry';
    telemetryPanel.style.cssText = [
      'position:absolute', 'right:14px', 'top:14px', 'z-index:5', 'min-width:190px', 'padding:9px 11px',
      'border-radius:8px', 'background:rgba(2,6,23,.78)', 'border:1px solid rgba(103,232,249,.35)',
      'font:700 10px/1.5 ui-monospace,SFMono-Regular,Menlo,monospace', 'letter-spacing:.04em',
      'color:#cbd5e1', 'pointer-events:none', 'box-shadow:0 0 14px rgba(34,211,238,.12)',
    ].join(';');
    container.appendChild(telemetryPanel);
  }

  if (!mapDecorated) {
    mapDecorated = true;
    addLandmark(container, 'map-landmark-spawn', PLAYER_SPAWN_X, PLAYER_SPAWN_Z, 'SPAWN · CRATERE SE', '#34d399');
    addLandmark(container, 'map-landmark-massif', -1500, -1500, 'MASSICCIO NW', '#e2e8f0');
    addLandmark(container, 'map-landmark-origin', 0, 0, 'ORIGINE 0,0', '#94a3b8');

    const scale = document.createElement('div');
    scale.id = 'map-scale-bar';
    scale.style.cssText = 'position:absolute;left:18px;bottom:18px;z-index:5;width:100px;border-bottom:3px solid #cffafe;color:#cffafe;font:800 9px ui-monospace,monospace;text-align:center;padding-bottom:3px;pointer-events:none;text-shadow:0 0 5px #0891b2';
    scale.textContent = '800 m';
    container.appendChild(scale);

    const hint = document.createElement('div');
    hint.style.cssText = 'position:absolute;right:14px;bottom:14px;z-index:5;padding:5px 8px;border-radius:6px;background:rgba(2,6,23,.72);color:#94a3b8;font:800 9px ui-monospace,monospace;pointer-events:none';
    hint.textContent = 'M / ESC · CHIUDI  |  COMBAT ATTIVO';
    container.appendChild(hint);
  }
}

function updateLiveMap(): void {
  const api = (window as any).goneGame;
  const position = api?.player?.position;
  if (!position) return;
  ensureMapHud();

  const inside = Math.abs(position.x) <= GLOBAL_MAP_HALF_EXTENT && Math.abs(position.z) <= GLOBAL_MAP_HALF_EXTENT;
  if (DOM.playerDot) {
    DOM.playerDot.style.display = inside ? 'flex' : 'none';
    if (inside) {
      DOM.playerDot.style.position = 'absolute';
      DOM.playerDot.style.left = `${pct(position.x)}%`;
      DOM.playerDot.style.top = `${pct(position.z)}%`;
      DOM.playerDot.style.transformOrigin = '50% 50%';
      DOM.playerDot.style.transform = `translate(-50%, -50%) rotate(${-inputState.yaw}rad)`;
      DOM.playerDot.style.zIndex = '6';
    }
  }

  if (telemetryPanel) {
    const heading = headingInfo(inputState.yaw);
    const terrainY = getTerrainHeightAt(position.x, position.z);
    const distanceToSpawn = Math.hypot(position.x - PLAYER_SPAWN_X, position.z - PLAYER_SPAWN_Z);
    telemetryPanel.innerHTML = [
      `<div style="color:#67e8f9;font-size:11px;margin-bottom:3px">NAV // ${inside ? 'MAPPA GLOBALE' : 'FUORI SETTORE'}</div>`,
      `<div>X <b style="color:#f8fafc">${position.x.toFixed(0)} m</b> · Z <b style="color:#f8fafc">${position.z.toFixed(0)} m</b></div>`,
      `<div>QUOTA <b style="color:#f8fafc">${terrainY.toFixed(0)} m</b> · VOLO ${Math.max(0, position.y - terrainY).toFixed(1)} m</div>`,
      `<div>PRUA <b style="color:#f8fafc">${heading.cardinal} ${heading.degrees.toFixed(0)}°</b> · QDR <b style="color:#f8fafc">${quadrant(position.x, position.z)}</b></div>`,
      `<div>SPAWN <b style="color:#86efac">${distanceToSpawn.toFixed(0)} m</b> · FINESTRA 4.8×4.8 km</div>`,
    ].join('');
  }
}

function openMap(): void {
  mapOpen = true;
  (window as any).__goneMapOverlayOpen = true;
  DOM.mapUi.classList.remove('hidden');
  DOM.mapUi.style.pointerEvents = 'none';
  const api = (window as any).goneGame;
  const position = api?.player?.position;
  if (position) drawMinimap(position.x, position.z, inputState.yaw, getTerrainHeightAt);
  updateLiveMap();
}

function closeMap(): void {
  mapOpen = false;
  (window as any).__goneMapOverlayOpen = false;
  DOM.mapUi.classList.add('hidden');
}

function restorePointerLockSoon(): void {
  window.setTimeout(() => {
    if (!gameplayActive() || document.pointerLockElement === document.body) return;
    try {
      Promise.resolve(document.body.requestPointerLock()).catch(() => {});
    } catch {
      // After Escape some browsers require one click before relocking.
    }
  }, 0);
}

/** Non-blocking global map: movement/aim/fire continue while it is visible. */
export function startLiveMapOverlay(): void {
  if ((window as any).__goneLiveMapOverlayStarted) return;
  (window as any).__goneLiveMapOverlayStarted = true;

  window.addEventListener('keydown', (event) => {
    if (event.code === 'KeyM' && !event.repeat && gameplayActive()) {
      event.preventDefault();
      event.stopImmediatePropagation();
      if (mapOpen) closeMap(); else openMap();
      return;
    }

    if (event.code === 'Escape' && mapOpen) {
      event.preventDefault();
      event.stopImmediatePropagation();
      suppressPointerLossUntil = performance.now() + 300;
      closeMap();
      restorePointerLockSoon();
    }
  }, true);

  document.addEventListener('pointerlockchange', (event) => {
    if (document.pointerLockElement !== null) return;
    const shouldConsume = mapOpen || performance.now() < suppressPointerLossUntil;
    if (!shouldConsume) return;
    event.stopImmediatePropagation();
    suppressPointerLossUntil = performance.now() + 300;
    if (mapOpen) closeMap();
    restorePointerLockSoon();
  }, true);

  const frame = (now: number) => {
    if (mapOpen) {
      if (!gameplayActive()) closeMap();
      else if (now - lastTelemetryAt >= 33) {
        lastTelemetryAt = now;
        updateLiveMap();
      }
    }
    window.requestAnimationFrame(frame);
  };
  window.requestAnimationFrame(frame);
}

import { DOM } from '../ui/menu.ts';
import { GLOBAL_MAP_HALF_EXTENT } from '../ui/minimap.ts';
import { SPAWN_POINTS } from './spawnController.ts';

function pct(value: number): number {
  const size = GLOBAL_MAP_HALF_EXTENT * 2;
  return ((value + GLOBAL_MAP_HALF_EXTENT) / size) * 100;
}

function decorate(): boolean {
  const container = DOM.minimapCanvas?.parentElement as HTMLElement | null;
  if (!container) return false;
  if (document.getElementById('gone-spawn-map-layer')) return true;

  const layer = document.createElement('div');
  layer.id = 'gone-spawn-map-layer';
  layer.style.cssText = 'position:absolute;inset:0;z-index:4;pointer-events:none;overflow:hidden';

  SPAWN_POINTS.forEach((point, index) => {
    const marker = document.createElement('div');
    const primary = index === 0;
    marker.style.cssText = [
      'position:absolute',
      `left:${pct(point.x)}%`,
      `top:${pct(point.z)}%`,
      'transform:translate(-50%,-50%)',
      `color:${primary ? '#86efac' : '#67e8f9'}`,
      'font:900 8px/1 ui-monospace,SFMono-Regular,Menlo,monospace',
      'letter-spacing:.04em',
      'text-shadow:0 0 5px currentColor',
      'white-space:nowrap',
    ].join(';');
    marker.innerHTML = `<span style="display:inline-flex;align-items:center;justify-content:center;width:16px;height:16px;border:1px solid currentColor;border-radius:50%;background:rgba(2,6,23,.72);margin-right:3px">${index + 1}</span>${point.id}`;
    marker.title = point.label;
    layer.appendChild(marker);
  });

  const pois = [
    { x: 1450, z: -700, text: 'CORRIDOIO NE' },
    { x: -1350, z: 850, text: 'PIANORO SW' },
  ];
  for (const poi of pois) {
    const label = document.createElement('div');
    label.style.cssText = `position:absolute;left:${pct(poi.x)}%;top:${pct(poi.z)}%;transform:translate(-50%,-50%);color:#94a3b8;font:800 8px ui-monospace,monospace;letter-spacing:.06em;white-space:nowrap;text-shadow:0 0 4px #020617`;
    label.textContent = poi.text;
    layer.appendChild(label);
  }

  container.appendChild(layer);
  return true;
}

export function startMapSpawnMarkers(): void {
  if ((window as any).__goneMapSpawnMarkersStarted) return;
  (window as any).__goneMapSpawnMarkersStarted = true;
  if (decorate()) return;
  const timer = window.setInterval(() => {
    if (decorate()) window.clearInterval(timer);
  }, 250);
}

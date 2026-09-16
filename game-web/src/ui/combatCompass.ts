import './combatCompass.css';
import { inputState } from '../controls/playerInput.ts';

const STEP_DEGREES = 15;
const CELL_WIDTH_PX = 42;
const CELL_RADIUS = 6;
const UPDATE_INTERVAL_MS = 40;
const CARDINAL_LABELS: Readonly<Record<number, string>> = { 0: 'N', 45: 'NE', 90: 'E', 135: 'SE', 180: 'S', 225: 'SW', 270: 'W', 315: 'NW' };

let started = false;
let root: HTMLDivElement | null = null;
let track: HTMLDivElement | null = null;
let bearingValue: HTMLSpanElement | null = null;
let cells: HTMLSpanElement[] = [];
let lastBaseBearing = Number.NaN;
let lastPaintAt = 0;

function normalizeBearing(value: number): number {
  return ((value % 360) + 360) % 360;
}

function ensureUi(): boolean {
  if (root?.isConnected && track?.isConnected && bearingValue?.isConnected) return true;
  const gameUi = document.getElementById('game-ui');
  if (!gameUi) return false;
  root = document.getElementById('gone-combat-compass') as HTMLDivElement | null;
  if (!root) {
    root = document.createElement('div');
    root.id = 'gone-combat-compass';
    root.setAttribute('aria-hidden', 'true');
    root.innerHTML = '<div id="gone-combat-compass-track"></div><div id="gone-combat-compass-index"></div><span id="gone-combat-compass-bearing">000</span>';
    gameUi.appendChild(root);
  }
  track = root.querySelector('#gone-combat-compass-track') as HTMLDivElement | null;
  bearingValue = root.querySelector('#gone-combat-compass-bearing') as HTMLSpanElement | null;
  if (!track || !bearingValue) return false;
  if (track.childElementCount !== CELL_RADIUS * 2 + 1) {
    track.replaceChildren();
    cells = [];
    for (let index = -CELL_RADIUS; index <= CELL_RADIUS; index += 1) {
      const cell = document.createElement('span');
      cell.className = 'gone-compass-tick';
      cell.dataset.offset = String(index);
      track.appendChild(cell);
      cells.push(cell);
    }
  } else {
    cells = Array.from(track.querySelectorAll<HTMLSpanElement>('.gone-compass-tick'));
  }
  return true;
}

function paintTicks(baseBearing: number): void {
  if (!track || cells.length === 0 || baseBearing === lastBaseBearing) return;
  lastBaseBearing = baseBearing;
  for (let index = -CELL_RADIUS; index <= CELL_RADIUS; index += 1) {
    const cell = cells[index + CELL_RADIUS];
    const angle = normalizeBearing(baseBearing + index * STEP_DEGREES);
    cell.textContent = CARDINAL_LABELS[angle] ?? String(angle);
    cell.classList.toggle('is-major', angle % 45 === 0);
    cell.classList.toggle('is-cardinal', angle % 90 === 0);
  }
}

function paint(now: number): void {
  requestAnimationFrame(paint);
  if (now - lastPaintAt < UPDATE_INTERVAL_MS || !ensureUi()) return;
  lastPaintAt = now;
  const bearing = normalizeBearing(-inputState.yaw * 180 / Math.PI);
  const baseBearing = Math.round(bearing / STEP_DEGREES) * STEP_DEGREES;
  paintTicks(baseBearing);
  const fractionalCells = (bearing - baseBearing) / STEP_DEGREES;
  track!.style.transform = `translate3d(calc(-50% + ${(-fractionalCells * CELL_WIDTH_PX).toFixed(2)}px), 0, 0)`;
  bearingValue!.textContent = String(Math.round(bearing) % 360).padStart(3, '0');
  root!.dataset.bearing = bearing.toFixed(1);
}

export function startCombatCompass(): void {
  if (started) { ensureUi(); return; }
  started = true;
  ensureUi();
  requestAnimationFrame(paint);
}

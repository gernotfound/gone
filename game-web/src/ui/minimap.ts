import { MAZE_WALLS } from '../world/mazeLayout.ts';
import { DOM } from './menu.ts';

let minimapCtx: CanvasRenderingContext2D | null = null;
let cachedGlobalMap: HTMLCanvasElement | null = null;
let cachedHeightSource: ((x: number, z: number) => number) | null = null;

/** Designed gameplay window: includes NW mountain massif and SE giant crater. */
export const GLOBAL_MAP_HALF_EXTENT = 2400;
const GLOBAL_MAP_SIZE_METERS = GLOBAL_MAP_HALF_EXTENT * 2;
const SAMPLE_SIZE = 256;
const CONTOUR_METERS = 80;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function mix(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
}

function altitudeColor(height: number, relief: number): [number, number, number] {
    const t = clamp01((height + 110) / 520);
    let r: number;
    let g: number;
    let b: number;

    if (t < 0.36) {
        const q = t / 0.36;
        r = mix(8, 28, q);
        g = mix(20, 63, q);
        b = mix(34, 70, q);
    } else if (t < 0.72) {
        const q = (t - 0.36) / 0.36;
        r = mix(28, 83, q);
        g = mix(63, 112, q);
        b = mix(70, 105, q);
    } else {
        const q = (t - 0.72) / 0.28;
        r = mix(83, 214, q);
        g = mix(112, 222, q);
        b = mix(105, 218, q);
    }

    return [
        Math.round(r * relief),
        Math.round(g * relief),
        Math.round(b * relief),
    ];
}

function buildGlobalMap(getTerrainHeightAt: (x: number, z: number) => number): HTMLCanvasElement {
    const sample = document.createElement('canvas');
    sample.width = SAMPLE_SIZE;
    sample.height = SAMPLE_SIZE;
    const ctx = sample.getContext('2d', { alpha: false });
    if (!ctx) return sample;

    const heights = new Float32Array(SAMPLE_SIZE * SAMPLE_SIZE);
    const stepMeters = GLOBAL_MAP_SIZE_METERS / (SAMPLE_SIZE - 1);

    for (let py = 0; py < SAMPLE_SIZE; py += 1) {
        const worldZ = -GLOBAL_MAP_HALF_EXTENT + py * stepMeters;
        for (let px = 0; px < SAMPLE_SIZE; px += 1) {
            const worldX = -GLOBAL_MAP_HALF_EXTENT + px * stepMeters;
            heights[py * SAMPLE_SIZE + px] = getTerrainHeightAt(worldX, worldZ);
        }
    }

    const image = ctx.createImageData(SAMPLE_SIZE, SAMPLE_SIZE);
    for (let py = 0; py < SAMPLE_SIZE; py += 1) {
        for (let px = 0; px < SAMPLE_SIZE; px += 1) {
            const i = py * SAMPLE_SIZE + px;
            const h = heights[i];
            const left = heights[py * SAMPLE_SIZE + Math.max(0, px - 1)];
            const right = heights[py * SAMPLE_SIZE + Math.min(SAMPLE_SIZE - 1, px + 1)];
            const up = heights[Math.max(0, py - 1) * SAMPLE_SIZE + px];
            const down = heights[Math.min(SAMPLE_SIZE - 1, py + 1) * SAMPLE_SIZE + px];

            // Directional hillshade gives the terrain a clearer top-down shape
            // than a flat altitude ramp while remaining deterministic.
            const relief = Math.max(
                0.70,
                Math.min(1.12, 0.94 + (left - right) * 0.006 + (up - down) * 0.004),
            );
            let [r, g, b] = altitudeColor(h, relief);

            const band = Math.floor((h + 400) / CONTOUR_METERS);
            const neighborBand = Math.floor((right + 400) / CONTOUR_METERS);
            const downBand = Math.floor((down + 400) / CONTOUR_METERS);
            if (band !== neighborBand || band !== downBand) {
                r = Math.round(r * 0.78);
                g = Math.round(g * 0.78);
                b = Math.round(b * 0.80);
            }

            const offset = i * 4;
            image.data[offset] = r;
            image.data[offset + 1] = g;
            image.data[offset + 2] = b;
            image.data[offset + 3] = 255;
        }
    }
    ctx.putImageData(image, 0, 0);
    return sample;
}

function worldToCanvasX(x: number, width: number): number {
    return ((x + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * width;
}

function worldToCanvasY(z: number, height: number): number {
    return ((z + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * height;
}

function drawMapGrid(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(207,250,254,0.12)';
    ctx.lineWidth = 1;

    const gridMeters = 800;
    for (let meter = -1600; meter <= 1600; meter += gridMeters) {
        const x = worldToCanvasX(meter, width);
        const y = worldToCanvasY(meter, height);
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }
    ctx.restore();
}

function drawMazeOverlay(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    const pixelsPerMeterX = width / GLOBAL_MAP_SIZE_METERS;
    const pixelsPerMeterY = height / GLOBAL_MAP_SIZE_METERS;

    ctx.save();
    ctx.fillStyle = 'rgba(241,245,249,0.88)';
    ctx.shadowColor = 'rgba(2,6,23,0.92)';
    ctx.shadowBlur = Math.max(1.5, width / 400);

    // Draw the canonical physical wall footprints. The tactical map therefore
    // always matches movement, hitscan and spider-navigation collision geometry.
    for (const wall of MAZE_WALLS) {
        const wallWidth = Math.max(1.25, wall.width * pixelsPerMeterX);
        const wallDepth = Math.max(1.25, wall.depth * pixelsPerMeterY);
        const centerX = worldToCanvasX(wall.x, width);
        const centerY = worldToCanvasY(wall.z, height);
        ctx.fillRect(
            centerX - wallWidth * 0.5,
            centerY - wallDepth * 0.5,
            wallWidth,
            wallDepth,
        );
    }
    ctx.restore();
}

function drawMapLabels(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(236,254,255,0.90)';
    ctx.shadowColor = 'rgba(2,6,23,0.95)';
    ctx.shadowBlur = 4;

    ctx.textAlign = 'center';
    ctx.fillText('N', width / 2, 18);
    ctx.fillText('S', width / 2, height - 10);
    ctx.textAlign = 'left';
    ctx.fillText('W', 10, height / 2);
    ctx.textAlign = 'right';
    ctx.fillText('E', width - 10, height / 2);
    ctx.restore();
}

export function initMinimap() {
    if (DOM.minimapCanvas) {
        minimapCtx = DOM.minimapCanvas.getContext('2d', { alpha: false });
    }
}

export function invalidateGlobalMap(): void {
    cachedGlobalMap = null;
    cachedHeightSource = null;
}

export function drawMinimap(
    playerX: number,
    playerZ: number,
    yaw: number,
    getTerrainHeightAt: (x: number, z: number) => number
) {
    if (!minimapCtx || !DOM.minimapCanvas) return;
    const width = DOM.minimapCanvas.width;
    const height = DOM.minimapCanvas.height;

    if (!cachedGlobalMap || cachedHeightSource !== getTerrainHeightAt) {
        cachedGlobalMap = buildGlobalMap(getTerrainHeightAt);
        cachedHeightSource = getTerrainHeightAt;
    }

    minimapCtx.save();
    minimapCtx.imageSmoothingEnabled = true;
    minimapCtx.imageSmoothingQuality = 'high';
    minimapCtx.clearRect(0, 0, width, height);
    minimapCtx.drawImage(cachedGlobalMap, 0, 0, width, height);
    minimapCtx.restore();

    drawMapGrid(minimapCtx, width, height);
    drawMazeOverlay(minimapCtx, width, height);
    drawMapLabels(minimapCtx, width, height);

    if (DOM.playerDot) {
        const inside = Math.abs(playerX) <= GLOBAL_MAP_HALF_EXTENT && Math.abs(playerZ) <= GLOBAL_MAP_HALF_EXTENT;
        DOM.playerDot.style.display = inside ? 'flex' : 'none';
        if (inside) {
            const xPct = ((playerX + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * 100;
            const yPct = ((playerZ + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * 100;
            DOM.playerDot.style.position = 'absolute';
            DOM.playerDot.style.left = `${xPct}%`;
            DOM.playerDot.style.top = `${yPct}%`;
            DOM.playerDot.style.transformOrigin = '50% 50%';
            DOM.playerDot.style.transform = `translate(-50%, -50%) rotate(${-yaw}rad)`;
            DOM.playerDot.style.zIndex = '4';
        }
    }
}

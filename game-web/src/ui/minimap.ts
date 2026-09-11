import { DOM } from './menu.ts';

let minimapCtx: CanvasRenderingContext2D | null = null;
let cachedGlobalMap: HTMLCanvasElement | null = null;
let cachedHeightSource: ((x: number, z: number) => number) | null = null;

/** Designed gameplay window: includes NW mountain massif and SE giant crater. */
export const GLOBAL_MAP_HALF_EXTENT = 2400;
const GLOBAL_MAP_SIZE_METERS = GLOBAL_MAP_HALF_EXTENT * 2;
const SAMPLE_SIZE = 192;
const CONTOUR_METERS = 40;

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}

function mix(a: number, b: number, t: number): number {
    return Math.round(a + (b - a) * t);
}

function altitudeColor(height: number, slope: number): [number, number, number] {
    // Fixed elevation scale keeps the visual language stable between openings:
    // deep terrain = navy/charcoal, high terrain = pale ice/stone.
    const t = clamp01((height + 110) / 520);
    let r: number;
    let g: number;
    let b: number;

    if (t < 0.42) {
        const q = t / 0.42;
        r = mix(5, 45, q);
        g = mix(10, 62, q);
        b = mix(25, 82, q);
    } else if (t < 0.78) {
        const q = (t - 0.42) / 0.36;
        r = mix(45, 142, q);
        g = mix(62, 164, q);
        b = mix(82, 182, q);
    } else {
        const q = (t - 0.78) / 0.22;
        r = mix(142, 238, q);
        g = mix(164, 246, q);
        b = mix(182, 250, q);
    }

    const reliefShade = Math.max(0.68, 1 - Math.min(0.32, slope * 0.025));
    return [Math.round(r * reliefShade), Math.round(g * reliefShade), Math.round(b * reliefShade)];
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
            const right = heights[py * SAMPLE_SIZE + Math.min(SAMPLE_SIZE - 1, px + 1)];
            const down = heights[Math.min(SAMPLE_SIZE - 1, py + 1) * SAMPLE_SIZE + px];
            const slope = Math.hypot(right - h, down - h) / Math.max(1, stepMeters);
            let [r, g, b] = altitudeColor(h, slope);

            // Subtle contour lines make elevation readable without obscuring
            // the continuous light-high / dark-low altitude ramp.
            const band = Math.floor((h + 400) / CONTOUR_METERS);
            const neighborBand = Math.floor((right + 400) / CONTOUR_METERS);
            const downBand = Math.floor((down + 400) / CONTOUR_METERS);
            if (band !== neighborBand || band !== downBand) {
                r = Math.round(r * 0.72);
                g = Math.round(g * 0.72);
                b = Math.round(b * 0.76);
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

function drawMapChrome(ctx: CanvasRenderingContext2D, width: number, height: number): void {
    ctx.save();
    ctx.strokeStyle = 'rgba(103,232,249,0.16)';
    ctx.lineWidth = 1;
    ctx.font = 'bold 11px ui-monospace, monospace';
    ctx.fillStyle = 'rgba(207,250,254,0.82)';

    const gridMeters = 800;
    for (let meter = -1600; meter <= 1600; meter += gridMeters) {
        const x = ((meter + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * width;
        const y = ((meter + GLOBAL_MAP_HALF_EXTENT) / GLOBAL_MAP_SIZE_METERS) * height;
        ctx.beginPath(); ctx.moveTo(x, 0); ctx.lineTo(x, height); ctx.stroke();
        ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(width, y); ctx.stroke();
    }

    ctx.fillStyle = 'rgba(2,6,23,0.72)';
    ctx.fillRect(12, 12, 196, 42);
    ctx.fillStyle = '#cffafe';
    ctx.fillText('MAPPA GLOBALE // 4.8 KM', 22, 30);
    ctx.fillStyle = '#94a3b8';
    ctx.fillText('ALTO = CHIARO · BASSO = SCURO', 22, 46);

    ctx.fillStyle = 'rgba(207,250,254,0.8)';
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
    drawMapChrome(minimapCtx, width, height);

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

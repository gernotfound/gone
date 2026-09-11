import { sceneManager } from '../rendering/scene.ts';
import { activeChunks, CHUNK_SIZE } from '../world/chunkManager.ts';

type TelemetrySnapshot = {
  fps: number;
  frameAvgMs: number;
  frameP95Ms: number;
  frameMaxMs: number;
  longTasks: number;
  longTaskMs: number;
  drawCalls: number;
  triangles: number;
  geometries: number;
  textures: number;
  activeChunks: number;
  chunkBoundaryFrameMs: number;
  networkBufferedBytes: number;
  peerCount: number;
  rejectedShots: number;
  memoryMb: number | null;
  bottleneck: string;
};

const frameSamples: number[] = [];
const MAX_FRAME_SAMPLES = 240;
let overlay: HTMLDivElement | null = null;
let visible = false;
let lastFrameAt = 0;
let lastUiAt = 0;
let longTasks = 0;
let longTaskMs = 0;
let lastChunkX: number | null = null;
let lastChunkZ: number | null = null;
let lastChunkBoundaryFrameMs = 0;
let current: TelemetrySnapshot | null = null;

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0;
}

function networkStats(): { bufferedBytes: number; peerCount: number; rejectedShots: number } {
  const api = (window as any).goneGame;
  const client = api?.getP2PClient?.() as any;
  const host = api?.getP2PHost?.() as any;
  let bufferedBytes = 0;
  let peerCount = 0;

  const clientChannel = client?.channel;
  if (clientChannel) {
    bufferedBytes += Math.max(0, Number(clientChannel.bufferedAmount ?? 0) || 0);
    if (client?.status === 'connected') peerCount = 1;
  }

  const peers = host?.peers;
  if (peers instanceof Map) {
    peerCount = peers.size;
    for (const peer of peers.values()) {
      bufferedBytes += Math.max(0, Number((peer as any)?.channel?.bufferedAmount ?? 0) || 0);
    }
  }

  return {
    bufferedBytes,
    peerCount,
    rejectedShots: Math.max(0, Number(host?.__gonePvpHardeningState?.rejected ?? 0) || 0),
  };
}

function classify(snapshot: Omit<TelemetrySnapshot, 'bottleneck'>): string {
  if (snapshot.networkBufferedBytes > 128 * 1024) return 'RETE / BACKPRESSURE';
  if (snapshot.chunkBoundaryFrameMs > 35) return 'CHUNK / TERRAIN';
  if (snapshot.longTaskMs > 80 && snapshot.frameP95Ms > 25) return 'CPU / MAIN THREAD';
  if (snapshot.frameP95Ms > 25 && (snapshot.drawCalls > 180 || snapshot.triangles > 450_000)) return 'RENDER / GPU';
  if (snapshot.frameP95Ms > 25) return 'FRAME TIME';
  return 'STABILE';
}

function collect(): TelemetrySnapshot {
  const count = frameSamples.length || 1;
  const total = frameSamples.reduce((sum, value) => sum + value, 0);
  const avg = total / count;
  const max = frameSamples.reduce((value, sample) => Math.max(value, sample), 0);
  const info = sceneManager.renderer?.info;
  const network = networkStats();
  const memory = (performance as any).memory;
  const memoryMb = Number.isFinite(memory?.usedJSHeapSize)
    ? memory.usedJSHeapSize / (1024 * 1024)
    : null;

  const base = {
    fps: avg > 0 ? 1000 / avg : 0,
    frameAvgMs: avg,
    frameP95Ms: percentile95(frameSamples),
    frameMaxMs: max,
    longTasks,
    longTaskMs,
    drawCalls: Number(info?.render?.calls ?? 0),
    triangles: Number(info?.render?.triangles ?? 0),
    geometries: Number(info?.memory?.geometries ?? 0),
    textures: Number(info?.memory?.textures ?? 0),
    activeChunks: activeChunks.size,
    chunkBoundaryFrameMs: lastChunkBoundaryFrameMs,
    networkBufferedBytes: network.bufferedBytes,
    peerCount: network.peerCount,
    rejectedShots: network.rejectedShots,
    memoryMb,
  };
  return { ...base, bottleneck: classify(base) };
}

function ensureOverlay(): HTMLDivElement {
  if (overlay?.isConnected) return overlay;
  overlay = document.createElement('div');
  overlay.id = 'gone-local-telemetry';
  overlay.setAttribute('aria-hidden', 'true');
  Object.assign(overlay.style, {
    position: 'fixed', left: '12px', top: '12px', zIndex: '80', pointerEvents: 'none',
    minWidth: '270px', padding: '10px 12px', border: '1px solid rgba(34,211,238,.38)',
    borderRadius: '10px', background: 'rgba(2,6,23,.86)', color: '#cbd5e1',
    font: '11px/1.45 ui-monospace, SFMono-Regular, Menlo, monospace', whiteSpace: 'pre',
    boxShadow: '0 0 18px rgba(34,211,238,.12)', display: 'none',
  });
  document.body.appendChild(overlay);
  return overlay;
}

function render(snapshot: TelemetrySnapshot): void {
  const node = ensureOverlay();
  if (!visible) return;
  const memory = snapshot.memoryMb === null ? 'n/a' : `${snapshot.memoryMb.toFixed(0)} MB`;
  node.textContent = [
    'G.O.N.E. DIAGNOSTICA LOCALE · F3',
    `FPS ${snapshot.fps.toFixed(0)}   frame ${snapshot.frameAvgMs.toFixed(1)}ms   p95 ${snapshot.frameP95Ms.toFixed(1)}ms   max ${snapshot.frameMaxMs.toFixed(1)}ms`,
    `render calls ${snapshot.drawCalls}   tri ${Math.round(snapshot.triangles / 1000)}k   geo ${snapshot.geometries}   tex ${snapshot.textures}`,
    `chunk ${snapshot.activeChunks}   ultimo hitch ${snapshot.chunkBoundaryFrameMs.toFixed(1)}ms`,
    `rete peer ${snapshot.peerCount}   buffer ${(snapshot.networkBufferedBytes / 1024).toFixed(1)}KB   colpi rifiutati ${snapshot.rejectedShots}`,
    `long task ${snapshot.longTasks} / ${snapshot.longTaskMs.toFixed(0)}ms   heap ${memory}`,
    `diagnosi: ${snapshot.bottleneck}`,
  ].join('\n');
}

function detectChunkBoundary(frameMs: number): void {
  const player = (window as any).goneGame?.player;
  const x = Number(player?.position?.x);
  const z = Number(player?.position?.z);
  if (!Number.isFinite(x) || !Number.isFinite(z)) return;
  const chunkX = Math.floor(x / CHUNK_SIZE);
  const chunkZ = Math.floor(z / CHUNK_SIZE);
  if (lastChunkX !== null && (chunkX !== lastChunkX || chunkZ !== lastChunkZ)) {
    lastChunkBoundaryFrameMs = frameMs;
  }
  lastChunkX = chunkX;
  lastChunkZ = chunkZ;
}

function frame(now: number): void {
  if (lastFrameAt > 0) {
    const dt = Math.max(0, Math.min(250, now - lastFrameAt));
    frameSamples.push(dt);
    if (frameSamples.length > MAX_FRAME_SAMPLES) frameSamples.shift();
    detectChunkBoundary(dt);
  }
  lastFrameAt = now;

  if (now - lastUiAt >= 500) {
    lastUiAt = now;
    current = collect();
    render(current);
    longTasks = 0;
    longTaskMs = 0;
  }
  window.requestAnimationFrame(frame);
}

function installLongTaskObserver(): void {
  if (!('PerformanceObserver' in window)) return;
  try {
    const observer = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        longTasks += 1;
        longTaskMs += entry.duration;
      }
    });
    observer.observe({ entryTypes: ['longtask'] });
  } catch {
    // Not supported by every browser; the other counters remain available.
  }
}

/** F3 toggles a zero-service, local-only performance/network diagnostic overlay. */
export function startLocalTelemetry(): void {
  if ((window as any).__goneLocalTelemetryStarted) return;
  (window as any).__goneLocalTelemetryStarted = true;
  ensureOverlay();
  installLongTaskObserver();

  window.addEventListener('keydown', (event) => {
    if (event.code !== 'F3' || event.repeat) return;
    event.preventDefault();
    visible = !visible;
    ensureOverlay().style.display = visible ? 'block' : 'none';
    if (visible && current) render(current);
  }, true);

  (window as any).goneTelemetry = {
    toggle: () => {
      visible = !visible;
      ensureOverlay().style.display = visible ? 'block' : 'none';
      if (visible && current) render(current);
      return visible;
    },
    snapshot: () => current ? { ...current } : collect(),
  };

  window.requestAnimationFrame(frame);
}

import { sceneManager } from '../rendering/scene.ts';
import { browserLifecycle } from '../runtime/browserLifecycle.ts';

type TelemetrySnapshot = {
  frameAvgMs?: number;
  frameP95Ms?: number;
  drawCalls?: number;
  triangles?: number;
  networkBufferedBytes?: number;
  bottleneck?: string;
};

type AdaptiveQualityState = {
  enabled: boolean;
  dpr: number;
  minDpr: number;
  maxDpr: number;
  pressureStreak: number;
  stableStreak: number;
  lowerCount: number;
  raiseCount: number;
  lastReason: string;
};

const DESKTOP_MAX_DPR = Math.max(0.75, Math.min(window.devicePixelRatio || 1, 1.25));
const DPR_FLOOR = 0.75;
const SMARTPHONE_MAX_DPR = 1.0;
const EVALUATION_MS = 2000;

let enabled = true;
let currentDpr = 1;
let pressureStreak = 0;
let stableStreak = 0;
let lowerCount = 0;
let raiseCount = 0;
let lastReason = 'IN ATTESA';
let timer: number | null = null;

function telemetrySnapshot(): TelemetrySnapshot | null {
  const telemetry = (window as any).goneTelemetry;
  const snapshot = telemetry?.snapshot?.();
  return snapshot && typeof snapshot === 'object' ? snapshot as TelemetrySnapshot : null;
}

function isGameplayVisible(): boolean {
  if (document.visibilityState !== 'visible') return false;
  const gameUi = document.getElementById('game-ui');
  return !!gameUi && !gameUi.classList.contains('hidden');
}

function maxDpr(): number {
  return document.documentElement.classList.contains('gone-smartphone')
    ? Math.min(DESKTOP_MAX_DPR, SMARTPHONE_MAX_DPR)
    : DESKTOP_MAX_DPR;
}

function minDpr(): number {
  return Math.min(maxDpr(), DPR_FLOOR);
}

function clampDpr(value: number): number {
  return Math.max(minDpr(), Math.min(maxDpr(), value));
}

function setDpr(next: number, reason: string): void {
  const renderer = sceneManager.renderer;
  if (!renderer) return;

  const rounded = Math.round(clampDpr(next) * 100) / 100;
  if (Math.abs(rounded - currentDpr) < 0.005 && Math.abs(renderer.getPixelRatio() - rounded) < 0.005) {
    lastReason = reason;
    decorateTelemetry();
    return;
  }

  currentDpr = rounded;
  renderer.setPixelRatio(currentDpr);
  renderer.setSize(window.innerWidth, window.innerHeight, false);
  lastReason = reason;
  window.dispatchEvent(new CustomEvent('gone-render-scale-changed', {
    detail: { dpr: currentDpr, reason },
  }));
  decorateTelemetry();
}

function decorateTelemetry(): void {
  const overlay = document.getElementById('gone-local-telemetry');
  if (overlay) {
    overlay.dataset.renderScale = `${currentDpr.toFixed(2)}x`;
    overlay.dataset.renderState = enabled ? lastReason : 'DISATTIVATO';
  }

  if (!document.getElementById('gone-adaptive-quality-style')) {
    const style = document.createElement('style');
    style.id = 'gone-adaptive-quality-style';
    style.textContent = '#gone-local-telemetry::after{content:"\\A render DPR " attr(data-render-scale) " · " attr(data-render-state);white-space:pre;color:#67e8f9;}';
    document.head.appendChild(style);
  }
}

function evaluate(): void {
  const renderer = sceneManager.renderer;
  if (!renderer) return;

  currentDpr = renderer.getPixelRatio();
  const ceiling = maxDpr();
  const floor = minDpr();
  if (currentDpr > ceiling + 0.005) {
    pressureStreak = 0;
    stableStreak = 0;
    setDpr(ceiling, 'LIMITE SMARTPHONE');
    return;
  }

  decorateTelemetry();
  if (!enabled || !isGameplayVisible()) {
    pressureStreak = 0;
    stableStreak = 0;
    return;
  }

  const snapshot = telemetrySnapshot();
  const p95 = Number(snapshot?.frameP95Ms);
  const avg = Number(snapshot?.frameAvgMs);
  if (!Number.isFinite(p95) || !Number.isFinite(avg)) return;

  const bottleneck = String(snapshot?.bottleneck ?? '');
  const buffered = Math.max(0, Number(snapshot?.networkBufferedBytes ?? 0) || 0);
  const drawCalls = Math.max(0, Number(snapshot?.drawCalls ?? 0) || 0);
  const triangles = Math.max(0, Number(snapshot?.triangles ?? 0) || 0);

  const nonRenderBottleneck = /RETE|BACKPRESSURE|CHUNK|CPU|MAIN THREAD/.test(bottleneck);
  const gpuTagged = bottleneck === 'RENDER / GPU';
  const renderHeavy = p95 > 28 && (drawCalls > 180 || triangles > 450_000);
  const gpuPressure = !nonRenderBottleneck && (gpuTagged || renderHeavy);
  const stable = p95 < 18.5 && avg < 17.8 && buffered < 64 * 1024;

  if (gpuPressure) {
    pressureStreak += 1;
    stableStreak = 0;
  } else if (stable) {
    stableStreak += 1;
    pressureStreak = 0;
  } else {
    pressureStreak = Math.max(0, pressureStreak - 1);
    stableStreak = 0;
  }

  if (pressureStreak >= 2 && currentDpr > floor + 0.01) {
    const step = p95 > 42 ? 0.15 : 0.10;
    pressureStreak = 0;
    lowerCount += 1;
    setDpr(currentDpr - step, `RIDOTTO · p95 ${p95.toFixed(1)}ms`);
    return;
  }

  if (stableStreak >= 4 && currentDpr < ceiling - 0.01) {
    stableStreak = 0;
    raiseCount += 1;
    setDpr(currentDpr + 0.05, `RECUPERO · p95 ${p95.toFixed(1)}ms`);
    return;
  }

  if (nonRenderBottleneck) lastReason = `NESSUN TAGLIO · ${bottleneck}`;
  else if (gpuPressure) lastReason = `GPU SOTTO PRESSIONE · ${pressureStreak}/2`;
  else lastReason = currentDpr < ceiling ? 'SCALA RIDOTTA' : 'MASSIMA QUALITÀ';
  decorateTelemetry();
}

function stopTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

function state(): AdaptiveQualityState {
  return {
    enabled,
    dpr: currentDpr,
    minDpr: minDpr(),
    maxDpr: maxDpr(),
    pressureStreak,
    stableStreak,
    lowerCount,
    raiseCount,
    lastReason,
  };
}

/**
 * Conservative local adaptive resolution. It only lowers render DPR when the
 * diagnostics identify sustained render/GPU pressure; network, chunk and main-
 * thread bottlenecks never trigger a resolution cut. Quality recovers slowly
 * after sustained stable 60-ish FPS frame pacing. Smartphone quality recovery
 * respects the same 1.0 DPR ceiling as the mobile runtime, avoiding setSize
 * churn between two otherwise-correct governors.
 */
export function startAdaptiveRenderScale(): void {
  if ((window as any).__goneAdaptiveRenderScaleStarted) return;
  (window as any).__goneAdaptiveRenderScaleStarted = true;

  const renderer = sceneManager.renderer;
  currentDpr = renderer?.getPixelRatio() ?? maxDpr();
  if (renderer && currentDpr > maxDpr() + 0.005) {
    setDpr(maxDpr(), 'LIMITE SMARTPHONE');
  }

  (window as any).goneAdaptiveQuality = {
    snapshot: () => ({ ...state() }),
    setEnabled: (value: boolean) => {
      enabled = !!value;
      if (!enabled) {
        pressureStreak = 0;
        stableStreak = 0;
        setDpr(maxDpr(), 'DISATTIVATO');
      }
      decorateTelemetry();
      return enabled;
    },
  };

  decorateTelemetry();
  timer = window.setInterval(evaluate, EVALUATION_MS);
  browserLifecycle.subscribe('beforeunload', 'adaptiveRenderScale', stopTimer, 5);
}

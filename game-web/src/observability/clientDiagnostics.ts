import { BUILD_ID } from '../generated/buildVersion.ts';

type DiagnosticKind =
  | 'client_boot'
  | 'window_error'
  | 'unhandled_rejection'
  | 'webgl_context_lost'
  | 'network_disconnect'
  | 'network_resume';

type DiagnosticPayload = {
  kind: DiagnosticKind;
  buildId: string;
  message: string;
  stack?: string;
  path: string;
  device: string;
  inputMode: string;
  standalone: boolean;
  online: boolean;
  visibility: DocumentVisibilityState;
  timestamp: string;
};

const ENDPOINT = '/api/client-telemetry';
const MAX_REPORTS = 24;
const DUPLICATE_WINDOW_MS = 20_000;
let reportCount = 0;
const recent = new Map<string, number>();

function compactText(value: unknown, max = 900): string {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function compactStack(value: unknown): string | undefined {
  const stack = compactText(value, 2400);
  return stack || undefined;
}

function deviceBucket(): string {
  const ua = navigator.userAgent;
  if (/iPhone|iPod/i.test(ua)) return 'iphone';
  if (/iPad/i.test(ua) || (/Macintosh/i.test(ua) && navigator.maxTouchPoints > 1)) return 'ipad';
  if (/Android/i.test(ua) && /Mobile/i.test(ua)) return 'android-phone';
  if (/Android/i.test(ua)) return 'android-tablet';
  if (/Macintosh|Mac OS X/i.test(ua)) return 'mac';
  if (/Windows/i.test(ua)) return 'windows';
  if (/Linux/i.test(ua)) return 'linux';
  return 'other';
}

function payload(kind: DiagnosticKind, message: string, stack?: string): DiagnosticPayload {
  return {
    kind,
    buildId: BUILD_ID,
    message: compactText(message),
    stack: compactStack(stack),
    path: location.pathname.slice(0, 180),
    device: deviceBucket(),
    inputMode: document.documentElement.dataset.goneInputMode ?? 'unknown',
    standalone: window.matchMedia('(display-mode: standalone)').matches || Boolean((navigator as any).standalone),
    online: navigator.onLine,
    visibility: document.visibilityState,
    timestamp: new Date().toISOString(),
  };
}

function canSend(report: DiagnosticPayload): boolean {
  if (reportCount >= MAX_REPORTS) return false;
  const key = `${report.kind}:${report.message.slice(0, 160)}`;
  const now = Date.now();
  const previous = recent.get(key) ?? 0;
  if (now - previous < DUPLICATE_WINDOW_MS) return false;
  recent.set(key, now);
  reportCount += 1;
  return true;
}

function send(report: DiagnosticPayload): void {
  if (!canSend(report)) return;
  const body = JSON.stringify(report);
  try {
    if (navigator.sendBeacon && body.length < 12_000) {
      const queued = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: 'application/json' }));
      if (queued) return;
    }
  } catch { /* fall back to fetch */ }

  void fetch(ENDPOINT, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body,
    keepalive: true,
    credentials: 'same-origin',
  }).catch(() => {
    // Diagnostics must never become a gameplay failure source.
  });
}

function report(kind: DiagnosticKind, message: string, stack?: string): void {
  send(payload(kind, message, stack));
}

function installCanvasGuard(): void {
  const canvas = document.getElementById('game-canvas');
  if (!canvas || (canvas as HTMLElement).dataset.goneDiagnosticsBound === '1') return;
  (canvas as HTMLElement).dataset.goneDiagnosticsBound = '1';
  canvas.addEventListener('webglcontextlost', (event) => {
    event.preventDefault();
    report('webgl_context_lost', 'WebGL context lost');
  });
}

function sendBootOnce(): void {
  const key = `gone-diagnostics-boot:${BUILD_ID}`;
  try {
    if (sessionStorage.getItem(key) === '1') return;
    sessionStorage.setItem(key, '1');
  } catch { /* session storage may be unavailable */ }
  report('client_boot', 'client runtime started');
}

export function startClientDiagnostics(): void {
  if ((window as any).__goneClientDiagnosticsStarted) return;
  (window as any).__goneClientDiagnosticsStarted = true;

  window.addEventListener('error', (event) => {
    report('window_error', event.message || 'window error', event.error?.stack);
  });
  window.addEventListener('unhandledrejection', (event) => {
    const reason = event.reason;
    report(
      'unhandled_rejection',
      reason instanceof Error ? reason.message : compactText(reason || 'unhandled rejection'),
      reason instanceof Error ? reason.stack : undefined,
    );
  });
  window.addEventListener('gone-reconnect-requested', (event) => {
    const reason = compactText((event as CustomEvent).detail?.reason ?? 'unknown');
    report('network_disconnect', `reconnect requested: ${reason}`);
  });
  window.addEventListener('gone-mobile-session-resumed', (event) => {
    const detail = (event as CustomEvent).detail ?? {};
    if (detail.clientStatus === 'connected') {
      report('network_resume', `session resumed: ${compactText(detail.reason ?? 'unknown')}`);
    }
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', installCanvasGuard, { once: true });
  } else {
    installCanvasGuard();
  }
  sendBootOnce();

  (window as any).goneDiagnostics = {
    buildId: BUILD_ID,
    report: (kind: DiagnosticKind, message: string) => report(kind, message),
    snapshot: () => ({ reportCount, maxReports: MAX_REPORTS, endpoint: ENDPOINT, buildId: BUILD_ID }),
  };
}
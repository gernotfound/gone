import type { RuntimeHealthSnapshot } from '../runtime/runtimeKernel.ts';

type AvailabilitySnapshot = {
  visible: boolean;
  status: RuntimeHealthSnapshot['status'] | 'unknown';
  failedModules: string[];
};

let started = false;
let latest: RuntimeHealthSnapshot | null = null;

function problemModules(snapshot: RuntimeHealthSnapshot): string[] {
  const critical = snapshot.modules.filter((module) =>
    module.critical && (module.state === 'failed' || module.state === 'blocked'),
  );
  const source = critical.length > 0
    ? critical
    : snapshot.modules.filter((module) => module.state === 'failed' || module.state === 'blocked');
  return source.map((module) => module.name).slice(0, 4);
}

function ensureStyle(): void {
  if (document.getElementById('gone-runtime-unavailable-style')) return;
  const style = document.createElement('style');
  style.id = 'gone-runtime-unavailable-style';
  style.textContent = `
    #gone-runtime-unavailable{position:fixed;inset:0;z-index:5000;display:none;align-items:center;justify-content:center;padding:max(20px,env(safe-area-inset-top)) max(20px,env(safe-area-inset-right)) max(20px,env(safe-area-inset-bottom)) max(20px,env(safe-area-inset-left));background:rgba(2,6,23,.94);backdrop-filter:blur(16px);font-family:ui-sans-serif,system-ui,sans-serif;color:#e2e8f0}
    #gone-runtime-unavailable.is-visible{display:flex}
    #gone-runtime-unavailable .gone-runtime-card{width:min(92vw,520px);border:1px solid rgba(248,113,113,.55);border-radius:22px;background:rgba(15,23,42,.98);padding:24px;box-shadow:0 28px 80px rgba(0,0,0,.55)}
    #gone-runtime-unavailable .gone-runtime-eyebrow{font-size:11px;font-weight:900;letter-spacing:.15em;color:#fca5a5;margin-bottom:8px}
    #gone-runtime-unavailable h2{margin:0 0 10px;font-size:24px;line-height:1.1;color:#fff}
    #gone-runtime-unavailable p{margin:0;color:#cbd5e1;font-size:14px;line-height:1.5}
    #gone-runtime-unavailable .gone-runtime-modules{margin:14px 0 0;padding:10px 12px;border-radius:12px;background:rgba(2,6,23,.72);color:#fca5a5;font:700 11px/1.45 ui-monospace,SFMono-Regular,Menlo,monospace;word-break:break-word}
    #gone-runtime-unavailable button{width:100%;min-height:48px;margin-top:18px;border:1px solid rgba(248,113,113,.55);border-radius:14px;background:#991b1b;color:white;font-weight:900;letter-spacing:.08em;cursor:pointer}
  `;
  document.head.appendChild(style);
}

function ensureRoot(): HTMLElement | null {
  if (!document.body) return null;
  ensureStyle();
  let root = document.getElementById('gone-runtime-unavailable');
  if (root) return root;

  root = document.createElement('section');
  root.id = 'gone-runtime-unavailable';
  root.setAttribute('role', 'alertdialog');
  root.setAttribute('aria-modal', 'true');
  root.setAttribute('aria-labelledby', 'gone-runtime-unavailable-title');
  root.innerHTML = `
    <div class="gone-runtime-card">
      <div class="gone-runtime-eyebrow">AVVIO SICURO INTERROTTO</div>
      <h2 id="gone-runtime-unavailable-title">G.O.N.E. non è entrato in modalità gameplay</h2>
      <p>Un componente essenziale non è disponibile. Il client ha bloccato l'avvio invece di continuare in uno stato parzialmente funzionante.</p>
      <div id="gone-runtime-unavailable-modules" class="gone-runtime-modules"></div>
      <button type="button" id="gone-runtime-reload">RICARICA IL CLIENT</button>
    </div>`;
  document.body.appendChild(root);
  document.getElementById('gone-runtime-reload')?.addEventListener('click', () => window.location.reload());
  return root;
}

function render(snapshot: RuntimeHealthSnapshot): void {
  latest = snapshot;
  const root = ensureRoot();
  if (!root) {
    document.addEventListener('DOMContentLoaded', () => {
      if (latest) render(latest);
    }, { once: true });
    return;
  }

  const failedModules = problemModules(snapshot);
  const moduleText = document.getElementById('gone-runtime-unavailable-modules');
  if (moduleText) {
    moduleText.textContent = failedModules.length > 0
      ? `Componenti non disponibili: ${failedModules.join(', ')}`
      : 'Il runtime core non ha raggiunto lo stato ready.';
  }
  root.classList.add('is-visible');
}

function hideIfHealthy(snapshot: RuntimeHealthSnapshot): void {
  latest = snapshot;
  if (snapshot.status !== 'healthy') return;
  document.getElementById('gone-runtime-unavailable')?.classList.remove('is-visible');
}

function snapshot(): AvailabilitySnapshot {
  return {
    visible: document.getElementById('gone-runtime-unavailable')?.classList.contains('is-visible') ?? false,
    status: latest?.status ?? 'unknown',
    failedModules: latest ? problemModules(latest) : [],
  };
}

export function startRuntimeAvailabilityUi(): void {
  if (started) return;
  started = true;

  window.addEventListener('gone-runtime-unavailable', (event) => {
    const detail = (event as CustomEvent<RuntimeHealthSnapshot>).detail;
    if (detail) render(detail);
  });
  window.addEventListener('gone-runtime-health-changed', (event) => {
    const detail = (event as CustomEvent<RuntimeHealthSnapshot>).detail;
    if (detail) hideIfHealthy(detail);
  });

  (window as any).goneRuntimeAvailability = { snapshot };
}

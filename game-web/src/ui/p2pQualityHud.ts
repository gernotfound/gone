import { browserLifecycle } from '../runtime/browserLifecycle.ts';

type HudState = {
  visible: boolean;
  role: 'host' | 'client' | 'none';
  status: string;
  peerCount: number;
  snapshotHz: number | null;
  bufferedBytes: number;
  severity: 'ok' | 'warn' | 'bad';
};

let root: HTMLDivElement | null = null;
let timer: number | null = null;
let current: HudState = {
  visible: false,
  role: 'none',
  status: 'offline',
  peerCount: 0,
  snapshotHz: null,
  bufferedBytes: 0,
  severity: 'ok',
};

function api(): any {
  return (window as any).goneGame;
}

function gameplayVisible(): boolean {
  const gameUi = document.getElementById('game-ui');
  return !!gameUi && !gameUi.classList.contains('hidden');
}

function ensureUi(): HTMLDivElement {
  if (root?.isConnected) return root;
  root = document.createElement('div');
  root.id = 'gone-p2p-quality-hud';
  root.setAttribute('aria-hidden', 'true');
  Object.assign(root.style, {
    position: 'fixed',
    left: '14px',
    bottom: '14px',
    zIndex: '67',
    pointerEvents: 'none',
    minWidth: '168px',
    padding: '7px 9px',
    borderRadius: '8px',
    background: 'rgba(2,6,23,.72)',
    border: '1px solid rgba(34,211,238,.24)',
    color: '#cbd5e1',
    font: '800 10px/1.35 ui-monospace,SFMono-Regular,Menlo,monospace',
    letterSpacing: '.03em',
    boxShadow: '0 0 14px rgba(2,6,23,.35)',
    display: 'none',
  });
  document.body.appendChild(root);
  return root;
}

function formatKb(bytes: number): string {
  const kb = Math.max(0, bytes) / 1024;
  return kb >= 100 ? `${kb.toFixed(0)}KB` : `${kb.toFixed(1)}KB`;
}

function collect(): HudState {
  const game = api();
  const host = game?.getP2PHost?.();
  const client = game?.getP2PClient?.();
  const network = (window as any).goneNetworkQuality?.snapshot?.() ?? {};

  if (host) {
    const peers = host.peers instanceof Map ? host.peers : new Map();
    let openPeers = 0;
    let bufferedBytes = 0;
    for (const peer of peers.values()) {
      const channel = (peer as any)?.channel;
      if (!channel || channel.readyState !== 'open') continue;
      openPeers += 1;
      bufferedBytes += Math.max(0, Number(channel.bufferedAmount ?? 0) || 0);
    }

    const rateHz = Math.max(1, Number(network.rateHz ?? 30) || 30);
    const severity: HudState['severity'] = bufferedBytes >= 512 * 1024 || rateHz <= 20
      ? 'bad'
      : bufferedBytes >= 128 * 1024 || rateHz < 30
        ? 'warn'
        : 'ok';

    return {
      visible: gameplayVisible(),
      role: 'host',
      status: String(network.reason ?? '30 HZ · NORMALE'),
      peerCount: openPeers,
      snapshotHz: rateHz,
      bufferedBytes,
      severity,
    };
  }

  if (client) {
    const channel = client.channel;
    const bufferedBytes = Math.max(0, Number(channel?.bufferedAmount ?? 0) || 0);
    const status = String(client.status ?? channel?.readyState ?? 'unknown').toLowerCase();
    const connected = status === 'connected' || channel?.readyState === 'open';
    const severity: HudState['severity'] = !connected
      ? 'bad'
      : bufferedBytes >= 192 * 1024
        ? 'bad'
        : bufferedBytes >= 64 * 1024
          ? 'warn'
          : 'ok';

    return {
      visible: gameplayVisible(),
      role: 'client',
      status: connected ? 'CONNECTED' : status.toUpperCase(),
      peerCount: connected ? 1 : 0,
      snapshotHz: null,
      bufferedBytes,
      severity,
    };
  }

  return {
    visible: false,
    role: 'none',
    status: 'offline',
    peerCount: 0,
    snapshotHz: null,
    bufferedBytes: 0,
    severity: 'ok',
  };
}

function render(): void {
  current = collect();
  const node = ensureUi();
  node.style.display = current.visible && current.role !== 'none' ? 'block' : 'none';
  if (node.style.display === 'none') return;

  const accent = current.severity === 'bad' ? '#fb7185' : current.severity === 'warn' ? '#fbbf24' : '#34d399';
  const glow = current.severity === 'bad' ? 'rgba(251,113,133,.14)' : current.severity === 'warn' ? 'rgba(251,191,36,.12)' : 'rgba(52,211,153,.10)';
  node.style.borderColor = accent;
  node.style.boxShadow = `0 0 14px ${glow}`;

  if (current.role === 'host') {
    node.innerHTML = `<div style="color:${accent};font-size:10px;letter-spacing:.11em">P2P HOST · ${current.snapshotHz ?? 30} HZ</div><div>${current.peerCount} PEER · TX ${formatKb(current.bufferedBytes)}</div><div style="color:#64748b;font-size:9px">${current.status}</div>`;
  } else {
    node.innerHTML = `<div style="color:${accent};font-size:10px;letter-spacing:.11em">P2P GUEST · ${current.status}</div><div>TX ${formatKb(current.bufferedBytes)}</div><div style="color:#64748b;font-size:9px">DIRECT WEBRTC</div>`;
  }
}

function stopTimer(): void {
  if (timer !== null) window.clearInterval(timer);
  timer = null;
}

export function startP2PQualityHud(): void {
  if ((window as any).__goneP2PQualityHudStarted) return;
  (window as any).__goneP2PQualityHudStarted = true;
  ensureUi();
  render();
  timer = window.setInterval(render, 400);
  browserLifecycle.subscribe('beforeunload', 'p2pQualityHud', stopTimer, 5);

  (window as any).goneP2PQualityHud = {
    snapshot: () => ({ ...current }),
  };
}

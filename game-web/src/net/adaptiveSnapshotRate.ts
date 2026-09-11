type PeerStats = {
  openPeers: number;
  totalBufferedBytes: number;
  maxBufferedBytes: number;
};

type AdaptiveNetworkState = {
  rateHz: number;
  pressureStreak: number;
  stableStreak: number;
  lowers: number;
  raises: number;
  totalBufferedBytes: number;
  maxBufferedBytes: number;
  openPeers: number;
  reason: string;
};

const BASE_RATE_HZ = 30;
const MID_RATE_HZ = 24;
const LOW_RATE_HZ = 20;
const CHECK_INTERVAL_MS = 2000;
const MODERATE_PEER_BUFFER = 96 * 1024;
const HEAVY_PEER_BUFFER = 192 * 1024;
const MODERATE_TOTAL_BUFFER = 256 * 1024;
const HEAVY_TOTAL_BUFFER = 512 * 1024;
const STABLE_PEER_BUFFER = 32 * 1024;
const STABLE_TOTAL_BUFFER = 64 * 1024;

let activeHost: any = null;
let rateHz = BASE_RATE_HZ;
let pressureStreak = 0;
let stableStreak = 0;
let lowers = 0;
let raises = 0;
let lastStats: PeerStats = { openPeers: 0, totalBufferedBytes: 0, maxBufferedBytes: 0 };
let reason = '30 HZ · NORMALE';
let timer: number | null = null;

function getHost(): any {
  return (window as any).goneGame?.getP2PHost?.() ?? null;
}

function collectPeerStats(host: any): PeerStats {
  const peers = host?.peers;
  if (!(peers instanceof Map)) {
    return { openPeers: 0, totalBufferedBytes: 0, maxBufferedBytes: 0 };
  }

  let openPeers = 0;
  let totalBufferedBytes = 0;
  let maxBufferedBytes = 0;

  for (const peer of peers.values()) {
    const channel = (peer as any)?.channel;
    if (!channel || channel.readyState !== 'open') continue;
    const buffered = Math.max(0, Number(channel.bufferedAmount ?? 0) || 0);
    openPeers += 1;
    totalBufferedBytes += buffered;
    maxBufferedBytes = Math.max(maxBufferedBytes, buffered);
  }

  return { openPeers, totalBufferedBytes, maxBufferedBytes };
}

function applyRate(host: any, nextRateHz: number, nextReason: string): void {
  if (!host || typeof host.startSnapshotTick !== 'function') return;
  if (nextRateHz === rateHz) {
    reason = nextReason;
    return;
  }

  rateHz = nextRateHz;
  reason = nextReason;
  host.startSnapshotTick(rateHz);
  window.dispatchEvent(new CustomEvent('gone-snapshot-rate-changed', {
    detail: { rateHz, reason },
  }));
}

function resetForHost(host: any): void {
  activeHost = host;
  rateHz = BASE_RATE_HZ;
  pressureStreak = 0;
  stableStreak = 0;
  lastStats = { openPeers: 0, totalBufferedBytes: 0, maxBufferedBytes: 0 };
  reason = host ? '30 HZ · NORMALE' : 'NESSUN HOST';
}

function evaluate(): void {
  const host = getHost();
  if (host !== activeHost) resetForHost(host);
  if (!host) return;

  const stats = collectPeerStats(host);
  lastStats = stats;

  if (stats.openPeers === 0) {
    pressureStreak = 0;
    stableStreak += 1;
    if (rateHz !== BASE_RATE_HZ) {
      applyRate(host, BASE_RATE_HZ, '30 HZ · NESSUN PEER IN PRESSIONE');
      raises += 1;
    } else {
      reason = '30 HZ · IN ATTESA PEER';
    }
    return;
  }

  const heavy = stats.maxBufferedBytes >= HEAVY_PEER_BUFFER
    || stats.totalBufferedBytes >= HEAVY_TOTAL_BUFFER;
  const moderate = heavy
    || stats.maxBufferedBytes >= MODERATE_PEER_BUFFER
    || stats.totalBufferedBytes >= MODERATE_TOTAL_BUFFER;
  const stable = stats.maxBufferedBytes <= STABLE_PEER_BUFFER
    && stats.totalBufferedBytes <= STABLE_TOTAL_BUFFER;

  if (moderate) {
    pressureStreak += 1;
    stableStreak = 0;
  } else if (stable) {
    stableStreak += 1;
    pressureStreak = 0;
  } else {
    pressureStreak = Math.max(0, pressureStreak - 1);
    stableStreak = 0;
  }

  if (pressureStreak >= 2) {
    pressureStreak = 0;
    const target = heavy ? LOW_RATE_HZ : MID_RATE_HZ;
    if (target < rateHz) {
      lowers += 1;
      applyRate(
        host,
        target,
        `${target} HZ · BACKPRESSURE ${(stats.maxBufferedBytes / 1024).toFixed(0)} KB/PEER`,
      );
      return;
    }
  }

  if (stableStreak >= 4 && rateHz < BASE_RATE_HZ) {
    stableStreak = 0;
    const target = rateHz <= LOW_RATE_HZ ? MID_RATE_HZ : BASE_RATE_HZ;
    raises += 1;
    applyRate(host, target, `${target} HZ · RECUPERO RETE`);
    return;
  }

  if (moderate) {
    reason = `${rateHz} HZ · PRESSIONE ${pressureStreak}/2`;
  } else if (rateHz < BASE_RATE_HZ) {
    reason = `${rateHz} HZ · RECUPERO ${stableStreak}/4`;
  } else {
    reason = '30 HZ · NORMALE';
  }
}

function snapshot(): AdaptiveNetworkState {
  return {
    rateHz,
    pressureStreak,
    stableStreak,
    lowers,
    raises,
    totalBufferedBytes: lastStats.totalBufferedBytes,
    maxBufferedBytes: lastStats.maxBufferedBytes,
    openPeers: lastStats.openPeers,
    reason,
  };
}

/**
 * Keeps normal host snapshots at 30 Hz, but backs off conservatively to 24/20
 * Hz when WebRTC send queues remain congested. It never changes packet format,
 * never touches guest state cadence and slowly restores 30 Hz after recovery.
 */
export function startAdaptiveSnapshotRate(): void {
  if ((window as any).__goneAdaptiveSnapshotRateStarted) return;
  (window as any).__goneAdaptiveSnapshotRateStarted = true;

  (window as any).goneNetworkQuality = {
    snapshot: () => ({ ...snapshot() }),
  };

  timer = window.setInterval(evaluate, CHECK_INTERVAL_MS);
  window.addEventListener('beforeunload', () => {
    if (timer !== null) window.clearInterval(timer);
    timer = null;
  }, { once: true });
}

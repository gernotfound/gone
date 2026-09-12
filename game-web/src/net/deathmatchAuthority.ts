import { P2PClient } from './p2pClient.ts';
import type { CombatHitEventDetail } from './combatEventBridge.ts';
import {
  DEATHMATCH_TARGET_KILLS,
  decodeDeathmatchSnapshot,
  encodeDeathmatchSnapshot,
  type DeathmatchScoreRow,
  type DeathmatchSnapshot,
} from './deathmatchProtocol.ts';

export type DeathmatchSyncEventDetail = {
  source: 'host' | 'client';
  snapshot: DeathmatchSnapshot;
  at: number;
};

type HostState = {
  host: any;
  round: number;
  winnerSlot: number | null;
  resetAt: number;
  rows: Map<number, DeathmatchScoreRow>;
  owners: Map<number, string>;
  lastRosterSignature: string;
  lastBroadcastAt: number;
};

const CLIENT_MARKER = '__goneDeathmatchAuthorityClient';
const ROUND_RESET_DELAY_MS = 7000;
const RECOVERY_BROADCAST_MS = 1000;
const CHECK_INTERVAL_MS = 250;
let hostState: HostState | null = null;
let lastClientSnapshot: DeathmatchSnapshot | null = null;
let packetsSent = 0;
let packetsReceived = 0;
let queuedBroadcast = false;

function gameApi(): any {
  return (window as any).goneGame;
}

function emptyRow(slot: number): DeathmatchScoreRow {
  return { slot, kills: 0, deaths: 0, damage: 0, headshots: 0 };
}

function cloneSnapshot(snapshot: DeathmatchSnapshot): DeathmatchSnapshot {
  return { ...snapshot, rows: snapshot.rows.map((row) => ({ ...row })) };
}

function emit(source: 'host' | 'client', snapshot: DeathmatchSnapshot): void {
  window.dispatchEvent(new CustomEvent<DeathmatchSyncEventDetail>('gone-deathmatch-sync', {
    detail: { source, snapshot: cloneSnapshot(snapshot), at: performance.now() },
  }));
}

function roster(host: any): Array<{ slot: number; id: string }> {
  const entries: Array<{ slot: number; id: string }> = [];
  for (const record of host?.playerRecords?.values?.() ?? []) {
    const slot = Number(record?.slot);
    const id = String(record?.id ?? '');
    if (Number.isInteger(slot) && slot >= 0 && slot < 16 && id) entries.push({ slot, id });
  }
  entries.sort((a, b) => a.slot - b.slot);
  return entries;
}

function syncRoster(state: HostState): boolean {
  const current = roster(state.host);
  const signature = current.map((entry) => `${entry.slot}:${entry.id}`).join('|');
  if (signature === state.lastRosterSignature) return false;

  const activeSlots = new Set<number>();
  let winnerOwnerChanged = false;
  for (const entry of current) {
    activeSlots.add(entry.slot);
    const previousOwner = state.owners.get(entry.slot);
    if (previousOwner !== entry.id) {
      if (state.winnerSlot === entry.slot && previousOwner !== undefined) winnerOwnerChanged = true;
      state.owners.set(entry.slot, entry.id);
      state.rows.set(entry.slot, emptyRow(entry.slot));
    }
  }

  for (const slot of Array.from(state.rows.keys())) {
    if (!activeSlots.has(slot)) {
      if (state.winnerSlot === slot) winnerOwnerChanged = true;
      state.rows.delete(slot);
      state.owners.delete(slot);
    }
  }

  state.lastRosterSignature = signature;
  if (winnerOwnerChanged) resetRound(state);
  return true;
}

function rowFor(state: HostState, slot: number): DeathmatchScoreRow {
  let row = state.rows.get(slot);
  if (!row) {
    row = emptyRow(slot);
    state.rows.set(slot, row);
  }
  return row;
}

function snapshotFor(state: HostState): DeathmatchSnapshot {
  return {
    round: state.round,
    targetKills: DEATHMATCH_TARGET_KILLS,
    winnerSlot: state.winnerSlot,
    resetRemainingMs: state.winnerSlot === null ? 0 : Math.max(0, Math.round(state.resetAt - performance.now())),
    rows: [...state.rows.values()].sort((a, b) => a.slot - b.slot).map((row) => ({ ...row })),
  };
}

function broadcast(state: HostState): void {
  const snapshot = snapshotFor(state);
  state.host?.broadcastBinary?.(encodeDeathmatchSnapshot(snapshot));
  state.lastBroadcastAt = performance.now();
  packetsSent += 1;
  emit('host', snapshot);
}

function scheduleBroadcast(): void {
  if (queuedBroadcast) return;
  queuedBroadcast = true;
  queueMicrotask(() => {
    queuedBroadcast = false;
    const host = gameApi()?.getP2PHost?.();
    if (hostState && hostState.host === host) broadcast(hostState);
  });
}

function resetRound(state: HostState): void {
  state.round = state.round >= 0xffff ? 1 : state.round + 1;
  state.winnerSlot = null;
  state.resetAt = 0;
  for (const slot of state.rows.keys()) state.rows.set(slot, emptyRow(slot));
}

function createHostState(host: any): HostState {
  const state: HostState = {
    host,
    round: 1,
    winnerSlot: null,
    resetAt: 0,
    rows: new Map<number, DeathmatchScoreRow>(),
    owners: new Map<number, string>(),
    lastRosterSignature: '',
    lastBroadcastAt: 0,
  };
  syncRoster(state);
  return state;
}

function ingestHostHit(detail: CombatHitEventDetail): void {
  if (detail.source !== 'host') return;
  const host = gameApi()?.getP2PHost?.();
  if (!host) return;
  if (!hostState || hostState.host !== host) hostState = createHostState(host);
  const state = hostState;
  if (state.winnerSlot !== null) return;

  const hit = detail.hit;
  const shooter = rowFor(state, hit.shooterSlot);
  const victim = rowFor(state, hit.victimSlot);
  if (!hit.isShieldBlocked) {
    shooter.damage += Math.max(0, Number(hit.damage) || 0);
    if (hit.isHeadshot) shooter.headshots += 1;
  }
  if (hit.isFatalKill || hit.isFatal) {
    shooter.kills += 1;
    victim.deaths += 1;
    if (shooter.kills >= DEATHMATCH_TARGET_KILLS) {
      state.winnerSlot = shooter.slot;
      state.resetAt = performance.now() + ROUND_RESET_DELAY_MS;
    }
  }
  scheduleBroadcast();
}

function patchClientProtocol(): void {
  const proto = P2PClient.prototype as any;
  if (proto[CLIENT_MARKER]) return;
  proto[CLIENT_MARKER] = true;
  const original = proto.handleMessage;
  if (typeof original !== 'function') return;

  proto.handleMessage = function(rawData: unknown) {
    const snapshot = decodeDeathmatchSnapshot(rawData);
    if (snapshot) {
      packetsReceived += 1;
      lastClientSnapshot = cloneSnapshot(snapshot);
      emit('client', snapshot);
      return;
    }
    return original.call(this, rawData);
  };
}

function tick(): void {
  const host = gameApi()?.getP2PHost?.();
  if (!host) {
    hostState = null;
    return;
  }

  if (!hostState || hostState.host !== host) {
    hostState = createHostState(host);
    broadcast(hostState);
    return;
  }

  const state = hostState;
  const rosterChanged = syncRoster(state);
  if (state.winnerSlot !== null && performance.now() >= state.resetAt) {
    resetRound(state);
    broadcast(state);
    return;
  }

  if (rosterChanged || performance.now() - state.lastBroadcastAt >= RECOVERY_BROADCAST_MS) broadcast(state);
}

export function startDeathmatchAuthority(): void {
  if ((window as any).__goneDeathmatchAuthorityStarted) return;
  (window as any).__goneDeathmatchAuthorityStarted = true;
  patchClientProtocol();
  window.addEventListener('gone-hit-confirmed', ((event: CustomEvent<CombatHitEventDetail>) => {
    ingestHostHit(event.detail);
  }) as EventListener);
  window.setInterval(tick, CHECK_INTERVAL_MS);

  (window as any).goneDeathmatchAuthority = {
    snapshot: () => {
      if (hostState) return cloneSnapshot(snapshotFor(hostState));
      return lastClientSnapshot ? cloneSnapshot(lastClientSnapshot) : null;
    },
    reset: () => {
      const host = gameApi()?.getP2PHost?.();
      if (!host || !hostState || hostState.host !== host) return false;
      resetRound(hostState);
      broadcast(hostState);
      return true;
    },
    stats: () => ({ packetsSent, packetsReceived }),
  };
}

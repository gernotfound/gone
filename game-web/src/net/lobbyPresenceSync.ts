import type { IDataChannel, SessionPlayerInfo } from './protocol.ts';

const IDENTITY_OPCODE = 0x1e;
const IDENTITY_VERSION = 1;
const MAX_NAME_CHARS = 15;
const encoder = new TextEncoder();
const decoder = new TextDecoder();
let lastHostPresenceBroadcastAt = 0;

interface PresencePacket { id: string; name: string; color: string; }

function sanitizeName(value: string): string {
  const clean = String(value ?? '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, MAX_NAME_CHARS);
  return clean || 'Giocatore';
}

function writeString(view: DataView, offset: number, value: string): number {
  const bytes = encoder.encode(value);
  const length = Math.min(255, bytes.length);
  view.setUint8(offset, length);
  new Uint8Array(view.buffer, offset + 1, length).set(bytes.subarray(0, length));
  return offset + 1 + length;
}

function readString(view: DataView, offset: number): { value: string; offset: number } {
  const length = view.getUint8(offset);
  const next = offset + 1 + length;
  if (next > view.byteLength) throw new Error('Presence packet truncated');
  return { value: decoder.decode(new Uint8Array(view.buffer, view.byteOffset + offset + 1, length)), offset: next };
}

function encodePresence(packet: PresencePacket): ArrayBuffer {
  const buffer = new ArrayBuffer(768);
  const view = new DataView(buffer);
  view.setUint8(0, IDENTITY_OPCODE);
  view.setUint8(1, IDENTITY_VERSION);
  let offset = 2;
  offset = writeString(view, offset, packet.id);
  offset = writeString(view, offset, sanitizeName(packet.name));
  offset = writeString(view, offset, packet.color);
  return buffer.slice(0, offset);
}

function decodePresence(raw: unknown): PresencePacket | null {
  if (!(raw instanceof ArrayBuffer) && !ArrayBuffer.isView(raw as any)) return null;
  const view = raw instanceof ArrayBuffer
    ? new DataView(raw)
    : new DataView((raw as ArrayBufferView).buffer, (raw as ArrayBufferView).byteOffset, (raw as ArrayBufferView).byteLength);
  if (view.byteLength < 5 || view.getUint8(0) !== IDENTITY_OPCODE || view.getUint8(1) !== IDENTITY_VERSION) return null;
  try {
    let offset = 2;
    const id = readString(view, offset); offset = id.offset;
    const name = readString(view, offset); offset = name.offset;
    const color = readString(view, offset);
    return { id: id.value, name: sanitizeName(name.value), color: color.value };
  } catch { return null; }
}

function renderPlayers(players: SessionPlayerInfo[], hostId?: string): void {
  const list = document.getElementById('lobby-player-list');
  if (!list) return;
  list.innerHTML = '';
  const ordered = [...players].sort((a, b) => {
    if (a.id === hostId) return -1;
    if (b.id === hostId) return 1;
    return (a.slot ?? 255) - (b.slot ?? 255);
  });

  for (const player of ordered) {
    const li = document.createElement('li');
    li.className = 'flex items-center justify-between bg-slate-900/50 p-3 rounded-lg border border-slate-700/50';
    const left = document.createElement('div');
    left.className = 'flex items-center gap-3 min-w-0';
    const dot = document.createElement('div');
    dot.className = 'w-4 h-4 rounded-full shrink-0';
    dot.style.backgroundColor = player.color;
    dot.style.boxShadow = `0 0 8px ${player.color}`;
    const name = document.createElement('span');
    name.className = 'text-white font-bold tracking-wider truncate';
    name.textContent = player.name;
    left.append(dot, name);
    li.appendChild(left);
    if (player.id === hostId || player.slot === 0) {
      const badge = document.createElement('span');
      badge.className = 'text-xs font-black text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30 shrink-0';
      badge.textContent = 'HOST / SERVER';
      li.appendChild(badge);
    }
    list.appendChild(li);
  }
}

function currentApi(): any { return (window as any).goneGame; }
function toPresence(player: SessionPlayerInfo): PresencePacket {
  return { id: player.id, name: sanitizeName(player.name), color: player.color };
}

function broadcastAllPresence(host: any): void {
  const players: SessionPlayerInfo[] = host.getAllSessionPlayers?.() ?? [];
  for (const player of players) host.broadcastBinary?.(encodePresence(toPresence(player)));
}

function patchHost(host: any): void {
  if (host.__presenceSyncPatched) return;
  host.__presenceSyncPatched = true;
  const original = host.handleChannelMessage.bind(host);
  host.handleChannelMessage = (peerId: string, channel: IDataChannel, raw: unknown) => {
    const packet = decodePresence(raw);
    if (!packet) { original(peerId, channel, raw); return; }
    if (packet.id !== peerId) return;

    const peer = host.peers?.get(peerId);
    const record = host.playerRecords?.get(peerId);
    if (!peer || !record) return;
    const name = sanitizeName(packet.name);
    peer.info.name = name;
    record.name = name;
    // Never trust guest-provided color here. COLOR_REQUEST remains authoritative.
    host.broadcastBinary?.(encodePresence({ id: peerId, name, color: peer.info.color }));
  };
}

function patchClient(client: any): void {
  if (client.__presenceSyncPatched) return;
  client.__presenceSyncPatched = true;
  const original = client.handleMessage.bind(client);
  client.handleMessage = (raw: unknown) => {
    const packet = decodePresence(raw);
    if (!packet) { original(raw); return; }
    let player = client.sessionPlayers.find((item: SessionPlayerInfo) => item.id === packet.id);
    if (!player) {
      player = { id: packet.id, name: packet.name, color: packet.color };
      client.sessionPlayers.push(player);
    } else {
      player.name = packet.name;
      player.color = packet.color;
    }
    renderPlayers(client.sessionPlayers, client.sessionPlayers.find((p: SessionPlayerInfo) => p.slot === 0)?.id);
  };
}

function sendGuestPresence(client: any): void {
  if (client?.status !== 'connected' || !client.channel) return;
  const me = client.sessionPlayers.find((p: SessionPlayerInfo) => p.id === client.playerId);
  const input = document.getElementById('player-username') as HTMLInputElement | null;
  const packet: PresencePacket = {
    id: client.playerId,
    name: sanitizeName(input?.value || client.playerName),
    color: me?.color || client.assignedColor || client.proposedColor || '#00F0FF',
  };
  client.playerName = packet.name;
  try { client.channel.send(encodePresence(packet)); } catch { /* normal transport teardown will report disconnect */ }
}

function reconcileLobby(): void {
  const lobby = document.getElementById('multiplayer-lobby');
  if (!lobby || lobby.classList.contains('hidden')) return;
  const game = currentApi();
  const host = game?.getP2PHost?.();
  const client = game?.getP2PClient?.();

  if (host) {
    patchHost(host);
    const players = host.getAllSessionPlayers?.() ?? [];
    renderPlayers(players, host.hostPlayer.id);
    const now = performance.now();
    if (now - lastHostPresenceBroadcastAt >= 1000) {
      lastHostPresenceBroadcastAt = now;
      broadcastAllPresence(host);
    }
  } else if (client) {
    patchClient(client);
    renderPlayers(client.sessionPlayers ?? [], client.sessionPlayers?.find((p: SessionPlayerInfo) => p.slot === 0)?.id);
  }
}

function emitLocalPresence(): void {
  window.setTimeout(() => {
    const game = currentApi();
    const host = game?.getP2PHost?.();
    const client = game?.getP2PClient?.();
    if (host) {
      patchHost(host);
      broadcastAllPresence(host);
      renderPlayers(host.getAllSessionPlayers?.() ?? [], host.hostPlayer.id);
    } else if (client) {
      patchClient(client);
      sendGuestPresence(client);
    }
  }, 0);
}

export function startLobbyPresenceSync(): void {
  if ((window as any).__goneLobbyPresenceSyncStarted) return;
  (window as any).__goneLobbyPresenceSyncStarted = true;
  document.getElementById('player-username')?.addEventListener('input', emitLocalPresence);
  document.getElementById('color-picker-container')?.addEventListener('click', emitLocalPresence);
  window.setInterval(reconcileLobby, 250);
}

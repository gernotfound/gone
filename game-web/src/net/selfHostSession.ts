import { DOM } from '../ui/dom.ts';
import {
  activeP2PHost,
  localPlayerColor,
  setActiveP2PClient,
  setLocalPlayerColor,
  setupLobby,
} from '../ui/lobby.ts';
import { P2PClient } from './p2pClient.ts';
import { createRelayGuestChannel, createRelayHostBridge, type RelayHostBridge } from './relayWebSocket.ts';
import type { SessionPlayerInfo } from './protocol.ts';

interface SelfHostLocation {
  role: 'host' | 'guest';
  token: string;
}

interface HostStatus {
  port: number;
  mapped: boolean;
  cgnat: boolean;
  publicInviteUrl?: string | null;
  lanInviteUrl?: string | null;
}

let relayHostBridge: RelayHostBridge | null = null;
let relayGuestChannel: { close?: () => void } | null = null;
let inviteGuardTimer: number | null = null;

function parseLocation(): SelfHostLocation | null {
  const params = new URLSearchParams(window.location.search);
  const role = params.get('goneHost');
  const token = params.get('token')?.trim() || '';
  if ((role !== 'host' && role !== 'guest') || token.length < 16) return null;
  return { role, token };
}

function openLobbyShell(): void {
  DOM.mainMenu.classList.add('hidden');
  DOM.multiplayerLobby.classList.remove('hidden');
  DOM.multiplayerLobby.classList.add('flex');
}

function setGuestButton(text: string, error = false): void {
  DOM.btnPlayMultiplayer.textContent = text;
  DOM.btnPlayMultiplayer.disabled = true;
  DOM.btnPlayMultiplayer.className = error
    ? 'w-2/3 bg-red-950/70 cursor-not-allowed text-red-200 font-black text-base py-3 rounded-xl shadow-md uppercase tracking-widest border border-red-700'
    : 'w-2/3 bg-slate-700 cursor-not-allowed text-white font-black text-base py-3 rounded-xl shadow-md uppercase tracking-widest border border-slate-600';
}

function renderPlayers(players: SessionPlayerInfo[], localId: string): void {
  DOM.lobbyPlayerList.innerHTML = '';
  players.forEach((player, index) => {
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
    name.textContent = player.id === localId ? `${player.name} (TU)` : player.name;
    left.append(dot, name);
    li.appendChild(left);

    if (index === 0 || player.slot === 0) {
      const badge = document.createElement('span');
      badge.className = 'text-xs font-black text-purple-400 bg-purple-900/30 px-2 py-1 rounded border border-purple-500/30 shrink-0';
      badge.textContent = 'HOST / SERVER';
      li.appendChild(badge);
    }
    DOM.lobbyPlayerList.appendChild(li);
  });
}

function guardClientRenderingUntilGameplay(client: P2PClient): void {
  const snapshot = client.config.onWorldSnapshot;
  const hit = client.config.onHitConfirmed;
  const legacyShot = client.config.onHitscanFired;
  const binaryShot = client.config.onBinaryHitscanFired;
  const ready = () => !DOM.gameCanvas.classList.contains('hidden');

  if (snapshot) client.config.onWorldSnapshot = (value) => { if (ready()) snapshot(value); };
  if (hit) client.config.onHitConfirmed = (value) => { if (ready()) hit(value); };
  if (legacyShot) client.config.onHitscanFired = (value) => { if (ready()) legacyShot(value); };
  if (binaryShot) client.config.onBinaryHitscanFired = (value) => { if (ready()) binaryShot(value); };
}

function closeRelaySession(): void {
  if (inviteGuardTimer !== null) {
    window.clearInterval(inviteGuardTimer);
    inviteGuardTimer = null;
  }
  relayHostBridge?.close();
  relayHostBridge = null;
  try { relayGuestChannel?.close?.(); } catch { /* no-op */ }
  relayGuestChannel = null;
}

async function fetchHostStatus(): Promise<HostStatus | null> {
  try {
    const response = await fetch('/__gone_host/status', { cache: 'no-store' });
    if (!response.ok) return null;
    return await response.json() as HostStatus;
  } catch {
    return null;
  }
}

async function setupHost(token: string, onPlayMultiplayer: () => void): Promise<void> {
  openLobbyShell();
  setupLobby(true, undefined, onPlayMultiplayer);
  document.getElementById('direct-host-controls')?.remove();

  const host = activeP2PHost;
  if (!host) throw new Error('Host autorevole non inizializzato.');

  const status = await fetchHostStatus();
  const fallback = new URL(window.location.href);
  fallback.search = '';
  fallback.hash = '';
  fallback.searchParams.set('goneHost', 'guest');
  fallback.searchParams.set('token', token);
  const invite = status?.publicInviteUrl || status?.lanInviteUrl || fallback.toString();

  const setInvite = () => {
    DOM.inviteLinkContainer.classList.remove('hidden');
    const label = DOM.inviteLinkContainer.querySelector('label');
    if (label) label.textContent = 'INVITO G.O.N.E. HOST — INVIALO AGLI AMICI';
    DOM.inviteLinkInput.value = invite;
    DOM.btnCopyLink.textContent = 'COPIA INVITO';
  };
  setInvite();
  inviteGuardTimer = window.setInterval(setInvite, 500);

  const info = document.createElement('div');
  info.id = 'self-host-status';
  info.className = 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs leading-relaxed text-emerald-200';
  info.textContent = status?.mapped
    ? `G.O.N.E. HOST ATTIVO SULLA PORTA ${status.port}. IL PC DELL’HOST È IL SERVER.`
    : status?.cgnat
      ? 'G.O.N.E. HOST ATTIVO IN LAN. IL ROUTER/ISP SEMBRA USARE CGNAT: PER INTERNET SERVE UN IP PUBBLICO O IPv6 RAGGIUNGIBILE.'
      : 'G.O.N.E. HOST ATTIVO. UPnP NON HA APERTO LA PORTA: USA L’INVITO LAN O INOLTRA MANUALMENTE LA PORTA TCP DEL SERVER.';
  DOM.inviteLinkContainer.appendChild(info);

  relayHostBridge = createRelayHostBridge({
    token,
    onPeer: (peerId, channel) => {
      if (!activeP2PHost) {
        channel.close?.();
        return;
      }
      activeP2PHost.registerPeer(peerId, channel);
    },
    onReady: () => {
      info.textContent = `${info.textContent} BRIDGE WEBSOCKET PRONTO.`;
    },
    onError: (error) => {
      console.error('[G.O.N.E. self-host]', error);
      info.textContent = `ERRORE BRIDGE: ${error.message}`;
      info.className = 'mt-3 rounded-xl border border-red-500/40 bg-red-950/20 p-3 text-xs text-red-200';
    },
  });
}

function makeGuestId(): string {
  const id = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `guest-${id}`;
}

function setupGuest(token: string, onPlayMultiplayer: () => void): void {
  openLobbyShell();
  setupLobby(false, undefined, onPlayMultiplayer);
  DOM.inviteLinkContainer.classList.add('hidden');

  const localId = makeGuestId();
  const playerName = DOM.playerUsernameInput.value.trim() || 'Giocatore';
  let players: SessionPlayerInfo[] = [];

  const client = new P2PClient({
    playerId: localId,
    playerName,
    onJoinAccepted: (data) => {
      setLocalPlayerColor(data.assignedColor);
      players = data.sessionPlayers.map((p) => ({ ...p }));
      renderPlayers(players, localId);
      setGuestButton('IN ATTESA DELL\'HOST...');
    },
    onColorRejected: (data) => {
      const next = data.availableColors?.find((color) => color !== localPlayerColor);
      if (next) {
        setLocalPlayerColor(next);
        window.setTimeout(() => {
          if (client.status === 'rejected') client.retryWithColor(next);
        }, 60);
      } else {
        setGuestButton('NESSUN COLORE DISPONIBILE', true);
      }
    },
    onPlayerJoined: (player) => {
      if (!players.some((p) => p.id === player.id)) players.push({ ...player });
      renderPlayers(players, localId);
    },
    onPlayerLeft: ({ playerId }) => {
      players = players.filter((p) => p.id !== playerId);
      (window as any).goneGame?.removeRemotePlayer?.(playerId);
      renderPlayers(players, localId);
    },
    onColorChanged: ({ playerId, newColor }) => {
      const entry = players.find((p) => p.id === playerId);
      if (entry) entry.color = newColor;
      if (playerId === localId) setLocalPlayerColor(newColor);
      renderPlayers(players, localId);
    },
    onStatusChange: (status) => {
      if (status === 'connecting') setGuestButton('CONNESSIONE AL PC HOST...');
      if (status === 'disconnected') setGuestButton('HOST DISCONNESSO', true);
    },
    onGameStart: () => {
      DOM.multiplayerLobby.classList.remove('flex');
      DOM.multiplayerLobby.classList.add('hidden');
      onPlayMultiplayer();
    },
    onError: (error) => {
      console.error('[G.O.N.E. relay client]', error);
      setGuestButton('ERRORE DI RETE', true);
    },
  });

  setActiveP2PClient(client);
  (window as any).goneGame?.setP2PClient?.(client);
  guardClientRenderingUntilGameplay(client);

  const channel = createRelayGuestChannel(token, localId);
  relayGuestChannel = channel;
  client.connect(channel, localPlayerColor);
  setGuestButton('CONNESSIONE AL PC HOST...');
}

/**
 * Returns true when the current URL belongs to a local G.O.N.E. Host session.
 * In that case this function owns the lobby bootstrap and the caller should not
 * execute the direct WebRTC invite path.
 */
export function setupSelfHostedSessionFromLocation(onPlayMultiplayer: () => void): boolean {
  const config = parseLocation();
  if (!config) return false;

  closeRelaySession();
  if (config.role === 'host') {
    setupHost(config.token, onPlayMultiplayer).catch((error) => {
      console.error('[G.O.N.E. self-host]', error);
      openLobbyShell();
      setGuestButton('ERRORE G.O.N.E. HOST', true);
    });
  } else {
    setupGuest(config.token, onPlayMultiplayer);
  }

  DOM.btnBackLobby.addEventListener('click', closeRelaySession, { once: true });
  window.addEventListener('pagehide', closeRelaySession, { once: true });
  return true;
}

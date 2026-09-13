import { DOM } from '../ui/dom.ts';
import { setupLobby } from '../ui/lobby.ts';
import {
  localPlayerColor,
  multiplayerSessionController,
} from './multiplayerSessionController.ts';
import { createRelayGuestChannel, createRelayHostBridge, type RelayHostBridge } from './relayWebSocket.ts';

interface SelfHostLocation {
  role: 'host' | 'guest';
  token: string;
}

interface HostStatus {
  port: number;
  externalPort?: number;
  mapped: boolean;
  cgnat: boolean;
  publicInviteUrl?: string | null;
  ipv6InviteUrl?: string | null;
  lanInviteUrl?: string | null;
}

let relayHostBridge: RelayHostBridge | null = null;
let relayGuestChannel: { close?: () => void } | null = null;
let inviteGuardTimer: number | null = null;

function parseLocation(): SelfHostLocation | null {
  const query = new URLSearchParams(window.location.search);
  const fragment = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  const role = query.get('goneHost');
  const token = fragment.get('token')?.trim() || '';
  if ((role !== 'host' && role !== 'guest') || token.length < 16) return null;
  return { role, token };
}

function openLobbyShell(): void {
  DOM.mainMenu.classList.add('hidden');
  DOM.multiplayerLobby.classList.remove('hidden');
  DOM.multiplayerLobby.classList.add('flex');
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
  setupLobby(true, undefined, onPlayMultiplayer, { prepareDirectInvite: false });

  const host = multiplayerSessionController.getHost();
  if (!host) throw new Error('Host autorevole non inizializzato.');

  const status = await fetchHostStatus();
  const fallback = new URL(window.location.href);
  fallback.search = '';
  fallback.hash = '';
  fallback.searchParams.set('goneHost', 'guest');
  fallback.hash = `token=${encodeURIComponent(token)}`;
  const invite = status?.publicInviteUrl || status?.ipv6InviteUrl || status?.lanInviteUrl || fallback.toString();

  const setInvite = () => {
    DOM.inviteLinkContainer.classList.remove('hidden');
    const label = DOM.inviteLinkContainer.querySelector('label');
    if (label) label.textContent = 'INVITO G.O.N.E. HOST — INVIALO AGLI AMICI';
    DOM.inviteLinkInput.value = invite;
    DOM.btnCopyLink.textContent = 'COPIA INVITO';
  };
  setInvite();
  inviteGuardTimer = window.setInterval(setInvite, 500);

  document.getElementById('self-host-status')?.remove();
  const info = document.createElement('div');
  info.id = 'self-host-status';
  info.className = 'mt-3 rounded-xl border border-emerald-500/30 bg-emerald-950/20 p-3 text-xs leading-relaxed text-emerald-200';
  if (status?.publicInviteUrl) {
    info.textContent = `G.O.N.E. HOST INTERNET ATTIVO SULLA PORTA ${status.externalPort || status.port}. IL PC DELL’HOST È IL SERVER.`;
  } else if (status?.ipv6InviteUrl) {
    info.textContent = 'G.O.N.E. HOST ATTIVO CON IPv6 DIRETTO. IL PC DELL’HOST È IL SERVER; NON SERVE UN RELAY ESTERNO.';
  } else if (status?.cgnat) {
    info.textContent = 'G.O.N.E. HOST ATTIVO IN LAN. IL ROUTER/ISP USA UN IPv4 NON PUBBLICO/CGNAT E NON È DISPONIBILE UN IPv6 GLOBALE: PER INTERNET SERVE UN IP PUBBLICO DAL TUO ISP.';
  } else {
    info.textContent = 'G.O.N.E. HOST ATTIVO. UPnP NON HA APERTO LA PORTA: USA L’INVITO LAN O INOLTRA MANUALMENTE LA PORTA TCP DEL SERVER.';
  }
  DOM.inviteLinkContainer.appendChild(info);

  relayHostBridge = createRelayHostBridge({
    token,
    onPeer: (peerId, channel) => multiplayerSessionController.registerHostPeer(peerId, channel),
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
  const channel = createRelayGuestChannel(token, localId);
  relayGuestChannel = channel;

  multiplayerSessionController.startGuestOnChannel(channel, {
    playerId: localId,
    playerName,
    color: localPlayerColor,
    onGameStart: () => {
      DOM.multiplayerLobby.classList.remove('flex');
      DOM.multiplayerLobby.classList.add('hidden');
      onPlayMultiplayer();
    },
  });
}

/**
 * Returns true when the current URL belongs to a local G.O.N.E. Host session.
 * The shared multiplayer session controller owns host/client state and teardown;
 * this adapter owns only the local relay transport and host status presentation.
 */
export function setupSelfHostedSessionFromLocation(onPlayMultiplayer: () => void): boolean {
  const config = parseLocation();
  if (!config) return false;

  closeRelaySession();
  if (config.role === 'host') {
    setupHost(config.token, onPlayMultiplayer).catch((error) => {
      console.error('[G.O.N.E. self-host]', error);
      openLobbyShell();
      DOM.btnPlayMultiplayer.textContent = 'ERRORE G.O.N.E. HOST';
      DOM.btnPlayMultiplayer.disabled = true;
    });
  } else {
    setupGuest(config.token, onPlayMultiplayer);
  }

  DOM.btnBackLobby.addEventListener('click', closeRelaySession, { once: true });
  window.addEventListener('pagehide', closeRelaySession, { once: true });
  return true;
}

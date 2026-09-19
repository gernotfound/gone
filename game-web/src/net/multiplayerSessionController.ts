import {
  decodeLobbyMessage,
  encodeLobbyColorChanged,
  encodeLobbyGameStart,
} from './binaryProtocol.ts';
import {
  buildDirectInviteUrl,
  createDirectGuestAnswer,
  createDirectHostOffer,
  type DirectGuestAnswer,
  type DirectHostOffer,
} from './directWebRtc.ts';
import {
  buildFirestoreInviteUrl,
  createFirestoreSignalingRoom,
  deleteFirestoreSignalingRoom,
  getFirestoreSignalingRoom,
  isFirestoreSignalingConfigured,
  publishFirestoreSignalingAnswer,
  waitForFirestoreSignalingAnswer,
} from './firestoreSignaling.ts';
import { P2PClient, type ClientConnectionStatus } from './p2pClient.ts';
import { P2PHost, type P2PHostOptions } from './p2pHost.ts';
import { SimpleLagCompensator } from './simpleLagCompensator.ts';
import type { IDataChannel, SessionPlayerInfo } from './protocol.ts';

export type LobbyPlayer = {
  id: string;
  name: string;
  color: string;
  isHost: boolean;
};

export type SessionRole = 'none' | 'host' | 'client';
export type SessionNoticeKind = 'info' | 'success' | 'error';
export type SessionInviteKind = 'none' | 'host-link' | 'host-room' | 'guest-answer';

export type MultiplayerSessionSnapshot = {
  generation: number;
  role: SessionRole;
  localSessionId: string | null;
  localPlayerColor: string;
  players: LobbyPlayer[];
  clientStatus: ClientConnectionStatus | 'none';
  notice: { text: string; kind: SessionNoticeKind } | null;
  inviteKind: SessionInviteKind;
  inviteValue: string;
  hasPendingHostOffer: boolean;
};

export type SessionRuntimeBridge = {
  attachClient: (client: P2PClient | null) => void;
  attachHost: (host: P2PHost | null) => void;
  clearRemotePlayers: () => void;
  removeRemotePlayer: (playerId: string) => void;
  applyLocalColor: (hex: string) => void;
  gameplayReady: () => boolean;
};

type SessionListener = (snapshot: MultiplayerSessionSnapshot) => void;

type GuestStartOptions = {
  playerId?: string;
  playerName: string;
  color?: string;
  onGameStart?: () => void;
};

const DEFAULT_COLOR = '#00F0FF';

let runtimeBridge: SessionRuntimeBridge | null = null;
export let activeP2PClient: P2PClient | null = null;
export let activeP2PHost: P2PHost | null = null;
export let localPlayerColor = DEFAULT_COLOR;

function makePeerId(prefix: string): string {
  const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID().replace(/-/g, '').slice(0, 12)
    : Math.random().toString(36).slice(2, 14);
  return `${prefix}-${raw}`;
}

function roleFor(host: P2PHost | null, client: P2PClient | null): SessionRole {
  return host ? 'host' : client ? 'client' : 'none';
}

function clonePlayers(players: readonly LobbyPlayer[]): LobbyPlayer[] {
  return players.map((player) => ({ ...player }));
}

function sessionPlayerToLobby(player: SessionPlayerInfo): LobbyPlayer {
  return {
    id: player.id,
    name: player.name,
    color: player.color,
    isHost: player.slot === 0,
  };
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error ?? 'Errore sessione');
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

/**
 * Compatibility adapter around the canonical P2PHost. It does not replace or
 * patch host methods at runtime: it only observes the lobby packets the host
 * already emits so session presentation can react to peer color changes.
 */
class SessionP2PHost extends P2PHost {
  private readonly onRosterColorChanged: (playerId: string, color: string) => void;

  constructor(
    options: P2PHostOptions,
    onRosterColorChanged: (playerId: string, color: string) => void,
  ) {
    super(options);
    this.onRosterColorChanged = onRosterColorChanged;
  }

  override broadcastBinary(buffer: ArrayBuffer, excludePlayerId?: string): void {
    super.broadcastBinary(buffer, excludePlayerId);
    try {
      const message = decodeLobbyMessage(buffer);
      if (message?.type === 'COLOR_CHANGED') {
        this.onRosterColorChanged(message.playerId, message.newColor);
      }
    } catch {
      // Gameplay packets are not lobby packets; observation must never affect host delivery.
    }
  }
}

class MultiplayerSessionController {
  private readonly listeners = new Set<SessionListener>();
  private readonly hostPeerChannels = new Set<IDataChannel>();
  private players: LobbyPlayer[] = [];
  private localSessionId: string | null = null;
  private pendingHostOffer: DirectHostOffer | null = null;
  private guestDirectSession: DirectGuestAnswer | null = null;
  private readonly directHostSessions = new Set<DirectHostOffer>();
  private hostSignalingRoomId: string | null = null;
  private hostSignalingAbort: AbortController | null = null;
  private notice: MultiplayerSessionSnapshot['notice'] = null;
  private inviteKind: SessionInviteKind = 'none';
  private inviteValue = '';
  private generation = 0;
  private lastRole: SessionRole = 'none';

  configureRuntimeBridge(bridge: SessionRuntimeBridge): void {
    runtimeBridge = bridge;
  }

  subscribe(listener: SessionListener): () => void {
    this.listeners.add(listener);
    listener(this.snapshot());
    return () => this.listeners.delete(listener);
  }

  snapshot(): MultiplayerSessionSnapshot {
    return {
      generation: this.generation,
      role: roleFor(activeP2PHost, activeP2PClient),
      localSessionId: this.localSessionId,
      localPlayerColor,
      players: clonePlayers(this.players),
      clientStatus: activeP2PClient?.status ?? 'none',
      notice: this.notice ? { ...this.notice } : null,
      inviteKind: this.inviteKind,
      inviteValue: this.inviteValue,
      hasPendingHostOffer: Boolean(this.pendingHostOffer),
    };
  }

  getHost(): P2PHost | null {
    return activeP2PHost;
  }

  getClient(): P2PClient | null {
    return activeP2PClient;
  }

  setLocalPlayerColor(hex: string): void {
    localPlayerColor = hex;
    if (activeP2PClient) activeP2PClient.proposedColor = hex;
    runtimeBridge?.applyLocalColor(hex);
    this.updateLocalRoster({ color: hex });
    this.emit();
  }

  setPlayerName(name: string): void {
    const nextName = name.trim() || 'Giocatore';
    const localId = this.localSessionId;
    if (localId) this.updateLocalRoster({ name: nextName });

    if (activeP2PHost) {
      activeP2PHost.hostPlayer.name = nextName;
      const record = activeP2PHost.playerRecords.get(activeP2PHost.hostPlayer.id);
      if (record) record.name = nextName;
    }
    if (activeP2PClient) activeP2PClient.playerName = nextName;
    this.emit();
  }

  requestLocalColor(hex: string): void {
    if (activeP2PHost) {
      const hostId = activeP2PHost.hostPlayer.id;
      const claim = activeP2PHost.colorRegistry.requestColor(hostId, hex);
      if (!claim.success || !claim.color) {
        this.setNotice('COLORE NON DISPONIBILE', 'error');
        return;
      }
      const assigned = claim.color;
      activeP2PHost.hostPlayer.color = assigned;
      const record = activeP2PHost.playerRecords.get(hostId);
      if (record) record.color = assigned;
      localPlayerColor = assigned;
      runtimeBridge?.applyLocalColor(assigned);
      this.updateLocalRoster({ color: assigned });
      activeP2PHost.broadcastBinary(encodeLobbyColorChanged(hostId, assigned));
      this.setNotice('COLORE AGGIORNATO', 'success');
      return;
    }

    localPlayerColor = hex;
    runtimeBridge?.applyLocalColor(hex);
    this.updateLocalRoster({ color: hex });
    const client = activeP2PClient;
    if (client?.status === 'rejected') {
      client.retryWithColor(hex);
      this.setNotice('RICONNESSIONE...', 'info');
      return;
    }
    if (client?.status === 'connected') client.requestColorChange(hex);
    this.emit();
  }

  startHost(playerName: string, color = localPlayerColor): P2PHost {
    if (activeP2PHost) {
      this.setPlayerName(playerName);
      return activeP2PHost;
    }
    if (activeP2PClient) this.reset();

    this.localSessionId = 'host';
    localPlayerColor = color;
    const host = new SessionP2PHost({
      hostPlayer: { id: 'host', name: playerName || 'Giocatore', color },
      lagCompensator: new SimpleLagCompensator(500),
      onPlayerJoined: (player) => {
        this.upsertPlayer(sessionPlayerToLobby(player));
        this.setNotice(`${player.name.toUpperCase()} COLLEGATO DIRETTAMENTE.`, 'success');
      },
      onPlayerLeft: (playerId) => {
        this.players = this.players.filter((player) => player.id !== playerId);
        runtimeBridge?.removeRemotePlayer(playerId);
        this.emit();
      },
      onError: (error) => {
        console.error('[G.O.N.E. host]', error);
        this.setNotice('ERRORE HOST', 'error');
      },
    }, (playerId, colorChanged) => {
      const player = this.players.find((entry) => entry.id === playerId);
      if (player) player.color = colorChanged;
      this.emit();
    });

    localPlayerColor = host.hostPlayer.color;
    runtimeBridge?.applyLocalColor(localPlayerColor);
    this.players = [sessionPlayerToLobby(host.hostPlayer)];
    this.attachHost(host);
    this.setNotice('HOST PRONTO', 'success');
    return host;
  }

  async prepareHostInvite(): Promise<string> {
    const host = activeP2PHost;
    if (!host) throw new Error('La stanza host non è attiva.');
    this.closePendingHostOffer();
    this.inviteKind = 'none';
    this.inviteValue = '';
    this.setNotice('GENERAZIONE INVITO DIRETTO...', 'info');

    const offer = await createDirectHostOffer();
    if (activeP2PHost !== host) {
      offer.close();
      throw new Error('La stanza host è cambiata durante la creazione dell’invito.');
    }

    this.pendingHostOffer = offer;
    this.directHostSessions.add(offer);

    if (isFirestoreSignalingConfigured()) {
      try {
        const room = await createFirestoreSignalingRoom(offer.offerCode);
        if (activeP2PHost !== host || this.pendingHostOffer !== offer) {
          void deleteFirestoreSignalingRoom(room.roomId);
          offer.close();
          throw new Error('La stanza host è cambiata durante la pubblicazione dell’invito.');
        }
        this.hostSignalingRoomId = room.roomId;
        this.inviteKind = 'host-room';
        this.inviteValue = buildFirestoreInviteUrl(room.roomId);
        this.watchHostSignalingRoom(host, offer, room.roomId);
        this.setNotice('INVITO ONLINE PRONTO · CONNESSIONE AUTOMATICA', 'success');
        return this.inviteValue;
      } catch (error) {
        console.warn('[G.O.N.E.] Firestore signaling non disponibile, fallback manuale:', error);
      }
    }

    this.inviteKind = 'host-link';
    this.inviteValue = buildDirectInviteUrl(offer.offerCode);
    this.setNotice('INVITO PRONTO. INVIA IL LINK.', 'success');
    return this.inviteValue;
  }

  async applyHostAnswer(answerCode: string): Promise<void> {
    const accepted = this.pendingHostOffer;
    if (!accepted || !activeP2PHost || !answerCode.trim()) {
      throw new Error('Manca una risposta valida dell’amico.');
    }

    const signalingRoomId = this.hostSignalingRoomId;
    this.stopHostSignalingRoom(false);
    this.setNotice('COLLEGAMENTO DIRETTO...', 'info');
    await accepted.applyAnswer(answerCode.trim(), (peerId) => {
      this.registerHostPeer(peerId, accepted.channel);
    });
    this.directHostSessions.delete(accepted);
    this.pendingHostOffer = null;
    if (signalingRoomId) void deleteFirestoreSignalingRoom(signalingRoomId);
    this.setNotice('RISPOSTA ACCETTATA. ATTESA DEL GIOCATORE...', 'success');

    window.setTimeout(() => {
      if (activeP2PHost) void this.prepareHostInvite().catch((error) => {
        console.error('[G.O.N.E.] Invito diretto fallito', error);
        this.setNotice(errorMessage(error).toUpperCase(), 'error');
      });
    }, 350);
  }

  async startDirectGuest(offerCode: string, options: GuestStartOptions): Promise<string> {
    const client = this.createGuestClient(options);
    this.inviteKind = 'guest-answer';
    this.inviteValue = '';
    this.setNotice('PREPARAZIONE CONNESSIONE...', 'info');

    try {
      const session = await createDirectGuestAnswer(offerCode, client.playerId);
      if (activeP2PClient !== client) {
        session.close();
        throw new Error('La sessione guest è cambiata durante la negoziazione.');
      }
      this.guestDirectSession?.close();
      this.guestDirectSession = session;
      client.connect(session.channel, localPlayerColor);
      this.inviteValue = session.answerCode;
      this.setNotice('INVIA LA RISPOSTA ALL’HOST', 'info');
      return session.answerCode;
    } catch (error) {
      if (activeP2PClient === client) this.setNotice('INVITO NON VALIDO', 'error');
      throw error;
    }
  }

  async startFirestoreGuest(roomId: string, options: GuestStartOptions): Promise<void> {
    const client = this.createGuestClient(options);
    let session: DirectGuestAnswer | null = null;
    this.inviteKind = 'none';
    this.inviteValue = '';
    this.setNotice('LETTURA INVITO ONLINE...', 'info');

    try {
      const room = await getFirestoreSignalingRoom(roomId);
      if (activeP2PClient !== client) throw new Error('La sessione guest è cambiata durante il signaling.');
      session = await createDirectGuestAnswer(room.offerCode, client.playerId);
      if (activeP2PClient !== client) {
        session.close();
        session = null;
        throw new Error('La sessione guest è cambiata durante la negoziazione.');
      }

      this.guestDirectSession?.close();
      this.guestDirectSession = session;
      client.connect(session.channel, localPlayerColor);

      try {
        await publishFirestoreSignalingAnswer(room.roomId, session.answerCode);
      } catch (publishError) {
        // A failed fetch can be ambiguous if Firestore committed the PATCH before
        // the response was lost. Read the room once before tearing down a channel
        // that the host may already be applying.
        const confirmedRoom = await getFirestoreSignalingRoom(room.roomId).catch(() => null);
        if (confirmedRoom?.answerCode !== session.answerCode) throw publishError;
      }

      this.setNotice('RISPOSTA INVIATA · COLLEGAMENTO ALL’HOST...', 'info');
    } catch (error) {
      if (session) {
        if (this.guestDirectSession === session) this.guestDirectSession = null;
        try { session.close(); } catch { /* no-op */ }
      }
      if (activeP2PClient === client) {
        try { client.disconnect(); } catch { /* no-op */ }
        this.setNotice('INVITO ONLINE NON DISPONIBILE', 'error');
      }
      throw error;
    }
  }

  startGuestOnChannel(channel: IDataChannel, options: GuestStartOptions): P2PClient {
    const client = this.createGuestClient(options);
    this.inviteKind = 'none';
    this.inviteValue = '';
    client.connect(channel, localPlayerColor);
    this.setNotice('CONNESSIONE AL PC HOST...', 'info');
    return client;
  }

  registerHostPeer(peerId: string, channel: IDataChannel): void {
    const host = activeP2PHost;
    if (!host) {
      try { channel.close?.(); } catch { /* no-op */ }
      throw new Error('Host autorevole non più attivo.');
    }
    this.hostPeerChannels.add(channel);
    host.registerPeer(peerId, channel);
  }

  broadcastGameStart(): void {
    activeP2PHost?.broadcastBinary(encodeLobbyGameStart());
  }

  reset(): void {
    this.closePendingHostOffer();
    for (const session of this.directHostSessions) {
      try { session.close(); } catch { /* no-op */ }
    }
    this.directHostSessions.clear();
    try { this.guestDirectSession?.close(); } catch { /* no-op */ }
    this.guestDirectSession = null;

    for (const channel of this.hostPeerChannels) {
      try { channel.close?.(); } catch { /* no-op */ }
    }
    this.hostPeerChannels.clear();

    const client = activeP2PClient;
    if (client) {
      try { client.disconnect(); } catch { /* no-op */ }
      this.detachClient(client);
    }
    const host = activeP2PHost;
    if (host) this.detachHost(host);

    this.players = [];
    this.localSessionId = null;
    this.notice = null;
    this.inviteKind = 'none';
    this.inviteValue = '';
    this.emit();
  }

  /** Used by typed gameplay binding functions after they adopt/clear a transport. */
  notifyExternalBindingChange(): void {
    this.emit();
  }

  private createGuestClient(options: GuestStartOptions): P2PClient {
    if (activeP2PHost) this.reset();
    if (activeP2PClient) {
      const previous = activeP2PClient;
      try { previous.disconnect(); } catch { /* no-op */ }
      this.detachClient(previous);
    }

    const localId = options.playerId || makePeerId('guest');
    this.localSessionId = localId;
    localPlayerColor = options.color || localPlayerColor;
    this.players = [{ id: localId, name: options.playerName || 'Giocatore', color: localPlayerColor, isHost: false }];

    const client = new P2PClient({
      playerId: localId,
      playerName: options.playerName || 'Giocatore',
      onJoinAccepted: (data) => {
        localPlayerColor = data.assignedColor;
        runtimeBridge?.applyLocalColor(data.assignedColor);
        this.players = data.sessionPlayers.map(sessionPlayerToLobby);
        this.inviteKind = 'none';
        this.inviteValue = '';
        this.setNotice("IN ATTESA DELL'HOST...", 'info');
      },
      onColorRejected: (data) => {
        const nextColor = data.availableColors?.find((color) => color !== localPlayerColor);
        if (!nextColor) {
          this.setNotice('NESSUN COLORE DISPONIBILE', 'error');
          return;
        }
        localPlayerColor = nextColor;
        runtimeBridge?.applyLocalColor(nextColor);
        this.updateLocalRoster({ color: nextColor });
        window.setTimeout(() => {
          if (activeP2PClient === client && client.status === 'rejected') client.retryWithColor(nextColor);
        }, 60);
        this.setNotice('ASSEGNAZIONE COLORE...', 'info');
      },
      onPlayerJoined: (player) => this.upsertPlayer(sessionPlayerToLobby(player)),
      onPlayerLeft: ({ playerId }) => {
        this.players = this.players.filter((player) => player.id !== playerId);
        runtimeBridge?.removeRemotePlayer(playerId);
        this.emit();
      },
      onColorChanged: ({ playerId, newColor }) => {
        const player = this.players.find((entry) => entry.id === playerId);
        if (player) player.color = newColor;
        if (playerId === localId) {
          localPlayerColor = newColor;
          runtimeBridge?.applyLocalColor(newColor);
        }
        this.emit();
      },
      onStatusChange: (status) => {
        if (status === 'connecting') this.setNotice('ATTESA CONFERMA HOST...', 'info');
        else if (status === 'disconnected') this.setNotice('CONNESSIONE PERSA', 'error');
        else this.emit();
      },
      onGameStart: () => options.onGameStart?.(),
      onError: (error) => {
        console.error('[G.O.N.E. client]', error);
        this.setNotice('ERRORE DI RETE', 'error');
      },
    });

    this.attachClient(client);
    this.guardClientRenderingUntilGameplay(client);
    this.emit();
    return client;
  }

  private attachClient(client: P2PClient): void {
    if (runtimeBridge) runtimeBridge.attachClient(client);
    else setActiveP2PClient(client);
  }

  private attachHost(host: P2PHost): void {
    if (runtimeBridge) runtimeBridge.attachHost(host);
    else setActiveP2PHost(host);
  }

  private detachClient(client: P2PClient): void {
    if (activeP2PClient !== client) return;
    if (runtimeBridge) runtimeBridge.attachClient(null);
    else setActiveP2PClient(null);
  }

  private detachHost(host: P2PHost): void {
    if (activeP2PHost !== host) return;
    if (runtimeBridge) runtimeBridge.attachHost(null);
    else setActiveP2PHost(null);
  }

  private guardClientRenderingUntilGameplay(client: P2PClient): void {
    const originalSnapshot = client.config.onWorldSnapshot;
    const originalHit = client.config.onHitConfirmed;
    const originalLegacyShot = client.config.onHitscanFired;
    const originalBinaryShot = client.config.onBinaryHitscanFired;
    const gameplayReady = () => runtimeBridge?.gameplayReady() ?? true;

    if (originalSnapshot) client.config.onWorldSnapshot = (snapshot) => {
      if (gameplayReady()) originalSnapshot(snapshot);
    };
    if (originalHit) client.config.onHitConfirmed = (hit) => {
      if (gameplayReady()) originalHit(hit);
    };
    if (originalLegacyShot) client.config.onHitscanFired = (shot) => {
      if (gameplayReady()) originalLegacyShot(shot);
    };
    if (originalBinaryShot) client.config.onBinaryHitscanFired = (shot) => {
      if (gameplayReady()) originalBinaryShot(shot);
    };
  }

  private watchHostSignalingRoom(host: P2PHost, offer: DirectHostOffer, roomId: string): void {
    this.hostSignalingAbort?.abort();
    const abort = new AbortController();
    this.hostSignalingAbort = abort;

    void waitForFirestoreSignalingAnswer(roomId, abort.signal).then(async (answerCode) => {
      if (
        abort.signal.aborted
        || activeP2PHost !== host
        || this.pendingHostOffer !== offer
        || this.hostSignalingRoomId !== roomId
      ) return;
      await this.applyHostAnswer(answerCode);
    }).catch((error) => {
      if (isAbortError(error)) return;
      console.warn('[G.O.N.E.] Attesa risposta Firestore fallita:', error);
      if (activeP2PHost !== host || this.pendingHostOffer !== offer) return;
      const staleRoom = this.hostSignalingRoomId;
      this.stopHostSignalingRoom(false);
      if (staleRoom) void deleteFirestoreSignalingRoom(staleRoom);
      this.inviteKind = 'host-link';
      this.inviteValue = buildDirectInviteUrl(offer.offerCode);
      this.setNotice('SIGNALING ONLINE NON DISPONIBILE · USA INVITO DIRETTO', 'error');
    });
  }

  private stopHostSignalingRoom(deleteRoom: boolean): void {
    this.hostSignalingAbort?.abort();
    this.hostSignalingAbort = null;
    const roomId = this.hostSignalingRoomId;
    this.hostSignalingRoomId = null;
    if (deleteRoom && roomId) void deleteFirestoreSignalingRoom(roomId);
  }

  private closePendingHostOffer(): void {
    this.stopHostSignalingRoom(true);
    if (!this.pendingHostOffer) return;
    try { this.pendingHostOffer.close(); } catch { /* no-op */ }
    this.directHostSessions.delete(this.pendingHostOffer);
    this.pendingHostOffer = null;
  }

  private updateLocalRoster(patch: Partial<Pick<LobbyPlayer, 'name' | 'color'>>): void {
    const localId = this.localSessionId;
    if (!localId) return;
    const local = this.players.find((player) => player.id === localId);
    if (local) Object.assign(local, patch);
  }

  private upsertPlayer(player: LobbyPlayer): void {
    const existing = this.players.find((entry) => entry.id === player.id);
    if (existing) Object.assign(existing, player);
    else this.players.push(player);
    this.emit();
  }

  private setNotice(text: string, kind: SessionNoticeKind): void {
    this.notice = { text, kind };
    this.emit();
  }

  private emit(): void {
    const nextRole = roleFor(activeP2PHost, activeP2PClient);
    if (nextRole !== this.lastRole) {
      this.lastRole = nextRole;
      this.generation += 1;
      window.dispatchEvent(new CustomEvent('gone-session-changed', {
        detail: { generation: this.generation, role: nextRole },
      }));
    }
    const snapshot = this.snapshot();
    for (const listener of this.listeners) listener(snapshot);
    window.dispatchEvent(new CustomEvent('gone-session-state', { detail: snapshot }));
  }
}

export const multiplayerSessionController = new MultiplayerSessionController();

export function configureSessionRuntimeBridge(bridge: SessionRuntimeBridge): void {
  multiplayerSessionController.configureRuntimeBridge(bridge);
}

export function setActiveP2PClient(client: P2PClient | null): void {
  if (activeP2PClient === client) return;
  const previous = activeP2PClient;
  if (previous && previous !== client) previous.stopStateTick();
  activeP2PClient = client;
  runtimeBridge?.clearRemotePlayers();
  multiplayerSessionController.notifyExternalBindingChange();
}

export function setActiveP2PHost(host: P2PHost | null): void {
  if (activeP2PHost === host) return;
  const previous = activeP2PHost;
  if (previous && previous !== host) previous.destroy();
  activeP2PHost = host;
  runtimeBridge?.clearRemotePlayers();
  multiplayerSessionController.notifyExternalBindingChange();
}

export function setLocalPlayerColor(hex: string): void {
  multiplayerSessionController.setLocalPlayerColor(hex);
}

if (typeof window !== 'undefined') {
  (window as any).goneSession = {
    snapshot: () => multiplayerSessionController.snapshot(),
    reset: () => multiplayerSessionController.reset(),
  };
}

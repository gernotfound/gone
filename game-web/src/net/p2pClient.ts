/**
 * G.O.N.E. P2P WebRTC Client & Session Handler
 *
 * Connects to the authoritative P2P Host, handles color negotiation, manages
 * error rejection state with Cyberpunk UI banners, synchronizes peer state,
 * and executes a 30 Hz binary CLIENT_STATE transmission loop.
 */

import {
  isBinaryMessage,
  toArrayBuffer,
  type ColorRejectedMessage,
  type FireHitscanMessage,
  type IDataChannel,
  type JoinAcceptedMessage,
  type SessionPlayerInfo,
} from './protocol.ts';
import {
  decodeLobbyMessage,
  encodeLobbyJoin,
  encodeLobbyColorRequest,
  PACKET_TYPE,
  packClientState,
  packFireHitscan,
  unpackWorldSnapshot,
  unpackHitConfirmed,
  unpackFireHitscan,
  type WorldSnapshotData,
  type HitConfirmedData,
  type FireHitscanData,
} from './binaryProtocol.ts';

export type ClientConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'rejected';

export interface ClientStateInput {
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  activeWeapon?: number;
  flags?: number;
}

export interface P2PClientConfig {
  playerId: string;
  playerName: string;
  onJoinAccepted?: (data: { assignedColor: string; assignedSlot?: number; sessionPlayers: SessionPlayerInfo[] }) => void;
  onColorRejected?: (data: { attemptedColor: string; reason: string; availableColors: string[] }) => void;
  onPlayerJoined?: (player: SessionPlayerInfo) => void;
  onPlayerLeft?: (data: { playerId: string; freedColor: string }) => void;
  onColorChanged?: (data: { playerId: string; newColor: string }) => void;
  onHitscanFired?: (msg: FireHitscanMessage) => void;
  onWorldSnapshot?: (snapshot: WorldSnapshotData) => void;
  onHitConfirmed?: (hit: HitConfirmedData) => void;
  onBinaryHitscanFired?: (shot: FireHitscanData) => void;
  onStatusChange?: (status: ClientConnectionStatus) => void;
  onGameStart?: () => void;
  onError?: (err: Error) => void;
}

export class P2PClient {
  public readonly playerId: string;
  public readonly playerName: string;

  public status: ClientConnectionStatus = 'disconnected';
  public proposedColor: string = '';
  public assignedColor: string | null = null;
  public playerSlot: number | null = null;
  public sessionPlayers: SessionPlayerInfo[] = [];
  public lastRejection: {
    attemptedColor: string;
    reason: string;
    availableColors: string[];
  } | null = null;

  // Authoritative combat & health state received from Host
  public clientHp: number = 100;
  public isAlive: boolean = true;
  public isShielded: boolean = true;
  public timerRemainingMs: number = 10000;

  // Slot lookup maps for instantaneous O(1) translation
  public readonly slotToPlayerId = new Map<number, string>();
  public readonly playerIdToSlot = new Map<string, number>();

  private channel: IDataChannel | null = null;
  public config: P2PClientConfig;

  // 30 Hz Client State Tick Loop variables
  private stateTickTimer: ReturnType<typeof setInterval> | null = null;
  private stateProvider: (() => ClientStateInput) | null = null;
  private stateSequence: number = 0;
  private shotSequence: number = 0;

  constructor(config: P2PClientConfig) {
    this.config = config;
    this.playerId = config.playerId;
    this.playerName = config.playerName;
  }

  /**
   * Initiates connection to Host over a WebRTC DataChannel and proposes a neon color.
   */
  public connect(channel: IDataChannel, proposedColor: string): void {
    this.channel = channel;
    this.proposedColor = proposedColor;
    this.setStatus('connecting');

    // Ensure binary delivery in WebRTC is ArrayBuffer (not Blob)
    if ('binaryType' in channel) {
      try {
        channel.binaryType = 'arraybuffer';
      } catch {
        // Fallback for mocks
      }
    }

    channel.onmessage = (ev: { data: any }) => {
      this.handleMessage(ev.data);
    };

    channel.onclose = () => {
      this.handleDisconnect();
    };

    channel.onerror = (err: any) => {
      this.config.onError?.(new Error(`DataChannel error: ${err}`));
    };

    const sendJoinRequest = () => {
      // Send JOIN_REQUEST with proposed fluo color
      const joinReqBuf = encodeLobbyJoin(this.playerId, this.playerName, this.proposedColor);
      try {
        this.channel!.send(joinReqBuf);
      } catch (err: any) {
        this.config.onError?.(new Error(`Send failed: ${err?.message || err}`));
      }
    };

    // Se il canale è già aperto (BroadcastChannel mock) invia subito,
    // altrimenti aspetta onopen (WebRTC DataChannel)
    if (channel.readyState === 'open') {
      sendJoinRequest();
    } else {
      channel.onopen = () => {
        sendJoinRequest();
      };
    }
  }

  /**
   * Processes incoming message from Host DataChannel. Handles binary and text packets.
   */
  public handleMessage(rawData: unknown): void {
    if (!isBinaryMessage(rawData)) return;
    const buffer = toArrayBuffer(rawData);
    if (buffer.byteLength < 1) return;
    const opcode = new DataView(buffer).getUint8(0);

    if (opcode >= 0x10) {
      const msg = decodeLobbyMessage(buffer);
      if (!msg) return;

      switch (msg.type) {
        case 'JOIN_ACCEPTED': {
          if (msg.playerId === this.playerId) {
            this.handleJoinAccepted(msg as any);
          }
          break;
        }
        case 'COLOR_REJECTED': {
          if (msg.playerId === this.playerId) {
            this.handleColorRejected(msg as any);
          }
          break;
        }
        case 'PLAYER_JOINED': {
          if (msg.player.id !== this.playerId) {
            const exists = this.sessionPlayers.some((p) => p.id === msg.player.id);
            if (!exists) {
              this.sessionPlayers.push(msg.player);
            }
            if (msg.player.slot !== undefined) {
              this.slotToPlayerId.set(msg.player.slot, msg.player.id);
              this.playerIdToSlot.set(msg.player.id, msg.player.slot);
            }
            this.config.onPlayerJoined?.(msg.player);
          }
          break;
        }
        case 'PLAYER_LEFT': {
          this.sessionPlayers = this.sessionPlayers.filter((p) => p.id !== msg.playerId);
          const slot = this.playerIdToSlot.get(msg.playerId);
          if (slot !== undefined) {
            this.slotToPlayerId.delete(slot);
            this.playerIdToSlot.delete(msg.playerId);
          }
          this.config.onPlayerLeft?.({
            playerId: msg.playerId,
            freedColor: msg.freedColor,
          });
          break;
        }
        case 'COLOR_CHANGED': {
          const p = this.sessionPlayers.find((item) => item.id === msg.playerId);
          if (p) {
            p.color = msg.newColor;
          }
          if (msg.playerId === this.playerId) {
            this.assignedColor = msg.newColor;
          }
          this.config.onColorChanged?.({
            playerId: msg.playerId,
            newColor: msg.newColor,
          });
          break;
        }
        case 'GAME_START': {
          this.config.onGameStart?.();
          break;
        }
      }
      return;
    }

    this.handleBinaryMessage(buffer);
  }

  private handleBinaryMessage(buffer: ArrayBuffer): void {
    if (buffer.byteLength < 1) return;
    const opcode = new DataView(buffer).getUint8(0);

    switch (opcode) {
      case PACKET_TYPE.WORLD_SNAPSHOT: { // 0x02
        const snapshot = unpackWorldSnapshot(buffer);
        if (snapshot) {
          if (this.playerSlot !== null) {
            const me = snapshot.players.find((p) => (p.slot ?? p.playerSlot) === this.playerSlot);
            if (me) {
              this.clientHp = me.hp ?? me.health ?? 100;
              const flags = me.flags ?? me.stateFlags ?? 0;
              this.isAlive = (flags & 0x01) !== 0;
              this.isShielded = (flags & 0x02) !== 0;
              this.timerRemainingMs = me.timerRemainingMs ?? 0;
            }
          }
          this.config.onWorldSnapshot?.(snapshot);
        }
        break;
      }
      case PACKET_TYPE.HIT_CONFIRMED: { // 0x04
        const hit = unpackHitConfirmed(buffer);
        if (hit) {
          if (this.playerSlot !== null && hit.victimSlot === this.playerSlot) {
            this.clientHp = hit.newHp;
            if (hit.isFatalKill || hit.isFatal || hit.newHp <= 0) {
              this.isAlive = false;
            }
          }
          this.config.onHitConfirmed?.(hit);
        }
        break;
      }
      case PACKET_TYPE.FIRE_HITSCAN: { // 0x03
        const shot = unpackFireHitscan(buffer);
        if (shot) {
          this.config.onBinaryHitscanFired?.(shot);
        }
        break;
      }
      default:
        break;
    }
  }

  // --- 30 Hz Client State Tick Loop ---

  public setStateProvider(provider: () => ClientStateInput): void {
    this.stateProvider = provider;
  }

  public startStateTick(tickRateHz: number = 30): void {
    this.stopStateTick();
    const intervalMs = Math.max(1, Math.round(1000 / tickRateHz));
    this.stateTickTimer = setInterval(() => {
      this.sendCurrentState();
    }, intervalMs);
  }

  public stopStateTick(): void {
    if (this.stateTickTimer !== null) {
      clearInterval(this.stateTickTimer);
      this.stateTickTimer = null;
    }
  }

  public sendCurrentState(): void {
    if (this.status !== 'connected' || !this.channel || this.playerSlot === null || !this.stateProvider) {
      return;
    }

    const input = this.stateProvider();
    const seq = (this.stateSequence++) & 0xffff;
    const time = performance.now();

    const buffer = packClientState(
      this.playerSlot,
      seq,
      time,
      input.position,
      input.yaw,
      input.pitch,
      input.activeWeapon ?? 0,
      input.flags ?? 0
    );

    try {
      this.channel.send(buffer);
    } catch (err: any) {
      this.config.onError?.(new Error(`Send client state failed: ${err?.message || err}`));
    }
  }

  /**
   * Retries joining with a different proposed neon color after a rejection.
   */
  public retryWithColor(newColor: string): void {
    if (!this.channel) {
      throw new Error('DataChannel is not connected.');
    }

    this.proposedColor = newColor;
    this.setStatus('connecting');
    this.lastRejection = null;

    const retryReqBuf = encodeLobbyJoin(this.playerId, this.playerName, newColor);
    try {
      this.channel.send(retryReqBuf);
    } catch (err: any) {
      this.config.onError?.(new Error(`Send failed: ${err?.message || err}`));
    }
  }

  /**
   * Request a dynamic color change while connected in session.
   */
  public requestColorChange(newColor: string): void {
    if (this.status !== 'connected' || !this.channel) return;
    const reqBuf = encodeLobbyColorRequest(this.playerId, newColor);
    try {
      this.channel.send(reqBuf);
    } catch(err: any) {
      this.config.onError?.(new Error(`Send failed: ${err?.message || err}`));
    }
  }

  /**
   * Send hitscan shot event to host for authoritative damage calculation.
   * Uses binary format (0x03) when slot is known, with fallback to JSON.
   */
  public fireHitscan(
    weaponType: number,
    origin: [number, number, number],
    direction: [number, number, number]
  ): void {
    if (this.status !== 'connected' || !this.channel) return;

    if (this.playerSlot !== null) {
      const shotSeq = (this.shotSequence++) & 0xff;
      const clientTime = performance.now();
      const buffer = packFireHitscan(
        this.playerSlot,
        weaponType,
        shotSeq,
        clientTime,
        origin,
        direction
      );
      try {
        this.channel.send(buffer);
      } catch (err: any) {
        this.config.onError?.(new Error(`Binary fireHitscan failed: ${err?.message || err}`));
      }
    } else {
      // Cannot fire hitscan before joining (slot unknown in binary protocol)
      console.warn("Attempted to fire hitscan before slot assignment.");
    }
  }

  /**
   * Disconnects the client channel and halts tick loop.
   */
  public disconnect(): void {
    this.stopStateTick();
    if (this.channel) {
      try {
        this.channel.close?.();
      } catch {
        // ignore
      }
      this.channel = null;
    }
    this.handleDisconnect();
  }

  private handleJoinAccepted(msg: JoinAcceptedMessage): void {
    this.assignedColor = msg.assignedColor;
    this.sessionPlayers = msg.sessionPlayers;
    this.playerSlot = msg.assignedSlot ?? 1;
    this.lastRejection = null;

    // Synchronize slot lookup tables
    this.slotToPlayerId.clear();
    this.playerIdToSlot.clear();
    this.slotToPlayerId.set(this.playerSlot!, this.playerId);
    this.playerIdToSlot.set(this.playerId, this.playerSlot!);

    for (const p of msg.sessionPlayers) {
      if (p.slot !== undefined) {
        this.slotToPlayerId.set(p.slot, p.id);
        this.playerIdToSlot.set(p.id, p.slot);
      }
    }

    this.setStatus('connected');

    this.config.onJoinAccepted?.({
      assignedColor: msg.assignedColor,
      assignedSlot: this.playerSlot ?? undefined,
      sessionPlayers: msg.sessionPlayers,
    });
  }

  private handleColorRejected(msg: ColorRejectedMessage): void {
    this.lastRejection = {
      attemptedColor: msg.attemptedColor,
      reason: msg.reason,
      availableColors: msg.availableColors || [],
    };
    this.setStatus('rejected');

    this.config.onColorRejected?.(this.lastRejection);
  }

  private handleDisconnect(): void {
    this.stopStateTick();
    this.setStatus('disconnected');
    this.assignedColor = null;
    this.playerSlot = null;
    this.sessionPlayers = [];
    this.slotToPlayerId.clear();
    this.playerIdToSlot.clear();
  }

  private setStatus(status: ClientConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.config.onStatusChange?.(status);
    }
  }

}

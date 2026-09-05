/**
 * G.O.N.E. P2P WebRTC Client & Session Handler
 *
 * Connects to the authoritative P2P Host, handles color negotiation, manages
 * error rejection state with Cyberpunk UI banners, and synchronizes peer state.
 */

import {
  parseNetMessage,
  serializeNetMessage,
  type ColorRejectedMessage,
  type FireHitscanMessage,
  type IDataChannel,
  type JoinAcceptedMessage,
  type JoinRequestMessage,
  type SessionPlayerInfo,
} from './protocol.ts';

export type ClientConnectionStatus = 'disconnected' | 'connecting' | 'connected' | 'rejected';

export interface P2PClientConfig {
  playerId: string;
  playerName: string;
  onJoinAccepted?: (data: { assignedColor: string; sessionPlayers: SessionPlayerInfo[] }) => void;
  onColorRejected?: (data: { attemptedColor: string; reason: string; availableColors: string[] }) => void;
  onPlayerJoined?: (player: SessionPlayerInfo) => void;
  onPlayerLeft?: (data: { playerId: string; freedColor: string }) => void;
  onColorChanged?: (data: { playerId: string; newColor: string }) => void;
  onHitscanFired?: (msg: FireHitscanMessage) => void;
  onStatusChange?: (status: ClientConnectionStatus) => void;
  onError?: (err: Error) => void;
}

export class P2PClient {
  public readonly playerId: string;
  public readonly playerName: string;

  public status: ClientConnectionStatus = 'disconnected';
  public proposedColor: string = '';
  public assignedColor: string | null = null;
  public sessionPlayers: SessionPlayerInfo[] = [];
  public lastRejection: {
    attemptedColor: string;
    reason: string;
    availableColors: string[];
  } | null = null;

  private channel: IDataChannel | null = null;
  private config: P2PClientConfig;

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

    channel.onmessage = (ev: { data: any }) => {
      this.handleMessage(ev.data);
    };

    channel.onclose = () => {
      this.handleDisconnect();
    };

    channel.onerror = (err: any) => {
      this.config.onError?.(new Error(`DataChannel error: ${err}`));
    };

    // Send JOIN_REQUEST with proposed fluo color
    const joinReq: JoinRequestMessage = {
      type: 'JOIN_REQUEST',
      playerId: this.playerId,
      playerName: this.playerName,
      proposedColor: this.proposedColor,
    };

    this.send(joinReq);
  }

  /**
   * Processes incoming message from Host DataChannel.
   */
  public handleMessage(rawData: unknown): void {
    const msg = parseNetMessage(rawData);
    if (!msg) return;

    switch (msg.type) {
      case 'JOIN_ACCEPTED': {
        if (msg.playerId === this.playerId) {
          this.handleJoinAccepted(msg);
        }
        break;
      }

      case 'COLOR_REJECTED': {
        if (msg.playerId === this.playerId) {
          this.handleColorRejected(msg);
        }
        break;
      }

      case 'PLAYER_JOINED': {
        if (msg.player.id !== this.playerId) {
          // Add player if not exists
          const exists = this.sessionPlayers.some((p) => p.id === msg.player.id);
          if (!exists) {
            this.sessionPlayers.push(msg.player);
          }
          this.config.onPlayerJoined?.(msg.player);
        }
        break;
      }

      case 'PLAYER_LEFT': {
        this.sessionPlayers = this.sessionPlayers.filter((p) => p.id !== msg.playerId);
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

      case 'FIRE_HITSCAN': {
        this.config.onHitscanFired?.(msg);
        break;
      }

      default:
        break;
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

    const retryReq: JoinRequestMessage = {
      type: 'JOIN_REQUEST',
      playerId: this.playerId,
      playerName: this.playerName,
      proposedColor: newColor,
    };

    this.send(retryReq);
  }

  /**
   * Request a dynamic color change while connected in session.
   */
  public requestColorChange(newColor: string): void {
    if (this.status !== 'connected' || !this.channel) return;
    this.send({
      type: 'COLOR_REQUEST',
      playerId: this.playerId,
      requestedColor: newColor,
    });
  }

  /**
   * Send hitscan shot event to host for authoritative damage calculation.
   */
  public fireHitscan(
    weaponType: number,
    origin: [number, number, number],
    direction: [number, number, number]
  ): void {
    if (this.status !== 'connected' || !this.channel) return;
    this.send({
      type: 'FIRE_HITSCAN',
      shooterId: this.playerId,
      weaponType,
      origin,
      direction,
    });
  }

  /**
   * Disconnects the client channel.
   */
  public disconnect(): void {
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
    this.lastRejection = null;
    this.setStatus('connected');

    this.config.onJoinAccepted?.({
      assignedColor: msg.assignedColor,
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
    this.setStatus('disconnected');
    this.assignedColor = null;
    this.sessionPlayers = [];
  }

  private setStatus(status: ClientConnectionStatus): void {
    if (this.status !== status) {
      this.status = status;
      this.config.onStatusChange?.(status);
    }
  }

  private send(msg: any): void {
    if (!this.channel) return;
    try {
      this.channel.send(serializeNetMessage(msg));
    } catch (err: any) {
      this.config.onError?.(new Error(`Send failed: ${err?.message || err}`));
    }
  }
}

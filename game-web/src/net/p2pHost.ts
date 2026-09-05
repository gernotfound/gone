/**
 * G.O.N.E. Authoritative P2P Host & Session Manager
 *
 * Enforces authoritative neon color uniqueness across all active players in
 * the P2P mesh, validates candidate colors via the color registry, manages
 * player lifecycle (join/leave/rejection), and broadcasts session state.
 */

import {
  COLOR_REJECT_REASONS,
  DEFAULT_NEON_HEX_LIST,
  isFluorescentColor,
  normalizeHexColor,
  parseNetMessage,
  serializeNetMessage,
  type ColorRejectedMessage,
  type ColorValidationResult,
  type FireHitscanMessage,
  type IDataChannel,
  type JoinAcceptedMessage,
  type NetMessage,
  type PlayerJoinedMessage,
  type PlayerLeftMessage,
  type SessionPlayerInfo,
} from './protocol.ts';

// --- Color Registry Interfaces & Implementations ---

export interface IWasmColorRegistry {
  request_color(playerId: string, hex: string): string;
  release_player(playerId: string): void;
  is_color_available(hex: string): boolean;
  get_available_palette(): any[];
}

export interface IColorRegistry {
  requestColor(playerId: string, hex: string): ColorValidationResult;
  releasePlayer(playerId: string): string | null;
  isColorAvailable(hex: string): boolean;
  getAvailablePalette(): string[];
  getAssignedColor(playerId: string): string | undefined;
}

/**
 * Pure TypeScript implementation of the fluorescent color uniqueness registry.
 * Mirrors the Rust SessionColorRegistry logic and provides complete standalone
 * functionality for Node.js automated tests and browser fallback.
 */
export class LocalColorRegistry implements IColorRegistry {
  private claimedColors = new Map<string, string>(); // playerId -> normalizedHex
  private hexToPlayer = new Map<string, string>(); // normalizedHex -> playerId
  private presetPalette: string[];

  constructor(presetPalette: readonly string[] = DEFAULT_NEON_HEX_LIST) {
    this.presetPalette = [...presetPalette];
  }

  requestColor(playerId: string, hex: string): ColorValidationResult {
    const norm = normalizeHexColor(hex);
    if (!norm) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.INVALID_HEX_FORMAT,
        message: `Formato hex non valido: "${hex}". Richiesto esadecimale a 6 cifre (es. #00F0FF).`,
        availableColors: this.getAvailablePalette(),
      };
    }

    if (!isFluorescentColor(norm)) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.INVALID_FLUO_COLOR,
        message: `Il colore ${norm} non soddisfa i criteri neon/fluorescenza (Saturazione >= 70% e Luminosità >= 70%).`,
        availableColors: this.getAvailablePalette(),
      };
    }

    const currentOwner = this.hexToPlayer.get(norm);
    if (currentOwner && currentOwner !== playerId) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        message: `COLORE GIÀ IN USO: Il colore neon ${norm} è già stato assegnato a un altro giocatore nella sessione.`,
        availableColors: this.getAvailablePalette(),
      };
    }

    // Release previous color held by this player if different
    const previous = this.claimedColors.get(playerId);
    if (previous && previous !== norm) {
      this.hexToPlayer.delete(previous);
    }

    this.claimedColors.set(playerId, norm);
    this.hexToPlayer.set(norm, playerId);

    return {
      success: true,
      color: norm,
    };
  }

  releasePlayer(playerId: string): string | null {
    const color = this.claimedColors.get(playerId);
    if (color) {
      this.claimedColors.delete(playerId);
      this.hexToPlayer.delete(color);
      return color;
    }
    return null;
  }

  isColorAvailable(hex: string): boolean {
    const norm = normalizeHexColor(hex);
    if (!norm) return false;
    if (!isFluorescentColor(norm)) return false;
    return !this.hexToPlayer.has(norm);
  }

  getAvailablePalette(): string[] {
    return this.presetPalette.filter((h) => !this.hexToPlayer.has(h));
  }

  getAssignedColor(playerId: string): string | undefined {
    return this.claimedColors.get(playerId);
  }
}

/**
 * Adapter wrapping Rust WASM WasmColorRegistry to conform to IColorRegistry.
 */
export class WasmColorRegistryAdapter implements IColorRegistry {
  private wasm: IWasmColorRegistry;
  private assigned = new Map<string, string>();

  constructor(wasmRegistry: IWasmColorRegistry) {
    this.wasm = wasmRegistry;
  }

  requestColor(playerId: string, hex: string): ColorValidationResult {
    try {
      const raw = this.wasm.request_color(playerId, hex);
      const parsed = JSON.parse(raw);
      if (parsed.success) {
        this.assigned.set(playerId, parsed.color);
        return {
          success: true,
          color: parsed.color,
        };
      } else {
        return {
          success: false,
          error: parsed.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
          message: parsed.message || 'Colore non disponibile.',
          availableColors: this.getAvailablePalette(),
        };
      }
    } catch (e: any) {
      return {
        success: false,
        error: 'WASM_ERROR',
        message: e?.message || 'Errore WASM Color Registry',
        availableColors: this.getAvailablePalette(),
      };
    }
  }

  releasePlayer(playerId: string): string | null {
    const color = this.assigned.get(playerId) || null;
    this.wasm.release_player(playerId);
    this.assigned.delete(playerId);
    return color;
  }

  isColorAvailable(hex: string): boolean {
    return this.wasm.is_color_available(hex);
  }

  getAvailablePalette(): string[] {
    const pal = this.wasm.get_available_palette();
    return Array.isArray(pal) ? pal.map(String) : [];
  }

  getAssignedColor(playerId: string): string | undefined {
    return this.assigned.get(playerId);
  }
}

// --- P2P Host Session Manager ---

export interface HostPlayerConfig {
  id: string;
  name: string;
  color?: string;
}

export interface P2PHostOptions {
  hostPlayer: HostPlayerConfig;
  colorRegistry?: IColorRegistry;
  onPlayerJoined?: (player: SessionPlayerInfo) => void;
  onPlayerLeft?: (playerId: string, freedColor: string) => void;
  onHitscanFired?: (msg: FireHitscanMessage) => void;
  onError?: (err: Error) => void;
}

interface PeerConnectionRecord {
  channel: IDataChannel;
  info: SessionPlayerInfo;
}

export class P2PHost {
  public readonly hostPlayer: SessionPlayerInfo;
  public readonly colorRegistry: IColorRegistry;

  private peers = new Map<string, PeerConnectionRecord>();
  private options: P2PHostOptions;

  constructor(options: P2PHostOptions) {
    this.options = options;
    this.colorRegistry = options.colorRegistry ?? new LocalColorRegistry();

    // Claim authoritative color for host player
    const desiredColor = options.hostPlayer.color || DEFAULT_NEON_HEX_LIST[0];
    const claim = this.colorRegistry.requestColor(options.hostPlayer.id, desiredColor);

    const hostAssignedColor = claim.success && claim.color ? claim.color : DEFAULT_NEON_HEX_LIST[0];

    this.hostPlayer = {
      id: options.hostPlayer.id,
      name: options.hostPlayer.name,
      color: hostAssignedColor,
    };
  }

  /**
   * Registers a new peer's DataChannel connection and binds listeners.
   */
  public registerPeer(peerId: string, channel: IDataChannel): void {
    channel.onmessage = (ev: { data: any }) => {
      this.handleChannelMessage(peerId, channel, ev.data);
    };

    channel.onclose = () => {
      this.handlePeerDisconnect(peerId);
    };

    channel.onerror = (err: any) => {
      this.options.onError?.(new Error(`Peer ${peerId} error: ${err}`));
    };
  }

  /**
   * Directly processes an incoming network message string from a peer.
   */
  public handleChannelMessage(_peerId: string, channel: IDataChannel, rawData: unknown): void {
    const msg = parseNetMessage(rawData);
    if (!msg) return;

    switch (msg.type) {
      case 'JOIN_REQUEST': {
        this.processJoinRequest(channel, msg);
        break;
      }

      case 'COLOR_REQUEST': {
        this.processColorChangeRequest(channel, msg);
        break;
      }

      case 'FIRE_HITSCAN': {
        this.options.onHitscanFired?.(msg);
        // Relay hitscan event to other connected peers
        this.broadcast(msg, msg.shooterId);
        break;
      }

      default:
        break;
    }
  }

  /**
   * Handles a client's JOIN_REQUEST with authoritative color validation.
   */
  private processJoinRequest(
    channel: IDataChannel,
    msg: { type: 'JOIN_REQUEST'; playerId: string; playerName: string; proposedColor: string }
  ): void {
    const { playerId, playerName, proposedColor } = msg;

    // Authoritative check against color registry
    const validation = this.colorRegistry.requestColor(playerId, proposedColor);

    if (!validation.success) {
      // REJECT: Send COLOR_REJECTED with detailed reason and available colors
      const rejectedMsg: ColorRejectedMessage = {
        type: 'COLOR_REJECTED',
        playerId,
        attemptedColor: proposedColor,
        reason: validation.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        availableColors: validation.availableColors || this.colorRegistry.getAvailablePalette(),
      };
      channel.send(serializeNetMessage(rejectedMsg));
      return;
    }

    // ACCEPT: Assign verified neon color
    const assignedColor = validation.color!;
    const newPlayerInfo: SessionPlayerInfo = {
      id: playerId,
      name: playerName,
      color: assignedColor,
    };

    // Store peer connection and player info
    this.peers.set(playerId, {
      channel,
      info: newPlayerInfo,
    });

    // 1. Reply to joining client with full session player list
    const sessionPlayers = this.getAllSessionPlayers();
    const acceptedMsg: JoinAcceptedMessage = {
      type: 'JOIN_ACCEPTED',
      playerId,
      assignedColor,
      sessionPlayers,
    };
    channel.send(serializeNetMessage(acceptedMsg));

    // 2. Broadcast PLAYER_JOINED to all other active peers
    const joinedBroadcast: PlayerJoinedMessage = {
      type: 'PLAYER_JOINED',
      player: newPlayerInfo,
    };
    this.broadcast(joinedBroadcast, playerId);

    this.options.onPlayerJoined?.(newPlayerInfo);
  }

  /**
   * Handles dynamic color change request from already connected peer.
   */
  private processColorChangeRequest(
    channel: IDataChannel,
    msg: { type: 'COLOR_REQUEST'; playerId: string; requestedColor: string }
  ): void {
    const { playerId, requestedColor } = msg;
    const peer = this.peers.get(playerId);
    if (!peer) return;

    const validation = this.colorRegistry.requestColor(playerId, requestedColor);
    if (!validation.success) {
      const rejectedMsg: ColorRejectedMessage = {
        type: 'COLOR_REJECTED',
        playerId,
        attemptedColor: requestedColor,
        reason: validation.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        availableColors: validation.availableColors || this.colorRegistry.getAvailablePalette(),
      };
      channel.send(serializeNetMessage(rejectedMsg));
      return;
    }

    peer.info.color = validation.color!;
    const changedMsg: NetMessage = {
      type: 'COLOR_CHANGED',
      playerId,
      newColor: validation.color!,
    };
    this.broadcast(changedMsg);
  }

  /**
   * Handles peer disconnection: releases their assigned color and notifies peers.
   */
  public handlePeerDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    this.peers.delete(peerId);
    const freedColor = this.colorRegistry.releasePlayer(peerId) || peer.info.color;

    // Broadcast to remaining peers
    const leftMsg: PlayerLeftMessage = {
      type: 'PLAYER_LEFT',
      playerId: peerId,
      freedColor,
    };
    this.broadcast(leftMsg);

    this.options.onPlayerLeft?.(peerId, freedColor);
  }

  /**
   * Broadcasts a network message to all connected peers, optionally excluding one sender.
   */
  public broadcast(msg: NetMessage, excludePlayerId?: string): void {
    const payload = serializeNetMessage(msg);
    for (const [id, peer] of this.peers) {
      if (excludePlayerId && id === excludePlayerId) continue;
      try {
        peer.channel.send(payload);
      } catch (err) {
        console.error(`Error sending message to peer ${id}:`, err);
      }
    }
  }

  /**
   * Returns list of all players currently in the session (host + active clients).
   */
  public getAllSessionPlayers(): SessionPlayerInfo[] {
    const list: SessionPlayerInfo[] = [
      {
        id: this.hostPlayer.id,
        name: this.hostPlayer.name,
        color: this.hostPlayer.color,
      },
    ];

    for (const peer of this.peers.values()) {
      list.push({ ...peer.info });
    }

    return list;
  }

  /**
   * Get connected peer count (excluding host).
   */
  public getClientCount(): number {
    return this.peers.size;
  }

  /**
   * Check if a specific player ID is currently in the session.
   */
  public hasPlayer(playerId: string): boolean {
    return playerId === this.hostPlayer.id || this.peers.has(playerId);
  }
}

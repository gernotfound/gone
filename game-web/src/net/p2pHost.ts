/**
 * G.O.N.E. Authoritative P2P Host & Session Manager
 *
 * Enforces authoritative neon color uniqueness across all active players in
 * the P2P mesh, validates candidate colors via the color registry, manages
 * player lifecycle (join/leave/rejection), maintains authoritative combat records,
 * validates lag-compensated hitscan shots, and broadcasts 30 Hz binary world snapshots.
 */

import {
  COLOR_REJECT_REASONS,
  DEFAULT_NEON_HEX_LIST,
  isBinaryMessage,
  isFluorescentColor,
  normalizeHexColor,
  parseNetMessage,
  serializeNetMessage,
  toArrayBuffer,
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
import {
  PACKET_TYPE,
  STATE_FLAGS,
  HIT_FLAGS,
  SlotManager,
  encodeWorldSnapshot,
  encodeHitConfirmed,
  encodeFireHitscan,
  decodeClientState,
  decodeFireHitscan,
  type ClientStateData,
  type FireHitscanData,
  type PlayerSnapshotEntry,
} from './binaryProtocol.ts';
import type { WasmLagCompensator } from '../../pkg/game_core.js';

export interface IWasmLagCompensator {
  record_player_position(
    player_id: number,
    timestamp_ms: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number
  ): void;
  validate_rewind_hitscan(
    shooter_id: number,
    victim_id: number,
    weapon_type: number,
    shot_time_ms: number,
    max_unlag_ms: number,
    origin_x: number,
    origin_y: number,
    origin_z: number,
    dir_x: number,
    dir_y: number,
    dir_z: number,
    max_range: number
  ): string;
  clear_player(player_id: number): void;
}

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

export interface PlayerCombatRecord {
  id: string;
  slot: number;
  name: string;
  color: string;
  hp: number; // 0 to 100
  isAlive: boolean;
  deathTime: number; // ms timestamp
  shieldExpiresAt: number; // ms timestamp
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  activeWeapon: number;
  stateFlags: number;
  lastClientSeq: number;
  lastClientTimestamp: number;
}

export interface HitConfirmationEvent {
  victimId: string;
  shooterId: string;
  victimSlot: number;
  shooterSlot: number;
  damage: number;
  newHp: number;
  isShieldBlocked: boolean;
  isHeadshot: boolean;
  isFatal: boolean;
  hitX: number;
  hitY: number;
  hitZ: number;
}

export interface P2PHostOptions {
  hostPlayer: HostPlayerConfig;
  colorRegistry?: IColorRegistry;
  lagCompensator?: WasmLagCompensator | IWasmLagCompensator;
  onPlayerJoined?: (player: SessionPlayerInfo) => void;
  onPlayerLeft?: (playerId: string, freedColor: string) => void;
  onPlayerRespawned?: (playerId: string) => void;
  onHitConfirmed?: (hit: HitConfirmationEvent) => void;
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
  public options: P2PHostOptions;
  public lagCompensator: WasmLagCompensator | IWasmLagCompensator | null = null;

  // 1-Byte Slot Management
  public readonly slotManager = new SlotManager();
  public readonly slotToPlayerId = new Map<number, string>();
  public readonly playerIdToSlot = new Map<string, number>();

  // Authoritative player combat records
  public readonly playerRecords = new Map<string, PlayerCombatRecord>();

  // 30 Hz World Snapshot broadcast loop
  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotSeq: number = 0;

  constructor(options: P2PHostOptions) {
    this.options = options;
    this.colorRegistry = options.colorRegistry ?? new LocalColorRegistry();
    this.lagCompensator = options.lagCompensator ?? null;

    // Claim authoritative color for host player
    const desiredColor = options.hostPlayer.color || DEFAULT_NEON_HEX_LIST[0];
    const claim = this.colorRegistry.requestColor(options.hostPlayer.id, desiredColor);

    const hostAssignedColor = claim.success && claim.color ? claim.color : DEFAULT_NEON_HEX_LIST[0];

    this.hostPlayer = {
      id: options.hostPlayer.id,
      name: options.hostPlayer.name,
      color: hostAssignedColor,
      slot: 0,
    };

    // Initialize slot 0 for host
    this.slotManager.registerHost(this.hostPlayer.id);
    this.slotToPlayerId.set(0, this.hostPlayer.id);
    this.playerIdToSlot.set(this.hostPlayer.id, 0);

    const now = performance.now();
    this.playerRecords.set(this.hostPlayer.id, {
      id: this.hostPlayer.id,
      slot: 0,
      name: this.hostPlayer.name,
      color: hostAssignedColor,
      hp: 100,
      isAlive: true,
      deathTime: 0,
      shieldExpiresAt: now + 10000, // 10s initial invulnerability shield (R2)
      position: { x: 0, y: 17.5, z: 0 },
      yaw: 0,
      pitch: 0,
      activeWeapon: 0,
      stateFlags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
      lastClientSeq: 0,
      lastClientTimestamp: 0,
    });
  }

  public allocateSlot(playerId: string): number {
    const slot = this.slotManager.allocateSlot(playerId);
    this.slotToPlayerId.set(slot, playerId);
    this.playerIdToSlot.set(playerId, slot);
    return slot;
  }

  public releaseSlot(playerId: string): number | undefined {
    const slot = this.slotManager.releaseUuid(playerId);
    if (slot !== undefined) {
      this.slotToPlayerId.delete(slot);
      this.playerIdToSlot.delete(playerId);
    }
    return slot;
  }

  /**
   * Registers a new peer's DataChannel connection and binds listeners.
   */
  public registerPeer(peerId: string, channel: IDataChannel): void {
    if ('binaryType' in channel) {
      try {
        channel.binaryType = 'arraybuffer';
      } catch {
        // Mock fallback
      }
    }

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
   * Directly processes an incoming network message (text or binary) from a peer.
   */
  public handleChannelMessage(peerId: string, channel: IDataChannel, rawData: unknown): void {
    if (isBinaryMessage(rawData)) {
      this.handleBinaryChannelMessage(peerId, channel, toArrayBuffer(rawData));
      return;
    }

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
        this.broadcast(msg, msg.shooterId);
        break;
      }

      default:
        break;
    }
  }

  private handleBinaryChannelMessage(peerId: string, _channel: IDataChannel, buffer: ArrayBuffer): void {
    if (buffer.byteLength < 1) return;
    const opcode = new DataView(buffer).getUint8(0);

    switch (opcode) {
      case PACKET_TYPE.CLIENT_STATE: { // 0x01
        const state = decodeClientState(buffer);
        if (state) {
          const expectedSlot = this.playerIdToSlot.get(peerId);
          if (expectedSlot !== undefined && state.slot === expectedSlot) {
            this.processClientState(peerId, state);
          }
        }
        break;
      }
      case PACKET_TYPE.FIRE_HITSCAN: { // 0x03
        const shot = decodeFireHitscan(buffer);
        if (shot) {
          const expectedSlot = this.playerIdToSlot.get(peerId);
          if (expectedSlot !== undefined && shot.shooterSlot === expectedSlot) {
            this.processFireHitscan(peerId, shot);
          }
        }
        break;
      }
      default:
        break;
    }
  }

  private processClientState(peerId: string, state: ClientStateData): void {
    const record = this.playerRecords.get(peerId);
    if (!record || !record.isAlive) return;

    // Sequence wrap & drop protection
    const seqDiff = (state.seq - record.lastClientSeq) & 0xffff;
    if (seqDiff > 32768 && record.lastClientSeq !== 0) {
      return; // Stale or dropped packet
    }

    record.position = { x: state.x, y: state.y, z: state.z };
    record.yaw = state.yaw;
    record.pitch = state.pitch;
    record.activeWeapon = state.activeWeapon;
    record.lastClientSeq = state.seq;
    record.lastClientTimestamp = state.timestamp;

    // Feed position into Rust Lag Compensation Engine if available
    const now = performance.now();
    if (this.lagCompensator) {
      this.lagCompensator.record_player_position(
        record.slot,
        now,
        state.x,
        state.y,
        state.z,
        0.45, // cylinder radius 0.45m
        2.0   // cylinder height 2.0m
      );
    }
  }

  private processFireHitscan(shooterId: string, shot: FireHitscanData): void {
    const shooter = this.playerRecords.get(shooterId);
    if (!shooter || !shooter.isAlive) return;

    // 1. Relay binary shot tracer to other peers
    const relayBuffer = encodeFireHitscan(
      shot.shooterSlot,
      shot.weaponType,
      shot.shotSeq,
      shot.clientTimestamp,
      shot.origin,
      shot.direction
    );
    this.broadcastBinary(relayBuffer, shooterId);

    // 2. Authoritative Hit Validation across all potential targets
    const now = performance.now();
    for (const victim of this.playerRecords.values()) {
      if (victim.id === shooterId || !victim.isAlive) continue;

      let hitConfirmed = false;
      let damage = 0;
      let isHeadshot = false;
      let hitX = 0, hitY = 0, hitZ = 0;

      if (this.lagCompensator) {
        // Rust temporal rewind hit validation
        try {
          const resultJson = this.lagCompensator.validate_rewind_hitscan(
            shooter.slot,
            victim.slot,
            shot.weaponType,
            shot.clientTimestamp,
            1000.0, // max unlag rewind 1000ms
            shot.originX,
            shot.originY,
            shot.originZ,
            shot.dirX,
            shot.dirY,
            shot.dirZ,
            1000.0  // max range
          );
          const res = JSON.parse(resultJson);
          if (res.hit) {
            hitConfirmed = true;
            damage = res.damage ?? 34;
            isHeadshot = !!res.is_headshot;
            const dist = res.distance ?? 10.0;
            hitX = shot.originX + shot.dirX * dist;
            hitY = shot.originY + shot.dirY * dist;
            hitZ = shot.originZ + shot.dirZ * dist;
          }
        } catch {
          // Fallback to geometric check
          const fallback = this.checkRayCylinderHit(shot, victim.position);
          if (fallback.hit) {
            hitConfirmed = true;
            damage = fallback.damage;
            isHeadshot = fallback.isHeadshot;
            hitX = fallback.hitX;
            hitY = fallback.hitY;
            hitZ = fallback.hitZ;
          }
        }
      } else {
        // Geometric ray-cylinder fallback
        const fallback = this.checkRayCylinderHit(shot, victim.position);
        if (fallback.hit) {
          hitConfirmed = true;
          damage = fallback.damage;
          isHeadshot = fallback.isHeadshot;
          hitX = fallback.hitX;
          hitY = fallback.hitY;
          hitZ = fallback.hitZ;
        }
      }

      if (hitConfirmed) {
        let hitFlags = 0;
        if (isHeadshot) hitFlags |= HIT_FLAGS.HEADSHOT;

        // R2: Check 10s Invulnerability Shield
        if (victim.shieldExpiresAt > now) {
          damage = 0;
          hitFlags |= HIT_FLAGS.SHIELD_BLOCKED; // Shield blocked!
        } else {
          victim.hp = Math.max(0, victim.hp - damage);
          if (victim.hp === 0) {
            victim.isAlive = false;
            victim.deathTime = now;
            hitFlags |= HIT_FLAGS.FATAL_KILL; // Fatal kill
          }
        }

        // Broadcast binary HIT_CONFIRMED (16 bytes)
        const hitBuffer = encodeHitConfirmed(
          victim.slot,
          shooter.slot,
          hitFlags,
          Math.round(damage),
          Math.round(victim.hp),
          hitX,
          hitY,
          hitZ
        );
        this.broadcastBinary(hitBuffer);

        const eventData: HitConfirmationEvent = {
          victimId: victim.id,
          shooterId,
          victimSlot: victim.slot,
          shooterSlot: shooter.slot,
          damage,
          newHp: victim.hp,
          isHeadshot,
          isShieldBlocked: (hitFlags & HIT_FLAGS.SHIELD_BLOCKED) !== 0,
          isFatal: (hitFlags & HIT_FLAGS.FATAL_KILL) !== 0,
          hitX,
          hitY,
          hitZ,
        };

        this.options.onHitConfirmed?.(eventData);
        break; // Hitscan ray stops at first victim
      }
    }
  }

  /**
   * Authoritative hitscan fire entry point for host or programmatic invocations.
   */
  public fireHitscan(
    shooterId: string,
    weaponType: number,
    origin: [number, number, number],
    direction: [number, number, number]
  ): void {
    const slot = this.playerIdToSlot.get(shooterId) ?? (shooterId === this.hostPlayer.id ? 0 : undefined);
    if (slot === undefined) return;
    const shotData: FireHitscanData = {
      opcode: PACKET_TYPE.FIRE_HITSCAN,
      shooterSlot: slot,
      weaponType,
      shotSeq: 0,
      shotSequence: 0,
      clientTimestamp: performance.now(),
      originX: origin[0],
      originY: origin[1],
      originZ: origin[2],
      origin,
      dirX: direction[0],
      dirY: direction[1],
      dirZ: direction[2],
      direction,
    };
    this.processFireHitscan(shooterId, shotData);
  }

  /**
   * Applies damage to an authoritative player record with invulnerability shield enforcement.
   */
  public dealDamage(
    targetId: string,
    damage: number
  ): { effectiveDamage: number; newHp: number; isFatal: boolean; wasShielded: boolean } {
    const record = this.playerRecords.get(targetId);
    if (!record || !record.isAlive) {
      return { effectiveDamage: 0, newHp: record?.hp ?? 0, isFatal: false, wasShielded: false };
    }
    const now = performance.now();
    const wasShielded = record.shieldExpiresAt > now;
    const effectiveDamage = wasShielded ? 0 : Math.min(record.hp, Math.max(0, damage));
    record.hp = Math.max(0, record.hp - effectiveDamage);
    const isFatal = record.hp === 0;
    if (isFatal) {
      record.isAlive = false;
      record.deathTime = now;
      record.stateFlags = 0;
    }
    return { effectiveDamage, newHp: record.hp, isFatal, wasShielded };
  }

  /**
   * Respawns a player authoritatively at the central platform with 10s invulnerability shield.
   */
  public respawnPlayer(playerId: string): boolean {
    const record = this.playerRecords.get(playerId);
    if (!record) return false;
    const now = performance.now();
    record.isAlive = true;
    record.hp = 100;
    record.deathTime = 0;
    record.position = { x: 0, y: 17.5, z: 0 };
    record.shieldExpiresAt = now + 10000;
    record.stateFlags = STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE;
    this.options.onPlayerRespawned?.(record.id);
    return true;
  }

  /**
   * Geometric ray-cylinder intersection calculation for fallback hit validation.
   */
  private checkRayCylinderHit(
    shot: FireHitscanData,
    targetPos: { x: number; y: number; z: number }
  ): { hit: boolean; damage: number; isHeadshot: boolean; hitX: number; hitY: number; hitZ: number } {
    const radius = 0.45;
    const height = 2.0;

    // Vector from ray origin to cylinder center in horizontal XZ plane
    const dx = targetPos.x - shot.originX;
    const dz = targetPos.z - shot.originZ;

    const dirLenSq = shot.dirX * shot.dirX + shot.dirZ * shot.dirZ;
    if (dirLenSq < 1e-6) {
      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
    }

    // Projection along ray direction
    const tProj = (dx * shot.dirX + dz * shot.dirZ) / dirLenSq;
    if (tProj < 0) {
      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
    }

    const closestX = shot.originX + shot.dirX * tProj;
    const closestZ = shot.originZ + shot.dirZ * tProj;
    const distSq = (closestX - targetPos.x) ** 2 + (closestZ - targetPos.z) ** 2;

    if (distSq <= radius * radius) {
      const hitY = shot.originY + shot.dirY * tProj;
      if (hitY >= targetPos.y && hitY <= targetPos.y + height) {
        const isHeadshot = hitY >= targetPos.y + height * 0.8;
        const weaponBaseDamages: Record<number, number> = { 0: 34, 1: 90, 2: 80, 3: 20, 4: 50 };
        let baseDmg = weaponBaseDamages[shot.weaponType] ?? 34;
        if (isHeadshot) baseDmg *= 2.0;

        return {
          hit: true,
          damage: baseDmg,
          isHeadshot,
          hitX: closestX,
          hitY,
          hitZ: closestZ,
        };
      }
    }

    return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
  }

  // --- 30 Hz World Snapshot Broadcast Tick ---

  public startSnapshotTick(tickRateHz: number = 30): void {
    this.stopSnapshotTick();
    const intervalMs = Math.max(1, Math.round(1000 / tickRateHz));
    this.snapshotTickTimer = setInterval(() => {
      this.tickSnapshot();
    }, intervalMs);
  }

  public stopSnapshotTick(): void {
    if (this.snapshotTickTimer !== null) {
      clearInterval(this.snapshotTickTimer);
      this.snapshotTickTimer = null;
    }
  }

  public tickSnapshot(nowOverride?: number): void {
    const now = nowOverride ?? performance.now();

    // 1. Process 5.0s Death Cycle & Respawn (R1, R2)
    for (const record of this.playerRecords.values()) {
      if (!record.isAlive && record.deathTime !== 0 && now - record.deathTime >= 5000) {
        // 5s death phase expired: RESPAWN AT CENTER PLATFORM
        record.isAlive = true;
        record.hp = 100;
        record.deathTime = 0;
        record.position = { x: 0, y: 17.5, z: 0 };
        record.shieldExpiresAt = now + 10000; // 10s immunity shield on respawn
        this.options.onPlayerRespawned?.(record.id);
      }

      // Update bitfield flags
      let flags = 0;
      if (record.isAlive) flags |= STATE_FLAGS.ALIVE;
      if (record.shieldExpiresAt > now) flags |= STATE_FLAGS.SHIELD_ACTIVE;
      record.stateFlags = flags;
    }

    // 2. Build WorldSnapshot binary payload
    const players: PlayerSnapshotEntry[] = Array.from(this.playerRecords.values()).map((p) => ({
      slot: p.slot,
      hp: Math.round(p.hp),
      flags: p.stateFlags,
      activeWeapon: p.activeWeapon,
      x: p.position.x,
      y: p.position.y,
      z: p.position.z,
      yaw: p.yaw,
      pitch: p.pitch,
      timerRemainingMs: p.isAlive
        ? Math.max(0, Math.round(p.shieldExpiresAt - now))
        : Math.max(0, Math.round(5000 - (now - p.deathTime))),
    }));

    const buffer = encodeWorldSnapshot((this.snapshotSeq++) & 0xffff, now, players);
    this.broadcastBinary(buffer);
  }

  public broadcastBinary(buffer: ArrayBuffer, excludePlayerId?: string): void {
    for (const [id, peer] of this.peers) {
      if (excludePlayerId && id === excludePlayerId) continue;
      try {
        peer.channel.send(buffer);
      } catch (err) {
        console.error(`[P2PHost] Failed binary broadcast to ${id}:`, err);
      }
    }
  }

  // Lifecycle updates for host player (when Host is a local player in main.ts)
  public updateHostPlayerState(state: { position: { x: number; y: number; z: number }; yaw: number; pitch: number; activeWeapon?: number }): void {
    const record = this.playerRecords.get(this.hostPlayer.id);
    if (!record || !record.isAlive) return;

    record.position = state.position;
    record.yaw = state.yaw;
    record.pitch = state.pitch;
    if (state.activeWeapon !== undefined) record.activeWeapon = state.activeWeapon;

    const now = performance.now();
    if (this.lagCompensator) {
      this.lagCompensator.record_player_position(
        0,
        now,
        state.position.x,
        state.position.y,
        state.position.z,
        0.45,
        2.0
      );
    }
  }

  /**
   * Handles a client's JOIN_REQUEST with authoritative color validation and slot assignment.
   */
  private processJoinRequest(
    channel: IDataChannel,
    msg: { type: 'JOIN_REQUEST'; playerId: string; playerName: string; proposedColor: string }
  ): void {
    const { playerId, playerName, proposedColor } = msg;

    // Authoritative check against color registry
    const validation = this.colorRegistry.requestColor(playerId, proposedColor);

    if (!validation.success) {
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

    // Allocate 1-byte slot for joining client
    const assignedSlot = this.allocateSlot(playerId);
    const assignedColor = validation.color!;
    const newPlayerInfo: SessionPlayerInfo = {
      id: playerId,
      name: playerName,
      color: assignedColor,
      slot: assignedSlot,
    };

    // Store peer connection and player info
    this.peers.set(playerId, {
      channel,
      info: newPlayerInfo,
    });

    const now = performance.now();
    this.playerRecords.set(playerId, {
      id: playerId,
      slot: assignedSlot,
      name: playerName,
      color: assignedColor,
      hp: 100,
      isAlive: true,
      deathTime: 0,
      shieldExpiresAt: now + 10000, // 10s initial spawn immunity
      position: { x: 0, y: 17.5, z: 0 },
      yaw: 0,
      pitch: 0,
      activeWeapon: 0,
      stateFlags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
      lastClientSeq: 0,
      lastClientTimestamp: 0,
    });

    // 1. Reply to joining client with full session player list
    const sessionPlayers = this.getAllSessionPlayers();
    const acceptedMsg: JoinAcceptedMessage = {
      type: 'JOIN_ACCEPTED',
      playerId,
      assignedColor,
      assignedSlot,
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
    const record = this.playerRecords.get(playerId);
    if (record) {
      record.color = validation.color!;
    }

    const changedMsg: NetMessage = {
      type: 'COLOR_CHANGED',
      playerId,
      newColor: validation.color!,
    };
    this.broadcast(changedMsg);
  }

  /**
   * Handles peer disconnection: releases slot, assigned color, and notifies peers.
   */
  public handlePeerDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    this.peers.delete(peerId);
    this.releaseSlot(peerId);
    this.playerRecords.delete(peerId);

    if (this.lagCompensator && peer.info.slot !== undefined) {
      this.lagCompensator.clear_player(peer.info.slot);
    }

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
   * Broadcasts a network message (JSON) to all connected peers, optionally excluding one sender.
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
        slot: 0,
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

  public destroy(): void {
    this.stopSnapshotTick();
    this.peers.clear();
    this.playerRecords.clear();
    this.slotManager.reset();
    this.slotToPlayerId.clear();
    this.playerIdToSlot.clear();
  }
}

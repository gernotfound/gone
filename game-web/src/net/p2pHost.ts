/**
 * G.O.N.E. Authoritative P2P Host & Session Manager
 *
 * Enforces authoritative neon color uniqueness across all active players in
 * the P2P mesh, validates candidate colors via the color registry, manages
 * player lifecycle (join/leave/rejection), maintains authoritative combat records,
 * validates lag-compensated hitscan shots, and broadcasts 30 Hz binary world snapshots.
 */

import { COLOR_REJECT_REASONS, DEFAULT_NEON_HEX_LIST, isBinaryMessage, toArrayBuffer, type FireHitscanMessage, type IDataChannel, type SessionPlayerInfo } from './protocol.ts';
import {
  decodeLobbyMessage,
  encodeLobbyJoinAccepted,
  encodeLobbyColorRejected,
  encodeLobbyPlayerJoined,
  encodeLobbyPlayerLeft,
  encodeLobbyColorChanged,
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
  type HitConfirmedData,
  unpackHitConfirmed,
  type PlayerSnapshotEntry,
} from './binaryProtocol.ts';
import { CLIENT_STATE_EXT_FLAGS, HEALTH_PICKUP_AUTHORITY } from './clientStateExtensions.ts';
import { LocalColorRegistry, type IColorRegistry } from './colorRegistry.ts';
// Preserve the public host import path for existing clients and stress harnesses.
export { LocalColorRegistry, WasmColorRegistryAdapter } from './colorRegistry.ts';
export type { IColorRegistry, IWasmColorRegistry } from './colorRegistry.ts';
import type { WasmLagCompensator } from '../../pkg/game_core.js';
import { calculateWeaponDamageAtDistance, getWeaponRuntimeById, WEAPON_KEYS } from '../weapons/weaponConfig.ts';
import { intersectRobotHitbox } from './robotHitbox.ts';
import {
  MAZE_PLAYER_RADIUS,
  mazeSegmentCrossesWall,
  nearestMazeRayHitDistance,
} from '../world/mazeLayout.ts';
import {
  createMovementAuthorityState,
  isValidPitch,
  normalizeYaw,
  validateClientMovement,
  type MovementAuthorityState,
  type MovementRejectionReason,
} from './movementAuthority.ts';

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

// Approximate world-space muzzle offset of the third-person robot after the
// authored +Z model has been adapted to gameplay -Z forward and scaled by 0.67.
const VISUAL_MUZZLE_LOCAL_X = 0.77;
const VISUAL_MUZZLE_LOCAL_Y = 0.36;
const VISUAL_MUZZLE_LOCAL_Z = -1.15;

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
  hp: number;
  isAlive: boolean;
  deathTime: number;
  shieldExpiresAt: number;
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

export type RespawnPositionResolver = (slot: number) => { x: number; y: number; z: number };

export interface CombatValidationStats {
  /** Host receipt time of the last accepted guest shot. Never client-controlled. */
  lastClientShotTime: Map<string, number>;
  lastShotSeq: Map<string, number>;
  lastClientStateSeq: Map<string, number>;
  accepted: number;
  rejected: number;
  rejectedCadence: number;
  rejectedWeapon: number;
  rejectedDirection: number;
  acceptedClientStates: number;
  rejectedClientStates: number;
  rejectedMalformedState: number;
  rejectedStaleTimestamp: number;
  rejectedMovement: number;
  rejectedTeleport: number;
  rejectedHorizontalSpeed: number;
  rejectedVerticalMovement: number;
  rejectedWorldCollision: number;
}

function createCombatValidationStats(): CombatValidationStats {
  return {
    lastClientShotTime: new Map(),
    lastShotSeq: new Map(),
    lastClientStateSeq: new Map(),
    accepted: 0,
    rejected: 0,
    rejectedCadence: 0,
    rejectedWeapon: 0,
    rejectedDirection: 0,
    acceptedClientStates: 0,
    rejectedClientStates: 0,
    rejectedMalformedState: 0,
    rejectedStaleTimestamp: 0,
    rejectedMovement: 0,
    rejectedTeleport: 0,
    rejectedHorizontalSpeed: 0,
    rejectedVerticalMovement: 0,
    rejectedWorldCollision: 0,
  };
}

export class P2PHost {
  public readonly hostPlayer: SessionPlayerInfo;
  public readonly colorRegistry: IColorRegistry;

  private peers = new Map<string, PeerConnectionRecord>();
  public options: P2PHostOptions;
  public lagCompensator: WasmLagCompensator | IWasmLagCompensator | null = null;

  public readonly slotManager = new SlotManager();
  public readonly slotToPlayerId = new Map<number, string>();
  public readonly playerIdToSlot = new Map<string, number>();
  public readonly playerRecords = new Map<string, PlayerCombatRecord>();

  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;
  private snapshotSeq: number = 0;
  private respawnPositionResolver: RespawnPositionResolver | null = null;
  private authoritativeRespawnCount = 0;
  private readonly lastHealthPickupAt = new Map<string, number>();
  private readonly movementAuthority = new Map<string, MovementAuthorityState>();
  public readonly __gonePvpHardeningState: CombatValidationStats = createCombatValidationStats();
  private roundLocked = false;
  public blockedRoundShots = 0;
  private readonly acceptedShotObservers = new Set<(shooterId: string, shot: FireHitscanData) => void>();
  private readonly confirmedHitObservers = new Set<(hit: HitConfirmedData) => void>();

  /** The host is the sole authority for whether the round accepts shots. */
  public setRoundLocked(locked: boolean): void { this.roundLocked = locked; }
  public isRoundLocked(): boolean { return this.roundLocked; }

  public subscribeAcceptedShot(listener: (shooterId: string, shot: FireHitscanData) => void): () => void {
    this.acceptedShotObservers.add(listener);
    return () => { this.acceptedShotObservers.delete(listener); };
  }

  public subscribeConfirmedHit(listener: (hit: HitConfirmedData) => void): () => void {
    this.confirmedHitObservers.add(listener);
    return () => { this.confirmedHitObservers.delete(listener); };
  }

  private notifyAcceptedShot(shooterId: string, shot: FireHitscanData): void {
    for (const listener of this.acceptedShotObservers) {
      try { listener(shooterId, shot); } catch (error) { console.error('[P2PHost] Shot observer failed', error); }
    }
  }

  private notifyConfirmedHit(hit: HitConfirmedData): void {
    for (const listener of this.confirmedHitObservers) {
      try { listener(hit); } catch (error) { console.error('[P2PHost] Hit observer failed', error); }
    }
  }

  constructor(options: P2PHostOptions) {
    this.options = options;
    this.colorRegistry = options.colorRegistry ?? new LocalColorRegistry();
    this.lagCompensator = options.lagCompensator ?? null;

    const desiredColor = options.hostPlayer.color || DEFAULT_NEON_HEX_LIST[0];
    const claim = this.colorRegistry.requestColor(options.hostPlayer.id, desiredColor);
    const hostAssignedColor = claim.success && claim.color ? claim.color : DEFAULT_NEON_HEX_LIST[0];

    this.hostPlayer = {
      id: options.hostPlayer.id,
      name: options.hostPlayer.name,
      color: hostAssignedColor,
      slot: 0,
    };

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
      shieldExpiresAt: now + 10000,
      position: { x: 0, y: 17.5, z: 0 },
      yaw: 0,
      pitch: 0,
      activeWeapon: 0,
      stateFlags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
      lastClientSeq: 0,
      lastClientTimestamp: 0,
    });
  }

  public setRespawnPositionResolver(resolver: RespawnPositionResolver | null): void {
    this.respawnPositionResolver = resolver;
  }

  public getAuthoritativeRespawnCount(): number {
    return this.authoritativeRespawnCount;
  }

  private resetMovementAuthority(playerId: string, now: number): void {
    if (playerId === this.hostPlayer.id) return;
    this.movementAuthority.set(playerId, createMovementAuthorityState(now));
  }

  private rejectClientState(reason?: MovementRejectionReason): void {
    const stats = this.__gonePvpHardeningState;
    stats.rejectedClientStates += 1;
    if (!reason) {
      stats.rejectedMalformedState += 1;
      return;
    }
    stats.rejectedMovement += 1;
    if (reason === 'teleport') stats.rejectedTeleport += 1;
    else if (reason === 'horizontal-speed') stats.rejectedHorizontalSpeed += 1;
    else if (reason === 'world-collision') stats.rejectedWorldCollision += 1;
    else stats.rejectedVerticalMovement += 1;
  }

  private resolveRespawnPosition(slot: number): { x: number; y: number; z: number } {
    const resolved = this.respawnPositionResolver?.(slot);
    if (resolved && [resolved.x, resolved.y, resolved.z].every(Number.isFinite)) {
      return { x: resolved.x, y: resolved.y, z: resolved.z };
    }
    // Compatibility fallback for isolated tests/callers that do not install the gameplay resolver.
    return { x: 0, y: 17.5, z: 0 };
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
    this.lastHealthPickupAt.delete(playerId);
    this.movementAuthority.delete(playerId);
    return slot;
  }

  public registerPeer(peerId: string, channel: IDataChannel): void {
    if ('binaryType' in channel) {
      try { channel.binaryType = 'arraybuffer'; } catch { /* mock fallback */ }
    }

    channel.onmessage = (ev: { data: any }) => this.handleChannelMessage(peerId, channel, ev.data);
    channel.onclose = () => this.handlePeerDisconnect(peerId);
    channel.onerror = (err: any) => this.options.onError?.(new Error(`Peer ${peerId} error: ${err}`));
  }

  public handleChannelMessage(peerId: string, channel: IDataChannel, rawData: unknown): void {
    if (isBinaryMessage(rawData)) this.handleBinaryChannelMessage(peerId, channel, toArrayBuffer(rawData));
  }

  private handleBinaryChannelMessage(peerId: string, channel: IDataChannel, buffer: ArrayBuffer): void {
    if (buffer.byteLength < 1) return;
    const opcode = new DataView(buffer).getUint8(0);

    if (opcode >= 0x10) {
      const msg = decodeLobbyMessage(buffer);
      if (!msg) return;
      switch (msg.type) {
        case 'JOIN_REQUEST': this.processJoinRequest(channel, msg as any); break;
        case 'COLOR_REQUEST': this.processColorChangeRequest(channel, msg as any); break;
      }
      return;
    }

    switch (opcode) {
      case PACKET_TYPE.CLIENT_STATE: {
        const state = decodeClientState(buffer);
        if (state) {
          const expectedSlot = this.playerIdToSlot.get(peerId);
          if (expectedSlot !== undefined && state.slot === expectedSlot) this.processClientState(peerId, state);
        }
        break;
      }
      case PACKET_TYPE.FIRE_HITSCAN: {
        const shot = decodeFireHitscan(buffer);
        if (shot) {
          const expectedSlot = this.playerIdToSlot.get(peerId);
          if (expectedSlot !== undefined && shot.shooterSlot === expectedSlot) this.processFireHitscan(peerId, shot);
        }
        break;
      }
      default: break;
    }
  }

  private processClientState(peerId: string, state: ClientStateData): void {
    const record = this.playerRecords.get(peerId);
    if (!record || !record.isAlive) return;

    const stateSeq = Number(state.seq) & 0xffff;
    const previousStateSeq = this.__gonePvpHardeningState.lastClientStateSeq.get(peerId);
    if (previousStateSeq !== undefined) {
      const seqDiff = (stateSeq - previousStateSeq) & 0xffff;
      // Ordered DataChannels must only advance. Reject duplicates and values
      // from the stale half of the modulo-16-bit sequence space.
      if (seqDiff === 0 || seqDiff > 0x8000) {
        this.rejectClientState();
        return;
      }
    }

    const timestamp = Number(state.timestamp);
    const x = Number(state.x);
    const y = Number(state.y);
    const z = Number(state.z);
    const yaw = Number(state.yaw);
    const pitch = Number(state.pitch);
    const activeWeapon = Number(state.activeWeapon);
    if (![timestamp, x, y, z, yaw, pitch].every(Number.isFinite)) {
      this.rejectClientState();
      return;
    }
    if (!Number.isInteger(activeWeapon) || activeWeapon < 0 || activeWeapon >= WEAPON_KEYS.length) {
      this.rejectClientState();
      return;
    }
    if (!isValidPitch(pitch)) {
      this.rejectClientState();
      return;
    }
    if (previousStateSeq !== undefined && timestamp <= record.lastClientTimestamp) {
      this.__gonePvpHardeningState.rejectedClientStates += 1;
      this.__gonePvpHardeningState.rejectedStaleTimestamp += 1;
      return;
    }

    const now = performance.now();
    const authority = this.movementAuthority.get(peerId) ?? createMovementAuthorityState(now);
    const movement = validateClientMovement(record.position, { x, y, z }, authority, now);
    if (!movement.ok) {
      this.rejectClientState(movement.reason);
      return;
    }
    if (
      mazeSegmentCrossesWall(
        record.position,
        { x, z },
        MAZE_PLAYER_RADIUS,
      )
    ) {
      this.rejectClientState('world-collision');
      return;
    }

    record.position = { x, y, z };
    record.yaw = normalizeYaw(yaw);
    record.pitch = pitch;
    record.activeWeapon = activeWeapon;
    record.lastClientSeq = stateSeq;
    record.lastClientTimestamp = timestamp;
    this.movementAuthority.set(peerId, movement.next);
    this.__gonePvpHardeningState.lastClientStateSeq.set(peerId, stateSeq);
    this.__gonePvpHardeningState.acceptedClientStates += 1;

    if ((state.flags & CLIENT_STATE_EXT_FLAGS.HEALTH_PICKUP_REQUEST) !== 0 && record.hp < 100) {
      const supplyDistance = Math.hypot(
        record.position.x - HEALTH_PICKUP_AUTHORITY.centerX,
        record.position.z - HEALTH_PICKUP_AUTHORITY.centerZ,
      );
      const previousPickupAt = this.lastHealthPickupAt.get(peerId) ?? -Infinity;
      if (
        supplyDistance >= HEALTH_PICKUP_AUTHORITY.minRadius
        && supplyDistance <= HEALTH_PICKUP_AUTHORITY.maxRadius
        && now - previousPickupAt >= HEALTH_PICKUP_AUTHORITY.cooldownMs
      ) {
        record.hp = 100;
        this.lastHealthPickupAt.set(peerId, now);
      }
    }

    if (this.lagCompensator) {
      this.lagCompensator.record_player_position(
        record.slot,
        now,
        record.position.x,
        record.position.y,
        record.position.z,
        0.45,
        2.0,
      );
    }
  }

  private visualMuzzleOrigin(shooter: PlayerCombatRecord): [number, number, number] {
    const cos = Math.cos(shooter.yaw);
    const sin = Math.sin(shooter.yaw);
    return [
      shooter.position.x + VISUAL_MUZZLE_LOCAL_X * cos + VISUAL_MUZZLE_LOCAL_Z * sin,
      shooter.position.y + VISUAL_MUZZLE_LOCAL_Y,
      shooter.position.z - VISUAL_MUZZLE_LOCAL_X * sin + VISUAL_MUZZLE_LOCAL_Z * cos,
    ];
  }

  private rejectShot(reason: 'cadence' | 'weapon' | 'direction'): void {
    const state = this.__gonePvpHardeningState;
    state.rejected += 1;
    if (reason === 'cadence') state.rejectedCadence += 1;
    else if (reason === 'weapon') state.rejectedWeapon += 1;
    else state.rejectedDirection += 1;
  }

  private validateAndAnchorShot(
    shooterId: string,
    shooter: PlayerCombatRecord,
    shot: FireHitscanData,
  ): boolean {
    const weaponType = Number(shot.weaponType);
    if (!Number.isInteger(weaponType) || weaponType < 0 || weaponType >= WEAPON_KEYS.length) {
      this.rejectShot('weapon');
      return false;
    }

    const dx = Number(shot.dirX);
    const dy = Number(shot.dirY);
    const dz = Number(shot.dirZ);
    if (![dx, dy, dz].every(Number.isFinite)) {
      this.rejectShot('direction');
      return false;
    }
    const directionLength = Math.hypot(dx, dy, dz);
    if (!Number.isFinite(directionLength) || directionLength < 1e-5) {
      this.rejectShot('direction');
      return false;
    }
    const nx = dx / directionLength;
    const ny = dy / directionLength;
    const nz = dz / directionLength;
    shot.dirX = nx;
    shot.dirY = ny;
    shot.dirZ = nz;
    shot.direction = [nx, ny, nz];

    if (shooterId !== this.hostPlayer.id) {
      if (Number(shooter.activeWeapon) !== weaponType) {
        this.rejectShot('weapon');
        return false;
      }

      const state = this.__gonePvpHardeningState;
      const cfg = getWeaponRuntimeById(weaponType);
      // Fire cadence is an authority decision and must use the host clock.
      // clientTimestamp is intentionally retained only for bounded lag rewind.
      const hostReceiptTime = performance.now();
      const previousTime = state.lastClientShotTime.get(shooterId);
      if (previousTime !== undefined) {
        const elapsed = hostReceiptTime - previousTime;
        const minimumCadenceMs = (1000 / Math.max(0.1, cfg.fireRateRps)) * 0.68;
        if (elapsed < minimumCadenceMs) {
          this.rejectShot('cadence');
          return false;
        }
      }

      const seq = Number(shot.shotSeq) & 0xff;
      const previousSeq = state.lastShotSeq.get(shooterId);
      if (previousSeq !== undefined) {
        const seqDiff = (seq - previousSeq) & 0xff;
        if (seqDiff === 0 || seqDiff > 0x80) {
          this.rejectShot('cadence');
          return false;
        }
      }
      state.lastShotSeq.set(shooterId, seq);
      state.lastClientShotTime.set(shooterId, hostReceiptTime);
    }

    // The client sends the camera/crosshair origin. Horizontal coordinates are
    // host-authoritative; vertical origin is accepted only inside the eye band.
    const playerY = Number(shooter.position.y);
    const suppliedY = Number(shot.originY);
    const minEyeY = playerY - 1.35;
    const maxEyeY = playerY + 0.25;
    const originY = Number.isFinite(suppliedY) && suppliedY >= minEyeY && suppliedY <= maxEyeY
      ? suppliedY
      : playerY - 0.2;
    const originX = Number(shooter.position.x);
    const originZ = Number(shooter.position.z);
    shot.originX = originX;
    shot.originY = originY;
    shot.originZ = originZ;
    shot.origin = [originX, originY, originZ];

    this.__gonePvpHardeningState.accepted += 1;
    return true;
  }

  private processFireHitscan(shooterId: string, shot: FireHitscanData): void {
    if (this.roundLocked) {
      this.blockedRoundShots += 1;
      return;
    }
    const shooter = this.playerRecords.get(shooterId);
    if (!shooter || !shooter.isAlive) return;
    if (!this.validateAndAnchorShot(shooterId, shooter, shot)) return;

    // Relay only the visual tracer with the third-person weapon muzzle as start.
    // Authoritative validation below still uses the original camera/aim ray.
    const visualOrigin = this.visualMuzzleOrigin(shooter);
    const relayBuffer = encodeFireHitscan(
      shot.shooterSlot,
      shot.weaponType,
      shot.shotSeq,
      shot.clientTimestamp,
      visualOrigin,
      shot.direction
    );
    this.broadcastBinary(relayBuffer, shooterId);
    this.notifyAcceptedShot(shooterId, shot);

    const now = performance.now();
    const mazeWallDistance = nearestMazeRayHitDistance(
      { x: shot.originX, y: shot.originY, z: shot.originZ },
      { x: shot.dirX, y: shot.dirY, z: shot.dirZ },
      getWeaponRuntimeById(shot.weaponType).maxRange,
    );
    type CandidateHit = {
      victim: PlayerCombatRecord;
      damage: number;
      isHeadshot: boolean;
      distance: number;
      hitX: number;
      hitY: number;
      hitZ: number;
    };
    let nearestHit: CandidateHit | null = null;

    for (const victim of this.playerRecords.values()) {
      if (victim.id === shooterId || !victim.isAlive) continue;

      let hitConfirmed = false;
      let damage = 0;
      let isHeadshot = false;
      let hitDistance = Number.POSITIVE_INFINITY;
      let hitX = 0, hitY = 0, hitZ = 0;

      if (this.lagCompensator) {
        try {
          const resultJson = this.lagCompensator.validate_rewind_hitscan(
            shooter.slot,
            victim.slot,
            shot.weaponType,
            shot.clientTimestamp,
            1000.0,
            shot.originX,
            shot.originY,
            shot.originZ,
            shot.dirX,
            shot.dirY,
            shot.dirZ,
            getWeaponRuntimeById(shot.weaponType).maxRange
          );
          const res = JSON.parse(resultJson);
          const parsedDistance = Number(res.distance);
          if (res.hit && Number.isFinite(parsedDistance) && parsedDistance >= 0) {
            isHeadshot = !!res.is_headshot;
            hitDistance = parsedDistance;
            const parsedDamage = Number(res.damage);
            damage = Number.isFinite(parsedDamage)
              ? parsedDamage
              : calculateWeaponDamageAtDistance(shot.weaponType, hitDistance, isHeadshot);
            hitConfirmed = damage > 0;
            hitX = shot.originX + shot.dirX * hitDistance;
            hitY = shot.originY + shot.dirY * hitDistance;
            hitZ = shot.originZ + shot.dirZ * hitDistance;
          }
        } catch {
          const fallback = this.checkRayCylinderHit(shot, victim.position);
          if (fallback.hit) {
            hitConfirmed = true;
            damage = fallback.damage;
            isHeadshot = fallback.isHeadshot;
            hitX = fallback.hitX;
            hitY = fallback.hitY;
            hitZ = fallback.hitZ;
            hitDistance = Math.hypot(
              hitX - shot.originX,
              hitY - shot.originY,
              hitZ - shot.originZ,
            );
          }
        }
      } else {
        const fallback = this.checkRayCylinderHit(shot, victim.position);
        if (fallback.hit) {
          hitConfirmed = true;
          damage = fallback.damage;
          isHeadshot = fallback.isHeadshot;
          hitX = fallback.hitX;
          hitY = fallback.hitY;
          hitZ = fallback.hitZ;
          hitDistance = Math.hypot(
            hitX - shot.originX,
            hitY - shot.originY,
            hitZ - shot.originZ,
          );
        }
      }

      if (
        hitConfirmed
        && Number.isFinite(hitDistance)
        && hitDistance >= 0
        && (nearestHit === null || hitDistance < nearestHit.distance)
      ) {
        nearestHit = { victim, damage, isHeadshot, distance: hitDistance, hitX, hitY, hitZ };
      }
    }

    if (!nearestHit) return;
    if (mazeWallDistance !== null && mazeWallDistance <= nearestHit.distance + 0.01) return;

    const { victim, isHeadshot, hitX, hitY, hitZ } = nearestHit;
    let damage = nearestHit.damage;
    let hitFlags = 0;
    if (isHeadshot) hitFlags |= HIT_FLAGS.HEADSHOT;

    if (victim.shieldExpiresAt > now) {
      damage = 0;
      hitFlags |= HIT_FLAGS.SHIELD_BLOCKED;
    } else {
      victim.hp = Math.max(0, victim.hp - damage);
      if (victim.hp === 0) {
        victim.isAlive = false;
        victim.deathTime = now;
        hitFlags |= HIT_FLAGS.FATAL_KILL;
      }
    }

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
    const confirmedHit = unpackHitConfirmed(hitBuffer);
    if (confirmedHit) this.notifyConfirmedHit(confirmedHit);

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
  }

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

  public respawnPlayer(playerId: string): boolean {
    const record = this.playerRecords.get(playerId);
    if (!record) return false;
    const now = performance.now();
    record.isAlive = true;
    record.hp = 100;
    record.deathTime = 0;
    record.position = this.resolveRespawnPosition(record.slot);
    record.shieldExpiresAt = now + 10000;
    record.stateFlags = STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE;
    this.lagCompensator?.clear_player(record.slot);
    this.resetMovementAuthority(record.id, now);
    this.authoritativeRespawnCount += 1;
    this.options.onPlayerRespawned?.(record.id);
    return true;
  }

  private checkRayCylinderHit(
    shot: FireHitscanData,
    targetPos: { x: number; y: number; z: number }
  ): { hit: boolean; damage: number; isHeadshot: boolean; hitX: number; hitY: number; hitZ: number } {
    // Method name is retained for compatibility with older tests/callers, but
    // authoritative geometry now matches the visible robot AABBs.
    const cfg = getWeaponRuntimeById(shot.weaponType);
    const hit = intersectRobotHitbox(
      [shot.originX, shot.originY, shot.originZ],
      [shot.dirX, shot.dirY, shot.dirZ],
      targetPos,
      cfg.maxRange,
    );
    if (!hit) {
      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
    }

    const damage = calculateWeaponDamageAtDistance(shot.weaponType, hit.distance, hit.isHeadshot);
    if (damage <= 0) {
      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
    }

    return {
      hit: true,
      damage,
      isHeadshot: hit.isHeadshot,
      hitX: shot.originX + shot.dirX * hit.distance,
      hitY: shot.originY + shot.dirY * hit.distance,
      hitZ: shot.originZ + shot.dirZ * hit.distance,
    };
  }

  public startSnapshotTick(tickRateHz: number = 30): void {
    this.stopSnapshotTick();
    const intervalMs = Math.max(1, Math.round(1000 / tickRateHz));
    this.snapshotTickTimer = setInterval(() => this.tickSnapshot(), intervalMs);
  }

  public stopSnapshotTick(): void {
    if (this.snapshotTickTimer !== null) {
      clearInterval(this.snapshotTickTimer);
      this.snapshotTickTimer = null;
    }
  }

  public tickSnapshot(nowOverride?: number): void {
    const now = nowOverride ?? performance.now();

    for (const record of this.playerRecords.values()) {
      if (!record.isAlive && record.deathTime !== 0 && now - record.deathTime >= 5000) {
        record.isAlive = true;
        record.hp = 100;
        record.deathTime = 0;
        record.position = this.resolveRespawnPosition(record.slot);
        record.shieldExpiresAt = now + 10000;
        this.lagCompensator?.clear_player(record.slot);
        this.resetMovementAuthority(record.id, now);
        this.authoritativeRespawnCount += 1;
        this.options.onPlayerRespawned?.(record.id);
      }

      let flags = 0;
      if (record.isAlive) flags |= STATE_FLAGS.ALIVE;
      if (record.shieldExpiresAt > now) flags |= STATE_FLAGS.SHIELD_ACTIVE;
      record.stateFlags = flags;
    }

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
    const stalePeers: string[] = [];

    for (const [id, peer] of this.peers) {
      if (excludePlayerId && id === excludePlayerId) continue;

      const state = peer.channel.readyState;
      if (state && state !== 'open') {
        if (state === 'closing' || state === 'closed') stalePeers.push(id);
        continue;
      }

      try {
        peer.channel.send(buffer);
      } catch (error) {
        const currentState = peer.channel.readyState;
        const message = error instanceof Error ? error.message : String(error);
        const expectedClosedChannel =
          currentState === 'closing' ||
          currentState === 'closed' ||
          /datachannel.*non aperto|datachannel.*not open|closing|closed/i.test(message);

        if (expectedClosedChannel) {
          if (currentState === 'closing' || currentState === 'closed') stalePeers.push(id);
          continue;
        }

        console.error(`[P2PHost] Failed binary broadcast to ${id}:`, error);
      }
    }

    for (const id of stalePeers) this.handlePeerDisconnect(id);
  }

  public updateHostPlayerState(state: { position: { x: number; y: number; z: number }; yaw: number; pitch: number; activeWeapon?: number }): void {
    const record = this.playerRecords.get(this.hostPlayer.id);
    if (!record || !record.isAlive) return;

    record.position = state.position;
    record.yaw = state.yaw;
    record.pitch = state.pitch;
    if (state.activeWeapon !== undefined) record.activeWeapon = state.activeWeapon;

    const now = performance.now();
    if (this.lagCompensator) {
      this.lagCompensator.record_player_position(0, now, state.position.x, state.position.y, state.position.z, 0.45, 2.0);
    }
  }

  private processJoinRequest(
    channel: IDataChannel,
    msg: { type: 'JOIN_REQUEST'; playerId: string; playerName: string; proposedColor: string }
  ): void {
    const { playerId, playerName, proposedColor } = msg;
    const validation = this.colorRegistry.requestColor(playerId, proposedColor);

    if (!validation.success) {
      channel.send(encodeLobbyColorRejected(
        playerId,
        proposedColor,
        validation.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        validation.availableColors || this.colorRegistry.getAvailablePalette()
      ));
      return;
    }

    const assignedSlot = this.allocateSlot(playerId);
    const assignedColor = validation.color!;
    const newPlayerInfo: SessionPlayerInfo = {
      id: playerId,
      name: playerName,
      color: assignedColor,
      slot: assignedSlot,
    };

    this.peers.set(playerId, { channel, info: newPlayerInfo });

    const now = performance.now();
    const initialPosition = this.resolveRespawnPosition(assignedSlot);
    this.playerRecords.set(playerId, {
      id: playerId,
      slot: assignedSlot,
      name: playerName,
      color: assignedColor,
      hp: 100,
      isAlive: true,
      deathTime: 0,
      shieldExpiresAt: now + 10000,
      position: initialPosition,
      yaw: 0,
      pitch: 0,
      activeWeapon: 0,
      stateFlags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
      lastClientSeq: 0,
      lastClientTimestamp: 0,
    });
    this.resetMovementAuthority(playerId, now);

    const sessionPlayers = this.getAllSessionPlayers();
    channel.send(encodeLobbyJoinAccepted(playerId, assignedColor, assignedSlot, sessionPlayers));
    this.broadcastBinary(encodeLobbyPlayerJoined(newPlayerInfo), playerId);
    this.options.onPlayerJoined?.(newPlayerInfo);
  }

  private processColorChangeRequest(
    channel: IDataChannel,
    msg: { type: 'COLOR_REQUEST'; playerId: string; requestedColor: string }
  ): void {
    const { playerId, requestedColor } = msg;
    const peer = this.peers.get(playerId);
    if (!peer) return;

    const validation = this.colorRegistry.requestColor(playerId, requestedColor);
    if (!validation.success) {
      channel.send(encodeLobbyColorRejected(
        playerId,
        requestedColor,
        validation.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        validation.availableColors || this.colorRegistry.getAvailablePalette()
      ));
      return;
    }

    peer.info.color = validation.color!;
    const record = this.playerRecords.get(playerId);
    if (record) record.color = validation.color!;
    this.broadcastBinary(encodeLobbyColorChanged(playerId, validation.color!));
  }

  public handlePeerDisconnect(peerId: string): void {
    const peer = this.peers.get(peerId);
    if (!peer) return;

    this.peers.delete(peerId);
    this.releaseSlot(peerId);
    this.playerRecords.delete(peerId);
    this.__gonePvpHardeningState.lastClientShotTime.delete(peerId);
    this.__gonePvpHardeningState.lastShotSeq.delete(peerId);
    this.__gonePvpHardeningState.lastClientStateSeq.delete(peerId);
    this.movementAuthority.delete(peerId);

    if (this.lagCompensator && peer.info.slot !== undefined) {
      this.lagCompensator.clear_player(peer.info.slot);
    }

    const freedColor = this.colorRegistry.releasePlayer(peerId) || peer.info.color;
    this.broadcastBinary(encodeLobbyPlayerLeft(peerId, freedColor));
    this.options.onPlayerLeft?.(peerId, freedColor);
  }

  public getAllSessionPlayers(): SessionPlayerInfo[] {
    const list: SessionPlayerInfo[] = [{
      id: this.hostPlayer.id,
      name: this.hostPlayer.name,
      color: this.hostPlayer.color,
      slot: 0,
    }];
    for (const peer of this.peers.values()) list.push({ ...peer.info });
    return list;
  }

  public getClientCount(): number {
    return this.peers.size;
  }

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
    this.lastHealthPickupAt.clear();
    this.movementAuthority.clear();
    this.__gonePvpHardeningState.lastClientShotTime.clear();
    this.__gonePvpHardeningState.lastShotSeq.clear();
    this.__gonePvpHardeningState.lastClientStateSeq.clear();
    this.acceptedShotObservers.clear();
    this.confirmedHitObservers.clear();
    this.roundLocked = false;
  }
}

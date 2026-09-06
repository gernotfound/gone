/**
 * game-web/src/net/binaryProtocol.ts
 *
 * G.O.N.E. High-Frequency Binary Netcode Protocol & Zero-Allocation Serializer
 *
 * Implements binary ArrayBuffer / DataView Little-Endian serialization for:
 * - 0x01: CLIENT_STATE   (32 bytes)
 * - 0x02: WORLD_SNAPSHOT (8 + 28*N bytes)
 * - 0x03: FIRE_HITSCAN   (32 bytes)
 * - 0x04: HIT_CONFIRMED  (16 bytes / 20 bytes)
 *
 * Zero-allocation send buffers and in-place decoders guarantee maximum framerate smoothness.
 */

// ============================================================================
// 1. CONSTANTS & OPCODES
// ============================================================================

export const PACKET_OPCODES = {
  CLIENT_STATE: 0x01,
  WORLD_SNAPSHOT: 0x02,
  FIRE_HITSCAN: 0x03,
  HIT_CONFIRMED: 0x04,
} as const;

export const PACKET_TYPE = PACKET_OPCODES;

export type PacketOpcode = (typeof PACKET_OPCODES)[keyof typeof PACKET_OPCODES];

// Exact Packet Byte Sizes
export const CLIENT_STATE_BYTES = 32;
export const SNAPSHOT_HEADER_BYTES = 8;
export const SNAPSHOT_PLAYER_BYTES = 28;
export const FIRE_HITSCAN_BYTES = 32;
export const HIT_CONFIRMED_BYTES = 16;
export const HIT_CONFIRMED_FLOAT_BYTES = 20;

export const MAX_PLAYERS_PER_SESSION = 16;
export const HOST_SLOT = 0;

// Bitmasks: CLIENT_STATE flags (Offset 28)
export const CLIENT_FLAGS = {
  GROUNDED: 1 << 0, // 0x01
  CROUCH: 1 << 1,   // 0x02
  SPRINT: 1 << 2,   // 0x04
  FIRING: 1 << 3,   // 0x08
  RELOAD: 1 << 4,   // 0x10
  AIMING: 1 << 5,   // 0x20
} as const;

// Bitmasks: WORLD_SNAPSHOT player state flags (Offset +2)
export const STATE_FLAGS = {
  ALIVE: 1 << 0,         // 0x01 (1 = alive, 0 = dead)
  SHIELD_ACTIVE: 1 << 1, // 0x02 (10s invulnerability)
  CROUCHING: 1 << 2,     // 0x04
  SPRINTING: 1 << 3,     // 0x08
  FIRING: 1 << 4,        // 0x10
} as const;

// Bitmasks: HIT_CONFIRMED flags (Offset 3)
export const HIT_FLAGS = {
  HEADSHOT: 1 << 0,       // 0x01 (2x damage)
  SHIELD_BLOCKED: 1 << 1, // 0x02 (0 damage dealt)
  FATAL_KILL: 1 << 2,     // 0x04 (HP dropped to 0)
} as const;

// ============================================================================
// 2. DATA STRUCTURES & TYPE DEFINITIONS
// ============================================================================

export interface ClientStatePacket {
  opcode: typeof PACKET_OPCODES.CLIENT_STATE;
  slot: number;
  playerSlot: number;
  seq: number;
  sequence: number;
  timestamp: number;
  x: number;
  y: number;
  z: number;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  flags: number;
  activeWeapon: number;
  reserved: number;
}

export type ClientStateData = ClientStatePacket;

export interface PlayerSnapshotEntry {
  slot: number;
  playerSlot?: number;
  hp: number;
  health?: number;
  flags: number;
  stateFlags?: number;
  activeWeapon: number;
  x: number;
  y: number;
  z: number;
  position?: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  timerRemainingMs: number;
}

export type PlayerSnapshotData = PlayerSnapshotEntry;

export interface WorldSnapshotPacket {
  opcode: typeof PACKET_OPCODES.WORLD_SNAPSHOT;
  count: number;
  seq: number;
  snapshotSeq: number;
  hostTimestamp: number;
  players: PlayerSnapshotEntry[];
}

export type WorldSnapshotData = WorldSnapshotPacket;

export interface FireHitscanPacket {
  opcode: typeof PACKET_OPCODES.FIRE_HITSCAN;
  shooterSlot: number;
  weaponType: number;
  shotSeq: number;
  shotSequence: number;
  clientTimestamp: number;
  originX: number;
  originY: number;
  originZ: number;
  origin: [number, number, number];
  dirX: number;
  dirY: number;
  dirZ: number;
  direction: [number, number, number];
}

export type FireHitscanData = FireHitscanPacket;

export interface HitConfirmedPacket {
  opcode: typeof PACKET_OPCODES.HIT_CONFIRMED;
  victimSlot: number;
  shooterSlot: number;
  flags: number;
  damage: number;
  newHp: number;
  hitX: number;
  hitY: number;
  hitZ: number;
  hitPosition: [number, number, number];
  isHeadshot: boolean;
  isShieldBlocked: boolean;
  isFatalKill: boolean;
  isFatal: boolean;
}

export type HitConfirmedData = HitConfirmedPacket;

// ============================================================================
// 3. SLOT MANAGER (BIDIRECTIONAL SLOT <-> UUID MAPPING)
// ============================================================================

export class SlotManager {
  private slotToUuid = new Map<number, string>();
  private uuidToSlot = new Map<string, number>();
  private freeSlots: number[] = [];
  public readonly maxSlots: number;

  constructor(maxSlots: number = MAX_PLAYERS_PER_SESSION) {
    this.maxSlots = Math.min(256, Math.max(2, maxSlots));
    this.reset();
  }

  public reset(): void {
    this.slotToUuid.clear();
    this.uuidToSlot.clear();
    this.freeSlots = [];
    // Slots 1 to maxSlots-1 are available for clients (slot 0 reserved for Host)
    for (let i = this.maxSlots - 1; i >= 1; i--) {
      this.freeSlots.push(i);
    }
  }

  public registerHost(hostUuid: string): number {
    this.slotToUuid.set(HOST_SLOT, hostUuid);
    this.uuidToSlot.set(hostUuid, HOST_SLOT);
    return HOST_SLOT;
  }

  public allocateSlot(uuid: string): number {
    const existing = this.uuidToSlot.get(uuid);
    if (existing !== undefined) return existing;

    if (this.freeSlots.length === 0) {
      throw new Error(`SlotManager: Exceeded maximum capacity of ${this.maxSlots} players`);
    }

    const slot = this.freeSlots.pop()!;
    this.slotToUuid.set(slot, uuid);
    this.uuidToSlot.set(uuid, slot);
    return slot;
  }

  public assignSlot(slot: number, uuid: string): boolean {
    if (slot < 0 || slot >= this.maxSlots) return false;

    // If previously assigned to another UUID, unbind it
    const oldUuid = this.slotToUuid.get(slot);
    if (oldUuid && oldUuid !== uuid) {
      this.uuidToSlot.delete(oldUuid);
    }

    // Remove from free list if present
    const freeIdx = this.freeSlots.indexOf(slot);
    if (freeIdx !== -1) {
      this.freeSlots.splice(freeIdx, 1);
    }

    this.slotToUuid.set(slot, uuid);
    this.uuidToSlot.set(uuid, slot);
    return true;
  }

  public releaseSlot(slot: number): string | undefined {
    const uuid = this.slotToUuid.get(slot);
    if (!uuid) return undefined;

    this.slotToUuid.delete(slot);
    this.uuidToSlot.delete(uuid);

    if (slot !== HOST_SLOT && !this.freeSlots.includes(slot)) {
      this.freeSlots.push(slot);
      // Keep free slots sorted descending so pop() returns lowest slot first
      this.freeSlots.sort((a, b) => b - a);
    }

    return uuid;
  }

  public releaseUuid(uuid: string): number | undefined {
    const slot = this.uuidToSlot.get(uuid);
    if (slot === undefined) return undefined;
    this.releaseSlot(slot);
    return slot;
  }

  public getUuid(slot: number): string | undefined {
    return this.slotToUuid.get(slot);
  }

  public getSlot(uuid: string): number | undefined {
    return this.uuidToSlot.get(uuid);
  }

  public hasSlot(slot: number): boolean {
    return this.slotToUuid.has(slot);
  }

  public hasUuid(uuid: string): boolean {
    return this.uuidToSlot.has(uuid);
  }

  public getActiveCount(): number {
    return this.slotToUuid.size;
  }

  public getAllMappings(): Array<{ slot: number; uuid: string }> {
    return Array.from(this.slotToUuid.entries()).map(([slot, uuid]) => ({ slot, uuid }));
  }
}

// ============================================================================
// 4. PRE-ALLOCATED SEND BUFFERS (ZERO-ALLOCATION TRANSMISSION)
// ============================================================================

const clientStateSendBuffer = new ArrayBuffer(CLIENT_STATE_BYTES);
const clientStateSendView = new DataView(clientStateSendBuffer);

const fireHitscanSendBuffer = new ArrayBuffer(FIRE_HITSCAN_BYTES);
const fireHitscanSendView = new DataView(fireHitscanSendBuffer);

const hitConfirmedSendBuffer = new ArrayBuffer(HIT_CONFIRMED_BYTES);
const hitConfirmedSendView = new DataView(hitConfirmedSendBuffer);

const maxSnapshotBytes = SNAPSHOT_HEADER_BYTES + SNAPSHOT_PLAYER_BYTES * 256;
const worldSnapshotSendBuffer = new ArrayBuffer(maxSnapshotBytes);
const worldSnapshotSendView = new DataView(worldSnapshotSendBuffer);

// ============================================================================
// 5. ENCODERS
// ============================================================================

/**
 * Encodes CLIENT_STATE (0x01) into a 32-byte ArrayBuffer using the static send buffer.
 * Supports both direct component values and { x, y, z } position object.
 */
export function encodeClientState(
  slot: number,
  seq: number,
  timestamp: number,
  xOrPos: number | { x: number; y: number; z: number },
  yOrYaw?: number,
  zOrPitch?: number,
  yawOrActiveWeapon?: number,
  pitchOrFlags?: number,
  flags?: number,
  activeWeapon?: number,
  reserved: number = 0
): ArrayBuffer {
  let x = 0;
  let y = 0;
  let z = 0;
  let yawVal = 0;
  let pitchVal = 0;
  let flagsVal = 0;
  let weaponVal = 0;
  let resVal = reserved;

  if (typeof xOrPos === 'object' && xOrPos !== null) {
    x = xOrPos.x ?? 0;
    y = xOrPos.y ?? 0;
    z = xOrPos.z ?? 0;
    yawVal = yOrYaw ?? 0;
    pitchVal = zOrPitch ?? 0;
    weaponVal = yawOrActiveWeapon ?? 0;
    flagsVal = pitchOrFlags ?? 0;
  } else {
    x = xOrPos ?? 0;
    y = yOrYaw ?? 0;
    z = zOrPitch ?? 0;
    yawVal = yawOrActiveWeapon ?? 0;
    pitchVal = pitchOrFlags ?? 0;
    flagsVal = flags ?? 0;
    weaponVal = activeWeapon ?? 0;
  }

  clientStateSendView.setUint8(0, PACKET_OPCODES.CLIENT_STATE);
  clientStateSendView.setUint8(1, slot & 0xff);
  clientStateSendView.setUint16(2, seq & 0xffff, true);
  clientStateSendView.setFloat32(4, timestamp, true);
  clientStateSendView.setFloat32(8, x, true);
  clientStateSendView.setFloat32(12, y, true);
  clientStateSendView.setFloat32(16, z, true);
  clientStateSendView.setFloat32(20, yawVal, true);
  clientStateSendView.setFloat32(24, pitchVal, true);
  clientStateSendView.setUint8(28, flagsVal & 0xff);
  clientStateSendView.setUint8(29, weaponVal & 0xff);
  clientStateSendView.setUint16(30, resVal & 0xffff, true);

  return clientStateSendBuffer.slice(0, CLIENT_STATE_BYTES);
}

export const packClientState = encodeClientState;

/**
 * Encodes WORLD_SNAPSHOT (0x02) into an ArrayBuffer (8 + 28*N bytes).
 * Supports both (seq, hostTimestamp, players) and ({ snapshotSeq, hostTimestamp, players }).
 */
export function encodeWorldSnapshot(
  seqOrObj: number | { seq?: number; snapshotSeq?: number; hostTimestamp: number; players: readonly PlayerSnapshotEntry[] },
  hostTimestamp?: number,
  players?: readonly PlayerSnapshotEntry[]
): ArrayBuffer {
  let seq = 0;
  let timestamp = 0;
  let playerList: readonly PlayerSnapshotEntry[] = [];

  if (typeof seqOrObj === 'object' && seqOrObj !== null) {
    seq = (seqOrObj.snapshotSeq ?? seqOrObj.seq ?? 0) & 0xffff;
    timestamp = seqOrObj.hostTimestamp ?? 0;
    playerList = seqOrObj.players ?? [];
  } else {
    seq = seqOrObj & 0xffff;
    timestamp = hostTimestamp ?? 0;
    playerList = players ?? [];
  }

  const count = Math.min(playerList.length, 255);
  const totalBytes = SNAPSHOT_HEADER_BYTES + SNAPSHOT_PLAYER_BYTES * count;

  worldSnapshotSendView.setUint8(0, PACKET_OPCODES.WORLD_SNAPSHOT);
  worldSnapshotSendView.setUint8(1, count & 0xff);
  worldSnapshotSendView.setUint16(2, seq, true);
  worldSnapshotSendView.setFloat32(4, timestamp, true);

  for (let i = 0; i < count; i++) {
    const p = playerList[i];
    const offset = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_PLAYER_BYTES;

    const slot = p.slot ?? p.playerSlot ?? 0;
    const hp = p.hp ?? p.health ?? 100;
    const fl = p.flags ?? p.stateFlags ?? 0;
    const wp = p.activeWeapon ?? 0;
    const px = p.position ? p.position.x : p.x ?? 0;
    const py = p.position ? p.position.y : p.y ?? 0;
    const pz = p.position ? p.position.z : p.z ?? 0;
    const yaw = p.yaw ?? 0;
    const pitch = p.pitch ?? 0;
    const timerRemainingMs = p.timerRemainingMs ?? 0;

    worldSnapshotSendView.setUint8(offset + 0, slot & 0xff);
    worldSnapshotSendView.setUint8(offset + 1, Math.min(100, Math.max(0, Math.round(hp))) & 0xff);
    worldSnapshotSendView.setUint8(offset + 2, fl & 0xff);
    worldSnapshotSendView.setUint8(offset + 3, wp & 0xff);
    worldSnapshotSendView.setFloat32(offset + 4, px, true);
    worldSnapshotSendView.setFloat32(offset + 8, py, true);
    worldSnapshotSendView.setFloat32(offset + 12, pz, true);
    worldSnapshotSendView.setFloat32(offset + 16, yaw, true);
    worldSnapshotSendView.setFloat32(offset + 20, pitch, true);
    worldSnapshotSendView.setFloat32(offset + 24, timerRemainingMs, true);
  }

  return worldSnapshotSendBuffer.slice(0, totalBytes);
}

export const packWorldSnapshot = encodeWorldSnapshot;

/**
 * Encodes FIRE_HITSCAN (0x03) into a 32-byte ArrayBuffer.
 * Supports both direct coordinates and [x, y, z] / { x, y, z } vectors.
 */
export function encodeFireHitscan(
  shooterSlot: number,
  weaponType: number,
  shotSeq: number,
  clientTimestamp: number,
  originXOrVec: number | [number, number, number] | { x: number; y: number; z: number },
  originYOrDir?: number | [number, number, number] | { x: number; y: number; z: number },
  originZ?: number,
  dirX?: number,
  dirY?: number,
  dirZ?: number
): ArrayBuffer {
  let ox = 0, oy = 0, oz = 0;
  let dx = 0, dy = 0, dz = 0;

  if (Array.isArray(originXOrVec)) {
    ox = originXOrVec[0] ?? 0;
    oy = originXOrVec[1] ?? 0;
    oz = originXOrVec[2] ?? 0;
    if (Array.isArray(originYOrDir)) {
      dx = originYOrDir[0] ?? 0;
      dy = originYOrDir[1] ?? 0;
      dz = originYOrDir[2] ?? 0;
    }
  } else if (typeof originXOrVec === 'object' && originXOrVec !== null) {
    ox = originXOrVec.x ?? 0;
    oy = originXOrVec.y ?? 0;
    oz = originXOrVec.z ?? 0;
    if (typeof originYOrDir === 'object' && originYOrDir !== null && !Array.isArray(originYOrDir)) {
      dx = (originYOrDir as any).x ?? 0;
      dy = (originYOrDir as any).y ?? 0;
      dz = (originYOrDir as any).z ?? 0;
    }
  } else {
    ox = originXOrVec ?? 0;
    oy = (originYOrDir as number) ?? 0;
    oz = originZ ?? 0;
    dx = dirX ?? 0;
    dy = dirY ?? 0;
    dz = dirZ ?? 0;
  }

  fireHitscanSendView.setUint8(0, PACKET_OPCODES.FIRE_HITSCAN);
  fireHitscanSendView.setUint8(1, shooterSlot & 0xff);
  fireHitscanSendView.setUint8(2, weaponType & 0xff);
  fireHitscanSendView.setUint8(3, shotSeq & 0xff);
  fireHitscanSendView.setFloat32(4, clientTimestamp, true);
  fireHitscanSendView.setFloat32(8, ox, true);
  fireHitscanSendView.setFloat32(12, oy, true);
  fireHitscanSendView.setFloat32(16, oz, true);
  fireHitscanSendView.setFloat32(20, dx, true);
  fireHitscanSendView.setFloat32(24, dy, true);
  fireHitscanSendView.setFloat32(28, dz, true);

  return fireHitscanSendBuffer.slice(0, FIRE_HITSCAN_BYTES);
}

export const packFireHitscan = encodeFireHitscan;

/**
 * Encodes HIT_CONFIRMED (0x04) into a 16-byte ArrayBuffer using decimeter fixed-point.
 */
export function encodeHitConfirmed(
  victimSlot: number,
  shooterSlot: number,
  flags: number,
  damage: number,
  newHp: number,
  hitX: number,
  hitY: number,
  hitZ: number
): ArrayBuffer {
  hitConfirmedSendView.setUint8(0, PACKET_OPCODES.HIT_CONFIRMED);
  hitConfirmedSendView.setUint8(1, victimSlot & 0xff);
  hitConfirmedSendView.setUint8(2, shooterSlot & 0xff);
  hitConfirmedSendView.setUint8(3, flags & 0xff);
  hitConfirmedSendView.setUint8(4, Math.min(255, Math.max(0, Math.round(damage))) & 0xff);
  hitConfirmedSendView.setUint8(5, Math.min(100, Math.max(0, Math.round(newHp))) & 0xff);
  hitConfirmedSendView.setUint16(6, 0, true); // padding

  // Decimeter fixed-point coordinates (0.1m precision)
  const xDm = Math.round(hitX * 10);
  const yDm = Math.round(hitY * 10);
  const zDm = Math.round(hitZ * 10);

  hitConfirmedSendView.setInt16(8, Math.max(-32768, Math.min(32767, xDm)), true);
  hitConfirmedSendView.setInt16(10, Math.max(-32768, Math.min(32767, yDm)), true);
  hitConfirmedSendView.setInt16(12, Math.max(-32768, Math.min(32767, zDm)), true);
  hitConfirmedSendView.setUint16(14, 0, true); // reserved padding

  return hitConfirmedSendBuffer.slice(0, HIT_CONFIRMED_BYTES);
}

export const packHitConfirmed = encodeHitConfirmed;

// ============================================================================
// 6. DECODERS
// ============================================================================

export function ensureDataView(input: ArrayBuffer | ArrayBufferView): DataView {
  if (input instanceof DataView) return input;
  if (ArrayBuffer.isView(input)) {
    return new DataView(input.buffer, input.byteOffset, input.byteLength);
  }
  return new DataView(input);
}

/**
 * Returns the opcode of any binary packet, or null if buffer is too short.
 */
export function peekPacketOpcode(raw: ArrayBuffer | ArrayBufferView): number | null {
  try {
    const view = ensureDataView(raw);
    if (view.byteLength < 1) return null;
    return view.getUint8(0);
  } catch {
    return null;
  }
}

/**
 * Decodes CLIENT_STATE (0x01) with zero allocations into an existing object.
 */
export function decodeClientStateInto(
  raw: ArrayBuffer | ArrayBufferView,
  out: Partial<ClientStatePacket>
): boolean {
  try {
    const view = ensureDataView(raw);
    if (view.byteLength < CLIENT_STATE_BYTES) return false;
    if (view.getUint8(0) !== PACKET_OPCODES.CLIENT_STATE) return false;

    const slot = view.getUint8(1);
    const seq = view.getUint16(2, true);
    const timestamp = view.getFloat32(4, true);
    const x = view.getFloat32(8, true);
    const y = view.getFloat32(12, true);
    const z = view.getFloat32(16, true);
    const yaw = view.getFloat32(20, true);
    const pitch = view.getFloat32(24, true);
    const flags = view.getUint8(28);
    const activeWeapon = view.getUint8(29);
    const reserved = view.getUint16(30, true);

    out.opcode = PACKET_OPCODES.CLIENT_STATE;
    out.slot = slot;
    out.playerSlot = slot;
    out.seq = seq;
    out.sequence = seq;
    out.timestamp = timestamp;
    out.x = x;
    out.y = y;
    out.z = z;
    if (!out.position) {
      out.position = { x, y, z };
    } else {
      out.position.x = x;
      out.position.y = y;
      out.position.z = z;
    }
    out.yaw = yaw;
    out.pitch = pitch;
    out.flags = flags;
    out.activeWeapon = activeWeapon;
    out.reserved = reserved;

    return true;
  } catch {
    return false;
  }
}

/**
 * Standard allocating decoder for CLIENT_STATE (0x01).
 */
export function decodeClientState(raw: ArrayBuffer | ArrayBufferView): ClientStatePacket | null {
  const out: Partial<ClientStatePacket> = {};
  if (!decodeClientStateInto(raw, out)) return null;
  return out as ClientStatePacket;
}

export const unpackClientState = decodeClientState;

/**
 * Decodes WORLD_SNAPSHOT (0x02) into a structured snapshot packet.
 */
export function decodeWorldSnapshot(raw: ArrayBuffer | ArrayBufferView): WorldSnapshotPacket | null {
  try {
    const view = ensureDataView(raw);
    if (view.byteLength < SNAPSHOT_HEADER_BYTES) return null;
    if (view.getUint8(0) !== PACKET_OPCODES.WORLD_SNAPSHOT) return null;

    const count = view.getUint8(1);
    const expectedBytes = SNAPSHOT_HEADER_BYTES + count * SNAPSHOT_PLAYER_BYTES;
    if (view.byteLength < expectedBytes) return null;

    const seq = view.getUint16(2, true);
    const hostTimestamp = view.getFloat32(4, true);
    const players: PlayerSnapshotEntry[] = new Array(count);

    for (let i = 0; i < count; i++) {
      const offset = SNAPSHOT_HEADER_BYTES + i * SNAPSHOT_PLAYER_BYTES;
      const slot = view.getUint8(offset + 0);
      const hp = view.getUint8(offset + 1);
      const flags = view.getUint8(offset + 2);
      const activeWeapon = view.getUint8(offset + 3);
      const x = view.getFloat32(offset + 4, true);
      const y = view.getFloat32(offset + 8, true);
      const z = view.getFloat32(offset + 12, true);
      const yaw = view.getFloat32(offset + 16, true);
      const pitch = view.getFloat32(offset + 20, true);
      const timerRemainingMs = view.getFloat32(offset + 24, true);

      players[i] = {
        slot,
        playerSlot: slot,
        hp,
        health: hp,
        flags,
        stateFlags: flags,
        activeWeapon,
        x,
        y,
        z,
        position: { x, y, z },
        yaw,
        pitch,
        timerRemainingMs,
      };
    }

    return {
      opcode: PACKET_OPCODES.WORLD_SNAPSHOT,
      count,
      seq,
      snapshotSeq: seq,
      hostTimestamp,
      players,
    };
  } catch {
    return null;
  }
}

export const unpackWorldSnapshot = decodeWorldSnapshot;

/**
 * Decodes FIRE_HITSCAN (0x03) with zero allocations into an existing object.
 */
export function decodeFireHitscanInto(
  raw: ArrayBuffer | ArrayBufferView,
  out: Partial<FireHitscanPacket>
): boolean {
  try {
    const view = ensureDataView(raw);
    if (view.byteLength < FIRE_HITSCAN_BYTES) return false;
    if (view.getUint8(0) !== PACKET_OPCODES.FIRE_HITSCAN) return false;

    const shooterSlot = view.getUint8(1);
    const weaponType = view.getUint8(2);
    const shotSeq = view.getUint8(3);
    const clientTimestamp = view.getFloat32(4, true);
    const originX = view.getFloat32(8, true);
    const originY = view.getFloat32(12, true);
    const originZ = view.getFloat32(16, true);
    const dirX = view.getFloat32(20, true);
    const dirY = view.getFloat32(24, true);
    const dirZ = view.getFloat32(28, true);

    out.opcode = PACKET_OPCODES.FIRE_HITSCAN;
    out.shooterSlot = shooterSlot;
    out.weaponType = weaponType;
    out.shotSeq = shotSeq;
    out.shotSequence = shotSeq;
    out.clientTimestamp = clientTimestamp;
    out.originX = originX;
    out.originY = originY;
    out.originZ = originZ;
    out.origin = [originX, originY, originZ];
    out.dirX = dirX;
    out.dirY = dirY;
    out.dirZ = dirZ;
    out.direction = [dirX, dirY, dirZ];

    return true;
  } catch {
    return false;
  }
}

/**
 * Standard allocating decoder for FIRE_HITSCAN (0x03).
 */
export function decodeFireHitscan(raw: ArrayBuffer | ArrayBufferView): FireHitscanPacket | null {
  const out: Partial<FireHitscanPacket> = {};
  if (!decodeFireHitscanInto(raw, out)) return null;
  return out as FireHitscanPacket;
}

export const unpackFireHitscan = decodeFireHitscan;

/**
 * Decodes HIT_CONFIRMED (0x04). Automatically supports 16-byte fixed-point and 20-byte float layouts.
 */
export function decodeHitConfirmedInto(
  raw: ArrayBuffer | ArrayBufferView,
  out: Partial<HitConfirmedPacket>
): boolean {
  try {
    const view = ensureDataView(raw);
    if (view.byteLength < HIT_CONFIRMED_BYTES) return false;
    if (view.getUint8(0) !== PACKET_OPCODES.HIT_CONFIRMED) return false;

    const victimSlot = view.getUint8(1);
    const shooterSlot = view.getUint8(2);
    const flags = view.getUint8(3);
    const damage = view.getUint8(4);
    const newHp = view.getUint8(5);

    let hitX = 0;
    let hitY = 0;
    let hitZ = 0;

    if (view.byteLength >= HIT_CONFIRMED_FLOAT_BYTES) {
      // 20-byte Float32 layout
      hitX = view.getFloat32(8, true);
      hitY = view.getFloat32(12, true);
      hitZ = view.getFloat32(16, true);
    } else {
      // 16-byte Int16 decimeter layout
      hitX = view.getInt16(8, true) / 10.0;
      hitY = view.getInt16(10, true) / 10.0;
      hitZ = view.getInt16(12, true) / 10.0;
    }

    out.opcode = PACKET_OPCODES.HIT_CONFIRMED;
    out.victimSlot = victimSlot;
    out.shooterSlot = shooterSlot;
    out.flags = flags;
    out.damage = damage;
    out.newHp = newHp;
    out.hitX = hitX;
    out.hitY = hitY;
    out.hitZ = hitZ;
    out.hitPosition = [hitX, hitY, hitZ];
    out.isHeadshot = (flags & HIT_FLAGS.HEADSHOT) !== 0;
    out.isShieldBlocked = (flags & HIT_FLAGS.SHIELD_BLOCKED) !== 0;
    out.isFatalKill = (flags & HIT_FLAGS.FATAL_KILL) !== 0;
    out.isFatal = (flags & HIT_FLAGS.FATAL_KILL) !== 0;

    return true;
  } catch {
    return false;
  }
}

/**
 * Standard allocating decoder for HIT_CONFIRMED (0x04).
 */
export function decodeHitConfirmed(raw: ArrayBuffer | ArrayBufferView): HitConfirmedPacket | null {
  const out: Partial<HitConfirmedPacket> = {};
  if (!decodeHitConfirmedInto(raw, out)) return null;
  return out as HitConfirmedPacket;
}

export const unpackHitConfirmed = decodeHitConfirmed;

/**
 * game-web/src/net/interpolationBuffer.ts
 *
 * G.O.N.E. Remote Player Interpolation Engine
 *
 * Implements:
 * - Time-ordered snapshot ring buffer with configurable render delay (~80-100ms)
 * - Precision 3D Vector LERP for spatial positions
 * - Modular shortest-path geodesic angle LERP for yaw & pitch across +/- PI boundary
 * - Bounded dead-reckoning extrapolation (up to 150ms) for packet jitter & loss
 * - Teleport discontinuity detection and instant snapping (> 10m)
 * - EMA clock offset synchronizer for host/client timeline mapping
 * - Zero external dependencies (runs in Node.js test harness and browser)
 */

// ============================================================================
// 1. ANGULAR & SCALAR MATH HELPERS
// ============================================================================

/**
 * Normalizes an angle into the range [-PI, PI].
 */
export function normalizeAngle(angle: number): number {
  let a = angle % (2 * Math.PI);
  if (a > Math.PI) a -= 2 * Math.PI;
  if (a < -Math.PI) a += 2 * Math.PI;
  return a;
}

/**
 * Calculates the shortest angular difference between two angles in radians [-PI, PI].
 */
export function shortestAngleDifference(from: number, to: number): number {
  let diff = (to - from) % (2 * Math.PI);
  if (diff > Math.PI) diff -= 2 * Math.PI;
  if (diff < -Math.PI) diff += 2 * Math.PI;
  return diff;
}

/**
 * Interpolates between two angles taking the shortest arc across the circle.
 */
export function lerpAngle(from: number, to: number, t: number): number {
  const diff = shortestAngleDifference(from, to);
  return normalizeAngle(from + diff * t);
}

/**
 * Standard scalar linear interpolation.
 */
export function lerpScalar(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

// ============================================================================
// 2. DATA STRUCTURES & CONFIGURATION
// ============================================================================

export interface PlayerSnapshot {
  timestamp: number;          // Remote/Host authoritative timestamp (ms)
  localArrival?: number;      // Client performance.now() when packet received (ms)
  x?: number;
  y?: number;
  z?: number;
  position?: { x: number; y: number; z: number };
  yaw: number;                // Look angle around Y-axis in radians [-PI, PI]
  pitch: number;              // Look angle around X-axis in radians [-PI/2, PI/2]
  activeWeapon?: number;      // Weapon index (0-4)
  stateFlags?: number;        // Bitfield
  flags?: number;
  health?: number;            // HP (0-100)
  hp?: number;
  timerRemainingMs?: number;  // Shield countdown or respawn timer (ms)
}

export interface InterpolatedState {
  x: number;
  y: number;
  z: number;
  position: { x: number; y: number; z: number };
  yaw: number;
  pitch: number;
  activeWeapon: number;
  stateFlags: number;
  flags: number;
  health: number;
  hp: number;
  timerRemainingMs: number;
  isExtrapolated: boolean;
  extrapolationMs: number;
  isTeleport: boolean;
  isStale: boolean;
}

export interface InterpolationBufferConfig {
  renderDelayMs: number;           // Default: 90ms
  maxExtrapolationMs: number;      // Default: 150ms
  extrapolationLimitMs?: number;   // Alias for maxExtrapolationMs
  teleportThresholdMeters: number; // Default: 10.0m
  teleportThreshold?: number;      // Alias for teleportThresholdMeters
  maxCapacity: number;             // Default: 32 snapshots
  staleTimeoutMs: number;          // Default: 1000ms
}

export const DEFAULT_INTERPOLATION_CONFIG: InterpolationBufferConfig = {
  renderDelayMs: 90,
  maxExtrapolationMs: 150,
  teleportThresholdMeters: 10.0,
  maxCapacity: 32,
  staleTimeoutMs: 1000,
};

interface InternalSnapshot {
  timestamp: number;
  localArrival: number;
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
  activeWeapon: number;
  stateFlags: number;
  health: number;
  timerRemainingMs: number;
}

// ============================================================================
// 3. SINGLE ENTITY INTERPOLATION BUFFER
// ============================================================================

export class InterpolationBuffer {
  private snapshots: InternalSnapshot[] = [];
  public readonly config: InterpolationBufferConfig;
  private teleportDistanceSq: number;

  constructor(options: Partial<InterpolationBufferConfig> = {}) {
    const renderDelay = options.renderDelayMs ?? DEFAULT_INTERPOLATION_CONFIG.renderDelayMs;
    const maxExtra = options.maxExtrapolationMs ?? options.extrapolationLimitMs ?? DEFAULT_INTERPOLATION_CONFIG.maxExtrapolationMs;
    const teleportThresh = options.teleportThresholdMeters ?? options.teleportThreshold ?? DEFAULT_INTERPOLATION_CONFIG.teleportThresholdMeters;
    const capacity = options.maxCapacity ?? DEFAULT_INTERPOLATION_CONFIG.maxCapacity;
    const staleTimeout = options.staleTimeoutMs ?? DEFAULT_INTERPOLATION_CONFIG.staleTimeoutMs;

    this.config = {
      renderDelayMs: renderDelay,
      maxExtrapolationMs: maxExtra,
      teleportThresholdMeters: teleportThresh,
      maxCapacity: capacity,
      staleTimeoutMs: staleTimeout,
    };
    this.teleportDistanceSq = this.config.teleportThresholdMeters * this.config.teleportThresholdMeters;
  }

  /**
   * Pushes a new snapshot into the buffer.
   * Detects teleports, maintains chronological ordering, and enforces capacity.
   */
  public push(snapshot: PlayerSnapshot): void {
    const x = snapshot.position ? snapshot.position.x : snapshot.x ?? 0;
    const y = snapshot.position ? snapshot.position.y : snapshot.y ?? 0;
    const z = snapshot.position ? snapshot.position.z : snapshot.z ?? 0;
    const localArrival = snapshot.localArrival ?? snapshot.timestamp;
    const flags = snapshot.stateFlags ?? snapshot.flags ?? 0x01;
    const hp = snapshot.health ?? snapshot.hp ?? 100;

    const internal: InternalSnapshot = {
      timestamp: snapshot.timestamp,
      localArrival,
      x,
      y,
      z,
      yaw: snapshot.yaw,
      pitch: snapshot.pitch,
      activeWeapon: snapshot.activeWeapon ?? 0,
      stateFlags: flags,
      health: hp,
      timerRemainingMs: snapshot.timerRemainingMs ?? 0,
    };

    if (this.snapshots.length > 0) {
      const latest = this.snapshots[this.snapshots.length - 1];
      const dx = internal.x - latest.x;
      const dy = internal.y - latest.y;
      const dz = internal.z - latest.z;
      const distSq = dx * dx + dy * dy + dz * dz;

      // Teleportation / Respawn detection: purge stale history
      if (distSq > this.teleportDistanceSq) {
        this.snapshots.length = 0;
      }
    }

    // Insert in chronological timestamp order
    if (this.snapshots.length === 0 || internal.timestamp > this.snapshots[this.snapshots.length - 1].timestamp) {
      this.snapshots.push(internal);
    } else {
      // Out-of-order packet: find insertion index
      const idx = this.snapshots.findIndex((s) => s.timestamp >= internal.timestamp);
      if (idx !== -1) {
        if (this.snapshots[idx].timestamp === internal.timestamp) {
          return; // Duplicate packet, discard
        }
        this.snapshots.splice(idx, 0, internal);
      }
    }

    // Maintain buffer capacity
    while (this.snapshots.length > this.config.maxCapacity) {
      this.snapshots.shift();
    }
  }

  public pushSnapshot(snapshot: PlayerSnapshot): void {
    this.push(snapshot);
  }

  /**
   * Evaluates the interpolated or extrapolated state at target render timestamp (ms).
   * Pure deterministic calculation suitable for automated testing and rendering.
   */
  public sample(renderTimeMs: number): InterpolatedState | null {
    const len = this.snapshots.length;
    if (len === 0) {
      return null;
    }

    const latest = this.snapshots[len - 1];
    const isStale = renderTimeMs - latest.timestamp > this.config.staleTimeoutMs;

    // Single snapshot: cannot interpolate or compute velocity
    if (len === 1) {
      const extraMs = Math.max(0, renderTimeMs - latest.timestamp);
      const isExtra = extraMs > 0;
      return {
        x: latest.x,
        y: latest.y,
        z: latest.z,
        position: { x: latest.x, y: latest.y, z: latest.z },
        yaw: latest.yaw,
        pitch: latest.pitch,
        activeWeapon: latest.activeWeapon,
        stateFlags: latest.stateFlags,
        flags: latest.stateFlags,
        health: latest.health,
        hp: latest.health,
        timerRemainingMs: latest.timerRemainingMs,
        isExtrapolated: isExtra,
        extrapolationMs: Math.min(extraMs, this.config.maxExtrapolationMs),
        isTeleport: false,
        isStale,
      };
    }

    // Case 1: Render time is older than our oldest snapshot -> clamp to oldest
    const oldest = this.snapshots[0];
    if (renderTimeMs <= oldest.timestamp) {
      return {
        x: oldest.x,
        y: oldest.y,
        z: oldest.z,
        position: { x: oldest.x, y: oldest.y, z: oldest.z },
        yaw: oldest.yaw,
        pitch: oldest.pitch,
        activeWeapon: oldest.activeWeapon,
        stateFlags: oldest.stateFlags,
        flags: oldest.stateFlags,
        health: oldest.health,
        hp: oldest.health,
        timerRemainingMs: oldest.timerRemainingMs,
        isExtrapolated: false,
        extrapolationMs: 0,
        isTeleport: false,
        isStale,
      };
    }

    // Case 2: Render time is within the known snapshot range [t0, tN] -> LERP
    if (renderTimeMs <= latest.timestamp) {
      let sPrev = this.snapshots[0];
      let sNext = this.snapshots[1];

      for (let i = 0; i < len - 1; i++) {
        if (this.snapshots[i].timestamp <= renderTimeMs && renderTimeMs <= this.snapshots[i + 1].timestamp) {
          sPrev = this.snapshots[i];
          sNext = this.snapshots[i + 1];
          break;
        }
      }

      const dt = sNext.timestamp - sPrev.timestamp;
      const alpha = dt <= 1e-6 ? 1.0 : Math.max(0.0, Math.min(1.0, (renderTimeMs - sPrev.timestamp) / dt));

      // Discontinuity check between sPrev and sNext
      const dx = sNext.x - sPrev.x;
      const dy = sNext.y - sPrev.y;
      const dz = sNext.z - sPrev.z;
      if (dx * dx + dy * dy + dz * dz > this.teleportDistanceSq) {
        const chosen = alpha >= 0.5 ? sNext : sPrev;
        return {
          x: chosen.x,
          y: chosen.y,
          z: chosen.z,
          position: { x: chosen.x, y: chosen.y, z: chosen.z },
          yaw: chosen.yaw,
          pitch: chosen.pitch,
          activeWeapon: chosen.activeWeapon,
          stateFlags: chosen.stateFlags,
          flags: chosen.stateFlags,
          health: chosen.health,
          hp: chosen.health,
          timerRemainingMs: chosen.timerRemainingMs,
          isExtrapolated: false,
          extrapolationMs: 0,
          isTeleport: true,
          isStale,
        };
      }

      const dominant = alpha >= 0.5 ? sNext : sPrev;
      const interpX = lerpScalar(sPrev.x, sNext.x, alpha);
      const interpY = lerpScalar(sPrev.y, sNext.y, alpha);
      const interpZ = lerpScalar(sPrev.z, sNext.z, alpha);
      const interpYaw = lerpAngle(sPrev.yaw, sNext.yaw, alpha);
      const rawPitch = lerpAngle(sPrev.pitch, sNext.pitch, alpha);
      const interpPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, rawPitch));

      return {
        x: interpX,
        y: interpY,
        z: interpZ,
        position: { x: interpX, y: interpY, z: interpZ },
        yaw: interpYaw,
        pitch: interpPitch,
        activeWeapon: dominant.activeWeapon,
        stateFlags: dominant.stateFlags,
        flags: dominant.stateFlags,
        health: dominant.health,
        hp: dominant.health,
        timerRemainingMs: dominant.timerRemainingMs,
        isExtrapolated: false,
        extrapolationMs: 0,
        isTeleport: false,
        isStale,
      };
    }

    // Case 3: Render time > latest.timestamp -> Dead-Reckoning Extrapolation
    const prev = this.snapshots[len - 2];
    const dtSample = latest.timestamp - prev.timestamp;
    const elapsedExtra = renderTimeMs - latest.timestamp;
    const clampedExtra = Math.min(elapsedExtra, this.config.maxExtrapolationMs);

    let vx = 0;
    let vy = 0;
    let vz = 0;

    if (dtSample > 1e-6) {
      vx = (latest.x - prev.x) / dtSample;
      vy = (latest.y - prev.y) / dtSample;
      vz = (latest.z - prev.z) / dtSample;
    }

    const extraX = latest.x + vx * clampedExtra;
    const extraY = latest.y + vy * clampedExtra;
    const extraZ = latest.z + vz * clampedExtra;

    return {
      x: extraX,
      y: extraY,
      z: extraZ,
      position: { x: extraX, y: extraY, z: extraZ },
      yaw: latest.yaw,     // Freeze look orientation during extrapolation
      pitch: latest.pitch, // Freeze pitch during extrapolation
      activeWeapon: latest.activeWeapon,
      stateFlags: latest.stateFlags,
      flags: latest.stateFlags,
      health: latest.health,
      hp: latest.health,
      timerRemainingMs: latest.timerRemainingMs,
      isExtrapolated: true,
      extrapolationMs: clampedExtra,
      isTeleport: false,
      isStale,
    };
  }

  /**
   * Prunes snapshots that are older than pruneBeforeMs, preserving at least 2 snapshots.
   */
  public prune(pruneBeforeMs: number): void {
    while (this.snapshots.length > 2 && this.snapshots[1].timestamp < pruneBeforeMs) {
      this.snapshots.shift();
    }
  }

  public clear(): void {
    this.snapshots.length = 0;
  }

  public get size(): number {
    return this.snapshots.length;
  }

  public get latest(): PlayerSnapshot | null {
    if (this.snapshots.length === 0) return null;
    const s = this.snapshots[this.snapshots.length - 1];
    return {
      timestamp: s.timestamp,
      localArrival: s.localArrival,
      x: s.x,
      y: s.y,
      z: s.z,
      position: { x: s.x, y: s.y, z: s.z },
      yaw: s.yaw,
      pitch: s.pitch,
      activeWeapon: s.activeWeapon,
      stateFlags: s.stateFlags,
      flags: s.stateFlags,
      health: s.health,
      hp: s.health,
      timerRemainingMs: s.timerRemainingMs,
    };
  }
}

// ============================================================================
// 4. NETWORK CLOCK SYNCHRONIZER
// ============================================================================

export class NetworkClockSync {
  private offsetEma: number = 0;
  private hasInitialized: boolean = false;
  public readonly alpha: number;

  constructor(smoothingAlpha: number = 0.1) {
    this.alpha = smoothingAlpha;
  }

  /**
   * Records a received remote timestamp paired with local arrival timestamp.
   */
  public registerHostTimestamp(hostTimestamp: number, localArrival: number): void {
    const rawOffset = hostTimestamp - localArrival;
    if (!this.hasInitialized) {
      this.offsetEma = rawOffset;
      this.hasInitialized = true;
    } else {
      this.offsetEma += this.alpha * (rawOffset - this.offsetEma);
    }
  }

  /**
   * Returns current estimated host time (ms).
   */
  public getEstimatedHostTime(localNow: number): number {
    return localNow + this.offsetEma;
  }

  /**
   * Returns target render timestamp factoring in configured render delay.
   */
  public getRenderTime(localNow: number, renderDelayMs: number = 90): number {
    return this.getEstimatedHostTime(localNow) - renderDelayMs;
  }

  public reset(): void {
    this.hasInitialized = false;
    this.offsetEma = 0;
  }
}

// ============================================================================
// 5. MULTI-PEER REMOTE PLAYER INTERPOLATION MANAGER
// ============================================================================

export class RemotePlayerInterpolationManager {
  private buffers = new Map<string, InterpolationBuffer>();
  public readonly clockSync = new NetworkClockSync();
  public renderDelayMs: number;

  constructor(renderDelayMs: number = 90) {
    this.renderDelayMs = renderDelayMs;
  }

  public pushSnapshot(playerId: string, snapshot: PlayerSnapshot): void {
    const arrival = snapshot.localArrival ?? performance.now();
    this.clockSync.registerHostTimestamp(snapshot.timestamp, arrival);

    let buffer = this.buffers.get(playerId);
    if (!buffer) {
      buffer = new InterpolationBuffer({ renderDelayMs: this.renderDelayMs });
      this.buffers.set(playerId, buffer);
    }
    buffer.push(snapshot);
  }

  public samplePlayer(playerId: string, localNow: number): InterpolatedState | null {
    const buffer = this.buffers.get(playerId);
    if (!buffer) return null;

    const renderTime = this.clockSync.getRenderTime(localNow, this.renderDelayMs);
    const state = buffer.sample(renderTime);

    // Auto-prune old snapshots older than renderTime - 500ms
    buffer.prune(renderTime - 500);

    return state;
  }

  public removePlayer(playerId: string): void {
    const buffer = this.buffers.get(playerId);
    if (buffer) {
      buffer.clear();
      this.buffers.delete(playerId);
    }
  }

  public clear(): void {
    for (const b of this.buffers.values()) {
      b.clear();
    }
    this.buffers.clear();
    this.clockSync.reset();
  }
}

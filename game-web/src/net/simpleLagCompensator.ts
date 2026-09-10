/**
 * Browser-safe lag compensator used by the rescue build.
 *
 * It deliberately does not trust client performance.now() timestamps because
 * monotonic clocks are not synchronized between computers. When clocks do not
 * line up, it validates against the newest authoritative host snapshot.
 *
 * Player network Y is the physics/top anchor used by engine.ts. The actual
 * collision cylinder therefore starts one player-height below Y.
 */

export interface SimpleHitscanResult {
  hit: boolean;
  damage: number;
  is_headshot: boolean;
  distance: number;
}

type Snapshot = {
  timestamp: number;
  x: number;
  y: number;
  z: number;
  radius: number;
  height: number;
};

const WEAPON = {
  0: { body: 34, head: 51, range: 120 },
  1: { body: 90, head: 140, range: 400 },
  2: { body: 80, head: 100, range: 24 },
  3: { body: 20, head: 30, range: 75 },
  4: { body: 50, head: 50, range: 2.5 },
} as const;

export class SimpleLagCompensator {
  private readonly histories = new Map<number, Snapshot[]>();
  private readonly maxHistoryMs: number;

  constructor(maxHistoryMs = 500) {
    this.maxHistoryMs = Math.max(100, maxHistoryMs);
  }

  record_player_position(
    playerId: number,
    timestampMs: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number,
  ): void {
    let history = this.histories.get(playerId);
    if (!history) {
      history = [];
      this.histories.set(playerId, history);
    }

    const timestamp = Number.isFinite(timestampMs) ? timestampMs : performance.now();
    history.push({
      timestamp,
      x,
      y,
      z,
      radius: radius > 0 ? radius : 0.45,
      height: height > 0 ? height : 2,
    });

    const cutoff = timestamp - this.maxHistoryMs - 100;
    while (history.length > 2 && history[0].timestamp < cutoff) history.shift();
    if (history.length > 96) history.splice(0, history.length - 96);
  }

  validate_rewind_hitscan(
    shooterId: number,
    victimId: number,
    weaponType: number,
    shotTimeMs: number,
    maxUnlagMs: number,
    originX: number,
    originY: number,
    originZ: number,
    dirX: number,
    dirY: number,
    dirZ: number,
    maxRange: number,
  ): string {
    const miss = (): string => JSON.stringify({
      hit: false,
      damage: 0,
      is_headshot: false,
      distance: 0,
    } satisfies SimpleHitscanResult);

    if (shooterId === victimId) return miss();

    const history = this.histories.get(victimId);
    if (!history?.length) return miss();

    const newest = history[history.length - 1];
    const maxUnlag = Math.max(0, Math.min(this.maxHistoryMs, maxUnlagMs || this.maxHistoryMs));

    // Browser performance.now() has a per-page time origin. Across computers
    // (and even across tabs) client and host timestamps are not comparable.
    // Only accept the supplied value when it is plausibly in the host domain.
    let targetTime = shotTimeMs;
    if (!Number.isFinite(targetTime) || Math.abs(targetTime - newest.timestamp) > maxUnlag + 250) {
      // Rewind roughly by the render interpolation delay. This makes the
      // authoritative hitbox line up with what the shooter actually saw.
      targetTime = newest.timestamp - 90;
    }
    targetTime = Math.max(newest.timestamp - maxUnlag, Math.min(newest.timestamp, targetTime));

    let snapshot = newest;
    let bestDistance = Math.abs(newest.timestamp - targetTime);
    for (let i = history.length - 2; i >= 0; i -= 1) {
      const candidate = history[i];
      const delta = Math.abs(candidate.timestamp - targetTime);
      if (delta <= bestDistance) {
        snapshot = candidate;
        bestDistance = delta;
      } else if (candidate.timestamp < targetTime) {
        break;
      }
    }

    const weapon = WEAPON[weaponType as keyof typeof WEAPON] ?? WEAPON[0];
    const effectiveRange = Math.max(0.1, Math.min(maxRange || weapon.range, weapon.range));
    const hit = this.intersectCylinder(
      [originX, originY, originZ],
      [dirX, dirY, dirZ],
      snapshot,
      effectiveRange,
    );

    if (!hit) return miss();

    return JSON.stringify({
      hit: true,
      damage: hit.isHeadshot ? weapon.head : weapon.body,
      is_headshot: hit.isHeadshot,
      distance: hit.distance,
    } satisfies SimpleHitscanResult);
  }

  clear_player(playerId: number): void {
    this.histories.delete(playerId);
  }

  private intersectCylinder(
    origin: [number, number, number],
    direction: [number, number, number],
    snapshot: Snapshot,
    maxRange: number,
  ): { distance: number; isHeadshot: boolean } | null {
    const magnitude = Math.hypot(direction[0], direction[1], direction[2]);
    if (magnitude < 1e-6) return null;

    const dx = direction[0] / magnitude;
    const dy = direction[1] / magnitude;
    const dz = direction[2] / magnitude;

    const localX = origin[0] - snapshot.x;
    const localZ = origin[2] - snapshot.z;
    const a = dx * dx + dz * dz;
    if (a < 1e-8) return null;

    const b = 2 * (localX * dx + localZ * dz);
    const c = localX * localX + localZ * localZ - snapshot.radius * snapshot.radius;
    const discriminant = b * b - 4 * a * c;
    if (discriminant < 0) return null;

    const root = Math.sqrt(discriminant);
    const roots = [
      (-b - root) / (2 * a),
      (-b + root) / (2 * a),
    ].filter((t) => t >= 0 && t <= maxRange).sort((x, y) => x - y);

    const baseY = snapshot.y - snapshot.height;
    const topY = snapshot.y;

    for (const t of roots) {
      const hitY = origin[1] + dy * t;
      if (hitY >= baseY && hitY <= topY) {
        return {
          distance: t,
          isHeadshot: hitY >= baseY + snapshot.height * 0.78,
        };
      }
    }

    return null;
  }
}

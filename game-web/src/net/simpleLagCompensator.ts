/** Browser-safe authoritative lag compensation for the self-hosted WebRTC game. */
import { calculateWeaponDamageAtDistance, getWeaponRuntimeById } from '../weapons/weaponConfig.ts';
import { intersectRobotHitbox } from './robotHitbox.ts';

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

    // performance.now() is page-local. Only trust a client timestamp if it is
    // plausibly in the host clock domain; otherwise rewind by render latency.
    let targetTime = shotTimeMs;
    if (!Number.isFinite(targetTime) || Math.abs(targetTime - newest.timestamp) > maxUnlag + 250) {
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

    // Anchor horizontal shot origin to the newest authoritative shooter state.
    // The supplied viewmodel muzzle is only a visual origin and can be offset.
    let validatedOriginX = originX;
    let validatedOriginY = originY;
    let validatedOriginZ = originZ;
    const shooterHistory = this.histories.get(shooterId);
    const shooterSnapshot = shooterHistory?.[shooterHistory.length - 1];
    if (shooterSnapshot) {
      validatedOriginX = shooterSnapshot.x;
      validatedOriginZ = shooterSnapshot.z;
      const minEyeY = shooterSnapshot.y - shooterSnapshot.height + 0.65;
      const maxEyeY = shooterSnapshot.y + 0.25;
      if (!Number.isFinite(validatedOriginY) || validatedOriginY < minEyeY || validatedOriginY > maxEyeY) {
        validatedOriginY = shooterSnapshot.y - 0.2;
      }
    }

    const weapon = getWeaponRuntimeById(weaponType);
    const effectiveRange = Math.max(0.1, Math.min(maxRange || weapon.maxRange, weapon.maxRange));
    const hit = intersectRobotHitbox(
      [validatedOriginX, validatedOriginY, validatedOriginZ],
      [dirX, dirY, dirZ],
      snapshot,
      effectiveRange,
    );

    if (!hit) return miss();
    const damage = calculateWeaponDamageAtDistance(weaponType, hit.distance, hit.isHeadshot);
    if (damage <= 0) return miss();

    return JSON.stringify({
      hit: true,
      damage,
      is_headshot: hit.isHeadshot,
      distance: hit.distance,
    } satisfies SimpleHitscanResult);
  }

  clear_player(playerId: number): void {
    this.histories.delete(playerId);
  }
}

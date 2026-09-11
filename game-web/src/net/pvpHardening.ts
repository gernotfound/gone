import { P2PHost } from './p2pHost.ts';
import type { FireHitscanData } from './binaryProtocol.ts';
import { calculateWeaponDamageAtDistance, getWeaponRuntimeById, WEAPON_KEYS } from '../weapons/weaponConfig.ts';
import { intersectRobotHitbox } from './robotHitbox.ts';

const PATCH_MARKER = '__gonePvpHardeningPatched';
const HOST_STATE = '__gonePvpHardeningState';

type HardeningState = {
  lastClientShotTime: Map<string, number>;
  lastShotSeq: Map<string, number>;
  accepted: number;
  rejected: number;
  rejectedCadence: number;
  rejectedWeapon: number;
  rejectedDirection: number;
};

function stateFor(host: any): HardeningState {
  if (!host[HOST_STATE]) {
    host[HOST_STATE] = {
      lastClientShotTime: new Map<string, number>(),
      lastShotSeq: new Map<string, number>(),
      accepted: 0,
      rejected: 0,
      rejectedCadence: 0,
      rejectedWeapon: 0,
      rejectedDirection: 0,
    } satisfies HardeningState;
  }
  return host[HOST_STATE] as HardeningState;
}

function reject(state: HardeningState, reason: 'cadence' | 'weapon' | 'direction'): void {
  state.rejected += 1;
  if (reason === 'cadence') state.rejectedCadence += 1;
  else if (reason === 'weapon') state.rejectedWeapon += 1;
  else state.rejectedDirection += 1;
}

function normalizeShotDirection(shot: FireHitscanData): boolean {
  const x = Number(shot.dirX);
  const y = Number(shot.dirY);
  const z = Number(shot.dirZ);
  if (![x, y, z].every(Number.isFinite)) return false;
  const length = Math.hypot(x, y, z);
  if (!Number.isFinite(length) || length < 1e-5) return false;

  const nx = x / length;
  const ny = y / length;
  const nz = z / length;
  shot.dirX = nx;
  shot.dirY = ny;
  shot.dirZ = nz;
  shot.direction = [nx, ny, nz];
  return true;
}

function anchorAuthoritativeOrigin(shooter: any, shot: FireHitscanData): void {
  const playerY = Number(shooter.position?.y ?? 0);
  const suppliedY = Number(shot.originY);
  const minEyeY = playerY - 1.35;
  const maxEyeY = playerY + 0.25;
  const y = Number.isFinite(suppliedY) && suppliedY >= minEyeY && suppliedY <= maxEyeY
    ? suppliedY
    : playerY - 0.2;
  const x = Number(shooter.position?.x ?? 0);
  const z = Number(shooter.position?.z ?? 0);

  shot.originX = x;
  shot.originY = y;
  shot.originZ = z;
  shot.origin = [x, y, z];
}

/** Host-side sanity checks around the existing lag-compensated validator. */
export function startPvpHardening(): void {
  const proto = P2PHost.prototype as any;
  if (proto[PATCH_MARKER]) return;
  proto[PATCH_MARKER] = true;

  const originalProcess = proto.processFireHitscan;
  if (typeof originalProcess !== 'function') return;

  proto.processFireHitscan = function(shooterId: string, shot: FireHitscanData): void {
    const state = stateFor(this);
    const shooter = this.playerRecords?.get?.(shooterId);
    if (!shooter || !shooter.isAlive) return;

    const weaponType = Number(shot.weaponType);
    if (!Number.isInteger(weaponType) || weaponType < 0 || weaponType >= WEAPON_KEYS.length) {
      reject(state, 'weapon');
      return;
    }
    if (!normalizeShotDirection(shot)) {
      reject(state, 'direction');
      return;
    }

    const isGuest = shooterId !== this.hostPlayer?.id;
    const cfg = getWeaponRuntimeById(weaponType);
    const clientTime = Number(shot.clientTimestamp);
    const effectiveTime = Number.isFinite(clientTime) ? clientTime : performance.now();

    if (isGuest) {
      // Active weapon is replicated at 30 Hz. Local switch cooldown is 150 ms,
      // comfortably longer than one state tick, so a legal shot should match.
      if (Number(shooter.activeWeapon) !== weaponType) {
        reject(state, 'weapon');
        return;
      }

      const previousTime = state.lastClientShotTime.get(shooterId);
      if (previousTime !== undefined) {
        const delta = effectiveTime - previousTime;
        const minimumCadenceMs = (1000 / Math.max(0.1, cfg.fireRateRps)) * 0.68;
        if (delta >= 0 && delta < minimumCadenceMs) {
          reject(state, 'cadence');
          return;
        }
      }

      const seq = Number(shot.shotSeq) & 0xff;
      const previousSeq = state.lastShotSeq.get(shooterId);
      if (previousSeq !== undefined && seq === previousSeq) {
        reject(state, 'cadence');
        return;
      }
      state.lastShotSeq.set(shooterId, seq);
      state.lastClientShotTime.set(shooterId, effectiveTime);
    }

    anchorAuthoritativeOrigin(shooter, shot);
    state.accepted += 1;
    originalProcess.call(this, shooterId, shot);
  };

  // Emergency geometric fallback now matches the visible floating mannequin:
  // one torso/propulsor AABB plus one head/visor AABB, no invisible volume below.
  proto.checkRayCylinderHit = function(
    shot: FireHitscanData,
    targetPos: { x: number; y: number; z: number },
  ) {
    const cfg = getWeaponRuntimeById(Number(shot.weaponType));
    const hit = intersectRobotHitbox(
      [shot.originX, shot.originY, shot.originZ],
      [shot.dirX, shot.dirY, shot.dirZ],
      targetPos,
      cfg.maxRange,
    );
    if (!hit) {
      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };
    }

    const damage = calculateWeaponDamageAtDistance(cfg.id, hit.distance, hit.isHeadshot);
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
  };

  const originalDisconnect = proto.handlePeerDisconnect;
  if (typeof originalDisconnect === 'function') {
    proto.handlePeerDisconnect = function(playerId: string): void {
      const state = stateFor(this);
      state.lastClientShotTime.delete(playerId);
      state.lastShotSeq.delete(playerId);
      originalDisconnect.call(this, playerId);
    };
  }
}

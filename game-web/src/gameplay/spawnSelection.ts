import {
  CENTRAL_HUB_RADIUS,
  CENTRAL_SUPPLY_MAX_RADIUS,
  CENTRAL_SUPPLY_MIN_RADIUS,
  GIANT_CRATER_CENTER_X,
  GIANT_CRATER_CENTER_Z,
  GIANT_CRATER_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Z,
} from '../world/worldTopology.ts';

export {
  CENTRAL_HUB_RADIUS,
  CENTRAL_SUPPLY_MAX_RADIUS,
  CENTRAL_SUPPLY_MIN_RADIUS,
  GIANT_CRATER_CENTER_X,
  GIANT_CRATER_CENTER_Z,
  GIANT_CRATER_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Z,
} from '../world/worldTopology.ts';

export type SpawnPoint = {
  id: string;
  label: string;
  x: number;
  z: number;
};

export type SpawnThreat = {
  slot?: number | null;
  isAlive?: boolean;
  position?: { x: number; z: number } | null;
};

const SPAWN_SLOT_COUNT = 16;
const INNER_SPAWN_RADIUS = 18;
const OUTER_SPAWN_RADIUS = 32;
const TAU = Math.PI * 2;
const SCORE_EPSILON = 0.01;

/**
 * The world origin is the narrative/gameplay hub. Slot 0 starts exactly at the
 * map center while the remaining slots spread across the same protected
 * clearing so multiplayer players never overlap on one transform.
 */
export const SPAWN_POINTS: readonly SpawnPoint[] = Array.from({ length: SPAWN_SLOT_COUNT }, (_, index) => {
  if (index === 0) {
    return {
      id: 'S1',
      label: 'CENTRO 01',
      x: WORLD_CENTER_X,
      z: WORLD_CENTER_Z,
    };
  }

  const innerRing = index <= 7;
  const ringIndex = innerRing ? index - 1 : index - 8;
  const ringSize = innerRing ? 7 : 8;
  const radius = innerRing ? INNER_SPAWN_RADIUS : OUTER_SPAWN_RADIUS;
  const angle = (ringIndex / ringSize) * TAU + (innerRing ? 0 : Math.PI / 8);
  return {
    id: `S${index + 1}`,
    label: `CENTRO ${String(index + 1).padStart(2, '0')}`,
    x: WORLD_CENTER_X + Math.cos(angle) * radius,
    z: WORLD_CENTER_Z + Math.sin(angle) * radius,
  };
});

export const PLAYER_SPAWN_X = WORLD_CENTER_X;
export const PLAYER_SPAWN_Z = WORLD_CENTER_Z;

function normalizedSlot(slot: number | null | undefined): number {
  return Number.isInteger(slot) ? Math.abs(Number(slot)) % SPAWN_POINTS.length : 0;
}

export function getSpawnPointForSlot(slot: number | null | undefined): SpawnPoint {
  return SPAWN_POINTS[normalizedSlot(slot)];
}

/**
 * Host-authoritative respawn selection. It maximizes the minimum horizontal
 * distance from every currently alive opponent while remaining deterministic
 * for the same authoritative world state.
 */
export function getSafestRespawnPoint(
  slot: number | null | undefined,
  threats: readonly SpawnThreat[],
): SpawnPoint {
  const safeSlot = normalizedSlot(slot);
  const fallback = SPAWN_POINTS[safeSlot];
  const aliveThreats = threats.filter((threat) => {
    if (threat.isAlive === false || threat.slot === safeSlot) return false;
    const x = Number(threat.position?.x);
    const z = Number(threat.position?.z);
    return Number.isFinite(x) && Number.isFinite(z);
  });
  if (aliveThreats.length === 0) return fallback;

  let best = fallback;
  let bestScore = -Infinity;
  let bestTieRank = Infinity;

  for (let index = 0; index < SPAWN_POINTS.length; index += 1) {
    const point = SPAWN_POINTS[index];
    let nearestThreatDistanceSq = Infinity;
    for (const threat of aliveThreats) {
      const dx = point.x - Number(threat.position!.x);
      const dz = point.z - Number(threat.position!.z);
      nearestThreatDistanceSq = Math.min(nearestThreatDistanceSq, dx * dx + dz * dz);
    }

    const tieRank = (index - safeSlot + SPAWN_POINTS.length) % SPAWN_POINTS.length;
    if (
      nearestThreatDistanceSq > bestScore + SCORE_EPSILON ||
      (Math.abs(nearestThreatDistanceSq - bestScore) <= SCORE_EPSILON && tieRank < bestTieRank)
    ) {
      best = point;
      bestScore = nearestThreatDistanceSq;
      bestTieRank = tieRank;
    }
  }

  return best;
}

import { getTerrainHeightAt } from '../world/chunkManager.ts';

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

export const GIANT_CRATER_CENTER_X = 1200;
export const GIANT_CRATER_CENTER_Z = 1200;
export const GIANT_CRATER_RADIUS = 250;
export const CRATER_SUPPLY_RADIUS = 178;

const SPAWN_SLOT_COUNT = 16;
const INNER_SPAWN_RADIUS = 44;
const OUTER_SPAWN_RADIUS = 72;
const TAU = Math.PI * 2;
const SCORE_EPSILON = 0.01;

/**
 * All PvP slots spawn around the central floor of the south-east giant crater.
 * Two staggered rings keep the full 16-player session separated without placing
 * everybody on one coordinate or pushing anyone onto the steep crater rim.
 */
export const SPAWN_POINTS: readonly SpawnPoint[] = Array.from({ length: SPAWN_SLOT_COUNT }, (_, index) => {
  const outerRing = index >= 8;
  const ringIndex = index % 8;
  const radius = outerRing ? OUTER_SPAWN_RADIUS : INNER_SPAWN_RADIUS;
  const angle = (ringIndex / 8) * TAU + (outerRing ? Math.PI / 8 : 0);
  return {
    id: `S${index + 1}`,
    label: `CRATERE ${String(index + 1).padStart(2, '0')}`,
    x: GIANT_CRATER_CENTER_X + Math.cos(angle) * radius,
    z: GIANT_CRATER_CENTER_Z + Math.sin(angle) * radius,
  };
});

export const PLAYER_SPAWN_X = SPAWN_POINTS[0].x;
export const PLAYER_SPAWN_Z = SPAWN_POINTS[0].z;

function normalizedSlot(slot: number | null | undefined): number {
  return Number.isInteger(slot) ? Math.abs(Number(slot)) % SPAWN_POINTS.length : 0;
}

export function getSpawnPointForSlot(slot: number | null | undefined): SpawnPoint {
  return SPAWN_POINTS[normalizedSlot(slot)];
}

/**
 * Host-authoritative respawn selection. It maximizes the minimum horizontal
 * distance from every currently alive opponent while remaining deterministic
 * for the same authoritative world state. The slot spawn is the stable fallback
 * and deterministic tie-break origin, so isolated tests/offline play do not
 * become random and initial spawn semantics remain unchanged.
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

export function getPlayerSpawnY(
  player?: { height?: number; floatHeight?: number },
  point: SpawnPoint = SPAWN_POINTS[0],
): number {
  const height = Number(player?.height ?? 2.0);
  const floatHeight = Number(player?.floatHeight ?? 0.5);
  return getTerrainHeightAt(point.x, point.z) + height + floatHeight;
}

import { getTerrainHeightAt } from '../world/chunkManager.ts';

export type SpawnPoint = {
  id: string;
  label: string;
  x: number;
  z: number;
};

export const GIANT_CRATER_CENTER_X = 1200;
export const GIANT_CRATER_CENTER_Z = 1200;
export const GIANT_CRATER_RADIUS = 250;
export const CRATER_SUPPLY_RADIUS = 178;

const SPAWN_SLOT_COUNT = 16;
const INNER_SPAWN_RADIUS = 44;
const OUTER_SPAWN_RADIUS = 72;
const TAU = Math.PI * 2;

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

export function getSpawnPointForSlot(slot: number | null | undefined): SpawnPoint {
  const safeSlot = Number.isInteger(slot) ? Math.abs(Number(slot)) : 0;
  return SPAWN_POINTS[safeSlot % SPAWN_POINTS.length];
}

export function getPlayerSpawnY(
  player?: { height?: number; floatHeight?: number },
  point: SpawnPoint = SPAWN_POINTS[0],
): number {
  const height = Number(player?.height ?? 2.0);
  const floatHeight = Number(player?.floatHeight ?? 0.5);
  return getTerrainHeightAt(point.x, point.z) + height + floatHeight;
}

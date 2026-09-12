import { getTerrainHeightAt } from '../world/chunkManager.ts';

export type SpawnPoint = {
  id: string;
  label: string;
  x: number;
  z: number;
};

/** Deterministic spawn slots across the 4.8 km gameplay window. */
export const SPAWN_POINTS: readonly SpawnPoint[] = [
  { id: 'S1', label: 'CRATERE SE', x: 1200, z: 1200 },
  { id: 'S2', label: 'CORRIDOIO NE', x: 1200, z: -1200 },
  { id: 'S3', label: 'PIANORO SW', x: -1200, z: 1200 },
  { id: 'S4', label: 'MASSICCIO NW', x: -1200, z: -1200 },
  { id: 'S5', label: 'ANELLO EST', x: 1650, z: 250 },
  { id: 'S6', label: 'ANELLO SUD', x: 250, z: 1650 },
  { id: 'S7', label: 'ANELLO OVEST', x: -1650, z: -250 },
  { id: 'S8', label: 'ANELLO NORD', x: -250, z: -1650 },
] as const;

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

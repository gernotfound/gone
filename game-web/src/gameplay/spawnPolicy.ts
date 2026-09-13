import { getTerrainHeightAt } from '../world/chunkManager.ts';
import {
  SPAWN_POINTS,
  type SpawnPoint,
} from './spawnSelection.ts';

export {
  CRATER_SUPPLY_RADIUS,
  GIANT_CRATER_CENTER_X,
  GIANT_CRATER_CENTER_Z,
  GIANT_CRATER_RADIUS,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  SPAWN_POINTS,
  getSafestRespawnPoint,
  getSpawnPointForSlot,
  type SpawnPoint,
  type SpawnThreat,
} from './spawnSelection.ts';

export function getPlayerSpawnY(
  player?: { height?: number; floatHeight?: number },
  point: SpawnPoint = SPAWN_POINTS[0],
): number {
  const height = Number(player?.height ?? 2.0);
  const floatHeight = Number(player?.floatHeight ?? 0.5);
  return getTerrainHeightAt(point.x, point.z) + height + floatHeight;
}

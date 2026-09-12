export const CHUNK_SIZE = 400;
export const CHUNK_RESOLUTION = 64;
export const CHUNK_RADIUS = 2;
export const CHUNK_DETAIL_RADIUS = 1;
export const CHUNK_HARD_UNLOAD_RADIUS = 3;
export const TERRAIN_GEOMETRY_POOL_LIMIT = 8;
export const CHUNK_DATA_CACHE_LIMIT = 24;

// Streaming work is deliberately paced after an expensive chunk build. A
// single terrain build is never split (WASM returns one coherent payload), but
// costly builds no longer run on back-to-back animation frames and compound a
// frame hitch on slower phones.
export const TERRAIN_BUILD_SOFT_BUDGET_MS = 8;
export const TERRAIN_BUILD_MAX_COOLDOWN_MS = 48;

export const WORLD_FOG_NEAR = CHUNK_SIZE * (CHUNK_RADIUS - 1.6);
export const WORLD_FOG_FAR = CHUNK_SIZE * (CHUNK_RADIUS - 0.7);
export const CHUNK_RENDER_CULL_MARGIN = 80;

/**
 * Chunk meshes are centered on cx * CHUNK_SIZE, so membership boundaries sit
 * half a chunk away from the origin. Using floor(world / size) would shift the
 * streaming grid by half a tile and cause unnecessary churn around x/z = 0.
 */
export function worldToChunkCoord(value: number): number {
  return Math.floor((value + CHUNK_SIZE * 0.5) / CHUNK_SIZE);
}

export function chunkCoordToWorld(coord: number): number {
  return coord * CHUNK_SIZE;
}

export function chunkDistanceSq(
  cx: number,
  cz: number,
  centerX: number,
  centerZ: number,
): number {
  const dx = cx - centerX;
  const dz = cz - centerZ;
  return dx * dx + dz * dz;
}

export function isChunkInLoadRadius(dx: number, dz: number): boolean {
  return dx * dx + dz * dz <= CHUNK_RADIUS * CHUNK_RADIUS + 1;
}

export function isChunkInDetailRadius(
  cx: number,
  cz: number,
  centerX: number,
  centerZ: number,
): boolean {
  return (
    Math.abs(cx - centerX) <= CHUNK_DETAIL_RADIUS &&
    Math.abs(cz - centerZ) <= CHUNK_DETAIL_RADIUS
  );
}

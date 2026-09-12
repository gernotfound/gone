import * as THREE from 'three';
import { generate_chunk, get_height_at } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';
import { createNaturalSunRay } from './naturalSunRays.ts';
import { createGroundedRockInstances } from './rockInstances.ts';
import {
  acquireTerrainGeometry,
  applyTerrainData,
  getTerrainGeometryPoolSize,
  releaseTerrainGeometry,
} from './terrainGeometryPool.ts';
import {
  CHUNK_DATA_CACHE_LIMIT,
  CHUNK_HARD_UNLOAD_RADIUS,
  CHUNK_RADIUS,
  CHUNK_RENDER_CULL_MARGIN,
  CHUNK_RESOLUTION,
  CHUNK_SIZE,
  TERRAIN_BUILD_MAX_COOLDOWN_MS,
  TERRAIN_BUILD_SOFT_BUDGET_MS,
  WORLD_FOG_FAR,
  chunkCoordToWorld,
  chunkDistanceSq,
  isChunkInDetailRadius,
  isChunkInLoadRadius,
  worldToChunkCoord,
} from './worldConfig.ts';

export { CHUNK_RADIUS, CHUNK_RESOLUTION, CHUNK_SIZE } from './worldConfig.ts';

type ChunkPayload = {
  heights: Float32Array;
  normals: Float32Array;
  colors: Uint8Array;
  rocks: Float32Array;
};

export interface ChunkRecord {
  id: string;
  cx: number;
  cz: number;
  mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial>;
  rocks: THREE.InstancedMesh | null;
  rockData: Float32Array | null;
  heightData: Float32Array;
  ray: THREE.Mesh | null;
}

type PendingChunk = {
  id: string;
  cx: number;
  cz: number;
  priority: number;
};

export type ChunkStreamingStats = {
  active: number;
  rendered: number;
  queuedTerrain: number;
  queuedDetails: number;
  pooledGeometries: number;
  cachedChunks: number;
  cacheHits: number;
  cacheMisses: number;
  lastBuildMs: number;
  lastBuildKind: 'terrain' | 'rocks' | 'none';
};

export const activeChunks = new Map<string, ChunkRecord>();

const desiredChunkIds = new Set<string>();
const pendingTerrainIds = new Set<string>();
const pendingDetailIds = new Set<string>();
const chunkDataCache = new Map<string, ChunkPayload>();

let pendingTerrain: PendingChunk[] = [];
let lastChunkX: number | null = null;
let lastChunkZ: number | null = null;
let lastBuildMs = 0;
let lastBuildKind: ChunkStreamingStats['lastBuildKind'] = 'none';
let cacheHits = 0;
let cacheMisses = 0;
let nextTerrainBuildAt = 0;

export function getChunkMeshes(): THREE.Object3D[] {
  const meshes: THREE.Object3D[] = [];
  for (const chunk of activeChunks.values()) meshes.push(chunk.mesh);
  return meshes;
}

export function getTerrainHeightAt(x: number, z: number): number {
  return get_height_at(x, z);
}

export function getChunkStreamingStats(): ChunkStreamingStats {
  let rendered = 0;
  for (const chunk of activeChunks.values()) {
    if (chunk.mesh.visible) rendered += 1;
  }
  return {
    active: activeChunks.size,
    rendered,
    queuedTerrain: pendingTerrainIds.size,
    queuedDetails: pendingDetailIds.size,
    pooledGeometries: getTerrainGeometryPoolSize(),
    cachedChunks: chunkDataCache.size,
    cacheHits,
    cacheMisses,
    lastBuildMs,
    lastBuildKind,
  };
}

function chunkId(cx: number, cz: number): string {
  return `${cx},${cz}`;
}

function seededRandom(seed: number): number {
  const value = Math.sin(seed) * 43758.5453;
  return value - Math.floor(value);
}

function cachePayload(id: string, payload: ChunkPayload): void {
  chunkDataCache.delete(id);
  chunkDataCache.set(id, payload);
  while (chunkDataCache.size > CHUNK_DATA_CACHE_LIMIT) {
    const oldest = chunkDataCache.keys().next().value as string | undefined;
    if (!oldest) break;
    chunkDataCache.delete(oldest);
  }
}

function loadChunkPayload(
  id: string,
  cx: number,
  cz: number,
  offsetX: number,
  offsetZ: number,
): ChunkPayload {
  const cached = chunkDataCache.get(id);
  if (cached) {
    cacheHits += 1;
    chunkDataCache.delete(id);
    chunkDataCache.set(id, cached);
    return cached;
  }

  cacheMisses += 1;
  const chunkData = generate_chunk(
    cx,
    cz,
    offsetX,
    offsetZ,
    CHUNK_SIZE,
    CHUNK_RESOLUTION,
  );
  try {
    const payload: ChunkPayload = {
      heights: chunkData.get_heights(),
      normals: chunkData.get_normals(),
      colors: chunkData.get_colors(),
      rocks: chunkData.get_rocks(),
    };
    cachePayload(id, payload);
    return payload;
  } finally {
    chunkData.free();
  }
}

function buildChunk(
  cx: number,
  cz: number,
  centerX: number,
  centerZ: number,
): ChunkRecord {
  const id = chunkId(cx, cz);
  const offsetX = chunkCoordToWorld(cx);
  const offsetZ = chunkCoordToWorld(cz);
  const payload = loadChunkPayload(id, cx, cz, offsetX, offsetZ);
  const geometry = acquireTerrainGeometry();

  try {
    applyTerrainData(geometry, payload.heights, payload.normals, payload.colors);
  } catch (error) {
    releaseTerrainGeometry(geometry);
    throw error;
  }

  const mesh = new THREE.Mesh(geometry, sceneManager.terrainMaterial);
  mesh.position.set(offsetX, 0, offsetZ);
  mesh.receiveShadow = false;
  mesh.castShadow = false;
  // Terrain chunks never move after creation. Avoid recomputing their local
  // transform every render frame; world transforms remain available to child
  // details and raycasts through Three.js' normal matrix-world propagation.
  mesh.matrixAutoUpdate = false;
  mesh.updateMatrix();

  const nearDetail = isChunkInDetailRadius(cx, cz, centerX, centerZ);
  const rocks = nearDetail
    ? createGroundedRockInstances(payload.rocks, payload.heights, offsetX, offsetZ)
    : null;
  if (rocks) mesh.add(rocks);

  let ray: THREE.Mesh | null = null;
  const seed = cx * 12.9898 + cz * 78.233;
  if (seededRandom(seed) > 0.82) {
    const localX = (seededRandom(seed + 2.1) - 0.5) * CHUNK_SIZE;
    const localZ = (seededRandom(seed + 3.7) - 0.5) * CHUNK_SIZE;
    ray = createNaturalSunRay(mesh, localX, localZ, seed);
    mesh.add(ray);
  }

  const record: ChunkRecord = {
    id,
    cx,
    cz,
    mesh,
    rocks,
    rockData: nearDetail ? null : payload.rocks,
    heightData: payload.heights,
    ray,
  };
  sceneManager.scene.add(mesh);
  activeChunks.set(id, record);
  return record;
}

function disposeChunk(record: ChunkRecord): void {
  sceneManager.scene.remove(record.mesh);
  if (record.rocks) record.rocks.dispose();
  record.mesh.clear();
  releaseTerrainGeometry(record.mesh.geometry);
  activeChunks.delete(record.id);
  pendingDetailIds.delete(record.id);
}

function refreshDesiredChunks(centerX: number, centerZ: number): void {
  desiredChunkIds.clear();
  const nextPending: PendingChunk[] = [];
  pendingTerrainIds.clear();

  for (let dx = -CHUNK_RADIUS; dx <= CHUNK_RADIUS; dx += 1) {
    for (let dz = -CHUNK_RADIUS; dz <= CHUNK_RADIUS; dz += 1) {
      if (!isChunkInLoadRadius(dx, dz)) continue;
      const cx = centerX + dx;
      const cz = centerZ + dz;
      const id = chunkId(cx, cz);
      desiredChunkIds.add(id);
      if (!activeChunks.has(id)) {
        pendingTerrainIds.add(id);
        nextPending.push({ id, cx, cz, priority: dx * dx + dz * dz });
      }
    }
  }

  nextPending.sort((a, b) => a.priority - b.priority);
  pendingTerrain = nextPending;

  for (const record of [...activeChunks.values()]) {
    if (
      Math.abs(record.cx - centerX) > CHUNK_HARD_UNLOAD_RADIUS ||
      Math.abs(record.cz - centerZ) > CHUNK_HARD_UNLOAD_RADIUS
    ) {
      disposeChunk(record);
    }
  }

  reconcileChunkDetails(centerX, centerZ);
}

function reconcileChunkDetails(centerX: number, centerZ: number): void {
  for (const record of activeChunks.values()) {
    const nearDetail = isChunkInDetailRadius(record.cx, record.cz, centerX, centerZ);
    if (record.rocks) record.rocks.visible = nearDetail;
    if (nearDetail && !record.rocks && record.rockData && record.rockData.length >= 9) {
      pendingDetailIds.add(record.id);
    } else if (!nearDetail) {
      pendingDetailIds.delete(record.id);
    }

    if (record.ray) {
      record.ray.visible =
        desiredChunkIds.has(record.id) &&
        chunkDistanceSq(record.cx, record.cz, centerX, centerZ) <= CHUNK_RADIUS * CHUNK_RADIUS + 1;
    }
  }
}

function processOneTerrainBuild(centerX: number, centerZ: number): boolean {
  while (pendingTerrain.length > 0) {
    const next = pendingTerrain.shift()!;
    pendingTerrainIds.delete(next.id);
    if (!desiredChunkIds.has(next.id) || activeChunks.has(next.id)) continue;

    const startedAt = performance.now();
    buildChunk(next.cx, next.cz, centerX, centerZ);
    lastBuildMs = performance.now() - startedAt;
    lastBuildKind = 'terrain';

    // Expensive WASM terrain generation is intentionally followed by a short
    // cooldown. This keeps movement/input frames responsive on slower devices
    // instead of scheduling another heavy chunk immediately on the next frame.
    nextTerrainBuildAt = performance.now() + (
      lastBuildMs > TERRAIN_BUILD_SOFT_BUDGET_MS
        ? Math.min(TERRAIN_BUILD_MAX_COOLDOWN_MS, lastBuildMs)
        : 0
    );

    reconcileChunkDetails(centerX, centerZ);
    return true;
  }
  return false;
}

function processOneDetailBuild(centerX: number, centerZ: number): boolean {
  for (const id of pendingDetailIds) {
    pendingDetailIds.delete(id);
    const record = activeChunks.get(id);
    if (!record || record.rocks || !record.rockData || !isChunkInDetailRadius(record.cx, record.cz, centerX, centerZ)) {
      continue;
    }

    const startedAt = performance.now();
    record.rocks = createGroundedRockInstances(
      record.rockData,
      record.heightData,
      record.mesh.position.x,
      record.mesh.position.z,
    );
    record.rockData = null;
    if (record.rocks) record.mesh.add(record.rocks);
    lastBuildMs = performance.now() - startedAt;
    lastBuildKind = 'rocks';
    return true;
  }
  return false;
}

function unloadStaleChunksWhenSettled(): void {
  if (pendingTerrainIds.size > 0) return;
  for (const record of [...activeChunks.values()]) {
    if (!desiredChunkIds.has(record.id)) disposeChunk(record);
  }
}

function updateRenderVisibility(playerPosition: THREE.Vector3): void {
  const limit = WORLD_FOG_FAR + CHUNK_RENDER_CULL_MARGIN;
  const limitSq = limit * limit;
  const half = CHUNK_SIZE * 0.5;

  for (const record of activeChunks.values()) {
    const dx = Math.max(Math.abs(playerPosition.x - record.mesh.position.x) - half, 0);
    const dz = Math.max(Math.abs(playerPosition.z - record.mesh.position.z) - half, 0);
    record.mesh.visible = dx * dx + dz * dz <= limitSq;
  }
}

export function updateChunks(playerPosition: THREE.Vector3): void {
  const centerX = worldToChunkCoord(playerPosition.x);
  const centerZ = worldToChunkCoord(playerPosition.z);
  const centerChanged = centerX !== lastChunkX || centerZ !== lastChunkZ;

  if (centerChanged || desiredChunkIds.size === 0) {
    lastChunkX = centerX;
    lastChunkZ = centerZ;
    refreshDesiredChunks(centerX, centerZ);
  }

  const now = performance.now();
  const builtTerrain = pendingTerrainIds.size > 0 && now >= nextTerrainBuildAt
    ? processOneTerrainBuild(centerX, centerZ)
    : false;

  // Detail work waits until the terrain queue is settled; mixing rock creation
  // into a terrain cooldown would defeat the frame-pacing safeguard above.
  if (!builtTerrain && pendingTerrainIds.size === 0) {
    if (!processOneDetailBuild(centerX, centerZ) && !centerChanged) {
      lastBuildKind = 'none';
      lastBuildMs = 0;
    }
  }

  unloadStaleChunksWhenSettled();
  updateRenderVisibility(playerPosition);
}

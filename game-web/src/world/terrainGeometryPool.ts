import * as THREE from 'three';
import {
  CHUNK_RESOLUTION,
  CHUNK_SIZE,
  TERRAIN_GEOMETRY_POOL_LIMIT,
} from './worldConfig.ts';

const terrainGeometryPool: THREE.PlaneGeometry[] = [];

function createTerrainGeometry(): THREE.PlaneGeometry {
  const geometry = new THREE.PlaneGeometry(
    CHUNK_SIZE,
    CHUNK_SIZE,
    CHUNK_RESOLUTION,
    CHUNK_RESOLUTION,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  position.setUsage(THREE.DynamicDrawUsage);
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  normal.setUsage(THREE.DynamicDrawUsage);

  const color = new THREE.Uint8BufferAttribute(
    new Uint8Array(position.count * 3),
    3,
    true,
  );
  color.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('color', color);
  return geometry;
}

export function acquireTerrainGeometry(): THREE.PlaneGeometry {
  return terrainGeometryPool.pop() ?? createTerrainGeometry();
}

export function releaseTerrainGeometry(geometry: THREE.PlaneGeometry): void {
  if (terrainGeometryPool.length < TERRAIN_GEOMETRY_POOL_LIMIT) {
    terrainGeometryPool.push(geometry);
  } else {
    geometry.dispose();
  }
}

export function applyTerrainData(
  geometry: THREE.PlaneGeometry,
  heights: Float32Array,
  normals: Float32Array,
  colors: Uint8Array,
): void {
  const position = geometry.getAttribute('position') as THREE.BufferAttribute;
  const normal = geometry.getAttribute('normal') as THREE.BufferAttribute;
  const color = geometry.getAttribute('color') as THREE.Uint8BufferAttribute;

  if (
    heights.length !== position.count ||
    normals.length !== normal.count * 3 ||
    colors.length !== color.count * 3
  ) {
    throw new Error(
      `Terrain buffer mismatch: heights=${heights.length}, normals=${normals.length}, colors=${colors.length}, vertices=${position.count}`,
    );
  }

  const positionArray = position.array as Float32Array;
  for (let i = 0; i < heights.length; i += 1) {
    positionArray[i * 3 + 1] = heights[i];
  }
  (normal.array as Float32Array).set(normals);
  (color.array as Uint8Array).set(colors);

  position.needsUpdate = true;
  normal.needsUpdate = true;
  color.needsUpdate = true;

  // PlaneGeometry computed bounds while it was still flat. Recompute after
  // height injection so tall peaks/craters are culled correctly. Normals are
  // generated from the same cached height grid in Rust/JS, so the browser no
  // longer performs computeVertexNormals() on the main thread for every chunk.
  geometry.computeBoundingBox();
  geometry.computeBoundingSphere();
}

export function getTerrainGeometryPoolSize(): number {
  return terrainGeometryPool.length;
}

import * as THREE from 'three';
import { get_height_at } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';
import { CHUNK_RESOLUTION, CHUNK_SIZE } from './worldConfig.ts';

const rockDummy = new THREE.Object3D();
const TERRAIN_CELL = CHUNK_SIZE / CHUNK_RESOLUTION;
const TERRAIN_VERTS = CHUNK_RESOLUTION + 1;

function sampleHeightGrid(
  heights: Float32Array,
  offsetX: number,
  offsetZ: number,
  worldX: number,
  worldZ: number,
): number {
  const gx = (worldX - offsetX + CHUNK_SIZE * 0.5) / TERRAIN_CELL;
  const gz = (worldZ - offsetZ + CHUNK_SIZE * 0.5) / TERRAIN_CELL;

  // Rock/debris generation can place a few samples just across a chunk edge.
  // Use the procedural sampler only for those rare cases; all in-chunk support
  // checks are served from the height grid already generated for the terrain.
  if (gx < 0 || gz < 0 || gx > CHUNK_RESOLUTION || gz > CHUNK_RESOLUTION) {
    return get_height_at(worldX, worldZ);
  }

  const x0 = Math.floor(gx);
  const z0 = Math.floor(gz);
  const x1 = Math.min(CHUNK_RESOLUTION, x0 + 1);
  const z1 = Math.min(CHUNK_RESOLUTION, z0 + 1);
  const tx = gx - x0;
  const tz = gz - z0;

  const h00 = heights[z0 * TERRAIN_VERTS + x0];
  const h10 = heights[z0 * TERRAIN_VERTS + x1];
  const h01 = heights[z1 * TERRAIN_VERTS + x0];
  const h11 = heights[z1 * TERRAIN_VERTS + x1];
  const h0 = h00 + (h10 - h00) * tx;
  const h1 = h01 + (h11 - h01) * tx;
  return h0 + (h1 - h0) * tz;
}

function sampleRockFootprint(
  heights: Float32Array,
  centerHeight: number,
  offsetX: number,
  offsetZ: number,
  worldX: number,
  worldZ: number,
  footprint: number,
): { min: number; max: number } {
  let min = centerHeight;
  let max = centerHeight;

  const sample = (x: number, z: number) => {
    const height = sampleHeightGrid(heights, offsetX, offsetZ, x, z);
    min = Math.min(min, height);
    max = Math.max(max, height);
  };

  sample(worldX + footprint, worldZ);
  sample(worldX - footprint, worldZ);
  sample(worldX, worldZ + footprint);
  sample(worldX, worldZ - footprint);
  return { min, max };
}

export function createGroundedRockInstances(
  rocks: Float32Array,
  heights: Float32Array,
  offsetX: number,
  offsetZ: number,
): THREE.InstancedMesh | null {
  if (rocks.length < 9) return null;

  const accepted: Array<{
    x: number;
    y: number;
    z: number;
    sx: number;
    sy: number;
    sz: number;
    rx: number;
    ry: number;
    rz: number;
  }> = [];

  const rockCount = Math.floor(rocks.length / 9);
  for (let i = 0; i < rockCount; i += 1) {
    const idx = i * 9;
    const localX = rocks[idx];
    const centerHeight = rocks[idx + 1];
    const localZ = rocks[idx + 2];
    const sx = Math.max(0.05, rocks[idx + 3]);
    const sy = Math.max(0.05, rocks[idx + 4]);
    const sz = Math.max(0.05, rocks[idx + 5]);
    const worldX = offsetX + localX;
    const worldZ = offsetZ + localZ;

    const footprint = Math.max(0.35, Math.min(3.5, Math.max(sx, sz) * 0.55));
    const ground = sampleRockFootprint(
      heights,
      centerHeight,
      offsetX,
      offsetZ,
      worldX,
      worldZ,
      footprint,
    );
    const heightSpan = ground.max - ground.min;
    const maxSupportableSpan = Math.max(1.15, sy * 0.95);
    if (!Number.isFinite(ground.max) || heightSpan > maxSupportableSpan) continue;

    accepted.push({
      x: localX,
      y: ground.max + sy * 0.38,
      z: localZ,
      sx,
      sy,
      sz,
      rx: Math.sin(rocks[idx + 6]) * 0.18,
      ry: rocks[idx + 7],
      rz: Math.sin(rocks[idx + 8]) * 0.18,
    });
  }

  if (accepted.length === 0) return null;

  const instanced = new THREE.InstancedMesh(
    sceneManager.rockGeo,
    sceneManager.rockMat,
    accepted.length,
  );
  instanced.castShadow = false;
  instanced.receiveShadow = false;
  instanced.instanceMatrix.setUsage(THREE.StaticDrawUsage);

  accepted.forEach((rock, index) => {
    rockDummy.position.set(rock.x, rock.y, rock.z);
    rockDummy.scale.set(rock.sx, rock.sy, rock.sz);
    rockDummy.rotation.set(rock.rx, rock.ry, rock.rz);
    rockDummy.updateMatrix();
    instanced.setMatrixAt(index, rockDummy.matrix);
  });
  instanced.instanceMatrix.needsUpdate = true;
  instanced.computeBoundingSphere();
  return instanced;
}

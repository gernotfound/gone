import * as THREE from 'three';
import { get_height_at } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';
import { NATURAL_SUN_RAY_HEIGHT } from '../rendering/naturalSunRayResources.ts';

const GROUND_SAMPLE_RADIUS = 46;
const GROUND_PENETRATION = 8;
const GROUND_SAMPLES = 12;

const groundSample = new THREE.Vector3();
const sunQuaternion = new THREE.Quaternion().setFromUnitVectors(
  new THREE.Vector3(0, 1, 0),
  new THREE.Vector3(200, 300, -100).normalize(),
);

function deterministic01(value: number): number {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function groundRayAgainstTerrain(
  parent: THREE.Mesh,
  ray: THREE.Mesh,
  worldX: number,
  worldZ: number,
): void {
  let allowedOriginY = get_height_at(worldX, worldZ);

  for (let i = 0; i < GROUND_SAMPLES; i += 1) {
    const angle = (i / GROUND_SAMPLES) * Math.PI * 2;
    groundSample
      .set(
        Math.cos(angle) * GROUND_SAMPLE_RADIUS,
        0,
        Math.sin(angle) * GROUND_SAMPLE_RADIUS,
      )
      .multiply(ray.scale)
      .applyQuaternion(ray.quaternion);

    const terrainY = get_height_at(
      worldX + groundSample.x,
      worldZ + groundSample.z,
    );
    if (Number.isFinite(terrainY)) {
      allowedOriginY = Math.min(allowedOriginY, terrainY - groundSample.y);
    }
  }

  ray.position.y = allowedOriginY - GROUND_PENETRATION - parent.position.y;
}

/**
 * Creates a completely configured ray once, at chunk creation time.
 * No interval scan or runtime monkey-patch is required.
 */
export function createNaturalSunRay(
  parent: THREE.Mesh,
  localX: number,
  localZ: number,
  seed: number,
): THREE.Mesh {
  const ray = new THREE.Mesh(sceneManager.rayGeo, sceneManager.rayMat);
  ray.position.set(localX, 0, localZ);
  ray.quaternion.copy(sunQuaternion);

  const length = 1080 + deterministic01(seed + 1.7) * 420;
  const widthX = 0.62 + deterministic01(seed + 2.9) * 0.46;
  const widthZ = 0.54 + deterministic01(seed + 4.1) * 0.42;
  ray.scale.set(widthX, length / NATURAL_SUN_RAY_HEIGHT, widthZ);
  ray.rotateY(deterministic01(seed + 8.3) * Math.PI * 2);

  const worldX = parent.position.x + localX;
  const worldZ = parent.position.z + localZ;
  groundRayAgainstTerrain(parent, ray, worldX, worldZ);

  // The ray is large and oblique; conservative culling avoids disappearing beams.
  ray.frustumCulled = false;
  return ray;
}

import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import {
  MAZE_WALLS,
  MAZE_WALL_BOTTOM_Y,
  MAZE_WALL_HEIGHT,
  MAZE_WALL_TOP_Y,
  type MazeWall,
} from './mazeLayout.ts';

const dummy = new THREE.Object3D();
let mazeMesh: THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> | null = null;

function wallTransform(wall: MazeWall): void {
  dummy.position.set(
    wall.x,
    (MAZE_WALL_BOTTOM_Y + MAZE_WALL_TOP_Y) * 0.5,
    wall.z,
  );
  dummy.rotation.set(0, 0, 0);
  dummy.scale.set(wall.width, MAZE_WALL_HEIGHT, wall.depth);
  dummy.updateMatrix();
}

function buildMazeMesh(): THREE.InstancedMesh<THREE.BoxGeometry, THREE.MeshStandardMaterial> {
  const geometry = new THREE.BoxGeometry(1, 1, 1);
  const material = new THREE.MeshStandardMaterial({
    color: 0x263645,
    emissive: 0x082f49,
    emissiveIntensity: 0.32,
    roughness: 0.82,
    metalness: 0.38,
  });
  const mesh = new THREE.InstancedMesh(geometry, material, MAZE_WALLS.length);
  mesh.name = 'WorldMaze';
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.instanceMatrix.setUsage(THREE.StaticDrawUsage);
  mesh.userData.mazeOccluder = true;

  MAZE_WALLS.forEach((wall, index) => {
    wallTransform(wall);
    mesh.setMatrixAt(index, dummy.matrix);
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingBox();
  mesh.computeBoundingSphere();
  return mesh;
}

function attachMazeWhenSceneReady(): void {
  if (!sceneManager.scene) {
    window.requestAnimationFrame(attachMazeWhenSceneReady);
    return;
  }
  if (mazeMesh) return;
  mazeMesh = buildMazeMesh();
  sceneManager.scene.add(mazeMesh);
}

export function getMazeRaycastTargets(): THREE.Object3D[] {
  return mazeMesh ? [mazeMesh] : [];
}

export function startMazePrototype(): void {
  if ((window as any).__goneMazePrototypeStarted) return;
  (window as any).__goneMazePrototypeStarted = true;
  window.requestAnimationFrame(attachMazeWhenSceneReady);
}

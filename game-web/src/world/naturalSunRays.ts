import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import { activeChunks, getTerrainHeightAt } from '../world/chunkManager.ts';

const RAY_HEIGHT = 800;
const RAY_MARKER = '__goneNaturalSunRay';

function deterministic01(value: number): number {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function buildIrregularRayGeometry(): THREE.CylinderGeometry {
  // Low-poly open cone, then deform every ring so the silhouette is neither
  // circular nor mathematically perfect. Still one shared geometry: cheap.
  const geometry = new THREE.CylinderGeometry(2.5, 45, RAY_HEIGHT, 9, 5, true);
  geometry.translate(0, RAY_HEIGHT / 2, 0);
  const position = geometry.attributes.position;

  for (let i = 0; i < position.count; i += 1) {
    const x = position.getX(i);
    const y = position.getY(i);
    const z = position.getZ(i);
    const angle = Math.atan2(z, x);
    const t = Math.max(0, Math.min(1, y / RAY_HEIGHT));
    const angularNoise =
      1 +
      Math.sin(angle * 3.0 + t * 4.7) * 0.18 +
      Math.sin(angle * 5.0 - t * 7.1) * 0.09;
    const ellipseX = 0.78 + Math.sin(t * 5.3) * 0.08;
    const ellipseZ = 1.08 + Math.cos(t * 4.1) * 0.10;
    position.setX(i, x * angularNoise * ellipseX);
    position.setZ(i, z * angularNoise * ellipseZ);
  }

  position.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();
  return geometry;
}

function installSharedGeometry(): void {
  if (!sceneManager.rayGeo || (sceneManager.rayGeo as any).userData?.naturalSunRay) return;
  const oldGeometry = sceneManager.rayGeo;
  const geometry = buildIrregularRayGeometry();
  geometry.userData.naturalSunRay = true;
  sceneManager.rayGeo = geometry;
  oldGeometry.dispose();

  if (sceneManager.rayMat) {
    sceneManager.rayMat.opacity = 0.026;
    sceneManager.rayMat.depthWrite = false;
  }
}

function naturalizeChunkRays(): void {
  if (!sceneManager.rayMat) return;

  for (const chunk of activeChunks.values()) {
    const mesh = chunk?.mesh as THREE.Mesh | undefined;
    if (!mesh) continue;

    for (const child of mesh.children) {
      const ray = child as THREE.Mesh;
      if (!ray.isMesh || ray.material !== sceneManager.rayMat || ray.userData[RAY_MARKER]) continue;
      ray.userData[RAY_MARKER] = true;

      const worldX = mesh.position.x + ray.position.x;
      const worldZ = mesh.position.z + ray.position.z;
      const seed = worldX * 0.0137 + worldZ * 0.0211;
      const groundY = getTerrainHeightAt(worldX, worldZ);

      // Geometry local Y starts at zero: anchor the broad lower end slightly
      // inside the actual terrain, then extend toward the cloud layer.
      ray.position.y = groundY - 1.5;
      const length = 900 + deterministic01(seed + 1.7) * 520;
      const widthX = 0.46 + deterministic01(seed + 2.9) * 0.72;
      const widthZ = 0.32 + deterministic01(seed + 4.1) * 0.62;
      ray.scale.set(widthX, length / RAY_HEIGHT, widthZ);
      ray.rotateY(deterministic01(seed + 8.3) * Math.PI * 2);
      ray.frustumCulled = false;
    }
  }
}

/** Natural, irregular, terrain-reaching crepuscular rays without post-processing. */
export function startNaturalSunRays(): void {
  if ((window as any).__goneNaturalSunRaysStarted) return;
  (window as any).__goneNaturalSunRaysStarted = true;

  const originalInit = sceneManager.init.bind(sceneManager);
  (sceneManager as any).init = () => {
    originalInit();
    installSharedGeometry();
  };

  // Covers hot reload / future initialization and newly streamed chunks.
  installSharedGeometry();
  window.setInterval(() => {
    installSharedGeometry();
    naturalizeChunkRays();
  }, 250);
}

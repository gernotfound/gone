import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import { activeChunks, getTerrainHeightAt } from '../world/chunkManager.ts';

const RAY_HEIGHT = 1000;
const RAY_BASE_RADIUS = 34;
const GROUND_SAMPLE_RADIUS = 46;
const GROUND_PENETRATION = 8;
const GROUND_SAMPLES = 12;
const RAY_MARKER = '__goneNaturalSunRay';
const MATERIAL_MARKER = '__goneNaturalSunRayMaterial';

const groundSample = new THREE.Vector3();

function deterministic01(value: number): number {
  const raw = Math.sin(value * 12.9898 + 78.233) * 43758.5453;
  return raw - Math.floor(raw);
}

function buildIrregularRayGeometry(): THREE.CylinderGeometry {
  // A softly tapering, slightly wandering shaft reads more like atmospheric
  // light than a perfect cone. The geometry remains shared by every chunk ray.
  const geometry = new THREE.CylinderGeometry(5.5, RAY_BASE_RADIUS, RAY_HEIGHT, 14, 8, true);
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
      Math.sin(angle * 2.7 + t * 5.1) * 0.11 +
      Math.sin(angle * 6.2 - t * 4.3) * 0.055;
    const ellipseX = 0.91 + Math.sin(t * 4.2 + 0.4) * 0.055;
    const ellipseZ = 1.04 + Math.cos(t * 3.7 - 0.3) * 0.065;

    // Tiny ring-center drift breaks the rigid ruler-straight silhouette without
    // making the beam look like smoke or adding another animated render pass.
    const driftStrength = Math.sin(Math.PI * t);
    const driftX = Math.sin(t * 5.0 + 0.8) * 4.2 * driftStrength;
    const driftZ = Math.sin(t * 3.8 - 0.6) * 3.4 * driftStrength;

    position.setX(i, x * angularNoise * ellipseX + driftX);
    position.setZ(i, z * angularNoise * ellipseZ + driftZ);
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
}

function installNaturalMaterialTuning(): void {
  const material = sceneManager.rayMat;
  if (!material || material.userData[MATERIAL_MARKER]) return;
  material.userData[MATERIAL_MARKER] = true;

  // Keep the ray present but restrained. Additive light becomes harsh quickly,
  // especially against the dark crater walls.
  material.opacity = 0.018;
  material.depthWrite = false;

  const previousOnBeforeCompile = material.onBeforeCompile;
  material.onBeforeCompile = (shader, renderer) => {
    previousOnBeforeCompile.call(material, shader, renderer);

    shader.vertexShader = shader.vertexShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vGoneSunRayT;\nvarying vec2 vGoneSunRayLocalXZ;`,
      )
      .replace(
        '#include <begin_vertex>',
        `#include <begin_vertex>\nvGoneSunRayT = clamp(position.y / ${RAY_HEIGHT.toFixed(1)}, 0.0, 1.0);\nvGoneSunRayLocalXZ = position.xz;`,
      );

    shader.fragmentShader = shader.fragmentShader
      .replace(
        '#include <common>',
        `#include <common>\nvarying float vGoneSunRayT;\nvarying vec2 vGoneSunRayLocalXZ;`,
      )
      .replace(
        '#include <dithering_fragment>',
        `// Fade toward the cloud end and introduce a very subtle static density\n// variation so the shaft does not read as one flat transparent polygon.\nfloat goneTopFade = 1.0 - smoothstep(0.76, 1.0, vGoneSunRayT);\nfloat goneDensity = 0.94 + 0.06 * sin(vGoneSunRayLocalXZ.x * 0.095 + vGoneSunRayLocalXZ.y * 0.071);\ngl_FragColor.a *= goneTopFade * goneDensity;\n#include <dithering_fragment>`,
      );
  };

  material.customProgramCacheKey = () => 'gone-natural-sun-rays-v2';
  material.needsUpdate = true;
}

function groundRayAgainstTerrain(
  mesh: THREE.Mesh,
  ray: THREE.Mesh,
  worldX: number,
  worldZ: number,
): void {
  // The lower ring is tilted with the sun direction. Anchoring only its center
  // makes the uphill edge float over steep slopes/craters. Find the highest
  // legal origin Y that keeps the complete lower footprint inside terrain.
  let allowedOriginY = getTerrainHeightAt(worldX, worldZ);

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

    const sampleWorldX = worldX + groundSample.x;
    const sampleWorldZ = worldZ + groundSample.z;
    const terrainY = getTerrainHeightAt(sampleWorldX, sampleWorldZ);
    if (!Number.isFinite(terrainY)) continue;

    // ray.position.y + groundSample.y must stay below this terrain sample.
    allowedOriginY = Math.min(allowedOriginY, terrainY - groundSample.y);
  }

  // A small burial margin also covers the visual terrain's coarse triangle
  // interpolation on very steep crater walls. Depth testing hides the buried
  // part, so the visible beam appears to terminate exactly on the ground.
  ray.position.y = allowedOriginY - GROUND_PENETRATION - mesh.position.y;
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

      const length = 1080 + deterministic01(seed + 1.7) * 420;
      const widthX = 0.62 + deterministic01(seed + 2.9) * 0.46;
      const widthZ = 0.54 + deterministic01(seed + 4.1) * 0.42;
      ray.scale.set(widthX, length / RAY_HEIGHT, widthZ);
      ray.rotateY(deterministic01(seed + 8.3) * Math.PI * 2);

      groundRayAgainstTerrain(mesh, ray, worldX, worldZ);
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
    installNaturalMaterialTuning();
  };

  // Covers hot reload / future initialization and newly streamed chunks.
  installSharedGeometry();
  installNaturalMaterialTuning();
  window.setInterval(() => {
    installSharedGeometry();
    installNaturalMaterialTuning();
    naturalizeChunkRays();
  }, 250);
}

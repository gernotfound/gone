import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { createAssaultRifleModel } from './weapons/assaultRifle.ts';
import { createSniperRifleModel } from './weapons/sniperRifle.ts';
import { createShotgunModel } from './weapons/shotgun.ts';
import { createSmgModel } from './weapons/smg.ts';
import { createKnifeModel } from './weapons/knife.ts';

export {
  createAssaultRifleModel,
  createSniperRifleModel,
  createShotgunModel,
  createSmgModel,
  createKnifeModel,
};

export type WeaponModelType = 'assalto' | 'cecchino' | 'pompa' | 'mitraglietta' | 'coltello';

export const WEAPON_SCALES: Record<WeaponModelType, number> = {
  assalto: 0.23,
  cecchino: 0.23,
  pompa: 0.23,
  mitraglietta: 0.23,
  coltello: 0.12
};

export const WEAPON_TYPES: readonly WeaponModelType[] = [
  'assalto',
  'cecchino',
  'pompa',
  'mitraglietta',
  'coltello'
] as const;


/**
 * Creates a raw weapon model matching the specified type or index.
 */
export function createWeaponModel(type: WeaponModelType | number): THREE.Group {
  let resolved: WeaponModelType;
  if (typeof type === 'number') {
    resolved = WEAPON_TYPES[type] ?? 'assalto';
  } else {
    resolved = type;
  }

  switch (resolved) {
    case 'assalto':
      return createAssaultRifleModel();
    case 'cecchino':
      return createSniperRifleModel();
    case 'pompa':
      return createShotgunModel();
    case 'mitraglietta':
      return createSmgModel();
    case 'coltello':
      return createKnifeModel();
    default:
      return createAssaultRifleModel();
  }
}

export interface ViewModelTransform {
  position: THREE.Vector3;
  rotation: THREE.Euler;
  scale: number;
}

export const VIEWMODEL_TRANSFORMS: Record<WeaponModelType, ViewModelTransform> = {
  assalto: {
    position: new THREE.Vector3(0.28, -0.24, -0.60),
    rotation: new THREE.Euler(-0.02, Math.PI / 2 - 0.04, 0.02),
    scale: 0.23
  },
  cecchino: {
    position: new THREE.Vector3(0.32, -0.28, -0.80),
    rotation: new THREE.Euler(-0.02, Math.PI / 2 - 0.03, 0.01),
    scale: 0.20
  },
  pompa: {
    position: new THREE.Vector3(0.26, -0.24, -0.55),
    rotation: new THREE.Euler(-0.02, Math.PI / 2 - 0.05, 0.02),
    scale: 0.23
  },
  mitraglietta: {
    position: new THREE.Vector3(0.24, -0.22, -0.50),
    rotation: new THREE.Euler(-0.02, Math.PI / 2 - 0.04, 0.02),
    scale: 0.23
  },
  coltello: {
    position: new THREE.Vector3(0.28, -0.22, -0.45),
    rotation: new THREE.Euler(0.15, Math.PI / 2 - 0.10, -0.20),
    scale: 0.12
  }
};

export const WEAPON_MUZZLE_POSITIONS: Record<WeaponModelType, THREE.Vector3> = {
  assalto: new THREE.Vector3(3.2, 0.1, 0),
  cecchino: new THREE.Vector3(6.4, 0.1, 0),
  pompa: new THREE.Vector3(2.9, 0.4, 0),
  mitraglietta: new THREE.Vector3(2.7, 0.2, 0),
  coltello: new THREE.Vector3(2.95, -0.05, 0)
};

export const WEAPON_GRIP_OFFSETS: Record<WeaponModelType, THREE.Vector3> = {
  assalto: new THREE.Vector3(-0.6, -0.5, 0),
  cecchino: new THREE.Vector3(-0.6, -0.5, 0),
  pompa: new THREE.Vector3(-0.6, -0.3, 0),
  mitraglietta: new THREE.Vector3(-0.6, -0.4, 0),
  coltello: new THREE.Vector3(-0.9, 0, 0)
};

const cachedWeaponGLBs = new Map<WeaponModelType, THREE.Group>();

/**
 * Resolves numeric ID or string name to WeaponModelType.
 */
export function resolveWeaponType(type: WeaponModelType | number): WeaponModelType {
  if (typeof type === 'number') {
    return WEAPON_TYPES[type] ?? 'assalto';
  }
  return type;
}

/**
 * Asynchronously loads a weapon GLTF/GLB model from disk, with fallback to procedural builder.
 */
export async function loadWeaponGLB(
  type: WeaponModelType | number,
  basePath = 'assets'
): Promise<THREE.Group> {
  const resolved = resolveWeaponType(type);

  if (cachedWeaponGLBs.has(resolved)) {
    return cachedWeaponGLBs.get(resolved)!.clone(true);
  }

  const loader = new GLTFLoader();
  const candidates = [
    `${basePath}/${resolved}.glb`,
    `/${basePath}/${resolved}.glb`,
    `/public/${basePath}/${resolved}.glb`,
    `public/assets/${resolved}.glb`,
    `/${resolved}.glb`
  ];

  for (const path of candidates) {
    try {
      const gltf = await loader.loadAsync(path);
      if (gltf && gltf.scene) {
        const root = gltf.scene;
        root.name = `GLB_${resolved}`;
        root.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            const mesh = c as THREE.Mesh;
            if (mesh.geometry) {
              mesh.geometry.userData.sharedAsset = true;
            }
            if (mesh.material) {
              if (Array.isArray(mesh.material)) {
                mesh.material.forEach(m => m.userData.sharedAsset = true);
              } else {
                mesh.material.userData.sharedAsset = true;
              }
            }
          }
        });
        cachedWeaponGLBs.set(resolved, root.clone(true));
        return root;
      }
    } catch {
      // Continue trying next candidate path
    }
  }

  // Fallback to procedural builder
  const fallback = createWeaponModel(resolved);
  fallback.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      const mesh = c as THREE.Mesh;
      if (mesh.geometry) mesh.geometry.userData.sharedAsset = true;
      if (mesh.material) {
        if (Array.isArray(mesh.material)) {
          mesh.material.forEach(m => m.userData.sharedAsset = true);
        } else {
          mesh.material.userData.sharedAsset = true;
        }
      }
    }
  });
  cachedWeaponGLBs.set(resolved, fallback.clone(true));
  return fallback;
}

/**
 * Asynchronously preloads all 5 weapon GLBs concurrently.
 */
export async function loadAllWeapons(
  basePath = 'assets'
): Promise<Record<WeaponModelType, THREE.Group>> {
  const entries = await Promise.all(
    WEAPON_TYPES.map(async (t) => {
      const group = await loadWeaponGLB(t, basePath);
      return [t, group] as const;
    })
  );
  return Object.fromEntries(entries) as Record<WeaponModelType, THREE.Group>;
}

/**
 * Creates a first-person weapon viewmodel using procedural model:
 * - Orientated and positioned with natural viewpoint offsets.
 * - Ready to be attached directly to the player camera.
 */
export function createWeaponViewModel(
  type: WeaponModelType | number,
  scaleOverride?: number
): THREE.Group {
  const resolved = resolveWeaponType(type);
  const root = new THREE.Group();
  root.name = `ViewModel_${resolved}`;

  const weaponMesh = createWeaponModel(resolved);
  const transform = VIEWMODEL_TRANSFORMS[resolved];
  const scale = scaleOverride ?? transform.scale;

  weaponMesh.position.copy(transform.position);
  weaponMesh.rotation.copy(transform.rotation);
  weaponMesh.scale.set(scale, scale, scale);

  root.add(weaponMesh);
  return root;
}

/**
 * Asynchronously loads first-person weapon viewmodel using GLB asset (with procedural fallback):
 * - Orientated and positioned with natural viewpoint offsets.
 */
export async function loadWeaponViewModel(
  type: WeaponModelType | number,
  basePath = 'assets',
  scaleOverride?: number
): Promise<THREE.Group> {
  const resolved = resolveWeaponType(type);
  const root = new THREE.Group();
  root.name = `ViewModel_${resolved}`;

  const weaponMesh = await loadWeaponGLB(resolved, basePath);
  const transform = VIEWMODEL_TRANSFORMS[resolved];
  const scale = scaleOverride ?? transform.scale;

  weaponMesh.position.copy(transform.position);
  weaponMesh.rotation.copy(transform.rotation);
  weaponMesh.scale.set(scale, scale, scale);

  root.add(weaponMesh);
  return root;
}

/**
 * Creates a weapon prepared for socket attachment on third-person robot player:
 * Points along +Z (robot facing direction) and scaled appropriately.
 */
export function createThirdPersonWeapon(
  type: WeaponModelType | number,
  scaleOverride?: number
): THREE.Group {
  const resolved = resolveWeaponType(type);
  const root = new THREE.Group();
  root.name = `ThirdPersonWeapon_${resolved}`;

  const weaponMesh = createWeaponModel(resolved);
  // Weapon in raw asset points +X. Robot faces +Z.
  // In Three.js right-handed coordinates, rotating -90 degrees around Y rotates +X into +Z.
  weaponMesh.rotation.y = -Math.PI / 2;

  const scale = scaleOverride ?? WEAPON_SCALES[resolved];
  weaponMesh.scale.set(scale, scale, scale);

  // Position weapon so handle fits right into claw socket
  const grip = WEAPON_GRIP_OFFSETS[resolved];
  weaponMesh.position.set(0, -grip.y * scale, -grip.x * scale);

  root.add(weaponMesh);
  return root;
}

/**
 * Asynchronously loads a weapon prepared for third-person socket attachment using GLB asset.
 */
export async function loadThirdPersonWeapon(
  type: WeaponModelType | number,
  basePath = 'assets',
  scaleOverride?: number
): Promise<THREE.Group> {
  const resolved = resolveWeaponType(type);
  const root = new THREE.Group();
  root.name = `ThirdPersonWeapon_${resolved}`;

  const weaponMesh = await loadWeaponGLB(resolved, basePath);
  weaponMesh.rotation.y = -Math.PI / 2;

  const scale = scaleOverride ?? WEAPON_SCALES[resolved];
  weaponMesh.scale.set(scale, scale, scale);

  const grip = WEAPON_GRIP_OFFSETS[resolved];
  weaponMesh.position.set(0, -grip.y * scale, -grip.x * scale);

  root.add(weaponMesh);
  return root;
}


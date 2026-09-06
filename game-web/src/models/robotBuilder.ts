import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

export const FLUO_PART_NAMES = [
  'chest_reactor',
  'optical_visor',
  'main_thruster_flame',
  'right_thruster_exhaust',
  'left_thruster_exhaust',
  'backpack_right_conduit',
  'backpack_left_conduit'
] as const;

export type FluoPartName = typeof FLUO_PART_NAMES[number];

export const FLUO_PART_POSITIONS: Record<FluoPartName, [number, number, number]> = {
  chest_reactor: [0, 0.3, 0.2],
  optical_visor: [0, 1.75, 0.52],
  main_thruster_flame: [0, -0.65, 0],
  right_thruster_exhaust: [-0.85, -0.3, 0],
  left_thruster_exhaust: [0.85, -0.3, 0],
  backpack_right_conduit: [0.2, 0.8, -0.8],
  backpack_left_conduit: [-0.2, 0.8, -0.8]
};

export const ROBOT_SCALE = 0.67;
export const WEAPON_SOCKET_NAME = 'weapon_socket';
export const WEAPON_SOCKET_POSITION = new THREE.Vector3(-1.15, 0.4, 0.85);

let cachedGltfRobot: THREE.Group | null = null;

/**
 * Creates the complete Cyberpunk Floating Robot player model procedurally using Three.js primitives.
 * Matches C:\Users\gerar\Downloads\modello.html geometry and material hierarchy.
 */
export function createProceduralRobot(fluoColor: string | number = 0x39ff14): THREE.Group {
  const robotGroup = new THREE.Group();
  robotGroup.name = 'CyberpunkRobot';

  // --- BASE MATERIALS ---
  const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8, metalness: 0.6 });
  const matGunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2b36, roughness: 0.5, metalness: 0.8 });
  const matSilver = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.2, metalness: 0.9 });
  const matBlackDetail = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.4 });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.1 });

  // --- NEON ACCENT MATERIAL (Fluo) ---
  const colorObj = new THREE.Color(fluoColor);
  const matNeon = new THREE.MeshStandardMaterial({
    color: colorObj,
    emissive: colorObj,
    emissiveIntensity: 2.5,
    roughness: 0.2,
    name: 'RobotFluoAccent'
  });

  function addPart(
    geo: THREE.BufferGeometry,
    mat: THREE.Material,
    x: number,
    y: number,
    z: number,
    rotX = 0,
    rotY = 0,
    rotZ = 0,
    name?: string,
    fluoPart?: FluoPartName
  ): THREE.Mesh {
    const mesh = new THREE.Mesh(geo, mat);
    mesh.position.set(x, y, z);
    mesh.rotation.set(rotX, rotY, rotZ);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    if (name) mesh.name = name;
    if (fluoPart) {
      mesh.userData.isFluoAccent = true;
      mesh.userData.fluoPartName = fluoPart;
    }
    robotGroup.add(mesh);
    return mesh;
  }

  // ==========================================
  // 1. TORSO E CHASSIS PRINCIPALE
  // ==========================================
  addPart(new THREE.BoxGeometry(1.2, 1.4, 1.0), matGunmetal, 0, 0.7, 0, 0, 0, 0, 'TorsoCore');
  addPart(new THREE.BoxGeometry(1.0, 0.6, 1.1), matDarkMetal, 0, 0.9, 0.05, Math.PI / 16, 0, 0, 'ChestPlate');

  // Griglie di ventilazione frontali
  for (let i = 0; i < 4; i++) {
    addPart(
      new THREE.BoxGeometry(0.8, 0.05, 1.15),
      matBlackDetail,
      0,
      0.7 + i * 0.12,
      0.05,
      Math.PI / 16,
      0,
      0,
      `VentGrille_${i}`
    );
  }

  // Nucleo centrale a vista (Cuore del robot - Fluo 1)
  addPart(
    new THREE.CylinderGeometry(0.2, 0.2, 1.2, 16),
    matNeon,
    0,
    0.3,
    0.2,
    Math.PI / 2,
    0,
    0,
    'ChestReactor',
    'chest_reactor'
  );

  // ==========================================
  // 2. TESTA E SENSORI
  // ==========================================
  addPart(new THREE.BoxGeometry(0.7, 0.6, 0.8), matDarkMetal, 0, 1.7, 0.1, 0, 0, 0, 'HeadBase');
  addPart(new THREE.BoxGeometry(0.5, 0.4, 0.85), matBlackDetail, 0, 1.7, 0.1, 0, 0, 0, 'VisorHousing');

  // Visore ottico (Monocolo in stile Ciclone - Fluo 2)
  addPart(
    new THREE.BoxGeometry(0.6, 0.15, 0.1),
    matNeon,
    0,
    1.75,
    0.52,
    0,
    0,
    0,
    'OpticalVisor',
    'optical_visor'
  );

  // Antenne di comunicazione tattica
  addPart(new THREE.CylinderGeometry(0.02, 0.02, 0.6), matSilver, 0.3, 2.0, -0.2, 0, 0, 0, 'AntennaRight');
  addPart(new THREE.CylinderGeometry(0.02, 0.02, 0.4), matSilver, -0.3, 1.9, -0.2, 0, 0, 0, 'AntennaLeft');

  // ==========================================
  // 3. SISTEMA DI PROPULSIONE (Sostituisce le gambe)
  // ==========================================
  addPart(new THREE.CylinderGeometry(0.4, 0.3, 0.8, 16), matGunmetal, 0, -0.2, 0, 0, 0, 0, 'MainThrusterHousing');
  // Fiamma di scarico (Fluo 3)
  addPart(
    new THREE.CylinderGeometry(0.25, 0.25, 0.2, 16),
    matNeon,
    0,
    -0.65,
    0,
    0,
    0,
    0,
    'MainThrusterFlame',
    'main_thruster_flame'
  );

  // Propulsori di manovra Destro
  addPart(new THREE.BoxGeometry(0.4, 0.6, 0.5), matDarkMetal, -0.7, 0.2, 0, 0, 0, Math.PI / 8, 'ManeuverHousingRight');
  addPart(new THREE.CylinderGeometry(0.15, 0.1, 0.3, 16), matSilver, -0.8, -0.15, 0, 0, 0, Math.PI / 8, 'ManeuverNozzleRight');
  // Fluo 4
  addPart(
    new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16),
    matNeon,
    -0.85,
    -0.3,
    0,
    0,
    0,
    Math.PI / 8,
    'ManeuverFlameRight',
    'right_thruster_exhaust'
  );

  // Propulsori di manovra Sinistro
  addPart(new THREE.BoxGeometry(0.4, 0.6, 0.5), matDarkMetal, 0.7, 0.2, 0, 0, 0, -Math.PI / 8, 'ManeuverHousingLeft');
  addPart(new THREE.CylinderGeometry(0.15, 0.1, 0.3, 16), matSilver, 0.8, -0.15, 0, 0, 0, -Math.PI / 8, 'ManeuverNozzleLeft');
  // Fluo 5
  addPart(
    new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16),
    matNeon,
    0.85,
    -0.3,
    0,
    0,
    0,
    -Math.PI / 8,
    'ManeuverFlameLeft',
    'left_thruster_exhaust'
  );

  // ==========================================
  // 4. BRACCIA ARTICOLATE
  // ==========================================
  // --- Braccio Destro (Sollevato, pronto a puntare) ---
  addPart(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), matBlackDetail, -0.7, 1.2, 0, Math.PI / 2, 0, 0, 'ShoulderRight');
  addPart(new THREE.SphereGeometry(0.3, 16, 16), matSilver, -0.8, 1.2, 0, 0, 0, 0, 'ShoulderJointRight');
  addPart(new THREE.BoxGeometry(0.3, 0.8, 0.3), matGunmetal, -1.0, 0.8, 0, 0, 0, -Math.PI / 8, 'BicepRight');
  addPart(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), matBlackDetail, -1.15, 0.4, 0, Math.PI / 2, 0, 0, 'ElbowRight');
  addPart(new THREE.BoxGeometry(0.25, 0.7, 0.3), matDarkMetal, -1.15, 0.4, 0.4, Math.PI / 2, 0, 0, 'ForearmRight');

  // Pinza Destra
  addPart(new THREE.BoxGeometry(0.3, 0.3, 0.3), matSilver, -1.15, 0.4, 0.8, 0, 0, 0, 'ClawPalmRight');
  addPart(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, -1.0, 0.4, 0.95, 0, 0, 0, 'ClawFingerInnerRight');
  addPart(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, -1.3, 0.4, 0.95, 0, 0, 0, 'ClawFingerOuterRight');

  // --- Braccio Sinistro (A riposo verso il basso) ---
  addPart(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), matBlackDetail, 0.7, 1.2, 0, Math.PI / 2, 0, 0, 'ShoulderLeft');
  addPart(new THREE.SphereGeometry(0.3, 16, 16), matSilver, 0.8, 1.2, 0, 0, 0, 0, 'ShoulderJointLeft');
  addPart(new THREE.BoxGeometry(0.3, 0.8, 0.3), matGunmetal, 1.0, 0.8, 0, 0, 0, Math.PI / 8, 'BicepLeft');
  addPart(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), matBlackDetail, 1.15, 0.4, 0, Math.PI / 2, 0, 0, 'ElbowLeft');
  addPart(new THREE.BoxGeometry(0.25, 0.7, 0.3), matDarkMetal, 1.15, 0.0, 0.1, -Math.PI / 6, 0, 0, 'ForearmLeft');

  // Pinza Sinistra
  addPart(new THREE.BoxGeometry(0.3, 0.3, 0.3), matSilver, 1.15, -0.4, 0.2, 0, 0, 0, 'ClawPalmLeft');
  addPart(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, 1.0, -0.5, 0.25, 0, 0, 0, 'ClawFingerInnerLeft');
  addPart(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, 1.3, -0.5, 0.25, 0, 0, 0, 'ClawFingerOuterLeft');

  // ==========================================
  // 5. ZAINO GENERATORE (Backpack)
  // ==========================================
  addPart(new THREE.BoxGeometry(0.8, 1.0, 0.4), matGunmetal, 0, 0.8, -0.6, 0, 0, 0, 'BackpackBattery');
  // Tubo energia destro (Fluo 6)
  addPart(
    new THREE.CylinderGeometry(0.15, 0.15, 0.8, 16),
    matNeon,
    0.2,
    0.8,
    -0.8,
    0,
    0,
    0,
    'BackpackConduitRight',
    'backpack_right_conduit'
  );
  // Tubo energia sinistro (Fluo 7)
  addPart(
    new THREE.CylinderGeometry(0.15, 0.15, 0.8, 16),
    matNeon,
    -0.2,
    0.8,
    -0.8,
    0,
    0,
    0,
    'BackpackConduitLeft',
    'backpack_left_conduit'
  );

  // Cavi flessibili corpo-spalle
  addPart(new THREE.TorusGeometry(0.3, 0.05, 8, 16, Math.PI), matBlackDetail, 0.5, 0.5, -0.4, 0, Math.PI / 2, 0, 'ShoulderCableRight');
  addPart(new THREE.TorusGeometry(0.3, 0.05, 8, 16, Math.PI), matBlackDetail, -0.5, 0.5, -0.4, 0, Math.PI / 2, 0, 'ShoulderCableLeft');

  // Weapon socket point anchor
  createWeaponSocket(robotGroup);

  return robotGroup;
}

/**
 * Ensures the weapon socket anchor exists at (-1.15, 0.4, 0.85) on the right claw.
 */
export function createWeaponSocket(robotGroup: THREE.Group): THREE.Group {
  let socket = robotGroup.getObjectByName(WEAPON_SOCKET_NAME) as THREE.Group | undefined;
  if (!socket) {
    socket = new THREE.Group();
    socket.name = WEAPON_SOCKET_NAME;
    socket.position.copy(WEAPON_SOCKET_POSITION);
    robotGroup.add(socket);
  }
  return socket;
}

/**
 * Returns the exact 7 fluo accent meshes from the robot model.
 */
export function getFluoMeshes(robotGroup: THREE.Group): THREE.Mesh[] {
  const meshes: THREE.Mesh[] = [];

  robotGroup.traverse((c) => {
    if ((c as THREE.Mesh).isMesh) {
      const mesh = c as THREE.Mesh;
      if (mesh.userData.isFluoAccent) {
        meshes.push(mesh);
        return;
      }
      const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
      if (mat) {
        if (mat.name === 'RobotFluoAccent') {
          mesh.userData.isFluoAccent = true;
          meshes.push(mesh);
          return;
        }
        const stdMat = mat as THREE.MeshStandardMaterial;
        if (stdMat.emissive && stdMat.emissive.getHex() === 0x39ff14) {
          mesh.userData.isFluoAccent = true;
          meshes.push(mesh);
          return;
        }
      }
    }
  });

  return meshes;
}

/**
 * Dynamically clones materials and updates the emissive and diffuse color of the 7 accent meshes,
 * without mutating base dark chassis materials.
 */
export function applyFluoColor(robotGroup: THREE.Group, hexColor: string | number): void {
  const threeColor = new THREE.Color(hexColor);
  const fluoMeshes = getFluoMeshes(robotGroup);

  for (const mesh of fluoMeshes) {
    if (mesh.material) {
      if (Array.isArray(mesh.material)) {
        mesh.material = mesh.material.map((m) => {
          if (m.userData.sharedAsset === false) m.dispose();
          const cloned = (m as THREE.MeshStandardMaterial).clone();
          cloned.color.copy(threeColor);
          if ('emissive' in cloned) {
            cloned.emissive.copy(threeColor);
            cloned.emissiveIntensity = 2.5;
          }
          cloned.name = 'RobotFluoAccent';
          cloned.userData.sharedAsset = false;
          return cloned;
        });
      } else {
        if (mesh.material.userData.sharedAsset === false) mesh.material.dispose();
        const mat = (mesh.material as THREE.MeshStandardMaterial).clone();
        mat.color.copy(threeColor);
        if ('emissive' in mat) {
          mat.emissive.copy(threeColor);
          mat.emissiveIntensity = 2.5;
        }
        mat.name = 'RobotFluoAccent';
        mat.userData.sharedAsset = false;
        mesh.material = mat;
      }
    }
    mesh.userData.isFluoAccent = true;
  }

  // Update any dynamic lights if tagged
  robotGroup.traverse((c) => {
    if ((c as THREE.PointLight).isPointLight && c.userData.isFluoLight) {
      (c as THREE.PointLight).color.copy(threeColor);
    }
  });
}

/**
 * Attaches a weapon model to the robot's right claw weapon socket.
 */
export function attachWeaponToRobot(robotGroup: THREE.Group, weaponGroup: THREE.Group): void {
  const socket = createWeaponSocket(robotGroup);
  while (socket.children.length > 0) {
    socket.remove(socket.children[0]);
  }
  socket.add(weaponGroup);
}

/**
 * Asynchronously loads assets/modello.glb with fallback to procedural builder if unavailable.
 */
export async function loadRobotModel(
  assetPath: string = 'assets/modello.glb',
  fluoColor: string | number = 0x39ff14
): Promise<THREE.Group> {
  // If already cached, clone it
  if (cachedGltfRobot) {
    const cloned = cachedGltfRobot.clone(true);
    applyFluoColor(cloned, fluoColor);
    createWeaponSocket(cloned);
    return cloned;
  }

  const loader = new GLTFLoader();
  const pathsToTry = [assetPath, `/${assetPath}`, `/public/${assetPath}`];

  for (const p of pathsToTry) {
    try {
      const gltf = await loader.loadAsync(p);
      if (gltf && gltf.scene) {
        const root = gltf.scene;
        root.name = 'CyberpunkRobot';

        // Tag the 7 fluo accent meshes on the loaded GLTF and mark shared assets
        root.traverse((c) => {
          if ((c as THREE.Mesh).isMesh) {
            const mesh = c as THREE.Mesh;
            const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
            if (mat && (mat.name === 'RobotFluoAccent' || (mat as THREE.MeshStandardMaterial).emissive?.getHex() === 0x39ff14)) {
              mesh.userData.isFluoAccent = true;
            }
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

        createWeaponSocket(root);
        applyFluoColor(root, fluoColor);
        cachedGltfRobot = root.clone(true);
        return root;
      }
    } catch {
      // Continue to next path candidate
    }
  }

  // Fallback to procedural robot
  const procedural = createProceduralRobot(fluoColor);
  return procedural;
}

/**
 * Creates a ready-to-render robot avatar scaled for FPS gameplay (scale factor ~0.67x).
 */
export function createPlayerRobotAvatar(
  fluoColor: string | number = 0x39ff14,
  scale: number = ROBOT_SCALE
): THREE.Group {
  const root = new THREE.Group();
  root.name = 'PlayerRobotAvatar';
  const robot = createProceduralRobot(fluoColor);
  robot.scale.set(scale, scale, scale);
  root.add(robot);
  return root;
}

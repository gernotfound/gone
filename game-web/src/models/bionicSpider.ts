import * as THREE from 'three';

export type BionicSpiderHitRegion = 'head' | 'body' | 'limb';

export interface BionicSpiderLegRig {
  readonly hipLocal: THREE.Vector3;
  readonly homeFootLocal: THREE.Vector3;
  readonly upper: THREE.Mesh;
  readonly lower: THREE.Mesh;
  readonly hipJoint: THREE.Mesh;
  readonly kneeJoint: THREE.Mesh;
  readonly footPad: THREE.Mesh;
}

export interface BionicSpiderModel {
  readonly root: THREE.Group;
  readonly bodyRoot: THREE.Group;
  readonly headRoot: THREE.Group;
  readonly legs: readonly BionicSpiderLegRig[];
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly legMaterial: THREE.MeshStandardMaterial;
  readonly eyeMaterial: THREE.MeshStandardMaterial;
  readonly lightArmorMaterial: THREE.MeshStandardMaterial;
  readonly chromeMaterial: THREE.MeshStandardMaterial;
  readonly coreMaterial: THREE.MeshStandardMaterial;
  readonly neonCyanMaterial: THREE.MeshStandardMaterial;
  readonly neonMagentaMaterial: THREE.MeshStandardMaterial;
  readonly materials: readonly THREE.MeshStandardMaterial[];
}

/** Preserve the established gameplay footprint while replacing the visual rig. */
export const BIONIC_SPIDER_SCALE = 4;
export const BIONIC_SPIDER_APPROX_HEIGHT = 2.95 * BIONIC_SPIDER_SCALE;
export const BIONIC_SPIDER_BODY_HEIGHT = 1.42;

const boxGeometry = new THREE.BoxGeometry(1, 1, 1);
const jointGeometry = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
const pistonGeometry = new THREE.CylinderGeometry(1, 1, 1, 8, 1, false);
const eyeGeometry = new THREE.BoxGeometry(1, 1, 1);
const coreGeometry = new THREE.CylinderGeometry(1, 1, 1, 18, 1, false);
const ringGeometry = new THREE.TorusGeometry(1, 0.13, 8, 18);
const talonGeometry = new THREE.ConeGeometry(1, 1, 4, 1, false);
const mandibleGeometry = new THREE.BoxGeometry(1, 1, 1);

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const segmentDirection = new THREE.Vector3();
const segmentMidpoint = new THREE.Vector3();
const segmentQuaternion = new THREE.Quaternion();
const footDirection = new THREE.Vector3();

const BASE_ARMOR = new THREE.Color(0x3a3f44);
const BASE_LIGHT_ARMOR = new THREE.Color(0x6a7077);
const BASE_DARK_MECH = new THREE.Color(0x111111);
const BASE_CHROME = new THREE.Color(0xaaaaaa);
const BASE_CORE = new THREE.Color(0xff6600);
const BASE_CYAN = new THREE.Color(0x00f3ff);
const BASE_MAGENTA = new THREE.Color(0xff00ea);
const DAMAGE_RED = new THREE.Color(0xff0000);

function tagHit(object: THREE.Object3D, region: BionicSpiderHitRegion): void {
  object.userData.bionicSpiderHitRegion = region;
}

function configureMesh(mesh: THREE.Mesh, region: BionicSpiderHitRegion): void {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  tagHit(mesh, region);
}

function addBox(
  parent: THREE.Object3D,
  material: THREE.Material,
  name: string,
  region: BionicSpiderHitRegion,
  position: readonly [number, number, number],
  scale: readonly [number, number, number],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = new THREE.Mesh(boxGeometry, material);
  mesh.name = name;
  mesh.position.set(...position);
  mesh.scale.set(...scale);
  mesh.rotation.set(...rotation);
  configureMesh(mesh, region);
  parent.add(mesh);
  return mesh;
}

function placeSegment(
  mesh: THREE.Mesh,
  start: THREE.Vector3,
  end: THREE.Vector3,
  radius: number,
): void {
  segmentDirection.subVectors(end, start);
  const length = Math.max(0.001, segmentDirection.length());
  segmentMidpoint.addVectors(start, end).multiplyScalar(0.5);
  segmentQuaternion.setFromUnitVectors(Y_AXIS, segmentDirection.multiplyScalar(1 / length));
  mesh.position.copy(segmentMidpoint);
  mesh.quaternion.copy(segmentQuaternion);
  mesh.scale.set(radius, length, radius);
}

function createMaterials(): {
  armor: THREE.MeshStandardMaterial;
  lightArmor: THREE.MeshStandardMaterial;
  darkMech: THREE.MeshStandardMaterial;
  chrome: THREE.MeshStandardMaterial;
  core: THREE.MeshStandardMaterial;
  cyan: THREE.MeshStandardMaterial;
  magenta: THREE.MeshStandardMaterial;
} {
  return {
    armor: new THREE.MeshStandardMaterial({
      color: BASE_ARMOR,
      roughness: 0.5,
      metalness: 0.6,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
    lightArmor: new THREE.MeshStandardMaterial({
      color: BASE_LIGHT_ARMOR,
      roughness: 0.4,
      metalness: 0.7,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
    darkMech: new THREE.MeshStandardMaterial({
      color: BASE_DARK_MECH,
      roughness: 0.7,
      metalness: 0.8,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
    chrome: new THREE.MeshStandardMaterial({
      color: BASE_CHROME,
      roughness: 0.2,
      metalness: 1,
      emissive: 0x000000,
      emissiveIntensity: 0,
    }),
    core: new THREE.MeshStandardMaterial({
      color: BASE_CORE,
      roughness: 0.24,
      metalness: 0.35,
      emissive: BASE_CORE,
      emissiveIntensity: 2.1,
    }),
    cyan: new THREE.MeshStandardMaterial({
      color: BASE_CYAN,
      roughness: 0.2,
      metalness: 0.25,
      emissive: BASE_CYAN,
      emissiveIntensity: 3.0,
    }),
    magenta: new THREE.MeshStandardMaterial({
      color: BASE_MAGENTA,
      roughness: 0.2,
      metalness: 0.25,
      emissive: BASE_MAGENTA,
      emissiveIntensity: 2.8,
    }),
  };
}

function wrapDetailsInScaleCompensator(segment: THREE.Mesh, name: string): THREE.Group {
  const detailRoot = new THREE.Group();
  detailRoot.name = name;
  const details = [...segment.children];
  segment.add(detailRoot);
  for (const child of details) detailRoot.add(child);
  return detailRoot;
}

function compensateDetailScale(segment: THREE.Mesh, detailRootName: string): void {
  const detailRoot = segment.getObjectByName(detailRootName);
  if (!detailRoot) return;
  detailRoot.scale.set(
    1 / Math.max(Math.abs(segment.scale.x), 0.001),
    1 / Math.max(Math.abs(segment.scale.y), 0.001),
    1 / Math.max(Math.abs(segment.scale.z), 0.001),
  );
}

function addSegmentDetails(
  upper: THREE.Mesh,
  lower: THREE.Mesh,
  footPad: THREE.Mesh,
  lightArmor: THREE.MeshStandardMaterial,
  chrome: THREE.MeshStandardMaterial,
  neon: THREE.MeshStandardMaterial,
  suffix: string,
): void {
  const piston = new THREE.Mesh(pistonGeometry, chrome);
  piston.name = `BionicSpiderFemurPiston-${suffix}`;
  piston.position.x = 0.58;
  piston.scale.set(0.42, 0.82, 0.42);
  piston.rotation.z = Math.PI / 2;
  configureMesh(piston, 'limb');
  upper.add(piston);

  const upperArmor = new THREE.Mesh(boxGeometry, lightArmor);
  upperArmor.name = `BionicSpiderFemurArmor-${suffix}`;
  upperArmor.position.set(0, 0.02, 0);
  upperArmor.scale.set(1.55, 0.82, 2.25);
  configureMesh(upperArmor, 'limb');
  upper.add(upperArmor);

  const shield = new THREE.Mesh(boxGeometry, lightArmor);
  shield.name = `BionicSpiderLegShield-${suffix}`;
  shield.position.set(0, 0.02, 0);
  shield.scale.set(1.65, 0.90, 6.4);
  configureMesh(shield, 'limb');
  lower.add(shield);

  const reactive = new THREE.Mesh(boxGeometry, lightArmor);
  reactive.name = `BionicSpiderReactiveArmor-${suffix}`;
  reactive.position.set(0.9, 0.02, 0);
  reactive.scale.set(0.55, 0.72, 5.0);
  configureMesh(reactive, 'limb');
  lower.add(reactive);

  const wingA = new THREE.Mesh(boxGeometry, lightArmor);
  wingA.name = `BionicSpiderDeflectorA-${suffix}`;
  wingA.position.set(0, 0, -5.9);
  wingA.scale.set(1.7, 0.82, 0.7);
  wingA.rotation.y = -Math.PI / 6;
  configureMesh(wingA, 'limb');
  lower.add(wingA);

  const wingB = wingA.clone();
  wingB.name = `BionicSpiderDeflectorB-${suffix}`;
  wingB.position.z = 5.9;
  wingB.rotation.y = Math.PI / 6;
  configureMesh(wingB, 'limb');
  lower.add(wingB);

  const neonStrip = new THREE.Mesh(boxGeometry, neon);
  neonStrip.name = `BionicSpiderLegNeon-${suffix}`;
  neonStrip.position.set(1.55, 0, 0);
  neonStrip.scale.set(0.25, 0.64, 3.7);
  configureMesh(neonStrip, 'limb');
  lower.add(neonStrip);

  const ankleArmor = new THREE.Mesh(boxGeometry, lightArmor);
  ankleArmor.name = `BionicSpiderFootArmor-${suffix}`;
  ankleArmor.position.set(0, 0.02, 0);
  ankleArmor.scale.set(1.16, 0.72, 1.35);
  configureMesh(ankleArmor, 'limb');
  footPad.add(ankleArmor);

  const talon = new THREE.Mesh(talonGeometry, chrome);
  talon.name = `BionicSpiderTalon-${suffix}`;
  talon.position.set(0, -2.35, 0.16);
  talon.scale.set(0.42, 4.2, 0.42);
  configureMesh(talon, 'limb');
  footPad.add(talon);

  const spur = new THREE.Mesh(talonGeometry, chrome);
  spur.name = `BionicSpiderBackSpur-${suffix}`;
  spur.position.set(0, -1.35, -0.82);
  spur.scale.set(0.30, 2.1, 0.30);
  spur.rotation.x = -Math.PI / 4;
  configureMesh(spur, 'limb');
  footPad.add(spur);

  wrapDetailsInScaleCompensator(upper, `BionicSpiderUpperDetails-${suffix}`);
  wrapDetailsInScaleCompensator(lower, `BionicSpiderLowerDetails-${suffix}`);
  wrapDetailsInScaleCompensator(footPad, `BionicSpiderFootDetails-${suffix}`);
}

export function createBionicSpiderModel(enemyId: number): BionicSpiderModel {
  const root = new THREE.Group();
  root.name = `BionicSpider-${enemyId}`;
  root.userData.bionicSpiderEnemyId = enemyId;
  root.scale.setScalar(BIONIC_SPIDER_SCALE);

  const materials = createMaterials();

  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'BionicSpiderBody';
  bodyRoot.position.y = BIONIC_SPIDER_BODY_HEIGHT;
  root.add(bodyRoot);

  addBox(bodyRoot, materials.darkMech, 'BionicSpiderChassis', 'body', [0, 0, -0.12], [0.58, 0.34, 1.03]);

  for (let i = 0; i < 3; i += 1) {
    addBox(
      bodyRoot,
      materials.armor,
      `BionicSpiderDorsalPlate-${i}`,
      'body',
      [0, 0.36, -0.66 + i * 0.62],
      [0.72, 0.10, 0.48],
      [-0.15, 0, 0],
    );
    addBox(
      bodyRoot,
      materials.lightArmor,
      `BionicSpiderDorsalTrim-${i}`,
      'body',
      [0, 0.43, -0.66 + i * 0.62],
      [0.76, 0.035, 0.51],
      [-0.15, 0, 0],
    );
  }

  const core = new THREE.Mesh(coreGeometry, materials.core);
  core.name = 'BionicSpiderPowerCore';
  core.position.set(0, 0.10, 0.50);
  core.scale.set(0.24, 0.66, 0.24);
  core.rotation.z = Math.PI / 2;
  configureMesh(core, 'body');
  bodyRoot.add(core);

  for (const offset of [-0.28, 0, 0.28]) {
    const ring = new THREE.Mesh(ringGeometry, materials.darkMech);
    ring.name = `BionicSpiderCoreRing-${offset}`;
    ring.position.set(offset, 0.10, 0.50);
    ring.scale.setScalar(0.25);
    ring.rotation.y = Math.PI / 2;
    configureMesh(ring, 'body');
    bodyRoot.add(ring);
  }

  const headRoot = new THREE.Group();
  headRoot.name = 'BionicSpiderHeadRig';
  headRoot.position.set(0, 0.03, 1.30);
  bodyRoot.add(headRoot);

  addBox(headRoot, materials.armor, 'BionicSpiderHead', 'head', [0, 0, 0], [0.50, 0.34, 0.42]);
  addBox(headRoot, materials.lightArmor, 'BionicSpiderFaceMask', 'head', [0, 0, 0.45], [0.45, 0.28, 0.09]);

  const eyeLayout: readonly [number, number, number][] = [
    [-0.25, 0.12, 0.56], [0.25, 0.12, 0.56],
    [-0.39, 0.01, 0.53], [0.39, 0.01, 0.53],
    [-0.31, -0.14, 0.50], [0.31, -0.14, 0.50],
  ];
  for (let i = 0; i < eyeLayout.length; i += 1) {
    const [x, y, z] = eyeLayout[i];
    const eye = new THREE.Mesh(eyeGeometry, materials.cyan);
    eye.name = `BionicSpiderEye-${i}`;
    eye.position.set(x, y, z);
    const size = i < 2 ? 0.11 : i < 4 ? 0.075 : 0.055;
    eye.scale.set(size, size, 0.035);
    configureMesh(eye, 'head');
    headRoot.add(eye);
  }

  for (const side of [-1, 1] as const) {
    const mandible = new THREE.Mesh(mandibleGeometry, materials.chrome);
    mandible.name = `BionicSpiderMandible-${side < 0 ? 'L' : 'R'}`;
    mandible.position.set(side * 0.24, -0.28, 0.48);
    mandible.scale.set(0.10, 0.38, 0.12);
    mandible.rotation.x = -0.5;
    mandible.rotation.z = side * 0.30;
    configureMesh(mandible, 'head');
    headRoot.add(mandible);
  }

  const legs: BionicSpiderLegRig[] = [];
  const zOffsets = [0.95, 0.34, -0.34, -0.95] as const;
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < zOffsets.length; row += 1) {
      const suffix = `${side < 0 ? 'L' : 'R'}-${row}`;
      const neon = ((row + (side > 0 ? 1 : 0)) % 2 === 0) ? materials.cyan : materials.magenta;

      const upper = new THREE.Mesh(boxGeometry, materials.darkMech);
      const lower = new THREE.Mesh(boxGeometry, materials.darkMech);
      const hipJoint = new THREE.Mesh(jointGeometry, materials.darkMech);
      const kneeJoint = new THREE.Mesh(jointGeometry, materials.lightArmor);
      const footPad = new THREE.Mesh(boxGeometry, materials.darkMech);

      upper.name = `BionicSpiderUpperLeg-${suffix}`;
      lower.name = `BionicSpiderLowerLeg-${suffix}`;
      hipJoint.name = `BionicSpiderHip-${suffix}`;
      kneeJoint.name = `BionicSpiderKnee-${suffix}`;
      footPad.name = `BionicSpiderFoot-${suffix}`;

      for (const mesh of [upper, lower, hipJoint, kneeJoint, footPad]) {
        configureMesh(mesh, 'limb');
        root.add(mesh);
      }

      hipJoint.scale.set(0.18, 0.22, 0.18);
      hipJoint.rotation.z = Math.PI / 2;
      kneeJoint.scale.set(0.20, 0.24, 0.20);
      kneeJoint.rotation.z = Math.PI / 2;
      footPad.scale.set(0.25, 0.085, 0.34);

      addSegmentDetails(upper, lower, footPad, materials.lightArmor, materials.chrome, neon, suffix);

      const z = zOffsets[row];
      const outward = 2.18 + Math.abs(z) * 0.32;
      legs.push({
        hipLocal: new THREE.Vector3(side * 0.78, BIONIC_SPIDER_BODY_HEIGHT - 0.13, z),
        homeFootLocal: new THREE.Vector3(side * outward, 0, z * 1.58),
        upper,
        lower,
        hipJoint,
        kneeJoint,
        footPad,
      });
    }
  }

  root.traverse((object) => {
    if (object.userData.bionicSpiderHitRegion) object.userData.bionicSpiderEnemyId = enemyId;
  });

  const materialList = [
    materials.armor,
    materials.lightArmor,
    materials.darkMech,
    materials.chrome,
    materials.core,
    materials.cyan,
    materials.magenta,
  ] as const;

  return {
    root,
    bodyRoot,
    headRoot,
    legs,
    bodyMaterial: materials.armor,
    legMaterial: materials.darkMech,
    eyeMaterial: materials.cyan,
    lightArmorMaterial: materials.lightArmor,
    chromeMaterial: materials.chrome,
    coreMaterial: materials.core,
    neonCyanMaterial: materials.cyan,
    neonMagentaMaterial: materials.magenta,
    materials: materialList,
  };
}

export function poseBionicSpiderLeg(
  model: BionicSpiderModel,
  legIndex: number,
  hipLocal: THREE.Vector3,
  kneeLocal: THREE.Vector3,
  footLocal: THREE.Vector3,
): void {
  const leg = model.legs[legIndex];
  if (!leg) return;
  placeSegment(leg.upper, hipLocal, kneeLocal, 0.13);
  placeSegment(leg.lower, kneeLocal, footLocal, 0.11);
  compensateDetailScale(leg.upper, `BionicSpiderUpperDetails-${leg.upper.name.split('-').slice(-2).join('-')}`);
  compensateDetailScale(leg.lower, `BionicSpiderLowerDetails-${leg.lower.name.split('-').slice(-2).join('-')}`);
  leg.hipJoint.position.copy(hipLocal);
  leg.kneeJoint.position.copy(kneeLocal);
  leg.footPad.position.copy(footLocal);
  leg.footPad.position.y += 0.07;
  footDirection.subVectors(footLocal, kneeLocal);
  leg.footPad.rotation.set(0, Math.atan2(footDirection.x, footDirection.z), 0);
  compensateDetailScale(leg.footPad, `BionicSpiderFootDetails-${leg.footPad.name.split('-').slice(-2).join('-')}`);
}

export function setBionicSpiderDamageVisual(model: BionicSpiderModel, amount: number): void {
  const flash = THREE.MathUtils.clamp(amount, 0, 1);

  model.bodyMaterial.color.copy(BASE_ARMOR).lerp(DAMAGE_RED, flash * 0.34);
  model.bodyMaterial.emissive.copy(DAMAGE_RED);
  model.bodyMaterial.emissiveIntensity = flash * 0.65;

  model.lightArmorMaterial.color.copy(BASE_LIGHT_ARMOR).lerp(DAMAGE_RED, flash * 0.28);
  model.lightArmorMaterial.emissive.copy(DAMAGE_RED);
  model.lightArmorMaterial.emissiveIntensity = flash * 0.48;

  model.legMaterial.color.copy(BASE_DARK_MECH).lerp(DAMAGE_RED, flash * 0.20);
  model.legMaterial.emissive.copy(DAMAGE_RED);
  model.legMaterial.emissiveIntensity = flash * 0.36;

  model.chromeMaterial.color.copy(BASE_CHROME).lerp(DAMAGE_RED, flash * 0.18);
  model.chromeMaterial.emissive.copy(DAMAGE_RED);
  model.chromeMaterial.emissiveIntensity = flash * 0.24;

  model.coreMaterial.color.copy(BASE_CORE).lerp(DAMAGE_RED, flash);
  model.coreMaterial.emissive.copy(BASE_CORE).lerp(DAMAGE_RED, flash);
  model.coreMaterial.emissiveIntensity = 2.1 + flash * 2.4;

  model.neonCyanMaterial.color.copy(BASE_CYAN).lerp(DAMAGE_RED, flash);
  model.neonCyanMaterial.emissive.copy(BASE_CYAN).lerp(DAMAGE_RED, flash);
  model.neonCyanMaterial.emissiveIntensity = 3.0 + flash * 2.1;

  model.neonMagentaMaterial.color.copy(BASE_MAGENTA).lerp(DAMAGE_RED, flash);
  model.neonMagentaMaterial.emissive.copy(BASE_MAGENTA).lerp(DAMAGE_RED, flash);
  model.neonMagentaMaterial.emissiveIntensity = 2.8 + flash * 2.1;
}

export function disposeBionicSpiderModel(model: BionicSpiderModel): void {
  if (model.root.parent) model.root.parent.remove(model.root);
  for (const material of model.materials) material.dispose();
}

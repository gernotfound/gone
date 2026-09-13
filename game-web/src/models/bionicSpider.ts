import * as THREE from 'three';

export type BionicSpiderHitRegion = 'head' | 'body' | 'limb';

/**
 * The supplied HTML model is authored in large preview units. We preserve every
 * dimension/proportion and apply one uniform conversion before the existing 4x
 * gameplay scale. No individual body part is artistically resized here.
 */
export const BIONIC_SPIDER_SOURCE_UNITS_PER_MODEL_UNIT = 30;
export const BIONIC_SPIDER_SOURCE_UNIT = 1 / BIONIC_SPIDER_SOURCE_UNITS_PER_MODEL_UNIT;
export const BIONIC_SPIDER_SCALE = 4;
export const BIONIC_SPIDER_BODY_HEIGHT = 42 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT = 14 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_UPPER_LEG_LENGTH = 34 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_LOWER_LEG_LENGTH = 48 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_STEP_LENGTH = 55 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_STEP_HEIGHT = 25 * BIONIC_SPIDER_SOURCE_UNIT;
export const BIONIC_SPIDER_APPROX_HEIGHT = 52 * BIONIC_SPIDER_SOURCE_UNIT * BIONIC_SPIDER_SCALE;

export interface BionicSpiderLegRig {
  readonly index: number;
  readonly angle: number;
  readonly isRight: boolean;
  /** Exact source-model hip/pivot position in body-local coordinates. */
  readonly rootLocal: THREE.Vector3;
  /** Exact source-model rest ankle target in spider-root coordinates. */
  readonly defaultTargetLocal: THREE.Vector3;
  /** Compatibility aliases used by gameplay/tests. */
  readonly hipLocal: THREE.Vector3;
  readonly homeFootLocal: THREE.Vector3;
  readonly pivot: THREE.Group;
  readonly femur: THREE.Group;
  readonly tibia: THREE.Group;
  readonly foot: THREE.Group;
  readonly upper: THREE.Group;
  readonly lower: THREE.Group;
  readonly neon: THREE.Mesh;
}

export interface BionicSpiderModel {
  readonly root: THREE.Group;
  readonly bodyRoot: THREE.Group;
  readonly headRoot: THREE.Group;
  readonly legs: readonly BionicSpiderLegRig[];
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly legMaterial: THREE.MeshStandardMaterial;
  readonly eyeMaterial: THREE.MeshBasicMaterial;
  readonly lightArmorMaterial: THREE.MeshStandardMaterial;
  readonly chromeMaterial: THREE.MeshStandardMaterial;
  readonly coreMaterial: THREE.MeshBasicMaterial;
  readonly neonCyanMaterial: THREE.MeshBasicMaterial;
  readonly neonMagentaMaterial: THREE.MeshBasicMaterial;
  readonly materials: readonly THREE.Material[];
}

const U = BIONIC_SPIDER_SOURCE_UNIT;
const unitBox = new THREE.BoxGeometry(1, 1, 1);
const unitCylinder16 = new THREE.CylinderGeometry(1, 1, 1, 16);
const unitCylinder8 = new THREE.CylinderGeometry(1, 1, 1, 8);
const unitCylinder24 = new THREE.CylinderGeometry(1, 1, 1, 24);
const unitCone4 = new THREE.ConeGeometry(1, 1, 4);
const unitTorus = new THREE.TorusGeometry(1, 0.13, 16, 32);

const BASE_ARMOR = new THREE.Color(0x3a3f44);
const BASE_LIGHT_ARMOR = new THREE.Color(0x6a7077);
const BASE_DARK_MECH = new THREE.Color(0x111111);
const BASE_CHROME = new THREE.Color(0xaaaaaa);
const BASE_ORANGE = new THREE.Color(0xff6600);
const BASE_CYAN = new THREE.Color(0x00f3ff);
const BASE_MAGENTA = new THREE.Color(0xff00ea);
const DAMAGE_RED = new THREE.Color(0xff0000);

/** Exact eight-leg fan layout from ragno_cyberpunk_corazzato.html. */
export const BIONIC_SPIDER_LEG_ANGLES = [
  Math.PI * 0.35,
  Math.PI * 0.10,
  -Math.PI * 0.10,
  -Math.PI * 0.35,
  Math.PI * 0.65,
  Math.PI * 0.90,
  -Math.PI * 0.90,
  -Math.PI * 0.65,
] as const;

function tagHit(object: THREE.Object3D, region: BionicSpiderHitRegion, enemyId: number): void {
  object.userData.bionicSpiderHitRegion = region;
  object.userData.bionicSpiderEnemyId = enemyId;
}

function configureMesh(mesh: THREE.Mesh, region: BionicSpiderHitRegion, enemyId: number): THREE.Mesh {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
  tagHit(mesh, region, enemyId);
  return mesh;
}

function box(
  parent: THREE.Object3D,
  material: THREE.Material,
  name: string,
  region: BionicSpiderHitRegion,
  enemyId: number,
  sizeSource: readonly [number, number, number],
  positionSource: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = configureMesh(new THREE.Mesh(unitBox, material), region, enemyId);
  mesh.name = name;
  mesh.scale.set(sizeSource[0] * U, sizeSource[1] * U, sizeSource[2] * U);
  mesh.position.set(positionSource[0] * U, positionSource[1] * U, positionSource[2] * U);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}

function cylinder(
  parent: THREE.Object3D,
  geometry: THREE.BufferGeometry,
  material: THREE.Material,
  name: string,
  region: BionicSpiderHitRegion,
  enemyId: number,
  radiusSource: number,
  lengthSource: number,
  positionSource: readonly [number, number, number] = [0, 0, 0],
  rotation: readonly [number, number, number] = [0, 0, 0],
): THREE.Mesh {
  const mesh = configureMesh(new THREE.Mesh(geometry, material), region, enemyId);
  mesh.name = name;
  mesh.scale.set(radiusSource * U, lengthSource * U, radiusSource * U);
  mesh.position.set(positionSource[0] * U, positionSource[1] * U, positionSource[2] * U);
  mesh.rotation.set(rotation[0], rotation[1], rotation[2]);
  parent.add(mesh);
  return mesh;
}

function createMaterials() {
  const armor = new THREE.MeshStandardMaterial({ color: BASE_ARMOR, roughness: 0.5, metalness: 0.6 });
  const lightArmor = new THREE.MeshStandardMaterial({ color: BASE_LIGHT_ARMOR, roughness: 0.4, metalness: 0.7 });
  const darkMech = new THREE.MeshStandardMaterial({ color: BASE_DARK_MECH, roughness: 0.7, metalness: 0.8 });
  const chrome = new THREE.MeshStandardMaterial({ color: BASE_CHROME, roughness: 0.2, metalness: 1.0 });
  // The supplied model deliberately uses unlit neon materials.
  const orange = new THREE.MeshBasicMaterial({ color: BASE_ORANGE });
  const cyan = new THREE.MeshBasicMaterial({ color: BASE_CYAN });
  const magenta = new THREE.MeshBasicMaterial({ color: BASE_MAGENTA });
  return { armor, lightArmor, darkMech, chrome, orange, cyan, magenta };
}

export function createBionicSpiderModel(enemyId: number): BionicSpiderModel {
  const root = new THREE.Group();
  root.name = `BionicSpider-${enemyId}`;
  root.userData.bionicSpiderEnemyId = enemyId;
  root.scale.setScalar(BIONIC_SPIDER_SCALE);

  const materials = createMaterials();

  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'BionicSpiderBody';
  bodyRoot.position.y = 42 * U;
  root.add(bodyRoot);

  // --- Central chassis: exact source dimensions and offsets. ---
  box(bodyRoot, materials.darkMech, 'BionicSpiderChassis', 'body', enemyId, [20, 14, 38]);

  for (let i = 0; i < 3; i += 1) {
    // The preview makes the trim a child of the plate. Because the source plate
    // mesh itself is unscaled, reproduce that hierarchy with real-sized geometry
    // so the trim is not accidentally multiplied by a parent scale.
    const plateGeometry = new THREE.BoxGeometry(24 * U, 4 * U, 16 * U);
    const plate = configureMesh(new THREE.Mesh(plateGeometry, materials.armor), 'body', enemyId);
    plate.name = `BionicSpiderDorsalPlate-${i}`;
    plate.position.set(0, 8 * U, (-6 + i * 10) * U);
    plate.rotation.x = -0.15;
    bodyRoot.add(plate);

    const trimGeometry = new THREE.BoxGeometry(25 * U, 1 * U, 17 * U);
    const trim = configureMesh(new THREE.Mesh(trimGeometry, materials.lightArmor), 'body', enemyId);
    trim.name = `BionicSpiderDorsalTrim-${i}`;
    trim.position.set(0, -1.5 * U, 0);
    plate.add(trim);
  }

  const coreGroup = new THREE.Group();
  coreGroup.name = 'BionicSpiderCoreRig';
  coreGroup.position.set(0, 3 * U, 10 * U);
  bodyRoot.add(coreGroup);

  const core = cylinder(
    coreGroup,
    unitCylinder24,
    materials.orange,
    'BionicSpiderPowerCore',
    'body',
    enemyId,
    7,
    18,
    [0, 0, 0],
    [0, 0, Math.PI / 2],
  );

  for (const offset of [-5, 0, 5]) {
    const ring = configureMesh(new THREE.Mesh(unitTorus, materials.darkMech), 'body', enemyId);
    ring.name = `BionicSpiderCoreRing-${offset}`;
    ring.position.x = offset * U;
    ring.scale.setScalar(7.5 * U);
    ring.rotation.y = Math.PI / 2;
    coreGroup.add(ring);
  }

  // --- Head: exact source placement. Forward in the authored asset is -Z. ---
  const headRoot = new THREE.Group();
  headRoot.name = 'BionicSpiderHeadRig';
  headRoot.position.set(0, 2 * U, -22 * U);
  bodyRoot.add(headRoot);

  box(headRoot, materials.armor, 'BionicSpiderHead', 'head', enemyId, [16, 12, 14]);
  box(headRoot, materials.lightArmor, 'BionicSpiderFaceMask', 'head', enemyId, [14, 10, 4], [0, 0, -8]);

  const eyePositions = [
    [-4, 2, -10.5], [4, 2, -10.5],
    [-7, 0, -9.5], [7, 0, -9.5],
    [-6, -3, -8.5], [6, -3, -8.5],
  ] as const;
  const eyeSizes = [2.5, 2.5, 1.5, 1.5, 1, 1] as const;
  for (let i = 0; i < eyePositions.length; i += 1) {
    const p = eyePositions[i];
    box(
      headRoot,
      materials.cyan,
      `BionicSpiderEye-${i}`,
      'head',
      enemyId,
      [eyeSizes[i], eyeSizes[i], 1],
      [p[0], p[1], p[2]],
    );
  }

  box(headRoot, materials.chrome, 'BionicSpiderMandible-L', 'head', enemyId, [3, 8, 4], [-4, -6, -8], [0.5, 0, -0.3]);
  box(headRoot, materials.chrome, 'BionicSpiderMandible-R', 'head', enemyId, [3, 8, 4], [4, -6, -8], [0.5, 0, 0.3]);

  // --- Eight source legs, preserving pivot -> femur -> tibia -> foot hierarchy. ---
  const legs: BionicSpiderLegRig[] = [];
  const L1 = 34;
  const L2 = 48;
  const L3 = 14;
  const restDist = 85;
  const shieldWidth = 28;

  for (let i = 0; i < BIONIC_SPIDER_LEG_ANGLES.length; i += 1) {
    const angle = BIONIC_SPIDER_LEG_ANGLES[i];
    const isRight = i < 4;
    const neon = i % 2 === 0 ? materials.cyan : materials.magenta;
    const sideName = isRight ? 'R' : 'L';
    const suffix = `${sideName}-${i % 4}`;

    const rootLocal = new THREE.Vector3(
      Math.cos(angle) * 12 * U,
      -4 * U,
      -Math.sin(angle) * 16 * U,
    );

    const pivot = new THREE.Group();
    pivot.name = `BionicSpiderLegPivot-${suffix}`;
    pivot.position.copy(rootLocal);
    bodyRoot.add(pivot);

    cylinder(
      pivot,
      unitCylinder16,
      materials.darkMech,
      `BionicSpiderHip-${suffix}`,
      'limb',
      enemyId,
      4,
      8,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    );

    const femur = new THREE.Group();
    femur.name = `BionicSpiderFemurRig-${suffix}`;
    pivot.add(femur);

    box(femur, materials.darkMech, `BionicSpiderUpperLeg-${suffix}`, 'limb', enemyId, [L1, 4, 4], [L1 / 2, 0, 0]);
    cylinder(
      femur,
      unitCylinder8,
      materials.chrome,
      `BionicSpiderFemurPiston-${suffix}`,
      'limb',
      enemyId,
      1,
      L1 * 0.8,
      [L1 / 2, 2.5, 0],
      [0, 0, Math.PI / 2],
    );
    cylinder(
      femur,
      unitCylinder16,
      materials.lightArmor,
      `BionicSpiderKnee-${suffix}`,
      'limb',
      enemyId,
      4.5,
      6,
      [L1, 0, 0],
      [Math.PI / 2, 0, 0],
    );

    const tibia = new THREE.Group();
    tibia.name = `BionicSpiderTibiaRig-${suffix}`;
    tibia.position.x = L1 * U;
    femur.add(tibia);

    box(tibia, materials.darkMech, `BionicSpiderLowerLeg-${suffix}`, 'limb', enemyId, [L2, 4, 4], [L2 / 2, 0, 0]);
    box(
      tibia,
      materials.armor,
      `BionicSpiderLegShield-${suffix}`,
      'limb',
      enemyId,
      [L2 * 0.9, 4.5, shieldWidth],
      [L2 / 2, 3.5, 0],
    );
    box(
      tibia,
      materials.lightArmor,
      `BionicSpiderReactiveArmor-${suffix}`,
      'limb',
      enemyId,
      [L2 * 0.75, 2, shieldWidth - 5],
      [L2 / 2, 6, 0],
    );
    box(
      tibia,
      materials.armor,
      `BionicSpiderDeflectorA-${suffix}`,
      'limb',
      enemyId,
      [L2 * 0.9, 6, 2.5],
      [L2 / 2, 1.5, -shieldWidth / 2 - 0.5],
      [-Math.PI / 6, 0, 0],
    );
    box(
      tibia,
      materials.armor,
      `BionicSpiderDeflectorB-${suffix}`,
      'limb',
      enemyId,
      [L2 * 0.9, 6, 2.5],
      [L2 / 2, 1.5, shieldWidth / 2 + 0.5],
      [Math.PI / 6, 0, 0],
    );
    const neonStrip = box(
      tibia,
      neon,
      `BionicSpiderLegNeon-${suffix}`,
      'limb',
      enemyId,
      [L2 * 0.6, 1, 3],
      [L2 / 2, 6.6, 0],
    );

    const foot = new THREE.Group();
    foot.name = `BionicSpiderFootRig-${suffix}`;
    foot.position.x = L2 * U;
    tibia.add(foot);

    cylinder(
      foot,
      unitCylinder8,
      materials.chrome,
      `BionicSpiderFootShaft-${suffix}`,
      'limb',
      enemyId,
      1.5,
      L3 * 0.7,
      [0, -L3 * 0.35, 0],
    );
    box(foot, materials.darkMech, `BionicSpiderFoot-${suffix}`, 'limb', enemyId, [6, 6, 6], [0, -L3 * 0.7, 0]);

    const talon = configureMesh(new THREE.Mesh(unitCone4, materials.chrome), 'limb', enemyId);
    talon.name = `BionicSpiderTalon-${suffix}`;
    talon.scale.set(2 * U, L3 * 0.3 * U, 2 * U);
    talon.position.set(0, -L3 * 0.85 * U, 0);
    foot.add(talon);

    const spur = configureMesh(new THREE.Mesh(unitCone4, materials.chrome), 'limb', enemyId);
    spur.name = `BionicSpiderBackSpur-${suffix}`;
    spur.scale.set(1.5 * U, L3 * 0.2 * U, 1.5 * U);
    spur.position.set(-2 * U, -L3 * 0.8 * U, 0);
    spur.rotation.z = -Math.PI / 4;
    foot.add(spur);

    box(foot, materials.lightArmor, `BionicSpiderFootArmor-${suffix}`, 'limb', enemyId, [7, 5, 7.5], [0, -L3 * 0.65, 0]);
    cylinder(
      foot,
      unitCylinder16,
      materials.lightArmor,
      `BionicSpiderAnkle-${suffix}`,
      'limb',
      enemyId,
      3.5,
      6,
      [0, 0, 0],
      [Math.PI / 2, 0, 0],
    );

    const defaultTargetLocal = new THREE.Vector3(
      Math.cos(angle) * restDist * U,
      L3 * U,
      -Math.sin(angle) * restDist * U,
    );

    legs.push({
      index: i,
      angle,
      isRight,
      rootLocal,
      defaultTargetLocal,
      hipLocal: rootLocal,
      homeFootLocal: defaultTargetLocal,
      pivot,
      femur,
      tibia,
      foot,
      upper: femur,
      lower: tibia,
      neon: neonStrip,
    });
  }

  const materialList: readonly THREE.Material[] = [
    materials.armor,
    materials.lightArmor,
    materials.darkMech,
    materials.chrome,
    materials.orange,
    materials.cyan,
    materials.magenta,
  ];

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
    coreMaterial: materials.orange,
    neonCyanMaterial: materials.cyan,
    neonMagentaMaterial: materials.magenta,
    materials: materialList,
  };
}

/**
 * Source-faithful three-joint IK. The authored model rotates its hierarchy;
 * nothing is detached/repositioned as an independent segment, so knee shields,
 * pistons, neon strips and feet remain physically connected for every pose.
 */
export function poseBionicSpiderLeg(
  model: BionicSpiderModel,
  legIndex: number,
  targetWorld: THREE.Vector3,
): void {
  const leg = model.legs[legIndex];
  if (!leg) return;

  model.bodyRoot.updateWorldMatrix(true, false);
  const targetLocalToBody = model.bodyRoot.worldToLocal(targetWorld.clone());
  const dx = targetLocalToBody.x - leg.rootLocal.x;
  const dy = targetLocalToBody.y - leg.rootLocal.y;
  const dz = targetLocalToBody.z - leg.rootLocal.z;
  const distXZ = Math.hypot(dx, dz);
  const dist3D = Math.hypot(distXZ, dy);

  leg.pivot.rotation.y = Math.atan2(-dz, dx);

  const maxDist = BIONIC_SPIDER_UPPER_LEG_LENGTH + BIONIC_SPIDER_LOWER_LEG_LENGTH - 0.1 * U;
  let validDist = Math.max(0.001, dist3D);
  let validDy = dy;
  let validDistXZ = distXZ;
  if (validDist > maxDist) {
    const scale = maxDist / validDist;
    validDy *= scale;
    validDistXZ *= scale;
    validDist = maxDist;
  }

  const alpha = Math.atan2(validDy, validDistXZ);
  let cosBeta = (
    validDist * validDist
    + BIONIC_SPIDER_UPPER_LEG_LENGTH * BIONIC_SPIDER_UPPER_LEG_LENGTH
    - BIONIC_SPIDER_LOWER_LEG_LENGTH * BIONIC_SPIDER_LOWER_LEG_LENGTH
  ) / (2 * validDist * BIONIC_SPIDER_UPPER_LEG_LENGTH);
  cosBeta = THREE.MathUtils.clamp(cosBeta, -1, 1);
  const beta = Math.acos(cosBeta);

  let cosGamma = (
    validDist * validDist
    - BIONIC_SPIDER_UPPER_LEG_LENGTH * BIONIC_SPIDER_UPPER_LEG_LENGTH
    - BIONIC_SPIDER_LOWER_LEG_LENGTH * BIONIC_SPIDER_LOWER_LEG_LENGTH
  ) / (-2 * BIONIC_SPIDER_UPPER_LEG_LENGTH * BIONIC_SPIDER_LOWER_LEG_LENGTH);
  cosGamma = THREE.MathUtils.clamp(cosGamma, -1, 1);
  const gamma = Math.acos(cosGamma);

  leg.femur.rotation.z = alpha + beta;
  leg.tibia.rotation.z = -(Math.PI - gamma);
  leg.foot.rotation.z = -(leg.femur.rotation.z + leg.tibia.rotation.z);
}

export function setBionicSpiderDamageVisual(model: BionicSpiderModel, amount: number): void {
  const flash = THREE.MathUtils.clamp(amount, 0, 1);
  // The reference turns only the powered core/eyes/leg neon red on damage.
  model.coreMaterial.color.copy(BASE_ORANGE).lerp(DAMAGE_RED, flash);
  model.neonCyanMaterial.color.copy(BASE_CYAN).lerp(DAMAGE_RED, flash);
  model.neonMagentaMaterial.color.copy(BASE_MAGENTA).lerp(DAMAGE_RED, flash);
}

export function disposeBionicSpiderModel(model: BionicSpiderModel): void {
  if (model.root.parent) model.root.parent.remove(model.root);
  for (const material of model.materials) material.dispose();
  // The three plate/trim geometries are per-model because their parent/child
  // transforms must match the supplied asset exactly.
  for (let i = 0; i < 3; i += 1) {
    const plate = model.root.getObjectByName(`BionicSpiderDorsalPlate-${i}`) as THREE.Mesh | undefined;
    const trim = model.root.getObjectByName(`BionicSpiderDorsalTrim-${i}`) as THREE.Mesh | undefined;
    plate?.geometry?.dispose();
    trim?.geometry?.dispose();
  }
}

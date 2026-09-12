import * as THREE from 'three';

export type BionicSpiderHitRegion = 'head' | 'body' | 'limb';

export interface BionicSpiderLegRig {
  readonly hipLocal: THREE.Vector3;
  readonly homeFootLocal: THREE.Vector3;
  readonly upper: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  readonly lower: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  readonly hipJoint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  readonly kneeJoint: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  readonly footPad: THREE.Mesh<THREE.BoxGeometry, THREE.MeshStandardMaterial>;
}

export interface BionicSpiderModel {
  readonly root: THREE.Group;
  readonly bodyRoot: THREE.Group;
  readonly headRoot: THREE.Group;
  readonly legs: readonly BionicSpiderLegRig[];
  readonly bodyMaterial: THREE.MeshStandardMaterial;
  readonly legMaterial: THREE.MeshStandardMaterial;
  readonly eyeMaterial: THREE.MeshStandardMaterial;
}

/** Exact world-space scale requested for the arachnid juggernaut silhouette. */
export const BIONIC_SPIDER_SCALE = 4;
export const BIONIC_SPIDER_APPROX_HEIGHT = 2.95 * BIONIC_SPIDER_SCALE;
/** Local rig height. World-space height is multiplied by BIONIC_SPIDER_SCALE. */
export const BIONIC_SPIDER_BODY_HEIGHT = 1.42;

const bodyGeometry = new THREE.IcosahedronGeometry(1, 1);
const headGeometry = new THREE.IcosahedronGeometry(1, 1);
const eyeGeometry = new THREE.SphereGeometry(0.10, 7, 5);
const jointGeometry = new THREE.SphereGeometry(1, 8, 6);
const plateGeometry = new THREE.BoxGeometry(1, 1, 1);
const segmentGeometry = new THREE.CylinderGeometry(1, 0.72, 1, 6, 1, false);
const mastGeometry = new THREE.CylinderGeometry(0.055, 0.085, 1, 6, 1, false);
const sensorGeometry = new THREE.OctahedronGeometry(0.16, 0);
const mandibleGeometry = new THREE.ConeGeometry(0.11, 0.48, 6, 1, false);

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const segmentDirection = new THREE.Vector3();
const segmentMidpoint = new THREE.Vector3();
const segmentQuaternion = new THREE.Quaternion();
const footDirection = new THREE.Vector3();

function tagHit(mesh: THREE.Object3D, region: BionicSpiderHitRegion): void {
  mesh.userData.bionicSpiderHitRegion = region;
}

function configureMesh(mesh: THREE.Mesh): void {
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  mesh.frustumCulled = true;
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

function addArmorPlate(
  parent: THREE.Object3D,
  material: THREE.MeshStandardMaterial,
  name: string,
  x: number,
  y: number,
  z: number,
  sx: number,
  sy: number,
  sz: number,
  rz = 0,
): void {
  const plate = new THREE.Mesh(plateGeometry, material);
  plate.name = name;
  plate.position.set(x, y, z);
  plate.scale.set(sx, sy, sz);
  plate.rotation.z = rz;
  configureMesh(plate);
  tagHit(plate, 'body');
  parent.add(plate);
}

export function createBionicSpiderModel(enemyId: number): BionicSpiderModel {
  const root = new THREE.Group();
  root.name = `BionicSpider-${enemyId}`;
  root.userData.bionicSpiderEnemyId = enemyId;
  root.scale.setScalar(BIONIC_SPIDER_SCALE);

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x141922,
    metalness: 0.94,
    roughness: 0.25,
    emissive: 0xff3b00,
    emissiveIntensity: 0.06,
  });
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x080d14,
    metalness: 0.96,
    roughness: 0.22,
    emissive: 0x6b1000,
    emissiveIntensity: 0.035,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff6b24,
    metalness: 0.20,
    roughness: 0.16,
    emissive: 0xff2600,
    emissiveIntensity: 3.4,
  });

  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'BionicSpiderBody';
  bodyRoot.position.y = BIONIC_SPIDER_BODY_HEIGHT;
  root.add(bodyRoot);

  // Low, broad abdomen and compact cephalothorax keep the silhouette arachnid
  // instead of reading like a tall eight-legged robot.
  const abdomen = new THREE.Mesh(bodyGeometry, bodyMaterial);
  abdomen.name = 'BionicSpiderAbdomen';
  abdomen.position.set(0, 0.08, -0.72);
  abdomen.scale.set(1.22, 0.64, 1.48);
  configureMesh(abdomen);
  tagHit(abdomen, 'body');
  bodyRoot.add(abdomen);

  const thorax = new THREE.Mesh(bodyGeometry, bodyMaterial);
  thorax.name = 'BionicSpiderThorax';
  thorax.position.set(0, 0.01, 0.53);
  thorax.scale.set(1.02, 0.58, 0.92);
  configureMesh(thorax);
  tagHit(thorax, 'body');
  bodyRoot.add(thorax);

  // Segmented dorsal carapace: heavy overlapping armor rather than one primitive.
  for (let i = 0; i < 5; i += 1) {
    const z = -1.16 + i * 0.43;
    const width = 0.92 - Math.abs(i - 2) * 0.06;
    addArmorPlate(bodyRoot, bodyMaterial, `BionicSpiderDorsalArmor-${i}`, 0, 0.60 + Math.sin(i * 0.7) * 0.05, z, width, 0.10, 0.30, 0);
  }
  addArmorPlate(bodyRoot, bodyMaterial, 'BionicSpiderLeftFlankArmor', -0.92, 0.16, -0.38, 0.19, 0.34, 0.92, 0.08);
  addArmorPlate(bodyRoot, bodyMaterial, 'BionicSpiderRightFlankArmor', 0.92, 0.16, -0.38, 0.19, 0.34, 0.92, -0.08);

  const headRoot = new THREE.Group();
  headRoot.name = 'BionicSpiderHeadRig';
  headRoot.position.set(0, 0.00, 1.34);
  bodyRoot.add(headRoot);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.name = 'BionicSpiderHead';
  head.scale.set(0.72, 0.46, 0.68);
  configureMesh(head);
  tagHit(head, 'head');
  headRoot.add(head);

  // Eight compact sensors mirror the characteristic spider eye count while the
  // larger anterior pair keeps the threat readable at combat distance.
  const eyeOffsets: readonly [number, number, number, number][] = [
    [-0.32, 0.15, 0.56, 1.08], [0.32, 0.15, 0.56, 1.08],
    [-0.15, -0.03, 0.62, 0.92], [0.15, -0.03, 0.62, 0.92],
    [-0.48, 0.04, 0.36, 0.72], [0.48, 0.04, 0.36, 0.72],
    [-0.40, -0.16, 0.30, 0.62], [0.40, -0.16, 0.30, 0.62],
  ];
  for (let i = 0; i < eyeOffsets.length; i += 1) {
    const [x, y, z, scale] = eyeOffsets[i];
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = `BionicSpiderEye-${i}`;
    eye.position.set(x, y, z);
    eye.scale.setScalar(scale);
    configureMesh(eye);
    tagHit(eye, 'head');
    headRoot.add(eye);
  }

  for (const side of [-1, 1] as const) {
    const mandible = new THREE.Mesh(mandibleGeometry, bodyMaterial);
    mandible.name = `BionicSpiderMandible-${side < 0 ? 'L' : 'R'}`;
    mandible.position.set(side * 0.33, -0.27, 0.67);
    mandible.scale.set(1.35, 1.28, 1.35);
    mandible.rotation.x = Math.PI * 0.5;
    mandible.rotation.z = side * 0.20;
    configureMesh(mandible);
    tagHit(mandible, 'head');
    headRoot.add(mandible);
  }

  const mast = new THREE.Mesh(mastGeometry, legMaterial);
  mast.name = 'BionicSpiderSensorMast';
  mast.position.set(0, 0.96, -0.30);
  mast.scale.set(1.35, 1.15, 1.35);
  configureMesh(mast);
  tagHit(mast, 'body');
  bodyRoot.add(mast);

  const sensor = new THREE.Mesh(sensorGeometry, eyeMaterial);
  sensor.name = 'BionicSpiderSensor';
  sensor.position.set(0, 1.58, -0.30);
  sensor.scale.set(1.00, 1.32, 1.00);
  configureMesh(sensor);
  tagHit(sensor, 'body');
  bodyRoot.add(sensor);

  const legs: BionicSpiderLegRig[] = [];
  const zOffsets = [0.98, 0.36, -0.38, -1.02] as const;
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < zOffsets.length; row += 1) {
      const upper = new THREE.Mesh(segmentGeometry, legMaterial);
      const lower = new THREE.Mesh(segmentGeometry, legMaterial);
      const hipJoint = new THREE.Mesh(jointGeometry, legMaterial);
      const kneeJoint = new THREE.Mesh(jointGeometry, legMaterial);
      const footPad = new THREE.Mesh(plateGeometry, legMaterial);
      const suffix = `${side < 0 ? 'L' : 'R'}-${row}`;
      upper.name = `BionicSpiderUpperLeg-${suffix}`;
      lower.name = `BionicSpiderLowerLeg-${suffix}`;
      hipJoint.name = `BionicSpiderHip-${suffix}`;
      kneeJoint.name = `BionicSpiderKnee-${suffix}`;
      footPad.name = `BionicSpiderFoot-${suffix}`;
      for (const mesh of [upper, lower, hipJoint, kneeJoint, footPad]) {
        configureMesh(mesh);
        tagHit(mesh, 'limb');
        root.add(mesh);
      }
      hipJoint.scale.setScalar(0.18);
      kneeJoint.scale.setScalar(0.15);
      footPad.scale.set(0.26, 0.085, 0.42);

      const z = zOffsets[row];
      const outward = 2.02 + Math.abs(z) * 0.28;
      legs.push({
        hipLocal: new THREE.Vector3(side * 0.88, BIONIC_SPIDER_BODY_HEIGHT, z),
        homeFootLocal: new THREE.Vector3(side * outward, 0, z * 1.42),
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

  return { root, bodyRoot, headRoot, legs, bodyMaterial, legMaterial, eyeMaterial };
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
  placeSegment(leg.lower, kneeLocal, footLocal, 0.10);
  leg.hipJoint.position.copy(hipLocal);
  leg.kneeJoint.position.copy(kneeLocal);
  leg.footPad.position.copy(footLocal);
  leg.footPad.position.y += 0.055;
  footDirection.subVectors(footLocal, kneeLocal);
  leg.footPad.rotation.y = Math.atan2(footDirection.x, footDirection.z);
}

export function setBionicSpiderDamageVisual(model: BionicSpiderModel, amount: number): void {
  const flash = THREE.MathUtils.clamp(amount, 0, 1);
  model.bodyMaterial.emissiveIntensity = 0.06 + flash * 2.25;
  model.legMaterial.emissiveIntensity = 0.035 + flash * 0.8;
  model.eyeMaterial.emissiveIntensity = 3.4 + flash * 2.4;
}

export function disposeBionicSpiderModel(model: BionicSpiderModel): void {
  if (model.root.parent) model.root.parent.remove(model.root);
  model.bodyMaterial.dispose();
  model.legMaterial.dispose();
  model.eyeMaterial.dispose();
}

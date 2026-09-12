import * as THREE from 'three';

export type BionicSpiderHitRegion = 'head' | 'body' | 'limb';

export interface BionicSpiderLegRig {
  readonly hipLocal: THREE.Vector3;
  readonly homeFootLocal: THREE.Vector3;
  readonly upper: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
  readonly lower: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshStandardMaterial>;
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

export const BIONIC_SPIDER_APPROX_HEIGHT = 2.95;
export const BIONIC_SPIDER_BODY_HEIGHT = 1.42;

const bodyGeometry = new THREE.IcosahedronGeometry(1, 1);
const headGeometry = new THREE.IcosahedronGeometry(1, 1);
const eyeGeometry = new THREE.SphereGeometry(0.10, 7, 5);
const plateGeometry = new THREE.BoxGeometry(1, 1, 1);
const segmentGeometry = new THREE.CylinderGeometry(1, 0.72, 1, 6, 1, false);
const mastGeometry = new THREE.CylinderGeometry(0.055, 0.085, 1, 6, 1, false);
const sensorGeometry = new THREE.OctahedronGeometry(0.16, 0);
const mandibleGeometry = new THREE.ConeGeometry(0.11, 0.48, 6, 1, false);

const Y_AXIS = new THREE.Vector3(0, 1, 0);
const segmentDirection = new THREE.Vector3();
const segmentMidpoint = new THREE.Vector3();
const segmentQuaternion = new THREE.Quaternion();

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

export function createBionicSpiderModel(enemyId: number): BionicSpiderModel {
  const root = new THREE.Group();
  root.name = `BionicSpider-${enemyId}`;
  root.userData.bionicSpiderEnemyId = enemyId;

  const bodyMaterial = new THREE.MeshStandardMaterial({
    color: 0x171c24,
    metalness: 0.92,
    roughness: 0.28,
    emissive: 0xff3b00,
    emissiveIntensity: 0.06,
  });
  const legMaterial = new THREE.MeshStandardMaterial({
    color: 0x0d1118,
    metalness: 0.95,
    roughness: 0.24,
    emissive: 0x6b1000,
    emissiveIntensity: 0.035,
  });
  const eyeMaterial = new THREE.MeshStandardMaterial({
    color: 0xff5b1a,
    metalness: 0.25,
    roughness: 0.18,
    emissive: 0xff2d00,
    emissiveIntensity: 3.2,
  });

  const bodyRoot = new THREE.Group();
  bodyRoot.name = 'BionicSpiderBody';
  bodyRoot.position.y = BIONIC_SPIDER_BODY_HEIGHT;
  root.add(bodyRoot);

  const abdomen = new THREE.Mesh(bodyGeometry, bodyMaterial);
  abdomen.name = 'BionicSpiderAbdomen';
  abdomen.position.set(0, 0.06, -0.58);
  abdomen.scale.set(1.02, 0.66, 1.22);
  configureMesh(abdomen);
  tagHit(abdomen, 'body');
  bodyRoot.add(abdomen);

  const thorax = new THREE.Mesh(bodyGeometry, bodyMaterial);
  thorax.name = 'BionicSpiderThorax';
  thorax.position.set(0, 0.02, 0.48);
  thorax.scale.set(0.88, 0.58, 0.82);
  configureMesh(thorax);
  tagHit(thorax, 'body');
  bodyRoot.add(thorax);

  const headRoot = new THREE.Group();
  headRoot.name = 'BionicSpiderHeadRig';
  headRoot.position.set(0, 0.04, 1.15);
  bodyRoot.add(headRoot);

  const head = new THREE.Mesh(headGeometry, bodyMaterial);
  head.name = 'BionicSpiderHead';
  head.scale.set(0.62, 0.44, 0.58);
  configureMesh(head);
  tagHit(head, 'head');
  headRoot.add(head);

  const eyeOffsets: readonly [number, number, number][] = [
    [-0.31, 0.12, 0.48], [0.31, 0.12, 0.48],
    [-0.17, -0.05, 0.54], [0.17, -0.05, 0.54],
  ];
  for (let i = 0; i < eyeOffsets.length; i += 1) {
    const eye = new THREE.Mesh(eyeGeometry, eyeMaterial);
    eye.name = `BionicSpiderEye-${i}`;
    eye.position.set(...eyeOffsets[i]);
    configureMesh(eye);
    tagHit(eye, 'head');
    headRoot.add(eye);
  }

  for (const side of [-1, 1] as const) {
    const mandible = new THREE.Mesh(mandibleGeometry, bodyMaterial);
    mandible.name = `BionicSpiderMandible-${side < 0 ? 'L' : 'R'}`;
    mandible.position.set(side * 0.28, -0.24, 0.58);
    mandible.rotation.x = Math.PI * 0.5;
    mandible.rotation.z = side * 0.18;
    configureMesh(mandible);
    tagHit(mandible, 'head');
    headRoot.add(mandible);
  }

  for (let i = 0; i < 3; i += 1) {
    const plate = new THREE.Mesh(plateGeometry, bodyMaterial);
    plate.name = `BionicSpiderArmor-${i}`;
    plate.position.set(0, 0.56 + i * 0.035, -0.72 + i * 0.48);
    plate.scale.set(0.72 - i * 0.06, 0.10, 0.34);
    plate.rotation.x = -0.06 + i * 0.035;
    configureMesh(plate);
    tagHit(plate, 'body');
    bodyRoot.add(plate);
  }

  const mast = new THREE.Mesh(mastGeometry, legMaterial);
  mast.name = 'BionicSpiderSensorMast';
  mast.position.set(0, 0.93, -0.24);
  configureMesh(mast);
  tagHit(mast, 'body');
  bodyRoot.add(mast);

  const sensor = new THREE.Mesh(sensorGeometry, eyeMaterial);
  sensor.name = 'BionicSpiderSensor';
  sensor.position.set(0, 1.48, -0.24);
  sensor.scale.set(0.8, 1.15, 0.8);
  configureMesh(sensor);
  tagHit(sensor, 'body');
  bodyRoot.add(sensor);

  const legs: BionicSpiderLegRig[] = [];
  const zOffsets = [0.90, 0.34, -0.34, -0.92] as const;
  for (const side of [-1, 1] as const) {
    for (let row = 0; row < zOffsets.length; row += 1) {
      const upper = new THREE.Mesh(segmentGeometry, legMaterial);
      const lower = new THREE.Mesh(segmentGeometry, legMaterial);
      upper.name = `BionicSpiderUpperLeg-${side < 0 ? 'L' : 'R'}-${row}`;
      lower.name = `BionicSpiderLowerLeg-${side < 0 ? 'L' : 'R'}-${row}`;
      configureMesh(upper);
      configureMesh(lower);
      tagHit(upper, 'limb');
      tagHit(lower, 'limb');
      root.add(upper, lower);

      const z = zOffsets[row];
      const outward = 1.82 + Math.abs(z) * 0.24;
      legs.push({
        hipLocal: new THREE.Vector3(side * 0.76, BIONIC_SPIDER_BODY_HEIGHT, z),
        homeFootLocal: new THREE.Vector3(side * outward, 0, z * 1.34),
        upper,
        lower,
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
  placeSegment(leg.upper, hipLocal, kneeLocal, 0.105);
  placeSegment(leg.lower, kneeLocal, footLocal, 0.082);
}

export function setBionicSpiderDamageVisual(model: BionicSpiderModel, amount: number): void {
  const flash = THREE.MathUtils.clamp(amount, 0, 1);
  model.bodyMaterial.emissiveIntensity = 0.06 + flash * 2.25;
  model.legMaterial.emissiveIntensity = 0.035 + flash * 0.8;
  model.eyeMaterial.emissiveIntensity = 3.2 + flash * 2.4;
}

export function disposeBionicSpiderModel(model: BionicSpiderModel): void {
  if (model.root.parent) model.root.parent.remove(model.root);
  model.bodyMaterial.dispose();
  model.legMaterial.dispose();
  model.eyeMaterial.dispose();
}

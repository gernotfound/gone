from pathlib import Path


def write(path: str, content: str) -> None:
    target = Path(path)
    target.parent.mkdir(parents=True, exist_ok=True)
    target.write_text(content, encoding='utf-8')


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    if old not in text:
        raise SystemExit(f'missing patch anchor in {path}: {old[:100]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


write('game-web/src/models/bionicSpider.ts', r'''import * as THREE from 'three';

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
''')

write('game-web/src/gameplay/bionicSpiderEnemies.ts', r'''import * as THREE from 'three';
import { calculateWeaponDamageAtDistance } from '../weapons/weaponConfig.ts';
import {
  BIONIC_SPIDER_BODY_HEIGHT,
  createBionicSpiderModel,
  disposeBionicSpiderModel,
  poseBionicSpiderLeg,
  setBionicSpiderDamageVisual,
  type BionicSpiderHitRegion,
  type BionicSpiderModel,
} from '../models/bionicSpider.ts';

export const BIONIC_SPIDER_MAX_HP = 100;
export const BIONIC_SPIDER_MOVE_SPEED = (12 + 24) / 2;
export const BIONIC_SPIDER_MELEE_DAMAGE = 20;
export const BIONIC_SPIDER_MAX_ACTIVE = 8;
export const BIONIC_SPIDER_CONTACT_RADIUS = 2.15;

const CRATER_GRID = 200;
const SPAWN_MIN_DISTANCE = 105;
const SPAWN_MAX_DISTANCE = 620;
const HARD_DESPAWN_DISTANCE = 980;
const WORLD_LIMIT = 2350;
const EMERGE_DURATION = 1.15;
const DAMAGE_ANIM_DURATION = 0.26;
const DEATH_ANIM_DURATION = 1.25;
const CORPSE_LIFETIME = 5.5;
const ATTACK_COOLDOWN = 0.82;
const ATTACK_ANIM_DURATION = 0.30;
const GAIT_HZ = 2.85;
const SWING_FRACTION = 0.38;
const UPPER_LEG_LENGTH = 1.58;
const LOWER_LEG_LENGTH = 1.68;
const TAU = Math.PI * 2;

export interface CraterCenter {
  x: number;
  z: number;
}

export interface BionicSpiderSnapshot {
  id: number;
  hp: number;
  alive: boolean;
  x: number;
  y: number;
  z: number;
  speed: number;
  emerging: boolean;
}

type TerrainHeightFn = (x: number, z: number) => number;
type MeleeDamageHandler = (damage: number, enemyId: number) => void;

type LegState = {
  footWorld: THREE.Vector3;
  swingStartWorld: THREE.Vector3;
  swingTargetWorld: THREE.Vector3;
  wasSwinging: boolean;
  phaseOffset: number;
};

type EnemyState = {
  id: number;
  craterKey: string;
  model: BionicSpiderModel;
  hp: number;
  alive: boolean;
  speed: number;
  yaw: number;
  gaitClock: number;
  emergeTime: number;
  damageTimer: number;
  deathTimer: number;
  attackCooldown: number;
  attackTimer: number;
  groundY: number;
  terrainPitch: number;
  terrainRoll: number;
  terrainProbeTimer: number;
  deathSide: number;
  flinchSide: number;
  legs: LegState[];
};

const tempForward = new THREE.Vector3();
const tempRight = new THREE.Vector3();
const tempFootLocal = new THREE.Vector3();
const tempHipLocal = new THREE.Vector3();
const tempKneeLocal = new THREE.Vector3();
const tempDir = new THREE.Vector3();
const tempBend = new THREE.Vector3();
const tempMid = new THREE.Vector3();

function fract(value: number): number {
  return value - Math.floor(value);
}

function pseudoRandom(x: number, z: number): number {
  const n = Math.sin(x * 12.9898 + z * 78.233) * 43758.5453123;
  return n - Math.floor(n);
}

export function craterCenterForCell(cellX: number, cellZ: number): CraterCenter {
  return {
    x: cellX * CRATER_GRID + pseudoRandom(cellX, cellZ) * CRATER_GRID,
    z: cellZ * CRATER_GRID + pseudoRandom(cellX * 1.1, cellZ * 1.1) * CRATER_GRID,
  };
}

function moveTowards(current: number, target: number, maxDelta: number): number {
  if (Math.abs(target - current) <= maxDelta) return target;
  return current + Math.sign(target - current) * maxDelta;
}

function approachAngle(current: number, target: number, maxDelta: number): number {
  const delta = Math.atan2(Math.sin(target - current), Math.cos(target - current));
  if (Math.abs(delta) <= maxDelta) return target;
  return current + Math.sign(delta) * maxDelta;
}

function smooth01(value: number): number {
  const t = THREE.MathUtils.clamp(value, 0, 1);
  return t * t * (3 - 2 * t);
}

function worldFootToLocal(enemy: EnemyState, world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const dx = world.x - enemy.model.root.position.x;
  const dz = world.z - enemy.model.root.position.z;
  const cos = Math.cos(enemy.yaw);
  const sin = Math.sin(enemy.yaw);
  out.set(
    dx * cos - dz * sin,
    world.y - enemy.model.root.position.y,
    dx * sin + dz * cos,
  );
  return out;
}

function localFootToWorld(enemy: EnemyState, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const cos = Math.cos(enemy.yaw);
  const sin = Math.sin(enemy.yaw);
  out.set(
    enemy.model.root.position.x + local.x * cos + local.z * sin,
    enemy.model.root.position.y + local.y,
    enemy.model.root.position.z - local.x * sin + local.z * cos,
  );
  return out;
}

function solveTwoBoneKnee(
  hip: THREE.Vector3,
  foot: THREE.Vector3,
  outwardSign: number,
  out: THREE.Vector3,
): THREE.Vector3 {
  tempDir.subVectors(foot, hip);
  const rawDistance = Math.max(0.001, tempDir.length());
  const maxReach = UPPER_LEG_LENGTH + LOWER_LEG_LENGTH - 0.02;
  const distance = Math.min(maxReach, rawDistance);
  tempDir.multiplyScalar(1 / rawDistance);

  const along = (
    UPPER_LEG_LENGTH * UPPER_LEG_LENGTH
    - LOWER_LEG_LENGTH * LOWER_LEG_LENGTH
    + distance * distance
  ) / (2 * distance);
  const height = Math.sqrt(Math.max(0, UPPER_LEG_LENGTH * UPPER_LEG_LENGTH - along * along));

  tempBend.set(outwardSign, 0.82, 0.08);
  tempBend.addScaledVector(tempDir, -tempBend.dot(tempDir));
  if (tempBend.lengthSq() < 1e-5) tempBend.set(outwardSign, 1, 0);
  tempBend.normalize();

  tempMid.copy(hip).addScaledVector(tempDir, along);
  out.copy(tempMid).addScaledVector(tempBend, height);
  return out;
}

export class BionicSpiderEnemySystem {
  private scene: THREE.Scene | null = null;
  private terrainHeightAt: TerrainHeightFn | null = null;
  private onMeleeDamage: MeleeDamageHandler | null = null;
  private readonly enemies = new Map<number, EnemyState>();
  private readonly craterCooldownUntil = new Map<string, number>();
  private readonly activeCraterKeys = new Set<string>();
  private readonly raycastTargets: THREE.Object3D[] = [];
  private readonly pendingRemoval: number[] = [];
  private nextEnemyId = 1;
  private elapsed = 0;
  private directorTimer = 0;
  private enabled = false;

  public init(scene: THREE.Scene, terrainHeightAt: TerrainHeightFn, onMeleeDamage: MeleeDamageHandler): void {
    if (this.scene && this.scene !== scene) this.clear();
    this.scene = scene;
    this.terrainHeightAt = terrainHeightAt;
    this.onMeleeDamage = onMeleeDamage;
  }

  public update(
    delta: number,
    playerPosition: THREE.Vector3,
    playerAlive: boolean,
    enabled: boolean,
    paused = false,
  ): void {
    if (!this.scene || !this.terrainHeightAt) return;
    if (enabled !== this.enabled) {
      this.enabled = enabled;
      for (const enemy of this.enemies.values()) enemy.model.root.visible = enabled;
      this.rebuildRaycastTargets();
    }
    if (!enabled || paused) return;

    const dt = Math.min(Math.max(delta, 0), 0.1);
    this.elapsed += dt;
    this.directorTimer -= dt;
    if (this.elapsed >= 6 && this.directorTimer <= 0) {
      this.directorTimer = 0.65;
      this.tickSpawnDirector(playerPosition);
    }

    this.pendingRemoval.length = 0;
    for (const enemy of this.enemies.values()) {
      this.updateEnemy(enemy, dt, playerPosition, playerAlive);
      const dx = enemy.model.root.position.x - playerPosition.x;
      const dz = enemy.model.root.position.z - playerPosition.z;
      if (enemy.alive && dx * dx + dz * dz > HARD_DESPAWN_DISTANCE * HARD_DESPAWN_DISTANCE) {
        this.pendingRemoval.push(enemy.id);
      } else if (!enemy.alive && enemy.deathTimer >= CORPSE_LIFETIME) {
        this.pendingRemoval.push(enemy.id);
      }
    }
    for (const id of this.pendingRemoval) this.removeEnemy(id, 7);
  }

  public getRaycastTargets(): readonly THREE.Object3D[] {
    return this.enabled ? this.raycastTargets : [];
  }

  public applyRaycastHit(
    intersection: THREE.Intersection,
    weaponId: number,
    shotDirection: THREE.Vector3,
  ): boolean {
    const id = Number(intersection.object.userData.bionicSpiderEnemyId);
    if (!Number.isInteger(id)) return false;
    const enemy = this.enemies.get(id);
    if (!enemy?.alive) return false;

    const region = intersection.object.userData.bionicSpiderHitRegion as BionicSpiderHitRegion | undefined;
    const headshot = region === 'head';
    let damage = calculateWeaponDamageAtDistance(weaponId, intersection.distance, headshot);
    if (region === 'limb') damage *= 0.72;
    if (damage <= 0) return false;
    this.damageEnemy(id, damage, shotDirection);
    return true;
  }

  public damageEnemy(id: number, damage: number, shotDirection?: THREE.Vector3): boolean {
    const enemy = this.enemies.get(id);
    if (!enemy?.alive || !Number.isFinite(damage) || damage <= 0) return false;
    enemy.hp = Math.max(0, enemy.hp - damage);
    enemy.damageTimer = DAMAGE_ANIM_DURATION;
    enemy.flinchSide = shotDirection ? (shotDirection.x >= 0 ? -1 : 1) : enemy.deathSide;
    if (enemy.hp <= 0) {
      enemy.alive = false;
      enemy.speed = 0;
      enemy.deathTimer = 0;
      this.rebuildRaycastTargets();
    }
    return true;
  }

  public spawnAtCrater(x: number, z: number, craterKey = `manual:${x.toFixed(1)}:${z.toFixed(1)}`): number | null {
    if (!this.scene || !this.terrainHeightAt || this.enemies.size >= BIONIC_SPIDER_MAX_ACTIVE) return null;
    if (this.activeCraterKeys.has(craterKey)) return null;

    const id = this.nextEnemyId++;
    const model = createBionicSpiderModel(id);
    const groundY = this.terrainHeightAt(x, z);
    model.root.position.set(x, groundY - 1.55, z);
    model.root.rotation.y = pseudoRandom(x * 0.17, z * 0.19) * TAU;
    model.root.visible = this.enabled;
    this.scene.add(model.root);

    const enemy: EnemyState = {
      id,
      craterKey,
      model,
      hp: BIONIC_SPIDER_MAX_HP,
      alive: true,
      speed: 0,
      yaw: model.root.rotation.y,
      gaitClock: pseudoRandom(x, z) * 2,
      emergeTime: 0,
      damageTimer: 0,
      deathTimer: 0,
      attackCooldown: 0.35,
      attackTimer: 0,
      groundY,
      terrainPitch: 0,
      terrainRoll: 0,
      terrainProbeTimer: (id % 4) * 0.025,
      deathSide: id % 2 === 0 ? 1 : -1,
      flinchSide: 1,
      legs: [],
    };

    for (let i = 0; i < model.legs.length; i += 1) {
      const rig = model.legs[i];
      const world = new THREE.Vector3();
      localFootToWorld(enemy, rig.homeFootLocal, world);
      world.y = this.terrainHeightAt(world.x, world.z);
      enemy.legs.push({
        footWorld: world,
        swingStartWorld: world.clone(),
        swingTargetWorld: world.clone(),
        wasSwinging: false,
        phaseOffset: ((i % 4) % 2 === 0) !== (i < 4) ? 0.5 : 0,
      });
    }

    this.enemies.set(id, enemy);
    this.activeCraterKeys.add(craterKey);
    this.rebuildRaycastTargets();
    return id;
  }

  public getSnapshot(id: number): BionicSpiderSnapshot | null {
    const enemy = this.enemies.get(id);
    if (!enemy) return null;
    return {
      id: enemy.id,
      hp: enemy.hp,
      alive: enemy.alive,
      x: enemy.model.root.position.x,
      y: enemy.model.root.position.y,
      z: enemy.model.root.position.z,
      speed: enemy.speed,
      emerging: enemy.emergeTime < EMERGE_DURATION,
    };
  }

  public getActiveCount(): number {
    return this.enemies.size;
  }

  public clear(): void {
    for (const enemy of this.enemies.values()) disposeBionicSpiderModel(enemy.model);
    this.enemies.clear();
    this.activeCraterKeys.clear();
    this.raycastTargets.length = 0;
  }

  public dispose(): void {
    this.clear();
    this.scene = null;
    this.terrainHeightAt = null;
    this.onMeleeDamage = null;
    this.enabled = false;
  }

  private tickSpawnDirector(playerPosition: THREE.Vector3): void {
    if (this.enemies.size >= BIONIC_SPIDER_MAX_ACTIVE || !this.terrainHeightAt) return;
    const now = this.elapsed;
    let bestX = 0;
    let bestZ = 0;
    let bestKey = '';
    let bestScore = Number.POSITIVE_INFINITY;

    const consider = (x: number, z: number, key: string, occupancy: number): void => {
      if (occupancy < 0.48 || Math.abs(x) > WORLD_LIMIT || Math.abs(z) > WORLD_LIMIT) return;
      if (this.activeCraterKeys.has(key) || (this.craterCooldownUntil.get(key) ?? 0) > now) return;
      const dx = x - playerPosition.x;
      const dz = z - playerPosition.z;
      const distanceSq = dx * dx + dz * dz;
      if (distanceSq < SPAWN_MIN_DISTANCE * SPAWN_MIN_DISTANCE || distanceSq > SPAWN_MAX_DISTANCE * SPAWN_MAX_DISTANCE) return;
      const score = distanceSq * (0.92 + occupancy * 0.16);
      if (score < bestScore) {
        bestScore = score;
        bestX = x;
        bestZ = z;
        bestKey = key;
      }
    };

    consider(1200, 1200, 'giant:1200:1200', 1);

    const minCellX = Math.floor((playerPosition.x - SPAWN_MAX_DISTANCE) / CRATER_GRID) - 1;
    const maxCellX = Math.floor((playerPosition.x + SPAWN_MAX_DISTANCE) / CRATER_GRID) + 1;
    const minCellZ = Math.floor((playerPosition.z - SPAWN_MAX_DISTANCE) / CRATER_GRID) - 1;
    const maxCellZ = Math.floor((playerPosition.z + SPAWN_MAX_DISTANCE) / CRATER_GRID) + 1;

    for (let cellX = minCellX; cellX <= maxCellX; cellX += 1) {
      for (let cellZ = minCellZ; cellZ <= maxCellZ; cellZ += 1) {
        const center = craterCenterForCell(cellX, cellZ);
        const occupancy = pseudoRandom(cellX * 0.73 + 11.3, cellZ * 1.37 - 7.1);
        consider(center.x, center.z, `${cellX}:${cellZ}`, occupancy);
      }
    }

    if (bestKey) this.spawnAtCrater(bestX, bestZ, bestKey);
  }

  private updateEnemy(enemy: EnemyState, delta: number, playerPosition: THREE.Vector3, playerAlive: boolean): void {
    enemy.attackCooldown = Math.max(0, enemy.attackCooldown - delta);
    enemy.attackTimer = Math.max(0, enemy.attackTimer - delta);
    enemy.damageTimer = Math.max(0, enemy.damageTimer - delta);

    enemy.terrainProbeTimer -= delta;
    if (enemy.terrainProbeTimer <= 0) {
      enemy.terrainProbeTimer = 0.09 + (enemy.id % 3) * 0.012;
      this.probeTerrain(enemy);
    }

    if (!enemy.alive) {
      this.updateDeath(enemy, delta);
      return;
    }

    enemy.emergeTime = Math.min(EMERGE_DURATION, enemy.emergeTime + delta);
    if (enemy.emergeTime < EMERGE_DURATION) {
      const emerge = smooth01(enemy.emergeTime / EMERGE_DURATION);
      enemy.model.root.position.y = enemy.groundY - (1 - emerge) * 1.55;
      enemy.model.bodyRoot.position.y = BIONIC_SPIDER_BODY_HEIGHT - (1 - emerge) * 0.18;
      enemy.model.bodyRoot.rotation.z = Math.sin(emerge * Math.PI) * 0.06 * enemy.deathSide;
      this.updateLegs(enemy, delta, 0);
      setBionicSpiderDamageVisual(enemy.model, 0);
      return;
    }

    const dx = playerPosition.x - enemy.model.root.position.x;
    const dz = playerPosition.z - enemy.model.root.position.z;
    const distance = Math.hypot(dx, dz);
    const shouldChase = playerAlive && distance > BIONIC_SPIDER_CONTACT_RADIUS + 0.35;
    if (shouldChase) {
      const desiredYaw = Math.atan2(dx, dz);
      enemy.yaw = approachAngle(enemy.yaw, desiredYaw, 4.7 * delta);
      enemy.speed = moveTowards(enemy.speed, BIONIC_SPIDER_MOVE_SPEED, 28 * delta);
    } else {
      enemy.speed = moveTowards(enemy.speed, 0, 38 * delta);
    }

    enemy.model.root.rotation.y = enemy.yaw;
    enemy.model.root.position.x = THREE.MathUtils.clamp(
      enemy.model.root.position.x + Math.sin(enemy.yaw) * enemy.speed * delta,
      -WORLD_LIMIT,
      WORLD_LIMIT,
    );
    enemy.model.root.position.z = THREE.MathUtils.clamp(
      enemy.model.root.position.z + Math.cos(enemy.yaw) * enemy.speed * delta,
      -WORLD_LIMIT,
      WORLD_LIMIT,
    );
    enemy.model.root.position.y = THREE.MathUtils.lerp(
      enemy.model.root.position.y,
      enemy.groundY,
      Math.min(1, delta * 14),
    );

    const speedRatio = THREE.MathUtils.clamp(enemy.speed / BIONIC_SPIDER_MOVE_SPEED, 0, 1);
    enemy.gaitClock += delta * GAIT_HZ * (0.35 + speedRatio * 0.65);
    this.updateLegs(enemy, delta, speedRatio);

    const damageFlash = enemy.damageTimer > 0 ? enemy.damageTimer / DAMAGE_ANIM_DURATION : 0;
    const attackPhase = enemy.attackTimer > 0 ? 1 - enemy.attackTimer / ATTACK_ANIM_DURATION : 0;
    const attackLunge = Math.sin(THREE.MathUtils.clamp(attackPhase, 0, 1) * Math.PI);
    const walkBob = Math.sin(enemy.gaitClock * TAU * 2) * 0.035 * speedRatio;
    enemy.model.bodyRoot.position.set(
      enemy.flinchSide * damageFlash * 0.08,
      BIONIC_SPIDER_BODY_HEIGHT + walkBob + damageFlash * 0.07,
      attackLunge * 0.24 - damageFlash * 0.16,
    );
    enemy.model.bodyRoot.rotation.x = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.x,
      enemy.terrainPitch + damageFlash * 0.08,
      Math.min(1, delta * 12),
    );
    enemy.model.bodyRoot.rotation.z = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.z,
      enemy.terrainRoll + enemy.flinchSide * damageFlash * 0.16,
      Math.min(1, delta * 12),
    );
    enemy.model.headRoot.rotation.y = Math.sin(enemy.gaitClock * TAU) * 0.045 + enemy.flinchSide * damageFlash * 0.10;
    setBionicSpiderDamageVisual(enemy.model, damageFlash);

    const verticalDistance = Math.abs(playerPosition.y - enemy.groundY);
    if (
      playerAlive
      && distance <= BIONIC_SPIDER_CONTACT_RADIUS
      && verticalDistance < 3.2
      && enemy.attackCooldown <= 0
    ) {
      enemy.attackCooldown = ATTACK_COOLDOWN;
      enemy.attackTimer = ATTACK_ANIM_DURATION;
      this.onMeleeDamage?.(BIONIC_SPIDER_MELEE_DAMAGE, enemy.id);
    }
  }

  private probeTerrain(enemy: EnemyState): void {
    if (!this.terrainHeightAt) return;
    const x = enemy.model.root.position.x;
    const z = enemy.model.root.position.z;
    tempForward.set(Math.sin(enemy.yaw), 0, Math.cos(enemy.yaw));
    tempRight.set(Math.cos(enemy.yaw), 0, -Math.sin(enemy.yaw));

    const center = this.terrainHeightAt(x, z);
    const front = this.terrainHeightAt(x + tempForward.x * 1.45, z + tempForward.z * 1.45);
    const right = this.terrainHeightAt(x + tempRight.x * 1.25, z + tempRight.z * 1.25);
    enemy.groundY = center;
    enemy.terrainPitch = THREE.MathUtils.clamp(Math.atan2(center - front, 1.45), -0.48, 0.48);
    enemy.terrainRoll = THREE.MathUtils.clamp(Math.atan2(right - center, 1.25), -0.42, 0.42);
  }

  private updateLegs(enemy: EnemyState, delta: number, speedRatio: number, collapse = 0): void {
    if (!this.terrainHeightAt) return;
    for (let i = 0; i < enemy.model.legs.length; i += 1) {
      const rig = enemy.model.legs[i];
      const state = enemy.legs[i];
      const phase = fract(enemy.gaitClock + state.phaseOffset);
      const swinging = speedRatio > 0.05 && phase < SWING_FRACTION;

      if (swinging && !state.wasSwinging) {
        state.swingStartWorld.copy(state.footWorld);
        localFootToWorld(enemy, rig.homeFootLocal, state.swingTargetWorld);
        tempForward.set(Math.sin(enemy.yaw), 0, Math.cos(enemy.yaw));
        const lead = 0.42 + speedRatio * 1.05;
        state.swingTargetWorld.addScaledVector(tempForward, lead);
        state.swingTargetWorld.y = this.terrainHeightAt(state.swingTargetWorld.x, state.swingTargetWorld.z);
      }

      if (swinging) {
        const t = smooth01(phase / SWING_FRACTION);
        state.footWorld.lerpVectors(state.swingStartWorld, state.swingTargetWorld, t);
        state.footWorld.y += Math.sin(t * Math.PI) * (0.48 + speedRatio * 0.26);
      } else if (state.wasSwinging) {
        state.footWorld.copy(state.swingTargetWorld);
      }
      state.wasSwinging = swinging;

      tempHipLocal.copy(rig.hipLocal);
      tempHipLocal.y -= collapse * 0.94;
      worldFootToLocal(enemy, state.footWorld, tempFootLocal);
      solveTwoBoneKnee(tempHipLocal, tempFootLocal, Math.sign(rig.hipLocal.x), tempKneeLocal);
      poseBionicSpiderLeg(enemy.model, i, tempHipLocal, tempKneeLocal, tempFootLocal);
    }
  }

  private updateDeath(enemy: EnemyState, delta: number): void {
    enemy.deathTimer += delta;
    const collapse = smooth01(enemy.deathTimer / DEATH_ANIM_DURATION);
    enemy.model.root.position.y = THREE.MathUtils.lerp(enemy.model.root.position.y, enemy.groundY, Math.min(1, delta * 10));
    enemy.model.bodyRoot.position.set(0, BIONIC_SPIDER_BODY_HEIGHT - collapse * 1.08, -collapse * 0.12);
    enemy.model.bodyRoot.rotation.x = enemy.terrainPitch + collapse * 0.34;
    enemy.model.bodyRoot.rotation.z = enemy.terrainRoll + enemy.deathSide * collapse * 1.08;
    enemy.model.headRoot.rotation.x = collapse * 0.55;
    enemy.model.headRoot.rotation.y = enemy.deathSide * collapse * 0.32;
    this.updateLegs(enemy, delta, 0, collapse);
    const residualFlash = Math.max(0, 1 - enemy.deathTimer / 0.45);
    setBionicSpiderDamageVisual(enemy.model, residualFlash);
  }

  private removeEnemy(id: number, cooldownSeconds: number): void {
    const enemy = this.enemies.get(id);
    if (!enemy) return;
    this.enemies.delete(id);
    this.activeCraterKeys.delete(enemy.craterKey);
    this.craterCooldownUntil.set(enemy.craterKey, this.elapsed + cooldownSeconds);
    disposeBionicSpiderModel(enemy.model);
    this.rebuildRaycastTargets();
  }

  private rebuildRaycastTargets(): void {
    this.raycastTargets.length = 0;
    if (!this.enabled) return;
    for (const enemy of this.enemies.values()) {
      if (enemy.alive) this.raycastTargets.push(enemy.model.root);
    }
  }
}

export const bionicSpiderEnemies = new BionicSpiderEnemySystem();
''')

write('tests/tier1_features/test_bionic_spider_enemies.mjs', r'''import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import {
  BIONIC_SPIDER_APPROX_HEIGHT,
  createBionicSpiderModel,
  disposeBionicSpiderModel,
} from '../../game-web/src/models/bionicSpider.ts';
import {
  BIONIC_SPIDER_CONTACT_RADIUS,
  BIONIC_SPIDER_MAX_HP,
  BIONIC_SPIDER_MELEE_DAMAGE,
  BIONIC_SPIDER_MOVE_SPEED,
  BionicSpiderEnemySystem,
  craterCenterForCell,
} from '../../game-web/src/gameplay/bionicSpiderEnemies.ts';
import { assert, assertCloseTo, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';

export async function run(suite) {
  suite.test('Bionic spider model is ~3m tall with eight articulated two-bone legs', () => {
    const model = createBionicSpiderModel(42);
    assertEqual(model.legs.length, 8, 'Spider must have exactly eight legs');
    assert(BIONIC_SPIDER_APPROX_HEIGHT >= 2.7 && BIONIC_SPIDER_APPROX_HEIGHT <= 3.2, 'Silhouette must stay around 3m');
    for (const leg of model.legs) {
      assert(leg.upper.isMesh && leg.lower.isMesh, 'Each leg must expose articulated upper/lower segments');
      assertEqual(leg.upper.userData.bionicSpiderHitRegion, 'limb');
      assertEqual(leg.lower.userData.bionicSpiderHitRegion, 'limb');
    }
    const head = model.root.getObjectByName('BionicSpiderHead');
    assert(head && head.userData.bionicSpiderHitRegion === 'head', 'Head hit region must be explicit');
    disposeBionicSpiderModel(model);
  });

  suite.test('Enemy balance follows the requested HP and mean walk/run speed', () => {
    assertEqual(BIONIC_SPIDER_MAX_HP, 100);
    assertCloseTo(BIONIC_SPIDER_MOVE_SPEED, (12 + 24) / 2, 1e-6, 'Speed must be mean of 12m/s walk and 24m/s sprint');
    assertGreaterThan(BIONIC_SPIDER_CONTACT_RADIUS, 1.5, 'Contact radius must match a large 3m spider body');
  });

  suite.test('Procedural enemy spawn centers reproduce deterministic crater cells', () => {
    const a = craterCenterForCell(3, -2);
    const b = craterCenterForCell(3, -2);
    assertCloseTo(a.x, b.x, 1e-9);
    assertCloseTo(a.z, b.z, 1e-9);
    assert(a.x >= 600 && a.x < 800, 'Crater X must remain inside its 200m terrain cell');
    assert(a.z >= -400 && a.z < -200, 'Crater Z must remain inside its 200m terrain cell');
  });

  suite.test('Spider emerges, chases the player, deals immediate contact melee, flinches and dies at 0 HP', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    let meleeDamage = 0;
    system.init(scene, () => 0, (damage) => { meleeDamage += damage; });
    system.update(0, new THREE.Vector3(0, 0, 30), true, true, false);
    const id = system.spawnAtCrater(0, 0, 'test-crater');
    assert(id !== null, 'Manual crater spawn must create a spider');

    for (let i = 0; i < 14; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), true, true, false);
    const afterEmergence = system.getSnapshot(id);
    assert(afterEmergence && !afterEmergence.emerging, 'Spider must complete emergence animation');
    const startZ = afterEmergence.z;

    for (let i = 0; i < 8; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), true, true, false);
    const chasing = system.getSnapshot(id);
    assert(chasing && chasing.z > startZ, 'Spider must move toward the player');
    assert(chasing.speed > 0, 'Spider must accelerate into its chase gait');

    const contactTarget = new THREE.Vector3(chasing.x, 0, chasing.z + BIONIC_SPIDER_CONTACT_RADIUS * 0.7);
    system.update(0.1, contactTarget, true, true, false);
    assertEqual(meleeDamage, BIONIC_SPIDER_MELEE_DAMAGE, 'Contact must immediately apply one melee hit');

    assert(system.damageEnemy(id, 25, new THREE.Vector3(1, 0, 0)), 'Damage must be accepted while alive');
    assertCloseTo(system.getSnapshot(id).hp, 75, 1e-6);
    assert(system.damageEnemy(id, 75, new THREE.Vector3(1, 0, 0)), 'Lethal damage must be accepted');
    assertEqual(system.getSnapshot(id).alive, false, 'Spider must enter death state at 0 HP');
    system.update(0.6, contactTarget, true, true, false);
    assertEqual(system.getSnapshot(id).alive, false, 'Death animation must persist before corpse cleanup');
    system.dispose();
  });
}
''')

replace_once(
    'game-web/src/gameplay/engine.ts',
    "import { getPlayerSpawnY, getSpawnPointForSlot } from './spawnPolicy.ts';\n",
    "import { getPlayerSpawnY, getSpawnPointForSlot } from './spawnPolicy.ts';\nimport { bionicSpiderEnemies } from './bionicSpiderEnemies.ts';\n",
)
replace_once(
    'game-web/src/gameplay/engine.ts',
    "  const targets: THREE.Object3D[] = [...getChunkMeshes()];\n  for (const remote of remotePlayers.values()) targets.push(remote.group);\n",
    "  const targets: THREE.Object3D[] = [...getChunkMeshes()];\n  for (const remote of remotePlayers.values()) targets.push(remote.group);\n  for (const enemyTarget of bionicSpiderEnemies.getRaycastTargets()) targets.push(enemyTarget);\n",
)
replace_once(
    'game-web/src/gameplay/engine.ts',
    "    hitNormal = hit.face\n      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)\n      : rayDirection.clone().negate();\n  } else {\n",
    "    hitNormal = hit.face\n      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)\n      : rayDirection.clone().negate();\n    bionicSpiderEnemies.applyRaycastHit(hit, stats.id, rayDirection);\n  } else {\n",
)
replace_once(
    'game-web/src/gameplay/engine.ts',
    "  vfxManager.init(scene, camera);\n  healthHud.init();\n",
    "  vfxManager.init(scene, camera);\n  bionicSpiderEnemies.init(scene, getTerrainHeightAt, (damage) => {\n    if (!player.isAlive || player.isInvulnerable) return;\n    handleLocalPlayerDamage(player.hp - damage);\n  });\n  healthHud.init();\n",
)
replace_once(
    'game-web/src/gameplay/engine.ts',
    "    updateChunks(player.position);\n    vfxManager.update(delta);\n",
    "    const enemiesEnabled = !activeP2PHost && !activeP2PClient;\n    const enemiesPaused = !DOM.mainMenu.classList.contains('hidden') || isMapOpen;\n    bionicSpiderEnemies.update(delta, player.position, player.isAlive, enemiesEnabled, enemiesPaused);\n\n    updateChunks(player.position);\n    vfxManager.update(delta);\n",
)
replace_once(
    'game-web/src/gameplay/engine.ts',
    "  player,\n  healthHud,\n",
    "  player,\n  bionicSpiderEnemies,\n  healthHud,\n",
)

replace_once(
    'AGENTS.md',
    "- Never reintroduce `(0,17.5,0)` as intended gameplay spawn.\n",
    "- Never reintroduce `(0,17.5,0)` as intended gameplay spawn.\n- Solo PvE bionic spiders are owned by `gameplay/bionicSpiderEnemies.ts`; their procedural rig lives in `models/bionicSpider.ts`. They spawn from deterministic crater centers, use terrain-aware eight-leg gait/IK, and are intentionally disabled in P2P until enemy state/combat is host-authoritatively represented in the binary protocol. Do not enable divergent per-client enemy simulation in multiplayer.\n",
)

import * as THREE from 'three';
import { calculateWeaponDamageAtDistance } from '../weapons/weaponConfig.ts';
import {
  BIONIC_SPIDER_BODY_HEIGHT,
  BIONIC_SPIDER_SCALE,
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
export const BIONIC_SPIDER_CONTACT_RADIUS = 2.15 * BIONIC_SPIDER_SCALE;

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
// The supplied armored-spider reference uses a 35% swing / 65% stance gait.
const GAIT_HZ = 1.65;
const SWING_FRACTION = 0.35;
const UPPER_LEG_LENGTH = 1.58;
const LOWER_LEG_LENGTH = 1.68;
const IDLE_BREATH_AMPLITUDE = 0.052;
const DEATH_CURL_SCALE = 0.4;
const TAU = Math.PI * 2;
const DEAD_COLOR = new THREE.Color(0x111111);
const POWER_CORE_COLOR = new THREE.Color(0xff6600);
const CYAN_COLOR = new THREE.Color(0x00f3ff);
const MAGENTA_COLOR = new THREE.Color(0xff00ea);

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

function setDeathPowerDown(model: BionicSpiderModel, amount: number): void {
  const fade = THREE.MathUtils.clamp(amount, 0, 1);
  model.coreMaterial.color.copy(POWER_CORE_COLOR).lerp(DEAD_COLOR, fade);
  model.coreMaterial.emissive.copy(POWER_CORE_COLOR).lerp(DEAD_COLOR, fade);
  model.coreMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.1, 0, fade);
  model.neonCyanMaterial.color.copy(CYAN_COLOR).lerp(DEAD_COLOR, fade);
  model.neonCyanMaterial.emissive.copy(CYAN_COLOR).lerp(DEAD_COLOR, fade);
  model.neonCyanMaterial.emissiveIntensity = THREE.MathUtils.lerp(3.0, 0, fade);
  model.neonMagentaMaterial.color.copy(MAGENTA_COLOR).lerp(DEAD_COLOR, fade);
  model.neonMagentaMaterial.emissive.copy(MAGENTA_COLOR).lerp(DEAD_COLOR, fade);
  model.neonMagentaMaterial.emissiveIntensity = THREE.MathUtils.lerp(2.8, 0, fade);
}

function worldFootToLocal(enemy: EnemyState, world: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const invScale = 1 / BIONIC_SPIDER_SCALE;
  const dx = (world.x - enemy.model.root.position.x) * invScale;
  const dy = (world.y - enemy.model.root.position.y) * invScale;
  const dz = (world.z - enemy.model.root.position.z) * invScale;
  const cos = Math.cos(enemy.yaw);
  const sin = Math.sin(enemy.yaw);
  out.set(
    dx * cos - dz * sin,
    dy,
    dx * sin + dz * cos,
  );
  return out;
}

function localFootToWorld(enemy: EnemyState, local: THREE.Vector3, out: THREE.Vector3): THREE.Vector3 {
  const cos = Math.cos(enemy.yaw);
  const sin = Math.sin(enemy.yaw);
  const lx = local.x * BIONIC_SPIDER_SCALE;
  const ly = local.y * BIONIC_SPIDER_SCALE;
  const lz = local.z * BIONIC_SPIDER_SCALE;
  out.set(
    enemy.model.root.position.x + lx * cos + lz * sin,
    enemy.model.root.position.y + ly,
    enemy.model.root.position.z - lx * sin + lz * cos,
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
    const emergeDepth = 1.55 * BIONIC_SPIDER_SCALE;
    model.root.position.set(x, groundY - emergeDepth, z);
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
        // Gemini reference group A is [0,2,5,7]; this mapping preserves it exactly.
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
      enemy.model.root.position.y = enemy.groundY - (1 - emerge) * 1.55 * BIONIC_SPIDER_SCALE;
      enemy.model.bodyRoot.position.y = BIONIC_SPIDER_BODY_HEIGHT - (1 - emerge) * 0.18;
      enemy.model.bodyRoot.rotation.z = Math.sin(emerge * Math.PI) * 0.06 * enemy.deathSide;
      this.updateLegs(enemy, delta, 0);
      setBionicSpiderDamageVisual(enemy.model, 0);
      return;
    }

    const dx = playerPosition.x - enemy.model.root.position.x;
    const dz = playerPosition.z - enemy.model.root.position.z;
    const distance = Math.hypot(dx, dz);
    const shouldChase = playerAlive && distance > BIONIC_SPIDER_CONTACT_RADIUS + 0.35 * BIONIC_SPIDER_SCALE;
    if (shouldChase) {
      const desiredYaw = Math.atan2(dx, dz);
      enemy.yaw = approachAngle(enemy.yaw, desiredYaw, 2.35 * delta);
      enemy.speed = moveTowards(enemy.speed, BIONIC_SPIDER_MOVE_SPEED, 15 * delta);
    } else {
      enemy.speed = moveTowards(enemy.speed, 0, 22 * delta);
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
      Math.min(1, delta * 10),
    );

    const speedRatio = THREE.MathUtils.clamp(enemy.speed / BIONIC_SPIDER_MOVE_SPEED, 0, 1);
    enemy.gaitClock += delta * GAIT_HZ * (0.35 + speedRatio * 0.65);
    this.updateLegs(enemy, delta, speedRatio);

    const damageFlash = enemy.damageTimer > 0 ? enemy.damageTimer / DAMAGE_ANIM_DURATION : 0;
    const damageProgress = 1 - damageFlash;
    const damageShock = damageFlash * Math.sin(damageProgress * Math.PI * 5);
    const attackPhase = enemy.attackTimer > 0 ? 1 - enemy.attackTimer / ATTACK_ANIM_DURATION : 0;
    const attackLunge = Math.sin(THREE.MathUtils.clamp(attackPhase, 0, 1) * Math.PI);
    const idleWeight = 1 - speedRatio;
    const idleBreath = Math.sin(this.elapsed * 2 + enemy.id * 0.67) * IDLE_BREATH_AMPLITUDE * idleWeight;
    const walkBob = Math.sin(enemy.gaitClock * TAU * 2) * 0.035 * speedRatio;
    const walkPitch = speedRatio * (0.05 + Math.sin(enemy.gaitClock * TAU) * 0.02);
    enemy.model.bodyRoot.position.set(
      enemy.flinchSide * (damageFlash * 0.08 + damageShock * 0.05),
      BIONIC_SPIDER_BODY_HEIGHT + idleBreath + walkBob - damageFlash * 0.13 + Math.abs(damageShock) * 0.035,
      attackLunge * 0.24 - damageFlash * 0.16,
    );
    enemy.model.bodyRoot.rotation.x = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.x,
      enemy.terrainPitch + walkPitch - damageFlash * 0.12 + damageShock * 0.08,
      Math.min(1, delta * 12),
    );
    enemy.model.bodyRoot.rotation.z = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.z,
      enemy.terrainRoll + enemy.flinchSide * (damageFlash * 0.16 + damageShock * 0.10),
      Math.min(1, delta * 12),
    );
    enemy.model.headRoot.rotation.y = Math.sin(enemy.gaitClock * TAU) * 0.045 + enemy.flinchSide * damageFlash * 0.10;
    setBionicSpiderDamageVisual(enemy.model, damageFlash);

    const verticalDistance = Math.abs(playerPosition.y - enemy.groundY);
    if (
      playerAlive
      && distance <= BIONIC_SPIDER_CONTACT_RADIUS
      && verticalDistance < 3.2 * BIONIC_SPIDER_SCALE
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

    const frontProbe = 1.45 * BIONIC_SPIDER_SCALE;
    const sideProbe = 1.25 * BIONIC_SPIDER_SCALE;
    const center = this.terrainHeightAt(x, z);
    const front = this.terrainHeightAt(x + tempForward.x * frontProbe, z + tempForward.z * frontProbe);
    const right = this.terrainHeightAt(x + tempRight.x * sideProbe, z + tempRight.z * sideProbe);
    enemy.groundY = center;
    enemy.terrainPitch = THREE.MathUtils.clamp(Math.atan2(center - front, frontProbe), -0.48, 0.48);
    enemy.terrainRoll = THREE.MathUtils.clamp(Math.atan2(right - center, sideProbe), -0.42, 0.42);
  }

  private updateLegs(enemy: EnemyState, _delta: number, speedRatio: number, collapse = 0): void {
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
        const lead = (0.42 + speedRatio * 1.05) * BIONIC_SPIDER_SCALE;
        state.swingTargetWorld.addScaledVector(tempForward, lead);
        state.swingTargetWorld.y = this.terrainHeightAt(state.swingTargetWorld.x, state.swingTargetWorld.z);
      }

      if (swinging) {
        const t = smooth01(phase / SWING_FRACTION);
        state.footWorld.lerpVectors(state.swingStartWorld, state.swingTargetWorld, t);
        state.footWorld.y += Math.sin(t * Math.PI) * (0.48 + speedRatio * 0.26) * BIONIC_SPIDER_SCALE;
      } else if (state.wasSwinging) {
        state.footWorld.copy(state.swingTargetWorld);
      }
      state.wasSwinging = swinging;

      tempHipLocal.copy(rig.hipLocal);
      tempHipLocal.y -= collapse * 0.94;
      worldFootToLocal(enemy, state.footWorld, tempFootLocal);
      if (collapse > 0) {
        const curl = THREE.MathUtils.lerp(1, DEATH_CURL_SCALE, collapse);
        tempFootLocal.x *= curl;
        tempFootLocal.z *= curl;
      }
      solveTwoBoneKnee(tempHipLocal, tempFootLocal, Math.sign(rig.hipLocal.x), tempKneeLocal);
      poseBionicSpiderLeg(enemy.model, i, tempHipLocal, tempKneeLocal, tempFootLocal);
    }
  }

  private updateDeath(enemy: EnemyState, delta: number): void {
    enemy.deathTimer += delta;
    const collapse = smooth01(enemy.deathTimer / DEATH_ANIM_DURATION);
    enemy.model.root.position.y = THREE.MathUtils.lerp(enemy.model.root.position.y, enemy.groundY, Math.min(1, delta * 10));
    enemy.model.bodyRoot.position.set(0, BIONIC_SPIDER_BODY_HEIGHT - collapse * 0.95, -collapse * 0.12);
    enemy.model.bodyRoot.rotation.x = enemy.terrainPitch - collapse * 0.45;
    enemy.model.bodyRoot.rotation.z = enemy.terrainRoll + enemy.deathSide * collapse * 0.20;
    enemy.model.headRoot.rotation.x = collapse * 0.55;
    enemy.model.headRoot.rotation.y = enemy.deathSide * collapse * 0.18;
    this.updateLegs(enemy, delta, 0, collapse);
    const residualFlash = Math.max(0, 1 - enemy.deathTimer / 0.45);
    setBionicSpiderDamageVisual(enemy.model, residualFlash);
    setDeathPowerDown(enemy.model, collapse);
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

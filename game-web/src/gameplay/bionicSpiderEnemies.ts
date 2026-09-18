import * as THREE from 'three';
import { calculateWeaponDamageAtDistance } from '../weapons/weaponConfig.ts';
import {
  BIONIC_SPIDER_BODY_HEIGHT,
  BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT,
  BIONIC_SPIDER_SCALE,
  BIONIC_SPIDER_SOURCE_UNIT,
  BIONIC_SPIDER_STEP_HEIGHT,
  BIONIC_SPIDER_STEP_LENGTH,
  createBionicSpiderModel,
  disposeBionicSpiderModel,
  poseBionicSpiderLeg,
  setBionicSpiderDamageVisual,
  type BionicSpiderHitRegion,
  type BionicSpiderModel,
} from '../models/bionicSpider.ts';

export const BIONIC_SPIDER_MAX_HP = 100;
export const BIONIC_SPIDER_MOVE_SPEED = ((12 + 24) / 2) * 0.8;
export const BIONIC_SPIDER_MELEE_DAMAGE = 20;
export const BIONIC_SPIDER_MAX_ACTIVE = 5;
export const BIONIC_SPIDER_CONTACT_RADIUS = 2.15 * BIONIC_SPIDER_SCALE;
export const BIONIC_SPIDER_COLLISION_RADIUS = 2.7 * BIONIC_SPIDER_SCALE;
export const BIONIC_SPIDER_LIMB_DAMAGE_MULTIPLIER = 0.5;

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
const MOB_COLLISION_PASSES = 3;
const MOB_MIN_SEPARATION = BIONIC_SPIDER_COLLISION_RADIUS * 2;

// The supplied preview advances actionTime by 0.02/frame and multiplies it by
// 0.8 for the gait cycle. At its intended ~60 Hz that is 0.96 cycles/second.
const GAIT_HZ = 0.96;
const SWING_FRACTION = 0.35;
const DEATH_CURL_SCALE = 0.4;
const TAU = Math.PI * 2;
const DEAD_COLOR = new THREE.Color(0x111111);
const POWER_CORE_COLOR = new THREE.Color(0xff6600);
const CYAN_COLOR = new THREE.Color(0x00f3ff);
const MAGENTA_COLOR = new THREE.Color(0xff00ea);
const FOOT_ANCHOR_WORLD_HEIGHT = BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT * BIONIC_SPIDER_SCALE;

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
  targetWorld: THREE.Vector3;
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
  terrainProbeTimer: number;
  deathSide: number;
  flinchSide: number;
  legs: LegState[];
};

const tempLocalTarget = new THREE.Vector3();
const tempDesiredWorld = new THREE.Vector3();

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
  model.neonCyanMaterial.color.copy(CYAN_COLOR).lerp(DEAD_COLOR, fade);
  model.neonMagentaMaterial.color.copy(MAGENTA_COLOR).lerp(DEAD_COLOR, fade);
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
    if (region === 'limb') damage *= BIONIC_SPIDER_LIMB_DAMAGE_MULTIPLIER;
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
    const yaw = pseudoRandom(x * 0.17, z * 0.19) * TAU;
    model.root.position.set(x, groundY - emergeDepth, z);
    // The supplied asset faces -Z. Add PI only at the root so the mesh itself is
    // unchanged while gameplay yaw continues to mean "move along +Z at yaw=0".
    model.root.rotation.y = yaw + Math.PI;
    model.root.visible = this.enabled;
    this.scene.add(model.root);

    const enemy: EnemyState = {
      id,
      craterKey,
      model,
      hp: BIONIC_SPIDER_MAX_HP,
      alive: true,
      speed: 0,
      yaw,
      gaitClock: pseudoRandom(x, z),
      emergeTime: 0,
      damageTimer: 0,
      deathTimer: 0,
      attackCooldown: 0.35,
      attackTimer: 0,
      groundY,
      terrainProbeTimer: (id % 4) * 0.025,
      deathSide: id % 2 === 0 ? 1 : -1,
      flinchSide: 1,
      legs: [],
    };

    model.root.updateMatrixWorld(true);
    for (let i = 0; i < model.legs.length; i += 1) {
      const rig = model.legs[i];
      const targetWorld = model.root.localToWorld(rig.defaultTargetLocal.clone());
      targetWorld.y = this.terrainHeightAt(targetWorld.x, targetWorld.z) + FOOT_ANCHOR_WORLD_HEIGHT;
      enemy.legs.push({
        targetWorld,
        // Exact source tripod groups: A=[0,2,5,7], B=[1,3,4,6].
        phaseOffset: [0, 2, 5, 7].includes(i) ? 0 : 0.5,
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
      enemy.model.bodyRoot.position.set(0, BIONIC_SPIDER_BODY_HEIGHT, 0);
      enemy.model.bodyRoot.rotation.set(0, 0, 0);
      enemy.model.headRoot.rotation.set(0, 0, 0);
      setBionicSpiderDamageVisual(enemy.model, 0);
      this.updateLegs(enemy, delta, 0);
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

    enemy.model.root.rotation.y = enemy.yaw + Math.PI;
    const nextX = enemy.model.root.position.x + Math.sin(enemy.yaw) * enemy.speed * delta;
    const nextZ = enemy.model.root.position.z + Math.cos(enemy.yaw) * enemy.speed * delta;
    const resolvedPosition = this.resolveMobCollisionPosition(enemy, nextX, nextZ);
    enemy.model.root.position.x = resolvedPosition.x;
    enemy.model.root.position.z = resolvedPosition.z;
    enemy.model.root.position.y = THREE.MathUtils.lerp(
      enemy.model.root.position.y,
      enemy.groundY,
      Math.min(1, delta * 10),
    );

    const speedRatio = THREE.MathUtils.clamp(enemy.speed / BIONIC_SPIDER_MOVE_SPEED, 0, 1);
    enemy.gaitClock += delta * GAIT_HZ * (0.35 + speedRatio * 0.65);

    const damageFlash = enemy.damageTimer > 0 ? enemy.damageTimer / DAMAGE_ANIM_DURATION : 0;
    const damageProgress = 1 - damageFlash;
    const damageShock = damageFlash * Math.sin(damageProgress * Math.PI * 5);
    const attackPhase = enemy.attackTimer > 0 ? 1 - enemy.attackTimer / ATTACK_ANIM_DURATION : 0;
    const attackLunge = Math.sin(THREE.MathUtils.clamp(attackPhase, 0, 1) * Math.PI);

    // Source idle/walk body motion, expressed through the one global unit scale.
    const idleBreath = Math.sin(this.elapsed * 2 + enemy.id * 0.67) * 1.5 * BIONIC_SPIDER_SOURCE_UNIT * (1 - speedRatio);
    const walkBob = Math.sin(enemy.gaitClock * TAU * 2) * 1.0 * BIONIC_SPIDER_SOURCE_UNIT * speedRatio;
    const walkPitch = speedRatio * (0.05 + Math.sin(enemy.gaitClock * TAU) * 0.02);

    // The original damage state jitters the chassis, but use deterministic
    // oscillation so animation remains frame-rate stable and reproducible.
    const damageX = Math.sin(this.elapsed * 67 + enemy.id) * 3 * BIONIC_SPIDER_SOURCE_UNIT * damageFlash;
    const damageY = (-6 + Math.sin(this.elapsed * 83 + enemy.id * 0.7) * 4) * BIONIC_SPIDER_SOURCE_UNIT * damageFlash;
    const damageRoll = Math.sin(this.elapsed * 71 + enemy.id) * 0.2 * damageFlash;
    const damagePitch = (-0.2 + Math.sin(this.elapsed * 79 + enemy.id) * 0.2) * damageFlash;

    enemy.model.bodyRoot.position.set(
      damageX,
      BIONIC_SPIDER_BODY_HEIGHT + idleBreath + walkBob + damageY,
      -attackLunge * 7.2 * BIONIC_SPIDER_SOURCE_UNIT,
    );
    enemy.model.bodyRoot.rotation.x = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.x,
      (speedRatio > 0.05 ? walkPitch : Math.sin(this.elapsed + enemy.id) * 0.01) + damagePitch + damageShock * 0.03,
      Math.min(1, delta * 12),
    );
    enemy.model.bodyRoot.rotation.z = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.rotation.z,
      damageRoll + enemy.flinchSide * damageShock * 0.03,
      Math.min(1, delta * 12),
    );
    enemy.model.headRoot.rotation.set(0, 0, 0);
    setBionicSpiderDamageVisual(enemy.model, damageFlash);

    // Important: pose legs after the body transform so body.worldToLocal() sees
    // this exact frame's bob/flinch/attack pose. That is what keeps joints joined.
    this.updateLegs(enemy, delta, speedRatio);

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

  private resolveMobCollisionPosition(enemy: EnemyState, nextX: number, nextZ: number): { x: number; z: number } {
    let x = THREE.MathUtils.clamp(nextX, -WORLD_LIMIT, WORLD_LIMIT);
    let z = THREE.MathUtils.clamp(nextZ, -WORLD_LIMIT, WORLD_LIMIT);
    const minDistanceSq = MOB_MIN_SEPARATION * MOB_MIN_SEPARATION;

    for (let pass = 0; pass < MOB_COLLISION_PASSES; pass += 1) {
      let adjusted = false;
      for (const other of this.enemies.values()) {
        if (other.id === enemy.id || !other.alive) continue;
        const otherX = other.model.root.position.x;
        const otherZ = other.model.root.position.z;
        let dx = x - otherX;
        let dz = z - otherZ;
        const distanceSq = dx * dx + dz * dz;
        if (distanceSq >= minDistanceSq) continue;

        let distance = Math.sqrt(distanceSq);
        if (distance < 1e-5) {
          const angle = ((enemy.id * 53 + other.id * 97) % 360) * (Math.PI / 180);
          dx = Math.cos(angle);
          dz = Math.sin(angle);
          distance = 1;
        }
        const scale = MOB_MIN_SEPARATION / distance;
        x = THREE.MathUtils.clamp(otherX + dx * scale, -WORLD_LIMIT, WORLD_LIMIT);
        z = THREE.MathUtils.clamp(otherZ + dz * scale, -WORLD_LIMIT, WORLD_LIMIT);
        adjusted = true;
      }
      if (!adjusted) break;
    }

    return { x, z };
  }

  private probeTerrain(enemy: EnemyState): void {
    if (!this.terrainHeightAt) return;
    enemy.groundY = this.terrainHeightAt(enemy.model.root.position.x, enemy.model.root.position.z);
  }

  private updateLegs(enemy: EnemyState, delta: number, speedRatio: number, collapse = 0): void {
    if (!this.terrainHeightAt) return;

    enemy.model.root.updateMatrixWorld(true);
    const moving = speedRatio > 0.05 && collapse <= 0;
    // The source preview is stable because its body is stationary. In gameplay
    // the whole spider translates and turns at speed, so feeding the same target
    // directly into IK creates large joint deltas near full extension. Follow
    // the exact source target with a frame-rate-independent world-space follower;
    // this changes no geometry, proportions, gait frequency or target amplitude.
    const follow = 1 - Math.exp(-delta * (moving ? 8 : 12));

    for (let i = 0; i < enemy.model.legs.length; i += 1) {
      const rig = enemy.model.legs[i];
      const state = enemy.legs[i];
      tempLocalTarget.copy(rig.defaultTargetLocal);
      let liftLocal = 0;

      if (collapse > 0) {
        const curl = THREE.MathUtils.lerp(1, DEATH_CURL_SCALE, collapse);
        tempLocalTarget.x *= curl;
        tempLocalTarget.z *= curl;
      } else if (moving) {
        const phase = fract(enemy.gaitClock + state.phaseOffset);
        const amplitude = speedRatio;
        let zOffset = 0;

        if (phase < SWING_FRACTION) {
          const t = phase / SWING_FRACTION;
          zOffset = Math.cos(t * Math.PI) * (BIONIC_SPIDER_STEP_LENGTH / 2) * amplitude;
          liftLocal = Math.sin(t * Math.PI) * BIONIC_SPIDER_STEP_HEIGHT * amplitude;
        } else {
          const t = (phase - SWING_FRACTION) / (1 - SWING_FRACTION);
          zOffset = -Math.cos(t * Math.PI) * (BIONIC_SPIDER_STEP_LENGTH / 2) * amplitude;
        }

        tempLocalTarget.z += zOffset;
        tempLocalTarget.y = BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT + liftLocal;
      }

      tempDesiredWorld.copy(tempLocalTarget);
      enemy.model.root.localToWorld(tempDesiredWorld);
      tempDesiredWorld.y = this.terrainHeightAt(tempDesiredWorld.x, tempDesiredWorld.z)
        + FOOT_ANCHOR_WORLD_HEIGHT
        + liftLocal * BIONIC_SPIDER_SCALE;

      state.targetWorld.lerp(tempDesiredWorld, follow);
      poseBionicSpiderLeg(enemy.model, i, state.targetWorld);
    }
  }

  private updateDeath(enemy: EnemyState, delta: number): void {
    enemy.deathTimer += delta;
    const collapse = smooth01(enemy.deathTimer / DEATH_ANIM_DURATION);
    enemy.model.root.position.y = THREE.MathUtils.lerp(enemy.model.root.position.y, enemy.groundY, Math.min(1, delta * 10));

    // Exact supplied death pose: body drops toward source Y=14, pitches -0.45,
    // rolls +0.2, while all eight legs curl to 40% of their rest spread.
    enemy.model.bodyRoot.position.x = THREE.MathUtils.lerp(enemy.model.bodyRoot.position.x, 0, Math.min(1, delta * 8));
    enemy.model.bodyRoot.position.y = THREE.MathUtils.lerp(
      enemy.model.bodyRoot.position.y,
      14 * BIONIC_SPIDER_SOURCE_UNIT,
      Math.min(1, delta * 6),
    );
    enemy.model.bodyRoot.position.z = THREE.MathUtils.lerp(enemy.model.bodyRoot.position.z, 0, Math.min(1, delta * 8));
    enemy.model.bodyRoot.rotation.x = THREE.MathUtils.lerp(enemy.model.bodyRoot.rotation.x, -0.45, Math.min(1, delta * 6));
    enemy.model.bodyRoot.rotation.z = THREE.MathUtils.lerp(enemy.model.bodyRoot.rotation.z, 0.2, Math.min(1, delta * 6));
    enemy.model.headRoot.rotation.set(0, 0, 0);

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

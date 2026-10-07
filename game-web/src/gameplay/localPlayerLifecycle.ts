import * as THREE from 'three';
import { inputState, resetInputState } from '../controls/playerInput.ts';
import { healthHud } from '../ui/healthHud.ts';
import { shieldVfxController } from '../vfx/shieldVfx.ts';

const DEATH_PHASE_SECONDS = 5;
const SPAWN_SHIELD_SECONDS = 10;
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0);

export interface LocalPlayerLifecycleState {
  height: number;
  position: THREE.Vector3;
  velocity: THREE.Vector3;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  isInvulnerable: boolean;
  shieldExpiresAt: number;
  deathTimer: number;
}

export interface AuthoritativeLocalLifecycleState {
  hp: number;
  isAlive: boolean;
  isShielded: boolean;
  timerRemainingMs: number;
}

export interface LocalPlayerLifecycleOptions {
  player: LocalPlayerLifecycleState;
  shieldAnchor: THREE.Group;
  viewmodelRoot: THREE.Group;
  placeAtSpawn: () => void;
  resetRecoil: () => void;
}

/**
 * Sole browser owner for local HP/death/respawn/spawn-shield transitions.
 * Engine/network code may request or synchronize transitions, but must not
 * duplicate the lifecycle state machine or its HUD/VFX side effects.
 */
export class LocalPlayerLifecycleController {
  private readonly player: LocalPlayerLifecycleState;
  private readonly shieldAnchor: THREE.Group;
  private readonly viewmodelRoot: THREE.Group;
  private readonly placeAtSpawn: () => void;
  private readonly resetRecoil: () => void;
  private readonly deathCameraPosition = new THREE.Vector3();
  private deathCameraYaw = 0;
  private readonly deathCameraPitch = -0.35;

  constructor(options: LocalPlayerLifecycleOptions) {
    this.player = options.player;
    this.shieldAnchor = options.shieldAnchor;
    this.viewmodelRoot = options.viewmodelRoot;
    this.placeAtSpawn = options.placeAtSpawn;
    this.resetRecoil = options.resetRecoil;
  }

  public initialize(now = performance.now()): void {
    this.player.isAlive = true;
    this.player.hp = this.player.maxHp;
    this.player.deathTimer = 0;
    this.activateShield(SPAWN_SHIELD_SECONDS, now);
    healthHud.updateHealth(this.player.hp, this.player.maxHp);
  }

  public handleDeath(): void {
    if (!this.player.isAlive && this.player.deathTimer > 0) return;

    this.player.isAlive = false;
    this.player.hp = 0;
    this.player.deathTimer = DEATH_PHASE_SECONDS;
    this.deactivateShield();

    resetInputState();
    this.viewmodelRoot.visible = false;
    this.deathCameraPosition.set(
      this.player.position.x,
      this.player.position.y + 2.5,
      this.player.position.z,
    );
    this.deathCameraYaw = inputState.yaw;
    healthHud.showDeathOverlay(DEATH_PHASE_SECONDS);
    healthHud.updateHealth(0, this.player.maxHp);
  }

  public handleRespawn(now = performance.now()): void {
    this.player.isAlive = true;
    this.player.hp = this.player.maxHp;
    this.player.deathTimer = 0;
    this.placeAtSpawn();
    this.viewmodelRoot.visible = true;
    inputState.pitch = 0;
    this.resetRecoil();

    healthHud.hideDeathOverlay();
    healthHud.updateHealth(this.player.hp, this.player.maxHp);
    this.activateShield(SPAWN_SHIELD_SECONDS, now);
  }

  public handleDamage(newHp: number): void {
    if (!this.player.isAlive) return;
    this.player.hp = Math.max(0, Math.min(this.player.maxHp, newHp));
    healthHud.updateHealth(this.player.hp, this.player.maxHp);
    if (this.player.hp <= 0) this.handleDeath();
  }

  public applyAuthoritativeState(
    state: AuthoritativeLocalLifecycleState,
    now = performance.now(),
  ): void {
    if (!state.isAlive && this.player.isAlive) {
      this.handleDeath();
    } else if (state.isAlive && !this.player.isAlive) {
      this.handleRespawn(now);
    }

    this.player.hp = Math.max(0, Math.min(this.player.maxHp, state.hp));
    healthHud.updateHealth(this.player.hp, this.player.maxHp);

    if (!state.isAlive || !state.isShielded) {
      this.deactivateShield();
      return;
    }

    const remainingSeconds = Math.max(0, state.timerRemainingMs) / 1000;
    this.player.isInvulnerable = true;
    this.player.shieldExpiresAt = now + Math.max(0, state.timerRemainingMs);
    if (!shieldVfxController.hasShield(this.shieldAnchor)) {
      shieldVfxController.attachShield(
        this.shieldAnchor,
        Math.max(0.1, remainingSeconds),
        ZERO_VECTOR,
      );
    }
    healthHud.updateShield(remainingSeconds);
  }

  public update(
    deltaSeconds: number,
    camera: THREE.Camera,
    allowLocalRespawn: boolean,
    now = performance.now(),
  ): void {
    if (this.player.isAlive) {
      this.shieldAnchor.position.set(
        this.player.position.x,
        this.player.position.y - this.player.height + 0.9,
        this.player.position.z,
      );

      if (this.player.shieldExpiresAt > now) {
        this.player.isInvulnerable = true;
        healthHud.updateShield((this.player.shieldExpiresAt - now) / 1000);
      } else if (this.player.isInvulnerable) {
        this.deactivateShield();
      }
      return;
    }

    this.player.deathTimer = Math.max(0, this.player.deathTimer - deltaSeconds);
    healthHud.updateDeathCountdown(this.player.deathTimer);
    camera.position.copy(this.deathCameraPosition);
    camera.rotation.set(this.deathCameraPitch, this.deathCameraYaw, 0, 'YXZ');

    if (this.player.deathTimer <= 0 && allowLocalRespawn) {
      this.handleRespawn(now);
    }
  }

  private activateShield(durationSeconds: number, now: number): void {
    this.player.isInvulnerable = true;
    this.player.shieldExpiresAt = now + durationSeconds * 1000;
    if (shieldVfxController.hasShield(this.shieldAnchor)) {
      shieldVfxController.detachShield(this.shieldAnchor);
    }
    shieldVfxController.attachShield(this.shieldAnchor, durationSeconds, ZERO_VECTOR);
    healthHud.updateShield(durationSeconds);
  }

  private deactivateShield(): void {
    this.player.isInvulnerable = false;
    this.player.shieldExpiresAt = 0;
    healthHud.updateShield(0);
    if (shieldVfxController.hasShield(this.shieldAnchor)) {
      shieldVfxController.detachShield(this.shieldAnchor);
    }
  }
}

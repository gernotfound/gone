/**
 * Dynamic Muzzle Flash for G.O.N.E. FPS
 * Milestone 3 (F-10, R3): Instant PointLight + billboard star mesh with 0.05s decay.
 *
 * Strictly zero per-shot allocations (zero new PointLight / Mesh / Material in runtime).
 */

import * as THREE from 'three';
import { normalizeWeaponType } from './tracerPool.ts';

export interface MuzzleFlashConfig {
  color: number;
  peakIntensity: number;
  distance: number;
  decay: number;
  duration: number;
  starSize: number;
}

export const MUZZLE_FLASH_CONFIGS: Record<string, MuzzleFlashConfig> = {
  assalto: {
    color: 0x00F0FF,
    peakIntensity: 8.0,
    distance: 12.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.35,
  },
  cecchino: {
    color: 0xBD00FF,
    peakIntensity: 10.0,
    distance: 15.0,
    decay: 2.0,
    duration: 0.06,
    starSize: 0.45,
  },
  pompa: {
    color: 0xFF5F00,
    peakIntensity: 9.0,
    distance: 13.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.40,
  },
  mitraglietta: {
    color: 0xFFE600,
    peakIntensity: 7.0,
    distance: 10.0,
    decay: 2.0,
    duration: 0.04,
    starSize: 0.30,
  },
  coltello: {
    color: 0x00FFFF,
    peakIntensity: 4.0,
    distance: 6.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.25,
  },
};

export class MuzzleFlashController {
  private group: THREE.Group;
  private light: THREE.PointLight;
  private mesh: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial>;
  private geometry: THREE.PlaneGeometry;
  private material: THREE.MeshBasicMaterial;

  private active = false;
  private timer = 0;
  private currentDuration = 0.05;
  private peakIntensity = 8.0;
  private baseSize = 0.35;
  private isInitialized = false;

  private followedAnchor: THREE.Object3D | null = null;
  private readonly followedLocalPosition = new THREE.Vector3();
  private readonly followedWorldPosition = new THREE.Vector3();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'MuzzleFlashGroup';

    this.light = new THREE.PointLight(0x00F0FF, 0, 12.0, 2.0);
    this.light.name = 'MuzzleFlashLight';
    this.light.visible = false;
    this.group.add(this.light);

    this.geometry = new THREE.PlaneGeometry(0.35, 0.35);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x00F0FF,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'MuzzleFlashBillboard';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  public init(scene: THREE.Scene): void {
    if (!this.isInitialized) {
      scene.add(this.group);
      this.isInitialized = true;
    }
  }

  private activateAt(position: THREE.Vector3, weaponType: string): void {
    const canonical = normalizeWeaponType(weaponType);
    const config = MUZZLE_FLASH_CONFIGS[canonical] ?? MUZZLE_FLASH_CONFIGS.assalto;

    this.currentDuration = config.duration;
    this.timer = config.duration;
    this.peakIntensity = config.peakIntensity;
    this.baseSize = config.starSize;
    this.active = true;

    this.light.position.copy(position);
    this.light.color.setHex(config.color);
    this.light.distance = config.distance;
    this.light.decay = config.decay;
    this.light.intensity = config.peakIntensity;
    this.light.visible = true;

    this.mesh.position.copy(position);
    this.mesh.rotation.z = Math.random() * Math.PI * 2;
    this.mesh.scale.set(this.baseSize / 0.35, this.baseSize / 0.35, 1);
    this.material.color.setHex(config.color);
    this.material.opacity = 1.0;
    this.mesh.visible = true;
  }

  private syncFollowedAnchor(): void {
    if (!this.followedAnchor) return;
    this.followedAnchor.updateMatrixWorld(true);
    this.followedWorldPosition
      .copy(this.followedLocalPosition)
      .applyMatrix4(this.followedAnchor.matrixWorld);
    this.light.position.copy(this.followedWorldPosition);
    this.mesh.position.copy(this.followedWorldPosition);
  }

  /** Static/world-space flash, used for remote weapons and compatibility callers. */
  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {
    this.followedAnchor = null;
    this.activateAt(muzzleWorldPos, weaponType);
  }

  /**
   * Local first-person flash. The effect stays on the authored muzzle socket for
   * its complete lifetime while recoil, bob, ADS and camera movement continue.
   */
  public spawnAnchoredMuzzleFlash(
    anchor: THREE.Object3D,
    localMuzzlePosition: THREE.Vector3,
    weaponType: string,
  ): void {
    this.followedAnchor = anchor;
    this.followedLocalPosition.copy(localMuzzlePosition);
    this.syncFollowedAnchor();
    this.activateAt(this.followedWorldPosition, weaponType);
  }

  public update(delta: number, camera?: THREE.Camera | null): void {
    if (!this.active) return;

    this.syncFollowedAnchor();
    this.timer -= delta;

    if (this.timer <= 0) {
      this.active = false;
      this.followedAnchor = null;
      this.light.visible = false;
      this.light.intensity = 0;
      this.mesh.visible = false;
      this.material.opacity = 0;
      return;
    }

    const progress = 1.0 - (this.timer / this.currentDuration);
    const fade = Math.max(0, 1.0 - progress);
    this.light.intensity = this.peakIntensity * fade;
    this.material.opacity = fade;

    const currentScale = (this.baseSize / 0.35) * (0.8 + 0.4 * fade);
    this.mesh.scale.set(currentScale, currentScale, 1);

    if (camera) this.mesh.quaternion.copy(camera.quaternion);
  }

  public isActive(): boolean {
    return this.active;
  }

  public getRemainingTime(): number {
    return Math.max(0, this.timer);
  }

  public getLight(): THREE.PointLight {
    return this.light;
  }

  public getMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    return this.mesh;
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

  public dispose(): void {
    this.followedAnchor = null;
    if (this.group.parent) this.group.parent.remove(this.group);
    this.geometry.dispose();
    this.material.dispose();
    this.isInitialized = false;
  }
}

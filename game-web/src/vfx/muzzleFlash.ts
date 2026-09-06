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
    color: 0x00F0FF, // Cyan
    peakIntensity: 8.0,
    distance: 12.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.35
  },
  cecchino: {
    color: 0xBD00FF, // Magenta
    peakIntensity: 10.0,
    distance: 15.0,
    decay: 2.0,
    duration: 0.06,
    starSize: 0.45
  },
  pompa: {
    color: 0xFF5F00, // Orange
    peakIntensity: 9.0,
    distance: 13.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.40
  },
  mitraglietta: {
    color: 0xFFE600, // Yellow
    peakIntensity: 7.0,
    distance: 10.0,
    decay: 2.0,
    duration: 0.04,
    starSize: 0.30
  },
  coltello: {
    color: 0x00FFFF, // Ice Cyan
    peakIntensity: 4.0,
    distance: 6.0,
    decay: 2.0,
    duration: 0.05,
    starSize: 0.25
  }
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

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'MuzzleFlashGroup';

    // Single pre-allocated dynamic point light
    this.light = new THREE.PointLight(0x00F0FF, 0, 12.0, 2.0);
    this.light.name = 'MuzzleFlashLight';
    this.light.visible = false;
    this.group.add(this.light);

    // Single pre-allocated billboard star mesh
    this.geometry = new THREE.PlaneGeometry(0.35, 0.35);
    this.material = new THREE.MeshBasicMaterial({
      color: 0x00F0FF,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
      side: THREE.DoubleSide
    });

    this.mesh = new THREE.Mesh(this.geometry, this.material);
    this.mesh.name = 'MuzzleFlashBillboard';
    this.mesh.visible = false;
    this.mesh.frustumCulled = false;
    this.group.add(this.mesh);
  }

  /**
   * Attaches the pre-allocated muzzle flash group to the scene.
   */
  public init(scene: THREE.Scene): void {
    if (!this.isInitialized) {
      scene.add(this.group);
      this.isInitialized = true;
    }
  }

  /**
   * Triggers an instant muzzle flash at the given world position matching the weapon's neon color.
   * Decays over 0.05s. Strictly 0 heap allocations during invocation.
   */
  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {
    const canonical = normalizeWeaponType(weaponType);
    const config = MUZZLE_FLASH_CONFIGS[canonical] ?? MUZZLE_FLASH_CONFIGS.assalto;

    this.currentDuration = config.duration;
    this.timer = config.duration;
    this.peakIntensity = config.peakIntensity;
    this.baseSize = config.starSize;
    this.active = true;

    // Position light and billboard directly at the weapon muzzle
    this.light.position.copy(muzzleWorldPos);
    this.light.color.setHex(config.color);
    this.light.distance = config.distance;
    this.light.decay = config.decay;
    this.light.intensity = config.peakIntensity;
    this.light.visible = true;

    this.mesh.position.copy(muzzleWorldPos);
    this.mesh.rotation.z = Math.random() * Math.PI * 2;
    this.mesh.scale.set(this.baseSize / 0.35, this.baseSize / 0.35, 1);
    this.material.color.setHex(config.color);
    this.material.opacity = 1.0;
    this.mesh.visible = true;
  }

  /**
   * Updates muzzle flash decay. Deactivates light and mesh when timer reaches zero.
   */
  public update(delta: number, camera?: THREE.Camera | null): void {
    if (!this.active) return;

    this.timer -= delta;

    if (this.timer <= 0) {
      this.active = false;
      this.light.visible = false;
      this.light.intensity = 0;
      this.mesh.visible = false;
      this.material.opacity = 0;
    } else {
      const progress = 1.0 - (this.timer / this.currentDuration); // 0.0 -> 1.0
      const fade = Math.max(0, 1.0 - progress);

      // Light intensity decay
      this.light.intensity = this.peakIntensity * fade;

      // Mesh opacity and scale decay
      this.material.opacity = fade;
      const currentScale = (this.baseSize / 0.35) * (0.8 + 0.4 * fade);
      this.mesh.scale.set(currentScale, currentScale, 1);

      // Billboard orientation facing camera
      if (camera) {
        this.mesh.quaternion.copy(camera.quaternion);
      }
    }
  }

  /** Whether the muzzle flash is currently active */
  public isActive(): boolean {
    return this.active;
  }

  /** Current remaining time of the active flash */
  public getRemainingTime(): number {
    return Math.max(0, this.timer);
  }

  /** Reference to the pre-allocated PointLight */
  public getLight(): THREE.PointLight {
    return this.light;
  }

  /** Reference to the pre-allocated billboard Mesh */
  public getMesh(): THREE.Mesh<THREE.PlaneGeometry, THREE.MeshBasicMaterial> {
    return this.mesh;
  }

  /** Reference to root Group */
  public getGroup(): THREE.Group {
    return this.group;
  }

  /** Cleanup resources */
  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.geometry.dispose();
    this.material.dispose();
    this.isInitialized = false;
  }
}

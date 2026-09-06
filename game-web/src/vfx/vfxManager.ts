/**
 * Central VFX Coordinator for G.O.N.E. FPS
 * Milestone 3 (F-8, F-9, F-10, F-11): Coordinates hitscan visual tracers, muzzle flash & instanced particles.
 * 
 * Adheres strictly to the VFXManager interface contract from PROJECT.md.
 */

import * as THREE from 'three';
import { TracerPool } from './tracerPool.ts';
import { MuzzleFlashController } from './muzzleFlash.ts';
import { ImpactParticleSystem } from './impactParticles.ts';

export interface VFXManager {
  init(scene: THREE.Scene, camera: THREE.Camera): void;
  spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string): void;
  spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void;
  spawnImpact(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, weaponType: string): void;
  update(delta: number): void;
}

export interface OnFireVFXParams {
  muzzlePos: THREE.Vector3;
  hitPoint: THREE.Vector3;
  hitNormal?: THREE.Vector3 | null;
  weaponType: string;
}

export class VFXCoordinator implements VFXManager {
  private tracerPool: TracerPool;
  private muzzleFlash: MuzzleFlashController;
  private impactParticles: ImpactParticleSystem;

  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private isInitialized = false;

  constructor() {
    this.tracerPool = new TracerPool();
    this.muzzleFlash = new MuzzleFlashController();
    this.impactParticles = new ImpactParticleSystem();
  }

  /**
   * Initializes the VFX coordinator by attaching all pooled visual components
   * to the Three.js scene graph.
   */
  public init(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;

    this.tracerPool.init(scene);
    this.muzzleFlash.init(scene);
    this.impactParticles.init(scene);

    this.isInitialized = true;
  }

  /**
   * Spawns a volumetric laser tracer cylinder from start to end.
   */
  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string): void {
    this.tracerPool.spawnTracer(start, end, weaponType);
  }

  /**
   * Spawns an instantaneous dynamic PointLight and billboard star flash at muzzle.
   */
  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {
    this.muzzleFlash.spawnMuzzleFlash(muzzleWorldPos, weaponType);
  }

  /**
   * Spawns instanced spark/smoke particles on impact normal.
   */
  public spawnImpact(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, weaponType: string): void {
    this.impactParticles.spawnImpact(hitPos, hitNormal, weaponType);
  }

  /**
   * Unified trigger for weapon fire events: spawns muzzle flash, tracer,
   * and impact particles (if hitNormal is provided).
   */
  public onFire(params: OnFireVFXParams): void {
    this.spawnMuzzleFlash(params.muzzlePos, params.weaponType);
    this.spawnTracer(params.muzzlePos, params.hitPoint, params.weaponType);
    if (params.hitNormal) {
      this.spawnImpact(params.hitPoint, params.hitNormal, params.weaponType);
    }
  }

  /**
   * Updates all active VFX each frame: decays tracers, muzzle flash, and impact particles.
   */
  public update(delta: number): void {
    this.tracerPool.update(delta);
    this.muzzleFlash.update(delta, this.camera);
    this.impactParticles.update(delta);
  }

  /** Read-only accessors for subsystem verification and testing */
  public getTracerPool(): TracerPool {
    return this.tracerPool;
  }

  public getMuzzleFlash(): MuzzleFlashController {
    return this.muzzleFlash;
  }

  public getImpactParticles(): ImpactParticleSystem {
    return this.impactParticles;
  }

  public getActiveTracerCount(): number {
    return this.tracerPool.getActiveCount();
  }

  public getActiveParticleCount(): number {
    return this.impactParticles.getActiveCount();
  }

  public isMuzzleFlashActive(): boolean {
    return this.muzzleFlash.isActive();
  }

  public getScene(): THREE.Scene | null {
    return this.scene;
  }

  public getCamera(): THREE.Camera | null {
    return this.camera;
  }

  public isReady(): boolean {
    return this.isInitialized;
  }

  /** Disposes all geometries, materials, and detach from scene */
  public dispose(): void {
    this.tracerPool.dispose();
    this.muzzleFlash.dispose();
    this.impactParticles.dispose();
    this.scene = null;
    this.camera = null;
    this.isInitialized = false;
  }
}

/** Global singleton instance */
export const vfxManager = new VFXCoordinator();
export default vfxManager;

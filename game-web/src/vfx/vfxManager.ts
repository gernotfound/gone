/**
 * Central VFX Coordinator for G.O.N.E. FPS
 * Milestone 3 (F-8, F-9, F-10, F-11): Coordinates hitscan visual tracers, muzzle flash & instanced particles.
 */

import * as THREE from 'three';
import { TracerPool } from './tracerPool.ts';
import { MuzzleFlashController } from './muzzleFlash.ts';
import { ImpactParticleSystem } from './impactParticles.ts';

export interface LocalMuzzleAnchor {
  anchor: THREE.Object3D;
  localPosition: THREE.Vector3;
  worldPosition: THREE.Vector3;
}

export type LocalMuzzleAnchorResolver = (weaponType: string) => LocalMuzzleAnchor | null;

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

const LOCAL_MUZZLE_MATCH_TOLERANCE_SQ = 0.05 * 0.05;

export class VFXCoordinator implements VFXManager {
  private tracerPool: TracerPool;
  private muzzleFlash: MuzzleFlashController;
  private impactParticles: ImpactParticleSystem;

  private scene: THREE.Scene | null = null;
  private camera: THREE.Camera | null = null;
  private localMuzzleAnchorResolver: LocalMuzzleAnchorResolver | null = null;
  private isInitialized = false;

  constructor() {
    this.tracerPool = new TracerPool();
    this.muzzleFlash = new MuzzleFlashController();
    this.impactParticles = new ImpactParticleSystem();
  }

  public init(scene: THREE.Scene, camera: THREE.Camera): void {
    this.scene = scene;
    this.camera = camera;

    this.tracerPool.init(scene);
    this.muzzleFlash.init(scene);
    this.impactParticles.init(scene);

    this.isInitialized = true;
  }

  /**
   * Registers the local first-person muzzle owner. Existing callers can keep
   * passing the shot-time world position; when it matches this resolver the
   * flash follows the weapon socket instead of freezing on the tracer line.
   */
  public setLocalMuzzleAnchorResolver(resolver: LocalMuzzleAnchorResolver | null): void {
    this.localMuzzleAnchorResolver = resolver;
  }

  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string): void {
    this.tracerPool.spawnTracer(start, end, weaponType);
  }

  public spawnMuzzleFlash(muzzleWorldPos: THREE.Vector3, weaponType: string): void {
    const localMuzzle = this.localMuzzleAnchorResolver?.(weaponType) ?? null;
    if (
      localMuzzle
      && localMuzzle.worldPosition.distanceToSquared(muzzleWorldPos) <= LOCAL_MUZZLE_MATCH_TOLERANCE_SQ
    ) {
      this.muzzleFlash.spawnAnchoredMuzzleFlash(
        localMuzzle.anchor,
        localMuzzle.localPosition,
        weaponType,
      );
      return;
    }

    this.muzzleFlash.spawnMuzzleFlash(muzzleWorldPos, weaponType);
  }

  public spawnImpact(hitPos: THREE.Vector3, hitNormal: THREE.Vector3, weaponType: string): void {
    this.impactParticles.spawnImpact(hitPos, hitNormal, weaponType);
  }

  public onFire(params: OnFireVFXParams): void {
    this.spawnMuzzleFlash(params.muzzlePos, params.weaponType);
    this.spawnTracer(params.muzzlePos, params.hitPoint, params.weaponType);
    if (params.hitNormal) this.spawnImpact(params.hitPoint, params.hitNormal, params.weaponType);
  }

  public update(delta: number): void {
    this.tracerPool.update(delta);
    this.muzzleFlash.update(delta, this.camera);
    this.impactParticles.update(delta);
  }

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

  public dispose(): void {
    this.tracerPool.dispose();
    this.muzzleFlash.dispose();
    this.impactParticles.dispose();
    this.localMuzzleAnchorResolver = null;
    this.scene = null;
    this.camera = null;
    this.isInitialized = false;
  }
}

export const vfxManager = new VFXCoordinator();
export default vfxManager;

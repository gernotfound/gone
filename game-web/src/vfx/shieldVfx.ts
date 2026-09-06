/**
 * game-web/src/vfx/shieldVfx.ts
 *
 * 3D Cyan Invulnerability Shield VFX Controller
 *
 * Implements:
 * - THREE.SphereGeometry(1.85, 32, 32)
 * - Color 0x00F0FF (#00F0FF Neon Cyan)
 * - Opacity: 0.28, AdditiveBlending, transparent: true, depthWrite: false
 * - Subtle sinusoidal energy pulse (scale & opacity modulation)
 * - Support for attaching to local player anchor or remote player models
 * - Deterministic creation and automatic disposal/destruction after 10.0 seconds
 */

import * as THREE from 'three';

export interface ShieldVFXOptions {
  radius?: number;
  widthSegments?: number;
  heightSegments?: number;
  color?: number;
  emissive?: number;
  baseOpacity?: number;
  durationSeconds?: number;
  pulseSpeed?: number;
  pulseScaleAmplitude?: number;
  pulseOpacityAmplitude?: number;
}

export interface ShieldInstance {
  id: string;
  mesh: THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial>;
  geometry: THREE.SphereGeometry;
  material: THREE.MeshStandardMaterial;
  target: THREE.Object3D;
  remainingTime: number;
  elapsedTime: number;
  duration: number;
  baseOpacity: number;
  disposed: boolean;
}

export class ShieldVFXController {
  private activeShields = new Map<THREE.Object3D, ShieldInstance>();
  private defaultDuration: number = 10.0;
  private defaultRadius: number = 1.85;
  private defaultColor: number = 0x00f0ff;
  private defaultOpacity: number = 0.28;

  constructor(options?: ShieldVFXOptions) {
    if (options?.durationSeconds !== undefined) this.defaultDuration = options.durationSeconds;
    if (options?.radius !== undefined) this.defaultRadius = options.radius;
    if (options?.color !== undefined) this.defaultColor = options.color;
    if (options?.baseOpacity !== undefined) this.defaultOpacity = options.baseOpacity;
  }

  /**
   * Factory function to create a pristine 3D cyan sphere shield mesh.
   */
  public createShieldMesh(options?: ShieldVFXOptions): THREE.Mesh<THREE.SphereGeometry, THREE.MeshStandardMaterial> {
    const radius = options?.radius ?? this.defaultRadius;
    const segments = options?.widthSegments ?? 32;
    const color = options?.color ?? this.defaultColor;
    const opacity = options?.baseOpacity ?? this.defaultOpacity;

    const geometry = new THREE.SphereGeometry(radius, segments, segments);
    const material = new THREE.MeshStandardMaterial({
      color,
      emissive: options?.emissive ?? color,
      emissiveIntensity: 0.8,
      roughness: 0.1,
      metalness: 0.9,
      transparent: true,
      opacity,
      depthWrite: false,
      side: THREE.DoubleSide,
      blending: THREE.AdditiveBlending,
      wireframe: false,
    });

    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'InvulnerabilityShieldSphere';
    return mesh;
  }

  /**
   * Attaches a 10-second invulnerability shield sphere to the target Object3D.
   * If a shield is already active on this target, refreshes its remaining timer to 10s.
   */
  public attachShield(
    target: THREE.Object3D,
    durationSeconds: number = this.defaultDuration,
    offset: THREE.Vector3 = new THREE.Vector3(0, 0.9, 0),
    options?: ShieldVFXOptions
  ): ShieldInstance {
    // If target already has an active shield, refresh it
    const existing = this.activeShields.get(target);
    if (existing && !existing.disposed) {
      existing.remainingTime = durationSeconds;
      existing.duration = durationSeconds;
      existing.elapsedTime = 0;
      existing.mesh.visible = true;
      return existing;
    }

    const mesh = this.createShieldMesh(options);
    mesh.position.copy(offset);
    target.add(mesh);

    const instanceId = `shield_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
    const instance: ShieldInstance = {
      id: instanceId,
      mesh,
      geometry: mesh.geometry,
      material: mesh.material,
      target,
      remainingTime: durationSeconds,
      elapsedTime: 0,
      duration: durationSeconds,
      baseOpacity: options?.baseOpacity ?? this.defaultOpacity,
      disposed: false,
    };

    this.activeShields.set(target, instance);
    return instance;
  }

  /**
   * Detaches and disposes the shield on the given target Object3D.
   */
  public detachShield(target: THREE.Object3D): void {
    const instance = this.activeShields.get(target);
    if (instance) {
      this.disposeInstance(instance);
      this.activeShields.delete(target);
    }
  }

  /**
   * Checks whether the target Object3D currently has an active, non-expired shield.
   */
  public hasShield(target: THREE.Object3D): boolean {
    const instance = this.activeShields.get(target);
    return !!instance && !instance.disposed && instance.remainingTime > 0;
  }

  /**
   * Gets the shield instance for a target if active.
   */
  public getShield(target: THREE.Object3D): ShieldInstance | undefined {
    return this.activeShields.get(target);
  }

  /**
   * Per-frame update loop: advances timers, applies subtle energy pulsation,
   * and disposes expired shields when remainingTime reaches 0.
   */
  public update(delta: number): void {
    if (delta <= 0) return;

    for (const [target, instance] of this.activeShields.entries()) {
      instance.remainingTime -= delta;
      instance.elapsedTime += delta;

      if (instance.remainingTime <= 0) {
        // Deterministic 10.0s expiration: remove from scene & dispose GPU resources
        this.disposeInstance(instance);
        this.activeShields.delete(target);
      } else {
        // Subtle energy pulse: sinusoidal breathing on scale and opacity
        const t = instance.elapsedTime;
        const scalePulse = 1.0 + 0.025 * Math.sin(6.0 * t);
        instance.mesh.scale.set(scalePulse, scalePulse, scalePulse);

        const opacityPulse = instance.baseOpacity + 0.05 * Math.sin(8.0 * t);
        instance.material.opacity = Math.max(0.1, Math.min(0.6, opacityPulse));
      }
    }
  }

  /**
   * Cleans up GPU memory and removes mesh from scene graph.
   */
  private disposeInstance(instance: ShieldInstance): void {
    if (instance.disposed) return;
    instance.disposed = true;

    if (instance.mesh.parent) {
      instance.mesh.parent.remove(instance.mesh);
    }

    try {
      instance.geometry.dispose();
      instance.material.dispose();
    } catch {
      // Ignore in headless / mock environments
    }
  }

  /**
   * Total number of currently active shields.
   */
  public getActiveCount(): number {
    return this.activeShields.size;
  }

  /**
   * Returns all currently active shield instances.
   */
  public getAllInstances(): ShieldInstance[] {
    return Array.from(this.activeShields.values());
  }

  /**
   * Disposes all active shields immediately.
   */
  public disposeAll(): void {
    for (const instance of this.activeShields.values()) {
      this.disposeInstance(instance);
    }
    this.activeShields.clear();
  }
}

export const shieldVfxController = new ShieldVFXController();

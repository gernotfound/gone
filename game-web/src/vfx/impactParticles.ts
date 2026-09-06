/**
 * Instanced Impact Particles for G.O.N.E. FPS
 * Milestone 3 (F-11, R3): 400-instance ring buffer rendered in exactly ONE draw call.
 * 
 * Ejects sparks/smoke along surface normal cone with gravity (-15 m/s²) and 0.2s - 0.4s lifetime.
 * Strictly zero garbage collection churn or geometry accumulation during sustained rapid fire.
 */

import * as THREE from 'three';
import { normalizeWeaponType } from './tracerPool.ts';

export interface ImpactParticleState {
  index: number;
  active: boolean;
  pos: THREE.Vector3;
  vel: THREE.Vector3;
  age: number;
  life: number;
  initialSize: number;
  color: THREE.Color;
}

export class ImpactParticleSystem {
  public static readonly MAX_PARTICLES = 400;
  public static readonly GRAVITY = -15.0; // m/s²
  public static readonly DEFAULT_BURST_COUNT = 12;

  private instancedMesh: THREE.InstancedMesh<THREE.TetrahedronGeometry, THREE.MeshBasicMaterial>;
  private geometry: THREE.TetrahedronGeometry;
  private material: THREE.MeshBasicMaterial;

  private particles: ImpactParticleState[] = [];
  private ringPointer = 0;
  private isInitialized = false;

  // Pre-allocated scratch objects to guarantee zero runtime heap allocations
  private readonly _dummy = new THREE.Object3D();
  private readonly _tempNormal = new THREE.Vector3();
  private readonly _tangent = new THREE.Vector3();
  private readonly _bitangent = new THREE.Vector3();
  private readonly _coneDir = new THREE.Vector3();
  private readonly _color = new THREE.Color();
  private readonly _UP = new THREE.Vector3(0, 1, 0);
  private readonly _RIGHT = new THREE.Vector3(1, 0, 0);

  constructor() {
    // Shared unit tetrahedron geometry (lightweight 4 vertices / 4 faces)
    this.geometry = new THREE.TetrahedronGeometry(0.06, 0);
    this.material = new THREE.MeshBasicMaterial({
      color: 0xffffff,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false
    });

    // Single draw call for all 400 particles
    this.instancedMesh = new THREE.InstancedMesh(this.geometry, this.material, ImpactParticleSystem.MAX_PARTICLES);
    this.instancedMesh.name = 'ImpactParticlesInstancedMesh';
    this.instancedMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.instancedMesh.frustumCulled = false;

    // Allocate instance color buffer for per-particle neon tints
    this.instancedMesh.instanceColor = new THREE.InstancedBufferAttribute(
      new Float32Array(ImpactParticleSystem.MAX_PARTICLES * 3),
      3
    );
    this.instancedMesh.instanceColor.setUsage(THREE.DynamicDrawUsage);

    // Pre-allocate ring buffer particle records & park them off-screen
    this._dummy.position.set(0, -99999, 0);
    this._dummy.scale.set(0, 0, 0);
    this._dummy.updateMatrix();
    this._color.setRGB(1, 1, 1);

    for (let i = 0; i < ImpactParticleSystem.MAX_PARTICLES; i++) {
      this.particles.push({
        index: i,
        active: false,
        pos: new THREE.Vector3(0, -99999, 0),
        vel: new THREE.Vector3(),
        age: 0,
        life: 0.3,
        initialSize: 0.06,
        color: new THREE.Color(1, 1, 1)
      });

      this.instancedMesh.setMatrixAt(i, this._dummy.matrix);
      this.instancedMesh.setColorAt(i, this._color);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Attaches the instanced mesh directly to the scene (1 draw call).
   */
  public init(scene: THREE.Scene): void {
    if (!this.isInitialized) {
      scene.add(this.instancedMesh);
      this.isInitialized = true;
    }
  }

  /**
   * Spawns a burst of spark particles ejected along the surface normal cone.
   * Advances ring buffer pointer, overwriting oldest particles when wrapping.
   * Strictly 0 heap allocations during invocation.
   */
  public spawnImpact(
    hitPos: THREE.Vector3,
    hitNormal: THREE.Vector3,
    weaponType: string,
    burstCount = ImpactParticleSystem.DEFAULT_BURST_COUNT
  ): void {
    const canonical = normalizeWeaponType(weaponType);

    // Select weapon neon spark tint
    let baseHex = 0x00F0FF;
    if (canonical === 'cecchino') baseHex = 0xBD00FF;
    else if (canonical === 'pompa') baseHex = 0xFF5F00;
    else if (canonical === 'mitraglietta') baseHex = 0xFFE600;
    else if (canonical === 'coltello') baseHex = 0x00FFFF;

    // Compute surface normal and orthogonal tangent space
    this._tempNormal.copy(hitNormal);
    if (this._tempNormal.lengthSq() < 0.001) {
      this._tempNormal.set(0, 1, 0);
    } else {
      this._tempNormal.normalize();
    }

    if (Math.abs(this._tempNormal.y) < 0.85) {
      this._tangent.crossVectors(this._tempNormal, this._UP).normalize();
    } else {
      this._tangent.crossVectors(this._tempNormal, this._RIGHT).normalize();
    }
    this._bitangent.crossVectors(this._tempNormal, this._tangent).normalize();

    // Spawn particles into ring buffer
    for (let k = 0; k < burstCount; k++) {
      this.ringPointer = (this.ringPointer + 1) % ImpactParticleSystem.MAX_PARTICLES;
      const p = this.particles[this.ringPointer];

      p.active = true;
      p.pos.copy(hitPos);
      p.age = 0;
      p.life = 0.20 + Math.random() * 0.20; // 0.2s - 0.4s
      p.initialSize = 0.04 + Math.random() * 0.035;

      // Eject along normal cone (cone angle ~35 degrees)
      const theta = Math.random() * Math.PI * 2;
      const r = Math.tan(0.60) * Math.sqrt(Math.random());
      this._coneDir
        .copy(this._tempNormal)
        .addScaledVector(this._tangent, Math.cos(theta) * r)
        .addScaledVector(this._bitangent, Math.sin(theta) * r)
        .normalize();

      // Velocity: 4.5 - 9.5 m/s
      const speed = 4.5 + Math.random() * 5.0;
      p.vel.copy(this._coneDir).multiplyScalar(speed);

      // Color variation: mix between pure white spark and weapon neon
      if (Math.random() < 0.35) {
        p.color.setHex(0xFFFFFF);
      } else {
        p.color.setHex(baseHex);
      }
      this.instancedMesh.setColorAt(this.ringPointer, p.color);

      // Initial matrix
      this._dummy.position.copy(p.pos);
      this._dummy.scale.setScalar(p.initialSize);
      this._dummy.updateMatrix();
      this.instancedMesh.setMatrixAt(this.ringPointer, this._dummy.matrix);
    }

    this.instancedMesh.instanceMatrix.needsUpdate = true;
    if (this.instancedMesh.instanceColor) {
      this.instancedMesh.instanceColor.needsUpdate = true;
    }
  }

  /**
   * Updates all active particles: applies gravity (-15 m/s²), moves position, decays scale.
   * Inactive particles are parked off-screen at scale 0.
   */
  public update(delta: number): void {
    if (delta <= 0) return;

    let hasActive = false;

    for (let i = 0; i < ImpactParticleSystem.MAX_PARTICLES; i++) {
      const p = this.particles[i];
      if (!p.active) continue;

      hasActive = true;
      p.age += delta;

      if (p.age >= p.life) {
        // Particle died: park off-screen
        p.active = false;
        this._dummy.position.set(0, -99999, 0);
        this._dummy.scale.set(0, 0, 0);
        this._dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(i, this._dummy.matrix);
      } else {
        // Gravity acceleration: -15 m/s²
        p.vel.y += ImpactParticleSystem.GRAVITY * delta;
        p.pos.addScaledVector(p.vel, delta);

        // Linear size decay over lifetime
        const progress = p.age / p.life;
        const currentScale = p.initialSize * Math.max(0, 1.0 - progress);

        this._dummy.position.copy(p.pos);
        this._dummy.scale.setScalar(currentScale);
        this._dummy.updateMatrix();
        this.instancedMesh.setMatrixAt(i, this._dummy.matrix);
      }
    }

    if (hasActive) {
      this.instancedMesh.instanceMatrix.needsUpdate = true;
    }
  }

  /** Total count of currently active particles */
  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < ImpactParticleSystem.MAX_PARTICLES; i++) {
      if (this.particles[i].active) count++;
    }
    return count;
  }

  /** Ring buffer capacity (always 400) */
  public getCapacity(): number {
    return ImpactParticleSystem.MAX_PARTICLES;
  }

  /** Current ring pointer index */
  public getRingPointer(): number {
    return this.ringPointer;
  }

  /** The single InstancedMesh rendering all particles in 1 draw call */
  public getInstancedMesh(): THREE.InstancedMesh<THREE.TetrahedronGeometry, THREE.MeshBasicMaterial> {
    return this.instancedMesh;
  }

  /** Direct read-only particle array for verification and auditing */
  public getParticles(): readonly ImpactParticleState[] {
    return this.particles;
  }

  /** Cleanup resources */
  public dispose(): void {
    if (this.instancedMesh.parent) {
      this.instancedMesh.parent.remove(this.instancedMesh);
    }
    this.geometry.dispose();
    this.material.dispose();
    this.isInitialized = false;
  }
}

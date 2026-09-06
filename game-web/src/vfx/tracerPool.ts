/**
 * Volumetric Visual Tracers for G.O.N.E. FPS
 * Milestone 3 (F-9, R1): Pre-allocated pool of 50 CylinderGeometry laser beams.
 * 
 * Bypasses WebGL 1px line limitations via 3D volumetric cylinders with additive blending.
 * Strictly zero per-shot allocations (zero new THREE.Mesh / scene.add in runtime).
 */

import * as THREE from 'three';

export interface TracerStyle {
  color: number;
  radius: number;
  pellets: number;
  lifetime: number;
  peakOpacity: number;
  styleName: string;
}

export const TRACER_STYLES: Record<string, TracerStyle> = {
  assalto: {
    color: 0x00F0FF, // Cyan
    radius: 0.025,
    pellets: 1,
    lifetime: 0.10,
    peakOpacity: 0.90,
    styleName: 'Rapid energetic pulse beam'
  },
  cecchino: {
    color: 0xBD00FF, // Magenta / Purple rail beam
    radius: 0.070,
    pellets: 1,
    lifetime: 0.32,
    peakOpacity: 1.00,
    styleName: 'Heavy ion beam with persistent vapor trail'
  },
  pompa: {
    color: 0xFF5F00, // Orange
    radius: 0.015,
    pellets: 8,
    lifetime: 0.08,
    peakOpacity: 0.85,
    styleName: '8-pellet wide conical burst'
  },
  mitraglietta: {
    color: 0xFFE600, // Yellow
    radius: 0.018,
    pellets: 1,
    lifetime: 0.06,
    peakOpacity: 0.80,
    styleName: 'High-frequency laser needle'
  },
  coltello: {
    color: 0x00FFFF, // Ice Cyan
    radius: 0.030,
    pellets: 1,
    lifetime: 0.12,
    peakOpacity: 0.70,
    styleName: 'Short melee slash arc'
  }
};

/** Normalizes arbitrary weapon strings or numbers to canonical key */
export function normalizeWeaponType(weapon: string | number): string {
  if (typeof weapon === 'number') {
    const table = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    return table[weapon] ?? 'assalto';
  }
  const clean = String(weapon).toLowerCase().trim();
  if (clean === 'cecchino' || clean === 'sr99' || clean === 'sr-99' || clean === 'sniper') return 'cecchino';
  if (clean === 'pompa' || clean === 'sg12' || clean === 'sg-12' || clean === 'shotgun') return 'pompa';
  if (clean === 'mitraglietta' || clean === 'smg7' || clean === 'smg-7' || clean === 'smg') return 'mitraglietta';
  if (clean === 'coltello' || clean === 'cb01' || clean === 'cb-01' || clean === 'knife' || clean === 'melee') return 'coltello';
  return 'assalto';
}

export interface TracerInstance {
  index: number;
  active: boolean;
  mesh: THREE.Mesh<THREE.CylinderGeometry, THREE.MeshBasicMaterial>;
  material: THREE.MeshBasicMaterial;
  age: number;
  lifetime: number;
  initialRadius: number;
  peakOpacity: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  length: number;
  weaponType: string;
}

export class TracerPool {
  public static readonly POOL_SIZE = 50;

  private group: THREE.Group;
  private geometry: THREE.CylinderGeometry;
  private tracers: TracerInstance[] = [];
  private nextAllocIndex = 0;
  private isInitialized = false;

  // Pre-allocated scratch objects to ensure strictly 0 per-shot heap allocations
  private readonly _UNIT_Y = new THREE.Vector3(0, 1, 0);
  private readonly _UNIT_Z = new THREE.Vector3(0, 0, 1);
  private readonly _delta = new THREE.Vector3();
  private readonly _dir = new THREE.Vector3();
  private readonly _right = new THREE.Vector3();
  private readonly _up = new THREE.Vector3();
  private readonly _pelletEnd = new THREE.Vector3();

  constructor() {
    this.group = new THREE.Group();
    this.group.name = 'TracerPoolGroup';

    // Unit cylinder: radius 1, height 1, 6 radial segments, 1 height segment, openEnded = true
    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    // Translate base to origin (0, 0, 0) so mesh.position is start point and top extends to (0, 1, 0)
    this.geometry.translate(0, 0.5, 0);

    // Pre-allocate exactly POOL_SIZE meshes and materials
    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      const material = new THREE.MeshBasicMaterial({
        color: 0x00F0FF,
        transparent: true,
        opacity: 0,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide
      });

      const mesh = new THREE.Mesh(this.geometry, material);
      mesh.name = `Tracer_${i}`;
      mesh.visible = false;
      mesh.frustumCulled = false;
      this.group.add(mesh);

      this.tracers.push({
        index: i,
        active: false,
        mesh,
        material,
        age: 0,
        lifetime: 0.1,
        initialRadius: 0.025,
        peakOpacity: 0.9,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        length: 0,
        weaponType: 'assalto'
      });
    }
  }

  /**
   * Initializes the tracer pool by attaching its pre-allocated group to the scene.
   */
  public init(scene: THREE.Scene): void {
    if (!this.isInitialized) {
      scene.add(this.group);
      this.isInitialized = true;
    }
  }

  /**
   * Spawns a visual tracer between start and end with weapon-specific aesthetics.
   * For shotgun ('pompa'), spawns 8 multi-pellet beams in a spread cone.
   * Strictly 0 heap allocations during invocation.
   */
  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string, customPellets?: number): void {
    const canonicalType = normalizeWeaponType(weaponType);
    const style = TRACER_STYLES[canonicalType] ?? TRACER_STYLES.assalto;
    const pelletCount = customPellets !== undefined ? customPellets : style.pellets;

    if (pelletCount <= 1) {
      this.spawnSingle(start, end, style, canonicalType);
    } else {
      // Multi-pellet burst (e.g. Pompa 8 pellets)
      this._delta.subVectors(end, start);
      const dist = this._delta.length();
      if (dist < 0.0001) return;
      this._dir.copy(this._delta).divideScalar(dist);

      // Compute orthonormal basis perpendicular to shot direction
      if (Math.abs(this._dir.y) < 0.9) {
        this._right.crossVectors(this._dir, this._UNIT_Y).normalize();
      } else {
        this._right.crossVectors(this._dir, this._UNIT_Z).normalize();
      }
      this._up.crossVectors(this._right, this._dir).normalize();

      // Spread cone radius at distance (e.g. ~45 mrad spread angle)
      const spreadConeRadius = dist * 0.045;

      for (let p = 0; p < pelletCount; p++) {
        if (p === 0) {
          // Central pellet hits authoritative raycast target
          this.spawnSingle(start, end, style, canonicalType);
        } else {
          // Surrounding pellets spread evenly in a ring
          const theta = (p / (pelletCount - 1)) * Math.PI * 2 + 0.25 * p;
          const r = Math.sqrt(p / (pelletCount - 1)) * spreadConeRadius;
          const offsetX = Math.cos(theta) * r;
          const offsetY = Math.sin(theta) * r;

          this._pelletEnd
            .copy(end)
            .addScaledVector(this._right, offsetX)
            .addScaledVector(this._up, offsetY);

          this.spawnSingle(start, this._pelletEnd, style, canonicalType);
        }
      }
    }
  }

  /**
   * Internal single tracer activation from pre-allocated pool.
   * Employs eviction of oldest active tracer if pool is fully saturated.
   */
  private spawnSingle(start: THREE.Vector3, end: THREE.Vector3, style: TracerStyle, weaponType: string): TracerInstance {
    let tracer: TracerInstance | null = null;

    // First search for an inactive tracer
    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      const idx = (this.nextAllocIndex + i) % TracerPool.POOL_SIZE;
      if (!this.tracers[idx].active) {
        tracer = this.tracers[idx];
        this.nextAllocIndex = (idx + 1) % TracerPool.POOL_SIZE;
        break;
      }
    }

    // If all 50 tracers are active, recycle the oldest one (highest progress)
    if (!tracer) {
      let oldestIdx = 0;
      let maxProgress = -1;
      for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
        const progress = this.tracers[i].age / this.tracers[i].lifetime;
        if (progress > maxProgress) {
          maxProgress = progress;
          oldestIdx = i;
        }
      }
      tracer = this.tracers[oldestIdx];
      this.nextAllocIndex = (oldestIdx + 1) % TracerPool.POOL_SIZE;
    }

    // Compute geometry alignment
    this._delta.subVectors(end, start);
    const length = this._delta.length();
    const safeLength = length < 0.001 ? 0.001 : length;
    this._dir.copy(this._delta).divideScalar(safeLength);

    // Orient cylinder from start to end
    tracer.mesh.position.copy(start);
    tracer.mesh.scale.set(style.radius, safeLength, style.radius);
    tracer.mesh.quaternion.setFromUnitVectors(this._UNIT_Y, this._dir);

    // Apply weapon styling
    tracer.material.color.setHex(style.color);
    tracer.material.opacity = style.peakOpacity;
    tracer.mesh.visible = true;

    // Update instance state
    tracer.active = true;
    tracer.age = 0;
    tracer.lifetime = style.lifetime;
    tracer.initialRadius = style.radius;
    tracer.peakOpacity = style.peakOpacity;
    tracer.start.copy(start);
    tracer.end.copy(end);
    tracer.length = safeLength;
    tracer.weaponType = weaponType;

    return tracer;
  }

  /**
   * Updates all active tracers: increments age, computes quadratic fade and subtle scale dissipation.
   * Deactivates tracers exceeding their lifetime.
   */
  public update(delta: number): void {
    if (delta <= 0) return;

    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      const tracer = this.tracers[i];
      if (!tracer.active) continue;

      tracer.age += delta;
      const progress = tracer.age / tracer.lifetime;

      if (progress >= 1.0) {
        tracer.active = false;
        tracer.mesh.visible = false;
      } else {
        // Quadratic fade for punchy start and smooth dissolution
        const alpha = Math.max(0, 1.0 - progress * progress);
        tracer.material.opacity = tracer.peakOpacity * alpha;

        // Subtle radial contraction over lifetime
        const radiusScale = Math.max(0.15, 1.0 - progress * 0.35);
        tracer.mesh.scale.x = tracer.initialRadius * radiusScale;
        tracer.mesh.scale.z = tracer.initialRadius * radiusScale;
      }
    }
  }

  /** Total number of currently active tracers */
  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      if (this.tracers[i].active) count++;
    }
    return count;
  }

  /** Maximum pool capacity */
  public getPoolSize(): number {
    return TracerPool.POOL_SIZE;
  }

  /** Direct read-only access to pool instances for verification and auditing */
  public getTracers(): readonly TracerInstance[] {
    return this.tracers;
  }

  /** Returns root Three.js group containing the pool meshes */
  public getGroup(): THREE.Group {
    return this.group;
  }

  /** Disposes geometries and materials to avoid memory leaks */
  public dispose(): void {
    if (this.group.parent) {
      this.group.parent.remove(this.group);
    }
    this.geometry.dispose();
    for (const t of this.tracers) {
      t.material.dispose();
    }
    this.isInitialized = false;
  }
}

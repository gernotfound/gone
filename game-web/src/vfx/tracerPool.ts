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
    color: 0x00F0FF,
    radius: 0.025,
    pellets: 1,
    lifetime: 0.10,
    peakOpacity: 0.90,
    styleName: 'Rapid energetic pulse beam'
  },
  cecchino: {
    color: 0xBD00FF,
    radius: 0.070,
    pellets: 1,
    lifetime: 0.32,
    peakOpacity: 1.00,
    styleName: 'Heavy ion beam with persistent vapor trail'
  },
  pompa: {
    color: 0xFF5F00,
    radius: 0.015,
    pellets: 8,
    lifetime: 0.08,
    peakOpacity: 0.85,
    styleName: '8-pellet wide conical burst'
  },
  mitraglietta: {
    color: 0xFFE600,
    radius: 0.018,
    pellets: 1,
    lifetime: 0.06,
    peakOpacity: 0.80,
    styleName: 'High-frequency laser needle'
  },
  coltello: {
    color: 0x00FFFF,
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
  visualLifetime: number;
  initialRadius: number;
  peakOpacity: number;
  start: THREE.Vector3;
  end: THREE.Vector3;
  direction: THREE.Vector3;
  length: number;
  trailLength: number;
  weaponType: string;
}

export class TracerPool {
  public static readonly POOL_SIZE = 50;

  private group: THREE.Group;
  private geometry: THREE.CylinderGeometry;
  private tracers: TracerInstance[] = [];
  private nextAllocIndex = 0;
  private isInitialized = false;

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

    this.geometry = new THREE.CylinderGeometry(1, 1, 1, 6, 1, true);
    this.geometry.translate(0, 0.5, 0);

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
        visualLifetime: 0.16,
        initialRadius: 0.025,
        peakOpacity: 0.9,
        start: new THREE.Vector3(),
        end: new THREE.Vector3(),
        direction: new THREE.Vector3(0, 0, 1),
        length: 0,
        trailLength: 3.5,
        weaponType: 'assalto'
      });
    }
  }

  public init(scene: THREE.Scene): void {
    if (!this.isInitialized) {
      scene.add(this.group);
      this.isInitialized = true;
    }
  }

  public spawnTracer(start: THREE.Vector3, end: THREE.Vector3, weaponType: string, customPellets?: number): void {
    const canonicalType = normalizeWeaponType(weaponType);
    const style = TRACER_STYLES[canonicalType] ?? TRACER_STYLES.assalto;
    const pelletCount = customPellets !== undefined ? customPellets : style.pellets;

    if (pelletCount <= 1) {
      this.spawnSingle(start, end, style, canonicalType);
    } else {
      this._delta.subVectors(end, start);
      const dist = this._delta.length();
      if (dist < 0.0001) return;
      this._dir.copy(this._delta).divideScalar(dist);

      if (Math.abs(this._dir.y) < 0.9) {
        this._right.crossVectors(this._dir, this._UNIT_Y).normalize();
      } else {
        this._right.crossVectors(this._dir, this._UNIT_Z).normalize();
      }
      this._up.crossVectors(this._right, this._dir).normalize();

      const spreadConeRadius = dist * 0.045;

      for (let p = 0; p < pelletCount; p++) {
        if (p === 0) {
          this.spawnSingle(start, end, style, canonicalType);
        } else {
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

  private visualLifetimeFor(weaponType: string, canonicalLifetime: number): number {
    if (weaponType === 'cecchino' || weaponType === 'coltello') return canonicalLifetime;
    if (weaponType === 'mitraglietta') return Math.max(canonicalLifetime, 0.14);
    if (weaponType === 'pompa') return Math.max(canonicalLifetime, 0.14);
    return Math.max(canonicalLifetime, 0.16);
  }

  private trailLengthFor(weaponType: string, shotLength: number): number {
    if (weaponType === 'cecchino' || weaponType === 'coltello') return shotLength;
    if (weaponType === 'pompa') return Math.min(shotLength, 2.2);
    if (weaponType === 'mitraglietta') return Math.min(shotLength, 2.8);
    return Math.min(shotLength, 4.0);
  }

  private spawnSingle(start: THREE.Vector3, end: THREE.Vector3, style: TracerStyle, weaponType: string): TracerInstance {
    let tracer: TracerInstance | null = null;

    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      const idx = (this.nextAllocIndex + i) % TracerPool.POOL_SIZE;
      if (!this.tracers[idx].active) {
        tracer = this.tracers[idx];
        this.nextAllocIndex = (idx + 1) % TracerPool.POOL_SIZE;
        break;
      }
    }

    if (!tracer) {
      let oldestIdx = 0;
      let maxProgress = -1;
      for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
        const life = this.tracers[i].visualLifetime || this.tracers[i].lifetime;
        const progress = this.tracers[i].age / life;
        if (progress > maxProgress) {
          maxProgress = progress;
          oldestIdx = i;
        }
      }
      tracer = this.tracers[oldestIdx];
      this.nextAllocIndex = (oldestIdx + 1) % TracerPool.POOL_SIZE;
    }

    this._delta.subVectors(end, start);
    const length = this._delta.length();
    const safeLength = length < 0.001 ? 0.001 : length;
    this._dir.copy(this._delta).divideScalar(safeLength);

    // Keep the canonical full-beam spawn geometry for deterministic tests and
    // immediately turn it into a travelling projectile streak in update().
    tracer.mesh.position.copy(start);
    tracer.mesh.scale.set(style.radius, safeLength, style.radius);
    tracer.mesh.quaternion.setFromUnitVectors(this._UNIT_Y, this._dir);

    tracer.material.color.setHex(style.color);
    tracer.material.opacity = style.peakOpacity;
    tracer.mesh.visible = true;

    tracer.active = true;
    tracer.age = 0;
    tracer.lifetime = style.lifetime;
    tracer.visualLifetime = this.visualLifetimeFor(weaponType, style.lifetime);
    tracer.initialRadius = style.radius;
    tracer.peakOpacity = style.peakOpacity;
    tracer.start.copy(start);
    tracer.end.copy(end);
    tracer.direction.copy(this._dir);
    tracer.length = safeLength;
    tracer.trailLength = this.trailLengthFor(weaponType, safeLength);
    tracer.weaponType = weaponType;

    return tracer;
  }

  public update(delta: number): void {
    if (delta <= 0) return;

    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      const tracer = this.tracers[i];
      if (!tracer.active) continue;

      tracer.age += delta;
      const visualLifetime = tracer.visualLifetime || tracer.lifetime;
      const progress = tracer.age / visualLifetime;

      if (progress >= 1.0) {
        tracer.active = false;
        tracer.mesh.visible = false;
        continue;
      }

      const alpha = Math.max(0, 1.0 - progress * progress);
      tracer.material.opacity = tracer.peakOpacity * alpha;

      const radiusScale = Math.max(0.35, 1.0 - progress * 0.25);
      tracer.mesh.scale.x = tracer.initialRadius * radiusScale;
      tracer.mesh.scale.z = tracer.initialRadius * radiusScale;

      // Sniper remains a persistent rail beam; knife remains a short slash.
      // Automatic weapons and shotgun pellets become visible travelling streaks
      // so even at ~20 FPS the player can see them leave the muzzle.
      if (tracer.weaponType !== 'cecchino' && tracer.weaponType !== 'coltello') {
        const travelProgress = Math.min(1, progress * 1.25);
        const headDistance = tracer.length * travelProgress;
        const tailDistance = Math.max(0, headDistance - tracer.trailLength);
        const visibleLength = Math.max(0.05, headDistance - tailDistance);
        tracer.mesh.position.copy(tracer.start).addScaledVector(tracer.direction, tailDistance);
        tracer.mesh.scale.y = visibleLength;
      }
    }
  }

  public getActiveCount(): number {
    let count = 0;
    for (let i = 0; i < TracerPool.POOL_SIZE; i++) {
      if (this.tracers[i].active) count++;
    }
    return count;
  }

  public getPoolSize(): number {
    return TracerPool.POOL_SIZE;
  }

  public getTracers(): readonly TracerInstance[] {
    return this.tracers;
  }

  public getGroup(): THREE.Group {
    return this.group;
  }

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

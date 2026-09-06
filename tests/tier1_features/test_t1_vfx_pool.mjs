// tests/tier1_features/test_t1_vfx_pool.mjs
// Tier 1 Feature Coverage: Volumetric Hitscan Tracers, Muzzle Flash & Instanced Impact Particles (F-8, F-9, F-10, F-11, R1, R3)

import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import {
  TracerPool,
  MuzzleFlashController,
  ImpactParticleSystem,
  VFXCoordinator,
  TRACER_STYLES,
  MUZZLE_FLASH_CONFIGS,
  normalizeWeaponType
} from '../../game-web/src/vfx/index.ts';
import { assert, assertEqual, assertCloseTo, assertGreaterThan } from '../helpers/assertions.mjs';

export async function run(suite) {
  // ---------------------------------------------------------------------------
  // 1. Tracer Pool Pre-allocation and Geometry
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: TracerPool pre-allocates exactly 50 CylinderGeometry meshes in a scene group', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    assertEqual(pool.getPoolSize(), 50, 'Pool capacity must be exactly 50');
    assertEqual(pool.getActiveCount(), 0, 'Initial active count must be 0');

    const group = pool.getGroup();
    assert(scene.children.includes(group), 'Tracer group must be added to the scene');
    assertEqual(group.children.length, 50, 'Group must contain exactly 50 mesh children');

    // Verify each child is a CylinderGeometry with additive blending
    const tracers = pool.getTracers();
    assertEqual(tracers.length, 50);

    for (let i = 0; i < 50; i++) {
      const t = tracers[i];
      assertEqual(t.active, false, `Tracer ${i} must be inactive initially`);
      assertEqual(t.mesh.visible, false, `Mesh ${i} must be invisible initially`);
      assertEqual(t.material.blending, THREE.AdditiveBlending, 'Material must use AdditiveBlending');
      assertEqual(t.material.transparent, true, 'Material must be transparent');
      assertEqual(t.material.depthWrite, false, 'Material depthWrite must be false');
    }

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 2. Cylinder Alignment Mathematics
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: Tracer cylinder dynamically aligns between start (muzzle) and end (hit point)', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    const start = new THREE.Vector3(1.0, 2.0, 3.0);
    const end = new THREE.Vector3(1.0, 2.0, 103.0); // 100m straight along +Z

    pool.spawnTracer(start, end, 'assalto');
    assertEqual(pool.getActiveCount(), 1);

    const activeTracer = pool.getTracers().find((t) => t.active);
    assert(activeTracer !== undefined, 'Active tracer must exist');

    // Position matches muzzle start
    assertCloseTo(activeTracer.mesh.position.x, 1.0, 1e-4);
    assertCloseTo(activeTracer.mesh.position.y, 2.0, 1e-4);
    assertCloseTo(activeTracer.mesh.position.z, 3.0, 1e-4);

    // Scale Y matches distance (100m), X and Z match radius (0.025m)
    assertCloseTo(activeTracer.mesh.scale.y, 100.0, 1e-4, 'Scale Y must match length');
    assertCloseTo(activeTracer.mesh.scale.x, 0.025, 1e-4, 'Scale X must match radius');
    assertCloseTo(activeTracer.mesh.scale.z, 0.025, 1e-4, 'Scale Z must match radius');

    // Cylinder orientation: transformed local (0, 1, 0) points towards +Z (0, 0, 1)
    const forward = new THREE.Vector3(0, 1, 0).applyQuaternion(activeTracer.mesh.quaternion);
    assertCloseTo(forward.x, 0.0, 1e-4);
    assertCloseTo(forward.y, 0.0, 1e-4);
    assertCloseTo(forward.z, 1.0, 1e-4);

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 3. Per-Weapon Aesthetics
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: All 5 weapons apply authentic neon visual signatures and widths', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, 50);

    // Assalto: Cyan (0x00F0FF), radius 0.025, lifetime 0.10s
    pool.spawnTracer(start, end, 'assalto', 1);
    const tAssalto = pool.getTracers().find((t) => t.weaponType === 'assalto' && t.active);
    assert(tAssalto !== undefined);
    assertEqual(tAssalto.material.color.getHex(), 0x00F0FF);
    assertCloseTo(tAssalto.initialRadius, 0.025, 1e-4);
    assertCloseTo(tAssalto.lifetime, 0.10, 1e-4);
    assertCloseTo(tAssalto.peakOpacity, 0.90, 1e-4);

    // Cecchino: Magenta (0xBD00FF) wide rail beam (radius 0.070), lifetime 0.32s
    pool.spawnTracer(start, end, 'cecchino', 1);
    const tSniper = pool.getTracers().find((t) => t.weaponType === 'cecchino' && t.active);
    assert(tSniper !== undefined);
    assertEqual(tSniper.material.color.getHex(), 0xBD00FF);
    assertCloseTo(tSniper.initialRadius, 0.070, 1e-4, 'Sniper must have wide rail beam (0.070m)');
    assertCloseTo(tSniper.lifetime, 0.32, 1e-4);
    assertCloseTo(tSniper.peakOpacity, 1.00, 1e-4);

    // Mitraglietta: Yellow (0xFFE600) needle (radius 0.018), lifetime 0.06s
    pool.spawnTracer(start, end, 'mitraglietta', 1);
    const tSmg = pool.getTracers().find((t) => t.weaponType === 'mitraglietta' && t.active);
    assert(tSmg !== undefined);
    assertEqual(tSmg.material.color.getHex(), 0xFFE600);
    assertCloseTo(tSmg.initialRadius, 0.018, 1e-4);
    assertCloseTo(tSmg.lifetime, 0.06, 1e-4);

    // Coltello: Ice Cyan (0x00FFFF), lifetime 0.12s
    pool.spawnTracer(start, end, 'coltello', 1);
    const tKnife = pool.getTracers().find((t) => t.weaponType === 'coltello' && t.active);
    assert(tKnife !== undefined);
    assertEqual(tKnife.material.color.getHex(), 0x00FFFF);
    assertCloseTo(tKnife.initialRadius, 0.030, 1e-4);

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 4. Pompa Multi-Pellet Bursts
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: Pompa combat shotgun spawns 8 conical pellet beams from pool', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    const start = new THREE.Vector3(0, 1.5, 0);
    const end = new THREE.Vector3(0, 1.5, 30.0);

    // Default Pompa firing spawns 8 pellets
    pool.spawnTracer(start, end, 'pompa');
    assertEqual(pool.getActiveCount(), 8, 'Pompa shot must activate exactly 8 tracers from pool');

    const activePompa = pool.getTracers().filter((t) => t.active && t.weaponType === 'pompa');
    assertEqual(activePompa.length, 8);

    for (const p of activePompa) {
      assertEqual(p.material.color.getHex(), 0xFF5F00, 'All pellets must be orange (0xFF5F00)');
      assertCloseTo(p.initialRadius, 0.015, 1e-4);
      assertCloseTo(p.lifetime, 0.08, 1e-4);
      assertEqual(p.mesh.visible, true);
    }

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 5. Quadratic Fade and Lifetime Dissolve
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: Tracers follow quadratic opacity falloff and deactivate when lifetime expires', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, 20);

    // Cecchino has lifetime 0.32s and peak opacity 1.00
    pool.spawnTracer(start, end, 'cecchino', 1);
    const tracer = pool.getTracers().find((t) => t.active);
    assert(tracer !== undefined, 'Active tracer must exist');
    assertEqual(tracer.material.opacity, 1.0);

    // Step 0.16s (50% lifetime) -> alpha = 1.0 - (0.5)^2 = 0.75
    pool.update(0.16);
    assertEqual(tracer.active, true);
    assertCloseTo(tracer.material.opacity, 0.75, 0.02, 'Quadratic fade at 50% life');

    // Step another 0.17s (total 0.33s > 0.32s) -> expires
    pool.update(0.17);
    assertEqual(tracer.active, false, 'Tracer must deactivate when age >= lifetime');
    assertEqual(tracer.mesh.visible, false, 'Mesh must be hidden on deactivation');
    assertEqual(pool.getActiveCount(), 0, 'Active count returns to 0');

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 6. Zero Per-Shot Allocations & Saturated Eviction
  // ---------------------------------------------------------------------------
  suite.test('F-9 / R1: Zero runtime heap allocations and safe eviction on pool saturation', () => {
    const scene = new THREE.Scene();
    const pool = new TracerPool();
    pool.init(scene);

    const start = new THREE.Vector3(0, 0, 0);
    const end = new THREE.Vector3(0, 0, 10);

    // Fire 60 shots without time advancement (exceeds 50 capacity)
    for (let i = 0; i < 60; i++) {
      pool.spawnTracer(start, end, 'assalto', 1);
    }

    // Pool size must remain strictly 50
    assertEqual(pool.getGroup().children.length, 50, 'Zero new meshes created beyond capacity 50');
    assertEqual(pool.getActiveCount(), 50, 'Active count clamped at pool capacity 50');

    // Fast-forward time to clear pool
    pool.update(0.2);
    assertEqual(pool.getActiveCount(), 0, 'All tracers cleanly returned to pool');

    pool.dispose();
  });

  // ---------------------------------------------------------------------------
  // 7. Dynamic Muzzle Flash (F-10, R3)
  // ---------------------------------------------------------------------------
  suite.test('F-10 / R3: MuzzleFlashController activates PointLight and billboard mesh with 0.05s decay', () => {
    const scene = new THREE.Scene();
    const flash = new MuzzleFlashController();
    flash.init(scene);

    const light = flash.getLight();
    const mesh = flash.getMesh();
    assertEqual(light.visible, false, 'Light initially hidden');
    assertEqual(mesh.visible, false, 'Mesh initially hidden');

    const muzzlePos = new THREE.Vector3(2.5, 1.2, -0.5);
    flash.spawnMuzzleFlash(muzzlePos, 'assalto');

    assertEqual(flash.isActive(), true, 'Flash must be active immediately');
    assertEqual(light.visible, true, 'PointLight must be visible');
    assertEqual(mesh.visible, true, 'Billboard mesh must be visible');
    assertEqual(light.color.getHex(), 0x00F0FF, 'Light color must match weapon cyan neon');
    assertEqual(mesh.material.color.getHex(), 0x00F0FF, 'Mesh color must match weapon cyan neon');
    assertCloseTo(light.position.x, 2.5, 1e-4);
    assertCloseTo(light.position.y, 1.2, 1e-4);
    assertCloseTo(light.position.z, -0.5, 1e-4);

    // Step 0.025s (half life)
    flash.update(0.025);
    assertEqual(flash.isActive(), true);
    assertGreaterThan(light.intensity, 0);
    assertGreaterThan(mesh.material.opacity, 0);

    // Step 0.035s (total 0.06s > 0.05s)
    flash.update(0.035);
    assertEqual(flash.isActive(), false, 'Flash must deactivate after 0.05s');
    assertEqual(light.visible, false);
    assertEqual(mesh.visible, false);
    assertEqual(light.intensity, 0);

    flash.dispose();
  });

  // ---------------------------------------------------------------------------
  // 8. Instanced Impact Particles - 1 Draw Call & Capacity (F-11, R3)
  // ---------------------------------------------------------------------------
  suite.test('F-11 / R3: ImpactParticleSystem renders 400 instances in exactly ONE draw call', () => {
    const scene = new THREE.Scene();
    const system = new ImpactParticleSystem();
    system.init(scene);

    const instancedMesh = system.getInstancedMesh();
    assert(scene.children.includes(instancedMesh), 'InstancedMesh must be attached to scene');
    assertEqual(instancedMesh.count, 400, 'Capacity must be exactly 400 instances');
    assertEqual(system.getCapacity(), 400);
    assertEqual(system.getActiveCount(), 0, 'Active count is 0 initially');

    // Verify single draw call representation
    assertEqual(instancedMesh.isInstancedMesh, true);
    assertEqual(instancedMesh.geometry.type, 'TetrahedronGeometry');
    assertEqual(instancedMesh.material.blending, THREE.AdditiveBlending);

    system.dispose();
  });

  // ---------------------------------------------------------------------------
  // 9. Impact Particle Physics & Surface Normal Cone Ejection
  // ---------------------------------------------------------------------------
  suite.test('F-11 / R3: Impact particles eject along surface normal cone with gravity (-15 m/s²)', () => {
    const scene = new THREE.Scene();
    const system = new ImpactParticleSystem();
    system.init(scene);

    const hitPos = new THREE.Vector3(0, 0, 10);
    const hitNormal = new THREE.Vector3(0, 1, 0); // Ground surface pointing up

    system.spawnImpact(hitPos, hitNormal, 'assalto', 12);
    assertEqual(system.getActiveCount(), 12, 'Spawns 12 active particles');

    const activeParticles = system.getParticles().filter((p) => p.active);
    assertEqual(activeParticles.length, 12);

    for (const p of activeParticles) {
      // Ejected upwards (positive Y velocity along ground normal)
      assertGreaterThan(p.vel.y, 0.0, 'Sparks must erupt along normal (+Y)');
      assertGreaterThan(p.life, 0.19, 'Min life 0.20s');
    }

    const initialVelY = activeParticles[0].vel.y;
    // Step 0.10s with gravity -15.0 m/s²
    system.update(0.10);
    const expectedVelY = initialVelY - 15.0 * 0.10;
    assertCloseTo(activeParticles[0].vel.y, expectedVelY, 0.01, 'Velocity must decrease by gravity');

    // Step 0.35s (total 0.45s > 0.40s max life) -> all particles die and park off-screen
    system.update(0.35);
    assertEqual(system.getActiveCount(), 0, 'All particles extinguished');

    system.dispose();
  });

  // ---------------------------------------------------------------------------
  // 10. Ring Buffer Wrapping Under Rapid Fire
  // ---------------------------------------------------------------------------
  suite.test('F-11 / R3: Ring buffer wraps around 400 instances without heap churn or geometry growth', () => {
    const scene = new THREE.Scene();
    const system = new ImpactParticleSystem();
    system.init(scene);

    const hitPos = new THREE.Vector3(0, 0, 0);
    const hitNormal = new THREE.Vector3(0, 1, 0);

    // Rapidly spawn 50 impacts (50 * 12 = 600 particles, exceeding 400 buffer)
    for (let i = 0; i < 50; i++) {
      system.spawnImpact(hitPos, hitNormal, 'mitraglietta', 12);
    }

    // Capacity and instance count must stay locked at 400
    assertEqual(system.getInstancedMesh().count, 400);
    assertEqual(system.getCapacity(), 400);
    assertEqual(scene.children.length, 1, 'Scene maintains exactly ONE draw call mesh');

    system.dispose();
  });

  // ---------------------------------------------------------------------------
  // 11. Central VFXCoordinator Interface Conformance
  // ---------------------------------------------------------------------------
  suite.test('Milestone 3: VFXCoordinator conforms to VFXManager interface contract from PROJECT.md', () => {
    const coordinator = new VFXCoordinator();
    assertEqual(typeof coordinator.init, 'function');
    assertEqual(typeof coordinator.spawnTracer, 'function');
    assertEqual(typeof coordinator.spawnMuzzleFlash, 'function');
    assertEqual(typeof coordinator.spawnImpact, 'function');
    assertEqual(typeof coordinator.update, 'function');

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera();
    coordinator.init(scene, camera);
    assertEqual(coordinator.isReady(), true);

    // onFire composite trigger
    coordinator.onFire({
      muzzlePos: new THREE.Vector3(0, 1, 0),
      hitPoint: new THREE.Vector3(0, 1, 50),
      hitNormal: new THREE.Vector3(0, 0, -1),
      weaponType: 'assalto'
    });

    assertGreaterThan(coordinator.getActiveTracerCount(), 0);
    assertEqual(coordinator.isMuzzleFlashActive(), true);
    assertGreaterThan(coordinator.getActiveParticleCount(), 0);

    coordinator.update(0.5);
    assertEqual(coordinator.getActiveTracerCount(), 0);
    assertEqual(coordinator.isMuzzleFlashActive(), false);
    assertEqual(coordinator.getActiveParticleCount(), 0);

    coordinator.dispose();
  });
}

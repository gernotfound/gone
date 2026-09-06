// tests/tier1_features/test_shield_vfx.mjs
// Tier 1 Feature Coverage: 3D Cyan Invulnerability Shield Sphere VFX Lifecycle & Memory Management (R2, Acceptance Criteria)

import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import {
  ShieldVFXController,
  shieldVfxController,
} from '../../game-web/src/vfx/shieldVfx.ts';
import { assert, assertEqual, assertCloseTo, assertGreaterThan } from '../helpers/assertions.mjs';

export async function run(suite) {
  // ---------------------------------------------------------------------------
  // 1. Mesh Creation, Geometry & Material Properties
  // ---------------------------------------------------------------------------
  suite.test('R2: Shield mesh is a 3D SphereGeometry(1.85, 32, 32) with cyan #00F0FF, opacity 0.28, and AdditiveBlending', () => {
    const controller = new ShieldVFXController();
    const mesh = controller.createShieldMesh();

    assert(mesh instanceof THREE.Mesh, 'Must produce a THREE.Mesh instance');
    assert(mesh.geometry instanceof THREE.SphereGeometry, 'Geometry must be THREE.SphereGeometry');

    // Radius: 1.85m to enclose player model with buffer
    const geoParams = mesh.geometry.parameters;
    assertEqual(geoParams.radius, 1.85, 'Sphere radius must be exactly 1.85m');
    assertEqual(geoParams.widthSegments, 32, 'Width segments must be 32');
    assertEqual(geoParams.heightSegments, 32, 'Height segments must be 32');

    // Material properties
    const mat = mesh.material;
    assertEqual(mat.color.getHex(), 0x00f0ff, 'Color must be 0x00F0FF (Neon Cyan)');
    assertEqual(mat.emissive.getHex(), 0x00f0ff, 'Emissive must be 0x00F0FF');
    assertCloseTo(mat.opacity, 0.28, 1e-3, 'Opacity must be exactly 0.28');
    assertEqual(mat.transparent, true, 'Material must be transparent');
    assertEqual(mat.depthWrite, false, 'depthWrite must be false to avoid clipping artifacts');
    assertEqual(mat.blending, THREE.AdditiveBlending, 'Blending must be THREE.AdditiveBlending');
    assertEqual(mat.side, THREE.DoubleSide, 'Side must be THREE.DoubleSide for interior/exterior visibility');
  });

  // ---------------------------------------------------------------------------
  // 2. Attachment to Target Object (Player Model / Anchor)
  // ---------------------------------------------------------------------------
  suite.test('R2: Shield attaches cleanly as a child of the target entity with the requested offset', () => {
    const controller = new ShieldVFXController();
    const scene = new THREE.Scene();
    const playerGroup = new THREE.Group();
    playerGroup.position.set(10.0, 17.5, -5.0);
    scene.add(playerGroup);

    const instance = controller.attachShield(playerGroup, 10.0, new THREE.Vector3(0, 0.9, 0));

    assertEqual(controller.getActiveCount(), 1, 'Active shield count must be 1');
    assertEqual(controller.hasShield(playerGroup), true, 'hasShield must return true');
    assertEqual(instance.target, playerGroup);
    assertEqual(instance.remainingTime, 10.0);
    assertEqual(instance.duration, 10.0);

    // Mesh parentage and position
    assertEqual(instance.mesh.parent, playerGroup, 'Mesh must be attached as a child of playerGroup');
    assert(playerGroup.children.includes(instance.mesh), 'playerGroup must contain shield mesh');
    assertEqual(instance.mesh.position.y, 0.9, 'Mesh Y offset should be centered at 0.9m');

    controller.disposeAll();
  });

  // ---------------------------------------------------------------------------
  // 3. Subtle Sinusoidal Energy Pulsation
  // ---------------------------------------------------------------------------
  suite.test('R2: Shield updates apply subtle sinusoidal energy pulse to scale and opacity', () => {
    const controller = new ShieldVFXController();
    const target = new THREE.Object3D();
    const instance = controller.attachShield(target, 10.0);

    const initialScale = instance.mesh.scale.x;
    const initialOpacity = instance.material.opacity;

    // Advance by 0.26 seconds (near peak of sin(6 * t))
    controller.update(0.26);

    const pulsedScale = instance.mesh.scale.x;
    const pulsedOpacity = instance.material.opacity;

    assert(Math.abs(pulsedScale - initialScale) > 1e-4, 'Scale must modulate over time');
    assert(Math.abs(pulsedOpacity - initialOpacity) > 1e-4, 'Opacity must modulate over time');
    assert(pulsedScale >= 0.95 && pulsedScale <= 1.05, 'Scale pulse must remain subtle within +/- 5%');
    assert(pulsedOpacity >= 0.20 && pulsedOpacity <= 0.38, 'Opacity pulse must remain within [0.20, 0.38]');

    controller.disposeAll();
  });

  // ---------------------------------------------------------------------------
  // 4. Deterministic 10.0s Timer Expiration & GPU Memory Disposal
  // ---------------------------------------------------------------------------
  suite.test('R2 / AC: Shield automatically destroys and disposes GPU resources after 10.0 seconds', () => {
    const controller = new ShieldVFXController();
    const scene = new THREE.Scene();
    const playerEntity = new THREE.Group();
    scene.add(playerEntity);

    const instance = controller.attachShield(playerEntity, 10.0);
    const mesh = instance.mesh;

    let geoDisposed = false;
    let matDisposed = false;
    mesh.geometry.dispose = () => { geoDisposed = true; };
    mesh.material.dispose = () => { matDisposed = true; };

    // Advance 5.0 seconds
    controller.update(5.0);
    assertEqual(controller.hasShield(playerEntity), true, 'Shield must still be active at 5s');
    assertEqual(playerEntity.children.includes(mesh), true, 'Mesh must still be in parent at 5s');
    assertEqual(geoDisposed, false);
    assertEqual(matDisposed, false);

    // Advance another 4.9 seconds (total 9.9s)
    controller.update(4.9);
    assertEqual(controller.hasShield(playerEntity), true, 'Shield must still be active at 9.9s');
    assertEqual(playerEntity.children.includes(mesh), true);

    // Advance 0.2 seconds past 10.0s expiration (total 10.1s)
    controller.update(0.2);

    assertEqual(controller.hasShield(playerEntity), false, 'Shield must be inactive after 10.1s');
    assertEqual(controller.getActiveCount(), 0, 'Active shield count must be 0');
    assertEqual(playerEntity.children.includes(mesh), false, 'Mesh must be removed from scene graph');
    assertEqual(geoDisposed, true, 'Geometry must be cleanly disposed on expiration');
    assertEqual(matDisposed, true, 'Material must be cleanly disposed on expiration');
    assertEqual(instance.disposed, true, 'Instance must be flagged as disposed');
  });

  // ---------------------------------------------------------------------------
  // 5. Manual Detachment & Early Cancel
  // ---------------------------------------------------------------------------
  suite.test('R2: detachShield immediately removes mesh from parent and cleans up resources', () => {
    const controller = new ShieldVFXController();
    const parent = new THREE.Group();
    const instance = controller.attachShield(parent, 10.0);

    let geoDisposed = false;
    instance.geometry.dispose = () => { geoDisposed = true; };

    assertEqual(controller.hasShield(parent), true);
    controller.detachShield(parent);

    assertEqual(controller.hasShield(parent), false);
    assertEqual(parent.children.length, 0, 'Parent must have no remaining children');
    assertEqual(geoDisposed, true, 'Geometry dispose must be called');
  });

  // ---------------------------------------------------------------------------
  // 6. Shield Refresh Without Duplicate Mesh Leaks
  // ---------------------------------------------------------------------------
  suite.test('R2: Attaching shield to entity already possessing a shield refreshes duration to 10s without creating duplicate meshes', () => {
    const controller = new ShieldVFXController();
    const entity = new THREE.Group();

    controller.attachShield(entity, 10.0);
    assertEqual(entity.children.length, 1, 'Initial child count must be 1');

    // Simulate 6.0 seconds elapse
    controller.update(6.0);
    const instBefore = controller.getShield(entity);
    assertCloseTo(instBefore.remainingTime, 4.0, 0.1);

    // Refresh shield (e.g. respawn / shield pickup)
    controller.attachShield(entity, 10.0);

    assertEqual(entity.children.length, 1, 'Child count must NOT increase (no duplicate meshes)');
    assertEqual(controller.getActiveCount(), 1, 'Active count must remain 1');
    const instAfter = controller.getShield(entity);
    assertEqual(instAfter.remainingTime, 10.0, 'Timer must be refreshed to 10.0s');

    controller.disposeAll();
  });

  // ---------------------------------------------------------------------------
  // 7. Multiple Entities with Concurrent Independent Shields
  // ---------------------------------------------------------------------------
  suite.test('R2: Multiple players hold independent shields with isolated lifecycles', () => {
    const controller = new ShieldVFXController();
    const player1 = new THREE.Group();
    const player2 = new THREE.Group();

    controller.attachShield(player1, 5.0); // 5s shield
    controller.attachShield(player2, 10.0); // 10s shield

    assertEqual(controller.getActiveCount(), 2);

    // Advance 6.0 seconds: player1 shield expires, player2 shield remains
    controller.update(6.0);

    assertEqual(controller.hasShield(player1), false, 'Player 1 shield must be expired');
    assertEqual(controller.hasShield(player2), true, 'Player 2 shield must still be active');
    assertEqual(player1.children.length, 0);
    assertEqual(player2.children.length, 1);

    // Advance 5.0 more seconds: player2 shield expires
    controller.update(5.0);
    assertEqual(controller.hasShield(player2), false, 'Player 2 shield must be expired');
    assertEqual(controller.getActiveCount(), 0);

    controller.disposeAll();
  });
}

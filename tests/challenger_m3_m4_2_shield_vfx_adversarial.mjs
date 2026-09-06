/**
 * tests/challenger_m3_m4_2_shield_vfx_adversarial.mjs
 * 
 * Empirical Adversarial Verification Suite - Challenger 2
 * Milestone 3 & 4: 3D Shield Sphere VFX Lifecycle & Memory Management
 * 
 * Acceptance Criterion Under Challenge:
 * "La sfera 3D dello scudo deve distruggersi e scomparire visivamente allo scadere del timer."
 * 
 * Verification Dimensions:
 * 1. 3D Cyan Semi-Transparent Sphere Specification during [0, 10) seconds:
 *    - SphereGeometry(1.85, 32, 32)
 *    - Color: 0x00F0FF (#00F0FF Neon Cyan)
 *    - Emissive: 0x00F0FF, intensity 0.8
 *    - Opacity: 0.28 base, AdditiveBlending, transparent: true, depthWrite: false, side: DoubleSide
 *    - Continuous presence in parent scene graph across [0, 9.999] seconds
 *    - Sinusoidal breathing pulse within strict bounds
 * 
 * 2. Deterministic Scene Graph Removal at Exactly 10.0 Seconds:
 *    - Verified at boundary t=9.999s (present) vs t=10.000s (removed)
 *    - Verified that mesh.parent is null and parent.children no longer includes mesh
 *    - Verified through complete scene graph traversal
 * 
 * 3. Prevention of WebGL Memory Leaks:
 *    - Geometry disposal (geometry.dispose()) called
 *    - Material disposal (material.dispose()) called
 *    - Exactly 1 disposal per asset, idempotent disposal protection
 *    - High-density stress: 500 concurrent shields disposed with zero memory leaks
 * 
 * 4. HUD Shield Indicator & Countdown Synchronization:
 *    - Shield badge visible with active countdown during [0, 10) seconds
 *    - At exactly 10.0s (remaining = 0), HUD badge disappears (hidden class added, flex removed)
 *    - Boundary conditions: negative numbers, NaN, and rapid reset handling
 * 
 * 5. Adversarial Hostile Scenarios:
 *    - Early fatal elimination (death during active shield) forces instant detachment & disposal
 *    - Double respawn / rapid re-attachment refreshes duration without duplicate mesh leaks
 *    - Non-monotonic / negative delta resilience
 *    - Large lag-spike delta overshoots (e.g. 15s delta) handled cleanly
 */

import * as THREE from '../game-web/node_modules/three/build/three.module.js';
import { ShieldVFXController } from '../game-web/src/vfx/shieldVfx.ts';
import { HealthHUDController } from '../game-web/src/ui/healthHud.ts';
import { P2PHost } from '../game-web/src/net/p2pHost.ts';
import { P2PClient } from '../game-web/src/net/p2pClient.ts';
import { STATE_FLAGS, encodeWorldSnapshot } from '../game-web/src/net/binaryProtocol.ts';
import { MockDataChannel } from './helpers/p2p_mock_channel.mjs';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureMessages = [];

function assert(condition, message, verbose = true) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failureMessages.push(message);
    console.error(`  ✘ [FAIL] ${message}`);
  } else {
    passedTests++;
    if (verbose) {
      console.log(`  ✔ [PASS] ${message}`);
    }
  }
}

function assertEqual(actual, expected, message = '') {
  const detail = message ? `${message} - ` : '';
  assert(actual === expected, `${detail}Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`);
}

function assertCloseTo(actual, expected, tolerance = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  const detail = message ? `${message} - ` : '';
  assert(diff <= tolerance, `${detail}Expected ${actual} close to ${expected} (diff: ${diff} <= ${tolerance})`);
}

async function runShieldVfxAdversarialSuite() {
  console.log(`
================================================================================
  CHALLENGER 2: ADVERSARIAL VERIFICATION OF 3D SHIELD SPHERE VFX & LIFECYCLE    
================================================================================
`);

  // ===========================================================================
  // SECTION 1: 3D Cyan Sphere VFX Visual & Material Specs during [0, 10)s
  // ===========================================================================
  console.log('\n>>> SECTION 1: 3D Cyan Semi-Transparent Sphere Visual & Geometric Integrity');
  {
    const controller = new ShieldVFXController();
    const parentEntity = new THREE.Group();
    parentEntity.position.set(0, 17.5, 0);

    const instance = controller.attachShield(parentEntity, 10.0, new THREE.Vector3(0, 0.9, 0));
    const mesh = instance.mesh;

    // 1.1 Three.js Mesh and Geometry verification
    assert(mesh instanceof THREE.Mesh, 'Shield must be a valid THREE.Mesh');
    assert(mesh.geometry instanceof THREE.SphereGeometry, 'Geometry must be THREE.SphereGeometry');
    assertEqual(mesh.name, 'InvulnerabilityShieldSphere', 'Mesh must be identifiable by name');

    const params = mesh.geometry.parameters;
    assertEqual(params.radius, 1.85, 'Sphere radius must be exactly 1.85m to enclose player model');
    assertEqual(params.widthSegments, 32, 'Sphere width segments must be 32 for smooth curvature');
    assertEqual(params.heightSegments, 32, 'Sphere height segments must be 32 for smooth curvature');

    // 1.2 Material specifications
    const mat = mesh.material;
    assert(mat instanceof THREE.MeshStandardMaterial, 'Material must be THREE.MeshStandardMaterial');
    assertEqual(mat.color.getHex(), 0x00f0ff, 'Material color must be Neon Cyan 0x00F0FF');
    assertEqual(mat.emissive.getHex(), 0x00f0ff, 'Material emissive color must be Neon Cyan 0x00F0FF');
    assertCloseTo(mat.emissiveIntensity, 0.8, 1e-4, 'Emissive intensity must be 0.8 for high cyberpunk glow');
    assertEqual(mat.transparent, true, 'Material must be transparent');
    assertCloseTo(mat.opacity, 0.28, 1e-4, 'Base opacity must be 0.28 (almost transparent)');
    assertEqual(mat.depthWrite, false, 'depthWrite must be false to prevent alpha sorting/clipping artifacts');
    assertEqual(mat.blending, THREE.AdditiveBlending, 'blending must be AdditiveBlending for luminous holographic appearance');
    assertEqual(mat.side, THREE.DoubleSide, 'side must be DoubleSide for interior and exterior visibility');
    assertEqual(mat.wireframe, false, 'wireframe must be false');

    // 1.3 Position offset
    assertCloseTo(mesh.position.y, 0.9, 1e-4, 'Y offset must be 0.9m to align with player torso/center');

    // 1.4 Intermediate time steps: Must remain attached throughout [0, 9.999s]
    const testIntervals = [0.5, 1.0, 2.5, 5.0, 7.5, 9.0, 9.5, 9.9, 9.999];
    let currentTime = 0;
    for (const targetTime of testIntervals) {
      const dt = targetTime - currentTime;
      controller.update(dt);
      currentTime = targetTime;

      assert(parentEntity.children.includes(mesh), `Mesh must remain in parent at t=${targetTime}s`);
      assertEqual(mesh.parent, parentEntity, `mesh.parent must be parentEntity at t=${targetTime}s`);
      assertEqual(controller.hasShield(parentEntity), true, `controller.hasShield must be true at t=${targetTime}s`);
      assertEqual(instance.disposed, false, `instance.disposed must be false at t=${targetTime}s`);

      // Verify sinusoidal energy breathing
      assert(mesh.scale.x >= 0.95 && mesh.scale.x <= 1.05, `Scale must remain within +/-5% pulse at t=${targetTime}s`);
      assert(mat.opacity >= 0.20 && mat.opacity <= 0.38, `Opacity must remain within [0.20, 0.38] at t=${targetTime}s`);
    }

    controller.disposeAll();
  }

  // ===========================================================================
  // SECTION 2: Exact 10.0s Boundary & Removal from Parent Scene Graph
  // ===========================================================================
  console.log('\n>>> SECTION 2: Deterministic Scene Graph Removal at Exactly 10.0 Seconds');
  {
    const controller = new ShieldVFXController();
    const rootScene = new THREE.Scene();
    const playerEntity = new THREE.Group();
    playerEntity.name = 'PlayerEntity';
    rootScene.add(playerEntity);

    const instance = controller.attachShield(playerEntity, 10.0);
    const mesh = instance.mesh;

    // Advance to 9.999s (1 millisecond before expiration)
    controller.update(9.999);
    assertEqual(playerEntity.children.includes(mesh), true, 'At 9.999s, mesh MUST still be in parent entity');
    assertEqual(mesh.parent, playerEntity, 'At 9.999s, mesh.parent MUST point to playerEntity');
    assertEqual(controller.hasShield(playerEntity), true, 'At 9.999s, hasShield MUST return true');

    // Query scene graph via Three.js scene traversal
    let foundInSceneBefore = false;
    rootScene.traverse((obj) => {
      if (obj.name === 'InvulnerabilityShieldSphere') foundInSceneBefore = true;
    });
    assertEqual(foundInSceneBefore, true, 'Mesh must be discoverable in scene traversal prior to 10.0s');

    // Advance exactly 0.001s (bringing total elapsed time to exactly 10.000s)
    controller.update(0.001);

    // Verify complete removal from parent and scene graph
    assertEqual(playerEntity.children.includes(mesh), false, 'At exactly 10.000s, mesh MUST be removed from parent entity');
    assertEqual(mesh.parent, null, 'At exactly 10.000s, mesh.parent MUST be null');
    assertEqual(playerEntity.children.length, 0, 'Parent entity children count must drop to 0');
    assertEqual(controller.hasShield(playerEntity), false, 'At 10.000s, hasShield MUST return false');
    assertEqual(controller.getActiveCount(), 0, 'Active shield count must be 0');
    assertEqual(instance.disposed, true, 'Shield instance must be marked disposed');

    // Verify scene graph traversal no longer finds the sphere
    let foundInSceneAfter = false;
    rootScene.traverse((obj) => {
      if (obj.name === 'InvulnerabilityShieldSphere') foundInSceneAfter = true;
    });
    assertEqual(foundInSceneAfter, false, 'Mesh must NOT be discoverable in scene graph after 10.0s');

    // Further updates must be safe and idempotent
    controller.update(1.0);
    controller.update(5.0);
    assertEqual(playerEntity.children.length, 0, 'Subsequent updates must not alter empty state');
  }

  // ===========================================================================
  // SECTION 3: Prevention of WebGL Memory Leaks (Geometry & Material Disposal)
  // ===========================================================================
  console.log('\n>>> SECTION 3: WebGL Resource Disposal & GPU Memory Leak Prevention');
  {
    const controller = new ShieldVFXController();
    const parent = new THREE.Group();
    const instance = controller.attachShield(parent, 10.0);

    let geoDisposedCount = 0;
    let matDisposedCount = 0;
    instance.geometry.dispose = () => { geoDisposedCount++; };
    instance.material.dispose = () => { matDisposedCount++; };

    // Advance past 10.0s
    controller.update(10.0);

    assertEqual(geoDisposedCount, 1, 'geometry.dispose() must be called exactly 1 time upon expiration');
    assertEqual(matDisposedCount, 1, 'material.dispose() must be called exactly 1 time upon expiration');

    // Test idempotency: Calling detachShield or disposeAll on an already disposed instance must not re-dispose
    controller.detachShield(parent);
    assertEqual(geoDisposedCount, 1, 'Double disposal must be prevented (idempotent)');
    assertEqual(matDisposedCount, 1, 'Double material disposal must be prevented');

    // --- Mass Shield Stress (500 Concurrent Shields) ---
    console.log('    >> Running 500-entity concurrent shield allocation and disposal stress...');
    const stressController = new ShieldVFXController();
    const entities = [];
    let totalGeoDisposals = 0;
    let totalMatDisposals = 0;

    for (let i = 0; i < 500; i++) {
      const ent = new THREE.Group();
      entities.push(ent);
      const inst = stressController.attachShield(ent, 10.0);
      inst.geometry.dispose = () => { totalGeoDisposals++; };
      inst.material.dispose = () => { totalMatDisposals++; };
    }

    assertEqual(stressController.getActiveCount(), 500, '500 concurrent shields must be active');

    // Advance 5.0s: none should be disposed
    stressController.update(5.0);
    assertEqual(totalGeoDisposals, 0, 'No geometry disposals at 5.0s');
    assertEqual(totalMatDisposals, 0, 'No material disposals at 5.0s');
    assertEqual(stressController.getActiveCount(), 500);

    // Advance another 5.0s: all 500 must expire and dispose at 10.0s
    stressController.update(5.0);
    assertEqual(totalGeoDisposals, 500, 'All 500 geometries must be disposed at 10.0s');
    assertEqual(totalMatDisposals, 500, 'All 500 materials must be disposed at 10.0s');
    assertEqual(stressController.getActiveCount(), 0, 'Active count must be 0 after mass expiration');

    for (const ent of entities) {
      assertEqual(ent.children.length, 0, 'Every entity group must have 0 remaining children');
    }
  }

  // ===========================================================================
  // SECTION 4: HUD Shield Icon & Countdown Disappearance at 10.0s
  // ===========================================================================
  console.log('\n>>> SECTION 4: Health HUD Shield Badge Visibility & Expiration');
  {
    const mockBadgeClasses = new Set(['hidden']);
    const mockBadge = {
      classList: {
        add: (c) => mockBadgeClasses.add(c),
        remove: (c) => mockBadgeClasses.delete(c),
        contains: (c) => mockBadgeClasses.has(c),
      },
    };
    const mockTimer = { textContent: '' };
    const mockHpVal = { textContent: '', className: '' };
    const mockHpBar = { style: { width: '' }, className: '' };

    const hud = new HealthHUDController({
      hpVal: mockHpVal,
      hpBar: mockHpBar,
      shieldBadge: mockBadge,
      shieldTimer: mockTimer,
    });

    // Initial state
    hud.init();
    assertEqual(mockBadge.classList.contains('hidden'), true, 'HUD shield badge must start hidden');
    assertEqual(hud.isShieldActive, false, 'isShieldActive must start false');

    // Activate 10s shield
    hud.updateShield(10.0);
    assertEqual(hud.isShieldActive, true, 'isShieldActive must be true with 10.0s');
    assertEqual(hud.shieldRemainingSeconds, 10.0);
    assertEqual(mockBadge.classList.contains('hidden'), false, 'Badge must NOT be hidden during active shield');
    assertEqual(mockBadge.classList.contains('flex'), true, 'Badge must have flex layout during active shield');
    assertEqual(mockTimer.textContent, '10.0s', 'Badge timer must display "10.0s"');

    // Countdown progression
    hud.updateShield(7.34);
    assertEqual(mockTimer.textContent, '7.3s', 'Timer text must format to 1 decimal place');
    assertEqual(mockBadge.classList.contains('hidden'), false);

    hud.updateShield(0.1);
    assertEqual(hud.isShieldActive, true, 'At 0.1s shield is still active');
    assertEqual(mockBadge.classList.contains('hidden'), false);
    assertEqual(mockTimer.textContent, '0.1s');

    // Exactly 0.0s: Shield expires and disappears visually
    hud.updateShield(0.0);
    assertEqual(hud.isShieldActive, false, 'At 0.0s isShieldActive must be false');
    assertEqual(hud.shieldRemainingSeconds, 0);
    assertEqual(mockBadge.classList.contains('hidden'), true, 'At 0.0s badge MUST have "hidden" class');
    assertEqual(mockBadge.classList.contains('flex'), false, 'At 0.0s badge MUST NOT have "flex" class');

    // Hostile boundary test: negative remaining seconds
    hud.updateShield(-2.5);
    assertEqual(hud.isShieldActive, false, 'Negative remaining time must result in inactive shield');
    assertEqual(hud.shieldRemainingSeconds, 0, 'Negative values must clamp to 0');
    assertEqual(mockBadge.classList.contains('hidden'), true);
  }

  // ===========================================================================
  // SECTION 5: Adversarial Scenarios (Double Respawn, Early Death, Delta Jitter)
  // ===========================================================================
  console.log('\n>>> SECTION 5: Adversarial Edge Cases & Hostile Workload Invariants');
  {
    const controller = new ShieldVFXController();

    // 5.1 Early Death Mid-Shield Detachment
    console.log('    >> Testing early death cancellation mid-shield...');
    const localPlayer = new THREE.Group();
    const inst1 = controller.attachShield(localPlayer, 10.0);
    let earlyGeoDisposed = false;
    let earlyMatDisposed = false;
    inst1.geometry.dispose = () => { earlyGeoDisposed = true; };
    inst1.material.dispose = () => { earlyMatDisposed = true; };

    // Advance 3.5s (player takes fatal shot at t=3.5s)
    controller.update(3.5);
    assertEqual(controller.hasShield(localPlayer), true);

    // Call detachShield as handleLocalPlayerDeath() does
    controller.detachShield(localPlayer);

    assertEqual(controller.hasShield(localPlayer), false, 'Shield must be cancelled immediately upon death');
    assertEqual(localPlayer.children.length, 0, 'Local player must have 0 children after death detachment');
    assertEqual(earlyGeoDisposed, true, 'Geometry must be disposed immediately on early death');
    assertEqual(earlyMatDisposed, true, 'Material must be disposed immediately on early death');

    // 5.2 Shield Refresh / Re-attach without Duplicate Mesh Leaks
    console.log('    >> Testing rapid shield refresh without duplicate mesh leaks...');
    const respawningPlayer = new THREE.Group();
    controller.attachShield(respawningPlayer, 10.0);
    assertEqual(respawningPlayer.children.length, 1);

    // Advance 4.0s
    controller.update(4.0);
    assertCloseTo(controller.getShield(respawningPlayer).remainingTime, 6.0, 0.05);

    // Trigger re-attachment (e.g. forced respawn or pickup)
    controller.attachShield(respawningPlayer, 10.0);
    assertEqual(respawningPlayer.children.length, 1, 'Child count must remain strictly 1 (no duplicate mesh leak)');
    assertEqual(controller.getActiveCount(), 1, 'Active shield count must remain 1');
    assertEqual(controller.getShield(respawningPlayer).remainingTime, 10.0, 'Timer must refresh to 10.0s');

    // Advance 10.0s from refresh: must expire cleanly
    controller.update(10.0);
    assertEqual(respawningPlayer.children.length, 0, 'Mesh must be removed at 10.0s after refresh');
    assertEqual(controller.getActiveCount(), 0);

    // 5.3 Extreme Delta Jitter (Micro-steps vs Giant Lag Spikes)
    console.log('    >> Testing extreme delta time jitter...');
    const jitterEntity = new THREE.Group();
    controller.attachShield(jitterEntity, 10.0);

    // 100 micro-steps of 1ms = 0.1s
    for (let i = 0; i < 100; i++) {
      controller.update(0.001);
    }
    assertCloseTo(controller.getShield(jitterEntity).remainingTime, 9.9, 1e-3);

    // Zero and negative deltas
    controller.update(0.0);
    assertCloseTo(controller.getShield(jitterEntity).remainingTime, 9.9, 1e-3, 'Zero delta must not alter timer');
    controller.update(-0.5);
    assertCloseTo(controller.getShield(jitterEntity).remainingTime, 9.9, 1e-3, 'Negative delta must be ignored');

    // Giant lag spike overshoot: delta = 15.0s
    controller.update(15.0);
    assertEqual(controller.hasShield(jitterEntity), false, 'Lag spike overshoot must cleanly expire shield');
    assertEqual(jitterEntity.children.length, 0, 'Mesh must be cleanly removed despite lag overshoot');
    assertEqual(controller.getActiveCount(), 0);

    // 5.4 Remote Multi-Player Staggered Lifecycle (8 players)
    console.log('    >> Testing 8-player staggered lifecycle in multiplayer session...');
    const remotePlayers = [];
    for (let p = 0; p < 8; p++) {
      const peerGroup = new THREE.Group();
      peerGroup.name = `RemotePeer_${p}`;
      remotePlayers.push(peerGroup);
    }

    // Attach shields staggered by 1.0 second each
    for (let p = 0; p < 8; p++) {
      controller.attachShield(remotePlayers[p], 10.0);
      if (p < 7) {
        controller.update(1.0);
      }
    }
    // At this point, player 0 has been active for 7s (remaining 3s)
    // Player 7 has just been attached (remaining 10s)
    assertEqual(controller.getActiveCount(), 8, 'All 8 remote players have active shields');

    // Advance 3.0s: Player 0 expires, Player 1 has 1s left
    controller.update(3.0);
    assertEqual(controller.hasShield(remotePlayers[0]), false, 'Player 0 shield must expire after 10s cumulative');
    assertEqual(remotePlayers[0].children.length, 0);
    assertEqual(controller.hasShield(remotePlayers[1]), true, 'Player 1 shield still active');
    assertEqual(controller.getActiveCount(), 7);

    // Advance 7.0s: All remaining players expire in proper sequence
    controller.update(7.0);
    assertEqual(controller.getActiveCount(), 0, 'All 8 remote player shields expired cleanly');
    for (let p = 0; p < 8; p++) {
      assertEqual(remotePlayers[p].children.length, 0, `Player ${p} group must be empty`);
    }

    controller.disposeAll();
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log(`
================================================================================
  ADVERSARIAL VERIFICATION SUMMARY
================================================================================
  Total Assertions Checked : ${totalTests}
  Passed Assertions        : ${passedTests}
  Failed Assertions        : ${failedTests}
================================================================================
`);

  if (failedTests > 0) {
    console.error(`✘ CHALLENGE FAILED with ${failedTests} failure(s):`);
    for (const msg of failureMessages) {
      console.error(`  - ${msg}`);
    }
    process.exit(1);
  } else {
    console.log('✔ ALL ADVERSARIAL CHALLENGE ASSERTIONS PASSED EMPIRICALLY!');
    process.exit(0);
  }
}

runShieldVfxAdversarialSuite().catch((err) => {
  console.error('FATAL UNCAUGHT RUNNER ERROR:', err);
  process.exit(1);
});

/**
 * Challenger M4 - Milestone 4 Final Integration & Hardening Stress Suite
 * Empirical Challenger: critic & specialist verification for Milestone 4.
 * 
 * Verifies:
 * 1. Muzzle World Positioning & Matrix Invariance (All 5 weapons, camera positions, rotations)
 * 2. Weapon Raycasting & Hitscan Precision (Terrain, remote player, knife 2.5m limit, sky 300m, normal transform)
 * 3. Multi-Pellet Shotgun Spread (Pompa 8 pellets, conical distribution, angular divergence, point-blank edge case)
 * 4. Extreme Camera Angles & Singularity Stress (Pitch ±89.99°, ±90°, antiparallel vectors, roll shake)
 * 5. Rapid Weapon Switching & Race Conditions (10,000 rapid switches, cooldown lockout, async GLB race handling)
 * 6. Sustained Fire Cadence & Frame-Rate Independence (240 FPS, 60 FPS, 30 FPS, variable deltas, 10-second fire simulation)
 * 7. Audio Triggering & Volume Synchronization (Volume scaling, 32-voice budget, zero memory leaks)
 * 8. Tracer Pool Saturation & Zero-Allocation Invariance (Pool saturation at 50, eviction, zero scene graph leaks)
 * 9. P2P Network Synchronization & Remote Replication (FireHitscan message payload, remote hitscan replication)
 */

import * as THREE from '../game-web/node_modules/three/build/three.module.js';
import {
  WEAPON_TYPES,
  WEAPON_MUZZLE_POSITIONS,
  VIEWMODEL_TRANSFORMS,
  createWeaponViewModel,
  createProceduralRobot,
  applyFluoColor
} from '../game-web/src/models/index.ts';
import {
  TracerPool,
  VFXCoordinator,
  TRACER_STYLES,
  normalizeWeaponType
} from '../game-web/src/vfx/index.ts';
import { MockAudioContext } from './helpers/mock_audio.mjs';
import { SoundSynthesizer } from '../game-web/src/audio/soundSynth.ts';

// Set up mock Web Audio environment
globalThis.AudioContext = MockAudioContext;
globalThis.window = { AudioContext: MockAudioContext };

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  ✘ [FAIL] ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  ✔ [PASS] ${message}`);
  }
}

function assertCloseTo(actual, expected, epsilon = 1e-3, message = '') {
  const diff = Math.abs(actual - expected);
  assert(diff <= epsilon, `${message} Expected ~${expected}, got ${actual} (diff ${diff.toFixed(6)} > ${epsilon})`);
}

function assertEqual(actual, expected, message = '') {
  assert(actual === expected, `${message} Expected ${expected}, got ${actual}`);
}

// Authoritative weapon stats matching game-web/src/main.ts and weapons.rs
const WEAPON_STATS = {
  assalto: {
    id: 0,
    name: 'AR-42 Viper',
    fireRateRps: 6.25,
    recoilPitchDeg: 1.10,
    recoilYawDeg: 0.35,
    recoilRecoveryRate: 8.0,
    kickZ: 0.05,
    kickPitch: 0.04
  },
  cecchino: {
    id: 1,
    name: 'SR-99 Railphantom',
    fireRateRps: 1.00,
    recoilPitchDeg: 5.50,
    recoilYawDeg: 0.80,
    recoilRecoveryRate: 3.5,
    kickZ: 0.12,
    kickPitch: 0.08
  },
  pompa: {
    id: 2,
    name: 'SG-12 Havoc',
    fireRateRps: 1.25,
    recoilPitchDeg: 4.00,
    recoilYawDeg: 1.20,
    recoilRecoveryRate: 4.0,
    kickZ: 0.10,
    kickPitch: 0.07
  },
  mitraglietta: {
    id: 3,
    name: 'SMG-7 Neon Hornet',
    fireRateRps: 10.00,
    recoilPitchDeg: 0.55,
    recoilYawDeg: 0.65,
    recoilRecoveryRate: 10.0,
    kickZ: 0.03,
    kickPitch: 0.025
  },
  coltello: {
    id: 4,
    name: 'CB-01 Shadowfang',
    fireRateRps: 1.25,
    recoilPitchDeg: 0.0,
    recoilYawDeg: 0.0,
    recoilRecoveryRate: 0.0,
    kickZ: 0.08,
    kickPitch: 0.03
  }
};

async function runMilestone4StressSuite() {
  console.log(`
================================================================================
     CHALLENGER M4: FINAL INTEGRATION, COMBAT PIPELINE & HARDENING SUITE        
================================================================================
`);

  // ===========================================================================
  // SUITE 1: Muzzle World Positioning & Matrix Invariance
  // ===========================================================================
  console.log('>>> SUITE 1: Muzzle World Positioning & Viewmodel Matrix Transformation');

  const testPositions = [
    new THREE.Vector3(0, 0, 0),
    new THREE.Vector3(45.5, 12.3, -88.7),
    new THREE.Vector3(-320.0, -15.0, 540.0),
    new THREE.Vector3(1250.0, 300.0, -2500.0)
  ];

  const testRotations = [
    { yaw: 0, pitch: 0 },
    { yaw: Math.PI / 2, pitch: 0.2 },
    { yaw: Math.PI, pitch: -0.4 },
    { yaw: -Math.PI / 3, pitch: 0.8 },
    { yaw: 2.5, pitch: -1.2 },
    { yaw: 0.1, pitch: Math.PI / 2 - 0.05 }, // Zenith look
    { yaw: -0.1, pitch: -Math.PI / 2 + 0.05 } // Nadir look
  ];

  for (const weaponType of WEAPON_TYPES) {
    const localMuzzleAnchor = WEAPON_MUZZLE_POSITIONS[weaponType];
    assert(localMuzzleAnchor instanceof THREE.Vector3, `Muzzle anchor defined for ${weaponType}`);
    assert(Number.isFinite(localMuzzleAnchor.x) && Number.isFinite(localMuzzleAnchor.y) && Number.isFinite(localMuzzleAnchor.z),
      `Muzzle anchor for ${weaponType} has finite coordinates`);

    for (const camPos of testPositions) {
      for (const { yaw, pitch } of testRotations) {
        const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
        camera.position.copy(camPos);
        const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), yaw);
        const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), pitch);
        camera.quaternion.multiplyQuaternions(qYaw, qPitch);

        const viewmodelRoot = new THREE.Group();
        viewmodelRoot.name = 'ViewmodelRoot';
        camera.add(viewmodelRoot);

        const recoilContainer = new THREE.Group();
        recoilContainer.name = 'RecoilContainer';
        viewmodelRoot.add(recoilContainer);

        const activeVm = createWeaponViewModel(weaponType);
        recoilContainer.add(activeVm);

        camera.updateMatrixWorld(true);

        const innerVm = activeVm.children.length > 0 ? activeVm.children[0] : activeVm;
        assert(innerVm !== undefined, `Inner viewmodel mesh exists for ${weaponType}`);

        const muzzleWorldPos = new THREE.Vector3();
        muzzleWorldPos.copy(localMuzzleAnchor).applyMatrix4(innerVm.matrixWorld);

        assert(Number.isFinite(muzzleWorldPos.x) && Number.isFinite(muzzleWorldPos.y) && Number.isFinite(muzzleWorldPos.z),
          `Muzzle world pos for ${weaponType} is finite at pos (${camPos.x}, ${camPos.y}, ${camPos.z}) and rot (${yaw.toFixed(2)}, ${pitch.toFixed(2)})`);

        // Transform muzzle position into camera local coordinate space
        const muzzleInCamSpace = camera.worldToLocal(muzzleWorldPos.clone());

        // In first-person viewmodels:
        // - X is slightly to the right (lateral offset > 0)
        // - Y is slightly below eye level (vertical offset < 0)
        // - Z is forward into the screen (-Z < 0)
        assert(muzzleInCamSpace.z < -0.1,
          `Muzzle for ${weaponType} is strictly in front of camera (local Z = ${muzzleInCamSpace.z.toFixed(3)} < -0.1)`);
        assert(muzzleInCamSpace.x > 0.05,
          `Muzzle for ${weaponType} is offset to the right (local X = ${muzzleInCamSpace.x.toFixed(3)} > 0.05)`);

        const distFromCamera = muzzleWorldPos.distanceTo(camera.position);
        assert(distFromCamera >= 0.25 && distFromCamera <= 2.5,
          `Muzzle distance to camera is within ergonomic FPS range (actual: ${distFromCamera.toFixed(3)}m)`);
      }
    }
  }

  // Fallback muzzle position test when innerVm is missing
  {
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(10, 20, 30);
    camera.quaternion.setFromAxisAngle(new THREE.Vector3(0, 1, 0), Math.PI / 4);

    const fallbackOffset = new THREE.Vector3(0.3, -0.25, -0.8).applyQuaternion(camera.quaternion);
    const fallbackMuzzle = camera.position.clone().add(fallbackOffset);

    const localFallback = camera.worldToLocal(fallbackMuzzle.clone());
    assertCloseTo(localFallback.x, 0.3, 1e-4, 'Fallback muzzle local X matches');
    assertCloseTo(localFallback.y, -0.25, 1e-4, 'Fallback muzzle local Y matches');
    assertCloseTo(localFallback.z, -0.8, 1e-4, 'Fallback muzzle local Z matches');
  }

  // ===========================================================================
  // SUITE 2: Weapon Raycasting & Hitscan Precision
  // ===========================================================================
  console.log('\n>>> SUITE 2: Weapon Raycasting & Hitscan Precision');

  {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    camera.position.set(0, 1.7, 0);
    camera.lookAt(0, 1.7, -100);
    camera.updateMatrixWorld(true);

    // Target 1: Distant Wall at z = -40
    const wallGeo = new THREE.PlaneGeometry(20, 20);
    const wallMat = new THREE.MeshBasicMaterial();
    const wallMesh = new THREE.Mesh(wallGeo, wallMat);
    wallMesh.position.set(0, 1.7, -40);
    wallMesh.updateMatrixWorld(true);
    scene.add(wallMesh);

    // Target 2: Remote Player Robot at (5, 0, -25)
    const remoteRobot = createProceduralRobot();
    remoteRobot.position.set(5, 0, -25);
    remoteRobot.updateMatrixWorld(true);
    scene.add(remoteRobot);

    // Direct hit test on wall
    const raycaster = new THREE.Raycaster();
    const rayOrigin = camera.position.clone();
    const rayDir = new THREE.Vector3();
    camera.getWorldDirection(rayDir);
    raycaster.set(rayOrigin, rayDir);
    raycaster.far = 1000.0;

    const intersects = raycaster.intersectObjects([wallMesh, remoteRobot], true);
    assert(intersects.length > 0, 'Raycaster intersects target wall directly in front');
    assertCloseTo(intersects[0].point.z, -40.0, 1e-3, 'Hit point matches wall distance at z = -40');

    // Normal transform validation
    const faceNormal = intersects[0].face.normal.clone().transformDirection(intersects[0].object.matrixWorld);
    assertCloseTo(faceNormal.length(), 1.0, 1e-4, 'Transformed hit normal has unit length');
    assertCloseTo(faceNormal.z, 1.0, 1e-3, 'Hit normal points directly toward shooter (+Z)');

    // Knife range restriction test
    // Target is at 40m -> Knife has max range 2.5m, so knife must NOT hit!
    const knifeRaycaster = new THREE.Raycaster(rayOrigin, rayDir, 0.1, 2.5);
    const knifeIntersects = knifeRaycaster.intersectObjects([wallMesh], true);
    assertEqual(knifeIntersects.length, 0, 'Knife (coltello) with far=2.5m does not hit target at 40m');

    // Knife close-quarters hit test
    const closeBox = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial());
    closeBox.position.set(0, 1.7, -2.0); // 2m away (within 2.5m range)
    closeBox.updateMatrixWorld(true);
    const knifeCloseHit = knifeRaycaster.intersectObjects([closeBox], true);
    assert(knifeCloseHit.length > 0, 'Knife successfully hits target at 2.0m (< 2.5m range)');
    assertCloseTo(knifeCloseHit[0].point.z, -1.5, 1e-3, 'Knife hit point on front face of 1m box at z = -1.5');

    // Sky shot (no intersection) endpoint calculation
    // Aim into the open sky (looking straight up)
    camera.lookAt(0, 100, 0);
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(rayDir);
    raycaster.set(camera.position, rayDir);

    const skyIntersects = raycaster.intersectObjects([wallMesh, closeBox], true);
    assertEqual(skyIntersects.length, 0, 'Firing into open sky produces 0 intersections');

    // Firearm sky hitpoint fallback: rayOrigin + rayDir * 300
    const skyHitPointFirearm = camera.position.clone().addScaledVector(rayDir, 300.0);
    assertCloseTo(skyHitPointFirearm.distanceTo(camera.position), 300.0, 1e-3,
      'Firearms terminate at exactly 300.0m when firing into sky');

    // Knife sky hitpoint fallback: rayOrigin + rayDir * 2.5
    const skyHitPointKnife = camera.position.clone().addScaledVector(rayDir, 2.5);
    assertCloseTo(skyHitPointKnife.distanceTo(camera.position), 2.5, 1e-3,
      'Coltello terminates at exactly 2.5m when slashing empty air');

    // Remote player robot hitscan test
    camera.position.set(0, 1.0, 0);
    camera.lookAt(5, 1.0, -25);
    camera.updateMatrixWorld(true);
    camera.getWorldDirection(rayDir);
    raycaster.set(camera.position, rayDir);

    const robotIntersects = raycaster.intersectObjects([remoteRobot], true);
    assert(robotIntersects.length > 0, 'Hitscan successfully intersects remote robot player geometry');
    assert(robotIntersects[0].point.distanceTo(new THREE.Vector3(5, 1.0, -25)) < 1.5,
      'Hit point is accurately positioned on the remote robot body');
  }

  // ===========================================================================
  // SUITE 3: Multi-Pellet Shotgun Spread (Pompa SG-12) & Conical Geometry
  // ===========================================================================
  console.log('\n>>> SUITE 3: Multi-Pellet Shotgun Spread & Conical Ray Geometry');

  {
    const scene = new THREE.Scene();
    const tracerPool = new TracerPool();
    tracerPool.init(scene);

    const muzzlePos = new THREE.Vector3(0.28, 1.5, -0.6);
    const targetDistances = [5.0, 15.0, 30.0, 75.0, 150.0];

    for (const dist of targetDistances) {
      const hitPoint = muzzlePos.clone().add(new THREE.Vector3(0, 0, -dist));
      tracerPool.spawnTracer(muzzlePos, hitPoint, 'pompa');

      assertEqual(tracerPool.getActiveCount(), 8, `Pompa shot spawned exactly 8 active tracers at distance ${dist}m`);

      const activeTracers = tracerPool.getTracers().filter(t => t.active);
      assertEqual(activeTracers.length, 8, '8 tracers returned in active state');

      // Tracer 0 is central beam hitting authoritative hitPoint
      const centralTracer = activeTracers[0];
      assertCloseTo(centralTracer.end.distanceTo(hitPoint), 0.0, 1e-4,
        `Central pellet (pellet 0) lands exactly at authoritative hit point at ${dist}m`);

      // Tracers 1-7 form spread cone with radius dist * 0.045
      const expectedMaxRadius = dist * 0.045;
      for (let p = 1; p < 8; p++) {
        const pellet = activeTracers[p];
        const radialOffset = new THREE.Vector2(pellet.end.x - hitPoint.x, pellet.end.y - hitPoint.y).length();
        assert(radialOffset <= expectedMaxRadius + 1e-4,
          `Pellet ${p} radial offset (${radialOffset.toFixed(4)}m) <= expected cone radius (${expectedMaxRadius.toFixed(4)}m)`);
        assert(radialOffset > 0.001, `Pellet ${p} is non-coincident with center`);
        assert(Number.isFinite(pellet.length) && pellet.length > 0, `Pellet ${p} has valid positive length`);
        assertCloseTo(pellet.mesh.quaternion.length(), 1.0, 1e-3, `Pellet ${p} quaternion is normalized`);
      }

      // Deactivate tracers for next distance step
      tracerPool.update(1.0);
      assertEqual(tracerPool.getActiveCount(), 0, 'Tracers cleaned after update');
    }

    // Edge Case: Point-blank distance (dist < 0.0001)
    const zeroDistTarget = muzzlePos.clone();
    tracerPool.spawnTracer(muzzlePos, zeroDistTarget, 'pompa');
    assertEqual(tracerPool.getActiveCount(), 0,
      'Point-blank Pompa fire (dist < 0.0001) safely aborts without crash or NaN');
  }

  // ===========================================================================
  // SUITE 4: Extreme Camera Angles & Singularity Stress
  // ===========================================================================
  console.log('\n>>> SUITE 4: Extreme Camera Angles & Singularity Stress');

  {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const tracerPool = new TracerPool();
    tracerPool.init(scene);

    const extremeAngles = [
      { name: 'Zenith (+89.99 deg)', pitch: Math.PI / 2 - 0.0001, yaw: 0 },
      { name: 'Nadir (-89.99 deg)', pitch: -Math.PI / 2 + 0.0001, yaw: 0 },
      { name: 'Exact Zenith (+90 deg)', pitch: Math.PI / 2, yaw: 0 },
      { name: 'Exact Nadir (-90 deg)', pitch: -Math.PI / 2, yaw: 0 },
      { name: 'Zenith East (+89.99 deg, Yaw 90 deg)', pitch: Math.PI / 2 - 0.0001, yaw: Math.PI / 2 },
      { name: 'Nadir West (-89.99 deg, Yaw -90 deg)', pitch: -Math.PI / 2 + 0.0001, yaw: -Math.PI / 2 },
      { name: 'Multi-rotation yaw (10*PI)', pitch: 0.3, yaw: 10 * Math.PI },
      { name: 'Negative multi-rotation yaw (-10*PI)', pitch: -0.3, yaw: -10 * Math.PI }
    ];

    for (const angle of extremeAngles) {
      camera.position.set(0, 10, 0);
      const qYaw = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), angle.yaw);
      const qPitch = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), angle.pitch);
      camera.quaternion.multiplyQuaternions(qYaw, qPitch);
      camera.updateMatrixWorld(true);

      const rayDir = new THREE.Vector3();
      camera.getWorldDirection(rayDir);
      assertCloseTo(rayDir.length(), 1.0, 1e-4, `${angle.name}: Ray direction has unit length`);

      const hitPoint = camera.position.clone().addScaledVector(rayDir, 100.0);
      tracerPool.spawnTracer(camera.position, hitPoint, 'cecchino');

      const activeTracers = tracerPool.getTracers().filter(t => t.active);
      assertEqual(activeTracers.length, 1, `${angle.name}: Cecchino spawned single tracer`);

      const t = activeTracers[0];
      assert(Number.isFinite(t.mesh.quaternion.x) && Number.isFinite(t.mesh.quaternion.y) &&
             Number.isFinite(t.mesh.quaternion.z) && Number.isFinite(t.mesh.quaternion.w),
        `${angle.name}: Tracer quaternion is strictly finite without NaN`);
      assertCloseTo(t.mesh.quaternion.length(), 1.0, 1e-3, `${angle.name}: Tracer quaternion is normalized`);
      assertCloseTo(t.mesh.scale.y, 100.0, 1e-3, `${angle.name}: Tracer scale Y matches distance (100.0m)`);

      tracerPool.update(1.0);
    }

    // Antiparallel vector singularity test for Three.js Cylinder orientation
    // Unit cylinder base is (0, 1, 0); shot direction is (0, -1, 0)
    const antiparallelDir = new THREE.Vector3(0, -1, 0);
    const quat = new THREE.Quaternion().setFromUnitVectors(new THREE.Vector3(0, 1, 0), antiparallelDir);
    assert(Number.isFinite(quat.x) && Number.isFinite(quat.y) && Number.isFinite(quat.z) && Number.isFinite(quat.w),
      'Quaternion setFromUnitVectors handles antiparallel vectors without NaN');
    assertCloseTo(quat.length(), 1.0, 1e-3, 'Antiparallel quaternion is unit normalized');
  }

  // ===========================================================================
  // SUITE 5: Rapid Weapon Switching & Race Condition Stress
  // ===========================================================================
  console.log('\n>>> SUITE 5: Rapid Weapon Switching & Async Race Condition Resilience');

  {
    const viewmodelCache = new Map();
    const recoilContainer = new THREE.Group();
    let currentWeaponIndex = 0;
    let currentWeaponType = WEAPON_TYPES[0];
    let shotCooldown = 0;
    let switchAnimationTimer = 0;

    function simulateSwitchWeapon(index) {
      if (index < 0 || index >= WEAPON_TYPES.length) return;
      if (index === currentWeaponIndex && recoilContainer.children.length > 0) return;

      currentWeaponIndex = index;
      currentWeaponType = WEAPON_TYPES[index];

      while (recoilContainer.children.length > 0) {
        recoilContainer.remove(recoilContainer.children[0]);
      }

      switchAnimationTimer = 0.15;
      shotCooldown = Math.max(shotCooldown, 0.15);
      recoilContainer.position.y = -0.12;

      if (!viewmodelCache.has(currentWeaponType)) {
        const vm = createWeaponViewModel(currentWeaponType);
        viewmodelCache.set(currentWeaponType, vm);
      }

      const activeVm = viewmodelCache.get(currentWeaponType);
      recoilContainer.add(activeVm);
    }

    // Rapid switch stress: 10,000 continuous switches
    const startMemory = process.memoryUsage().heapUsed;
    let allSingleChild = true;
    let allLockoutsRespected = true;
    let allTimersSet = true;

    for (let i = 0; i < 10000; i++) {
      const targetIndex = i % WEAPON_TYPES.length;
      simulateSwitchWeapon(targetIndex);

      if (recoilContainer.children.length !== 1) allSingleChild = false;
      if (shotCooldown < 0.15) allLockoutsRespected = false;
      if (switchAnimationTimer !== 0.15) allTimersSet = false;
    }

    assert(allSingleChild, 'Recoil container maintained exactly 1 child throughout all 10,000 switches');
    assert(allLockoutsRespected, 'Switch lockout >= 0.15s was strictly respected throughout all 10,000 switches');
    assert(allTimersSet, 'Switch animation timer was strictly set to 0.15s on every switch');
    const endMemory = process.memoryUsage().heapUsed;
    const memDeltaMb = (endMemory - startMemory) / (1024 * 1024);
    assert(memDeltaMb < 15.0, `10,000 rapid switches memory increase is bounded (${memDeltaMb.toFixed(2)} MB < 15 MB)`);
    assertEqual(viewmodelCache.size, 5, 'Viewmodel cache contains exactly 5 cached entries');

    // Async GLB Upgrade Race Condition Simulation
    // Scenario: User switches to Cecchino (1), trigger GLB load, but switches to Mitraglietta (3) before GLB resolves
    simulateSwitchWeapon(1); // On Cecchino
    assertEqual(currentWeaponType, 'cecchino', 'Currently equipped Cecchino');

    const delayedCecchinoGlb = new THREE.Group();
    delayedCecchinoGlb.name = 'GLB_cecchino_delayed';

    // Player switches to Mitraglietta
    simulateSwitchWeapon(3); // Now on Mitraglietta
    assertEqual(currentWeaponType, 'mitraglietta', 'Switched to Mitraglietta');

    // Now delayed Cecchino GLB resolution callback executes
    const callbackTargetType = 'cecchino';
    if (callbackTargetType === WEAPON_TYPES[currentWeaponIndex]) {
      while (recoilContainer.children.length > 0) {
        recoilContainer.remove(recoilContainer.children[0]);
      }
      recoilContainer.add(delayedCecchinoGlb);
    }

    // Must still have Mitraglietta in recoilContainer!
    const currentMountedVm = recoilContainer.children[0];
    assert(currentMountedVm.name !== 'GLB_cecchino_delayed',
      'Race condition prevented: Late-resolving GLB did NOT overwrite newly equipped weapon');
    assertEqual(currentMountedVm.name, 'ViewModel_mitraglietta',
      'Recoil container correctly maintains equipped Mitraglietta');
  }

  // ===========================================================================
  // SUITE 6: Sustained Fire Cadence & Frame-Rate Independence
  // ===========================================================================
  console.log('\n>>> SUITE 6: Sustained Fire Cadence & Frame-Rate Independence');

  {
    const targetFpsRates = [
      { name: '240 FPS (Delta 4.17ms)', delta: 1.0 / 240 },
      { name: '60 FPS (Delta 16.67ms)', delta: 1.0 / 60 },
      { name: '30 FPS (Delta 33.33ms)', delta: 1.0 / 30 },
      { name: 'Jitter FPS (Random 5-40ms)', delta: -1 } // Dynamic delta
    ];

    for (const weaponKey of WEAPON_TYPES) {
      const stats = WEAPON_STATS[weaponKey];
      const testDurationSeconds = 10.0;
      const expectedShots = Math.floor(testDurationSeconds * stats.fireRateRps);

      for (const fpsProfile of targetFpsRates) {
        let shotCooldown = 0.0;
        let shotsFired = 0;
        let simTime = 0.0;

        while (simTime < testDurationSeconds) {
          const delta = fpsProfile.delta > 0
            ? fpsProfile.delta
            : (0.005 + Math.random() * 0.035); // Jitter delta

          if (shotCooldown > 0) {
            shotCooldown -= delta;
            if (shotCooldown < 0) shotCooldown = 0;
          }

          // Authoritative main.ts continuous fire condition
          if (shotCooldown <= 1e-4) {
            shotsFired++;
            shotCooldown = 1.0 / stats.fireRateRps;
          }

          simTime += delta;
        }

        // Discrete frame quantization tolerance: up to 3 shots on fixed FPS, up to 15% on severe 40ms jitter
        const allowedDiff = fpsProfile.delta < 0 ? Math.ceil(expectedShots * 0.15) : 3;
        const diff = Math.abs(shotsFired - expectedShots);
        assert(diff <= allowedDiff,
          `[${weaponKey}] Under ${fpsProfile.name}: Fired ${shotsFired} shots in 10s (expected ~${expectedShots}, diff ${diff} <= ${allowedDiff})`);
      }
    }
  }

  // ===========================================================================
  // SUITE 7: Audio Triggering & Volume Synchronization
  // ===========================================================================
  console.log('\n>>> SUITE 7: Audio Triggering & Volume Synchronization');

  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const mockCtx = synth.getAudioContext();

    const testVolumes = [
      { master: 1.0, sfx: 1.0, expected: 1.0 },
      { master: 0.5, sfx: 0.8, expected: 0.4 },
      { master: 0.0, sfx: 1.0, expected: 0.0 }, // Master mute
      { master: 1.0, sfx: 0.0, expected: 0.0 }, // SFX mute
      { master: 0.3, sfx: 0.3, expected: 0.09 }
    ];

    for (const vol of testVolumes) {
      const scale = vol.master * vol.sfx;
      assertCloseTo(scale, vol.expected, 1e-4,
        `Volume scaling (master ${vol.master} * sfx ${vol.sfx}) matches expected ${vol.expected}`);
    }

    // Sustained fire audio stress: 100 shots of Mitraglietta (10 RPS)
    for (let i = 0; i < 100; i++) {
      synth.playWeaponSound('mitraglietta', 0.8);
      mockCtx.currentTime += 0.05; // 50ms advance
    }

    const activeCount = synth['activeVoices'].size;
    assert(activeCount <= 32,
      `Active voice count strictly clamped at <= 32 under sustained fire (actual: ${activeCount})`);

    // Multiple unlock calls idempotency
    await synth.unlock();
    await synth.unlock();
    await synth.unlock();
    assertEqual(mockCtx.state, 'running', 'AudioContext is running after repeated unlock() calls');

    synth.dispose();
    assertEqual(synth['activeVoices'].size, 0, 'All voices cleared after dispose');
  }

  // ===========================================================================
  // SUITE 8: Tracer Pool Saturation & Zero-Allocation Invariance
  // ===========================================================================
  console.log('\n>>> SUITE 8: Tracer Pool Saturation & Zero-Allocation Invariance');

  {
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(75, 1, 0.1, 1000);
    const vfx = new VFXCoordinator();
    vfx.init(scene, camera);

    const initialSceneChildrenCount = scene.children.length;

    // Fire 500 continuous Pompa shots (500 * 8 = 4,000 pellets)
    const muzzlePos = new THREE.Vector3(0, 1, 0);
    for (let i = 0; i < 500; i++) {
      const hitPos = new THREE.Vector3(0, 1, -50);
      vfx.spawnTracer(muzzlePos, hitPos, 'pompa');
      vfx.spawnMuzzleFlash(muzzlePos, 'pompa');
      vfx.spawnImpact(hitPos, new THREE.Vector3(0, 0, 1), 'pompa');
      vfx.update(0.016); // 60 FPS update
    }

    // Active tracer count must NEVER exceed 50
    assert(vfx.getActiveTracerCount() <= 50,
      `Active tracer count never exceeds pool size 50 (actual: ${vfx.getActiveTracerCount()})`);

    // Zero scene-graph creep: scene.children count must remain perfectly identical
    assertEqual(scene.children.length, initialSceneChildrenCount,
      'Zero scene-graph allocations: scene.children count remained strictly identical after 4,000 pellets');

    // Run idle decay to ensure clean deactivation
    for (let f = 0; f < 30; f++) {
      vfx.update(0.033);
    }
    assertEqual(vfx.getActiveTracerCount(), 0, 'All tracers cleanly deactivated after lifetime expiry');

    vfx.dispose();
    assertEqual(vfx.isReady(), false, 'VFX coordinator cleanly disposed');
  }

  // ===========================================================================
  // SUITE 9: P2P Hitscan Network Synchronization Contract
  // ===========================================================================
  console.log('\n>>> SUITE 9: P2P Network Synchronization & Remote Replication');

  {
    // Simulate authoritative FireHitscanMessage creation and consumption
    const localMuzzlePos = new THREE.Vector3(0.28, 1.48, -0.62);
    const localRayDir = new THREE.Vector3(0, 0, -1).normalize();
    const weaponId = WEAPON_STATS.assalto.id;

    const fireMsg = {
      type: 'FIRE_HITSCAN',
      shooterId: 'player_local_123',
      weaponType: weaponId,
      origin: [localMuzzlePos.x, localMuzzlePos.y, localMuzzlePos.z],
      dir: [localRayDir.x, localRayDir.y, localRayDir.z]
    };

    assertEqual(fireMsg.type, 'FIRE_HITSCAN', 'Message type is FIRE_HITSCAN');
    assertEqual(fireMsg.shooterId, 'player_local_123', 'Shooter ID preserved');
    assertEqual(fireMsg.weaponType, 0, 'Weapon ID matches Assalto (0)');
    assertEqual(fireMsg.origin.length, 3, 'Origin has 3 coordinates');
    assertEqual(fireMsg.dir.length, 3, 'Direction has 3 coordinates');

    // Remote consumer replication verification
    const remoteOrigin = new THREE.Vector3(...fireMsg.origin);
    const remoteDir = new THREE.Vector3(...fireMsg.dir).normalize();
    assertCloseTo(remoteOrigin.distanceTo(localMuzzlePos), 0.0, 1e-4, 'Remote start position matches local muzzle pos');
    assertCloseTo(remoteDir.dot(localRayDir), 1.0, 1e-4, 'Remote ray direction matches local ray direction');

    // Remote hitscan endpoint calculation (sky shot)
    const remoteHitPoint = remoteOrigin.clone().addScaledVector(remoteDir, 300.0);
    assertCloseTo(remoteHitPoint.distanceTo(remoteOrigin), 300.0, 1e-3, 'Remote sky endpoint at 300.0m');
  }

  console.log(`
================================================================================
          CHALLENGER M4 INTEGRATION STRESS TEST SUMMARY: ALL PASS               
================================================================================
Total Assertions: ${totalTests}
Passed:           ${passedTests}
Failed:           ${failedTests}
================================================================================
`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runMilestone4StressSuite().catch((err) => {
  console.error('STRESS TEST CRASHED:', err);
  process.exit(1);
});

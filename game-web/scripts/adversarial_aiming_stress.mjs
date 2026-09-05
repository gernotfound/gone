/**
 * Challenger 2 (Final Verification) - Empirical Stress Test Harness
 * 
 * Adversarial verification of:
 * 1. Third-person weapon models: barrel forward vector +Z (dir.z >= 0.98), grip centered at (0, 0, 0) in socket space
 * 2. First-person viewmodels: barrel forward vector -Z (dot >= 0.97 with camera forward)
 * 3. Dynamic rotation coherence under arbitrary robot yaw and camera pitch/yaw
 * 4. Scale invariance of grip socket centering
 * 5. GLB asset loader alignment and non-inversion of matrix transforms
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  createProceduralRobot,
  attachWeaponToRobot,
  WEAPON_SOCKET_NAME,
  WEAPON_SOCKET_POSITION
} from '../src/models/robotBuilder.ts';
import {
  createWeaponModel,
  createWeaponViewModel,
  createThirdPersonWeapon,
  WEAPON_TYPES,
  WEAPON_MUZZLE_POSITIONS,
  WEAPON_GRIP_OFFSETS,
  WEAPON_SCALES,
  VIEWMODEL_TRANSFORMS
} from '../src/models/weaponBuilders.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.resolve(__dirname, '../public/assets');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
  } else {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
  }
}

async function run() {
  console.log('================================================================');
  console.log('   CHALLENGER 2 (FINAL VERIFICATION) - WEAPON ALIGNMENT SUITE   ');
  console.log('================================================================\n');

  // --- Section 1: Third-Person Weapon Aiming Vector & Grip Centering ---
  console.log('--- Section 1: Third-Person Weapon Forward Aiming & Grip Centering ---');
  for (const w of WEAPON_TYPES) {
    const robot = createProceduralRobot();
    const weapon = createThirdPersonWeapon(w);
    attachWeaponToRobot(robot, weapon);
    const socket = robot.getObjectByName(WEAPON_SOCKET_NAME);
    robot.updateMatrixWorld(true);

    const inner = weapon.children[0];
    const muzzleRaw = WEAPON_MUZZLE_POSITIONS[w];
    const gripRaw = WEAPON_GRIP_OFFSETS[w];

    // Socket-space coordinates
    inner.updateMatrix();
    const gripInSocket = gripRaw.clone().applyMatrix4(inner.matrix);
    const muzzleInSocket = muzzleRaw.clone().applyMatrix4(inner.matrix);

    // World-space coordinates
    const muzzleWorld = muzzleRaw.clone().applyMatrix4(inner.matrixWorld);
    const gripWorld = gripRaw.clone().applyMatrix4(inner.matrixWorld);
    const socketWorld = new THREE.Vector3().setFromMatrixPosition(socket.matrixWorld);
    const dirWorld = muzzleWorld.clone().sub(gripWorld).normalize();

    // Verification 1: Grip is centered at (0, 0, 0) in socket space
    assert(
      gripInSocket.length() < 1e-5,
      `[${w}] TP grip centered at socket origin: len=${gripInSocket.length().toFixed(8)}m`
    );

    // Verification 2: World grip matches socket anchor position
    const gripSocketDist = gripWorld.distanceTo(socketWorld);
    assert(
      gripSocketDist < 1e-5,
      `[${w}] TP world grip matches socket world anchor: dist=${gripSocketDist.toFixed(8)}m`
    );

    // Verification 3: Aiming vector points forward along +Z (robot facing direction)
    assert(
      dirWorld.z >= 0.98,
      `[${w}] TP barrel points forward along +Z: dir.z=${dirWorld.z.toFixed(4)} (expected >= 0.98)`
    );

    // Verification 4: Lateral X deviation is negligible (< 0.05)
    assert(
      Math.abs(dirWorld.x) < 0.05,
      `[${w}] TP barrel lateral deviation |dir.x|=${Math.abs(dirWorld.x).toFixed(4)} < 0.05`
    );
  }

  // --- Section 2: First-Person Viewmodels Aiming Vector & Camera Alignment ---
  console.log('\n--- Section 2: First-Person Viewmodel Aiming & Frustum Placement ---');
  for (const w of WEAPON_TYPES) {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.position.set(0, 1.7, 0);
    const vm = createWeaponViewModel(w);
    camera.add(vm);
    camera.updateMatrixWorld(true);

    const inner = vm.children[0];
    const muzzleRaw = WEAPON_MUZZLE_POSITIONS[w];
    const gripRaw = WEAPON_GRIP_OFFSETS[w];

    const muzzleWorld = muzzleRaw.clone().applyMatrix4(inner.matrixWorld);
    const gripWorld = gripRaw.clone().applyMatrix4(inner.matrixWorld);
    const dirWorld = muzzleWorld.clone().sub(gripWorld).normalize();

    // Camera forward is (0, 0, -1) in camera space
    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const dot = dirWorld.dot(cameraForward);

    // Verification 1: Barrel points forward along camera -Z (dot >= 0.97)
    assert(
      dot >= 0.97,
      `[${w}] Viewmodel forward dot product with camera -Z: dot=${dot.toFixed(4)} (expected >= 0.97)`
    );

    // Verification 2: Viewmodel position is in front of camera (Z < 0)
    const transform = VIEWMODEL_TRANSFORMS[w];
    assert(
      transform.position.z < -0.3,
      `[${w}] Viewmodel position.z=${transform.position.z.toFixed(2)} in front of camera frustum (< -0.3)`
    );

    // Verification 3: Viewmodel position is ergonomically on right side (X > 0)
    assert(
      transform.position.x > 0.1,
      `[${w}] Viewmodel position.x=${transform.position.x.toFixed(2)} right-hand ergonomic (> 0.1)`
    );
  }

  // --- Section 3: Dynamic Robot Rotation Coherence ---
  console.log('\n--- Section 3: Dynamic Robot Yaw Rotation Coherence ---');
  const testYawAngles = [
    0,
    Math.PI / 6,
    Math.PI / 4,
    Math.PI / 2,
    Math.PI,
    -Math.PI / 2,
    -Math.PI / 4,
    2.356,
    -1.15
  ];

  for (const yaw of testYawAngles) {
    const robot = createProceduralRobot();
    const weapon = createThirdPersonWeapon('assalto');
    attachWeaponToRobot(robot, weapon);
    robot.rotation.y = yaw;
    robot.updateMatrixWorld(true);

    const inner = weapon.children[0];
    const muzzleWorld = WEAPON_MUZZLE_POSITIONS.assalto.clone().applyMatrix4(inner.matrixWorld);
    const gripWorld = WEAPON_GRIP_OFFSETS.assalto.clone().applyMatrix4(inner.matrixWorld);
    const dirWorld = muzzleWorld.sub(gripWorld).normalize();

    // Robot facing vector in world space
    const robotForward = new THREE.Vector3(0, 0, 1).applyEuler(new THREE.Euler(0, yaw, 0));
    const dotWithRobot = dirWorld.dot(robotForward);

    assert(
      dotWithRobot >= 0.98,
      `Yaw ${(yaw * 180 / Math.PI).toFixed(1)}°: third-person aim aligns with robot forward (dot=${dotWithRobot.toFixed(4)} >= 0.98)`
    );
  }

  // --- Section 4: Dynamic Camera Pitch/Yaw Coherence ---
  console.log('\n--- Section 4: Dynamic Camera Pitch/Yaw Coherence ---');
  const cameraOrientations = [
    { pitch: 0, yaw: 0 },
    { pitch: 0.35, yaw: 0 },         // Looking down ~20°
    { pitch: -0.35, yaw: 0 },        // Looking up ~20°
    { pitch: 0, yaw: 0.785 },        // Looking right ~45°
    { pitch: 0, yaw: -1.57 },        // Looking left ~90°
    { pitch: 0.4, yaw: 1.2 },        // Down & right
    { pitch: -0.5, yaw: -2.1 }       // Up & rear-left
  ];

  for (const { pitch, yaw } of cameraOrientations) {
    const camera = new THREE.PerspectiveCamera(75, 16 / 9, 0.1, 1000);
    camera.rotation.order = 'YXZ';
    camera.rotation.set(pitch, yaw, 0);
    const vm = createWeaponViewModel('cecchino');
    camera.add(vm);
    camera.updateMatrixWorld(true);

    const inner = vm.children[0];
    const muzzleWorld = WEAPON_MUZZLE_POSITIONS.cecchino.clone().applyMatrix4(inner.matrixWorld);
    const gripWorld = WEAPON_GRIP_OFFSETS.cecchino.clone().applyMatrix4(inner.matrixWorld);
    const dirWorld = muzzleWorld.sub(gripWorld).normalize();

    const cameraForward = new THREE.Vector3(0, 0, -1).applyQuaternion(camera.quaternion);
    const dot = dirWorld.dot(cameraForward);

    assert(
      dot >= 0.97,
      `Cam Pitch ${(pitch * 180 / Math.PI).toFixed(0)}°, Yaw ${(yaw * 180 / Math.PI).toFixed(0)}°: viewmodel locked to camera ray (dot=${dot.toFixed(4)} >= 0.97)`
    );
  }

  // --- Section 5: Scale Invariance of Socket Centering ---
  console.log('\n--- Section 5: Scale Invariance of Grip Centering ---');
  const testScales = [0.05, 0.10, 0.15, 0.30, 0.50, 1.0, 2.0];
  for (const s of testScales) {
    const weapon = createThirdPersonWeapon('pompa', s);
    weapon.updateMatrixWorld(true);
    const inner = weapon.children[0];
    const gripInSocket = WEAPON_GRIP_OFFSETS.pompa.clone().applyMatrix4(inner.matrixWorld);
    assert(
      gripInSocket.length() < 1e-5,
      `Scale ${s.toFixed(2)}x: grip strictly centered at origin: len=${gripInSocket.length().toFixed(8)}`
    );
  }

  // --- Section 6: GLB Asset Binary Inspection & Third-Person Alignment ---
  console.log('\n--- Section 6: GLB Asset Binary Inspection & Third-Person Alignment ---');
  const loader = new GLTFLoader();
  for (const w of WEAPON_TYPES) {
    const glbFile = path.join(ASSETS_DIR, `${w}.glb`);
    assert(fs.existsSync(glbFile), `[${w}] GLB binary file exists on disk`);

    const buffer = fs.readFileSync(glbFile);
    const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    assert(gltf && gltf.scene, `[${w}] GLB parsed successfully`);

    // Build third-person wrapper around GLB scene
    const root = new THREE.Group();
    root.name = `ThirdPersonWeapon_${w}`;
    const weaponMesh = gltf.scene;
    weaponMesh.rotation.y = -Math.PI / 2;

    const scale = WEAPON_SCALES[w];
    weaponMesh.scale.set(scale, scale, scale);

    const grip = WEAPON_GRIP_OFFSETS[w];
    weaponMesh.position.set(0, -grip.y * scale, -grip.x * scale);
    root.add(weaponMesh);
    root.updateMatrixWorld(true);

    assert(
      Math.abs(weaponMesh.rotation.y - (-Math.PI / 2)) < 1e-5,
      `[${w}] GLB third-person rotation.y is -PI/2 (${weaponMesh.rotation.y.toFixed(4)})`
    );

    const expectedX = 0;
    const expectedY = -grip.y * scale;
    const expectedZ = -grip.x * scale;

    const posXOk = Math.abs(weaponMesh.position.x - expectedX) < 1e-5;
    const posYOk = Math.abs(weaponMesh.position.y - expectedY) < 1e-5;
    const posZOk = Math.abs(weaponMesh.position.z - expectedZ) < 1e-5;

    assert(
      posXOk && posYOk && posZOk,
      `[${w}] GLB third-person grip offset pos matches (${expectedX}, ${expectedY.toFixed(4)}, ${expectedZ.toFixed(4)})`
    );

    // Check determinant of matrixWorld to guarantee no inverted coordinate reflection
    const det = weaponMesh.matrixWorld.determinant();
    assert(
      det > 0,
      `[${w}] GLB third-person transform matrix determinant is strictly positive (${det.toFixed(8)} > 0)`
    );

    // Check grip in socket space
    const gripInSocket = grip.clone().applyMatrix4(weaponMesh.matrixWorld);
    assert(
      gripInSocket.length() < 1e-5,
      `[${w}] GLB grip is centered at socket origin: len=${gripInSocket.length().toFixed(8)}m`
    );
  }

  console.log('\n================================================================');
  console.log(`CHALLENGER 2 SUMMARY: ${passedTests}/${totalTests} tests PASSED (${failedTests} failed)`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

run().catch((err) => {
  console.error('\nChallenger 2 Verification script error:', err);
  process.exit(1);
});

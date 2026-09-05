/**
 * Verification script for G.O.N.E. 3D Model Assets and Builders.
 * Verifies GLB files, procedural fallbacks, 7 fluo accent meshes,
 * dynamic recoloring, weapon sockets, and viewmodel transforms.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

import {
  FLUO_PART_NAMES,
  FLUO_PART_POSITIONS,
  ROBOT_SCALE,
  WEAPON_SOCKET_POSITION,
  WEAPON_SOCKET_NAME,
  createProceduralRobot,
  createWeaponSocket,
  getFluoMeshes,
  applyFluoColor,
  attachWeaponToRobot,
  loadRobotModel,
  WEAPON_TYPES,
  WEAPON_SCALES,
  WEAPON_MUZZLE_POSITIONS,
  WEAPON_GRIP_OFFSETS,
  VIEWMODEL_TRANSFORMS,
  createWeaponModel,
  createWeaponViewModel,
  createThirdPersonWeapon,
  loadWeaponGLB,
  loadAllWeapons
} from '../src/models/index.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const ASSETS_DIR = path.resolve(__dirname, '../public/assets');

let passedTests = 0;
let totalTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    console.error(`❌ FAIL: ${message}`);
    throw new Error(message);
  }
  passedTests++;
  console.log(`✓ PASS: ${message}`);
}

async function run() {
  console.log('====================================================');
  console.log('   G.O.N.E. 3D ASSETS & MODEL BUILDERS VERIFICATION');
  console.log('====================================================\n');

  // 1. Verify 6 GLB files on disk
  console.log('--- 1. GLB File Presence & Parse ---');
  const glbFiles = ['assalto.glb', 'cecchino.glb', 'pompa.glb', 'mitraglietta.glb', 'coltello.glb', 'modello.glb'];
  const loader = new GLTFLoader();

  for (const filename of glbFiles) {
    const filePath = path.join(ASSETS_DIR, filename);
    assert(fs.existsSync(filePath), `GLB file exists: ${filename}`);
    const stat = fs.statSync(filePath);
    assert(stat.size > 10000, `${filename} size is ${stat.size} bytes (> 10KB)`);

    const buffer = fs.readFileSync(filePath);
    const gltf = await loader.parseAsync(buffer.buffer.slice(buffer.byteOffset, buffer.byteOffset + buffer.byteLength), '');
    assert(gltf && gltf.scene, `${filename} parsed successfully by GLTFLoader`);
  }

  // 2. Verify modello.glb fluo meshes
  console.log('\n--- 2. Modello GLB Fluo Accent Inspection ---');
  const modelloBuffer = fs.readFileSync(path.join(ASSETS_DIR, 'modello.glb'));
  const modelloGltf = await loader.parseAsync(modelloBuffer.buffer.slice(modelloBuffer.byteOffset, modelloBuffer.byteOffset + modelloBuffer.byteLength), '');
  let glbFluoCount = 0;
  modelloGltf.scene.traverse((c) => {
    if (c.isMesh) {
      const mat = Array.isArray(c.material) ? c.material[0] : c.material;
      if (mat && (mat.name === 'RobotFluoAccent' || (mat.emissive && mat.emissive.getHex() === 0x39ff14))) {
        glbFluoCount++;
      }
    }
  });
  assert(glbFluoCount === 7, `modello.glb contains exactly 7 fluo accent meshes (found: ${glbFluoCount})`);

  // 3. Verify Procedural Robot Builder & 7 Fluo Meshes
  console.log('\n--- 3. Procedural Robot Builder ---');
  const robot = createProceduralRobot();
  assert(robot instanceof THREE.Group, 'createProceduralRobot() returns a THREE.Group');
  assert(robot.name === 'CyberpunkRobot', 'Robot root group name is CyberpunkRobot');

  const fluoMeshes = getFluoMeshes(robot);
  assert(fluoMeshes.length === 7, `getFluoMeshes() returns exactly 7 meshes (found: ${fluoMeshes.length})`);

  // Verify each part name is represented
  const foundNames = fluoMeshes.map(m => m.userData.fluoPartName);
  for (const partName of FLUO_PART_NAMES) {
    assert(foundNames.includes(partName), `Fluo part present: ${partName}`);
  }

  // 4. Verify Fluo Color Recoloring
  console.log('\n--- 4. Fluo Color Recoloring ---');
  applyFluoColor(robot, '#FF007F'); // Neon Pink
  for (const mesh of fluoMeshes) {
    const mat = Array.isArray(mesh.material) ? mesh.material[0] : mesh.material;
    assert(mat.color.getHexString() === 'ff007f', `Mesh ${mesh.name} color is ff007f`);
    assert(mat.emissive.getHexString() === 'ff007f', `Mesh ${mesh.name} emissive is ff007f`);
    assert(mat.emissiveIntensity >= 2.0, `Mesh ${mesh.name} emissive intensity is vibrant (${mat.emissiveIntensity})`);
  }

  // Verify non-fluo materials were not mutated to neon pink
  let nonFluoMutated = false;
  robot.traverse((c) => {
    if (c.isMesh && !c.userData.isFluoAccent) {
      const mat = Array.isArray(c.material) ? c.material[0] : c.material;
      if (mat && mat.color && mat.color.getHexString() === 'ff007f') {
        nonFluoMutated = true;
      }
    }
  });
  assert(!nonFluoMutated, 'Base chassis non-fluo materials remain unmutated');

  // 5. Verify Weapon Socket Anchor
  console.log('\n--- 5. Weapon Socket Anchor ---');
  const socket = createWeaponSocket(robot);
  assert(socket !== undefined && socket.name === WEAPON_SOCKET_NAME, 'Weapon socket exists with correct name');
  assert(Math.abs(socket.position.x - WEAPON_SOCKET_POSITION.x) < 1e-4, 'Socket X position is -1.15');
  assert(Math.abs(socket.position.y - WEAPON_SOCKET_POSITION.y) < 1e-4, 'Socket Y position is 0.40');
  assert(Math.abs(socket.position.z - WEAPON_SOCKET_POSITION.z) < 1e-4, 'Socket Z position is 0.85');

  const testWeapon = createThirdPersonWeapon('assalto');
  attachWeaponToRobot(robot, testWeapon);
  assert(socket.children.length === 1, 'Socket contains 1 attached weapon child');
  assert(socket.children[0] === testWeapon, 'Attached child matches weapon group');

  // 6. Verify 5 Weapon Builders & Sockets
  console.log('\n--- 6. Weapon Model Builders ---');
  for (const w of WEAPON_TYPES) {
    const model = createWeaponModel(w);
    assert(model instanceof THREE.Group, `createWeaponModel('${w}') returns THREE.Group`);
    assert(model.children.length > 20, `${w} procedural model has >20 mesh children (count: ${model.children.length})`);

    const vm = createWeaponViewModel(w);
    assert(vm instanceof THREE.Group, `createWeaponViewModel('${w}') returns THREE.Group`);
    const expectedTransform = VIEWMODEL_TRANSFORMS[w];
    assert(expectedTransform !== undefined, `${w} has defined viewmodel transform`);
    assert(WEAPON_SCALES[w] !== undefined, `${w} scale factor defined (${WEAPON_SCALES[w]})`);

    const tp = createThirdPersonWeapon(w);
    assert(tp instanceof THREE.Group, `createThirdPersonWeapon('${w}') returns THREE.Group`);

    // Verify third-person forward direction along +Z (robot facing direction)
    tp.updateMatrixWorld(true);
    const innerTp = tp.children[0];
    const tpMuzzle = WEAPON_MUZZLE_POSITIONS[w].clone().applyMatrix4(innerTp.matrixWorld);
    const tpGrip = WEAPON_GRIP_OFFSETS[w].clone().applyMatrix4(innerTp.matrixWorld);
    const tpDir = tpMuzzle.sub(tpGrip).normalize();
    assert(tpDir.z > 0.90, `${w} third-person weapon aims forward along +Z (dir.z = ${tpDir.z.toFixed(4)})`);
    assert(tpGrip.length() < 1e-4, `${w} third-person grip centered at socket origin (${tpGrip.length().toFixed(6)})`);

    // Verify first-person viewmodel forward direction along camera -Z
    vm.updateMatrixWorld(true);
    const innerVm = vm.children[0];
    const vmMuzzle = WEAPON_MUZZLE_POSITIONS[w].clone().applyMatrix4(innerVm.matrixWorld);
    const vmGrip = WEAPON_GRIP_OFFSETS[w].clone().applyMatrix4(innerVm.matrixWorld);
    const vmDir = vmMuzzle.sub(vmGrip).normalize();
    const vmDot = vmDir.dot(new THREE.Vector3(0, 0, -1));
    assert(vmDot > 0.90, `${w} viewmodel aims forward along camera -Z (dot = ${vmDot.toFixed(4)})`);
  }

  // 7. Verify async loaders with fallbacks
  console.log('\n--- 7. Async Loaders ---');
  const loadedRobot = await loadRobotModel('assets/modello.glb', '#00F0FF');
  assert(loadedRobot instanceof THREE.Group, 'loadRobotModel() returns THREE.Group');
  const loadedFluo = getFluoMeshes(loadedRobot);
  assert(loadedFluo.length === 7, `Loaded robot has 7 fluo meshes (found: ${loadedFluo.length})`);

  const loadedWeapons = await loadAllWeapons('assets');
  for (const w of WEAPON_TYPES) {
    assert(loadedWeapons[w] instanceof THREE.Group, `loadAllWeapons() loaded ${w}`);
  }

  console.log('\n====================================================');
  console.log(`SUMMARY: All ${passedTests}/${totalTests} tests PASSED!`);
  console.log('====================================================');
}

run().catch((err) => {
  console.error('\nVerification failed:', err);
  process.exit(1);
});

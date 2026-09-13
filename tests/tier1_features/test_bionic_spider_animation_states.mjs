import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import { BionicSpiderEnemySystem } from '../../game-web/src/gameplay/bionicSpiderEnemies.ts';
import { assert } from '../helpers/assertions.mjs';

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export async function run(suite) {
  suite.test('Cyber spider ports idle breath, heavy damage flinch, death curl and power-down into the gameplay animator', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 30), false, true, false);
    const id = system.spawnAtCrater(0, 0, 'animation-test');
    assert(id !== null, 'Animation test must spawn a spider');

    for (let i = 0; i < 14; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), false, true, false);
    const root = scene.getObjectByName(`BionicSpider-${id}`);
    const body = scene.getObjectByName('BionicSpiderBody');
    const foot = scene.getObjectByName('BionicSpiderFoot-L-0');
    const core = scene.getObjectByName('BionicSpiderPowerCore');
    assert(root && body && foot && core, 'Animated rig nodes must exist in the live enemy scene');

    const idleY = body.position.y;
    system.update(0.2, new THREE.Vector3(0, 0, 30), false, true, false);
    assert(Math.abs(body.position.y - idleY) > 0.001, 'Idle state must visibly breathe instead of freezing the chassis');

    const beforeDamageZ = body.position.z;
    assert(system.damageEnemy(id, 25, new THREE.Vector3(1, 0, 0)), 'Damage animation must accept a non-lethal hit');
    system.update(0.05, new THREE.Vector3(0, 0, 30), false, true, false);
    assert(
      Math.abs(body.position.z - beforeDamageZ) > 0.01 || Math.abs(body.rotation.z) > 0.01,
      'Damage state must produce a heavy visible flinch',
    );

    scene.updateMatrixWorld(true);
    const rootBefore = root.getWorldPosition(new THREE.Vector3());
    const footBefore = foot.getWorldPosition(new THREE.Vector3());
    const footRadiusBefore = horizontalDistance(rootBefore, footBefore);
    const emissiveBefore = core.material.emissiveIntensity;

    assert(system.damageEnemy(id, 75, new THREE.Vector3(1, 0, 0)), 'Lethal damage must enter death state');
    // The production animator clamps a single update to 100 ms for stability.
    // Advance eight real animation frames rather than relying on one oversized delta.
    for (let i = 0; i < 8; i += 1) {
      system.update(0.1, new THREE.Vector3(0, 0, 30), false, true, false);
    }
    scene.updateMatrixWorld(true);
    const rootAfter = root.getWorldPosition(new THREE.Vector3());
    const footAfter = foot.getWorldPosition(new THREE.Vector3());
    const footRadiusAfter = horizontalDistance(rootAfter, footAfter);

    assert(footRadiusAfter < footRadiusBefore * 0.9, 'Death curl must pull the articulated legs inward');
    assert(body.rotation.x < -0.1, 'Death state must pitch the armored chassis into its collapse');
    assert(core.material.emissiveIntensity < emissiveBefore * 0.6, 'Death state must power down the reactor and neon system');
    system.dispose();
  });
}

import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import { BionicSpiderEnemySystem } from '../../game-web/src/gameplay/bionicSpiderEnemies.ts';
import { assert } from '../helpers/assertions.mjs';

function horizontalDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

export async function run(suite) {
  suite.test('Cyber spider keeps supplied idle, damage and death motion without detaching the hierarchical legs', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 30), false, true, false);
    const id = system.spawnAtCrater(0, 0, 'animation-test');
    assert(id !== null, 'Animation test must spawn a spider');

    for (let i = 0; i < 14; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), false, true, false);
    const root = scene.getObjectByName(`BionicSpider-${id}`);
    const body = scene.getObjectByName('BionicSpiderBody');
    const footRig = scene.getObjectByName('BionicSpiderFootRig-L-0');
    const tibiaRig = scene.getObjectByName('BionicSpiderTibiaRig-L-0');
    const femurRig = scene.getObjectByName('BionicSpiderFemurRig-L-0');
    const pivot = scene.getObjectByName('BionicSpiderLegPivot-L-0');
    const core = scene.getObjectByName('BionicSpiderPowerCore');
    assert(root && body && footRig && tibiaRig && femurRig && pivot && core, 'Animated supplied rig nodes must exist');
    assert(footRig.parent === tibiaRig && tibiaRig.parent === femurRig && femurRig.parent === pivot, 'Leg chain must remain physically connected');

    const idleY = body.position.y;
    system.update(0.2, new THREE.Vector3(0, 0, 30), false, true, false);
    assert(Math.abs(body.position.y - idleY) > 0.001, 'Idle state must visibly breathe instead of freezing the chassis');

    const beforeDamageX = body.position.x;
    assert(system.damageEnemy(id, 25, new THREE.Vector3(1, 0, 0)), 'Damage animation must accept a non-lethal hit');
    system.update(0.05, new THREE.Vector3(0, 0, 30), false, true, false);
    assert(
      Math.abs(body.position.x - beforeDamageX) > 0.001 || Math.abs(body.rotation.z) > 0.001,
      'Damage state must produce the supplied bounded chassis flinch',
    );

    scene.updateMatrixWorld(true);
    const rootBefore = root.getWorldPosition(new THREE.Vector3());
    const footBefore = footRig.getWorldPosition(new THREE.Vector3());
    const footRadiusBefore = horizontalDistance(rootBefore, footBefore);
    const coreBefore = core.material.color.clone();

    assert(system.damageEnemy(id, 75, new THREE.Vector3(1, 0, 0)), 'Lethal damage must enter death state');
    for (let i = 0; i < 8; i += 1) {
      system.update(0.1, new THREE.Vector3(0, 0, 30), false, true, false);
    }
    scene.updateMatrixWorld(true);
    const rootAfter = root.getWorldPosition(new THREE.Vector3());
    const footAfter = footRig.getWorldPosition(new THREE.Vector3());
    const footRadiusAfter = horizontalDistance(rootAfter, footAfter);

    assert(footRadiusAfter < footRadiusBefore * 0.9, 'Supplied death curl must pull articulated legs inward');
    assert(body.rotation.x < -0.1, 'Supplied death state must pitch the armored chassis into its collapse');
    assert(core.material.color.getHex() !== coreBefore.getHex(), 'Death state must power down the supplied orange reactor');
    assert(footRig.parent === tibiaRig && tibiaRig.parent === femurRig && femurRig.parent === pivot, 'Death animation must never detach leg pieces');
    system.dispose();
  });
}

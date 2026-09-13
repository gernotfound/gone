import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import {
  BIONIC_SPIDER_APPROX_HEIGHT,
  createBionicSpiderModel,
  disposeBionicSpiderModel,
  setBionicSpiderDamageVisual,
} from '../../game-web/src/models/bionicSpider.ts';
import {
  BIONIC_SPIDER_CONTACT_RADIUS,
  BIONIC_SPIDER_MAX_HP,
  BIONIC_SPIDER_MELEE_DAMAGE,
  BIONIC_SPIDER_MOVE_SPEED,
  BionicSpiderEnemySystem,
  craterCenterForCell,
} from '../../game-web/src/gameplay/bionicSpiderEnemies.ts';
import { assert, assertCloseTo, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';

export async function run(suite) {
  suite.test('Armored cyber spider keeps the 4x juggernaut gameplay rig and eight terrain-aware legs', () => {
    const model = createBionicSpiderModel(42);
    assertEqual(model.legs.length, 8, 'Spider must have exactly eight legs');
    assertCloseTo(BIONIC_SPIDER_APPROX_HEIGHT, 2.95 * 4, 1e-6, 'Juggernaut gameplay scale must stay compatible');

    for (const leg of model.legs) {
      assert(leg.upper.isMesh && leg.lower.isMesh, 'Each leg must expose articulated upper/lower segments to the IK solver');
      assertEqual(leg.upper.userData.bionicSpiderHitRegion, 'limb');
      assertEqual(leg.lower.userData.bionicSpiderHitRegion, 'limb');
    }

    const chassis = model.root.getObjectByName('BionicSpiderChassis');
    const head = model.root.getObjectByName('BionicSpiderHead');
    const core = model.root.getObjectByName('BionicSpiderPowerCore');
    const shield = model.root.getObjectByName('BionicSpiderLegShield-L-0');
    const reactiveArmor = model.root.getObjectByName('BionicSpiderReactiveArmor-L-0');
    const neon = model.root.getObjectByName('BionicSpiderLegNeon-L-0');
    const talon = model.root.getObjectByName('BionicSpiderTalon-L-0');

    assert(chassis && chassis.userData.bionicSpiderHitRegion === 'body', 'Armored chassis must remain a body hit region');
    assert(head && head.userData.bionicSpiderHitRegion === 'head', 'Head hit region must stay explicit');
    assert(core && core.userData.bionicSpiderHitRegion === 'body', 'Power core must participate in body raycasts');
    assert(shield && shield.userData.bionicSpiderHitRegion === 'limb', 'Massive tibia shield must participate in limb raycasts');
    assert(reactiveArmor && reactiveArmor.userData.bionicSpiderHitRegion === 'limb', 'Reactive armor must follow the limb hit region');
    assert(neon && neon.userData.bionicSpiderHitRegion === 'limb', 'Leg neon strip must move with the armored tibia');
    assert(talon && talon.userData.bionicSpiderHitRegion === 'limb', 'Mechanical talon must move with the foot rig');

    const eyes = [];
    model.root.traverse((object) => {
      if (object.name.startsWith('BionicSpiderEye-')) eyes.push(object);
      if (object.userData.bionicSpiderHitRegion) {
        assertEqual(object.userData.bionicSpiderEnemyId, 42, 'Every raycastable part must carry the owning enemy id');
      }
    });
    assertEqual(eyes.length, 6, 'Gemini armored head design uses six cyberpunk eyes');

    setBionicSpiderDamageVisual(model, 1);
    assert(model.coreMaterial.color.r > model.coreMaterial.color.g, 'Damage flash must drive the orange core toward red');
    assert(model.neonCyanMaterial.color.r > model.neonCyanMaterial.color.g, 'Damage flash must drive cyan emitters toward red');
    setBionicSpiderDamageVisual(model, 0);
    assert(model.neonCyanMaterial.color.g > model.neonCyanMaterial.color.r, 'Damage visuals must restore the cyan state');

    disposeBionicSpiderModel(model);
  });

  suite.test('Enemy balance follows the requested HP and mean walk/run speed', () => {
    assertEqual(BIONIC_SPIDER_MAX_HP, 100);
    assertCloseTo(BIONIC_SPIDER_MOVE_SPEED, (12 + 24) / 2, 1e-6, 'Speed must be mean of 12m/s walk and 24m/s sprint');
    assertGreaterThan(BIONIC_SPIDER_CONTACT_RADIUS, 8, 'Contact radius must scale with the 4x juggernaut body');
  });

  suite.test('Procedural enemy spawn centers reproduce deterministic crater cells', () => {
    const a = craterCenterForCell(3, -2);
    const b = craterCenterForCell(3, -2);
    assertCloseTo(a.x, b.x, 1e-9);
    assertCloseTo(a.z, b.z, 1e-9);
    assert(a.x >= 600 && a.x < 800, 'Crater X must remain inside its 200m terrain cell');
    assert(a.z >= -400 && a.z < -200, 'Crater Z must remain inside its 200m terrain cell');
  });

  suite.test('Spider emerges, chases the player, deals immediate contact melee, flinches and dies at 0 HP', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    let meleeDamage = 0;
    system.init(scene, () => 0, (damage) => { meleeDamage += damage; });
    system.update(0, new THREE.Vector3(0, 0, 30), true, true, false);
    const id = system.spawnAtCrater(0, 0, 'test-crater');
    assert(id !== null, 'Manual crater spawn must create a spider');

    for (let i = 0; i < 14; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), true, true, false);
    const afterEmergence = system.getSnapshot(id);
    assert(afterEmergence && !afterEmergence.emerging, 'Spider must complete emergence animation');
    const startZ = afterEmergence.z;

    for (let i = 0; i < 8; i += 1) system.update(0.1, new THREE.Vector3(0, 0, 30), true, true, false);
    const chasing = system.getSnapshot(id);
    assert(chasing && chasing.z > startZ, 'Spider must move toward the player');
    assert(chasing.speed > 0, 'Spider must accelerate into its chase gait');

    const contactTarget = new THREE.Vector3(chasing.x, 0, chasing.z + BIONIC_SPIDER_CONTACT_RADIUS * 0.7);
    system.update(0.1, contactTarget, true, true, false);
    assertEqual(meleeDamage, BIONIC_SPIDER_MELEE_DAMAGE, 'Contact must immediately apply one melee hit');

    assert(system.damageEnemy(id, 25, new THREE.Vector3(1, 0, 0)), 'Damage must be accepted while alive');
    assertCloseTo(system.getSnapshot(id).hp, 75, 1e-6);
    assert(system.damageEnemy(id, 75, new THREE.Vector3(1, 0, 0)), 'Lethal damage must be accepted');
    assertEqual(system.getSnapshot(id).alive, false, 'Spider must enter death state at 0 HP');
    system.update(0.6, contactTarget, true, true, false);
    assertEqual(system.getSnapshot(id).alive, false, 'Death animation must persist before corpse cleanup');
    system.dispose();
  });
}

import * as THREE from '../../game-web/node_modules/three/build/three.module.js';
import {
  BIONIC_SPIDER_APPROX_HEIGHT,
  BIONIC_SPIDER_BODY_HEIGHT,
  BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT,
  BIONIC_SPIDER_LEG_ANGLES,
  BIONIC_SPIDER_SCALE,
  BIONIC_SPIDER_SOURCE_UNIT,
  createBionicSpiderModel,
  disposeBionicSpiderModel,
  poseBionicSpiderLeg,
  setBionicSpiderDamageVisual,
} from '../../game-web/src/models/bionicSpider.ts';
import {
  BIONIC_SPIDER_COLLISION_RADIUS,
  BIONIC_SPIDER_CONTACT_RADIUS,
  BIONIC_SPIDER_LIMB_DAMAGE_MULTIPLIER,
  BIONIC_SPIDER_MAX_ACTIVE,
  BIONIC_SPIDER_MAX_HP,
  BIONIC_SPIDER_MELEE_DAMAGE,
  BIONIC_SPIDER_MOVE_SPEED,
  BionicSpiderEnemySystem,
  craterCenterForCell,
} from '../../game-web/src/gameplay/bionicSpiderEnemies.ts';
import {
  assert,
  assertCloseTo,
  assertEqual,
  assertGreaterThan,
  assertGreaterThanOrEqual,
} from '../helpers/assertions.mjs';

export async function run(suite) {
  suite.test('Armored cyber spider preserves the supplied model proportions and connected hierarchy exactly', () => {
    const model = createBionicSpiderModel(42);
    assertEqual(model.legs.length, 8, 'Spider must have exactly eight supplied legs');
    assertCloseTo(BIONIC_SPIDER_BODY_HEIGHT, 42 / 30, 1e-9, 'Source body baseHeight=42 must be uniformly converted');
    assertCloseTo(BIONIC_SPIDER_FOOT_ANCHOR_HEIGHT, 14 / 30, 1e-9, 'Source foot L3=14 must remain the ankle height');
    assertCloseTo(BIONIC_SPIDER_APPROX_HEIGHT, (52 / 30) * 4, 1e-9, 'Approximate height must follow the uniformly scaled source asset');
    assertEqual(BIONIC_SPIDER_SCALE, 4, 'Existing gameplay-wide spider scale stays global and uniform');

    const chassis = model.root.getObjectByName('BionicSpiderChassis');
    const head = model.root.getObjectByName('BionicSpiderHead');
    const core = model.root.getObjectByName('BionicSpiderPowerCore');
    const shield = model.root.getObjectByName('BionicSpiderLegShield-R-0');
    const reactiveArmor = model.root.getObjectByName('BionicSpiderReactiveArmor-R-0');
    const neon = model.root.getObjectByName('BionicSpiderLegNeon-R-0');
    const talon = model.root.getObjectByName('BionicSpiderTalon-R-0');

    assert(chassis && chassis.userData.bionicSpiderHitRegion === 'body', 'Armored chassis must remain a body hit region');
    assert(head && head.userData.bionicSpiderHitRegion === 'head', 'Head hit region must stay explicit');
    assert(core && core.userData.bionicSpiderHitRegion === 'body', 'Power core must participate in body raycasts');
    assert(shield && shield.userData.bionicSpiderHitRegion === 'limb', 'Massive tibia shield must participate in limb raycasts');
    assert(reactiveArmor && reactiveArmor.userData.bionicSpiderHitRegion === 'limb', 'Reactive armor must follow the limb hit region');
    assert(neon && neon.userData.bionicSpiderHitRegion === 'limb', 'Leg neon strip must move with the armored tibia');
    assert(talon && talon.userData.bionicSpiderHitRegion === 'limb', 'Mechanical talon must move with the foot rig');

    assertCloseTo(chassis.scale.x, 20 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source chassis width=20 must not be redesigned');
    assertCloseTo(chassis.scale.y, 14 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source chassis height=14 must not be redesigned');
    assertCloseTo(chassis.scale.z, 38 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source chassis length=38 must not be redesigned');
    assertCloseTo(model.headRoot.position.y, 2 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source head Y=2 must be preserved');
    assertCloseTo(model.headRoot.position.z, -22 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source head Z=-22 must be preserved');
    assertCloseTo(shield.scale.z, 28 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, 'Source shield width=28 must be preserved');

    const eyes = [];
    model.root.traverse((object) => {
      if (object.name.startsWith('BionicSpiderEye-')) eyes.push(object);
      if (object.userData.bionicSpiderHitRegion) {
        assertEqual(object.userData.bionicSpiderEnemyId, 42, 'Every raycastable part must carry the owning enemy id');
      }
    });
    assertEqual(eyes.length, 6, 'Supplied armored head uses exactly six cyberpunk eyes');

    for (let i = 0; i < model.legs.length; i += 1) {
      const leg = model.legs[i];
      assertCloseTo(leg.angle, BIONIC_SPIDER_LEG_ANGLES[i], 1e-12, `Leg ${i} must keep supplied fan angle`);
      assert(leg.pivot.parent === model.bodyRoot, `Leg ${i} pivot must stay attached to body`);
      assert(leg.femur.parent === leg.pivot, `Leg ${i} femur must stay attached to hip pivot`);
      assert(leg.tibia.parent === leg.femur, `Leg ${i} tibia must stay attached to femur`);
      assert(leg.foot.parent === leg.tibia, `Leg ${i} foot must stay attached to tibia`);
      assertCloseTo(leg.defaultTargetLocal.y, 14 * BIONIC_SPIDER_SOURCE_UNIT, 1e-9, `Leg ${i} ankle target must stay L3 above ground`);
    }

    const scene = new THREE.Scene();
    scene.add(model.root);
    model.root.updateMatrixWorld(true);
    const restTarget = model.root.localToWorld(model.legs[0].defaultTargetLocal.clone());
    poseBionicSpiderLeg(model, 0, restTarget);
    model.root.updateMatrixWorld(true);
    const talonBox = new THREE.Box3().setFromObject(talon);
    assertCloseTo(talonBox.min.y, 0, 0.08, 'Authored talon must land on the floor instead of driving the body/head into it');

    setBionicSpiderDamageVisual(model, 1);
    assert(model.coreMaterial.color.r > model.coreMaterial.color.g, 'Damage state must turn supplied orange core red');
    assert(model.neonCyanMaterial.color.r > model.neonCyanMaterial.color.g, 'Damage state must turn supplied cyan emitters red');
    setBionicSpiderDamageVisual(model, 0);
    assert(model.neonCyanMaterial.color.g > model.neonCyanMaterial.color.r, 'Damage state must restore supplied cyan');

    disposeBionicSpiderModel(model);
  });

  suite.test('Enemy balance enforces 20% slower movement, five-spider cap and half damage on legs', () => {
    assertEqual(BIONIC_SPIDER_MAX_HP, 100);
    assertCloseTo(BIONIC_SPIDER_MOVE_SPEED, ((12 + 24) / 2) * 0.8, 1e-6, 'Spider chase speed must be reduced by exactly 20%');
    assertEqual(BIONIC_SPIDER_MAX_ACTIVE, 5, 'No more than five spiders may exist at once');
    assertEqual(BIONIC_SPIDER_LIMB_DAMAGE_MULTIPLIER, 0.5, 'Leg hits must apply exactly 50% weapon damage');
    assertGreaterThan(BIONIC_SPIDER_CONTACT_RADIUS, 8, 'Contact radius must keep the existing juggernaut gameplay footprint');
    assertGreaterThan(BIONIC_SPIDER_COLLISION_RADIUS, BIONIC_SPIDER_CONTACT_RADIUS, 'Mob collision radius must cover the visible spider footprint');
  });

  suite.test('Procedural enemy spawn centers reproduce deterministic crater cells', () => {
    const a = craterCenterForCell(3, -2);
    const b = craterCenterForCell(3, -2);
    assertCloseTo(a.x, b.x, 1e-9);
    assertCloseTo(a.z, b.z, 1e-9);
    assert(a.x >= 600 && a.x < 800, 'Crater X must remain inside its 200m terrain cell');
    assert(a.z >= -400 && a.z < -200, 'Crater Z must remain inside its 200m terrain cell');
  });

  suite.test('Spawner refuses a sixth spider even when every crater key is unique', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 500), true, true, false);

    const ids = [];
    for (let i = 0; i < BIONIC_SPIDER_MAX_ACTIVE; i += 1) {
      ids.push(system.spawnAtCrater(i * 40, 0, `cap-${i}`));
    }
    assert(ids.every((id) => id !== null), 'First five unique crater spawns must succeed');
    assertEqual(system.getActiveCount(), 5, 'System must expose exactly five active spider entities at the cap');
    assertEqual(system.spawnAtCrater(240, 0, 'cap-sixth'), null, 'Sixth spider spawn must be rejected');
    assertEqual(system.getActiveCount(), 5, 'Rejected sixth spawn must not change active count');
    system.dispose();
  });

  suite.test('Living spiders maintain deterministic mob separation instead of overlapping', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 100), true, true, false);
    const firstId = system.spawnAtCrater(0, 0, 'collision-a');
    const secondId = system.spawnAtCrater(4, 0, 'collision-b');
    assert(firstId !== null && secondId !== null, 'Collision test requires two spiders');

    for (let i = 0; i < 13; i += 1) {
      system.update(0.1, new THREE.Vector3(0, 0, 100), true, true, false);
    }
    const first = system.getSnapshot(firstId);
    const second = system.getSnapshot(secondId);
    const separation = Math.hypot(first.x - second.x, first.z - second.z);
    assertGreaterThanOrEqual(
      separation,
      BIONIC_SPIDER_COLLISION_RADIUS * 2 - 1e-3,
      `Spider centers must stay outside the combined collision footprint; got ${separation}`,
    );
    system.dispose();
  });

  suite.test('Raycast hits on a leg apply exactly half of the weapon body damage', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 100), true, true, false);
    const id = system.spawnAtCrater(0, 0, 'limb-damage');
    assert(id !== null, 'Limb damage test must spawn a spider');

    const limbObject = new THREE.Object3D();
    limbObject.userData.bionicSpiderEnemyId = id;
    limbObject.userData.bionicSpiderHitRegion = 'limb';
    const accepted = system.applyRaycastHit(
      { object: limbObject, distance: 0 },
      0,
      new THREE.Vector3(1, 0, 0),
    );
    assert(accepted, 'Leg raycast hit must be accepted');
    assertCloseTo(system.getSnapshot(id).hp, 91, 1e-6, 'AR body damage 18 must become 9 damage on a leg');
    system.dispose();
  });

  suite.test('Spider emerges with head clear of ground, chases, melees, flinches and dies at 0 HP', () => {
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
    scene.updateMatrixWorld(true);
    const head = scene.getObjectByName('BionicSpiderHead');
    const headWorld = head.getWorldPosition(new THREE.Vector3());
    assertGreaterThan(headWorld.y, 4.5, 'Head must remain well above flat terrain after emergence');
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

  suite.test('Source-faithful hierarchical gait stays finite and cannot whip joints between frames', () => {
    const scene = new THREE.Scene();
    const system = new BionicSpiderEnemySystem();
    system.init(scene, () => 0, () => {});
    system.update(0, new THREE.Vector3(0, 0, 80), true, true, false);
    const id = system.spawnAtCrater(0, 0, 'gait-stability');
    assert(id !== null, 'Gait test must spawn a spider');

    for (let i = 0; i < 90; i += 1) system.update(1 / 60, new THREE.Vector3(0, 0, 80), true, true, false);

    const femurs = [];
    const tibias = [];
    for (let i = 0; i < 8; i += 1) {
      const side = i < 4 ? 'R' : 'L';
      const row = i % 4;
      femurs.push(scene.getObjectByName(`BionicSpiderFemurRig-${side}-${row}`));
      tibias.push(scene.getObjectByName(`BionicSpiderTibiaRig-${side}-${row}`));
    }
    assert(femurs.every(Boolean) && tibias.every(Boolean), 'All hierarchical leg rigs must exist');

    let previous = [...femurs, ...tibias].map((node) => node.rotation.z);
    let maxFrameDelta = 0;
    for (let frame = 0; frame < 180; frame += 1) {
      system.update(1 / 60, new THREE.Vector3(0, 0, 80), true, true, false);
      const current = [...femurs, ...tibias].map((node) => node.rotation.z);
      for (let i = 0; i < current.length; i += 1) {
        assert(Number.isFinite(current[i]), 'Every joint angle must remain finite');
        const delta = Math.abs(Math.atan2(Math.sin(current[i] - previous[i]), Math.cos(current[i] - previous[i])));
        maxFrameDelta = Math.max(maxFrameDelta, delta);
      }
      previous = current;
    }
    assert(maxFrameDelta < 0.45, `Joint rotations must stay continuous; observed ${maxFrameDelta.toFixed(3)} rad/frame`);
    system.dispose();
  });
}

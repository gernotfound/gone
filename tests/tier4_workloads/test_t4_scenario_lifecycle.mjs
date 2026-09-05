// tests/tier4_workloads/test_t4_scenario_lifecycle.mjs
// Tier 4 Real-World Workload Scenario: Complete Player Lifecycle (Join -> Equip -> Move -> Shoot -> Disconnect)

import {
  assert,
  assertEqual,
  assertCloseTo,
} from '../helpers/assertions.mjs';
import { P2PHostNode, P2PClientNode } from '../helpers/p2p_mock_channel.mjs';
import {
  WEAPON_CONFIGS,
  calculateSpreadAngle,
  calculateDamage,
} from '../helpers/weapon_model.mjs';
import { WEAPON_SOCKET_ANCHOR, SCALE_FACTORS } from '../helpers/asset_inspector.mjs';
import { validateHitscanRay } from '../helpers/hitscan_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: Complete end-to-end player lifecycle: Join -> Equip -> Move -> Shoot -> Disconnect', async () => {
    // 1. Host Initialization
    const host = new P2PHostNode('host_server');
    host.registerHostPlayer('GameHost', '#00F0FF'); // Host holds Cyan

    // 2. Client Joins
    const client = new P2PClientNode('player_lifecycle', 'CyberSamurai');
    host.attachClient(client);

    // Client requests Electric Lime (#39FF14)
    client.requestJoin('#39FF14');
    await new Promise((r) => setTimeout(r, 20));

    assertEqual(client.state, 'JOINED', 'Client must be successfully admitted');
    assertEqual(client.assignedColor, '#39FF14');
    assertEqual(host.registry.isColorAvailable('#39FF14'), false, 'Color is now reserved');

    // 3. Client Equips Weapon
    let equippedWeapon = 'assalto';
    const socketMount = { ...WEAPON_SOCKET_ANCHOR };
    const weaponScale = SCALE_FACTORS[equippedWeapon];

    assertCloseTo(socketMount.x, -1.15, 1e-4);
    assertCloseTo(socketMount.y, 0.40, 1e-4);
    assertCloseTo(socketMount.z, 0.85, 1e-4);
    assertEqual(weaponScale, 0.15);

    // 4. Movement Stances & Spread Dynamics
    const standSpread = calculateSpreadAngle(equippedWeapon, 0, 'stand');
    assertEqual(standSpread, 0.012);

    // Player starts sprinting
    const sprintSpread = calculateSpreadAngle(equippedWeapon, 0, 'sprint');
    assertCloseTo(sprintSpread, 0.024, 1e-4, 'Sprinting doubles base spread');

    // Player stops and crouches to aim
    const crouchSpread = calculateSpreadAngle(equippedWeapon, 0, 'crouch');
    assertCloseTo(crouchSpread, 0.009, 1e-4, 'Crouching reduces base spread by 0.75x');

    // 5. Combat Engagement: Target at 20m
    const targetDummyPos = [0, 0, 20.0];
    let dummyHp = 100.0;
    let shotsFired = 0;

    while (dummyHp > 0 && shotsFired < 10) {
      const hit = validateHitscanRay(equippedWeapon, [0, 1.0, 0], [0, 0, 1], targetDummyPos);
      assert(hit.hit, 'Ray hits target dummy');
      dummyHp = Math.max(0, dummyHp - hit.damage);
      shotsFired++;
    }

    assertEqual(dummyHp, 0.0, 'Dummy eliminated');
    assertEqual(shotsFired, 6, 'Assalto requires 6 hits for 100 HP');

    // 6. Weapon Switch to Knife
    equippedWeapon = 'coltello';
    const knifeSpread = calculateSpreadAngle(equippedWeapon, 0, 'stand');
    assertEqual(knifeSpread, 0.0);
    assertEqual(SCALE_FACTORS.coltello, 0.08);

    // 7. Clean Disconnection
    client.disconnect();
    await new Promise((r) => setTimeout(r, 20));

    assertEqual(client.state, 'DISCONNECTED');
    assertEqual(host.clients.has('player_lifecycle'), false, 'Client removed from host');
    assertEqual(host.registry.isColorAvailable('#39FF14'), true, 'Assigned color returned to pool');
    assertEqual(host.registry.activeCount, 1, 'Only host remains active in registry');
  });
}

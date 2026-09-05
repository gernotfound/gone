// tests/tier3_combinations/test_t3_p2p_multiplayer_mesh.mjs
// Tier 3 Cross-Feature Combination: P2P Multiplayer Mesh, Color Contention & Hitscan Replication

import {
  assert,
  assertEqual,
} from '../helpers/assertions.mjs';
import { P2PHostNode, P2PClientNode } from '../helpers/p2p_mock_channel.mjs';

export async function run(suite) {
  suite.test('T3-Mesh: 4-peer session setup: Host and 3 clients join with unique colors and synchronize rosters', async () => {
    const host = new P2PHostNode('host');
    host.registerHostPlayer('HostLeader', '#00F0FF'); // Cyan

    const clientA = new P2PClientNode('peer_A', 'Alice');
    const clientB = new P2PClientNode('peer_B', 'Bob');
    const clientC = new P2PClientNode('peer_C', 'Charlie');

    host.attachClient(clientA);
    host.attachClient(clientB);
    host.attachClient(clientC);

    clientA.requestJoin('#FF007F'); // Magenta
    clientB.requestJoin('#39FF14'); // Lime
    clientC.requestJoin('#FFE600'); // Yellow

    await new Promise((r) => setTimeout(r, 25));

    assertEqual(clientA.state, 'JOINED');
    assertEqual(clientB.state, 'JOINED');
    assertEqual(clientC.state, 'JOINED');
    assertEqual(host.clients.size, 4);
  });

  suite.test('T3-Mesh: Simultaneous color contention between peers is resolved deterministically with 1 accept and 1 reject', async () => {
    const host = new P2PHostNode('host');
    host.registerHostPlayer('HostLeader', '#00F0FF');

    const client1 = new P2PClientNode('c1', 'RivalOne');
    const client2 = new P2PClientNode('c2', 'RivalTwo');
    host.attachClient(client1);
    host.attachClient(client2);

    // Both propose Electric Lime (#39FF14)
    client1.requestJoin('#39FF14');
    client2.requestJoin('#39FF14');

    await new Promise((r) => setTimeout(r, 25));

    const oneAccepted = (client1.state === 'JOINED' && client2.state === 'REJECTED') ||
                        (client2.state === 'JOINED' && client1.state === 'REJECTED');
    assert(oneAccepted, 'Exactly one client must be accepted and one rejected');
  });

  suite.test('T3-Mesh: Rejected peer seamlessly recovers by selecting from suggested availableColors', async () => {
    const host = new P2PHostNode('host');
    host.registerHostPlayer('HostLeader', '#00F0FF');

    const clientA = new P2PClientNode('cA', 'Alpha');
    const clientB = new P2PClientNode('cB', 'Beta');
    host.attachClient(clientA);
    host.attachClient(clientB);

    clientA.requestJoin('#FF007F'); // Alpha takes Magenta
    await new Promise((r) => setTimeout(r, 15));

    clientB.requestJoin('#FF007F'); // Beta also tries Magenta
    await new Promise((r) => setTimeout(r, 15));
    assertEqual(clientB.state, 'REJECTED');

    // Beta picks first available alternative
    const fallbackColor = clientB.availableColors[0];
    clientB.requestJoin(fallbackColor);
    await new Promise((r) => setTimeout(r, 15));

    assertEqual(clientB.state, 'JOINED');
    assertEqual(clientB.assignedColor, fallbackColor);
  });

  suite.test('T3-Mesh: Peer disconnection frees color for immediate re-allocation to incoming player', async () => {
    const host = new P2PHostNode('host');
    host.registerHostPlayer('HostLeader', '#00F0FF');

    const player1 = new P2PClientNode('p1', 'PlayerOne');
    host.attachClient(player1);
    player1.requestJoin('#BC13FE'); // Toxic Violet
    await new Promise((r) => setTimeout(r, 15));
    assertEqual(player1.state, 'JOINED');

    // Player 1 leaves
    player1.disconnect();
    await new Promise((r) => setTimeout(r, 15));
    assertEqual(host.registry.isColorAvailable('#BC13FE'), true);

    // Player 2 arrives and claims #BC13FE
    const player2 = new P2PClientNode('p2', 'PlayerTwo');
    host.attachClient(player2);
    player2.requestJoin('#BC13FE');
    await new Promise((r) => setTimeout(r, 15));

    assertEqual(player2.state, 'JOINED');
    assertEqual(player2.assignedColor, '#BC13FE');
  });

  suite.test('T3-Mesh: Authoritative hitscan ray validation reduces target HP and broadcasts HIT_CONFIRMED to peers', async () => {
    const host = new P2PHostNode('host');
    host.registerHostPlayer('HostLeader', '#00F0FF');

    const shooter = new P2PClientNode('shooter_id', 'Shooter');
    const victim = new P2PClientNode('victim_id', 'Victim');
    host.attachClient(shooter);
    host.attachClient(victim);

    shooter.requestJoin('#FF007F');
    victim.requestJoin('#39FF14');
    await new Promise((r) => setTimeout(r, 20));

    // Place victim at [0, 0, 10.0] (within 10m close range)
    const victimEntry = host.clients.get('victim_id');
    victimEntry.pos = [0, 0, 10.0];

    // Shooter fires Assalto at victim
    const fireMsg = {
      type: 'FIRE_HITSCAN',
      shooterId: 'shooter_id',
      weaponType: 'assalto',
      origin: [0, 1.0, 0],
      direction: [0, 0, 1],
      targetId: 'victim_id',
    };
    shooter.channel.send(JSON.stringify(fireMsg));
    await new Promise((r) => setTimeout(r, 25));

    // Host should have updated victim's HP from 100 to 82
    assertEqual(victimEntry.hp, 82.0, 'Victim HP must be updated to 82');

    // Both peers should have received HIT_CONFIRMED broadcast
    const hitMsg = victim.receivedMessages.find((m) => m.type === 'HIT_CONFIRMED');
    assert(hitMsg !== undefined, 'Victim must receive HIT_CONFIRMED message');
    assertEqual(hitMsg.victimId, 'victim_id');
    assertEqual(hitMsg.damage, 18.0);
    assertEqual(hitMsg.newHp, 82.0);
  });
}

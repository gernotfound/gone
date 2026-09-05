// tests/tier4_workloads/test_t4_scenario_8p_lobby.mjs
// Tier 4 Real-World Workload Scenario: Full 8-Player Lobby Color Negotiation & Resolution

import {
  assert,
  assertEqual,
} from '../helpers/assertions.mjs';
import { P2PHostNode, P2PClientNode } from '../helpers/p2p_mock_channel.mjs';
import { CYBERPUNK_PALETTE } from '../helpers/color_registry_model.mjs';

export async function run(suite) {
  suite.test('T4-Scenario: 8-player lobby negotiation handles collisions, palette exhaustion, and reclamation', async () => {
    // 1. Host registers
    const host = new P2PHostNode('host_peer');
    host.registerHostPlayer('HostLeader', CYBERPUNK_PALETTE[0].hex); // Neon Cyan (#00F0FF)

    // 2. Spawn 7 clients
    const clients = [];
    for (let i = 1; i <= 7; i++) {
      const client = new P2PClientNode(`client_${i}`, `CyberWarrior_${i}`);
      host.attachClient(client);
      clients.push(client);
    }

    // 3. Intentionally introduce duplicate contention:
    // Clients 1, 2, and 3 all request Neon Magenta (#FF007F)
    clients[0].requestJoin('#FF007F');
    clients[1].requestJoin('#FF007F');
    clients[2].requestJoin('#FF007F');

    // Clients 4, 5, 6, 7 request distinct colors
    clients[3].requestJoin(CYBERPUNK_PALETTE[2].hex); // Lime
    clients[4].requestJoin(CYBERPUNK_PALETTE[3].hex); // Yellow
    clients[5].requestJoin(CYBERPUNK_PALETTE[4].hex); // Orange
    clients[6].requestJoin(CYBERPUNK_PALETTE[5].hex); // Violet

    await new Promise((r) => setTimeout(r, 30));

    // Client 0 was accepted; Clients 1 and 2 were rejected with COLOR_ALREADY_TAKEN
    assertEqual(clients[0].state, 'JOINED');
    assertEqual(clients[1].state, 'REJECTED');
    assertEqual(clients[2].state, 'REJECTED');

    // 4. Clients 1 and 2 recover by picking remaining available colors
    // Client 1 picks a currently available color
    const c1Pick = clients[1].availableColors.find((c) => host.registry.isColorAvailable(c));
    assert(c1Pick !== undefined, 'Must find an available color for Client 1');
    clients[1].requestJoin(c1Pick);
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(clients[1].state, 'JOINED');

    // Client 2 picks the final available color
    const c2Pick = clients[2].availableColors.find((c) => host.registry.isColorAvailable(c));
    assert(c2Pick !== undefined, 'Must be at least one remaining palette color for Client 2');
    clients[2].requestJoin(c2Pick);
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(clients[2].state, 'JOINED');

    // 5. Verify 8-player full lobby invariants
    assertEqual(host.clients.size, 8, 'Lobby must contain exactly 8 players');
    assertEqual(host.registry.activeCount, 8, 'Registry must have 8 active assignments');

    // Verify all assigned colors are 100% unique
    const assignedColors = new Set();
    for (const [id, player] of host.clients.entries()) {
      assertEqual(assignedColors.has(player.color), false, `Color ${player.color} must not be duplicated`);
      assignedColors.add(player.color);
    }
    assertEqual(assignedColors.size, 8, 'Exactly 8 unique colors assigned');

    // 6. Verify palette is completely exhausted (0 available)
    assertEqual(host.registry.getAvailablePalette().length, 0);

    // 7. 9th client attempts to join -> strictly rejected
    const client9 = new P2PClientNode('client_9', 'LateComer');
    host.attachClient(client9);
    client9.requestJoin(CYBERPUNK_PALETTE[0].hex);
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(client9.state, 'REJECTED');

    // 8. Client 4 leaves lobby -> Client 9 can now join with freed color
    const freedColor = clients[3].assignedColor;
    clients[3].disconnect();
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(host.registry.isColorAvailable(freedColor), true);

    client9.requestJoin(freedColor);
    await new Promise((r) => setTimeout(r, 20));
    assertEqual(client9.state, 'JOINED');
    assertEqual(client9.assignedColor, freedColor);
    assertEqual(host.clients.size, 8);
  });
}

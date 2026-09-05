// tests/tier1_features/test_t1_p2p_protocol.mjs
// Tier 1 Feature Coverage: P2P Host Color Uniqueness & WebRTC Protocol Signaling (F-15, F-16)

import { assert, assertEqual } from '../helpers/assertions.mjs';
import { P2PHostNode, P2PClientNode } from '../helpers/p2p_mock_channel.mjs';

export async function run(suite) {
  // F-15: Host Color Validation Handler
  suite.test('F-15: Host initializes with host player color successfully', () => {
    const host = new P2PHostNode('host_peer');
    const res = host.registerHostPlayer('HostPlayer', '#00F0FF');
    assert(res.success, 'Host registration should succeed');
    assertEqual(host.clients.size, 1);
  });

  suite.test('F-15: Host approves client proposing available fluo color', async () => {
    const host = new P2PHostNode('host_peer');
    host.registerHostPlayer('HostPlayer', '#00F0FF');

    const client = new P2PClientNode('client_1', 'CyberSniper');
    host.attachClient(client);

    client.requestJoin('#FF007F'); // Magenta
    await new Promise((r) => setTimeout(r, 15));

    assertEqual(client.state, 'JOINED', 'Client should be joined');
    assertEqual(client.assignedColor, '#FF007F');
  });

  // F-16: WebRTC P2P Message Protocol
  suite.test('F-16: JOIN_ACCEPTED payload includes session player list with colors', async () => {
    const host = new P2PHostNode('host_peer');
    host.registerHostPlayer('HostPlayer', '#00F0FF');

    const client = new P2PClientNode('client_1', 'CyberSniper');
    host.attachClient(client);

    client.requestJoin('#FF007F');
    await new Promise((r) => setTimeout(r, 15));

    assert(Array.isArray(client.sessionPlayers), 'sessionPlayers must be array');
    assertEqual(client.sessionPlayers.length, 2); // Host + Client
    assertEqual(client.sessionPlayers[0].color, '#00F0FF');
    assertEqual(client.sessionPlayers[1].color, '#FF007F');
  });

  suite.test('F-16: Connected peers receive PLAYER_JOINED broadcast when new player enters', async () => {
    const host = new P2PHostNode('host_peer');
    host.registerHostPlayer('HostPlayer', '#00F0FF');

    const clientA = new P2PClientNode('client_A', 'Alice');
    host.attachClient(clientA);
    clientA.requestJoin('#FF007F');
    await new Promise((r) => setTimeout(r, 15));

    const clientB = new P2PClientNode('client_B', 'Bob');
    host.attachClient(clientB);
    clientB.requestJoin('#39FF14'); // Lime
    await new Promise((r) => setTimeout(r, 15));

    // Client A should have received Bob's join broadcast
    const joinMsg = clientA.receivedMessages.find((m) => m.type === 'PLAYER_JOINED');
    assert(joinMsg !== undefined, 'Client A should receive PLAYER_JOINED');
    assertEqual(joinMsg.player.id, 'client_B');
    assertEqual(joinMsg.player.color, '#39FF14');
  });

  suite.test('F-16: Disconnecting client triggers PLAYER_LEFT broadcast and frees color', async () => {
    const host = new P2PHostNode('host_peer');
    host.registerHostPlayer('HostPlayer', '#00F0FF');

    const clientA = new P2PClientNode('client_A', 'Alice');
    host.attachClient(clientA);
    clientA.requestJoin('#FF007F');
    await new Promise((r) => setTimeout(r, 15));

    // Client A disconnects
    clientA.disconnect();
    await new Promise((r) => setTimeout(r, 15));

    // Color should now be available again on Host
    assertEqual(host.registry.isColorAvailable('#FF007F'), true, 'Freed color must be available');
    assertEqual(host.clients.has('client_A'), false, 'Client A removed from session');
  });
}

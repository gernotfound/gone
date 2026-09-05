// tests/tier2_boundary/test_t2_p2p_conflicts.mjs
// Tier 2 Boundary & Corner Cases: P2P Duplicate Collisions, Case Insensitivity & Exhaustion (F-15, F-16)

import { assert, assertEqual } from '../helpers/assertions.mjs';
import { SessionColorRegistry, CYBERPUNK_PALETTE } from '../helpers/color_registry_model.mjs';
import { P2PHostNode, P2PClientNode } from '../helpers/p2p_mock_channel.mjs';

export async function run(suite) {
  // Duplicate Collisions
  suite.test('T2-P2P: Duplicate color request is rejected with COLOR_ALREADY_TAKEN', () => {
    const reg = new SessionColorRegistry();
    const res1 = reg.requestColor('p1', '#00F0FF');
    assertEqual(res1.success, true);

    const res2 = reg.requestColor('p2', '#00F0FF');
    assertEqual(res2.success, false);
    assertEqual(res2.error, 'COLOR_ALREADY_TAKEN');
    assertEqual(reg.activeCount, 1);
  });

  suite.test('T2-P2P: Case-insensitive collision (#00F0FF vs #00f0ff) triggers rejection', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    const res2 = reg.requestColor('p2', '#00f0ff');
    assertEqual(res2.success, false);
    assertEqual(res2.error, 'COLOR_ALREADY_TAKEN');
  });

  // Reconnection & Reclaiming
  suite.test('T2-P2P: Disconnecting player frees color, allowing original player to reconnect and reclaim it', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    assertEqual(reg.isColorAvailable('#00F0FF'), false);

    // Player 1 disconnects
    reg.releasePlayer('p1');
    assertEqual(reg.isColorAvailable('#00F0FF'), true);

    // Player 1 reconnects
    const res = reg.requestColor('p1', '#00F0FF');
    assertEqual(res.success, true);
    assertEqual(res.color, '#00F0FF');
  });

  suite.test('T2-P2P: Freed color claimed by new player cannot be reclaimed by original player', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    reg.releasePlayer('p1');

    // Player 2 grabs p1's old color
    const res2 = reg.requestColor('p2', '#00F0FF');
    assertEqual(res2.success, true);

    // Player 1 tries to reclaim
    const res1 = reg.requestColor('p1', '#00F0FF');
    assertEqual(res1.success, false);
    assertEqual(res1.error, 'COLOR_ALREADY_TAKEN');
  });

  // Idempotence & Color Swapping
  suite.test('T2-P2P: Idempotent request by same player succeeds and does not duplicate count', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    const repeat = reg.requestColor('p1', '#00F0FF');
    assertEqual(repeat.success, true);
    assertEqual(reg.activeCount, 1);
  });

  suite.test('T2-P2P: Player switching color frees their previous color for other players', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    assertEqual(reg.isColorAvailable('#00F0FF'), false);

    // Switch to Neon Magenta
    const res = reg.requestColor('p1', '#FF007F');
    assertEqual(res.success, true);
    assertEqual(res.color, '#FF007F');

    // Old color #00F0FF should now be available for player 2
    assertEqual(reg.isColorAvailable('#00F0FF'), true);
    const res2 = reg.requestColor('p2', '#00F0FF');
    assertEqual(res2.success, true);
  });

  // Palette Exhaustion
  suite.test('T2-P2P: Full 8-player lobby exhausts curated palette, rejecting 9th player', () => {
    const reg = new SessionColorRegistry();
    for (let i = 0; i < CYBERPUNK_PALETTE.length; i++) {
      const res = reg.requestColor(`player_${i}`, CYBERPUNK_PALETTE[i].hex);
      assertEqual(res.success, true);
    }
    assertEqual(reg.activeCount, 8);
    assertEqual(reg.getAvailablePalette().length, 0);

    // 9th player requesting any palette color is rejected
    const res9 = reg.requestColor('player_9', '#00F0FF');
    assertEqual(res9.success, false);
    assertEqual(res9.error, 'COLOR_ALREADY_TAKEN');
  });

  suite.test('T2-P2P: Player leaving exhausted lobby restores available palette count to 1', () => {
    const reg = new SessionColorRegistry();
    for (let i = 0; i < CYBERPUNK_PALETTE.length; i++) {
      reg.requestColor(`player_${i}`, CYBERPUNK_PALETTE[i].hex);
    }
    assertEqual(reg.getAvailablePalette().length, 0);

    reg.releasePlayer('player_3'); // Frees #FFE600
    const available = reg.getAvailablePalette();
    assertEqual(available.length, 1);
    assertEqual(available[0], '#FFE600');
  });

  // Unregistered Player Release
  suite.test('T2-P2P: Releasing non-existent player ID handles gracefully without corrupting state', () => {
    const reg = new SessionColorRegistry();
    reg.requestColor('p1', '#00F0FF');
    const freed = reg.releasePlayer('unknown_player_xyz');
    assertEqual(freed, null);
    assertEqual(reg.activeCount, 1);
    assertEqual(reg.isColorAvailable('#00F0FF'), false);
  });

  // P2P Host Node Protocol Conflicts
  suite.test('T2-P2P: P2PHostNode rejects second client proposing same color and returns available alternatives', async () => {
    const host = new P2PHostNode('host_node');
    host.registerHostPlayer('Host', '#00F0FF'); // Host holds Cyan

    const client1 = new P2PClientNode('c1', 'ClientOne');
    host.attachClient(client1);

    // Client 1 tries to take Host's Cyan
    client1.requestJoin('#00F0FF');
    await new Promise((r) => setTimeout(r, 15));

    assertEqual(client1.state, 'REJECTED');
    assertEqual(client1.rejectionReason, 'COLOR_ALREADY_TAKEN');
    assert(client1.availableColors.length > 0, 'Must provide available alternative colors');
    assertEqual(client1.availableColors.includes('#00F0FF'), false);
  });

  suite.test('T2-P2P: Rejected client can join after choosing an available alternative color', async () => {
    const host = new P2PHostNode('host_node');
    host.registerHostPlayer('Host', '#00F0FF');

    const client1 = new P2PClientNode('c1', 'ClientOne');
    host.attachClient(client1);

    // First request: duplicate
    client1.requestJoin('#00F0FF');
    await new Promise((r) => setTimeout(r, 15));
    assertEqual(client1.state, 'REJECTED');

    // Second request: pick first available color (e.g. #FF007F)
    const altColor = client1.availableColors[0];
    client1.requestJoin(altColor);
    await new Promise((r) => setTimeout(r, 15));

    assertEqual(client1.state, 'JOINED');
    assertEqual(client1.assignedColor, altColor);
  });
}

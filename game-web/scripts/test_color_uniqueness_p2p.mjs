/**
 * G.O.N.E. - Automated P2P Host Authoritative Color Uniqueness Test
 *
 * Simulates an authoritative P2P Host and multiple Clients communicating over
 * WebRTC DataChannels:
 * 1. Client 1 proposes #00F0FF -> Host accepts -> Client 1 receives JOIN_ACCEPTED.
 * 2. Client 2 proposes duplicate #00F0FF (case-insensitive #00f0ff) ->
 *    Host rejects -> Client 2 receives COLOR_REJECTED with reason COLOR_ALREADY_TAKEN
 *    and a list of available neon colors.
 * 3. Client 2 proposes alternate #FF007F -> Host accepts -> Client 2 receives JOIN_ACCEPTED.
 * 4. Client 1 disconnects -> #00F0FF is released by Host.
 * 5. Client 3 proposes #00F0FF -> Host accepts -> Client 3 receives JOIN_ACCEPTED.
 * 6. Bonus: Tests non-fluo color rejection (#222222) with INVALID_FLUO_COLOR.
 *
 * Exit code 0 indicates 100% genuine assertion pass.
 */

import { P2PHost } from '../src/net/p2pHost.ts';
import { P2PClient } from '../src/net/p2pClient.ts';
import {
  COLOR_REJECT_REASONS,
  DEFAULT_NEON_HEX_LIST,
  isFluorescentColor,
  normalizeHexColor,
} from '../src/net/protocol.ts';

// --- Lightweight In-Memory Mock WebRTC DataChannel Pair ---
class MockDataChannel {
  constructor(name) {
    this.name = name;
    this.peer = null;
    this.readyState = 'open';
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  static createPair(nameA = 'host-end', nameB = 'client-end') {
    const a = new MockDataChannel(nameA);
    const b = new MockDataChannel(nameB);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(data) {
    if (this.readyState !== 'open') {
      throw new Error(`Cannot send on closed channel: ${this.name}`);
    }
    // Asynchronous network delivery
    queueMicrotask(() => {
      if (this.peer && this.peer.readyState === 'open' && this.peer.onmessage) {
        this.peer.onmessage({ data });
      }
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    queueMicrotask(() => {
      if (this.onclose) this.onclose();
      if (this.peer && this.peer.readyState !== 'closed') {
        this.peer.readyState = 'closed';
        if (this.peer.onclose) this.peer.onclose();
      }
    });
  }
}

// --- Assertion Utilities ---
function assert(condition, message) {
  if (!condition) {
    console.error(`\x1b[31m[ASSERTION FAILED]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  if (actual !== expected) {
    console.error(
      `\x1b[31m[ASSERTION FAILED]\x1b[0m ${message} | Expected: ${JSON.stringify(expected)}, Actual: ${JSON.stringify(actual)}`
    );
    throw new Error(`Assertion failed: ${message}`);
  }
}

function delay(ms = 30) {
  return new Promise((r) => setTimeout(r, ms));
}

// --- Main Test Suite ---
async function runP2PColorUniquenessTests() {
  console.log('\x1b[35m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[36m G.O.N.E. - P2P Authoritative Color Uniqueness Test Suite\x1b[0m');
  console.log('\x1b[35m=================================================================\x1b[0m\n');

  // -------------------------------------------------------------
  // Test 0: Unit assertions on normalization and fluorescence check
  // -------------------------------------------------------------
  console.log('\x1b[33m[0/5] Testing Neon Protocol Validation Helpers...\x1b[0m');
  assertEqual(normalizeHexColor('#00f0ff'), '#00F0FF', 'Lowercase hex normalization');
  assertEqual(normalizeHexColor('00f0ff'), '#00F0FF', 'Hex without leading hash');
  assertEqual(normalizeHexColor('#0ff'), '#00FFFF', '3-character short hex expansion');
  assertEqual(normalizeHexColor('invalid'), null, 'Invalid string returns null');

  assert(isFluorescentColor('#00F0FF'), 'Cyan #00F0FF must be fluorescent');
  assert(isFluorescentColor('#FF007F'), 'Neon Pink #FF007F must be fluorescent');
  assert(isFluorescentColor('#39FF14'), 'Acid Green #39FF14 must be fluorescent');
  assert(!isFluorescentColor('#000000'), 'Black #000000 must NOT be fluorescent');
  assert(!isFluorescentColor('#FFFFFF'), 'White #FFFFFF must NOT be fluorescent');
  assert(!isFluorescentColor('#333333'), 'Dark grey #333333 must NOT be fluorescent');
  console.log('  \x1b[32m✔ Protocol helpers validated successfully.\x1b[0m\n');

  // -------------------------------------------------------------
  // Initialize Authoritative Host
  // -------------------------------------------------------------
  console.log('\x1b[33m[1/5] Initializing Authoritative P2P Host...\x1b[0m');
  const hostPlayer = {
    id: 'host-player-id',
    name: 'HostMaster_Neon',
    color: '#FFE600', // Host claims Neon Yellow
  };

  const hostJoinedEvents = [];
  const hostLeftEvents = [];

  const host = new P2PHost({
    hostPlayer,
    onPlayerJoined: (p) => hostJoinedEvents.push(p),
    onPlayerLeft: (id, color) => hostLeftEvents.push({ id, color }),
  });

  assertEqual(host.hostPlayer.color, '#FFE600', 'Host assigned preferred neon yellow');
  assertEqual(host.getClientCount(), 0, 'No clients connected initially');
  console.log(`  \x1b[32m✔ Host initialized with player "${host.hostPlayer.name}" and color ${host.hostPlayer.color}.\x1b[0m\n`);

  // -------------------------------------------------------------
  // Step 1: Client 1 proposes #00F0FF -> Host accepts
  // -------------------------------------------------------------
  console.log('\x1b[33m[2/5] Step 1: Client 1 connects and proposes #00F0FF...\x1b[0m');
  const [hostSideChannel1, clientSideChannel1] = MockDataChannel.createPair('host-c1', 'client1');
  host.registerPeer('client-1-id', hostSideChannel1);

  let c1Accepted = null;
  let c1Rejected = null;
  const client1 = new P2PClient({
    playerId: 'client-1-id',
    playerName: 'CyberViper_01',
    onJoinAccepted: (data) => {
      c1Accepted = data;
    },
    onColorRejected: (data) => {
      c1Rejected = data;
    },
  });

  client1.connect(clientSideChannel1, '#00F0FF');
  await delay(40);

  assert(c1Accepted !== null, 'Client 1 should receive JOIN_ACCEPTED');
  assertEqual(client1.status, 'connected', 'Client 1 status should be connected');
  assertEqual(client1.assignedColor, '#00F0FF', 'Client 1 assigned color should be #00F0FF');
  assert(c1Rejected === null, 'Client 1 must NOT receive rejection');
  assertEqual(host.getClientCount(), 1, 'Host now has 1 active client');
  assert(host.hasPlayer('client-1-id'), 'Host has client 1 in session');
  console.log(`  \x1b[32m✔ Client 1 accepted with color ${client1.assignedColor}. Session players: ${client1.sessionPlayers.length}\x1b[0m\n`);

  // -------------------------------------------------------------
  // Step 2: Client 2 proposes duplicate #00F0FF (or #00f0ff) -> Host rejects
  // -------------------------------------------------------------
  console.log('\x1b[33m[3/5] Step 2: Client 2 connects proposing DUPLICATE #00f0ff...\x1b[0m');
  const [hostSideChannel2, clientSideChannel2] = MockDataChannel.createPair('host-c2', 'client2');
  host.registerPeer('client-2-id', hostSideChannel2);

  let c2Accepted = null;
  let c2Rejected = null;
  let c1SawPlayer2Join = null;

  client1['config'].onPlayerJoined = (p) => {
    c1SawPlayer2Join = p;
  };

  const client2 = new P2PClient({
    playerId: 'client-2-id',
    playerName: 'ShadowHunter_02',
    onJoinAccepted: (data) => {
      c2Accepted = data;
    },
    onColorRejected: (data) => {
      c2Rejected = data;
    },
  });

  // Client 2 proposes case-insensitive identical color #00f0ff
  client2.connect(clientSideChannel2, '#00f0ff');
  await delay(40);

  assert(c2Accepted === null, 'Client 2 MUST NOT be accepted with duplicate color');
  assertEqual(client2.status, 'rejected', 'Client 2 status should be rejected');
  assert(c2Rejected !== null, 'Client 2 MUST receive COLOR_REJECTED');
  assertEqual(
    c2Rejected.reason,
    COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
    'Rejection reason must be COLOR_ALREADY_TAKEN'
  );
  assertEqual(
    normalizeHexColor(c2Rejected.attemptedColor),
    '#00F0FF',
    'Attempted color must be #00F0FF'
  );
  assert(
    Array.isArray(c2Rejected.availableColors) && c2Rejected.availableColors.length > 0,
    'Host must provide available color alternatives'
  );
  assert(
    !c2Rejected.availableColors.includes('#00F0FF'),
    'Available colors list must NOT contain #00F0FF'
  );
  assert(
    !c2Rejected.availableColors.includes('#FFE600'),
    'Available colors list must NOT contain Host color #FFE600'
  );
  assertEqual(host.getClientCount(), 1, 'Client 2 was NOT added to active session peers');
  assert(!host.hasPlayer('client-2-id'), 'Host session does NOT have client 2 yet');
  assertEqual(c1SawPlayer2Join, null, 'Client 1 did NOT receive PLAYER_JOINED for rejected client');
  console.log(`  \x1b[32m✔ Duplicate color #00f0ff rejected cleanly with reason: ${c2Rejected.reason}.\x1b[0m`);
  console.log(`  \x1b[32m✔ Host provided ${c2Rejected.availableColors.length} available colors: [${c2Rejected.availableColors.join(', ')}]\x1b[0m\n`);

  // -------------------------------------------------------------
  // Step 3: Client 2 retries with alternate #FF007F -> Host accepts
  // -------------------------------------------------------------
  console.log('\x1b[33m[4/5] Step 3: Client 2 retries with available color #FF007F...\x1b[0m');
  c2Rejected = null;
  client2.retryWithColor('#FF007F');
  await delay(40);

  assert(c2Accepted !== null, 'Client 2 must receive JOIN_ACCEPTED on retry');
  assertEqual(client2.status, 'connected', 'Client 2 status must be connected');
  assertEqual(client2.assignedColor, '#FF007F', 'Client 2 assigned color must be #FF007F');
  assertEqual(host.getClientCount(), 2, 'Host now has 2 active clients');
  assert(host.hasPlayer('client-2-id'), 'Host now has client 2 in session');
  assert(c1SawPlayer2Join !== null, 'Client 1 received broadcast that Client 2 joined');
  assertEqual(c1SawPlayer2Join.id, 'client-2-id', 'Broadcast contains client 2 ID');
  assertEqual(c1SawPlayer2Join.color, '#FF007F', 'Broadcast contains client 2 color #FF007F');
  console.log(`  \x1b[32m✔ Client 2 accepted with color ${client2.assignedColor}.\x1b[0m`);
  console.log(`  \x1b[32m✔ Client 1 verified receiving PLAYER_JOINED broadcast for Client 2.\x1b[0m\n`);

  // -------------------------------------------------------------
  // Step 4: Client 1 disconnects -> #00F0FF freed -> Client 3 proposes #00F0FF -> Host accepts
  // -------------------------------------------------------------
  console.log('\x1b[33m[5/5] Step 4: Client 1 disconnects and Client 3 reclaims #00F0FF...\x1b[0m');
  let c2SawPlayer1Leave = null;
  client2['config'].onPlayerLeft = (data) => {
    c2SawPlayer1Leave = data;
  };

  client1.disconnect();
  await delay(40);

  assertEqual(host.getClientCount(), 1, 'Host peer count decremented to 1');
  assert(!host.hasPlayer('client-1-id'), 'Client 1 no longer in host session');
  assert(c2SawPlayer1Leave !== null, 'Client 2 received broadcast that Client 1 left');
  assertEqual(c2SawPlayer1Leave.playerId, 'client-1-id', 'Left player ID matches Client 1');
  assertEqual(c2SawPlayer1Leave.freedColor, '#00F0FF', 'Freed color matches #00F0FF');
  assert(
    host.colorRegistry.isColorAvailable('#00F0FF'),
    'Color #00F0FF is now available in host registry'
  );

  // Now Client 3 connects proposing the newly freed #00F0FF
  const [hostSideChannel3, clientSideChannel3] = MockDataChannel.createPair('host-c3', 'client3');
  host.registerPeer('client-3-id', hostSideChannel3);

  let c3Accepted = null;
  let c3Rejected = null;
  const client3 = new P2PClient({
    playerId: 'client-3-id',
    playerName: 'GhostRunner_03',
    onJoinAccepted: (data) => {
      c3Accepted = data;
    },
    onColorRejected: (data) => {
      c3Rejected = data;
    },
  });

  client3.connect(clientSideChannel3, '#00F0FF');
  await delay(40);

  assert(c3Accepted !== null, 'Client 3 should be ACCEPTED because #00F0FF was released');
  assertEqual(client3.status, 'connected', 'Client 3 status is connected');
  assertEqual(client3.assignedColor, '#00F0FF', 'Client 3 assigned color is #00F0FF');
  assert(c3Rejected === null, 'Client 3 did not receive rejection');
  assertEqual(host.getClientCount(), 2, 'Host now has 2 active clients (Client 2 and Client 3)');
  console.log(`  \x1b[32m✔ Client 1 disconnected and released #00F0FF.\x1b[0m`);
  console.log(`  \x1b[32m✔ Client 3 successfully claimed previously released #00F0FF!\x1b[0m\n`);

  // -------------------------------------------------------------
  // Step 5: Test Non-Fluo Invalid Color Rejection
  // -------------------------------------------------------------
  console.log('\x1b[33m[Bonus] Testing Non-Fluo / Dull Color Rejection (#222222)...\x1b[0m');
  const [hostSideChannel4, clientSideChannel4] = MockDataChannel.createPair('host-c4', 'client4');
  host.registerPeer('client-4-id', hostSideChannel4);

  let c4Rejected = null;
  const client4 = new P2PClient({
    playerId: 'client-4-id',
    playerName: 'DullPlayer_04',
    onColorRejected: (data) => {
      c4Rejected = data;
    },
  });

  client4.connect(clientSideChannel4, '#222222');
  await delay(40);

  assert(c4Rejected !== null, 'Dark non-fluo color #222222 must be rejected');
  assertEqual(
    c4Rejected.reason,
    COLOR_REJECT_REASONS.INVALID_FLUO_COLOR,
    'Rejection reason must be INVALID_FLUO_COLOR'
  );
  console.log(`  \x1b[32m✔ Dull color #222222 successfully rejected with reason ${c4Rejected.reason}.\x1b[0m\n`);

  // -------------------------------------------------------------
  // Final Verdict
  // -------------------------------------------------------------
  console.log('\x1b[32m=================================================================\x1b[0m');
  console.log('\x1b[1m\x1b[32m ALL P2P COLOR UNIQUENESS TESTS PASSED PERFECTLY (100%)\x1b[0m');
  console.log('\x1b[32m Authoritative Host validation, duplicate rejection, retry UX,\x1b[0m');
  console.log('\x1b[32m disconnect release, and fluorescence checks verified genuinely.\x1b[0m');
  console.log('\x1b[32m=================================================================\x1b[0m');

  process.exit(0);
}

runP2PColorUniquenessTests().catch((err) => {
  console.error('\x1b[31m[TEST SUITE FAILURE]\x1b[0m', err);
  process.exit(1);
});

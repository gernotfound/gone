// tests/challenger_m1_1_binary_stress.mjs
// Challenger 1: Adversarial Binary Netcode Protocol & TypedArray Serialization

import { assert, assertEqual, assertCloseTo } from './helpers/assertions.mjs';
import {
  PACKET_OPCODES,
  CLIENT_STATE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_PLAYER_BYTES,
  FIRE_HITSCAN_BYTES,
  HIT_CONFIRMED_BYTES,
  HIT_CONFIRMED_FLOAT_BYTES,
  CLIENT_FLAGS,
  STATE_FLAGS,
  HIT_FLAGS,
  HOST_SLOT,
  SlotManager,
  encodeClientState,
  decodeClientState,
  decodeClientStateInto,
  encodeWorldSnapshot,
  decodeWorldSnapshot,
  encodeFireHitscan,
  decodeFireHitscan,
  decodeFireHitscanInto,
  encodeHitConfirmed,
  decodeHitConfirmed,
  decodeHitConfirmedInto,
  peekPacketOpcode,
  ensureDataView,
} from '../game-web/src/net/binaryProtocol.ts';

import {
  InterpolationBuffer,
  NetworkClockSync,
  RemotePlayerInterpolationManager,
} from '../game-web/src/net/interpolationBuffer.ts';

import { P2PClient } from '../game-web/src/net/p2pClient.ts';
import { P2PHost, LocalColorRegistry } from '../game-web/src/net/p2pHost.ts';
import { isBinaryMessage, toArrayBuffer } from '../game-web/src/net/protocol.ts';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function runTest(name, fn) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log('[PASS] ' + name);
  } catch (err) {
    failedTests++;
    console.error('[FAIL] ' + name + ': ' + (err.message || err));
  }
}

class MockDataChannel {
  constructor(name) {
    this.name = name;
    this.peer = null;
    this.readyState = 'open';
    this.binaryType = 'arraybuffer';
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
    this.sentMessages = [];
  }

  static createPair(nameA = 'host-end', nameB = 'client-end') {
    const a = new MockDataChannel(nameA);
    const b = new MockDataChannel(nameB);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(data) {
    if (this.readyState !== 'open') throw new Error('Channel closed');
    this.sentMessages.push(data);
    let payload = data;
    if (typeof data !== 'string') {
      if (data instanceof ArrayBuffer) {
        payload = data.slice(0);
      } else if (ArrayBuffer.isView(data)) {
        payload = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
      }
    }
    queueMicrotask(() => {
      if (this.peer && this.peer.readyState === 'open' && this.peer.onmessage) {
        this.peer.onmessage({ data: payload });
      }
    });
  }

  close() {
    this.readyState = 'closed';
    if (this.onclose) this.onclose();
    if (this.peer && this.peer.readyState !== 'closed') {
      this.peer.readyState = 'closed';
      if (this.peer.onclose) this.peer.onclose();
    }
  }
}

console.log('================================================================');
console.log('   CHALLENGER 1 - BINARY NETCODE ADVERSARIAL STRESS HARNESS     ');
console.log('================================================================\n');

// ============================================================================
// GROUP 1: EXTREME FLOATING-POINT & COORDINATE BOUNDARIES
// ============================================================================
console.log('--- Group 1: Extreme Floating-Point & Coordinate Edge Cases ---');

runTest('1.1: CLIENT_STATE with NaN does not crash and decodes NaNs', () => {
  const buf = encodeClientState(1, 100, NaN, NaN, NaN, NaN, NaN, NaN, 0, 0);
  assertEqual(buf.byteLength, CLIENT_STATE_BYTES);
  const dec = decodeClientState(buf);
  assert(dec !== null, 'Decoded packet should not be null');
  assert(Number.isNaN(dec.timestamp), 'timestamp must be NaN');
  assert(Number.isNaN(dec.x), 'x must be NaN');
  assert(Number.isNaN(dec.y), 'y must be NaN');
  assert(Number.isNaN(dec.z), 'z must be NaN');
  assert(Number.isNaN(dec.yaw), 'yaw must be NaN');
  assert(Number.isNaN(dec.pitch), 'pitch must be NaN');
});

runTest('1.2: CLIENT_STATE with Infinity and -Infinity encodes and decodes', () => {
  const buf = encodeClientState(2, 101, Infinity, -Infinity, Infinity, -Infinity, Infinity, -Infinity, 0, 0);
  const dec = decodeClientState(buf);
  assert(dec !== null);
  assertEqual(dec.timestamp, Infinity);
  assertEqual(dec.x, -Infinity);
  assertEqual(dec.y, Infinity);
  assertEqual(dec.z, -Infinity);
  assertEqual(dec.yaw, Infinity);
  assertEqual(dec.pitch, -Infinity);
});

runTest('1.3: CLIENT_STATE with Float32 overflow (1e39) overflows cleanly to +/-Infinity', () => {
  const buf = encodeClientState(3, 102, 500, 1e39, -1e39, Number.MAX_VALUE, 3.4028234e38, -3.4028234e38, 0, 0);
  const dec = decodeClientState(buf);
  assert(dec !== null);
  assertEqual(dec.x, Infinity);
  assertEqual(dec.y, -Infinity);
  assertEqual(dec.z, Infinity);
  assertCloseTo(dec.yaw, 3.4028234e38, 1e33);
  assertCloseTo(dec.pitch, -3.4028234e38, 1e33);
});

runTest('1.4: CLIENT_STATE with subnormals and negative zero', () => {
  const subnormal = 1.401298e-45;
  const underflow = Number.MIN_VALUE;
  const negZero = -0.0;
  const buf = encodeClientState(4, 103, 100, subnormal, underflow, negZero, 0, 0, 0, 0);
  const dec = decodeClientState(buf);
  assert(dec !== null);
  assert(dec.x > 0, 'Subnormal remains positive');
  assertEqual(dec.y, 0.0, 'Underflow becomes 0.0');
  assertEqual(Object.is(dec.z, -0.0) || dec.z === 0, true);
});

runTest('1.5: CLIENT_STATE integer field masking for negative & out-of-range values', () => {
  const buf = encodeClientState(-1, 70000, 100, 0, 0, 0, 0, 0, 0x1FF, 300, -5);
  const dec = decodeClientState(buf);
  assert(dec !== null);
  assertEqual(dec.slot, 255);
  assertEqual(dec.seq, 70000 & 0xffff);
  assertEqual(dec.flags, 0xFF);
  assertEqual(dec.activeWeapon, 300 & 0xff);
});

runTest('1.6: FIRE_HITSCAN with NaN, Infinities, and subnormals', () => {
  const origin = [NaN, Infinity, -Infinity];
  const direction = [1e39, -1e39, Number.MIN_VALUE];
  const buf = encodeFireHitscan(5, 2, 42, NaN, origin, direction);
  assertEqual(buf.byteLength, FIRE_HITSCAN_BYTES);
  const dec = decodeFireHitscan(buf);
  assert(dec !== null);
  assert(Number.isNaN(dec.clientTimestamp));
  assert(Number.isNaN(dec.originX));
  assertEqual(dec.originY, Infinity);
  assertEqual(dec.originZ, -Infinity);
  assertEqual(dec.dirX, Infinity);
  assertEqual(dec.dirY, -Infinity);
  assertEqual(dec.dirZ, 0.0);
});

runTest('1.7: HIT_CONFIRMED fixed-point coordinate clamping with NaN & Infinity', () => {
  const bufNaN = encodeHitConfirmed(1, 2, 0, NaN, NaN, NaN, NaN, NaN);
  const decNaN = decodeHitConfirmed(bufNaN);
  assert(decNaN !== null);
  assertEqual(decNaN.damage, 0);
  assertEqual(decNaN.newHp, 0);
  assertEqual(decNaN.hitX, 0.0);

  const bufInf = encodeHitConfirmed(1, 2, 0, Infinity, Infinity, Infinity, -Infinity, 99999.0);
  const decInf = decodeHitConfirmed(bufInf);
  assert(decInf !== null);
  assertEqual(decInf.damage, 255);
  assertEqual(decInf.newHp, 100);
  assertCloseTo(decInf.hitX, 3276.7, 0.1);
  assertCloseTo(decInf.hitY, -3276.8, 0.1);
  assertCloseTo(decInf.hitZ, 3276.7, 0.1);
});

runTest('1.8: WORLD_SNAPSHOT with 255 players and extreme coordinates', () => {
  const players = [];
  for (let i = 0; i < 255; i++) {
    players.push({
      slot: i,
      hp: i % 101,
      flags: i % 2 === 0 ? STATE_FLAGS.ALIVE : 0,
      activeWeapon: i % 5,
      x: i === 0 ? NaN : i * 10.5,
      y: i === 1 ? Infinity : 17.5,
      z: i === 2 ? -Infinity : -i * 5.2,
      yaw: i * 0.02,
      pitch: 0.1,
      timerRemainingMs: i === 3 ? 1e39 : 5000.0,
    });
  }
  const buf = encodeWorldSnapshot(1234, 99999.9, players);
  const expectedBytes = SNAPSHOT_HEADER_BYTES + 255 * SNAPSHOT_PLAYER_BYTES;
  assertEqual(buf.byteLength, expectedBytes);
  const dec = decodeWorldSnapshot(buf);
  assert(dec !== null);
  assertEqual(dec.count, 255);
  assertEqual(dec.players.length, 255);
  assert(Number.isNaN(dec.players[0].x));
  assertEqual(dec.players[1].y, Infinity);
  assertEqual(dec.players[2].z, -Infinity);
  assertEqual(dec.players[3].timerRemainingMs, Infinity);
  assertCloseTo(dec.players[254].x, 254 * 10.5, 0.05);
});

// ============================================================================
// GROUP 2: BUFFER CORRUPTION, TRUNCATION SWEEPS & OVERSIZED BUFFERS
// ============================================================================
console.log('\n--- Group 2: Buffer Corruption, Truncation & Oversized Buffer Stress ---');

runTest('2.1: Truncation boundary sweep (0..31 bytes) for CLIENT_STATE & FIRE_HITSCAN', () => {
  for (let len = 0; len < CLIENT_STATE_BYTES; len++) {
    const buf = new ArrayBuffer(len);
    if (len > 0) new DataView(buf).setUint8(0, PACKET_OPCODES.CLIENT_STATE);

    const clientDec = decodeClientState(buf);
    const clientInto = decodeClientStateInto(buf, {});
    assertEqual(clientDec, null, 'Truncated CLIENT_STATE length ' + len + ' must return null');
    assertEqual(clientInto, false, 'Truncated CLIENT_STATE length ' + len + ' must return false');

    if (len > 0) new DataView(buf).setUint8(0, PACKET_OPCODES.FIRE_HITSCAN);
    const hitscanDec = decodeFireHitscan(buf);
    const hitscanInto = decodeFireHitscanInto(buf, {});
    assertEqual(hitscanDec, null, 'Truncated FIRE_HITSCAN length ' + len + ' must return null');
    assertEqual(hitscanInto, false, 'Truncated FIRE_HITSCAN length ' + len + ' must return false');
  }
});

runTest('2.2: Truncation boundary sweep (0..15 bytes) for HIT_CONFIRMED', () => {
  for (let len = 0; len < HIT_CONFIRMED_BYTES; len++) {
    const buf = new ArrayBuffer(len);
    if (len > 0) new DataView(buf).setUint8(0, PACKET_OPCODES.HIT_CONFIRMED);

    const dec = decodeHitConfirmed(buf);
    const into = decodeHitConfirmedInto(buf, {});
    assertEqual(dec, null, 'Truncated HIT_CONFIRMED length ' + len + ' must return null');
    assertEqual(into, false, 'Truncated HIT_CONFIRMED length ' + len + ' must return false');
  }
});

runTest('2.3: WORLD_SNAPSHOT truncation & player count spoofing protection', () => {
  for (let len = 0; len < SNAPSHOT_HEADER_BYTES; len++) {
    const buf = new ArrayBuffer(len);
    if (len > 0) new DataView(buf).setUint8(0, PACKET_OPCODES.WORLD_SNAPSHOT);
    assertEqual(decodeWorldSnapshot(buf), null);
  }

  // Count spoofing: claims 10 players, buffer only has 100 bytes (needs 288)
  const spoofBuf = new ArrayBuffer(100);
  const view = new DataView(spoofBuf);
  view.setUint8(0, PACKET_OPCODES.WORLD_SNAPSHOT);
  view.setUint8(1, 10);
  view.setUint16(2, 1, true);
  view.setFloat32(4, 100.0, true);
  assertEqual(decodeWorldSnapshot(spoofBuf), null, 'Count spoofing must return null');

  // Count spoofing: count=255 with 8 bytes
  const maxSpoofBuf = new ArrayBuffer(8);
  const maxView = new DataView(maxSpoofBuf);
  maxView.setUint8(0, PACKET_OPCODES.WORLD_SNAPSHOT);
  maxView.setUint8(1, 255);
  assertEqual(decodeWorldSnapshot(maxSpoofBuf), null);
});

runTest('2.4: Oversized binary buffers decode cleanly without crashing', () => {
  // Oversized CLIENT_STATE (64 bytes)
  const overClient = new ArrayBuffer(64);
  const vClient = new DataView(overClient);
  vClient.setUint8(0, PACKET_OPCODES.CLIENT_STATE);
  vClient.setUint8(1, 5);
  vClient.setUint16(2, 42, true);
  vClient.setFloat32(4, 1234.5, true);
  vClient.setFloat32(8, 10.0, true);
  vClient.setFloat32(12, 20.0, true);
  vClient.setFloat32(16, 30.0, true);
  vClient.setFloat32(20, 1.57, true);
  vClient.setFloat32(24, -0.5, true);
  vClient.setUint8(28, 0x01);
  vClient.setUint8(29, 2);
  new Uint8Array(overClient, 32).fill(0xAA);

  const decClient = decodeClientState(overClient);
  assert(decClient !== null);
  assertEqual(decClient.slot, 5);
  assertCloseTo(decClient.x, 10.0, 0.001);

  // Oversized HIT_CONFIRMED (Float32 layout in 64-byte buffer)
  const overHit = new ArrayBuffer(64);
  const vHit = new DataView(overHit);
  vHit.setUint8(0, PACKET_OPCODES.HIT_CONFIRMED);
  vHit.setUint8(1, 3);
  vHit.setUint8(2, 0);
  vHit.setUint8(3, HIT_FLAGS.HEADSHOT);
  vHit.setUint8(4, 90);
  vHit.setUint8(5, 10);
  vHit.setFloat32(8, 123.456, true);
  vHit.setFloat32(12, 78.910, true);
  vHit.setFloat32(16, -45.678, true);

  const decHit = decodeHitConfirmed(overHit);
  assert(decHit !== null);
  assertEqual(decHit.victimSlot, 3);
  assertCloseTo(decHit.hitX, 123.456, 0.001);

  // Oversized WORLD_SNAPSHOT (count=1 in 256 bytes)
  const overSnap = new ArrayBuffer(256);
  const vSnap = new DataView(overSnap);
  vSnap.setUint8(0, PACKET_OPCODES.WORLD_SNAPSHOT);
  vSnap.setUint8(1, 1);
  vSnap.setUint16(2, 99, true);
  vSnap.setFloat32(4, 555.5, true);
  vSnap.setUint8(8, 0);
  vSnap.setUint8(9, 100);
  vSnap.setUint8(10, STATE_FLAGS.ALIVE);
  vSnap.setUint8(11, 1);
  vSnap.setFloat32(12, 5.0, true);
  vSnap.setFloat32(16, 17.5, true);
  vSnap.setFloat32(20, -5.0, true);

  const decSnap = decodeWorldSnapshot(overSnap);
  assert(decSnap !== null);
  assertEqual(decSnap.count, 1);
  assertEqual(decSnap.players.length, 1);
});

runTest('2.5: Subarrays with non-zero byteOffset', () => {
  const bigBuffer = new ArrayBuffer(128);
  const offset = 32;
  const subView = new DataView(bigBuffer, offset, CLIENT_STATE_BYTES);
  subView.setUint8(0, PACKET_OPCODES.CLIENT_STATE);
  subView.setUint8(1, 7);
  subView.setUint16(2, 777, true);
  subView.setFloat32(4, 999.0, true);
  subView.setFloat32(8, 42.0, true);

  const typedView = new Uint8Array(bigBuffer, offset, CLIENT_STATE_BYTES);
  const dec = decodeClientState(typedView);
  assert(dec !== null);
  assertEqual(dec.slot, 7);
  assertCloseTo(dec.x, 42.0, 0.001);
});

runTest('2.6: Non-buffer inputs fail gracefully without throwing', () => {
  const invalidInputs = [null, undefined, 'binary_string', 12345, {}, [], true];
  for (const bad of invalidInputs) {
    assertEqual(peekPacketOpcode(bad), null);
    assertEqual(decodeClientState(bad), null);
    assertEqual(decodeWorldSnapshot(bad), null);
    assertEqual(decodeFireHitscan(bad), null);
    assertEqual(decodeHitConfirmed(bad), null);
    assertEqual(decodeClientStateInto(bad, {}), false);
  }
});

runTest('2.7: Fuzzing 2,000 random byte packets produces 0 crashes', () => {
  let fuzzCrashes = 0;
  for (let i = 0; i < 2000; i++) {
    const len = Math.floor(Math.random() * 100);
    const buf = new Uint8Array(len);
    for (let j = 0; j < len; j++) {
      buf[j] = Math.floor(Math.random() * 256);
    }
    try {
      peekPacketOpcode(buf);
      decodeClientState(buf);
      decodeWorldSnapshot(buf);
      decodeFireHitscan(buf);
      decodeHitConfirmed(buf);
    } catch (err) {
      fuzzCrashes++;
      console.error('Fuzz crash on buffer:', err);
    }
  }
  assertEqual(fuzzCrashes, 0);
});

// ============================================================================
// GROUP 3: PURE BINARY ARRAYBUFFER TRANSMISSION IN P2P ARCHITECTURE
// ============================================================================
console.log('\n--- Group 3: Pure Binary ArrayBuffer Verification in P2P Mesh ---');

runTest('3.1: Client movement tick sends pure binary ArrayBuffer (32 bytes)', () => {
  const [hostChannel, clientChannel] = MockDataChannel.createPair();
  const client = new P2PClient({
    playerId: 'test_client_1',
    playerName: 'Recon1',
  });

  client.connect(clientChannel, '#00F0FF');
  client.status = 'connected';
  client.playerSlot = 1;
  client.setStateProvider(() => ({
    position: { x: 15.0, y: 17.5, z: -25.0 },
    yaw: 1.57,
    pitch: -0.2,
    activeWeapon: 0,
    flags: 0x01,
  }));

  client.sendCurrentState();

  const sent = clientChannel.sentMessages.find((m) => typeof m !== 'string');
  assert(sent !== undefined, 'Client must send a non-string message for movement tick');
  assert(sent instanceof ArrayBuffer, 'Client movement message must be pure ArrayBuffer');
  assertEqual(sent.byteLength, CLIENT_STATE_BYTES);
  assertEqual(new DataView(sent).getUint8(0), PACKET_OPCODES.CLIENT_STATE);
});

runTest('3.2: Client fire hitscan sends pure binary ArrayBuffer (32 bytes)', () => {
  const [hostChannel, clientChannel] = MockDataChannel.createPair();
  const client = new P2PClient({
    playerId: 'test_shooter',
    playerName: 'Sniper1',
  });

  client.connect(clientChannel, '#00F0FF');
  client.status = 'connected';
  client.playerSlot = 2;

  client.fireHitscan(1, [10, 18, 0], [0, 0, -1]);

  const shotMsg = clientChannel.sentMessages[clientChannel.sentMessages.length - 1];
  assert(shotMsg instanceof ArrayBuffer, 'Client hitscan message must be pure ArrayBuffer');
  assertEqual(shotMsg.byteLength, FIRE_HITSCAN_BYTES);
  assertEqual(new DataView(shotMsg).getUint8(0), PACKET_OPCODES.FIRE_HITSCAN);
});

runTest('3.3: Host world snapshot broadcast sends pure binary ArrayBuffer', () => {
  const [hostChannel, clientChannel] = MockDataChannel.createPair();
  const host = new P2PHost({
    hostPlayer: { id: 'host_p', name: 'HostAdmin', color: '#00F0FF' },
  });

  host.registerPeer('peer_1', hostChannel);
  // Join acceptance registers peer into host.peers
  host.handleChannelMessage('peer_1', hostChannel, JSON.stringify({
    type: 'JOIN_REQUEST',
    playerId: 'peer_1',
    playerName: 'Peer1',
    proposedColor: '#FF0055',
  }));

  host.tickSnapshot();

  const snapMsg = hostChannel.sentMessages.find((m) => {
    if (typeof m === 'string') return false;
    return new DataView(toArrayBuffer(m)).getUint8(0) === PACKET_OPCODES.WORLD_SNAPSHOT;
  });

  assert(snapMsg !== undefined, 'Host must broadcast binary WORLD_SNAPSHOT');
  assert(snapMsg instanceof ArrayBuffer || ArrayBuffer.isView(snapMsg), 'Host snapshot message must be binary');
  const snapBuf = toArrayBuffer(snapMsg);
  assertEqual(new DataView(snapBuf).getUint8(0), PACKET_OPCODES.WORLD_SNAPSHOT);
  const dec = decodeWorldSnapshot(snapBuf);
  assert(dec !== null);
  assertEqual(dec.count, 2, 'Snapshot contains Host (slot 0) and Peer 1 (slot 1)');
});

runTest('3.4: Host hit confirmation broadcast sends pure binary ArrayBuffer (16 bytes)', () => {
  const [hostChannel, clientChannel] = MockDataChannel.createPair();
  const host = new P2PHost({
    hostPlayer: { id: 'host_p', name: 'HostAdmin', color: '#00F0FF' },
  });

  host.registerPeer('victim_client', hostChannel);
  host.handleChannelMessage('victim_client', hostChannel, JSON.stringify({
    type: 'JOIN_REQUEST',
    playerId: 'victim_client',
    playerName: 'Victim',
    proposedColor: '#FF0055',
  }));

  const victimRecord = host.playerRecords.get('victim_client');
  assert(victimRecord !== undefined, 'Victim record exists');
  victimRecord.position = { x: 0, y: 17.5, z: 10 };
  victimRecord.shieldExpiresAt = 0; // Shield expired

  // Host shoots towards victim at [0, 17.5, 10]
  const shotBuffer = encodeFireHitscan(
    0, // shooterSlot
    0, // assault rifle
    1, // shotSeq
    performance.now(),
    [0, 18.0, 0], // origin
    [0, 0, 1]     // dir towards victim
  );

  host.handleChannelMessage('host_p', hostChannel, shotBuffer);

  const hitMsg = hostChannel.sentMessages.find((m) => {
    if (typeof m === 'string') return false;
    const buf = toArrayBuffer(m);
    return new DataView(buf).getUint8(0) === PACKET_OPCODES.HIT_CONFIRMED;
  });

  assert(hitMsg !== undefined, 'Host must broadcast binary HIT_CONFIRMED');
  const hitBuf = toArrayBuffer(hitMsg);
  assertEqual(hitBuf.byteLength, HIT_CONFIRMED_BYTES);
  const decHit = decodeHitConfirmed(hitBuf);
  assert(decHit !== null);
  assertEqual(decHit.victimSlot, victimRecord.slot);
  assertEqual(decHit.shooterSlot, 0);
});

// ============================================================================
// GROUP 4: INTERPOLATION BUFFER UNDER ADVERSARIAL STRESS
// ============================================================================
console.log('\n--- Group 4: Interpolation Engine Extreme Input Stress ---');

runTest('4.1: NaN in InterpolationBuffer coordinates does not crash sample()', () => {
  const buffer = new InterpolationBuffer();
  buffer.push({
    timestamp: 1000,
    x: NaN,
    y: NaN,
    z: NaN,
    yaw: NaN,
    pitch: NaN,
  });
  buffer.push({
    timestamp: 1050,
    x: 10,
    y: 20,
    z: 30,
    yaw: 0,
    pitch: 0,
  });

  const state = buffer.sample(1025);
  assert(state !== null);
  assert(Number.isNaN(state.x));
});

runTest('4.2: Infinity in InterpolationBuffer triggers teleport history purge', () => {
  const buffer = new InterpolationBuffer({ teleportThresholdMeters: 10.0 });
  buffer.push({
    timestamp: 1000,
    x: 0,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
  });
  buffer.push({
    timestamp: 1050,
    x: Infinity,
    y: 0,
    z: 0,
    yaw: 0,
    pitch: 0,
  });

  assertEqual(buffer.size, 1);
});

runTest('4.3: Duplicate & out-of-order timestamp handling', () => {
  const buffer = new InterpolationBuffer();
  buffer.push({ timestamp: 100, x: 1, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 200, x: 2, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 200, x: 2.05, y: 0, z: 0, yaw: 0, pitch: 0 }); // duplicate timestamp with small displacement
  assertEqual(buffer.size, 2, 'Duplicate timestamp must be discarded');

  buffer.push({ timestamp: 150, x: 1.5, y: 0, z: 0, yaw: 0, pitch: 0 });
  assertEqual(buffer.size, 3, 'Out-of-order packet must be inserted in order');
  const sampled = buffer.sample(150);
  assertCloseTo(sampled.x, 1.5, 0.001);
});

runTest('4.4: 10,000 snapshots pushed rapidly maintains capacity <= 32', () => {
  const buffer = new InterpolationBuffer({ maxCapacity: 32 });
  for (let i = 0; i < 10000; i++) {
    buffer.push({
      timestamp: i * 10,
      x: i * 0.1,
      y: 17.5,
      z: 0,
      yaw: 0,
      pitch: 0,
    });
  }
  assertEqual(buffer.size, 32);
  assertEqual(buffer.latest.timestamp, 99990);
});

console.log('\n================================================================');
console.log('TOTAL TESTS: ' + totalTests + ' | PASSED: ' + passedTests + ' | FAILED: ' + failedTests);
console.log('================================================================');

if (failedTests > 0) {
  console.error('CHALLENGE FAILED: ' + failedTests + ' test(s) failed.');
  process.exit(1);
} else {
  console.log('ALL CHALLENGER 1 ADVERSARIAL STRESS TESTS PASSED!');
  process.exit(0);
}

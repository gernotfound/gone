// tests/tier1_features/test_netcode_binary.mjs
// Tier 1 Feature Coverage: Binary Netcode Protocol & TypedArray Serialization (F-NET-01)

import { assert, assertEqual, assertCloseTo, assertThrows } from '../helpers/assertions.mjs';
import {
  PACKET_OPCODES,
  CLIENT_STATE_BYTES,
  SNAPSHOT_HEADER_BYTES,
  SNAPSHOT_PLAYER_BYTES,
  FIRE_HITSCAN_BYTES,
  HIT_CONFIRMED_BYTES,
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
  encodeLobbyJoin,
  encodeLobbyJoinAccepted,
  encodeLobbyColorChanged,
  encodeLobbyGameStart,
  decodeLobbyMessage,
} from '../../game-web/src/net/binaryProtocol.ts';

export async function run(suite) {
  // --- T1-NET-01: CLIENT_STATE (0x01) Round-Trip & Zero-Allocation ---
  suite.test('T1-NET-01: CLIENT_STATE round-trip encodes and decodes exactly 32 bytes with sub-millimeter precision', () => {
    const slot = 2;
    const seq = 1042;
    const timestamp = 123456.78;
    const x = 12.345;
    const y = 17.890;
    const z = -45.678;
    const yaw = 1.256;
    const pitch = -0.452;
    const flags = CLIENT_FLAGS.GROUNDED | CLIENT_FLAGS.SPRINT | CLIENT_FLAGS.FIRING;
    const activeWeapon = 1;

    const buffer = encodeClientState(
      slot,
      seq,
      timestamp,
      x,
      y,
      z,
      yaw,
      pitch,
      flags,
      activeWeapon
    );

    assertEqual(buffer.byteLength, CLIENT_STATE_BYTES, 'CLIENT_STATE must be exactly 32 bytes');
    assertEqual(peekPacketOpcode(buffer), PACKET_OPCODES.CLIENT_STATE, 'Opcode must be 0x01');

    const decoded = decodeClientState(buffer);
    assert(decoded !== null, 'Decoded packet should not be null');
    assertEqual(decoded.opcode, PACKET_OPCODES.CLIENT_STATE);
    assertEqual(decoded.slot, slot);
    assertEqual(decoded.seq, seq);
    assertCloseTo(decoded.timestamp, timestamp, 0.05, 'Timestamp precision');
    assertCloseTo(decoded.x, x, 0.001, 'Position X precision');
    assertCloseTo(decoded.y, y, 0.001, 'Position Y precision');
    assertCloseTo(decoded.z, z, 0.001, 'Position Z precision');
    assertCloseTo(decoded.yaw, yaw, 0.001, 'Yaw angle precision');
    assertCloseTo(decoded.pitch, pitch, 0.001, 'Pitch angle precision');
    assertEqual(decoded.flags, flags);
    assertEqual(decoded.activeWeapon, activeWeapon);

    // In-place zero allocation decoder check
    const reuseTarget = {};
    const success = decodeClientStateInto(buffer, reuseTarget);
    assert(success, 'decodeClientStateInto should succeed');
    assertEqual(reuseTarget.slot, slot);
    assertEqual(reuseTarget.seq, seq);
    assertCloseTo(reuseTarget.x, x, 0.001);
  });

  // --- T1-NET-02: WORLD_SNAPSHOT (0x02) Round-Trip with N Players ---
  suite.test('T1-NET-02: WORLD_SNAPSHOT encodes and decodes 8 + 28*N bytes for 3 session players', () => {
    const seq = 512;
    const hostTimestamp = 987654.32;
    const players = [
      {
        slot: 0,
        hp: 100,
        flags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
        activeWeapon: 0,
        x: 0.0,
        y: 17.5,
        z: 0.0,
        yaw: 0.0,
        pitch: 0.0,
        timerRemainingMs: 8500.0,
      },
      {
        slot: 1,
        hp: 66,
        flags: STATE_FLAGS.ALIVE | STATE_FLAGS.SPRINTING,
        activeWeapon: 2,
        x: 25.4,
        y: 12.1,
        z: -18.7,
        yaw: 2.14,
        pitch: -0.12,
        timerRemainingMs: 0.0,
      },
      {
        slot: 2,
        hp: 0,
        flags: 0, // Dead
        activeWeapon: 1,
        x: -50.2,
        y: 8.0,
        z: 33.3,
        yaw: -1.57,
        pitch: 0.35,
        timerRemainingMs: 3200.0, // Respawn countdown
      },
    ];

    const buffer = encodeWorldSnapshot(seq, hostTimestamp, players);
    const expectedBytes = SNAPSHOT_HEADER_BYTES + SNAPSHOT_PLAYER_BYTES * 3; // 8 + 84 = 92
    assertEqual(buffer.byteLength, expectedBytes, `WORLD_SNAPSHOT size for 3 players must be ${expectedBytes} bytes`);
    assertEqual(peekPacketOpcode(buffer), PACKET_OPCODES.WORLD_SNAPSHOT, 'Opcode must be 0x02');

    const decoded = decodeWorldSnapshot(buffer);
    assert(decoded !== null, 'Decoded snapshot should not be null');
    assertEqual(decoded.count, 3);
    assertEqual(decoded.seq, seq);
    assertCloseTo(decoded.hostTimestamp, hostTimestamp, 0.05);
    assertEqual(decoded.players.length, 3);

    // Verify Player 0 (Host)
    assertEqual(decoded.players[0].slot, 0);
    assertEqual(decoded.players[0].hp, 100);
    assertEqual(decoded.players[0].flags, STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE);
    assertCloseTo(decoded.players[0].x, 0.0, 0.001);
    assertCloseTo(decoded.players[0].y, 17.5, 0.001);
    assertCloseTo(decoded.players[0].timerRemainingMs, 8500.0, 0.1);

    // Verify Player 1
    assertEqual(decoded.players[1].slot, 1);
    assertEqual(decoded.players[1].hp, 66);
    assertEqual(decoded.players[1].activeWeapon, 2);
    assertCloseTo(decoded.players[1].x, 25.4, 0.001);
    assertCloseTo(decoded.players[1].yaw, 2.14, 0.001);

    // Verify Player 2 (Dead)
    assertEqual(decoded.players[2].slot, 2);
    assertEqual(decoded.players[2].hp, 0);
    assertCloseTo(decoded.players[2].timerRemainingMs, 3200.0, 0.1);
  });

  // --- T1-NET-03: FIRE_HITSCAN (0x03) Ray Packet Serialization ---
  suite.test('T1-NET-03: FIRE_HITSCAN encodes and decodes 32-byte ray with origin and normalized direction', () => {
    const shooterSlot = 3;
    const weaponType = 1; // Sniper
    const shotSeq = 42;
    const clientTimestamp = 554433.22;
    const origin = [10.5, 18.2, -5.0];
    const direction = [0.0, 0.7071, -0.7071];

    const buffer = encodeFireHitscan(
      shooterSlot,
      weaponType,
      shotSeq,
      clientTimestamp,
      origin,
      direction
    );

    assertEqual(buffer.byteLength, FIRE_HITSCAN_BYTES, 'FIRE_HITSCAN must be exactly 32 bytes');
    assertEqual(peekPacketOpcode(buffer), PACKET_OPCODES.FIRE_HITSCAN, 'Opcode must be 0x03');

    const decoded = decodeFireHitscan(buffer);
    assert(decoded !== null, 'Decoded hitscan packet should not be null');
    assertEqual(decoded.shooterSlot, shooterSlot);
    assertEqual(decoded.weaponType, weaponType);
    assertEqual(decoded.shotSeq, shotSeq);
    assertCloseTo(decoded.clientTimestamp, clientTimestamp, 0.05);
    assertCloseTo(decoded.originX, 10.5, 0.001);
    assertCloseTo(decoded.originY, 18.2, 0.001);
    assertCloseTo(decoded.originZ, -5.0, 0.001);
    assertCloseTo(decoded.dirX, 0.0, 0.001);
    assertCloseTo(decoded.dirY, 0.7071, 0.001);
    assertCloseTo(decoded.dirZ, -0.7071, 0.001);

    // In-place decoder
    const reuse = {};
    assert(decodeFireHitscanInto(buffer, reuse));
    assertEqual(reuse.shooterSlot, shooterSlot);
    assertCloseTo(reuse.dirY, 0.7071, 0.001);
  });

  // --- T1-NET-04: HIT_CONFIRMED (0x04) 16-Byte Precision & Flags ---
  suite.test('T1-NET-04: HIT_CONFIRMED encodes into 16 bytes and decodes with decimeter precision', () => {
    const victimSlot = 4;
    const shooterSlot = 1;
    const flags = HIT_FLAGS.HEADSHOT | HIT_FLAGS.FATAL_KILL;
    const damage = 90;
    const newHp = 0;
    const hitX = 14.5;
    const hitY = 19.2;
    const hitZ = -33.8;

    const buffer = encodeHitConfirmed(
      victimSlot,
      shooterSlot,
      flags,
      damage,
      newHp,
      hitX,
      hitY,
      hitZ
    );

    assertEqual(buffer.byteLength, HIT_CONFIRMED_BYTES, 'HIT_CONFIRMED must be 16 bytes');
    assertEqual(peekPacketOpcode(buffer), PACKET_OPCODES.HIT_CONFIRMED, 'Opcode must be 0x04');

    const decoded = decodeHitConfirmed(buffer);
    assert(decoded !== null);
    assertEqual(decoded.victimSlot, victimSlot);
    assertEqual(decoded.shooterSlot, shooterSlot);
    assertEqual(decoded.damage, damage);
    assertEqual(decoded.newHp, newHp);
    assert(decoded.isHeadshot, 'isHeadshot flag must be true');
    assert(decoded.isFatalKill, 'isFatalKill flag must be true');
    assertEqual(decoded.isShieldBlocked, false, 'Shield was not active');

    // Decimeter precision (+/- 0.1m)
    assertCloseTo(decoded.hitX, hitX, 0.1, 'Hit X decimeter precision');
    assertCloseTo(decoded.hitY, hitY, 0.1, 'Hit Y decimeter precision');
    assertCloseTo(decoded.hitZ, hitZ, 0.1, 'Hit Z decimeter precision');

    // In-place decoder
    const reuse = {};
    assert(decodeHitConfirmedInto(buffer, reuse));
    assertEqual(reuse.victimSlot, victimSlot);
    assertEqual(reuse.damage, damage);
  });

  // --- T1-NET-05: SlotManager Lifecycle & Slot Recycling ---
  suite.test('T1-NET-05: SlotManager reserves slot 0 for Host, allocates client slots, and recycles freed slots', () => {
    const sm = new SlotManager(8);

    // Host registration
    const hostSlot = sm.registerHost('host_uuid');
    assertEqual(hostSlot, HOST_SLOT, 'Host must receive slot 0');
    assertEqual(sm.getSlot('host_uuid'), 0);
    assertEqual(sm.getUuid(0), 'host_uuid');

    // Client allocations
    const slot1 = sm.allocateSlot('client_A');
    const slot2 = sm.allocateSlot('client_B');
    const slot3 = sm.allocateSlot('client_C');

    assertEqual(slot1, 1, 'First client gets slot 1');
    assertEqual(slot2, 2, 'Second client gets slot 2');
    assertEqual(slot3, 3, 'Third client gets slot 3');
    assertEqual(sm.getActiveCount(), 4); // Host + 3 clients

    // Release slot 2
    const released = sm.releaseSlot(slot2);
    assertEqual(released, 'client_B');
    assertEqual(sm.hasSlot(2), false);
    assertEqual(sm.getActiveCount(), 3);

    // Next client should be recycled to the lowest free slot (slot 2)
    const slotRecycled = sm.allocateSlot('client_D');
    assertEqual(slotRecycled, 2, 'Freed slot 2 must be recycled first');
    assertEqual(sm.getUuid(2), 'client_D');

    // Capacity limit
    const smSmall = new SlotManager(3); // host(0) + 2 clients(1, 2)
    smSmall.registerHost('host');
    smSmall.allocateSlot('c1');
    smSmall.allocateSlot('c2');
    assertThrows(() => {
      smSmall.allocateSlot('c3');
    }, /Exceeded maximum capacity/);
  });


  // --- T1-NET-07: Lobby Binary Protocol ---
  suite.test('T1-NET-07: Lobby Binary Protocol encodes and decodes handshake and string exchanges', () => {
    // 1. Join Request
    const joinBuf = encodeLobbyJoin('uuid-1234', 'NeonPlayer', '#00F0FF');
    assertEqual(peekPacketOpcode(joinBuf), PACKET_OPCODES.LOBBY_JOIN);
    
    const joinMsg = decodeLobbyMessage(joinBuf);
    assert(joinMsg !== null);
    assertEqual(joinMsg.type, 'JOIN_REQUEST');
    assertEqual(joinMsg.playerId, 'uuid-1234');
    assertEqual(joinMsg.playerName, 'NeonPlayer');
    assertEqual(joinMsg.proposedColor, '#00F0FF');
    
    // 2. Join Accepted
    const sessionPlayers = [
      { id: 'host-uuid', name: 'Host', color: '#FF007F', slot: 0 },
      { id: 'uuid-1234', name: 'NeonPlayer', color: '#00F0FF', slot: 1 }
    ];
    const acceptBuf = encodeLobbyJoinAccepted('uuid-1234', '#00F0FF', 1, sessionPlayers);
    assertEqual(peekPacketOpcode(acceptBuf), PACKET_OPCODES.LOBBY_JOIN_ACCEPTED);
    
    const acceptMsg = decodeLobbyMessage(acceptBuf);
    assert(acceptMsg !== null);
    assertEqual(acceptMsg.type, 'JOIN_ACCEPTED');
    assertEqual(acceptMsg.playerId, 'uuid-1234');
    assertEqual(acceptMsg.assignedColor, '#00F0FF');
    assertEqual(acceptMsg.assignedSlot, 1);
    assertEqual(acceptMsg.sessionPlayers.length, 2);
    assertEqual(acceptMsg.sessionPlayers[0].name, 'Host');
    assertEqual(acceptMsg.sessionPlayers[1].slot, 1);
    
    // 3. Color Changed
    const colBuf = encodeLobbyColorChanged('uuid-1234', '#FFAA00');
    assertEqual(peekPacketOpcode(colBuf), PACKET_OPCODES.LOBBY_COLOR_CHANGED);
    const colMsg = decodeLobbyMessage(colBuf);
    assert(colMsg !== null);
    assertEqual(colMsg.type, 'COLOR_CHANGED');
    assertEqual(colMsg.playerId, 'uuid-1234');
    assertEqual(colMsg.newColor, '#FFAA00');

    // 4. Game Start
    const gsBuf = encodeLobbyGameStart();
    assertEqual(peekPacketOpcode(gsBuf), PACKET_OPCODES.GAME_START);
    const gsMsg = decodeLobbyMessage(gsBuf);
    assert(gsMsg !== null);
    assertEqual(gsMsg.type, 'GAME_START');
    
    // 5. Fallback resilience
    assertEqual(decodeLobbyMessage(new ArrayBuffer(0)), null);
    
    // Truncated packet
    const truncBuf = joinBuf.slice(0, 5);
    assertEqual(decodeLobbyMessage(truncBuf), null);
  });

  // --- T1-NET-06: Corrupted Payload & Truncation Resilience ---
  suite.test('T1-NET-06: Decoders safely handle truncated and corrupted packets without crashing', () => {
    const emptyBuf = new ArrayBuffer(0);
    assertEqual(peekPacketOpcode(emptyBuf), null);
    assertEqual(decodeClientState(emptyBuf), null);
    assertEqual(decodeWorldSnapshot(emptyBuf), null);
    assertEqual(decodeFireHitscan(emptyBuf), null);
    assertEqual(decodeHitConfirmed(emptyBuf), null);

    // Partial 15-byte packet
    const partialBuf = new ArrayBuffer(15);
    new DataView(partialBuf).setUint8(0, PACKET_OPCODES.CLIENT_STATE);
    assertEqual(decodeClientState(partialBuf), null);

    // Opcode mismatch
    const corruptedBuf = new ArrayBuffer(32);
    new DataView(corruptedBuf).setUint8(0, 0x99); // Unknown opcode
    assertEqual(decodeClientState(corruptedBuf), null);
    assertEqual(decodeFireHitscan(corruptedBuf), null);

    // Sequence wrap-around test: seq = 65535 encodes cleanly
    const wrapBuf = encodeClientState(1, 65535, 100, 0, 0, 0, 0, 0, 0, 0);
    const wrapDecoded = decodeClientState(wrapBuf);
    assertEqual(wrapDecoded.seq, 65535);
  });
}

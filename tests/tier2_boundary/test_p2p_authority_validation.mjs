import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { PACKET_OPCODES } from '../../game-web/src/net/binaryProtocol.ts';
import { assert, assertEqual } from '../helpers/assertions.mjs';
import { MAZE_PLAYER_RADIUS, MAZE_WALLS } from '../../game-web/src/world/mazeLayout.ts';

function createGuestRecord(overrides = {}) {
  return {
    id: 'guest',
    slot: 1,
    name: 'Guest',
    color: '#FF00FF',
    hp: 100,
    isAlive: true,
    deathTime: 0,
    shieldExpiresAt: 0,
    position: { x: 0, y: 17.5, z: 0 },
    yaw: 0,
    pitch: 0,
    activeWeapon: 1,
    stateFlags: 1,
    lastClientSeq: 0,
    lastClientTimestamp: 0,
    ...overrides,
  };
}

function createShot(overrides = {}) {
  return {
    opcode: PACKET_OPCODES.FIRE_HITSCAN,
    shooterSlot: 1,
    weaponType: 1,
    shotSeq: 1,
    shotSequence: 1,
    clientTimestamp: performance.now(),
    originX: 0,
    originY: 17.3,
    originZ: 0,
    origin: [0, 17.3, 0],
    dirX: 0,
    dirY: 0,
    dirZ: 1,
    direction: [0, 0, 1],
    ...overrides,
  };
}

function createClientState(overrides = {}) {
  const seq = overrides.seq ?? 0;
  const x = overrides.x ?? 0.5;
  const y = overrides.y ?? 17.5;
  const z = overrides.z ?? 0.25;
  return {
    opcode: PACKET_OPCODES.CLIENT_STATE,
    slot: 1,
    playerSlot: 1,
    seq,
    sequence: overrides.sequence ?? seq,
    timestamp: overrides.timestamp ?? 1000 + seq,
    x,
    y,
    z,
    position: overrides.position ?? { x, y, z },
    yaw: 0.25,
    pitch: -0.1,
    flags: 0,
    activeWeapon: 1,
    reserved: 0,
    ...overrides,
  };
}

export async function run(suite) {
  suite.test('Host receipt clock prevents forged client timestamps from bypassing fire cadence', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const guest = createGuestRecord();
    host.playerRecords.set('guest', guest);

    const first = createShot({ shotSeq: 7, shotSequence: 7, clientTimestamp: 1 });
    assert(host.validateAndAnchorShot('guest', guest, first), 'First valid guest shot must be accepted');

    const forgedFuture = createShot({
      shotSeq: 8,
      shotSequence: 8,
      clientTimestamp: 1_000_000_000,
    });
    assert(
      !host.validateAndAnchorShot('guest', guest, forgedFuture),
      'Forging a future clientTimestamp must not bypass host-authoritative cadence',
    );
    assertEqual(host.__gonePvpHardeningState.rejectedCadence, 1);
  });

  suite.test('Guest fire sequence rejects rollback/replay while preserving 255-to-0 wrap', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const guest = createGuestRecord();
    host.playerRecords.set('guest', guest);
    const state = host.__gonePvpHardeningState;

    state.lastClientShotTime.set('guest', performance.now() - 5_000);
    state.lastShotSeq.set('guest', 20);
    assert(
      !host.validateAndAnchorShot('guest', guest, createShot({ shotSeq: 19, shotSequence: 19 })),
      'Stale modulo-8-bit shot sequence must be rejected',
    );

    state.lastClientShotTime.set('guest', performance.now() - 5_000);
    state.lastShotSeq.set('guest', 255);
    assert(
      host.validateAndAnchorShot('guest', guest, createShot({ shotSeq: 0, shotSequence: 0 })),
      'Normal 255-to-0 shot sequence wrap must remain valid',
    );
  });

  suite.test('Authoritative CLIENT_STATE rejects duplicates, stale packets and non-finite or invalid fields', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const guest = createGuestRecord({ activeWeapon: 0 });
    host.playerRecords.set('guest', guest);

    host.processClientState('guest', createClientState({ seq: 0, sequence: 0 }));
    assertEqual(guest.position.x, 0.5, 'First plausible seq=0 state must be accepted');
    assertEqual(guest.activeWeapon, 1);
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({ seq: 0, sequence: 0, x: 999 }));
    assertEqual(guest.position.x, 0.5, 'Duplicate CLIENT_STATE must not replay movement');

    host.processClientState('guest', createClientState({ seq: 1, sequence: 1, x: Number.NaN }));
    assertEqual(guest.position.x, 0.5, 'NaN position must not poison authoritative state');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({ seq: 1, sequence: 1, y: Number.POSITIVE_INFINITY }));
    assertEqual(guest.position.y, 17.5, 'Infinity position must not poison authoritative state');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({ seq: 1, sequence: 1, activeWeapon: 255 }));
    assertEqual(guest.activeWeapon, 1, 'Out-of-range active weapon must be rejected');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({
      seq: 1,
      sequence: 1,
      x: 1,
      z: 0.5,
      position: { x: 1, y: 17.5, z: 0.5 },
      activeWeapon: 0,
    }));
    assertEqual(guest.position.x, 1, 'Next plausible forward sequence must still be accepted');
    assertEqual(guest.activeWeapon, 0);
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 1);

    host.processClientState('guest', createClientState({ seq: 0, sequence: 0, x: 777 }));
    assertEqual(guest.position.x, 1, 'Stale sequence rollback must not overwrite state');
  });

  suite.test('Movement authority rejects speed-hack, teleport, stale time and impossible vertical deltas', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const guest = createGuestRecord();
    host.playerRecords.set('guest', guest);

    host.processClientState('guest', createClientState({ seq: 0, timestamp: 1000, x: 0.5, z: 0 }));
    assertEqual(guest.position.x, 0.5, 'Plausible baseline state should be accepted');

    host.processClientState('guest', createClientState({ seq: 1, timestamp: 1001, x: 6, z: 0 }));
    assertEqual(guest.position.x, 0.5, 'Impossible short-window horizontal speed must be rejected');
    assert(host.__gonePvpHardeningState.rejectedHorizontalSpeed >= 1, 'Speed-hack rejection must be classified');

    host.processClientState('guest', createClientState({ seq: 1, timestamp: 1002, x: 100, z: 0 }));
    assertEqual(guest.position.x, 0.5, 'Arbitrary teleport must be rejected');
    assert(host.__gonePvpHardeningState.rejectedTeleport >= 1, 'Teleport rejection must be classified');

    host.processClientState('guest', createClientState({ seq: 1, timestamp: 999, x: 0.75, z: 0 }));
    assertEqual(guest.position.x, 0.5, 'Older client timestamp must not overwrite authoritative state');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);
    assert(host.__gonePvpHardeningState.rejectedStaleTimestamp >= 1, 'Stale timestamp rejection must be tracked');

    host.processClientState('guest', createClientState({ seq: 1, timestamp: 1003, x: 0.5, y: 40, z: 0 }));
    assertEqual(guest.position.y, 17.5, 'Physically impossible upward jump must be rejected');
    assert(host.__gonePvpHardeningState.rejectedVerticalMovement >= 1, 'Vertical rejection must be tracked');

    host.processClientState('guest', createClientState({ seq: 1, timestamp: 1_000_000_000, x: 500, z: 500 }));
    assertEqual(guest.position.x, 0.5, 'Forged future timestamp must not buy host movement credit');
  });

  suite.test('Host-authoritative respawn resets movement validation without authorizing arbitrary client teleports', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const guest = createGuestRecord({ position: { x: 0, y: 17.5, z: 0 } });
    host.playerRecords.set('guest', guest);
    host.setRespawnPositionResolver(() => ({ x: 1200, y: 80, z: 1200 }));

    assert(host.respawnPlayer('guest'), 'Host respawn transition must succeed');
    assertEqual(guest.position.x, 1200);
    assertEqual(guest.position.z, 1200);

    host.processClientState('guest', createClientState({
      seq: 0,
      timestamp: 2000,
      x: 1200.5,
      y: 80,
      z: 1200.25,
    }));
    assertEqual(guest.position.x, 1200.5, 'Small movement after host-owned respawn must be accepted');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({
      seq: 1,
      timestamp: 2001,
      x: 1400,
      y: 80,
      z: 1400,
    }));
    assertEqual(guest.position.x, 1200.5, 'Respawn authorization must not become a reusable teleport exemption');
  });

  suite.test('Host rejects physically plausible guest movement into a canonical maze wall', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    const wall = MAZE_WALLS[0];
    const startZ = wall.z - wall.depth * 0.5 - MAZE_PLAYER_RADIUS - 0.35;
    const guest = createGuestRecord({
      position: { x: wall.x, y: 17.5, z: startZ },
      activeWeapon: 0,
    });
    host.playerRecords.set('guest', guest);

    host.processClientState('guest', createClientState({
      seq: 0,
      timestamp: 1000,
      x: wall.x,
      y: 17.5,
      z: startZ + 1,
      activeWeapon: 0,
    }));

    assertEqual(guest.position.z, startZ, 'maze collision must keep the last authoritative position');
    assertEqual(host.__gonePvpHardeningState.rejectedWorldCollision, 1);
    assertEqual(
      host.__gonePvpHardeningState.lastClientStateSeq.has('guest'),
      false,
      'rejected wall movement must not advance CLIENT_STATE authority',
    );
    host.destroy();
  });

  suite.test('Host hitscan cannot damage a player through a canonical maze wall', () => {
    let hitConfirmed = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' },
      onHitConfirmed: (hit) => { hitConfirmed = hit; },
    });
    const wall = MAZE_WALLS[0];
    const shooter = host.playerRecords.get('host');
    shooter.position = { x: wall.x, y: 17.5, z: wall.z - 20 };
    shooter.shieldExpiresAt = 0;

    const victim = createGuestRecord({
      id: 'victim',
      slot: 2,
      position: { x: wall.x, y: 17.5, z: wall.z + 20 },
      activeWeapon: 0,
      shieldExpiresAt: 0,
    });
    host.playerRecords.set(victim.id, victim);

    host.fireHitscan(
      host.hostPlayer.id,
      0,
      [shooter.position.x, 17.3, shooter.position.z],
      [0, 0, 1],
    );

    assertEqual(victim.hp, 100, 'maze wall must occlude authoritative damage');
    assertEqual(hitConfirmed, null, 'occluded shot must not emit a hit confirmation');
    host.destroy();
  });

}

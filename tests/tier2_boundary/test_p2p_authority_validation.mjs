import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { PACKET_OPCODES } from '../../game-web/src/net/binaryProtocol.ts';
import { assert, assertEqual } from '../helpers/assertions.mjs';

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
  return {
    opcode: PACKET_OPCODES.CLIENT_STATE,
    slot: 1,
    playerSlot: 1,
    seq: 0,
    sequence: 0,
    timestamp: performance.now(),
    x: 10,
    y: 17.5,
    z: 20,
    position: { x: 10, y: 17.5, z: 20 },
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
    assertEqual(guest.position.x, 10, 'First seq=0 state must be accepted');
    assertEqual(guest.activeWeapon, 1);
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({ seq: 0, sequence: 0, x: 999 }));
    assertEqual(guest.position.x, 10, 'Duplicate CLIENT_STATE must not replay movement');

    host.processClientState('guest', createClientState({ seq: 1, sequence: 1, x: Number.NaN }));
    assertEqual(guest.position.x, 10, 'NaN position must not poison authoritative state');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({ seq: 1, sequence: 1, activeWeapon: 255 }));
    assertEqual(guest.activeWeapon, 1, 'Out-of-range active weapon must be rejected');
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 0);

    host.processClientState('guest', createClientState({
      seq: 1,
      sequence: 1,
      x: 12,
      position: { x: 12, y: 17.5, z: 20 },
      activeWeapon: 0,
    }));
    assertEqual(guest.position.x, 12, 'Next valid forward sequence must still be accepted');
    assertEqual(guest.activeWeapon, 0);
    assertEqual(host.__gonePvpHardeningState.lastClientStateSeq.get('guest'), 1);

    host.processClientState('guest', createClientState({ seq: 0, sequence: 0, x: 777 }));
    assertEqual(guest.position.x, 12, 'Stale sequence rollback must not overwrite state');
  });
}

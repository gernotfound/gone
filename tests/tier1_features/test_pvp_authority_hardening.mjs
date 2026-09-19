import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { assert, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import {
  encodeClientState,
  encodeFireHitscan,
  encodeLobbyColorRequest,
  encodeLobbyJoin,
} from '../../game-web/src/net/binaryProtocol.ts';
import {
  isForwardSequence,
  movementEnvelopeAllows,
  sanitizePlayerName,
  validatePeerClaim,
} from '../../game-web/src/net/hostAuthorityPolicy.ts';

const here = dirname(fileURLToPath(import.meta.url));
const networkBindingsSource = fs.readFileSync(
  resolve(here, '../../game-web/src/gameplay/networkBindings.ts'),
  'utf8',
);
const roundLifecycleSource = fs.readFileSync(
  resolve(here, '../../game-web/src/gameplay/deathmatchRoundLifecycle.ts'),
  'utf8',
);

class MockChannel {
  binaryType = 'arraybuffer';
  readyState = 'open';
  sent = [];
  closed = false;

  send(data) {
    this.sent.push(data);
  }

  close() {
    this.closed = true;
    this.readyState = 'closed';
  }
}

function join(host, playerId, color = '#00F0FF', playerName = playerId) {
  const channel = new MockChannel();
  host.handleChannelMessage(
    playerId,
    channel,
    encodeLobbyJoin(playerId, playerName, color),
  );
  const slot = host.playerIdToSlot.get(playerId);
  assert(Number.isInteger(slot), `expected ${playerId} to receive a slot`);
  return { channel, slot };
}

export async function run(suite) {
  suite.test('Transport identity rejects host impersonation and cross-peer claims', () => {
    assertEqual(validatePeerClaim('guest-a', 'guest-a', 'host').ok, true);
    assertEqual(validatePeerClaim('guest-a', 'host', 'host').ok, false);
    assertEqual(validatePeerClaim('guest-a', 'guest-b', 'host').ok, false);
    assertEqual(validatePeerClaim('host', 'host', 'host').ok, false);
    assertEqual(validatePeerClaim('../guest', '../guest', 'host').ok, false);
    assertEqual(sanitizePlayerName('   Alice\n\t   Bob   '), 'Alice Bob');
    assertEqual(sanitizePlayerName('x'.repeat(100)).length, 32);
  });

  suite.test('Spoofed JOIN cannot replace the authoritative host record', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#FFE600' } });
    const hostRecord = host.playerRecords.get('host');
    const channel = new MockChannel();

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeLobbyJoin('host', 'fake host', '#00F0FF'),
    );

    assertEqual(channel.closed, true, 'spoofing peer should be torn down');
    assertEqual(host.getClientCount(), 0, 'spoofed JOIN must not create a peer');
    assertEqual(host.playerRecords.get('host'), hostRecord, 'host combat record must remain intact');
    assertEqual(host.playerIdToSlot.get('host'), 0, 'host slot ownership must remain intact');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedIdentity, 0);
    host.destroy();
  });

  suite.test('Duplicate JOIN cannot heal, resurrect or refresh shield', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#FFE600' } });
    host.setRespawnPositionResolver((slot) => ({ x: slot * 10, y: 17.5, z: 0 }));
    const { channel } = join(host, 'guest-a', '#00F0FF');
    const record = host.playerRecords.get('guest-a');
    record.hp = 0;
    record.isAlive = false;
    record.deathTime = performance.now();
    record.shieldExpiresAt = 0;
    const originalRecord = record;

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeLobbyJoin('guest-a', 'guest-a', '#00F0FF'),
    );

    assertEqual(channel.closed, true, 'duplicate JOIN should close the offending channel');
    assertEqual(host.playerRecords.get('guest-a'), originalRecord, 'duplicate JOIN must not replace combat state');
    assertEqual(record.hp, 0, 'duplicate JOIN must not heal');
    assertEqual(record.isAlive, false, 'duplicate JOIN must not resurrect');
    assertEqual(record.shieldExpiresAt, 0, 'duplicate JOIN must not refresh shield');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedDuplicateJoin, 0);
    host.destroy();
  });

  suite.test('COLOR_REQUEST may mutate only the transport-owned player', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#FFE600' } });
    const a = join(host, 'guest-a', '#00F0FF');
    join(host, 'guest-b', '#FF007F');
    const before = host.playerRecords.get('guest-b').color;

    host.handleChannelMessage(
      'guest-a',
      a.channel,
      encodeLobbyColorRequest('guest-b', '#39FF14'),
    );

    assertEqual(a.channel.closed, true, 'cross-peer color spoof should tear down the sender');
    assertEqual(host.playerRecords.get('guest-b').color, before, 'victim color must remain unchanged');
    host.destroy();
  });

  suite.test('Guest movement rejects teleport, replay and non-finite transforms', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#FFE600' } });
    host.setRespawnPositionResolver(() => ({ x: 0, y: 17.5, z: 0 }));
    const { channel, slot } = join(host, 'guest-a', '#00F0FF');

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeClientState(slot, 0, performance.now(), 0.5, 17.5, 0, 0, 0, 0, 0),
    );
    const record = host.playerRecords.get('guest-a');
    assertEqual(record.position.x, 0.5, 'plausible first movement must be accepted');

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeClientState(slot, 1, performance.now(), 500, 17.5, 0, 0, 0, 0, 0),
    );
    assertEqual(record.position.x, 0.5, 'teleport must not replace authoritative position');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedMovement, 0);

    const malformedBefore = host.__gonePvpHardeningState.rejectedMalformedState;
    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeClientState(slot, 2, performance.now(), Number.NaN, 17.5, 0, 0, 0, 0, 0),
    );
    assertEqual(record.position.x, 0.5, 'NaN transform must not enter authoritative state');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedMalformedState, malformedBefore);

    const replayBefore = host.__gonePvpHardeningState.rejectedMalformedState;
    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeClientState(slot, 0, performance.now(), 0.75, 17.5, 0, 0, 0, 0, 0),
    );
    assertEqual(record.position.x, 0.5, 'replayed sequence must be ignored');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedMalformedState, replayBefore);
    host.destroy();
  });

  suite.test('Guest fire cadence uses host receive time, not forged client timestamps', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#FFE600' } });
    const { channel, slot } = join(host, 'guest-a', '#00F0FF');

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeFireHitscan(slot, 0, 0, 1_000_000, [0, 17.3, 0], [0, 0, 1]),
    );
    const acceptedAfterFirst = host.__gonePvpHardeningState.accepted;

    host.handleChannelMessage(
      'guest-a',
      channel,
      encodeFireHitscan(slot, 0, 1, 9_000_000, [0, 17.3, 0], [0, 0, 1]),
    );

    assertEqual(acceptedAfterFirst, 1, 'first valid guest shot should pass validation');
    assertEqual(host.__gonePvpHardeningState.accepted, 1, 'forged future timestamp must not bypass cadence');
    assertGreaterThan(host.__gonePvpHardeningState.rejectedCadence, 0);
    host.destroy();
  });

  suite.test('Authority helpers preserve modulo sequence wrap and bounded movement', () => {
    assertEqual(isForwardSequence(255, 0, 8), true, '8-bit wrap must advance');
    assertEqual(isForwardSequence(255, 255, 8), false, 'duplicate shot sequence must reject');
    assertEqual(isForwardSequence(65535, 0, 16), true, '16-bit state wrap must advance');
    assertEqual(isForwardSequence(100, 99, 16), false, 'backward state sequence must reject');
    assertEqual(
      movementEnvelopeAllows({ x: 0, y: 10, z: 0 }, { x: 4, y: 10, z: 0 }, 100),
      true,
      'short plausible movement must be allowed',
    );
    assertEqual(
      movementEnvelopeAllows({ x: 0, y: 10, z: 0 }, { x: 100, y: 10, z: 0 }, 100),
      false,
      'short-window teleport must reject',
    );
  });

  suite.test('Guest snapshots reconcile host respawn/corrections without continuous prediction snapping', () => {
    assert(
      networkBindingsSource.includes('const LOCAL_AUTHORITY_SNAP_DISTANCE = 8'),
      'client authority correction needs a non-zero prediction tolerance',
    );
    assert(
      networkBindingsSource.includes('applyAuthoritativeLocalPosition(player, state, respawnedByHost)'),
      'host respawn snapshot must force local coordinate reconciliation',
    );
    assert(
      networkBindingsSource.includes('player.velocity?.set(0, 0, 0)'),
      'authoritative correction must clear stale movement velocity',
    );
    assert(
      !roundLifecycleSource.includes('goneSpawnPolicy?.respawnNow?.()'),
      'round lifecycle must not invoke manual spawn after host-selected respawn',
    );
  });
}

import { assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { encodeLobbyJoin } from '../../game-web/src/net/binaryProtocol.ts';
import { getSafestRespawnPoint, SPAWN_POINTS } from '../../game-web/src/gameplay/spawnSelection.ts';

function combatRecord(id, slot, z) {
  return {
    id,
    slot,
    name: id,
    color: '#00F0FF',
    hp: 100,
    isAlive: true,
    deathTime: 0,
    shieldExpiresAt: 0,
    position: { x: 0, y: 17.5, z },
    yaw: 0,
    pitch: 0,
    activeWeapon: 0,
    stateFlags: 1,
    lastClientSeq: 0,
    lastClientTimestamp: 0,
  };
}

function distanceSq(a, b) {
  return (a.x - b.x) ** 2 + (a.z - b.z) ** 2;
}

export async function run(suite) {
  suite.test('PvP authority damages nearest intersected player, not Map insertion order', () => {
    let confirmed = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      onHitConfirmed: (hit) => { confirmed = hit; },
    });
    const shooter = host.playerRecords.get('host');
    shooter.position = { x: 0, y: 17.5, z: 0 };
    shooter.shieldExpiresAt = 0;

    // Intentionally insert the farther target first to catch insertion-order bugs.
    const far = combatRecord('far', 1, 20);
    const near = combatRecord('near', 2, 10);
    host.playerRecords.set('far', far);
    host.playerRecords.set('near', near);

    host.fireHitscan('host', 0, [0, 17.3, 0], [0, 0, 1]);

    assertEqual(confirmed?.victimId, 'near', 'nearest visible hit must win');
    assertEqual(far.hp, 100, 'farther aligned target must remain untouched');
    assertGreaterThan(100, near.hp, 'near target must receive damage');
    host.destroy();
  });

  suite.test('P2PHost respawn uses installed deterministic slot resolver for manual and timed respawn', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' } });
    host.setRespawnPositionResolver((slot) => ({ x: slot * 100, y: 50 + slot, z: slot * -100 }));

    const manual = combatRecord('manual', 3, 0);
    manual.isAlive = false;
    manual.hp = 0;
    manual.deathTime = performance.now();
    host.playerRecords.set('manual', manual);
    host.respawnPlayer('manual');
    assertEqual(manual.position.x, 300);
    assertEqual(manual.position.y, 53);
    assertEqual(manual.position.z, -300);

    const timed = combatRecord('timed', 4, 0);
    timed.isAlive = false;
    timed.hp = 0;
    timed.deathTime = performance.now() - 5001;
    host.playerRecords.set('timed', timed);
    host.tickSnapshot();
    assertEqual(timed.position.x, 400);
    assertEqual(timed.position.y, 54);
    assertEqual(timed.position.z, -400);
    assertEqual(host.getAuthoritativeRespawnCount(), 2);
    host.destroy();
  });

  suite.test('Guest join waits for terrain readiness before allocating authoritative spawn', async () => {
    let releaseReadiness = () => {};
    let terrainReady = false;
    const readiness = new Promise((resolve) => { releaseReadiness = resolve; });
    const sent = [];
    const channel = {
      readyState: 'open',
      send: (buffer) => sent.push(buffer),
      close() { this.readyState = 'closed'; this.onclose?.(); },
    };
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      beforeJoin: () => readiness,
    });
    host.setRespawnPositionResolver((slot) => {
      if (!terrainReady) throw new Error('Terrain core not ready');
      return { x: slot * 10, y: 50 + slot, z: 0 };
    });
    host.registerPeer('guest', channel);
    channel.onmessage({ data: encodeLobbyJoin('guest', 'Guest', '#FF007F') });
    channel.onmessage({ data: encodeLobbyJoin('guest', 'Guest', '#FF007F') });
    assertEqual(host.playerRecords.has('guest'), false, 'no guest state before core readiness');
    assertEqual(sent.length, 0, 'guest must not receive a premature join acceptance');

    terrainReady = true;
    releaseReadiness();
    await new Promise((resolve) => setImmediate(resolve));
    assertEqual(host.playerRecords.get('guest')?.position.y, 51, 'host must use canonical ready terrain resolver');
    assertEqual(sent.length, 1, 'duplicate pending join packets must create exactly one acceptance');
    host.destroy();
  });

  suite.test('Failed terrain startup rejects join without reserving a player slot', async () => {
    let reportedError = null;
    let closeCount = 0;
    const channel = {
      readyState: 'open',
      send() { throw new Error('join must not be accepted'); },
      close() { closeCount += 1; this.readyState = 'closed'; this.onclose?.(); },
    };
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      beforeJoin: () => Promise.reject(new Error('WASM startup failed')),
      onError: (error) => { reportedError = error; },
    });
    host.registerPeer('guest', channel);
    channel.onmessage({ data: encodeLobbyJoin('guest', 'Guest', '#FF007F') });
    await new Promise((resolve) => setImmediate(resolve));
    assertEqual(reportedError?.message, 'WASM startup failed');
    assertEqual(closeCount, 1, 'failed initialization must close the guest channel');
    assertEqual(host.playerRecords.has('guest'), false, 'failed join must not create player authority');
    assertEqual(host.playerIdToSlot.has('guest'), false, 'failed join must not reserve a slot');
    host.destroy();
  });

  suite.test('Destroyed host never admits a guest from a late readiness completion', async () => {
    let releaseReadiness = () => {};
    const readiness = new Promise((resolve) => { releaseReadiness = resolve; });
    const channel = { readyState: 'open', send() { throw new Error('late join must not send'); } };
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      beforeJoin: () => readiness,
    });
    host.registerPeer('guest', channel);
    channel.onmessage({ data: encodeLobbyJoin('guest', 'Guest', '#FF007F') });
    host.destroy();
    releaseReadiness();
    await new Promise((resolve) => setImmediate(resolve));
    assertEqual(host.playerRecords.has('guest'), false, 'late async completions cannot resurrect torn-down sessions');
  });

  suite.test('Threat-aware respawn maximizes nearest-opponent distance deterministically', () => {
    const defaultPoint = SPAWN_POINTS[0];
    const threats = [
      { slot: 1, isAlive: true, position: { x: defaultPoint.x, z: defaultPoint.z } },
      { slot: 2, isAlive: false, position: { x: SPAWN_POINTS[7].x, z: SPAWN_POINTS[7].z } },
    ];

    const selected = getSafestRespawnPoint(0, threats);
    const repeated = getSafestRespawnPoint(0, threats);
    assertEqual(selected.id, repeated.id, 'same authoritative world state must select the same respawn');
    assertGreaterThan(
      distanceSq(selected, threats[0].position),
      distanceSq(defaultPoint, threats[0].position),
      'safe respawn must move farther from an alive opponent camping the slot spawn',
    );
    assertEqual(
      getSafestRespawnPoint(3, []).id,
      SPAWN_POINTS[3].id,
      'without live threats the stable per-slot spawn must remain the fallback',
    );
  });
}

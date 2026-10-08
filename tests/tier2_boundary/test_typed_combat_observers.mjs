import fs from 'node:fs';
import path from 'node:path';
import { assert, assertEqual } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';
import { P2PClient } from '../../game-web/src/net/p2pClient.ts';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { encodeDeathmatchSnapshot } from '../../game-web/src/net/deathmatchProtocol.ts';
import { encodeFireHitscan, encodeHitConfirmed } from '../../game-web/src/net/binaryProtocol.ts';

export async function run(suite) {
  suite.test('Deathmatch snapshots are decoded once at client owner before lobby opcodes', () => {
    const client = new P2PClient({ playerId: 'guest', playerName: 'Guest' });
    const snapshots = [];
    const unsubscribe = client.subscribeDeathmatchSync((snapshot) => snapshots.push(snapshot));
    const snapshot = { round: 4, targetKills: 20, winnerSlot: 1, resetRemainingMs: 2500, rows: [
      { slot: 1, kills: 20, deaths: 0, damage: 2500, headshots: 5 },
    ] };
    const packet = encodeDeathmatchSnapshot(snapshot);
    client.handleMessage(packet);
    assertEqual(snapshots.length, 1);
    assertEqual(snapshots[0].round, 4);
    assertEqual(snapshots[0].winnerSlot, 1);
    const invalid = packet.slice(0, 4);
    client.handleMessage(invalid);
    assertEqual(snapshots.length, 1, 'Malformed binary extension must not emit');
    unsubscribe();
    client.handleMessage(packet);
    assertEqual(snapshots.length, 1, 'Unsubscribed client must not receive stale callbacks');
  });

  suite.test('Combat observers coexist with existing guest callbacks and isolate failures', () => {
    let legacyHit = 0;
    let legacyShot = 0;
    const client = new P2PClient({ playerId: 'guest', playerName: 'Guest',
      onHitConfirmed: () => { legacyHit += 1; },
      onBinaryHitscanFired: () => { legacyShot += 1; },
    });
    let observedHits = 0;
    let observedShots = 0;
    client.subscribeConfirmedHit(() => { throw new Error('observer must not break protocol'); });
    const stopHit = client.subscribeConfirmedHit(() => { observedHits += 1; });
    const stopShot = client.subscribeRemoteShot(() => { observedShots += 1; });
    const hit = encodeHitConfirmed(1, 0, 0, 18, 82, 0, 0, 0);
    client.handleMessage(hit);
    assertEqual(observedHits, 1);
    assertEqual(legacyHit, 1);
    const shot = encodeFireHitscan(0, 1, 1, 1000, [0, 2, 0], [0, 0, 1]);
    client.handleMessage(shot);
    assertEqual(observedShots, 1);
    assertEqual(legacyShot, 1);
    stopHit();
    stopShot();
    client.handleMessage(hit);
    client.handleMessage(shot);
    assertEqual(observedHits, 1);
    assertEqual(observedShots, 1);
  });

  suite.test('Round lock is enforced by host before validating or emitting a shot', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'Host', color: '#00F0FF' } });
    let accepted = 0;
    const detach = host.subscribeAcceptedShot(() => { accepted += 1; });
    const prior = host.__gonePvpHardeningState.accepted;
    host.setRoundLocked(true);
    host.fireHitscan('host', 1, [0, 17.3, 0], [0, 0, 1]);
    assertEqual(host.blockedRoundShots, 1);
    assertEqual(host.__gonePvpHardeningState.accepted, prior);
    assertEqual(accepted, 0);
    host.setRoundLocked(false);
    assert(!host.isRoundLocked(), 'Unlocked rounds must resume canonical combat validation');
    detach();
    host.destroy();
  });

  suite.test('Presentation adapters cannot patch host/client methods or poll to reconnect observers', () => {
    for (const name of ['combatEventBridge.ts', 'deathmatchAuthority.ts', 'remoteShotPresentation.ts']) {
      const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'net', name), 'utf8');
      assert(!source.includes('.prototype'), name + ' must not mutate prototype methods');
      assert(!source.includes('processFireHitscan =') && !source.includes('handleMessage ='), name + ' must not overwrite protocol owners');
    }
    const remote = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web/src/net/remoteShotPresentation.ts'), 'utf8');
    assert(!remote.includes('setInterval('), 'Remote presentation must follow explicit session transitions');
    assert(remote.includes('subscribeAcceptedShot') && remote.includes('subscribeRemoteShot'), 'Remote VFX must consume typed protocol events');
  });
}

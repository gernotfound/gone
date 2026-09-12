import { assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';

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
}

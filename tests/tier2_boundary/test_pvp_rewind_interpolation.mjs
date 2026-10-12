import { SimpleLagCompensator } from '../../game-web/src/net/simpleLagCompensator.ts';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { PACKET_OPCODES } from '../../game-web/src/net/binaryProtocol.ts';
import { assert, assertEqual, assertCloseTo } from '../helpers/assertions.mjs';

function record(validator, playerId, at, x, z = 20) {
  validator.record_player_position(playerId, at, x, 17.5, z, 0.45, 2);
}

function fireAt(validator, timestamp, maxUnlag = 500) {
  return JSON.parse(validator.validate_rewind_hitscan(
    0, 1, 0, timestamp, maxUnlag,
    0, 17.3, 0,
    0, 0, 1, 180,
  ));
}

export async function run(suite) {
  suite.test('PvP rewind interpolates fast-moving target between 30 Hz states', () => {
    const validator = new SimpleLagCompensator(500);
    record(validator, 1, 1000, -1.25);
    record(validator, 1, 1100, 1.25);

    assert(!fireAt(validator, 1000).hit, 'first endpoint must miss');
    assert(!fireAt(validator, 1100).hit, 'last endpoint must miss');
    const midpoint = fireAt(validator, 1050);
    assert(midpoint.hit, 'a ray through the interpolated midpoint must hit');
    assertEqual(midpoint.is_headshot, false);
    assertCloseTo(midpoint.distance, 19.5, 0.01);
    assertEqual(midpoint.damage, 18);
  });

  suite.test('Rewind window clamps old client timestamps before interpolation', () => {
    const validator = new SimpleLagCompensator(500);
    record(validator, 1, 1000, 0);
    record(validator, 1, 1100, 2);
    assert(!fireAt(validator, 1000, 25).hit,
      'requesting an old hit must not rewind beyond the host budget');
  });

  suite.test('Respawn history clearing prevents interpolation across teleports', () => {
    const validator = new SimpleLagCompensator(500);
    record(validator, 1, 1000, -1.25);
    validator.clear_player(1);
    record(validator, 1, 1100, 1.25);
    assert(!fireAt(validator, 1050).hit, 'old-life positions must not create a ghost target');
  });

  suite.test('P2PHost confirms interpolated shots through canonical hit authority', () => {
    const validator = new SimpleLagCompensator(500);
    let confirmed = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      lagCompensator: validator,
      onHitConfirmed: hit => { confirmed = hit; },
    });
    const shooter = host.playerRecords.get('host');
    shooter.position = { x: 0, y: 17.5, z: 0 };
    const victim = {
      id: 'moving', slot: 1, name: 'Moving', color: '#FF00FF',
      hp: 100, isAlive: true, deathTime: 0, shieldExpiresAt: 0,
      position: { x: 1.25, y: 17.5, z: 20 },
      yaw: 0, pitch: 0, activeWeapon: 0, stateFlags: 1,
      lastClientSeq: 0, lastClientTimestamp: 0,
    };
    host.playerRecords.set('moving', victim);
    const now = performance.now();
    record(validator, 1, now - 100, -1.25);
    record(validator, 1, now, 1.25);
    host.processFireHitscan('host', {
      opcode: PACKET_OPCODES.FIRE_HITSCAN,
      shooterSlot: 0, weaponType: 0, shotSeq: 1, shotSequence: 1,
      clientTimestamp: now - 50,
      originX: 0, originY: 17.3, originZ: 0, origin: [0, 17.3, 0],
      dirX: 0, dirY: 0, dirZ: 1, direction: [0, 0, 1],
    });
    assertEqual(confirmed?.victimId, 'moving', 'host should confirm historical midpoint');
    assertEqual(victim.hp, 82, 'only the host can apply the 18 HP damage');
    host.destroy();
  });
}

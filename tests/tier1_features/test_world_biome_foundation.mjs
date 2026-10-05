import fs from 'fs';
import path from 'path';
import {
  BIOMES,
  getBiomeAt,
} from '../../game-web/src/world/biomeRegistry.ts';
import { HEALTH_PICKUP_AUTHORITY } from '../../game-web/src/net/clientStateExtensions.ts';
import {
  CENTRAL_HUB_RADIUS,
  CENTRAL_SUPPLY_MAX_RADIUS,
  CENTRAL_SUPPLY_MIN_RADIUS,
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  SPAWN_POINTS,
  WORLD_CENTER_X,
  WORLD_CENTER_Z,
} from '../../game-web/src/gameplay/spawnSelection.ts';
import { assert, assertEqual } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('World spawn is centered and every multiplayer slot stays inside the central hub', () => {
    assertEqual(WORLD_CENTER_X, 0);
    assertEqual(WORLD_CENTER_Z, 0);
    assertEqual(PLAYER_SPAWN_X, 0);
    assertEqual(PLAYER_SPAWN_Z, 0);
    assertEqual(SPAWN_POINTS[0].x, 0);
    assertEqual(SPAWN_POINTS[0].z, 0);

    for (const point of SPAWN_POINTS) {
      assert(
        Math.hypot(point.x - WORLD_CENTER_X, point.z - WORLD_CENTER_Z) <= CENTRAL_HUB_RADIUS,
        `spawn ${point.id} must stay inside the central hub`,
      );
    }
  });

  suite.test('Supplies live in an annulus around the central spawn instead of the southeast crater', () => {
    assert(CENTRAL_SUPPLY_MIN_RADIUS > CENTRAL_HUB_RADIUS, 'loot must start outside the protected spawn clearing');
    assert(CENTRAL_SUPPLY_MAX_RADIUS > CENTRAL_SUPPLY_MIN_RADIUS, 'central loot annulus must have positive width');

    assertEqual(HEALTH_PICKUP_AUTHORITY.centerX, WORLD_CENTER_X);
    assertEqual(HEALTH_PICKUP_AUTHORITY.centerZ, WORLD_CENTER_Z);
    assert(
      HEALTH_PICKUP_AUTHORITY.minRadius < CENTRAL_SUPPLY_MIN_RADIUS,
      'host authority must include pickup interaction slack at the inner edge',
    );
    assert(
      HEALTH_PICKUP_AUTHORITY.maxRadius > CENTRAL_SUPPLY_MAX_RADIUS,
      'host authority must include pickup interaction slack at the outer edge',
    );

    const pickup = source('game-web', 'src', 'gameplay', 'craterSupplyPickups.ts');
    assert(pickup.includes('randomCentralSupplyPoint'), 'pickup placement must be central-hub based');
    assert(pickup.includes('WORLD_CENTER_X') && pickup.includes('WORLD_CENTER_Z'), 'pickup placement must use world center');
    assert(!pickup.includes('GIANT_CRATER_CENTER_X') && !pickup.includes('GIANT_CRATER_CENTER_Z'), 'crater coordinates must not drive supply placement');

    const host = source('game-web', 'src', 'net', 'p2pHost.ts');
    assert(host.includes('supplyDistance >= HEALTH_PICKUP_AUTHORITY.minRadius'), 'host must reject forged health pickup requests inside the hub');
    assert(host.includes('supplyDistance <= HEALTH_PICKUP_AUTHORITY.maxRadius'), 'host must reject forged health pickup requests outside the supply annulus');
  });

  suite.test('Biome registry maps the hub and four maze sectors deterministically', () => {
    assertEqual(getBiomeAt(0, 0).id, BIOMES.central_hub.id);
    assertEqual(getBiomeAt(-900, -900).id, BIOMES.alpine_fissures.id);
    assertEqual(getBiomeAt(900, -900).id, BIOMES.flooded_lowlands.id);
    assertEqual(getBiomeAt(900, 900).id, BIOMES.ash_basin.id);
    assertEqual(getBiomeAt(-900, 900).id, BIOMES.overgrown_ruins.id);

    const chunks = source('game-web', 'src', 'world', 'chunkManager.ts');
    assert(chunks.includes('applyBiomePaletteToChunk'), 'streamed terrain must apply the biome palette');

    const liveMap = source('game-web', 'src', 'gameplay', 'liveMapOverlay.ts');
    assert(liveMap.includes('NUCLEO ZERO · SPAWN'), 'live map must identify the new central spawn');
    assert(liveMap.includes('CRATERE DEL SEGNALE'), 'live map must preserve the southeast crater as a landmark');
    assert(!liveMap.includes('SPAWN · CRATERE SE'), 'legacy crater-spawn labeling must be removed');
  });
}

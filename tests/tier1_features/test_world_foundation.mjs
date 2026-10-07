import fs from 'fs';
import path from 'path';
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

  suite.test('World presentation has no biome tint or natural sun-ray layer', () => {
    const chunks = source('game-web', 'src', 'world', 'chunkManager.ts');
    const scene = source('game-web', 'src', 'rendering', 'scene.ts');
    const liveMap = source('game-web', 'src', 'gameplay', 'liveMapOverlay.ts');

    assert(!chunks.includes('applyBiomePaletteToChunk'), 'streamed terrain must keep canonical Rust/WASM colors');
    assert(!chunks.includes('createNaturalSunRay'), 'streamed chunks must not create sky-ray meshes');
    assert(!scene.includes('rayGeo') && !scene.includes('rayMat'), 'scene must not allocate removed sun-ray resources');
    assert(!liveMap.includes('addLandmark('), 'live map must remain free of named landmark markers');

    assert(
      !fs.existsSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'world', 'biomeRegistry.ts')),
      'removed biome presentation registry must not return',
    );
    assert(
      !fs.existsSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'world', 'naturalSunRays.ts')),
      'removed chunk sun-ray generator must not return',
    );
    assert(
      !fs.existsSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'rendering', 'naturalSunRayResources.ts')),
      'removed sun-ray render resources must not return',
    );
  });
}

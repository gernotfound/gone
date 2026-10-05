import fs from 'fs';
import path from 'path';
import {
  MAZE_LANDMARK_CLEARINGS,
  MAZE_PLAYER_RADIUS,
  MAZE_WALLS,
  MAZE_WORLD_COVERAGE_RADIUS,
  MAZE_WORLD_RING_RADII,
  isMazePositionBlocked,
} from '../../game-web/src/world/mazeLayout.ts';
import { SPAWN_POINTS } from '../../game-web/src/gameplay/spawnSelection.ts';
import { assert, assertGreaterThan } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('World maze spans all biome sectors while remaining instanced and bounded', () => {
    assertGreaterThan(MAZE_WALLS.length, 300, 'world maze must extend materially beyond the central prototype');
    assert(MAZE_WALLS.length <= 800, 'world maze wall count must remain bounded for mobile rendering');
    assertEqual(MAZE_WORLD_RING_RADII.length, 5, 'world maze must keep five authored containment rings');
    assertEqual(MAZE_WORLD_COVERAGE_RADIUS, 1980, 'outer control ring must span the playable world');

    for (const spawn of SPAWN_POINTS) {
      assert(
        !isMazePositionBlocked(spawn.x, spawn.z, MAZE_PLAYER_RADIUS),
        `spawn ${spawn.id} must never overlap a maze wall`,
      );
    }

    for (const clearing of MAZE_LANDMARK_CLEARINGS) {
      assert(
        !isMazePositionBlocked(clearing.x, clearing.z, Math.max(1, clearing.radius * 0.5)),
        `landmark clearing ${clearing.id} must not be cut through its center`,
      );
    }
  });

  suite.test('Maze integration covers rendering movement host authority and supplies', () => {
    const visual = source('game-web', 'src', 'world', 'mazePrototype.ts');
    const engine = source('game-web', 'src', 'gameplay', 'engine.ts');
    const host = source('game-web', 'src', 'net', 'p2pHost.ts');
    const supply = source('game-web', 'src', 'gameplay', 'craterSupplyPickups.ts');
    const spiders = source('game-web', 'src', 'gameplay', 'bionicSpiderEnemies.ts');
    const navigation = source('game-web', 'src', 'world', 'mazeNavigation.ts');
    const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');

    assert(visual.includes('THREE.InstancedMesh'), 'maze walls must render in a bounded instanced draw');
    assert(engine.includes('resolveMazeMovement'), 'local prediction must collide with maze walls');
    assert(
      engine.includes('player.velocity.x = (player.position.x - previousX) * invDelta'),
      'local horizontal velocity must derive from the maze-resolved transform',
    );
    assert(engine.includes('getMazeRaycastTargets'), 'local shot presentation must raycast maze walls');
    assert(host.includes("this.rejectClientState('world-collision')"), 'host must reject guest movement through maze walls');
    assert(host.includes('nearestMazeRayHitDistance'), 'host hitscan must be occluded by maze walls');
    assert(supply.includes('isMazePositionBlocked'), 'supply placement must avoid inaccessible wall overlap');
    assert(spiders.includes('resolveMazeMovement'), 'solo spider movement must respect maze walls');
    assert(spiders.includes('findMazePath'), 'solo spiders must route through maze gates instead of grinding into walls');
    assert(spiders.includes('isMazePositionBlocked'), 'solo spider spawning must avoid maze walls');
    assert(navigation.includes('MAX_VISITED_NODES'), 'maze pathfinding must remain bounded');

    const mazeStart = runtime.indexOf("name: 'mazePrototype'");
    const supplyStart = runtime.indexOf("name: 'centralSupplyPickups'");
    assert(mazeStart >= 0 && supplyStart > mazeStart, 'maze runtime must initialize before central supplies');
  });
}

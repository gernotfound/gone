import fs from 'fs';
import path from 'path';
import {
  MAZE_PLAYER_RADIUS,
  MAZE_WALLS,
  isMazePositionBlocked,
} from '../../game-web/src/world/mazeLayout.ts';
import { SPAWN_POINTS } from '../../game-web/src/gameplay/spawnSelection.ts';
import { assert, assertGreaterThan } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('Central maze prototype remains bounded and leaves every spawn clear', () => {
    assertGreaterThan(MAZE_WALLS.length, 63, 'prototype must contain enough segments to form multiple rings');
    assert(MAZE_WALLS.length <= 112, 'prototype wall count must stay bounded for mobile rendering');

    for (const spawn of SPAWN_POINTS) {
      assert(
        !isMazePositionBlocked(spawn.x, spawn.z, MAZE_PLAYER_RADIUS),
        `spawn ${spawn.id} must never overlap a maze wall`,
      );
    }
  });

  suite.test('Maze integration covers rendering movement host authority and supplies', () => {
    const visual = source('game-web', 'src', 'world', 'mazePrototype.ts');
    const engine = source('game-web', 'src', 'gameplay', 'engine.ts');
    const host = source('game-web', 'src', 'net', 'p2pHost.ts');
    const supply = source('game-web', 'src', 'gameplay', 'craterSupplyPickups.ts');
    const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');

    assert(visual.includes('THREE.InstancedMesh'), 'maze walls must render in a bounded instanced draw');
    assert(engine.includes('resolveMazeMovement'), 'local prediction must collide with maze walls');
    assert(engine.includes('getMazeRaycastTargets'), 'local shot presentation must raycast maze walls');
    assert(host.includes("this.rejectClientState('world-collision')"), 'host must reject guest movement through maze walls');
    assert(host.includes('nearestMazeRayHitDistance'), 'host hitscan must be occluded by maze walls');
    assert(supply.includes('isMazePositionBlocked'), 'supply placement must avoid inaccessible wall overlap');

    const mazeStart = runtime.indexOf("name: 'mazePrototype'");
    const supplyStart = runtime.indexOf("name: 'centralSupplyPickups'");
    assert(mazeStart >= 0 && supplyStart > mazeStart, 'maze runtime must initialize before central supplies');
  });
}

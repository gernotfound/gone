import fs from 'fs';
import path from 'path';
import {
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_CLEARING_RADIUS,
  MAZE_CENTRAL_GATE_WIDTH,
  MAZE_CORRIDOR_CELL_SIZE,
  MAZE_DIFFICULTY_RATING,
  MAZE_DOUBLE_WALL_GAP,
  MAZE_GRID_CELLS,
  MAZE_LANDMARK_CLEARINGS,
  MAZE_LOGICAL_WALL_COUNT,
  MAZE_NARROW_CORRIDOR_COUNT,
  MAZE_NARROW_CORRIDOR_WIDTH,
  MAZE_OUTER_EXIT_COUNT,
  MAZE_OUTER_EXIT_SIDE,
  MAZE_PLAYER_RADIUS,
  MAZE_TARGET_MAP_AREA_FRACTION,
  MAZE_TOPOLOGY_STATS,
  MAZE_WALL_BOTTOM_Y,
  MAZE_WALL_THICKNESS,
  MAZE_WALL_TOP_Y,
  MAZE_WALLS,
  MAZE_WORLD_COVERAGE_HALF_EXTENT,
  isMazePositionBlocked,
} from '../../game-web/src/world/mazeLayout.ts';
import { SPAWN_POINTS } from '../../game-web/src/gameplay/spawnSelection.ts';
import { assert, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('World maze occupies about half the map and is a real branching maze', () => {
    assertEqual(MAZE_GRID_CELLS, 18, 'maze must use the authored 18x18 coarse corridor grid');
    assertEqual(MAZE_CORRIDOR_CELL_SIZE, 184, 'maze corridors must remain very wide');
    assertEqual(MAZE_CENTRAL_BOUNDARY_HALF_EXTENT, 552, 'first maze wall must remain well away from spawn');
    assertGreaterThan(MAZE_LOGICAL_WALL_COUNT, 180, 'maze must contain many logical walls, not only perimeter rings');
    assertEqual(
      MAZE_WALLS.length,
      MAZE_LOGICAL_WALL_COUNT * 2,
      'every logical wall must render as exactly two physical slabs',
    );
    assert(MAZE_WALLS.length <= 900, 'instanced physical wall count must stay bounded for mobile rendering');
    assertEqual(MAZE_TOPOLOGY_STATS.cellCount, 288, 'central clearing must be removed from the 18x18 maze graph');
    assertEqual(MAZE_DIFFICULTY_RATING, 9, 'maze topology must target difficulty 9/10');
    assertGreaterThan(MAZE_TOPOLOGY_STATS.deadEnds, 25, 'difficulty-nine maze must contain many convincing dead ends');
    assertGreaterThan(MAZE_TOPOLOGY_STATS.junctions, 40, 'maze must preserve many branches/junctions');
    assertGreaterThan(MAZE_TOPOLOGY_STATS.loopPassages, 5, 'maze must retain some alternate-route loops');
    assert(
      MAZE_TOPOLOGY_STATS.loopPassages <= 15,
      `difficulty-nine maze must not be over-connected; loops=${MAZE_TOPOLOGY_STATS.loopPassages}`,
    );
    assertEqual(MAZE_OUTER_EXIT_COUNT, 1, 'maze must have exactly one authored exit to the outer world');
    assertEqual(MAZE_OUTER_EXIT_SIDE, 'east', 'single exit must lead toward the eastern Signal Crater sector');
    assertGreaterThan(MAZE_NARROW_CORRIDOR_COUNT, 15, 'maze must include several deterministic choke corridors');
    assert(MAZE_NARROW_CORRIDOR_COUNT <= 40, 'narrow corridors must remain selective rather than replacing broad routes');
    assertEqual(MAZE_NARROW_CORRIDOR_WIDTH, 96, 'selected choke corridors must narrow to the authored 96m width');
    assert(
      MAZE_WORLD_COVERAGE_HALF_EXTENT >= 1650 && MAZE_WORLD_COVERAGE_HALF_EXTENT <= 1670,
      'outer maze footprint must remain near +/-1660m',
    );
    assert(
      MAZE_TARGET_MAP_AREA_FRACTION >= 0.48 && MAZE_TARGET_MAP_AREA_FRACTION <= 0.52,
      `maze footprint must stay near 50% of map area; got ${MAZE_TARGET_MAP_AREA_FRACTION}`,
    );
    assert(MAZE_CENTRAL_CLEARING_RADIUS >= 420, 'spawn clearing must remain very large');
    assert(MAZE_CENTRAL_GATE_WIDTH >= 160, 'four central entrances must be wide');
    assert(MAZE_WALL_THICKNESS >= 14, 'maze walls must be visually and physically massive');
    assert(MAZE_DOUBLE_WALL_GAP >= 2, 'double walls must remain visibly split into paired slabs');
    assert(MAZE_WALL_BOTTOM_Y <= -600, 'walls must start safely below all terrain');
    assert(MAZE_WALL_TOP_Y >= 1200, 'walls must extend above all normal traversal');

    for (const spawn of SPAWN_POINTS) {
      assert(
        !isMazePositionBlocked(spawn.x, spawn.z, MAZE_PLAYER_RADIUS),
        `spawn ${spawn.id} must never overlap a maze wall`,
      );
    }

    for (let angle = 0; angle < Math.PI * 2; angle += Math.PI / 8) {
      const x = Math.cos(angle) * MAZE_CENTRAL_CLEARING_RADIUS;
      const z = Math.sin(angle) * MAZE_CENTRAL_CLEARING_RADIUS;
      assert(!isMazePositionBlocked(x, z, MAZE_PLAYER_RADIUS), 'central clearing boundary must remain wall-free');
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

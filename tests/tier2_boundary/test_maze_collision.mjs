import {
  MAZE_CENTRAL_GATE_HALF_WIDTH,
  MAZE_DOUBLE_WALL_CENTER_OFFSET,
  MAZE_PLAYER_RADIUS,
  MAZE_WALL_THICKNESS,
  MAZE_WORLD_RING_RADII,
  isMazePositionBlocked,
  mazeSegmentCrossesWall,
  nearestMazeRayHitDistance,
  resolveMazeMovement,
} from '../../game-web/src/world/mazeLayout.ts';
import { findMazePath } from '../../game-web/src/world/mazeNavigation.ts';
import { assert, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';

export async function run(suite) {
  suite.test('Central clearing has exactly four broad cardinal passages through the first double wall', () => {
    const innerNorthZ = -(MAZE_WORLD_RING_RADII[0] - MAZE_DOUBLE_WALL_CENTER_OFFSET);
    const outerNorthZ = -(MAZE_WORLD_RING_RADII[0] + MAZE_DOUBLE_WALL_CENTER_OFFSET);

    assertEqual(
      mazeSegmentCrossesWall(
        { x: 0, z: innerNorthZ + 60 },
        { x: 0, z: outerNorthZ - 60 },
        MAZE_PLAYER_RADIUS,
      ),
      false,
      'north central entrance must pass through both wall layers',
    );
    assert(
      mazeSegmentCrossesWall(
        { x: MAZE_CENTRAL_GATE_HALF_WIDTH + MAZE_WALL_THICKNESS * 2, z: innerNorthZ + 60 },
        { x: MAZE_CENTRAL_GATE_HALF_WIDTH + MAZE_WALL_THICKNESS * 2, z: outerNorthZ - 60 },
        MAZE_PLAYER_RADIUS,
      ),
      'outside the north entrance the same crossing must hit the double wall',
    );

    assertEqual(
      mazeSegmentCrossesWall(
        { x: -innerNorthZ - 60, z: 0 },
        { x: -outerNorthZ + 60, z: 0 },
        MAZE_PLAYER_RADIUS,
      ),
      false,
      'east central entrance must remain open through both layers',
    );
  });

  suite.test('Maze movement resolver slides along a massive wall instead of cancelling the whole step', () => {
    const wallZ = -(MAZE_WORLD_RING_RADII[0] - MAZE_DOUBLE_WALL_CENTER_OFFSET);
    const start = { x: 220, z: wallZ + 20 };
    const end = { x: 250, z: wallZ - 20 };
    const resolved = resolveMazeMovement(start, end, MAZE_PLAYER_RADIUS);

    assert(resolved.blocked, 'diagonal wall impact must report a collision');
    assert(!isMazePositionBlocked(resolved.x, resolved.z, MAZE_PLAYER_RADIUS), 'resolved position must stay outside walls');
  });

  suite.test('Authoritative ray query hits solid central wall and misses the cardinal gate', () => {
    const wallZ = -(MAZE_WORLD_RING_RADII[0] - MAZE_DOUBLE_WALL_CENTER_OFFSET);
    const distance = nearestMazeRayHitDistance(
      { x: 220, y: 20, z: wallZ + 40 },
      { x: 0, y: 0, z: -1 },
      100,
    );
    assert(distance !== null && distance > 0 && distance < 100, 'ray must hit the selected central wall');

    const gateDistance = nearestMazeRayHitDistance(
      { x: 0, y: 20, z: wallZ + 40 },
      { x: 0, y: 0, z: -1 },
      140,
    );
    assertEqual(gateDistance, null, 'ray through the north entrance must remain unobstructed');
  });

  suite.test('Maze A-star routes through a central cardinal entrance', () => {
    const clearance = 8;
    const start = { x: -216, z: -450 };
    const goal = { x: -216, z: -650 };
    assert(mazeSegmentCrossesWall(start, goal, clearance), 'direct route must cross the first double wall');

    const path = findMazePath(start, goal, clearance);
    assertGreaterThan(path.length, 1, 'blocked chase must produce a detour waypoint');
    assert(
      path.some((point) => Math.abs(point.x) <= 72),
      'detour must route toward the centered north entrance',
    );

    let previous = start;
    for (const waypoint of path) {
      assert(
        !mazeSegmentCrossesWall(previous, waypoint, clearance),
        'every simplified A-star segment must stay outside canonical walls',
      );
      previous = waypoint;
    }
  });

  suite.test('Deeper double-ring navigation uses staggered broad gates', () => {
    const clearance = 8;
    const secondInnerNorthZ = -(MAZE_WORLD_RING_RADII[1] - MAZE_DOUBLE_WALL_CENTER_OFFSET);
    const secondOuterNorthZ = -(MAZE_WORLD_RING_RADII[1] + MAZE_DOUBLE_WALL_CENTER_OFFSET);
    const start = { x: 0, z: secondInnerNorthZ + 70 };
    const goal = { x: 0, z: secondOuterNorthZ - 70 };
    assert(mazeSegmentCrossesWall(start, goal, clearance), 'straight radial route must be blocked on deeper ring');

    const path = findMazePath(start, goal, clearance);
    assertGreaterThan(path.length, 1, 'deeper ring must be navigable through a staggered gate');
    assert(
      path.some((point) => Math.abs(point.x) >= 72),
      'detour must leave the radial centerline to find the staggered gate',
    );
  });
}

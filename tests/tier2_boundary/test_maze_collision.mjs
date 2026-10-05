import {
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_GATE_HALF_WIDTH,
  MAZE_CORRIDOR_CELL_SIZE,
  MAZE_PLAYER_RADIUS,
  MAZE_WALL_THICKNESS,
  MAZE_WALLS,
  isMazePositionBlocked,
  mazeSegmentCrossesWall,
  nearestMazeRayHitDistance,
  resolveMazeMovement,
} from '../../game-web/src/world/mazeLayout.ts';
import { findMazePath } from '../../game-web/src/world/mazeNavigation.ts';
import { assert, assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';

function crossingForWall(wall, distance = 70) {
  const horizontal = wall.width >= wall.depth;
  if (horizontal) {
    return {
      start: { x: wall.x, z: wall.z - distance },
      end: { x: wall.x, z: wall.z + distance },
      parallelAxis: 'x',
    };
  }
  return {
    start: { x: wall.x - distance, z: wall.z },
    end: { x: wall.x + distance, z: wall.z },
    parallelAxis: 'z',
  };
}

export async function run(suite) {
  suite.test('Central clearing exposes exactly the four broad cardinal entrances', () => {
    const boundary = MAZE_CENTRAL_BOUNDARY_HALF_EXTENT;
    const outsideGate = MAZE_CENTRAL_GATE_HALF_WIDTH + MAZE_WALL_THICKNESS * 2;

    const passages = [
      [{ x: 0, z: -boundary + 40 }, { x: 0, z: -boundary - 40 }],
      [{ x: 0, z: boundary - 40 }, { x: 0, z: boundary + 40 }],
      [{ x: -boundary + 40, z: 0 }, { x: -boundary - 40, z: 0 }],
      [{ x: boundary - 40, z: 0 }, { x: boundary + 40, z: 0 }],
    ];
    for (const [start, end] of passages) {
      assertEqual(
        mazeSegmentCrossesWall(start, end, MAZE_PLAYER_RADIUS),
        false,
        'each cardinal entrance must pass cleanly through the doubled boundary',
      );
    }

    const blockedCrossings = [
      [{ x: outsideGate, z: -boundary + 40 }, { x: outsideGate, z: -boundary - 40 }],
      [{ x: outsideGate, z: boundary - 40 }, { x: outsideGate, z: boundary + 40 }],
      [{ x: -boundary + 40, z: outsideGate }, { x: -boundary - 40, z: outsideGate }],
      [{ x: boundary - 40, z: outsideGate }, { x: boundary + 40, z: outsideGate }],
    ];
    for (const [start, end] of blockedCrossings) {
      assert(
        mazeSegmentCrossesWall(start, end, MAZE_PLAYER_RADIUS),
        'central boundary must be solid immediately outside each authored gate',
      );
    }
  });

  suite.test('Generated maze wall forces a genuine detour through adjacent corridors', () => {
    const wall = MAZE_WALLS.find((candidate) => candidate.id.startsWith('grid-'));
    assert(wall, 'test requires at least one generated internal grid wall');

    const { start, end, parallelAxis } = crossingForWall(wall, MAZE_CORRIDOR_CELL_SIZE * 0.38);
    assert(mazeSegmentCrossesWall(start, end, 8), 'direct route must cross the generated wall');

    const path = findMazePath(start, end, 8);
    assertGreaterThan(path.length, 1, 'A* must produce a multi-waypoint detour around a generated wall');

    const parallelOrigin = parallelAxis === 'x' ? start.x : start.z;
    assert(
      path.some((point) => Math.abs((parallelAxis === 'x' ? point.x : point.z) - parallelOrigin) >= MAZE_CELL_SIZE),
      'detour must make a substantial lateral turn instead of behaving like a ring opening',
    );

    let previous = start;
    for (const waypoint of path) {
      assert(
        !mazeSegmentCrossesWall(previous, waypoint, 8),
        'every simplified detour segment must stay outside canonical walls',
      );
      previous = waypoint;
    }
  });

  suite.test('Maze movement resolver slides along generated walls instead of tunnelling through them', () => {
    const wall = MAZE_WALLS.find((candidate) => candidate.id.startsWith('grid-'));
    assert(wall, 'movement test requires an internal maze wall');
    const horizontal = wall.width >= wall.depth;
    const start = horizontal
      ? { x: wall.x - 30, z: wall.z - 35 }
      : { x: wall.x - 35, z: wall.z - 30 };
    const end = horizontal
      ? { x: wall.x + 30, z: wall.z + 35 }
      : { x: wall.x + 35, z: wall.z + 30 };

    const resolved = resolveMazeMovement(start, end, MAZE_PLAYER_RADIUS);
    assert(resolved.blocked, 'diagonal impact against generated wall must collide');
    assert(!isMazePositionBlocked(resolved.x, resolved.z, MAZE_PLAYER_RADIUS), 'resolved position must remain outside walls');
  });

  suite.test('Authoritative ray query hits generated walls and misses the north entrance', () => {
    const wall = MAZE_WALLS.find((candidate) => candidate.id.startsWith('grid-'));
    assert(wall, 'ray test requires an internal maze wall');
    const horizontal = wall.width >= wall.depth;
    const origin = horizontal
      ? { x: wall.x, y: 20, z: wall.z - 70 }
      : { x: wall.x - 70, y: 20, z: wall.z };
    const direction = horizontal
      ? { x: 0, y: 0, z: 1 }
      : { x: 1, y: 0, z: 0 };

    const distance = nearestMazeRayHitDistance(origin, direction, 140);
    assert(distance !== null && distance > 0 && distance < 140, 'ray must hit a generated internal wall');

    const boundary = MAZE_CENTRAL_BOUNDARY_HALF_EXTENT;
    const gateDistance = nearestMazeRayHitDistance(
      { x: 0, y: 20, z: -boundary + 50 },
      { x: 0, y: 0, z: -1 },
      120,
    );
    assertEqual(gateDistance, null, 'ray through the authored north entrance must remain unobstructed');
  });
}

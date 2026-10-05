import {
  MAZE_PLAYER_RADIUS,
  MAZE_WALLS,
  isMazePositionBlocked,
  mazeSegmentCrossesWall,
  nearestMazeRayHitDistance,
  resolveMazeMovement,
} from '../../game-web/src/world/mazeLayout.ts';
import { assert, assertEqual } from '../helpers/assertions.mjs';

export async function run(suite) {
  suite.test('Maze collision blocks wall crossings but preserves an authored inner gate', () => {
    const wall = MAZE_WALLS[0];
    assert(
      mazeSegmentCrossesWall(
        { x: wall.x, z: wall.z - 10 },
        { x: wall.x, z: wall.z + 10 },
        MAZE_PLAYER_RADIUS,
      ),
      'movement perpendicular to a wall must collide',
    );

    assertEqual(
      mazeSegmentCrossesWall(
        { x: 0, z: -110 },
        { x: 0, z: -70 },
        MAZE_PLAYER_RADIUS,
      ),
      false,
      'north inner-ring gate at x=0 must remain traversable',
    );
  });

  suite.test('Maze movement resolver slides along a wall instead of cancelling the whole step', () => {
    const wall = MAZE_WALLS[0];
    const start = { x: wall.x - 10, z: wall.z - 10 };
    const end = { x: wall.x + 10, z: wall.z + 10 };
    const resolved = resolveMazeMovement(start, end, MAZE_PLAYER_RADIUS);

    assert(resolved.blocked, 'diagonal wall impact must report a collision');
    assertEqual(resolved.x, end.x, 'parallel axis should continue for wall sliding');
    assertEqual(resolved.z, start.z, 'perpendicular axis should stop at the wall');
    assert(!isMazePositionBlocked(resolved.x, resolved.z, MAZE_PLAYER_RADIUS), 'resolved position must stay outside walls');
  });

  suite.test('Authoritative ray query hits solid wall segments and misses gates', () => {
    const wall = MAZE_WALLS[0];
    const distance = nearestMazeRayHitDistance(
      { x: wall.x, y: 20, z: wall.z - 20 },
      { x: 0, y: 0, z: 1 },
      30,
    );
    assert(distance !== null && distance > 0 && distance < 30, 'ray must hit the selected wall');

    const gateDistance = nearestMazeRayHitDistance(
      { x: 0, y: 20, z: -110 },
      { x: 0, y: 0, z: 1 },
      40,
    );
    assertEqual(gateDistance, null, 'ray through authored inner gate must remain unobstructed');
  });
}

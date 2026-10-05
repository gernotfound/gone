export type MazePoint2 = { x: number; z: number };
export type MazeRayPoint = { x: number; y?: number; z: number };

export type MazeWall = {
  id: string;
  x: number;
  z: number;
  width: number;
  depth: number;
  height: number;
};

export const MAZE_CELL_SIZE = 36;
export const MAZE_WALL_THICKNESS = 4;
export const MAZE_WALL_HEIGHT = 24;
export const MAZE_WALL_EMBED_DEPTH = 4;
export const MAZE_PLAYER_RADIUS = 1.15;
export const MAZE_SUPPLY_CLEARANCE = 1.25;

const walls: MazeWall[] = [];

function addHorizontal(idPrefix: string, z: number, centers: readonly number[], skipped: ReadonlySet<number>): void {
  for (const x of centers) {
    if (skipped.has(x)) continue;
    walls.push({
      id: `${idPrefix}-x${x}`,
      x,
      z,
      width: MAZE_CELL_SIZE,
      depth: MAZE_WALL_THICKNESS,
      height: MAZE_WALL_HEIGHT,
    });
  }
}

function addVertical(idPrefix: string, x: number, centers: readonly number[], skipped: ReadonlySet<number>): void {
  for (const z of centers) {
    if (skipped.has(z)) continue;
    walls.push({
      id: `${idPrefix}-z${z}`,
      x,
      z,
      width: MAZE_WALL_THICKNESS,
      depth: MAZE_CELL_SIZE,
      height: MAZE_WALL_HEIGHT,
    });
  }
}

const INNER_CENTERS = [-108, -72, -36, 0, 36, 72, 108] as const;
const MID_CENTERS = [-144, -108, -72, -36, 0, 36, 72, 108, 144] as const;
const OUTER_CENTERS = [-198, -162, -126, -90, -54, -18, 18, 54, 90, 126, 162, 198] as const;

// Inner ring: gates are deliberately offset on each side. Leaving Nucleo Zero
// is easy to understand, but a straight line never solves the whole maze.
addHorizontal('inner-n', -90, INNER_CENTERS, new Set([0]));
addHorizontal('inner-s', 90, INNER_CENTERS, new Set([36]));
addVertical('inner-w', -90, INNER_CENTERS, new Set([-36]));
addVertical('inner-e', 90, INNER_CENTERS, new Set([36]));

// Middle ring: the next gates move again, creating the first S-turns and loops.
addHorizontal('mid-n', -162, MID_CENTERS, new Set([72]));
addHorizontal('mid-s', 162, MID_CENTERS, new Set([-72]));
addVertical('mid-w', -162, MID_CENTERS, new Set([72]));
addVertical('mid-e', 162, MID_CENTERS, new Set([-72]));

// Outer ring: four broad cardinal gates establish the future biome arteries.
const outerGate = new Set([-18, 18]);
addHorizontal('outer-n', -216, OUTER_CENTERS, outerGate);
addHorizontal('outer-s', 216, OUTER_CENTERS, outerGate);
addVertical('outer-w', -216, OUTER_CENTERS, outerGate);
addVertical('outer-e', 216, OUTER_CENTERS, outerGate);

export const MAZE_WALLS: readonly MazeWall[] = Object.freeze(walls);

type Bounds2 = { minX: number; maxX: number; minZ: number; maxZ: number };

function wallBounds(wall: MazeWall, padding = 0): Bounds2 {
  return {
    minX: wall.x - wall.width * 0.5 - padding,
    maxX: wall.x + wall.width * 0.5 + padding,
    minZ: wall.z - wall.depth * 0.5 - padding,
    maxZ: wall.z + wall.depth * 0.5 + padding,
  };
}

function pointInBounds(point: MazePoint2, bounds: Bounds2): boolean {
  return (
    point.x >= bounds.minX
    && point.x <= bounds.maxX
    && point.z >= bounds.minZ
    && point.z <= bounds.maxZ
  );
}

function segmentIntersectsBounds(start: MazePoint2, end: MazePoint2, bounds: Bounds2): boolean {
  let tMin = 0;
  let tMax = 1;
  const dx = end.x - start.x;
  const dz = end.z - start.z;

  const clipAxis = (origin: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) < 1e-9) return origin >= min && origin <= max;
    let a = (min - origin) / delta;
    let b = (max - origin) / delta;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    return tMin <= tMax;
  };

  return (
    clipAxis(start.x, dx, bounds.minX, bounds.maxX)
    && clipAxis(start.z, dz, bounds.minZ, bounds.maxZ)
    && tMax >= 0
    && tMin <= 1
  );
}

export function isMazePositionBlocked(x: number, z: number, padding = MAZE_PLAYER_RADIUS): boolean {
  const point = { x, z };
  return MAZE_WALLS.some((wall) => pointInBounds(point, wallBounds(wall, padding)));
}

export function mazeSegmentCrossesWall(
  start: MazePoint2,
  end: MazePoint2,
  padding = MAZE_PLAYER_RADIUS,
): boolean {
  for (const wall of MAZE_WALLS) {
    const bounds = wallBounds(wall, padding);
    const startedInside = pointInBounds(start, bounds);
    const endedInside = pointInBounds(end, bounds);

    // Never trap an already-overlapping player. This lets an authority
    // correction or future layout migration move outward from a wall.
    if (startedInside && !endedInside) continue;
    if (startedInside && endedInside) return true;
    if (!startedInside && segmentIntersectsBounds(start, end, bounds)) return true;
  }
  return false;
}

export type MazeMovementResolution = MazePoint2 & { blocked: boolean };

/**
 * Axis-separated collision keeps movement responsive along a wall instead of
 * snapping the whole attempted step back to its origin.
 */
export function resolveMazeMovement(
  start: MazePoint2,
  end: MazePoint2,
  padding = MAZE_PLAYER_RADIUS,
): MazeMovementResolution {
  if (!mazeSegmentCrossesWall(start, end, padding)) {
    return { x: end.x, z: end.z, blocked: false };
  }

  let current = { x: start.x, z: start.z };
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const axes: readonly ('x' | 'z')[] =
    Math.abs(dx) >= Math.abs(dz) ? ['x', 'z'] : ['z', 'x'];

  for (const axis of axes) {
    const candidate = axis === 'x'
      ? { x: end.x, z: current.z }
      : { x: current.x, z: end.z };
    if (!mazeSegmentCrossesWall(current, candidate, padding)) current = candidate;
  }

  return { ...current, blocked: true };
}

function rayBoundsDistance(
  origin: MazeRayPoint,
  direction: MazeRayPoint,
  bounds: Bounds2,
  maxDistance: number,
): number | null {
  const length = Math.hypot(direction.x, direction.y ?? 0, direction.z);
  if (!Number.isFinite(length) || length < 1e-9) return null;

  const dx = direction.x / length;
  const dz = direction.z / length;
  let tMin = 0;
  let tMax = maxDistance;

  const clipAxis = (start: number, delta: number, min: number, max: number): boolean => {
    if (Math.abs(delta) < 1e-9) return start >= min && start <= max;
    let a = (min - start) / delta;
    let b = (max - start) / delta;
    if (a > b) [a, b] = [b, a];
    tMin = Math.max(tMin, a);
    tMax = Math.min(tMax, b);
    return tMin <= tMax;
  };

  if (!clipAxis(origin.x, dx, bounds.minX, bounds.maxX)) return null;
  if (!clipAxis(origin.z, dz, bounds.minZ, bounds.maxZ)) return null;
  if (tMax < 0 || tMin > maxDistance) return null;
  return Math.max(0, tMin);
}

/**
 * Authoritative combat treats prototype walls as full-height occluders. The
 * visual walls are intentionally far taller than the player's jump envelope,
 * so this prevents client-side "shoot through/over the maze" discrepancies.
 */
export function nearestMazeRayHitDistance(
  origin: MazeRayPoint,
  direction: MazeRayPoint,
  maxDistance: number,
): number | null {
  let nearest = Number.POSITIVE_INFINITY;
  for (const wall of MAZE_WALLS) {
    const distance = rayBoundsDistance(origin, direction, wallBounds(wall), maxDistance);
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return Number.isFinite(nearest) ? nearest : null;
}

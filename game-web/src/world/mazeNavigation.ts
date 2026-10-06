import {
  MAZE_CELL_SIZE,
  MAZE_WORLD_COVERAGE_RADIUS,
  isMazePositionBlocked,
  mazeSegmentCrossesWall,
  type MazePoint2,
} from './mazeLayout.ts';

export const MAZE_NAV_GRID_SIZE = MAZE_CELL_SIZE;
export const MAZE_NAV_REPATH_DISTANCE = MAZE_CELL_SIZE * 1.5;
export const MAZE_NAV_WORLD_LIMIT = MAZE_WORLD_COVERAGE_RADIUS + 360;
const MAX_VISITED_NODES = 6000;

type GridPoint = { ix: number; iz: number };
type OpenNode = GridPoint & { key: string; f: number };

class MinHeap {
  private readonly items: OpenNode[] = [];

  public get size(): number {
    return this.items.length;
  }

  public push(node: OpenNode): void {
    this.items.push(node);
    let index = this.items.length - 1;
    while (index > 0) {
      const parent = Math.floor((index - 1) * 0.5);
      if (this.items[parent].f <= node.f) break;
      this.items[index] = this.items[parent];
      index = parent;
    }
    this.items[index] = node;
  }

  public pop(): OpenNode | undefined {
    if (this.items.length === 0) return undefined;
    const root = this.items[0];
    const last = this.items.pop()!;
    if (this.items.length === 0) return root;

    let index = 0;
    while (true) {
      const left = index * 2 + 1;
      const right = left + 1;
      if (left >= this.items.length) break;
      let child = left;
      if (right < this.items.length && this.items[right].f < this.items[left].f) child = right;
      if (this.items[child].f >= last.f) break;
      this.items[index] = this.items[child];
      index = child;
    }
    this.items[index] = last;
    return root;
  }
}

function keyOf(point: GridPoint): string {
  return `${point.ix}:${point.iz}`;
}

function parseKey(key: string): GridPoint {
  const [ix, iz] = key.split(':').map(Number);
  return { ix, iz };
}

function toWorld(point: GridPoint): MazePoint2 {
  return {
    x: point.ix * MAZE_NAV_GRID_SIZE,
    z: point.iz * MAZE_NAV_GRID_SIZE,
  };
}

function nearestWalkableGrid(point: MazePoint2, clearance: number): GridPoint | null {
  const center = {
    ix: Math.round(point.x / MAZE_NAV_GRID_SIZE),
    iz: Math.round(point.z / MAZE_NAV_GRID_SIZE),
  };

  let best: GridPoint | null = null;
  let bestDistanceSq = Number.POSITIVE_INFINITY;
  for (let radius = 0; radius <= 5; radius += 1) {
    for (let dx = -radius; dx <= radius; dx += 1) {
      for (let dz = -radius; dz <= radius; dz += 1) {
        if (radius > 0 && Math.abs(dx) !== radius && Math.abs(dz) !== radius) continue;
        const candidate = { ix: center.ix + dx, iz: center.iz + dz };
        const world = toWorld(candidate);
        if (
          Math.abs(world.x) > MAZE_NAV_WORLD_LIMIT
          || Math.abs(world.z) > MAZE_NAV_WORLD_LIMIT
          || isMazePositionBlocked(world.x, world.z, clearance)
        ) {
          continue;
        }
        const distanceSq = (world.x - point.x) ** 2 + (world.z - point.z) ** 2;
        if (distanceSq < bestDistanceSq) {
          best = candidate;
          bestDistanceSq = distanceSq;
        }
      }
    }
    if (best) return best;
  }
  return null;
}

function heuristic(a: GridPoint, b: GridPoint): number {
  return Math.hypot(a.ix - b.ix, a.iz - b.iz) * MAZE_NAV_GRID_SIZE;
}

function reconstructPath(cameFrom: Map<string, string>, currentKey: string): GridPoint[] {
  const reversed = [parseKey(currentKey)];
  while (cameFrom.has(currentKey)) {
    currentKey = cameFrom.get(currentKey)!;
    reversed.push(parseKey(currentKey));
  }
  reversed.reverse();
  return reversed;
}

function simplifyPath(
  start: MazePoint2,
  gridPath: readonly GridPoint[],
  goal: MazePoint2,
  clearance: number,
): MazePoint2[] {
  const points = gridPath.map(toWorld);
  const result: MazePoint2[] = [];
  let anchor = start;
  let cursor = 1;

  while (cursor < points.length) {
    let farthest = cursor;
    for (let index = points.length - 1; index >= cursor; index -= 1) {
      if (!mazeSegmentCrossesWall(anchor, points[index], clearance)) {
        farthest = index;
        break;
      }
    }
    const waypoint = points[farthest];
    result.push(waypoint);
    anchor = waypoint;
    cursor = farthest + 1;
  }

  if (
    !isMazePositionBlocked(goal.x, goal.z, clearance)
    && !mazeSegmentCrossesWall(anchor, goal, clearance)
  ) {
    const last = result[result.length - 1];
    if (!last || Math.hypot(last.x - goal.x, last.z - goal.z) > 0.01) result.push({ ...goal });
  }

  return result;
}

/**
 * Bounded A* over the canonical maze collision field. This is intentionally a
 * consumer of mazeLayout rather than a second navmesh authority.
 */
export function findMazePath(
  start: MazePoint2,
  goal: MazePoint2,
  clearance: number,
): MazePoint2[] {
  if (!mazeSegmentCrossesWall(start, goal, clearance)) return [{ ...goal }];

  const startGrid = nearestWalkableGrid(start, clearance);
  const goalGrid = nearestWalkableGrid(goal, clearance);
  if (!startGrid || !goalGrid) return [];

  // Difficulty-nine topology can require a long detour even when start and
  // goal are physically close. Search the entire bounded maze/navigation
  // envelope instead of clipping A* to a local rectangle around the pair.
  // At the 72 m grid this remains below MAX_VISITED_NODES for the full world.
  const minIx = Math.floor(-MAZE_NAV_WORLD_LIMIT / MAZE_NAV_GRID_SIZE);
  const maxIx = Math.ceil(MAZE_NAV_WORLD_LIMIT / MAZE_NAV_GRID_SIZE);
  const minIz = Math.floor(-MAZE_NAV_WORLD_LIMIT / MAZE_NAV_GRID_SIZE);
  const maxIz = Math.ceil(MAZE_NAV_WORLD_LIMIT / MAZE_NAV_GRID_SIZE);

  const startKey = keyOf(startGrid);
  const goalKey = keyOf(goalGrid);
  const open = new MinHeap();
  const cameFrom = new Map<string, string>();
  const gScore = new Map<string, number>([[startKey, 0]]);
  const closed = new Set<string>();
  open.push({ ...startGrid, key: startKey, f: heuristic(startGrid, goalGrid) });

  const neighbors = [
    { dx: -1, dz: 0, cost: 1 },
    { dx: 1, dz: 0, cost: 1 },
    { dx: 0, dz: -1, cost: 1 },
    { dx: 0, dz: 1, cost: 1 },
    { dx: -1, dz: -1, cost: Math.SQRT2 },
    { dx: 1, dz: -1, cost: Math.SQRT2 },
    { dx: -1, dz: 1, cost: Math.SQRT2 },
    { dx: 1, dz: 1, cost: Math.SQRT2 },
  ] as const;

  let visited = 0;
  while (open.size > 0 && visited < MAX_VISITED_NODES) {
    const current = open.pop()!;
    if (closed.has(current.key)) continue;
    closed.add(current.key);
    visited += 1;

    if (current.key === goalKey) {
      return simplifyPath(start, reconstructPath(cameFrom, goalKey), goal, clearance);
    }

    const currentWorld = toWorld(current);
    const currentG = gScore.get(current.key) ?? Number.POSITIVE_INFINITY;

    for (const neighbor of neighbors) {
      const next: GridPoint = {
        ix: current.ix + neighbor.dx,
        iz: current.iz + neighbor.dz,
      };
      if (next.ix < minIx || next.ix > maxIx || next.iz < minIz || next.iz > maxIz) continue;
      const nextKey = keyOf(next);
      if (closed.has(nextKey)) continue;

      const nextWorld = toWorld(next);
      if (
        isMazePositionBlocked(nextWorld.x, nextWorld.z, clearance)
        || mazeSegmentCrossesWall(currentWorld, nextWorld, clearance)
      ) {
        continue;
      }

      const tentative = currentG + neighbor.cost * MAZE_NAV_GRID_SIZE;
      if (tentative >= (gScore.get(nextKey) ?? Number.POSITIVE_INFINITY)) continue;
      cameFrom.set(nextKey, current.key);
      gScore.set(nextKey, tentative);
      open.push({
        ...next,
        key: nextKey,
        f: tentative + heuristic(next, goalGrid),
      });
    }
  }

  return [];
}

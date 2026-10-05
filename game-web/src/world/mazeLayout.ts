import { BIOMES } from './biomeRegistry.ts';
import {
  GIANT_CRATER_CENTER_X,
  GIANT_CRATER_CENTER_Z,
  GIANT_CRATER_RADIUS,
  PLAYABLE_WORLD_HALF_EXTENT,
} from './worldTopology.ts';

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

type Bounds2 = { minX: number; maxX: number; minZ: number; maxZ: number };
type GateRange = { center: number; halfWidth: number };
type MazeClearing = { id: string; x: number; z: number; radius: number };
type MazeCell = { ix: number; iz: number };

export const MAZE_CELL_SIZE = 72;
export const MAZE_CORRIDOR_CELL_SIZE = 184;
export const MAZE_GRID_CELLS = 18;
export const MAZE_GRID_HALF_EXTENT = (MAZE_GRID_CELLS * MAZE_CORRIDOR_CELL_SIZE) * 0.5;

export const MAZE_WALL_THICKNESS = 14;
export const MAZE_DOUBLE_WALL_GAP = 2;
export const MAZE_DOUBLE_WALL_CENTER_OFFSET =
  (MAZE_WALL_THICKNESS + MAZE_DOUBLE_WALL_GAP) * 0.5;
export const MAZE_WALL_BOTTOM_Y = -600;
export const MAZE_WALL_TOP_Y = 1200;
export const MAZE_WALL_HEIGHT = MAZE_WALL_TOP_Y - MAZE_WALL_BOTTOM_Y;
export const MAZE_PLAYER_RADIUS = 1.15;
export const MAZE_SUPPLY_CLEARANCE = 1.25;

export const MAZE_CENTRAL_CLEARING_RADIUS = 420;
export const MAZE_CENTRAL_BOUNDARY_HALF_EXTENT = MAZE_CORRIDOR_CELL_SIZE * 3;
export const MAZE_CENTRAL_GATE_HALF_WIDTH = MAZE_CORRIDOR_CELL_SIZE * 0.5;
export const MAZE_CENTRAL_GATE_WIDTH = MAZE_CENTRAL_GATE_HALF_WIDTH * 2;

export const MAZE_WORLD_COVERAGE_HALF_EXTENT =
  MAZE_GRID_HALF_EXTENT + MAZE_DOUBLE_WALL_CENTER_OFFSET;
export const MAZE_WORLD_COVERAGE_RADIUS = MAZE_WORLD_COVERAGE_HALF_EXTENT;
export const MAZE_TARGET_MAP_AREA_FRACTION =
  ((MAZE_WORLD_COVERAGE_HALF_EXTENT * 2) ** 2)
  / ((PLAYABLE_WORLD_HALF_EXTENT * 2) ** 2);

export const MAZE_LOOP_PROBABILITY = 0.15;
export const MAZE_MAX_WALL_SEGMENT_LENGTH = MAZE_CORRIDOR_CELL_SIZE * 2;

export const MAZE_LANDMARK_CLEARINGS: readonly MazeClearing[] = Object.freeze([
  {
    id: 'signal-crater',
    x: GIANT_CRATER_CENTER_X,
    z: GIANT_CRATER_CENTER_Z,
    radius: GIANT_CRATER_RADIUS + 90,
  },
  {
    id: 'fractured-observatory',
    x: BIOMES.alpine_fissures.anchor.x,
    z: BIOMES.alpine_fissures.anchor.z,
    radius: 220,
  },
  {
    id: 'pumping-station-04',
    x: BIOMES.flooded_lowlands.anchor.x,
    z: BIOMES.flooded_lowlands.anchor.z,
    radius: 220,
  },
  {
    id: 'sunken-greenhouses',
    x: BIOMES.overgrown_ruins.anchor.x,
    z: BIOMES.overgrown_ruins.anchor.z,
    radius: 220,
  },
]);

const walls: MazeWall[] = [];
const logicalWallIds = new Set<string>();

function mergedGateIntervals(
  min: number,
  max: number,
  gates: readonly GateRange[],
): Array<{ min: number; max: number }> {
  const intervals = gates
    .map((gate) => ({
      min: Math.max(min, gate.center - gate.halfWidth),
      max: Math.min(max, gate.center + gate.halfWidth),
    }))
    .filter((interval) => interval.max > interval.min)
    .sort((a, b) => a.min - b.min);

  const merged: Array<{ min: number; max: number }> = [];
  for (const interval of intervals) {
    const previous = merged[merged.length - 1];
    if (!previous || interval.min > previous.max) {
      merged.push({ ...interval });
    } else {
      previous.max = Math.max(previous.max, interval.max);
    }
  }
  return merged;
}

function horizontalClearingGates(z: number): GateRange[] {
  const gates: GateRange[] = [];
  for (const clearing of MAZE_LANDMARK_CLEARINGS) {
    const dz = Math.abs(z - clearing.z);
    const reach = clearing.radius + MAZE_WALL_THICKNESS;
    if (dz >= reach) continue;
    gates.push({
      center: clearing.x,
      halfWidth: Math.sqrt(Math.max(0, reach * reach - dz * dz)),
    });
  }
  return gates;
}

function verticalClearingGates(x: number): GateRange[] {
  const gates: GateRange[] = [];
  for (const clearing of MAZE_LANDMARK_CLEARINGS) {
    const dx = Math.abs(x - clearing.x);
    const reach = clearing.radius + MAZE_WALL_THICKNESS;
    if (dx >= reach) continue;
    gates.push({
      center: clearing.z,
      halfWidth: Math.sqrt(Math.max(0, reach * reach - dx * dx)),
    });
  }
  return gates;
}

function segmentDistanceToPoint(
  start: MazePoint2,
  end: MazePoint2,
  point: MazePoint2,
): number {
  const dx = end.x - start.x;
  const dz = end.z - start.z;
  const lengthSq = dx * dx + dz * dz;
  if (lengthSq <= 1e-9) return Math.hypot(point.x - start.x, point.z - start.z);
  const t = Math.max(
    0,
    Math.min(1, ((point.x - start.x) * dx + (point.z - start.z) * dz) / lengthSq),
  );
  return Math.hypot(
    point.x - (start.x + dx * t),
    point.z - (start.z + dz * t),
  );
}

function intersectsLandmarkClearing(start: MazePoint2, end: MazePoint2): boolean {
  return MAZE_LANDMARK_CLEARINGS.some((clearing) => (
    segmentDistanceToPoint(start, end, clearing)
    <= clearing.radius + MAZE_WALL_THICKNESS
  ));
}

function addDoubleHorizontalWall(id: string, x: number, z: number, width: number): void {
  if (width <= MAZE_WALL_THICKNESS) return;
  const start = { x: x - width * 0.5, z };
  const end = { x: x + width * 0.5, z };
  if (intersectsLandmarkClearing(start, end)) return;
  logicalWallIds.add(id);
  for (const side of [-1, 1] as const) {
    walls.push({
      id: `${id}-${side < 0 ? 'a' : 'b'}`,
      x,
      z: z + side * MAZE_DOUBLE_WALL_CENTER_OFFSET,
      width,
      depth: MAZE_WALL_THICKNESS,
      height: MAZE_WALL_HEIGHT,
    });
  }
}

function addDoubleVerticalWall(id: string, x: number, z: number, depth: number): void {
  if (depth <= MAZE_WALL_THICKNESS) return;
  const start = { x, z: z - depth * 0.5 };
  const end = { x, z: z + depth * 0.5 };
  if (intersectsLandmarkClearing(start, end)) return;
  logicalWallIds.add(id);
  for (const side of [-1, 1] as const) {
    walls.push({
      id: `${id}-${side < 0 ? 'a' : 'b'}`,
      x: x + side * MAZE_DOUBLE_WALL_CENTER_OFFSET,
      z,
      width: MAZE_WALL_THICKNESS,
      depth,
      height: MAZE_WALL_HEIGHT,
    });
  }
}

function addHorizontalSpan(idPrefix: string, z: number, startX: number, endX: number): void {
  const length = endX - startX;
  if (length <= MAZE_WALL_THICKNESS) return;
  const count = Math.max(1, Math.ceil(length / MAZE_MAX_WALL_SEGMENT_LENGTH));
  const segmentLength = length / count;
  for (let index = 0; index < count; index += 1) {
    const minX = startX + index * segmentLength;
    const maxX = index === count - 1 ? endX : minX + segmentLength;
    addDoubleHorizontalWall(
      `${idPrefix}-${index}`,
      (minX + maxX) * 0.5,
      z,
      maxX - minX,
    );
  }
}

function addVerticalSpan(idPrefix: string, x: number, startZ: number, endZ: number): void {
  const length = endZ - startZ;
  if (length <= MAZE_WALL_THICKNESS) return;
  const count = Math.max(1, Math.ceil(length / MAZE_MAX_WALL_SEGMENT_LENGTH));
  const segmentLength = length / count;
  for (let index = 0; index < count; index += 1) {
    const minZ = startZ + index * segmentLength;
    const maxZ = index === count - 1 ? endZ : minZ + segmentLength;
    addDoubleVerticalWall(
      `${idPrefix}-${index}`,
      x,
      (minZ + maxZ) * 0.5,
      maxZ - minZ,
    );
  }
}

function addHorizontalRun(
  idPrefix: string,
  z: number,
  minX: number,
  maxX: number,
  gates: readonly GateRange[],
): void {
  const intervals = mergedGateIntervals(minX, maxX, [...gates, ...horizontalClearingGates(z)]);
  let cursor = minX;
  let segmentIndex = 0;
  for (const gate of intervals) {
    addHorizontalSpan(`${idPrefix}-run${segmentIndex++}`, z, cursor, gate.min);
    cursor = Math.max(cursor, gate.max);
  }
  addHorizontalSpan(`${idPrefix}-run${segmentIndex}`, z, cursor, maxX);
}

function addVerticalRun(
  idPrefix: string,
  x: number,
  minZ: number,
  maxZ: number,
  gates: readonly GateRange[],
): void {
  const intervals = mergedGateIntervals(minZ, maxZ, [...gates, ...verticalClearingGates(x)]);
  let cursor = minZ;
  let segmentIndex = 0;
  for (const gate of intervals) {
    addVerticalSpan(`${idPrefix}-run${segmentIndex++}`, x, cursor, gate.min);
    cursor = Math.max(cursor, gate.max);
  }
  addVerticalSpan(`${idPrefix}-run${segmentIndex}`, x, cursor, maxZ);
}

function cellId(cell: MazeCell): string {
  return `${cell.ix}:${cell.iz}`;
}

function edgeKey(a: MazeCell, b: MazeCell): string {
  const aKey = cellId(a);
  const bKey = cellId(b);
  return aKey < bKey ? `${aKey}|${bKey}` : `${bKey}|${aKey}`;
}

function isCentralHoleCell(ix: number, iz: number): boolean {
  return ix >= 6 && ix <= 11 && iz >= 6 && iz <= 11;
}

function isMazeCell(ix: number, iz: number): boolean {
  return (
    ix >= 0
    && ix < MAZE_GRID_CELLS
    && iz >= 0
    && iz < MAZE_GRID_CELLS
    && !isCentralHoleCell(ix, iz)
  );
}

function mazeCellCenter(cell: MazeCell): MazePoint2 {
  return {
    x: -MAZE_GRID_HALF_EXTENT + (cell.ix + 0.5) * MAZE_CORRIDOR_CELL_SIZE,
    z: -MAZE_GRID_HALF_EXTENT + (cell.iz + 0.5) * MAZE_CORRIDOR_CELL_SIZE,
  };
}

function xorshift32(state: number): number {
  let value = state >>> 0;
  value ^= (value << 13) >>> 0;
  value ^= value >>> 17;
  value ^= (value << 5) >>> 0;
  return value >>> 0;
}

function allMazeCells(): MazeCell[] {
  const cells: MazeCell[] = [];
  for (let iz = 0; iz < MAZE_GRID_CELLS; iz += 1) {
    for (let ix = 0; ix < MAZE_GRID_CELLS; ix += 1) {
      if (isMazeCell(ix, iz)) cells.push({ ix, iz });
    }
  }
  return cells;
}

function neighborsOf(cell: MazeCell): MazeCell[] {
  const result: MazeCell[] = [];
  const offsets = [
    { ix: -1, iz: 0 },
    { ix: 1, iz: 0 },
    { ix: 0, iz: -1 },
    { ix: 0, iz: 1 },
  ] as const;
  for (const offset of offsets) {
    const ix = cell.ix + offset.ix;
    const iz = cell.iz + offset.iz;
    if (isMazeCell(ix, iz)) result.push({ ix, iz });
  }
  return result;
}

function buildMazePassages(): {
  passages: Set<string>;
  loopPassages: number;
  deadEnds: number;
  junctions: number;
  cellCount: number;
} {
  const cells = allMazeCells();
  const visited = new Set<string>();
  const passages = new Set<string>();
  const stack: MazeCell[] = [{ ix: 8, iz: 5 }];
  let randomState = 0x6d2b79f5;
  visited.add(cellId(stack[0]));

  while (stack.length > 0) {
    const current = stack[stack.length - 1];
    const candidates = neighborsOf(current).filter((cell) => !visited.has(cellId(cell)));
    if (candidates.length === 0) {
      stack.pop();
      continue;
    }

    randomState = xorshift32(randomState);
    const next = candidates[randomState % candidates.length];
    passages.add(edgeKey(current, next));
    visited.add(cellId(next));
    stack.push(next);
  }

  const closedEdges: Array<{ a: MazeCell; b: MazeCell }> = [];
  for (const cell of cells) {
    for (const neighbor of [
      { ix: cell.ix + 1, iz: cell.iz },
      { ix: cell.ix, iz: cell.iz + 1 },
    ]) {
      if (!isMazeCell(neighbor.ix, neighbor.iz)) continue;
      const key = edgeKey(cell, neighbor);
      if (!passages.has(key)) closedEdges.push({ a: cell, b: neighbor });
    }
  }

  let loopPassages = 0;
  for (const edge of closedEdges) {
    randomState = xorshift32(randomState);
    if ((randomState % 10_000) >= MAZE_LOOP_PROBABILITY * 10_000) continue;
    passages.add(edgeKey(edge.a, edge.b));
    loopPassages += 1;
  }

  const degree = new Map<string, number>();
  for (const cell of cells) degree.set(cellId(cell), 0);
  for (const key of passages) {
    const [a, b] = key.split('|');
    degree.set(a, (degree.get(a) ?? 0) + 1);
    degree.set(b, (degree.get(b) ?? 0) + 1);
  }

  return {
    passages,
    loopPassages,
    deadEnds: [...degree.values()].filter((value) => value === 1).length,
    junctions: [...degree.values()].filter((value) => value >= 3).length,
    cellCount: cells.length,
  };
}

const mazeTopology = buildMazePassages();

export const MAZE_TOPOLOGY_STATS = Object.freeze({
  cellCount: mazeTopology.cellCount,
  loopPassages: mazeTopology.loopPassages,
  deadEnds: mazeTopology.deadEnds,
  junctions: mazeTopology.junctions,
});

function addInternalMazeWalls(): void {
  for (let iz = 0; iz < MAZE_GRID_CELLS; iz += 1) {
    for (let ix = 0; ix < MAZE_GRID_CELLS; ix += 1) {
      if (!isMazeCell(ix, iz)) continue;
      const cell = { ix, iz };
      const center = mazeCellCenter(cell);

      const right = { ix: ix + 1, iz };
      if (isMazeCell(right.ix, right.iz) && !mazeTopology.passages.has(edgeKey(cell, right))) {
        addDoubleVerticalWall(
          `grid-v-${ix + 1}-${iz}`,
          center.x + MAZE_CORRIDOR_CELL_SIZE * 0.5,
          center.z,
          MAZE_CORRIDOR_CELL_SIZE,
        );
      }

      const down = { ix, iz: iz + 1 };
      if (isMazeCell(down.ix, down.iz) && !mazeTopology.passages.has(edgeKey(cell, down))) {
        addDoubleHorizontalWall(
          `grid-h-${ix}-${iz + 1}`,
          center.x,
          center.z + MAZE_CORRIDOR_CELL_SIZE * 0.5,
          MAZE_CORRIDOR_CELL_SIZE,
        );
      }
    }
  }
}

const centralEntrance: readonly GateRange[] = [
  { center: 0, halfWidth: MAZE_CENTRAL_GATE_HALF_WIDTH },
];

// Nucleo Zero is a large, empty "Glade". These four openings are the only
// passages from the clearing into the generated maze.
addHorizontalRun(
  'center-n',
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  centralEntrance,
);
addHorizontalRun(
  'center-s',
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  centralEntrance,
);
addVerticalRun(
  'center-w',
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  centralEntrance,
);
addVerticalRun(
  'center-e',
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  -MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  MAZE_CENTRAL_BOUNDARY_HALF_EXTENT,
  centralEntrance,
);

addInternalMazeWalls();

const outerExitOffset = MAZE_CORRIDOR_CELL_SIZE * 6.5;
const outerExitHalfWidth = MAZE_CORRIDOR_CELL_SIZE * 0.5;
const outerExits: readonly GateRange[] = [
  { center: -outerExitOffset, halfWidth: outerExitHalfWidth },
  { center: outerExitOffset, halfWidth: outerExitHalfWidth },
];

// The maze itself occupies ~50% of the map. Beyond this perimeter the biome
// space opens again; paired exits on every side keep each quadrant reachable.
addHorizontalRun(
  'outer-n',
  -MAZE_GRID_HALF_EXTENT,
  -MAZE_GRID_HALF_EXTENT,
  MAZE_GRID_HALF_EXTENT,
  outerExits,
);
addHorizontalRun(
  'outer-s',
  MAZE_GRID_HALF_EXTENT,
  -MAZE_GRID_HALF_EXTENT,
  MAZE_GRID_HALF_EXTENT,
  outerExits,
);
addVerticalRun(
  'outer-w',
  -MAZE_GRID_HALF_EXTENT,
  -MAZE_GRID_HALF_EXTENT,
  MAZE_GRID_HALF_EXTENT,
  outerExits,
);
addVerticalRun(
  'outer-e',
  MAZE_GRID_HALF_EXTENT,
  -MAZE_GRID_HALF_EXTENT,
  MAZE_GRID_HALF_EXTENT,
  outerExits,
);

export const MAZE_WALLS: readonly MazeWall[] = Object.freeze(walls);
export const MAZE_LOGICAL_WALL_COUNT = logicalWallIds.size;

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

const SPATIAL_CELL_SIZE = MAZE_CORRIDOR_CELL_SIZE;
const spatialWallIndex = new Map<string, number[]>();

function spatialCell(value: number): number {
  return Math.floor(value / SPATIAL_CELL_SIZE);
}

function spatialKey(x: number, z: number): string {
  return `${x}:${z}`;
}

function addSpatialWall(cellX: number, cellZ: number, wallIndex: number): void {
  const key = spatialKey(cellX, cellZ);
  const list = spatialWallIndex.get(key);
  if (list) list.push(wallIndex);
  else spatialWallIndex.set(key, [wallIndex]);
}

MAZE_WALLS.forEach((wall, wallIndex) => {
  const bounds = wallBounds(wall);
  for (let cellX = spatialCell(bounds.minX); cellX <= spatialCell(bounds.maxX); cellX += 1) {
    for (let cellZ = spatialCell(bounds.minZ); cellZ <= spatialCell(bounds.maxZ); cellZ += 1) {
      addSpatialWall(cellX, cellZ, wallIndex);
    }
  }
});

function candidateWallIndices(bounds: Bounds2): number[] {
  const found = new Set<number>();
  for (let cellX = spatialCell(bounds.minX); cellX <= spatialCell(bounds.maxX); cellX += 1) {
    for (let cellZ = spatialCell(bounds.minZ); cellZ <= spatialCell(bounds.maxZ); cellZ += 1) {
      for (const index of spatialWallIndex.get(spatialKey(cellX, cellZ)) ?? []) found.add(index);
    }
  }
  return [...found];
}

export function isMazePositionBlocked(x: number, z: number, padding = MAZE_PLAYER_RADIUS): boolean {
  const point = { x, z };
  const query = {
    minX: x - padding,
    maxX: x + padding,
    minZ: z - padding,
    maxZ: z + padding,
  };
  return candidateWallIndices(query).some((index) => pointInBounds(point, wallBounds(MAZE_WALLS[index], padding)));
}

export function mazeSegmentCrossesWall(
  start: MazePoint2,
  end: MazePoint2,
  padding = MAZE_PLAYER_RADIUS,
): boolean {
  const query = {
    minX: Math.min(start.x, end.x) - padding,
    maxX: Math.max(start.x, end.x) + padding,
    minZ: Math.min(start.z, end.z) - padding,
    maxZ: Math.max(start.z, end.z) + padding,
  };

  for (const index of candidateWallIndices(query)) {
    const bounds = wallBounds(MAZE_WALLS[index], padding);
    const startedInside = pointInBounds(start, bounds);
    const endedInside = pointInBounds(end, bounds);

    if (startedInside && !endedInside) continue;
    if (startedInside && endedInside) return true;
    if (!startedInside && segmentIntersectsBounds(start, end, bounds)) return true;
  }
  return false;
}

export type MazeMovementResolution = MazePoint2 & { blocked: boolean };

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

export function nearestMazeRayHitDistance(
  origin: MazeRayPoint,
  direction: MazeRayPoint,
  maxDistance: number,
): number | null {
  const length = Math.hypot(direction.x, direction.y ?? 0, direction.z);
  if (!Number.isFinite(length) || length < 1e-9 || maxDistance <= 0) return null;
  const end = {
    x: origin.x + (direction.x / length) * maxDistance,
    z: origin.z + (direction.z / length) * maxDistance,
  };
  const query = {
    minX: Math.min(origin.x, end.x),
    maxX: Math.max(origin.x, end.x),
    minZ: Math.min(origin.z, end.z),
    maxZ: Math.max(origin.z, end.z),
  };

  let nearest = Number.POSITIVE_INFINITY;
  for (const index of candidateWallIndices(query)) {
    const distance = rayBoundsDistance(origin, direction, wallBounds(MAZE_WALLS[index]), maxDistance);
    if (distance !== null && distance < nearest) nearest = distance;
  }
  return Number.isFinite(nearest) ? nearest : null;
}

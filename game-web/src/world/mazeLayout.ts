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

export const MAZE_CELL_SIZE = 72;
export const MAZE_WALL_THICKNESS = 14;
export const MAZE_WALL_BOTTOM_Y = -600;
export const MAZE_WALL_TOP_Y = 1200;
export const MAZE_WALL_HEIGHT = MAZE_WALL_TOP_Y - MAZE_WALL_BOTTOM_Y;
export const MAZE_PLAYER_RADIUS = 1.15;
export const MAZE_SUPPLY_CLEARANCE = 1.25;

export const MAZE_CENTRAL_CLEARING_RADIUS = 420;
export const MAZE_CENTRAL_GATE_HALF_WIDTH = 80;
export const MAZE_CENTRAL_GATE_WIDTH = MAZE_CENTRAL_GATE_HALF_WIDTH * 2;

export const MAZE_DOUBLE_WALL_GAP = 42;
export const MAZE_DOUBLE_WALL_CENTER_OFFSET =
  (MAZE_DOUBLE_WALL_GAP + MAZE_WALL_THICKNESS) * 0.5;

/**
 * Square control rings. The last nominal radius plus the double-wall offset
 * lands at 1660 m, making the authored maze footprint almost exactly 50% of
 * the 4700 x 4700 playable square.
 */
export const MAZE_WORLD_RING_RADII = [540, 920, 1300, 1632] as const;
export const MAZE_WORLD_COVERAGE_HALF_EXTENT =
  MAZE_WORLD_RING_RADII[MAZE_WORLD_RING_RADII.length - 1] + MAZE_DOUBLE_WALL_CENTER_OFFSET;
export const MAZE_WORLD_COVERAGE_RADIUS = MAZE_WORLD_COVERAGE_HALF_EXTENT;
export const MAZE_TARGET_MAP_AREA_FRACTION =
  ((MAZE_WORLD_COVERAGE_HALF_EXTENT * 2) ** 2)
  / ((PLAYABLE_WORLD_HALF_EXTENT * 2) ** 2);

export const MAZE_MAX_WALL_SEGMENT_LENGTH = 144;

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
    const reach = clearing.radius + MAZE_WALL_THICKNESS * 0.5;
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
    const reach = clearing.radius + MAZE_WALL_THICKNESS * 0.5;
    if (dx >= reach) continue;
    gates.push({
      center: clearing.z,
      halfWidth: Math.sqrt(Math.max(0, reach * reach - dx * dx)),
    });
  }
  return gates;
}

function addHorizontalSpan(idPrefix: string, z: number, startX: number, endX: number): void {
  const length = endX - startX;
  if (length <= MAZE_WALL_THICKNESS) return;
  const count = Math.max(1, Math.ceil(length / MAZE_MAX_WALL_SEGMENT_LENGTH));
  const segmentLength = length / count;
  for (let index = 0; index < count; index += 1) {
    const minX = startX + index * segmentLength;
    const maxX = index === count - 1 ? endX : minX + segmentLength;
    walls.push({
      id: `${idPrefix}-${index}`,
      x: (minX + maxX) * 0.5,
      z,
      width: maxX - minX,
      depth: MAZE_WALL_THICKNESS,
      height: MAZE_WALL_HEIGHT,
    });
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
    walls.push({
      id: `${idPrefix}-${index}`,
      x,
      z: (minZ + maxZ) * 0.5,
      width: MAZE_WALL_THICKNESS,
      depth: maxZ - minZ,
      height: MAZE_WALL_HEIGHT,
    });
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

type RingGates = {
  north: readonly GateRange[];
  south: readonly GateRange[];
  west: readonly GateRange[];
  east: readonly GateRange[];
};

function addSquareLayer(idPrefix: string, radius: number, gates: RingGates): void {
  addHorizontalRun(`${idPrefix}-n`, -radius, -radius, radius, gates.north);
  addHorizontalRun(`${idPrefix}-s`, radius, -radius, radius, gates.south);
  addVerticalRun(`${idPrefix}-w`, -radius, -radius, radius, gates.west);
  addVerticalRun(`${idPrefix}-e`, radius, -radius, radius, gates.east);
}

function addDoubleSquareRing(
  idPrefix: string,
  nominalRadius: number,
  gates: RingGates,
): void {
  addSquareLayer(
    `${idPrefix}-inner`,
    nominalRadius - MAZE_DOUBLE_WALL_CENTER_OFFSET,
    gates,
  );
  addSquareLayer(
    `${idPrefix}-outer`,
    nominalRadius + MAZE_DOUBLE_WALL_CENTER_OFFSET,
    gates,
  );
}

const centralEntrances: RingGates = {
  north: [{ center: 0, halfWidth: MAZE_CENTRAL_GATE_HALF_WIDTH }],
  south: [{ center: 0, halfWidth: MAZE_CENTRAL_GATE_HALF_WIDTH }],
  west: [{ center: 0, halfWidth: MAZE_CENTRAL_GATE_HALF_WIDTH }],
  east: [{ center: 0, halfWidth: MAZE_CENTRAL_GATE_HALF_WIDTH }],
};

// The spawn clearing is deliberately empty. The first maze boundary begins
// beyond 500 m and can only be crossed through the four cardinal entrances.
addDoubleSquareRing('center-gate', MAZE_WORLD_RING_RADII[0], centralEntrances);

// Deeper rings keep very broad corridors but move their gates sideways so the
// full labyrinth cannot be solved by running in one straight radial line.
for (let index = 1; index < MAZE_WORLD_RING_RADII.length; index += 1) {
  const radius = MAZE_WORLD_RING_RADII[index];
  const sign = index % 2 === 0 ? 1 : -1;
  const far = radius * 0.48;
  const near = radius * 0.17;
  const gateHalfWidth = index === MAZE_WORLD_RING_RADII.length - 1 ? 100 : 90;
  const gates: RingGates = {
    north: [
      { center: -far * sign, halfWidth: gateHalfWidth },
      { center: near * sign, halfWidth: gateHalfWidth },
    ],
    south: [
      { center: -near * sign, halfWidth: gateHalfWidth },
      { center: far * sign, halfWidth: gateHalfWidth },
    ],
    west: [
      { center: far * sign, halfWidth: gateHalfWidth },
      { center: -near * sign, halfWidth: gateHalfWidth },
    ],
    east: [
      { center: near * sign, halfWidth: gateHalfWidth },
      { center: -far * sign, halfWidth: gateHalfWidth },
    ],
  };
  addDoubleSquareRing(`world-${radius}`, radius, gates);
}

export const MAZE_WALLS: readonly MazeWall[] = Object.freeze(walls);

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

const SPATIAL_CELL_SIZE = 180;
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

    // Layout migrations must never trap an entity already overlapping a new
    // wall: moving out remains legal.
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

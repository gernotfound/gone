export interface RobotHitboxAnchor {
  x: number;
  y: number;
  z: number;
}

export interface RobotHitboxHit {
  distance: number;
  isHeadshot: boolean;
}

type AabbOffsets = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
  minZ: number;
  maxZ: number;
};

/**
 * Hitboxes are aligned to the actual floating robot model, whose group origin
 * is the network/physics player position. The old cylinder extended two metres
 * below this origin, creating an invisible damage volume under the drone.
 *
 * Two boxes are intentionally used instead of per-limb colliders: one broad
 * torso/propulsor box and one smaller head/visor box. This keeps authoritative
 * hit validation cheap while matching what the player can actually see.
 */
export const ROBOT_BODY_HITBOX: Readonly<AabbOffsets> = Object.freeze({
  minX: -0.58,
  maxX: 0.58,
  minY: -0.48,
  maxY: 1.08,
  minZ: -0.50,
  maxZ: 0.50,
});

export const ROBOT_HEAD_HITBOX: Readonly<AabbOffsets> = Object.freeze({
  minX: -0.31,
  maxX: 0.31,
  minY: 1.05,
  maxY: 1.52,
  minZ: -0.34,
  maxZ: 0.34,
});

function intersectAabb(
  ox: number,
  oy: number,
  oz: number,
  dx: number,
  dy: number,
  dz: number,
  anchor: RobotHitboxAnchor,
  box: Readonly<AabbOffsets>,
  maxRange: number,
): number | null {
  let tMin = 0;
  let tMax = maxRange;

  const origins = [ox, oy, oz] as const;
  const directions = [dx, dy, dz] as const;
  const mins = [anchor.x + box.minX, anchor.y + box.minY, anchor.z + box.minZ] as const;
  const maxs = [anchor.x + box.maxX, anchor.y + box.maxY, anchor.z + box.maxZ] as const;

  for (let axis = 0; axis < 3; axis += 1) {
    const origin = origins[axis];
    const direction = directions[axis];
    const min = mins[axis];
    const max = maxs[axis];

    if (Math.abs(direction) < 1e-8) {
      if (origin < min || origin > max) return null;
      continue;
    }

    const inv = 1 / direction;
    let near = (min - origin) * inv;
    let far = (max - origin) * inv;
    if (near > far) {
      const tmp = near;
      near = far;
      far = tmp;
    }

    tMin = Math.max(tMin, near);
    tMax = Math.min(tMax, far);
    if (tMin > tMax) return null;
  }

  if (tMax < 0 || tMin > maxRange) return null;
  return Math.max(0, tMin);
}

export function intersectRobotHitbox(
  origin: [number, number, number],
  direction: [number, number, number],
  anchor: RobotHitboxAnchor,
  maxRange: number,
): RobotHitboxHit | null {
  const magnitude = Math.hypot(direction[0], direction[1], direction[2]);
  if (magnitude < 1e-6 || maxRange <= 0) return null;

  const dx = direction[0] / magnitude;
  const dy = direction[1] / magnitude;
  const dz = direction[2] / magnitude;

  const bodyDistance = intersectAabb(
    origin[0], origin[1], origin[2], dx, dy, dz,
    anchor, ROBOT_BODY_HITBOX, maxRange,
  );
  const headDistance = intersectAabb(
    origin[0], origin[1], origin[2], dx, dy, dz,
    anchor, ROBOT_HEAD_HITBOX, maxRange,
  );

  if (bodyDistance === null && headDistance === null) return null;
  if (headDistance !== null && (bodyDistance === null || headDistance <= bodyDistance)) {
    return { distance: headDistance, isHeadshot: true };
  }
  return { distance: bodyDistance!, isHeadshot: false };
}

// tests/helpers/hitscan_model.mjs
// Authoritative 3D ray-cylinder hitscan intersection mathematics for G.O.N.E.

import { calculateDamage } from './weapon_model.mjs';

export const TARGET_CYLINDER = {
  radiusM: 0.45,
  heightM: 2.0,
  headshotThresholdM: 1.55, // From base of cylinder
};

/**
 * Validates a 3D hitscan ray against a vertical cylinder representing a player hitbox.
 *
 * @param {string} weaponKey - Weapon key (e.g. 'assalto', 'cecchino')
 * @param {Array<number>} origin - [ox, oy, oz]
 * @param {Array<number>} direction - [dx, dy, dz] (will be normalized)
 * @param {Array<number>} targetBase - [bx, by, bz] (bottom center of target cylinder)
 * @param {number} radius - cylinder radius (default 0.45m)
 * @param {number} height - cylinder height (default 2.0m)
 * @returns {object} { hit: boolean, distance: number, hitPoint: [x,y,z], isHeadshot: boolean, damage: number }
 */
export function validateHitscanRay(
  weaponKey,
  origin,
  direction,
  targetBase,
  radius = TARGET_CYLINDER.radiusM,
  height = TARGET_CYLINDER.heightM
) {
  const [ox, oy, oz] = origin;
  let [dx, dy, dz] = direction;
  const [bx, by, bz] = targetBase;

  // Normalize direction vector
  const len = Math.hypot(dx, dy, dz);
  if (len === 0) {
    return { hit: false, distance: 0, hitPoint: null, isHeadshot: false, damage: 0 };
  }
  dx /= len;
  dy /= len;
  dz /= len;

  const deltaX = ox - bx;
  const deltaZ = oz - bz;

  const A = dx * dx + dz * dz;
  const B = 2 * (dx * deltaX + dz * deltaZ);
  const C = deltaX * deltaX + deltaZ * deltaZ - radius * radius;

  let candidates = [];

  // Check side cylinder intersections (quadratic in XZ)
  if (Math.abs(A) > 1e-9) {
    const discriminant = B * B - 4 * A * C;
    if (discriminant >= 0) {
      const sqrtDisc = Math.sqrt(discriminant);
      const t1 = (-B - sqrtDisc) / (2 * A);
      const t2 = (-B + sqrtDisc) / (2 * A);

      for (const t of [t1, t2]) {
        if (t > 0) {
          const y = oy + t * dy;
          if (y >= by - 1e-4 && y <= by + height + 1e-4) {
            candidates.push({ t, y, type: 'side' });
          }
        }
      }
    }
  }

  // Check top cap intersection (y = by + height)
  if (Math.abs(dy) > 1e-9) {
    const tTop = (by + height - oy) / dy;
    if (tTop > 0) {
      const xTop = ox + tTop * dx;
      const zTop = oz + tTop * dz;
      const distSq = (xTop - bx) * (xTop - bx) + (zTop - bz) * (zTop - bz);
      if (distSq <= radius * radius + 1e-4) {
        candidates.push({ t: tTop, y: by + height, type: 'top' });
      }
    }

    // Check bottom cap intersection (y = by)
    const tBottom = (by - oy) / dy;
    if (tBottom > 0) {
      const xBottom = ox + tBottom * dx;
      const zBottom = oz + tBottom * dz;
      const distSq = (xBottom - bx) * (xBottom - bx) + (zBottom - bz) * (zBottom - bz);
      if (distSq <= radius * radius + 1e-4) {
        candidates.push({ t: tBottom, y: by, type: 'bottom' });
      }
    }
  }

  if (candidates.length === 0) {
    return { hit: false, distance: 0, hitPoint: null, isHeadshot: false, damage: 0 };
  }

  // Sort candidates by smallest positive distance t
  candidates.sort((a, b) => a.t - b.t);
  const best = candidates[0];

  const hitX = ox + best.t * dx;
  const hitY = best.y;
  const hitZ = oz + best.t * dz;

  const isHeadshot = hitY >= by + TARGET_CYLINDER.headshotThresholdM - 1e-4;
  const damage = calculateDamage(weaponKey, best.t, isHeadshot);

  return {
    hit: true,
    distance: best.t,
    hitPoint: [hitX, hitY, hitZ],
    isHeadshot,
    damage,
  };
}

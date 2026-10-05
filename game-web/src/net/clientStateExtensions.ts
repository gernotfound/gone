import {
  CENTRAL_SUPPLY_AUTHORITY_MAX_RADIUS,
  CENTRAL_SUPPLY_AUTHORITY_MIN_RADIUS,
  WORLD_CENTER_X,
  WORLD_CENTER_Z,
} from '../world/worldTopology.ts';

/** Spare CLIENT_STATE bits reserved for gameplay requests; packet size is unchanged. */
export const CLIENT_STATE_EXT_FLAGS = {
  HEALTH_PICKUP_REQUEST: 1 << 6,
} as const;

/** Host-side guardrails for health crate requests around the central supply annulus. */
export const HEALTH_PICKUP_AUTHORITY = {
  centerX: WORLD_CENTER_X,
  centerZ: WORLD_CENTER_Z,
  minRadius: CENTRAL_SUPPLY_AUTHORITY_MIN_RADIUS,
  maxRadius: CENTRAL_SUPPLY_AUTHORITY_MAX_RADIUS,
  cooldownMs: 12_000,
} as const;

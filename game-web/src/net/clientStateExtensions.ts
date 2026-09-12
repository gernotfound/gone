/** Spare CLIENT_STATE bits reserved for gameplay requests; packet size is unchanged. */
export const CLIENT_STATE_EXT_FLAGS = {
  HEALTH_PICKUP_REQUEST: 1 << 6,
} as const;

/** Host-side guardrails for health crate requests in the giant crater. */
export const HEALTH_PICKUP_AUTHORITY = {
  centerX: 1200,
  centerZ: 1200,
  maxRadius: 195,
  cooldownMs: 12_000,
} as const;

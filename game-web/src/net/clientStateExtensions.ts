/** Spare CLIENT_STATE bits reserved for gameplay requests; packet size is unchanged. */
export const CLIENT_STATE_EXT_FLAGS = {
  HEALTH_PICKUP_REQUEST: 1 << 6,
} as const;

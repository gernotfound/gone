/**
 * Host-side movement authority contract for guest CLIENT_STATE packets.
 *
 * The browser client remains prediction-authoritative for presentation only.
 * The host owns the accepted transform used for snapshots, combat and pickups.
 *
 * Limits are derived from game-core/src/physics.rs:
 * - base speed 12 m/s
 * - sprint multiplier 2.0
 * - movement scale clamp max 1.25 => 30 m/s horizontal ceiling
 * - jump impulse 25 m/s
 * - terminal fall speed 54 m/s
 * - player height 2.0 m + float height 0.5 m
 *
 * Credit is replenished using the host monotonic clock, never the client
 * timestamp. A one-second credit cap matches the existing 1000 ms stale/rewind
 * horizon and prevents an idle client from banking unbounded teleport distance.
 */

export type AuthorityPosition = { x: number; y: number; z: number };

export const MOVEMENT_AUTHORITY = {
  baseSpeedMps: 12,
  sprintMultiplier: 2,
  maxMovementScale: 1.25,
  maxHorizontalSpeedMps: 12 * 2 * 1.25,
  jumpSpeedMps: 25,
  terminalFallSpeedMps: 54,
  clientStateHz: 30,
  maxNetworkCreditMs: 1000,
  teleportDistanceM: 10,
  terrainSnapSlackM: 2.0 + 0.5,
} as const;

const PACKET_JITTER_TICKS = 2;
const HORIZONTAL_PACKET_SLACK_M =
  MOVEMENT_AUTHORITY.maxHorizontalSpeedMps * (PACKET_JITTER_TICKS / MOVEMENT_AUTHORITY.clientStateHz);
const MAX_UPWARD_SPEED_MPS = Math.max(
  MOVEMENT_AUTHORITY.jumpSpeedMps,
  MOVEMENT_AUTHORITY.maxHorizontalSpeedMps,
);
const MAX_DOWNWARD_SPEED_MPS = Math.max(
  MOVEMENT_AUTHORITY.terminalFallSpeedMps,
  MOVEMENT_AUTHORITY.maxHorizontalSpeedMps,
);
const UPWARD_PACKET_SLACK_M =
  MOVEMENT_AUTHORITY.terrainSnapSlackM
  + MAX_UPWARD_SPEED_MPS * (PACKET_JITTER_TICKS / MOVEMENT_AUTHORITY.clientStateHz);
const DOWNWARD_PACKET_SLACK_M =
  MOVEMENT_AUTHORITY.terrainSnapSlackM
  + MAX_DOWNWARD_SPEED_MPS * (PACKET_JITTER_TICKS / MOVEMENT_AUTHORITY.clientStateHz);

export const LOCAL_AUTHORITY_CORRECTION_DISTANCE_M = MOVEMENT_AUTHORITY.teleportDistanceM;

export type MovementAuthorityState = {
  lastAcceptedHostTime: number;
  horizontalCreditM: number;
  upwardCreditM: number;
  downwardCreditM: number;
};

export type MovementRejectionReason =
  | 'horizontal-speed'
  | 'teleport'
  | 'vertical-up'
  | 'vertical-down';

export type MovementValidationResult =
  | { ok: true; next: MovementAuthorityState }
  | {
      ok: false;
      reason: MovementRejectionReason;
      horizontalDistanceM: number;
      verticalDeltaM: number;
      horizontalBudgetM: number;
      verticalBudgetM: number;
    };

function maxCredit(rateMps: number, packetSlackM: number): number {
  return packetSlackM + rateMps * (MOVEMENT_AUTHORITY.maxNetworkCreditMs / 1000);
}

export function createMovementAuthorityState(hostNow: number): MovementAuthorityState {
  return {
    lastAcceptedHostTime: hostNow,
    horizontalCreditM: HORIZONTAL_PACKET_SLACK_M,
    upwardCreditM: UPWARD_PACKET_SLACK_M,
    downwardCreditM: DOWNWARD_PACKET_SLACK_M,
  };
}

export function validateClientMovement(
  previous: AuthorityPosition,
  next: AuthorityPosition,
  authority: MovementAuthorityState,
  hostNow: number,
): MovementValidationResult {
  const elapsedMs = Math.max(
    0,
    Math.min(
      MOVEMENT_AUTHORITY.maxNetworkCreditMs,
      Number.isFinite(hostNow - authority.lastAcceptedHostTime)
        ? hostNow - authority.lastAcceptedHostTime
        : 0,
    ),
  );
  const dt = elapsedMs / 1000;

  const horizontalBudgetM = Math.min(
    maxCredit(MOVEMENT_AUTHORITY.maxHorizontalSpeedMps, HORIZONTAL_PACKET_SLACK_M),
    authority.horizontalCreditM + MOVEMENT_AUTHORITY.maxHorizontalSpeedMps * dt,
  );
  const upwardBudgetM = Math.min(
    maxCredit(MAX_UPWARD_SPEED_MPS, UPWARD_PACKET_SLACK_M),
    authority.upwardCreditM + MAX_UPWARD_SPEED_MPS * dt,
  );
  const downwardBudgetM = Math.min(
    maxCredit(MAX_DOWNWARD_SPEED_MPS, DOWNWARD_PACKET_SLACK_M),
    authority.downwardCreditM + MAX_DOWNWARD_SPEED_MPS * dt,
  );

  const dx = next.x - previous.x;
  const dz = next.z - previous.z;
  const horizontalDistanceM = Math.hypot(dx, dz);
  const verticalDeltaM = next.y - previous.y;

  if (horizontalDistanceM > horizontalBudgetM + 1e-6) {
    return {
      ok: false,
      reason: horizontalDistanceM >= MOVEMENT_AUTHORITY.teleportDistanceM ? 'teleport' : 'horizontal-speed',
      horizontalDistanceM,
      verticalDeltaM,
      horizontalBudgetM,
      verticalBudgetM: verticalDeltaM >= 0 ? upwardBudgetM : downwardBudgetM,
    };
  }

  if (verticalDeltaM > upwardBudgetM + 1e-6) {
    return {
      ok: false,
      reason: 'vertical-up',
      horizontalDistanceM,
      verticalDeltaM,
      horizontalBudgetM,
      verticalBudgetM: upwardBudgetM,
    };
  }

  if (-verticalDeltaM > downwardBudgetM + 1e-6) {
    return {
      ok: false,
      reason: 'vertical-down',
      horizontalDistanceM,
      verticalDeltaM,
      horizontalBudgetM,
      verticalBudgetM: downwardBudgetM,
    };
  }

  return {
    ok: true,
    next: {
      lastAcceptedHostTime: hostNow,
      horizontalCreditM: Math.max(0, horizontalBudgetM - horizontalDistanceM),
      upwardCreditM: verticalDeltaM > 0
        ? Math.max(0, upwardBudgetM - verticalDeltaM)
        : upwardBudgetM,
      downwardCreditM: verticalDeltaM < 0
        ? Math.max(0, downwardBudgetM + verticalDeltaM)
        : downwardBudgetM,
    },
  };
}

export function normalizeYaw(yaw: number): number {
  const tau = Math.PI * 2;
  let normalized = yaw % tau;
  if (normalized > Math.PI) normalized -= tau;
  if (normalized < -Math.PI) normalized += tau;
  return normalized;
}

export function isValidPitch(pitch: number): boolean {
  return Number.isFinite(pitch) && Math.abs(pitch) <= Math.PI / 2 + 0.05;
}

export const MAX_PEER_ID_LENGTH = 80;
export const MAX_PLAYER_NAME_LENGTH = 32;
export const MAX_WORLD_XZ = 4096;
export const MIN_WORLD_Y = -512;
export const MAX_WORLD_Y = 2048;
export const MAX_GUEST_HORIZONTAL_SPEED = 32;
export const MAX_GUEST_VERTICAL_SPEED = 70;
export const MOVEMENT_HORIZONTAL_SLACK = 3;
export const MOVEMENT_VERTICAL_SLACK = 4;
export const MAX_MOVEMENT_WINDOW_MS = 1000;

export type AuthorityPosition = { x: number; y: number; z: number };

export type ClientTransformLike = AuthorityPosition & {
  yaw: number;
  pitch: number;
};

export type PeerClaimValidation =
  | { ok: true }
  | { ok: false; reason: 'invalid-peer-id' | 'host-impersonation' | 'identity-mismatch' };

const PEER_ID_RE = /^[A-Za-z0-9][A-Za-z0-9_-]*$/;

/** Transport identity is canonical. Lobby payloads may only repeat that identity. */
export function validatePeerClaim(peerId: string, claimedPlayerId: string, hostPlayerId: string): PeerClaimValidation {
  if (
    typeof peerId !== 'string'
    || peerId.length < 1
    || peerId.length > MAX_PEER_ID_LENGTH
    || !PEER_ID_RE.test(peerId)
  ) {
    return { ok: false, reason: 'invalid-peer-id' };
  }
  if (peerId === hostPlayerId || claimedPlayerId === hostPlayerId) {
    return { ok: false, reason: 'host-impersonation' };
  }
  if (claimedPlayerId !== peerId) {
    return { ok: false, reason: 'identity-mismatch' };
  }
  return { ok: true };
}

/** Keep lobby presentation bounded before it reaches fixed-size binary encoders. */
export function sanitizePlayerName(value: unknown): string {
  const clean = String(value ?? '')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_PLAYER_NAME_LENGTH);
  return clean || 'Giocatore';
}

export function isFiniteClientTransform(value: ClientTransformLike): boolean {
  return [value.x, value.y, value.z, value.yaw, value.pitch].every(Number.isFinite);
}

export function isPositionInsideAuthorityBounds(value: AuthorityPosition): boolean {
  return (
    Math.abs(value.x) <= MAX_WORLD_XZ
    && Math.abs(value.z) <= MAX_WORLD_XZ
    && value.y >= MIN_WORLD_Y
    && value.y <= MAX_WORLD_Y
  );
}

/** Reliable ordered channels should only move sequence numbers forward, modulo their bit width. */
export function isForwardSequence(previous: number, next: number, bits: 8 | 16): boolean {
  if (!Number.isInteger(previous) || !Number.isInteger(next)) return false;
  if (previous === 0) return true;
  const modulus = bits === 8 ? 0x100 : 0x10000;
  const half = modulus / 2;
  const mask = modulus - 1;
  const diff = (next - previous) & mask;
  return diff > 0 && diff <= half;
}

/**
 * Host-clock movement envelope. It is deliberately tolerant of jitter but does
 * not let a long network stall accumulate unlimited teleport budget.
 */
export function movementEnvelopeAllows(
  previous: AuthorityPosition,
  next: AuthorityPosition,
  elapsedMs: number,
): boolean {
  if (!isPositionInsideAuthorityBounds(next)) return false;
  const windowMs = Math.max(0, Math.min(MAX_MOVEMENT_WINDOW_MS, Number(elapsedMs) || 0));
  const dt = windowMs / 1000;
  const horizontalLimit = MOVEMENT_HORIZONTAL_SLACK + MAX_GUEST_HORIZONTAL_SPEED * dt;
  const verticalLimit = MOVEMENT_VERTICAL_SLACK + MAX_GUEST_VERTICAL_SPEED * dt;
  const horizontalDistance = Math.hypot(next.x - previous.x, next.z - previous.z);
  const verticalDistance = Math.abs(next.y - previous.y);
  return horizontalDistance <= horizontalLimit && verticalDistance <= verticalLimit;
}

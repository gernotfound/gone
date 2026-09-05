/**
 * G.O.N.E. P2P WebRTC DataChannel Protocol & Neon Color Definitions
 *
 * Implements WebRTC DataChannel signaling message schemas, color normalization,
 * HSV fluorescence verification, and protocol serialization utilities.
 */

// --- Cyberpunk Neon Preset Palette ---
export const NEON_PALETTE = [
  { name: 'Cyan Neon', hex: '#00F0FF' },
  { name: 'Neon Pink', hex: '#FF007F' },
  { name: 'Acid Green', hex: '#39FF14' },
  { name: 'Neon Yellow', hex: '#FFE600' },
  { name: 'Electric Purple', hex: '#BD00FF' },
  { name: 'Neon Orange', hex: '#FF5F00' },
  { name: 'Bright Red', hex: '#FF003C' },
  { name: 'Ice Blue', hex: '#00D4FF' },
] as const;

export const DEFAULT_NEON_HEX_LIST: readonly string[] = NEON_PALETTE.map((p) => p.hex);

// --- Rejection Reasons ---
export const COLOR_REJECT_REASONS = {
  COLOR_ALREADY_TAKEN: 'COLOR_ALREADY_TAKEN',
  INVALID_FLUO_COLOR: 'INVALID_FLUO_COLOR',
  INVALID_HEX_FORMAT: 'INVALID_HEX_FORMAT',
} as const;

export type ColorRejectReason = (typeof COLOR_REJECT_REASONS)[keyof typeof COLOR_REJECT_REASONS];

// --- Network Message Schemas ---
export interface JoinRequestMessage {
  type: 'JOIN_REQUEST';
  playerId: string;
  playerName: string;
  proposedColor: string;
}

export interface SessionPlayerInfo {
  id: string;
  name: string;
  color: string;
}

export interface JoinAcceptedMessage {
  type: 'JOIN_ACCEPTED';
  playerId: string;
  assignedColor: string;
  sessionPlayers: SessionPlayerInfo[];
}

export interface ColorRejectedMessage {
  type: 'COLOR_REJECTED';
  playerId: string;
  attemptedColor: string;
  reason: string;
  availableColors: string[];
}

export interface PlayerJoinedMessage {
  type: 'PLAYER_JOINED';
  player: SessionPlayerInfo;
}

export interface PlayerLeftMessage {
  type: 'PLAYER_LEFT';
  playerId: string;
  freedColor: string;
}

export interface FireHitscanMessage {
  type: 'FIRE_HITSCAN';
  shooterId: string;
  weaponType: number;
  origin: [number, number, number];
  direction: [number, number, number];
}

export interface HitConfirmedMessage {
  type: 'HIT_CONFIRMED';
  victimId: string;
  damage: number;
  newHp: number;
  isHeadshot: boolean;
}

export interface ColorChangeRequestMessage {
  type: 'COLOR_REQUEST';
  playerId: string;
  requestedColor: string;
}

export interface ColorChangedMessage {
  type: 'COLOR_CHANGED';
  playerId: string;
  newColor: string;
}

export interface ColorValidationResult {
  success: boolean;
  color?: string;
  error?: string;
  message?: string;
  availableColors?: string[];
}

export type NetMessage =
  | JoinRequestMessage
  | JoinAcceptedMessage
  | ColorRejectedMessage
  | PlayerJoinedMessage
  | PlayerLeftMessage
  | FireHitscanMessage
  | HitConfirmedMessage
  | ColorChangeRequestMessage
  | ColorChangedMessage;

// --- DataChannel Transport Abstraction ---
export interface IDataChannel {
  send(data: string): void;
  close?(): void;
  readyState?: string;
  onmessage?: ((ev: { data: any }) => void) | null;
  onclose?: (() => void) | null;
  onerror?: ((err: any) => void) | null;
}

// --- Color Normalization & HSV Fluorescence Validation ---

/**
 * Normalizes a hex color string to uppercase `#RRGGBB` format.
 * Accepts with or without leading '#', 3 or 6 hex digits.
 * Returns null if string is invalid.
 */
export function normalizeHexColor(colorStr: string): string | null {
  if (!colorStr || typeof colorStr !== 'string') return null;
  const trimmed = colorStr.trim().replace(/^#/, '');

  if (trimmed.length === 3) {
    if (!/^[0-9A-Fa-f]{3}$/.test(trimmed)) return null;
    const r = trimmed[0];
    const g = trimmed[1];
    const b = trimmed[2];
    return `#${r}${r}${g}${g}${b}${b}`.toUpperCase();
  }

  if (trimmed.length === 6) {
    if (!/^[0-9A-Fa-f]{6}$/.test(trimmed)) return null;
    return `#${trimmed.toUpperCase()}`;
  }

  return null;
}

/**
 * Parses normalized 6-digit hex into RGB integers [0, 255].
 */
export function hexToRgb(hex: string): [number, number, number] | null {
  const norm = normalizeHexColor(hex);
  if (!norm) return null;
  const num = parseInt(norm.slice(1), 16);
  const r = (num >> 16) & 255;
  const g = (num >> 8) & 255;
  const b = num & 255;
  return [r, g, b];
}

/**
 * Converts RGB [0, 255] to HSV values:
 * h: [0, 360], s: [0, 1], v: [0, 1]
 */
export function rgbToHsv(r: number, g: number, b: number): { h: number; s: number; v: number } {
  const rf = r / 255;
  const gf = g / 255;
  const bf = b / 255;

  const max = Math.max(rf, gf, bf);
  const min = Math.min(rf, gf, bf);
  const delta = max - min;

  let h = 0;
  if (delta > 1e-6) {
    if (max === rf) {
      h = 60 * (((gf - bf) / delta) % 6);
    } else if (max === gf) {
      h = 60 * ((bf - rf) / delta + 2);
    } else {
      h = 60 * ((rf - gf) / delta + 4);
    }
  }
  if (h < 0) h += 360;

  const s = max === 0 ? 0 : delta / max;
  const v = max;

  return { h, s, v };
}

/**
 * Verifies whether a color qualifies as a Cyberpunk fluorescent neon color:
 * Saturation >= 0.70 and Value/Brightness >= 0.70.
 * Rejects dull, black, white, pastel, or dark colors.
 */
export function isFluorescentColor(colorHex: string): boolean {
  const rgb = hexToRgb(colorHex);
  if (!rgb) return false;
  const { s, v } = rgbToHsv(rgb[0], rgb[1], rgb[2]);
  return s >= 0.70 && v >= 0.70;
}

// --- Message Serialization & Deserialization ---

export function serializeNetMessage(msg: NetMessage): string {
  return JSON.stringify(msg);
}

export function parseNetMessage(raw: unknown): NetMessage | null {
  try {
    const text = typeof raw === 'string' ? raw : (raw as any)?.toString?.();
    if (!text) return null;
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || !('type' in parsed)) {
      return null;
    }
    return parsed as NetMessage;
  } catch {
    return null;
  }
}

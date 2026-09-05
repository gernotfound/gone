// tests/helpers/color_registry_model.mjs
// Authoritative specification model for Cyberpunk Fluo Color Registry & Host Validation.

export const CYBERPUNK_PALETTE = [
  { hex: '#00F0FF', name: 'Neon Cyan' },
  { hex: '#FF007F', name: 'Neon Magenta' },
  { hex: '#39FF14', name: 'Electric Lime' },
  { hex: '#FFE600', name: 'Cyber Yellow' },
  { hex: '#FF6600', name: 'Neon Orange' },
  { hex: '#BC13FE', name: 'Toxic Violet' },
  { hex: '#FF073A', name: 'Neon Red' },
  { hex: '#0066FF', name: 'Electric Blue' },
];

/**
 * Normalizes a hex color string to uppercase #RRGGBB.
 */
export function normalizeHex(colorInput) {
  if (typeof colorInput !== 'string') {
    throw new Error('Color must be a string');
  }
  let s = colorInput.trim().toUpperCase();
  if (!s.startsWith('#')) {
    s = '#' + s;
  }
  // Expand 3-digit hex #RGB -> #RRGGBB
  if (/^#[0-9A-F]{3}$/.test(s)) {
    s = '#' + s[1] + s[1] + s[2] + s[2] + s[3] + s[3];
  }
  return s;
}

/**
 * Validates format against ^#[0-9A-F]{6}$
 */
export function isValidHexFormat(hex) {
  return /^#[0-9A-F]{6}$/.test(hex);
}

/**
 * Converts #RRGGBB to HSV [h (0-360), s (0-1), v (0-1)]
 */
export function hexToHsv(hex) {
  const norm = normalizeHex(hex);
  if (!isValidHexFormat(norm)) {
    throw new Error(`Invalid hex format: ${hex}`);
  }
  const r = parseInt(norm.slice(1, 3), 16) / 255;
  const g = parseInt(norm.slice(3, 5), 16) / 255;
  const b = parseInt(norm.slice(5, 7), 16) / 255;

  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const delta = max - min;

  const v = max;
  const s = max === 0 ? 0 : delta / max;

  let h = 0;
  if (delta !== 0) {
    if (max === r) {
      h = ((g - b) / delta) % 6;
    } else if (max === g) {
      h = (b - r) / delta + 2;
    } else {
      h = (r - g) / delta + 4;
    }
    h *= 60;
    if (h < 0) h += 360;
  }

  return { h, s, v };
}

export const MIN_FLUORESCENCE_SATURATION = 0.70;
export const MIN_FLUORESCENCE_VALUE = 0.70;

/**
 * Checks whether a color qualifies as fluorescent (Cyberpunk neon).
 * Requires Saturation >= 0.70 and Value >= 0.70.
 */
export function isFluorescent(hex) {
  try {
    const { s, v } = hexToHsv(hex);
    return s >= MIN_FLUORESCENCE_SATURATION && v >= MIN_FLUORESCENCE_VALUE;
  } catch {
    return false;
  }
}

/**
 * Session Color Registry simulation enforcing host-side uniqueness in Rust/P2P.
 */
export class SessionColorRegistry {
  constructor() {
    this.assigned = new Map(); // playerId -> normalizedHex
  }

  /**
   * Request a color for a player.
   * Returns { success: boolean, color?: string, error?: string, message?: string }
   */
  requestColor(playerId, colorInput) {
    if (!playerId || typeof playerId !== 'string') {
      return { success: false, error: 'INVALID_PLAYER_ID', message: 'Player ID must be non-empty' };
    }

    let normalized;
    try {
      normalized = normalizeHex(colorInput);
    } catch {
      return { success: false, error: 'INVALID_FORMAT', message: 'Malformed color hex string' };
    }

    if (!isValidHexFormat(normalized)) {
      return { success: false, error: 'INVALID_FORMAT', message: 'Must be 6-digit hex format #RRGGBB' };
    }

    if (!isFluorescent(normalized)) {
      return {
        success: false,
        error: 'NOT_FLUORESCENT',
        message: 'Color lacks sufficient saturation/brightness to qualify as fluo neon (S >= 0.70, V >= 0.70)',
      };
    }

    // Check if this player already has this color (idempotent request)
    if (this.assigned.get(playerId) === normalized) {
      return { success: true, color: normalized };
    }

    // Check uniqueness across other players
    for (const [otherId, otherColor] of this.assigned.entries()) {
      if (otherId !== playerId && otherColor === normalized) {
        return {
          success: false,
          error: 'COLOR_ALREADY_TAKEN',
          message: `Color ${normalized} is already assigned to another player in this session`,
        };
      }
    }

    // Assign color
    this.assigned.set(playerId, normalized);
    return { success: true, color: normalized };
  }

  /**
   * Free player's assigned color upon leaving session.
   */
  releasePlayer(playerId) {
    const freed = this.assigned.get(playerId) || null;
    this.assigned.delete(playerId);
    return freed;
  }

  /**
   * Check if a specific hex is available.
   */
  isColorAvailable(colorInput) {
    try {
      const norm = normalizeHex(colorInput);
      if (!isValidHexFormat(norm) || !isFluorescent(norm)) return false;
      for (const col of this.assigned.values()) {
        if (col === norm) return false;
      }
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Return list of curated palette colors that are currently unassigned.
   */
  getAvailablePalette() {
    return CYBERPUNK_PALETTE.map((p) => p.hex).filter((hex) => this.isColorAvailable(hex));
  }

  /**
   * Total assigned player count.
   */
  get activeCount() {
    return this.assigned.size;
  }
}

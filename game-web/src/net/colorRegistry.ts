/** Canonical host-side allocation of unique neon colors. Independent of networking and combat. */
import {
  COLOR_REJECT_REASONS,
  DEFAULT_NEON_HEX_LIST,
  isFluorescentColor,
  normalizeHexColor,
  type ColorValidationResult,
} from './protocol.ts';

// --- Color Registry Interfaces & Implementations ---

export interface IWasmColorRegistry {
  request_color(playerId: string, hex: string): string;
  release_player(playerId: string): void;
  is_color_available(hex: string): boolean;
  get_available_palette(): any[];
}

export interface IColorRegistry {
  requestColor(playerId: string, hex: string): ColorValidationResult;
  releasePlayer(playerId: string): string | null;
  isColorAvailable(hex: string): boolean;
  getAvailablePalette(): string[];
  getAssignedColor(playerId: string): string | undefined;
}

export class LocalColorRegistry implements IColorRegistry {
  private claimedColors = new Map<string, string>();
  private hexToPlayer = new Map<string, string>();
  private presetPalette: string[];

  constructor(presetPalette: readonly string[] = DEFAULT_NEON_HEX_LIST) {
    this.presetPalette = [...presetPalette];
  }

  requestColor(playerId: string, hex: string): ColorValidationResult {
    const norm = normalizeHexColor(hex);
    if (!norm) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.INVALID_HEX_FORMAT,
        message: `Formato hex non valido: "${hex}". Richiesto esadecimale a 6 cifre (es. #00F0FF).`,
        availableColors: this.getAvailablePalette(),
      };
    }

    if (!isFluorescentColor(norm)) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.INVALID_FLUO_COLOR,
        message: `Il colore ${norm} non soddisfa i criteri neon/fluorescenza (Saturazione >= 70% e Luminosità >= 70%).`,
        availableColors: this.getAvailablePalette(),
      };
    }

    const currentOwner = this.hexToPlayer.get(norm);
    if (currentOwner && currentOwner !== playerId) {
      return {
        success: false,
        error: COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        message: `COLORE GIÀ IN USO: Il colore neon ${norm} è già stato assegnato a un altro giocatore nella sessione.`,
        availableColors: this.getAvailablePalette(),
      };
    }

    const previous = this.claimedColors.get(playerId);
    if (previous && previous !== norm) this.hexToPlayer.delete(previous);

    this.claimedColors.set(playerId, norm);
    this.hexToPlayer.set(norm, playerId);
    return { success: true, color: norm };
  }

  releasePlayer(playerId: string): string | null {
    const color = this.claimedColors.get(playerId);
    if (color) {
      this.claimedColors.delete(playerId);
      this.hexToPlayer.delete(color);
      return color;
    }
    return null;
  }

  isColorAvailable(hex: string): boolean {
    const norm = normalizeHexColor(hex);
    if (!norm || !isFluorescentColor(norm)) return false;
    return !this.hexToPlayer.has(norm);
  }

  getAvailablePalette(): string[] {
    return this.presetPalette.filter((h) => !this.hexToPlayer.has(h));
  }

  getAssignedColor(playerId: string): string | undefined {
    return this.claimedColors.get(playerId);
  }
}

export class WasmColorRegistryAdapter implements IColorRegistry {
  private wasm: IWasmColorRegistry;
  private assigned = new Map<string, string>();

  constructor(wasmRegistry: IWasmColorRegistry) {
    this.wasm = wasmRegistry;
  }

  requestColor(playerId: string, hex: string): ColorValidationResult {
    try {
      const raw = this.wasm.request_color(playerId, hex);
      const parsed = JSON.parse(raw);
      if (parsed.success) {
        this.assigned.set(playerId, parsed.color);
        return { success: true, color: parsed.color };
      }
      return {
        success: false,
        error: parsed.error || COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
        message: parsed.message || 'Colore non disponibile.',
        availableColors: this.getAvailablePalette(),
      };
    } catch (e: any) {
      return {
        success: false,
        error: 'WASM_ERROR',
        message: e?.message || 'Errore WASM Color Registry',
        availableColors: this.getAvailablePalette(),
      };
    }
  }

  releasePlayer(playerId: string): string | null {
    const color = this.assigned.get(playerId) || null;
    this.wasm.release_player(playerId);
    this.assigned.delete(playerId);
    return color;
  }

  isColorAvailable(hex: string): boolean {
    return this.wasm.is_color_available(hex);
  }

  getAvailablePalette(): string[] {
    const pal = this.wasm.get_available_palette();
    return Array.isArray(pal) ? pal.map(String) : [];
  }

  getAssignedColor(playerId: string): string | undefined {
    return this.assigned.get(playerId);
  }
}

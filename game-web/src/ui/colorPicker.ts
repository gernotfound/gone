/**
 * G.O.N.E. Cyberpunk Neon Color Picker & Duplicate Error Banner UI
 *
 * Implements neon swatch palette selection, custom hex input with real-time
 * fluorescence checking (S>=70%, V>=70%), live preview glow, and prominent
 * duplicate rejection modal/banner with clickable alternative color chips.
 */

import {
  DEFAULT_NEON_HEX_LIST,
  NEON_PALETTE,
  isFluorescentColor,
  normalizeHexColor,
} from '../net/protocol.ts';

export interface ColorPickerOptions {
  initialColor?: string;
  onColorChange?: (color: string) => void;
  onColorSelected?: (color: string) => void;
  disabledColors?: string[];
}

export class CyberpunkColorPicker {
  private container: HTMLElement | null = null;
  private selectedColor: string;
  private disabledColors: Set<string>;
  private changeCallbacks: Array<(color: string) => void> = [];

  // DOM element references
  private swatchesContainer: HTMLElement | null = null;
  private hexInput: HTMLInputElement | null = null;
  private colorInputNative: HTMLInputElement | null = null;
  private fluoBadge: HTMLElement | null = null;
  private previewBox: HTMLElement | null = null;
  private previewHexText: HTMLElement | null = null;
  private errorBanner: HTMLElement | null = null;

  constructor(options?: ColorPickerOptions) {
    this.selectedColor = options?.initialColor || DEFAULT_NEON_HEX_LIST[0];
    this.disabledColors = new Set((options?.disabledColors || []).map((c) => c.toUpperCase()));
    if (options?.onColorChange) {
      this.changeCallbacks.push(options.onColorChange);
    }
    if (options?.onColorSelected) {
      this.changeCallbacks.push(options.onColorSelected);
    }
  }

  /**
   * Mounts the color picker UI into the specified parent DOM element.
   */
  public mount(target: HTMLElement | string): void {
    if (typeof document === 'undefined') return;

    const parent = typeof target === 'string' ? document.getElementById(target) : target;
    if (!parent) {
      console.warn(`CyberpunkColorPicker: Target element "${target}" not found.`);
      return;
    }

    this.container = document.createElement('div');
    this.container.className =
      'cyberpunk-color-picker flex flex-col gap-5 p-6 bg-slate-900/95 border border-purple-500/30 rounded-2xl shadow-[0_0_25px_rgba(189,0,255,0.2)] backdrop-blur-md text-white select-none w-full max-w-md';

    this.render();
    parent.appendChild(this.container);
  }

  /**
   * Returns the currently selected uppercase hex color (e.g. "#00F0FF").
   */
  public getSelectedColor(): string {
    return this.selectedColor;
  }

  /**
   * Sets current color programmatically and updates UI.
   */
  public setSelectedColor(hex: string): boolean {
    const norm = normalizeHexColor(hex);
    if (!norm) return false;

    this.selectedColor = norm;
    this.updatePreviewAndBadge();
    this.updateSwatchesState();
    this.emitChange(this.selectedColor);
    return true;
  }

  /**
   * Updates the set of colors disabled (e.g., claimed by other players in the session).
   */
  public setDisabledColors(colors: string[]): void {
    this.disabledColors = new Set(colors.map((c) => c.toUpperCase()));
    this.updateSwatchesState();
  }

  /**
   * Displays the prominent Cyberpunk rejection banner/modal when host denies color.
   */
  public showRejectionError(
    attemptedColor: string,
    reason: string,
    availableColors: string[] = []
  ): void {
    if (!this.errorBanner) return;

    const normAttempted = normalizeHexColor(attemptedColor) || attemptedColor;
    const isAlreadyTaken = reason === 'COLOR_ALREADY_TAKEN' || reason.includes('GIÀ IN USO');

    const title = isAlreadyTaken
      ? 'COLORE GIÀ IN USO / COLOR ALREADY TAKEN'
      : 'COLORE NON VALIDO / INVALID COLOR';

    const desc = isAlreadyTaken
      ? `Il colore neon <span class="font-mono text-white px-1.5 py-0.5 rounded bg-slate-950 border border-pink-500/60 font-bold" style="color:${normAttempted}">${normAttempted}</span> è già stato assegnato a un altro giocatore nella sessione.`
      : `Il colore <span class="font-mono text-white px-1.5 py-0.5 rounded bg-slate-950 font-bold">${normAttempted}</span> non è consentito (${reason}).`;

    let alternativesHtml = '';
    if (availableColors && availableColors.length > 0) {
      alternativesHtml = `
        <div class="mt-3 pt-3 border-t border-red-500/30">
          <div class="text-xs uppercase tracking-wider text-slate-300 font-bold mb-2">Colori fluo disponibili (clicca per scegliere):</div>
          <div class="flex flex-wrap gap-2" id="rejection-alternatives-list"></div>
        </div>
      `;
    }

    this.errorBanner.innerHTML = `
      <div class="flex items-start justify-between gap-3">
        <div class="flex items-center gap-2 text-pink-400 font-black text-sm uppercase tracking-wider">
          <span class="text-lg animate-pulse">⚠</span>
          <span>${title}</span>
        </div>
        <button id="btn-close-error-banner" class="text-slate-400 hover:text-white text-xs uppercase font-mono px-1.5 py-0.5 rounded hover:bg-slate-800 transition-colors">
          ✕
        </button>
      </div>
      <p class="text-xs text-slate-300 leading-relaxed mt-2">${desc}</p>
      ${alternativesHtml}
    `;

    // Render clickable chips for available colors
    if (availableColors && availableColors.length > 0) {
      const listElem = this.errorBanner.querySelector('#rejection-alternatives-list');
      if (listElem) {
        for (const altHex of availableColors) {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className =
            'px-2.5 py-1 text-xs font-mono font-bold rounded-lg border transition-all active:scale-95 flex items-center gap-1.5 bg-slate-950/80 hover:scale-105';
          chip.style.borderColor = altHex;
          chip.style.boxShadow = `0 0 8px ${altHex}40`;
          chip.innerHTML = `
            <span class="w-2 h-2 rounded-full" style="background-color: ${altHex}; box-shadow: 0 0 6px ${altHex}"></span>
            <span style="color: ${altHex}">${altHex}</span>
          `;
          chip.onclick = () => {
            this.setSelectedColor(altHex);
            this.hideError();
          };
          listElem.appendChild(chip);
        }
      }
    }

    const closeBtn = this.errorBanner.querySelector('#btn-close-error-banner');
    if (closeBtn) {
      closeBtn.addEventListener('click', () => this.hideError());
    }

    this.errorBanner.classList.remove('hidden');
  }

  /**
   * Hides the rejection error banner.
   */
  public hideError(): void {
    if (this.errorBanner) {
      this.errorBanner.classList.add('hidden');
      this.errorBanner.innerHTML = '';
    }
  }

  /**
   * Register a listener for color changes.
   */
  public onColorChange(callback: (color: string) => void): void {
    this.changeCallbacks.push(callback);
  }

  /**
   * Alias for onColorChange to support onColorSelected syntax.
   */
  public onColorSelected(callback: (color: string) => void): void {
    this.changeCallbacks.push(callback);
  }

  private emitChange(color: string): void {
    for (const cb of this.changeCallbacks) {
      try {
        cb(color);
      } catch (e) {
        console.error('Error in onColorChange callback:', e);
      }
    }
  }

  private render(): void {
    if (!this.container) return;

    // Header
    const header = document.createElement('div');
    header.className = 'flex items-center justify-between border-b border-slate-700/60 pb-3';
    header.innerHTML = `
      <div class="flex items-center gap-2">
        <div class="w-3 h-3 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(0,240,255,0.8)]"></div>
        <span class="text-sm font-black tracking-widest uppercase text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-pink-400 to-purple-400">
          Personalizzazione Fluo
        </span>
      </div>
      <span class="text-[10px] font-mono tracking-widest text-slate-400 uppercase">P2P Mesh Verified</span>
    `;
    this.container.appendChild(header);

    // Error banner slot (hidden by default)
    this.errorBanner = document.createElement('div');
    this.errorBanner.className =
      'hidden bg-pink-950/40 border-2 border-pink-500/80 p-4 rounded-xl shadow-[0_0_20px_rgba(255,0,127,0.3)] transition-all animate-in fade-in duration-300';
    this.container.appendChild(this.errorBanner);

    // Swatches section
    const swatchesSection = document.createElement('div');
    swatchesSection.className = 'flex flex-col gap-2';
    swatchesSection.innerHTML = `
      <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Palette Neon Ufficiale</label>
    `;

    this.swatchesContainer = document.createElement('div');
    this.swatchesContainer.className = 'grid grid-cols-4 gap-2.5';
    this.renderSwatches();
    swatchesSection.appendChild(this.swatchesContainer);
    this.container.appendChild(swatchesSection);

    // Custom Hex Input Section
    const customSection = document.createElement('div');
    customSection.className = 'flex flex-col gap-2 pt-2 border-t border-slate-800';
    customSection.innerHTML = `
      <div class="flex items-center justify-between">
        <label class="text-xs font-bold text-slate-400 uppercase tracking-wider">Colore Personalizzato (HEX)</label>
        <span id="fluo-badge" class="text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border"></span>
      </div>
    `;

    const inputRow = document.createElement('div');
    inputRow.className = 'flex items-center gap-3';

    // Native color picker trigger
    this.colorInputNative = document.createElement('input');
    this.colorInputNative.type = 'color';
    this.colorInputNative.value = this.selectedColor;
    this.colorInputNative.className =
      'w-10 h-10 rounded-xl bg-transparent cursor-pointer border border-slate-600 focus:outline-none';
    this.colorInputNative.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      this.handleHexInput(target.value);
    });

    // Hex text input
    this.hexInput = document.createElement('input');
    this.hexInput.type = 'text';
    this.hexInput.maxLength = 7;
    this.hexInput.value = this.selectedColor;
    this.hexInput.placeholder = '#00F0FF';
    this.hexInput.className =
      'flex-1 bg-slate-950 border border-slate-700/80 focus:border-cyan-400 rounded-xl px-4 py-2.5 font-mono text-sm uppercase tracking-wider text-white shadow-inner focus:outline-none focus:ring-1 focus:ring-cyan-400/50 transition-all';
    this.hexInput.addEventListener('input', (e: Event) => {
      const target = e.target as HTMLInputElement;
      this.handleHexInput(target.value);
    });

    inputRow.appendChild(this.colorInputNative);
    inputRow.appendChild(this.hexInput);
    customSection.appendChild(inputRow);
    this.container.appendChild(customSection);

    this.fluoBadge = customSection.querySelector('#fluo-badge');

    // Live robot accent preview card
    this.previewBox = document.createElement('div');
    this.previewBox.className =
      'mt-1 p-3.5 rounded-xl border flex items-center justify-between transition-all duration-300';
    this.previewBox.innerHTML = `
      <div class="flex items-center gap-3">
        <div id="preview-chip" class="w-8 h-8 rounded-lg shadow-lg border border-white/20 transition-all duration-300"></div>
        <div class="flex flex-col">
          <span class="text-[10px] uppercase font-bold text-slate-400 tracking-wider">Accento Modello Attivo</span>
          <span id="preview-hex-text" class="font-mono text-sm font-black tracking-widest text-white"></span>
        </div>
      </div>
      <div class="text-[11px] font-bold text-cyan-400 font-mono uppercase tracking-wider">PRONTO</div>
    `;
    this.container.appendChild(this.previewBox);

    this.previewHexText = this.previewBox.querySelector('#preview-hex-text');

    this.updatePreviewAndBadge();
  }

  private renderSwatches(): void {
    if (!this.swatchesContainer) return;
    this.swatchesContainer.innerHTML = '';

    for (const item of NEON_PALETTE) {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.dataset.hex = item.hex;
      btn.className =
        'swatch-btn relative flex flex-col items-center justify-center p-2 rounded-xl border transition-all active:scale-95 overflow-hidden group';

      const isTaken = this.disabledColors.has(item.hex.toUpperCase());
      const isSelected = this.selectedColor.toUpperCase() === item.hex.toUpperCase();

      this.styleSwatchButton(btn, item.hex, isSelected, isTaken);

      btn.innerHTML = `
        <span class="w-4 h-4 rounded-full mb-1 transition-transform group-hover:scale-125" style="background-color: ${item.hex}; box-shadow: 0 0 10px ${item.hex}"></span>
        <span class="text-[10px] font-mono font-bold tracking-tight text-slate-300 truncate w-full text-center">${item.name}</span>
        ${isTaken ? '<span class="absolute inset-0 bg-slate-950/80 flex items-center justify-center text-[9px] font-black text-pink-500 tracking-wider">OCCUPATO</span>' : ''}
      `;

      if (!isTaken) {
        btn.onclick = () => {
          this.setSelectedColor(item.hex);
          this.hideError();
        };
      }

      this.swatchesContainer.appendChild(btn);
    }
  }

  private styleSwatchButton(
    btn: HTMLButtonElement,
    hex: string,
    isSelected: boolean,
    isTaken: boolean
  ): void {
    if (isTaken) {
      btn.style.borderColor = 'rgba(239, 68, 68, 0.4)';
      btn.style.boxShadow = 'none';
      btn.style.opacity = '0.5';
      btn.style.cursor = 'not-allowed';
      return;
    }

    if (isSelected) {
      btn.style.borderColor = hex;
      btn.style.boxShadow = `0 0 15px ${hex}80, inset 0 0 8px ${hex}40`;
      btn.style.backgroundColor = `${hex}15`;
    } else {
      btn.style.borderColor = 'rgba(51, 65, 85, 0.6)';
      btn.style.boxShadow = 'none';
      btn.style.backgroundColor = 'rgba(15, 23, 42, 0.8)';
    }
  }

  private updateSwatchesState(): void {
    if (!this.swatchesContainer) return;
    const buttons = this.swatchesContainer.querySelectorAll<HTMLButtonElement>('.swatch-btn');
    for (const btn of buttons) {
      const hex = btn.dataset.hex;
      if (!hex) continue;
      const isTaken = this.disabledColors.has(hex.toUpperCase());
      const isSelected = this.selectedColor.toUpperCase() === hex.toUpperCase();
      this.styleSwatchButton(btn, hex, isSelected, isTaken);
    }
  }

  private handleHexInput(raw: string): void {
    const norm = normalizeHexColor(raw);
    if (!norm) {
      this.updateFluoBadge(false, 'FORMATO INVALIDO');
      return;
    }

    const isFluo = isFluorescentColor(norm);
    if (!isFluo) {
      this.updateFluoBadge(false, 'NON-FLUO / SCURO ✗');
      return;
    }

    this.updateFluoBadge(true, 'VIBRANT NEON ✓');
    this.selectedColor = norm;

    if (this.hexInput && this.hexInput.value !== norm) {
      this.hexInput.value = norm;
    }
    if (this.colorInputNative && this.colorInputNative.value !== norm) {
      this.colorInputNative.value = norm;
    }

    this.updatePreviewAndBadge();
    this.updateSwatchesState();
    this.emitChange(this.selectedColor);
  }

  private updatePreviewAndBadge(): void {
    if (this.hexInput) {
      this.hexInput.value = this.selectedColor;
    }
    if (this.colorInputNative) {
      this.colorInputNative.value = this.selectedColor;
    }
    if (this.previewHexText) {
      this.previewHexText.textContent = this.selectedColor;
    }

    if (this.previewBox) {
      this.previewBox.style.borderColor = `${this.selectedColor}60`;
      this.previewBox.style.boxShadow = `0 0 20px ${this.selectedColor}30`;
      const chip = this.previewBox.querySelector<HTMLElement>('#preview-chip');
      if (chip) {
        chip.style.backgroundColor = this.selectedColor;
        chip.style.boxShadow = `0 0 12px ${this.selectedColor}`;
      }
    }

    const isFluo = isFluorescentColor(this.selectedColor);
    this.updateFluoBadge(isFluo, isFluo ? 'VIBRANT NEON ✓' : 'NON-FLUO ✗');
  }

  private updateFluoBadge(isValid: boolean, text: string): void {
    if (!this.fluoBadge) return;
    this.fluoBadge.textContent = text;
    if (isValid) {
      this.fluoBadge.className =
        'text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border text-emerald-400 border-emerald-500/50 bg-emerald-950/40 shadow-[0_0_8px_rgba(16,185,129,0.3)]';
    } else {
      this.fluoBadge.className =
        'text-[10px] font-bold font-mono px-2 py-0.5 rounded-full border text-pink-400 border-pink-500/50 bg-pink-950/40 shadow-[0_0_8px_rgba(255,0,127,0.3)]';
    }
  }
}

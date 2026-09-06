/**
 * game-web/src/ui/healthHud.ts
 *
 * Cyberpunk Bottom-Left Health & Invulnerability Shield HUD Controller
 *
 * Features:
 * - 100 Base HP bar with smooth percentage transitions and glowing neon colors.
 * - Dynamic health color gradient: Emerald-500 to Cyan-400 (>30% HP), pulsing Red-600/Rose-500 (<=30% HP).
 * - Numeric HP readout ("100 HP").
 * - Neon Cyan (#00F0FF) Shield Badge with animated icon and active 10s countdown.
 * - Death overlay with crimson background blur, "SEI STATO ELIMINATO", and 5-second countdown.
 * - Graceful headless/DOM fallback for automated testing environments.
 */

export interface HealthHudElements {
  container?: HTMLElement | null;
  hpVal?: HTMLElement | null;
  hpBar?: HTMLElement | null;
  shieldBadge?: HTMLElement | null;
  shieldTimer?: HTMLElement | null;
  deathOverlay?: HTMLElement | null;
  deathCountdown?: HTMLElement | null;
}

export class HealthHUDController {
  private hpValEl: HTMLElement | null = null;
  private hpBarEl: HTMLElement | null = null;
  private shieldBadgeEl: HTMLElement | null = null;
  private shieldTimerEl: HTMLElement | null = null;
  private deathOverlayEl: HTMLElement | null = null;
  private deathCountdownEl: HTMLElement | null = null;

  public currentHp: number = 100;
  public maxHp: number = 100;
  public isShieldActive: boolean = false;
  public shieldRemainingSeconds: number = 0;
  public isDeathOverlayVisible: boolean = false;
  public deathCountdownSeconds: number = 0;

  constructor(elements?: HealthHudElements) {
    if (elements) {
      this.bindElements(elements);
    }
  }

  public bindElements(elements: HealthHudElements): void {
    if (elements.hpVal !== undefined) this.hpValEl = elements.hpVal;
    if (elements.hpBar !== undefined) this.hpBarEl = elements.hpBar;
    if (elements.shieldBadge !== undefined) this.shieldBadgeEl = elements.shieldBadge;
    if (elements.shieldTimer !== undefined) this.shieldTimerEl = elements.shieldTimer;
    if (elements.deathOverlay !== undefined) this.deathOverlayEl = elements.deathOverlay;
    if (elements.deathCountdown !== undefined) this.deathCountdownEl = elements.deathCountdown;
  }

  public init(): void {
    if (typeof document === 'undefined') return;

    this.hpValEl = document.getElementById('hud-hp-val');
    this.hpBarEl = document.getElementById('hud-hp-bar');
    this.shieldBadgeEl = document.getElementById('hud-shield-badge');
    this.shieldTimerEl = document.getElementById('hud-shield-timer');
    this.deathOverlayEl = document.getElementById('death-overlay');
    this.deathCountdownEl = document.getElementById('death-countdown');

    this.updateHealth(this.currentHp, this.maxHp);
    this.updateShield(0);
    this.hideDeathOverlay();
  }

  /**
   * Updates health bar fill percentage, numeric HP readout, and critical pulse styling.
   */
  public updateHealth(hp: number, maxHp: number = 100): void {
    this.maxHp = Math.max(1, maxHp);
    this.currentHp = Math.max(0, Math.min(this.maxHp, hp));
    const pct = Math.max(0, Math.min(100, (this.currentHp / this.maxHp) * 100));

    if (this.hpValEl) {
      this.hpValEl.textContent = `${Math.ceil(this.currentHp)} HP`;
      if (this.currentHp <= 30) {
        this.hpValEl.className =
          'text-rose-500 font-black text-base drop-shadow-[0_0_8px_rgba(244,63,94,0.8)] animate-pulse';
      } else {
        this.hpValEl.className =
          'text-emerald-400 font-black text-base drop-shadow-[0_0_6px_rgba(16,185,129,0.6)]';
      }
    }

    if (this.hpBarEl) {
      this.hpBarEl.style.width = `${pct}%`;
      if (this.currentHp <= 30) {
        this.hpBarEl.className =
          'h-full rounded-full transition-all duration-200 bg-gradient-to-r from-red-600 via-rose-500 to-orange-500 shadow-[0_0_12px_rgba(239,68,68,0.8)]';
      } else {
        this.hpBarEl.className =
          'h-full rounded-full transition-all duration-200 bg-gradient-to-r from-emerald-500 via-teal-400 to-cyan-400 shadow-[0_0_10px_rgba(16,185,129,0.6)]';
      }
    }
  }

  /**
   * Shows or hides the 10-second neon cyan invulnerability shield badge above the health bar.
   */
  public updateShield(remainingSeconds: number): void {
    this.shieldRemainingSeconds = Math.max(0, remainingSeconds);
    this.isShieldActive = this.shieldRemainingSeconds > 0;

    if (!this.shieldBadgeEl) return;

    if (this.isShieldActive) {
      this.shieldBadgeEl.classList.remove('hidden');
      this.shieldBadgeEl.classList.add('flex');
      if (this.shieldTimerEl) {
        this.shieldTimerEl.textContent = `${this.shieldRemainingSeconds.toFixed(1)}s`;
      }
    } else {
      this.shieldBadgeEl.classList.add('hidden');
      this.shieldBadgeEl.classList.remove('flex');
    }
  }

  /**
   * Shows the 5-second death overlay with active countdown timer.
   */
  public showDeathOverlay(countdownSeconds: number): void {
    this.isDeathOverlayVisible = true;
    this.deathCountdownSeconds = Math.max(0, countdownSeconds);

    if (this.deathOverlayEl) {
      this.deathOverlayEl.classList.remove('hidden');
      this.deathOverlayEl.classList.add('flex');
    }
    if (this.deathCountdownEl) {
      this.deathCountdownEl.textContent = `${this.deathCountdownSeconds.toFixed(1)}`;
    }
  }

  /**
   * Updates only the countdown numeric display during death phase.
   */
  public updateDeathCountdown(countdownSeconds: number): void {
    this.deathCountdownSeconds = Math.max(0, countdownSeconds);
    if (this.deathCountdownEl) {
      this.deathCountdownEl.textContent = `${this.deathCountdownSeconds.toFixed(1)}`;
    }
  }

  /**
   * Hides the death overlay on respawn.
   */
  public hideDeathOverlay(): void {
    this.isDeathOverlayVisible = false;
    this.deathCountdownSeconds = 0;

    if (this.deathOverlayEl) {
      this.deathOverlayEl.classList.add('hidden');
      this.deathOverlayEl.classList.remove('flex');
    }
  }

  /**
   * Resets the HUD to full health, inactive shield, and hidden death overlay.
   */
  public reset(): void {
    this.updateHealth(100, 100);
    this.updateShield(0);
    this.hideDeathOverlay();
  }
}

export const healthHud = new HealthHUDController();

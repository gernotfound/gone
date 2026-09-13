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
 * - Damage feedback vignette on HP loss.
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
  private damageVignetteEl: HTMLDivElement | null = null;
  private damageFlashSerial = 0;

  public currentHp: number = 100;
  public maxHp: number = 100;
  public isShieldActive: boolean = false;
  public shieldRemainingSeconds: number = 0;
  public isDeathOverlayVisible: boolean = false;
  public deathCountdownSeconds: number = 0;

  constructor(elements?: HealthHudElements) {
    if (elements) this.bindElements(elements);
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
    this.ensureDamageVignette();

    this.updateHealth(this.currentHp, this.maxHp);
    this.updateShield(0);
    this.hideDeathOverlay();
  }

  private ensureDamageVignette(): void {
    if (typeof document === 'undefined' || !document.body) return;
    const existing = document.getElementById('damage-vignette');
    if (typeof HTMLDivElement !== 'undefined' && existing instanceof HTMLDivElement) {
      this.damageVignetteEl = existing;
      return;
    }

    const overlay = document.createElement('div');
    overlay.id = 'damage-vignette';
    overlay.setAttribute('aria-hidden', 'true');
    Object.assign(overlay.style, {
      position: 'fixed',
      inset: '0',
      zIndex: '45',
      pointerEvents: 'none',
      opacity: '0',
      transform: 'scale(1)',
      background: 'radial-gradient(circle at center, rgba(255,255,255,0) 28%, rgba(239,68,68,0.05) 48%, rgba(220,38,38,0.32) 73%, rgba(69,10,10,0.84) 100%)',
      boxShadow: 'inset 0 0 110px rgba(239,68,68,0.72)',
      mixBlendMode: 'screen',
      willChange: 'opacity, transform',
    });
    document.body.appendChild(overlay);
    this.damageVignetteEl = overlay;
  }

  private clearDeathRecap(): void {
    if (typeof document === 'undefined') return;
    document.getElementById('gone-death-recap')?.classList.remove('show');
    const killer = document.getElementById('gone-death-recap-killer');
    const detail = document.getElementById('gone-death-recap-detail');
    if (killer) killer.textContent = '';
    if (detail) detail.textContent = '';
  }

  /** Brief red edge flash when authoritative HP drops. */
  public showDamageFeedback(damage: number): void {
    if (!this.damageVignetteEl) this.ensureDamageVignette();
    const overlay = this.damageVignetteEl;
    if (!overlay) return;

    const serial = ++this.damageFlashSerial;
    const normalized = Math.max(0, Math.min(1, damage / Math.max(1, this.maxHp)));
    const peakOpacity = Math.min(0.9, 0.36 + normalized * 1.4);
    const peakScale = 1 + Math.min(0.018, normalized * 0.035);

    overlay.style.transition = 'none';
    overlay.style.opacity = String(peakOpacity);
    overlay.style.transform = `scale(${peakScale})`;

    const fade = () => {
      if (serial !== this.damageFlashSerial) return;
      overlay.style.transition = 'opacity 320ms cubic-bezier(.15,.7,.2,1), transform 320ms ease-out';
      overlay.style.opacity = '0';
      overlay.style.transform = 'scale(1)';
    };

    if (typeof requestAnimationFrame === 'function') requestAnimationFrame(fade);
    else fade();
  }

  /**
   * Updates health bar fill percentage, numeric HP readout, and critical pulse styling.
   */
  public updateHealth(hp: number, maxHp: number = 100): void {
    const previousHp = this.currentHp;
    this.maxHp = Math.max(1, maxHp);
    this.currentHp = Math.max(0, Math.min(this.maxHp, hp));
    const pct = Math.max(0, Math.min(100, (this.currentHp / this.maxHp) * 100));

    if (this.currentHp < previousHp && previousHp > 0) {
      this.showDamageFeedback(previousHp - this.currentHp);
    }

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

  /** Shows or hides the neon cyan invulnerability shield badge. */
  public updateShield(remainingSeconds: number): void {
    this.shieldRemainingSeconds = Math.max(0, remainingSeconds);
    this.isShieldActive = this.shieldRemainingSeconds > 0;

    if (!this.shieldBadgeEl) return;

    if (this.isShieldActive) {
      this.shieldBadgeEl.classList.remove('hidden');
      this.shieldBadgeEl.classList.add('flex');
      if (this.shieldTimerEl) {
        const nextText = `${this.shieldRemainingSeconds.toFixed(1)}s`;
        if (this.shieldTimerEl.textContent !== nextText) this.shieldTimerEl.textContent = nextText;
      }
    } else {
      this.shieldBadgeEl.classList.add('hidden');
      this.shieldBadgeEl.classList.remove('flex');
    }
  }

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

  public updateDeathCountdown(countdownSeconds: number): void {
    this.deathCountdownSeconds = Math.max(0, countdownSeconds);
    if (this.deathCountdownEl) {
      this.deathCountdownEl.textContent = `${this.deathCountdownSeconds.toFixed(1)}`;
    }
  }

  public hideDeathOverlay(): void {
    this.isDeathOverlayVisible = false;
    this.deathCountdownSeconds = 0;
    this.clearDeathRecap();

    if (this.deathOverlayEl) {
      this.deathOverlayEl.classList.add('hidden');
      this.deathOverlayEl.classList.remove('flex');
    }
  }

  public reset(): void {
    this.updateHealth(100, 100);
    this.updateShield(0);
    this.hideDeathOverlay();
  }
}

export const healthHud = new HealthHUDController();

/**
 * Procedural Web Audio SFX Synthesizer for G.O.N.E.
 * Milestone 2 (F-6, F-7): Pure Web Audio API synthesis with zero external audio assets.
 * 
 * Weapon Audio Profiles:
 * - assalto (AR-42 Viper): Sawtooth pitch drop 920Hz -> 140Hz in 0.11s + 2200Hz bandpass noise punch.
 * - cecchino (SR-99 Railphantom): Resonant 2800Hz -> 80Hz rail screech (Q=5) + 160Hz -> 32Hz sub-bass + 1400Hz noise.
 * - pompa (SG-12 Havoc): Dual detuned square/saw 360Hz -> 55Hz + 850Hz noise blast + 95Hz -> 40Hz sub punch.
 * - mitraglietta (SMG-7 Neon Hornet): 1350Hz -> 350Hz triangle + micro transient click (10 RPS spam safe).
 * - coltello (CB-01 Shadowfang): 550Hz -> 220Hz sine wave + swept 350Hz -> 1400Hz -> 300Hz bandpass whoosh.
 */

export interface AudioSynthesizer {
  unlock(): Promise<void>;
  playWeaponSound(weaponType: string, volumeScale?: number): void;
}

export type WeaponSoundType = 'assalto' | 'cecchino' | 'pompa' | 'mitraglietta' | 'coltello';

/** Normalizes arbitrary weapon strings or IDs to valid WeaponSoundType */
export function normalizeWeaponType(weapon: string | number): WeaponSoundType {
  if (typeof weapon === 'number') {
    const table: WeaponSoundType[] = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    return table[weapon] ?? 'assalto';
  }
  const clean = String(weapon).toLowerCase().trim();
  if (clean === 'cecchino' || clean === 'sr99' || clean === 'sr-99' || clean === 'sniper') return 'cecchino';
  if (clean === 'pompa' || clean === 'sg12' || clean === 'sg-12' || clean === 'shotgun') return 'pompa';
  if (clean === 'mitraglietta' || clean === 'smg7' || clean === 'smg-7' || clean === 'smg') return 'mitraglietta';
  if (clean === 'coltello' || clean === 'cb01' || clean === 'cb-01' || clean === 'knife' || clean === 'melee') return 'coltello';
  return 'assalto';
}

interface ActiveVoice {
  stop(): void;
}

export class SoundSynthesizer implements AudioSynthesizer {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private sharedNoiseBuffer: AudioBuffer | null = null;
  private isAutoUnlockRegistered = false;
  private autoUnlockHandlers: (() => void)[] = [];
  private activeVoices = new Set<ActiveVoice>();
  private readonly MAX_CONCURRENT_VOICES = 32;

  private masterVolume = 1.0;
  private sfxVolume = 1.0;

  constructor() {
    this.registerAutoUnlockListeners();
  }

  /**
   * Automatically registers DOM interaction listeners to unlock AudioContext
   * upon first user gesture (pointerdown, keydown, click).
   */
  private registerAutoUnlockListeners(): void {
    if (typeof window === 'undefined' || typeof document === 'undefined' || this.isAutoUnlockRegistered) {
      return;
    }
    this.isAutoUnlockRegistered = true;

    const onUserGesture = () => {
      this.unlock().catch(() => {});
      if (this.ctx && this.ctx.state === 'running') {
        this.removeAutoUnlockListeners();
      }
    };

    const events = ['pointerdown', 'keydown', 'click', 'touchstart'];
    for (const eventName of events) {
      window.addEventListener(eventName, onUserGesture, { once: false, passive: true });
    }

    this.autoUnlockHandlers.push(() => {
      for (const eventName of events) {
        window.removeEventListener(eventName, onUserGesture);
      }
    });
  }

  private removeAutoUnlockListeners(): void {
    for (const handler of this.autoUnlockHandlers) {
      try {
        handler();
      } catch {
        // Ignore
      }
    }
    this.autoUnlockHandlers = [];
    this.isAutoUnlockRegistered = false;
  }

  /**
   * Initializes or resumes the Web Audio API context.
   * Required by browser autoplay policies.
   */
  public async unlock(): Promise<void> {
    try {
      if (!this.ctx) {
        const AudioContextClass =
          (typeof window !== 'undefined' &&
            (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)) ||
          (typeof globalThis !== 'undefined' &&
            (globalThis as unknown as { AudioContext: typeof AudioContext }).AudioContext);

        if (!AudioContextClass) {
          return;
        }

        this.ctx = new AudioContextClass();
        this.setupMasterGraph();
        this.buildSharedNoiseBuffer();
      }

      if (this.ctx && this.ctx.state === 'suspended') {
        await this.ctx.resume();
      }

      if (this.ctx && this.ctx.state === 'running') {
        this.removeAutoUnlockListeners();
      }
    } catch {
      // Audio unlock failures in restricted environments should never crash the game
    }
  }

  /** Alias for unlock() */
  public async init(): Promise<void> {
    return this.unlock();
  }

  /**
   * Creates the master gain and dynamic compressor output graph.
   * Dynamics compressor prevents clipping and acoustic distortion during rapid firing.
   */
  private setupMasterGraph(): void {
    if (!this.ctx) return;

    this.masterGain = this.ctx.createGain();
    this.masterGain.gain.setValueAtTime(this.masterVolume * this.sfxVolume, this.ctx.currentTime);

    this.compressor = this.ctx.createDynamicsCompressor();
    this.compressor.threshold.setValueAtTime(-6, this.ctx.currentTime);
    this.compressor.knee.setValueAtTime(12, this.ctx.currentTime);
    this.compressor.ratio.setValueAtTime(8, this.ctx.currentTime);
    this.compressor.attack.setValueAtTime(0.003, this.ctx.currentTime);
    this.compressor.release.setValueAtTime(0.15, this.ctx.currentTime);

    this.masterGain.connect(this.compressor);
    this.compressor.connect(this.ctx.destination);
  }

  /**
   * Pre-computes a 1.0s shared white noise buffer in AudioContext for transient punch layers.
   * Avoids real-time buffer allocations during rapid firing.
   */
  private buildSharedNoiseBuffer(): void {
    if (!this.ctx) return;
    const sampleRate = this.ctx.sampleRate || 44100;
    const bufferLength = Math.floor(sampleRate * 1.0); // 1.0s
    this.sharedNoiseBuffer = this.ctx.createBuffer(1, bufferLength, sampleRate);
    const channelData = this.sharedNoiseBuffer.getChannelData(0);
    for (let i = 0; i < bufferLength; i++) {
      // Uniform white noise in [-1.0, 1.0]
      channelData[i] = Math.random() * 2.0 - 1.0;
    }
  }

  public setMasterVolume(vol: number): void {
    this.masterVolume = Math.max(0, Math.min(1.0, vol));
    this.updateMasterGain();
  }

  public setSfxVolume(vol: number): void {
    this.sfxVolume = Math.max(0, Math.min(1.0, vol));
    this.updateMasterGain();
  }

  private updateMasterGain(): void {
    if (this.ctx && this.masterGain) {
      const now = this.ctx.currentTime;
      this.masterGain.gain.cancelScheduledValues(now);
      this.masterGain.gain.setValueAtTime(this.masterVolume * this.sfxVolume, now);
    }
  }

  public getAudioContext(): AudioContext | null {
    return this.ctx;
  }

  public isUnlocked(): boolean {
    return !!this.ctx && this.ctx.state === 'running';
  }

  /** Alias for playWeaponSound */
  public playShot(weaponType: string | number, volumeScale = 1.0): void {
    this.playWeaponSound(typeof weaponType === 'number' ? normalizeWeaponType(weaponType) : weaponType, volumeScale);
  }

  /**
   * Synthesizes and plays the authentic procedural laser sound for the specified weapon.
   * All audio nodes are disconnected and dereferenced on playback completion.
   */
  public playWeaponSound(weaponType: string, volumeScale = 1.0): void {
    try {
      if (!this.ctx) {
        // Attempt lazy creation
        void this.unlock();
        if (!this.ctx) return;
      }

      if (this.ctx.state === 'suspended') {
        void this.ctx.resume();
      }

      const effectiveVolume = Math.max(0, Math.min(2.0, volumeScale)) * this.masterVolume * this.sfxVolume;
      if (effectiveVolume <= 0.0001) {
        return;
      }

      // Voice limit budgeting: trim oldest active voice if over limit
      if (this.activeVoices.size >= this.MAX_CONCURRENT_VOICES) {
        const oldestVoice = this.activeVoices.values().next().value;
        if (oldestVoice) {
          oldestVoice.stop();
        }
      }

      const type = normalizeWeaponType(weaponType);
      switch (type) {
        case 'assalto':
          this.synthesizeAssalto(effectiveVolume);
          break;
        case 'cecchino':
          this.synthesizeCecchino(effectiveVolume);
          break;
        case 'pompa':
          this.synthesizePompa(effectiveVolume);
          break;
        case 'mitraglietta':
          this.synthesizeMitraglietta(effectiveVolume);
          break;
        case 'coltello':
          this.synthesizeColtello(effectiveVolume);
          break;
      }
    } catch {
      // Safe exception trap: audio glitches must never break the main game loop
    }
  }

  /**
   * Helper to manage ephemeral audio node lifecycle and prevent memory leaks.
   * Disconnects nodes from the audio graph upon source node completion.
   */
  private createVoiceTracker(
    primarySource: AudioScheduledSourceNode,
    nodesToDisconnect: AudioNode[],
    durationSeconds: number
  ): ActiveVoice {
    let cleanedUp = false;

    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      this.activeVoices.delete(voice);
      for (const node of nodesToDisconnect) {
        try {
          node.disconnect();
        } catch {
          // Ignore if already disconnected
        }
      }
    };

    const voice: ActiveVoice = {
      stop: () => {
        try {
          primarySource.stop();
        } catch {
          // Ignore
        }
        cleanup();
      },
    };

    primarySource.onended = cleanup;
    this.activeVoices.add(voice);

    // Fallback timer in case onended is dropped or in mocked environments
    if (typeof setTimeout !== 'undefined') {
      setTimeout(cleanup, Math.ceil((durationSeconds + 0.1) * 1000));
    }

    return voice;
  }

  /**
   * AR-42 Viper (Assalto):
   * Sawtooth pitch drop 920Hz -> 140Hz in 0.11s, bandpass noise at 2200Hz, crisp punchy laser rifle.
   */
  private synthesizeAssalto(vol: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const duration = 0.12;
    const nodes: AudioNode[] = [];

    // Voice routing node
    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(vol, now);
    voiceGain.connect(master);
    nodes.push(voiceGain);

    // Layer 1: Tonal body laser sweep (Sawtooth 920Hz -> 140Hz)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();
    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(920, now);
    osc.frequency.exponentialRampToValueAtTime(140, now + 0.11);

    oscGain.gain.setValueAtTime(0.65, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(oscGain);
    oscGain.connect(voiceGain);
    nodes.push(osc, oscGain);

    // Layer 2: Transient mechanical / plasma punch (Bandpass noise @ 2200Hz, Q=2.5)
    let noiseSource: AudioBufferSourceNode | null = null;
    if (this.sharedNoiseBuffer) {
      noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.sharedNoiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(2200, now);
      filter.Q.setValueAtTime(2.5, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.45, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.035);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(voiceGain);
      nodes.push(noiseSource, filter, noiseGain);

      const offset = Math.random() * 0.5;
      noiseSource.start(now, offset);
      noiseSource.stop(now + 0.035);
    }

    osc.start(now);
    osc.stop(now + duration);

    this.createVoiceTracker(osc, nodes, duration);
  }

  /**
   * SR-99 Railphantom (Cecchino):
   * Sawtooth rail screech 2800Hz -> 80Hz (Q=5), sub-bass thump 160Hz -> 32Hz, 1400Hz noise punch, 0.45s tail.
   */
  private synthesizeCecchino(vol: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const duration = 0.45;
    const nodes: AudioNode[] = [];

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(vol, now);
    voiceGain.connect(master);
    nodes.push(voiceGain);

    // Layer 1: Rail screech (Sawtooth 2800Hz -> 80Hz through high resonance filter Q=5)
    const screechOsc = ctx.createOscillator();
    const screechFilter = ctx.createBiquadFilter();
    const screechGain = ctx.createGain();

    screechOsc.type = 'sawtooth';
    screechOsc.frequency.setValueAtTime(2800, now);
    screechOsc.frequency.exponentialRampToValueAtTime(80, now + 0.35);

    screechFilter.type = 'bandpass';
    screechFilter.frequency.setValueAtTime(2800, now);
    screechFilter.frequency.exponentialRampToValueAtTime(80, now + 0.35);
    screechFilter.Q.setValueAtTime(5.0, now);

    screechGain.gain.setValueAtTime(0.7, now);
    screechGain.gain.exponentialRampToValueAtTime(0.001, now + 0.45);

    screechOsc.connect(screechFilter);
    screechFilter.connect(screechGain);
    screechGain.connect(voiceGain);
    nodes.push(screechOsc, screechFilter, screechGain);

    // Layer 2: Sub-bass thump (Sine 160Hz -> 32Hz)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(160, now);
    subOsc.frequency.exponentialRampToValueAtTime(32, now + 0.40);

    subGain.gain.setValueAtTime(0.85, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.40);

    subOsc.connect(subGain);
    subGain.connect(voiceGain);
    nodes.push(subOsc, subGain);

    // Layer 3: Noise punch (Lowpass noise at 1400Hz, 0.15s)
    if (this.sharedNoiseBuffer) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.sharedNoiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(1400, now);
      noiseFilter.Q.setValueAtTime(1.5, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.55, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.15);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(voiceGain);
      nodes.push(noiseSource, noiseFilter, noiseGain);

      const offset = Math.random() * 0.5;
      noiseSource.start(now, offset);
      noiseSource.stop(now + 0.15);
    }

    screechOsc.start(now);
    screechOsc.stop(now + duration);
    subOsc.start(now);
    subOsc.stop(now + 0.40);

    this.createVoiceTracker(screechOsc, nodes, duration);
  }

  /**
   * SG-12 Havoc (Pompa):
   * Dual detuned square/saw oscillators 360Hz -> 55Hz, 850Hz noise blast, sub punch, wide plasma burst (0.24s).
   */
  private synthesizePompa(vol: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const duration = 0.24;
    const nodes: AudioNode[] = [];

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(vol, now);
    voiceGain.connect(master);
    nodes.push(voiceGain);

    // Layer 1: Dual detuned oscillators (Square 360Hz -> 55Hz + Saw 280Hz -> 45Hz)
    const squareOsc = ctx.createOscillator();
    const sawOsc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    squareOsc.type = 'square';
    squareOsc.frequency.setValueAtTime(360, now);
    squareOsc.frequency.exponentialRampToValueAtTime(55, now + 0.16);

    sawOsc.type = 'sawtooth';
    sawOsc.frequency.setValueAtTime(280, now);
    sawOsc.frequency.exponentialRampToValueAtTime(45, now + 0.16);

    oscGain.gain.setValueAtTime(0.45, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);

    squareOsc.connect(oscGain);
    sawOsc.connect(oscGain);
    oscGain.connect(voiceGain);
    nodes.push(squareOsc, sawOsc, oscGain);

    // Layer 2: Sub-bass punch (Sine 95Hz -> 40Hz)
    const subOsc = ctx.createOscillator();
    const subGain = ctx.createGain();

    subOsc.type = 'sine';
    subOsc.frequency.setValueAtTime(95, now);
    subOsc.frequency.exponentialRampToValueAtTime(40, now + 0.20);

    subGain.gain.setValueAtTime(0.55, now);
    subGain.gain.exponentialRampToValueAtTime(0.001, now + 0.20);

    subOsc.connect(subGain);
    subGain.connect(voiceGain);
    nodes.push(subOsc, subGain);

    // Layer 3: Noise blast (Lowpass noise at 850Hz, 0.14s)
    if (this.sharedNoiseBuffer) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.sharedNoiseBuffer;

      const noiseFilter = ctx.createBiquadFilter();
      noiseFilter.type = 'lowpass';
      noiseFilter.frequency.setValueAtTime(850, now);
      noiseFilter.Q.setValueAtTime(2.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.65, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      noiseSource.connect(noiseFilter);
      noiseFilter.connect(noiseGain);
      noiseGain.connect(voiceGain);
      nodes.push(noiseSource, noiseFilter, noiseGain);

      const offset = Math.random() * 0.5;
      noiseSource.start(now, offset);
      noiseSource.stop(now + 0.14);
    }

    squareOsc.start(now);
    squareOsc.stop(now + 0.22);
    sawOsc.start(now);
    sawOsc.stop(now + 0.22);
    subOsc.start(now);
    subOsc.stop(now + 0.20);

    this.createVoiceTracker(squareOsc, nodes, duration);
  }

  /**
   * SMG-7 Neon Hornet (Mitraglietta):
   * Triangle/sawtooth 1350Hz -> 350Hz in 0.05s, micro transient click, clean 10 RPS playback without clipping.
   */
  private synthesizeMitraglietta(vol: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const duration = 0.06;
    const nodes: AudioNode[] = [];

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(vol, now);
    voiceGain.connect(master);
    nodes.push(voiceGain);

    // Layer 1: High frequency laser tone (Triangle 1350Hz -> 350Hz in 0.05s)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = 'triangle';
    osc.frequency.setValueAtTime(1350, now);
    osc.frequency.exponentialRampToValueAtTime(350, now + 0.05);

    oscGain.gain.setValueAtTime(0.5, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.06);

    osc.connect(oscGain);
    oscGain.connect(voiceGain);
    nodes.push(osc, oscGain);

    // Layer 2: Micro transient click (0.015s bandpass burst at 3200Hz)
    if (this.sharedNoiseBuffer) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.sharedNoiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.frequency.setValueAtTime(3200, now);
      filter.Q.setValueAtTime(3.0, now);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.35, now);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.015);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(voiceGain);
      nodes.push(noiseSource, filter, noiseGain);

      const offset = Math.random() * 0.5;
      noiseSource.start(now, offset);
      noiseSource.stop(now + 0.015);
    }

    osc.start(now);
    osc.stop(now + duration);

    this.createVoiceTracker(osc, nodes, duration);
  }

  /**
   * CB-01 Shadowfang (Coltello):
   * Sine wave 550Hz -> 220Hz, swept bandpass noise 350Hz -> 1400Hz -> 300Hz (blade whoosh).
   */
  private synthesizeColtello(vol: number): void {
    const ctx = this.ctx;
    const master = this.masterGain;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const duration = 0.14;
    const nodes: AudioNode[] = [];

    const voiceGain = ctx.createGain();
    voiceGain.gain.setValueAtTime(vol, now);
    voiceGain.connect(master);
    nodes.push(voiceGain);

    // Layer 1: Blade slash tone (Sine 550Hz -> 220Hz in 0.10s)
    const osc = ctx.createOscillator();
    const oscGain = ctx.createGain();

    osc.type = 'sine';
    osc.frequency.setValueAtTime(550, now);
    osc.frequency.exponentialRampToValueAtTime(220, now + 0.10);

    oscGain.gain.setValueAtTime(0.35, now);
    oscGain.gain.exponentialRampToValueAtTime(0.001, now + 0.12);

    osc.connect(oscGain);
    oscGain.connect(voiceGain);
    nodes.push(osc, oscGain);

    // Layer 2: Swept bandpass blade whoosh (350Hz -> 1400Hz -> 300Hz in 0.12s)
    if (this.sharedNoiseBuffer) {
      const noiseSource = ctx.createBufferSource();
      noiseSource.buffer = this.sharedNoiseBuffer;

      const filter = ctx.createBiquadFilter();
      filter.type = 'bandpass';
      filter.Q.setValueAtTime(3.0, now);
      filter.frequency.setValueAtTime(350, now);
      filter.frequency.exponentialRampToValueAtTime(1400, now + 0.06);
      filter.frequency.exponentialRampToValueAtTime(300, now + 0.12);

      const noiseGain = ctx.createGain();
      noiseGain.gain.setValueAtTime(0.01, now);
      noiseGain.gain.linearRampToValueAtTime(0.45, now + 0.04);
      noiseGain.gain.exponentialRampToValueAtTime(0.001, now + 0.14);

      noiseSource.connect(filter);
      filter.connect(noiseGain);
      noiseGain.connect(voiceGain);
      nodes.push(noiseSource, filter, noiseGain);

      const offset = Math.random() * 0.5;
      noiseSource.start(now, offset);
      noiseSource.stop(now + 0.14);
    }

    osc.start(now);
    osc.stop(now + duration);

    this.createVoiceTracker(osc, nodes, duration);
  }

  /**
   * Cleans up all resources, stops active voices, and closes AudioContext.
   */
  public dispose(): void {
    this.removeAutoUnlockListeners();

    for (const voice of this.activeVoices) {
      voice.stop();
    }
    this.activeVoices.clear();

    if (this.ctx && this.ctx.state !== 'closed') {
      this.ctx.close().catch(() => {});
      this.ctx = null;
    }
    this.masterGain = null;
    this.compressor = null;
    this.sharedNoiseBuffer = null;
  }
}

/** Exported singleton instance for application-wide use */
export const soundSynth = new SoundSynthesizer();

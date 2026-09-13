import {
  SoundSynthesizer,
  normalizeWeaponType,
  type WeaponSoundType,
} from './soundSynth.ts';

type WeaponLayerProfile = {
  baseLevel: number;
  headHz: number;
  headGain: number;
  headMs: number;
  bodyStartHz: number;
  bodyEndHz: number;
  bodyGain: number;
  bodyMs: number;
  lfeStartHz: number;
  lfeEndHz: number;
  lfeGain: number;
  lfeMs: number;
  mechanicalHz: number;
  mechanicalGain: number;
  mechanicalDelayMs: number;
  mechanicalMs: number;
  tailHz: number;
  tailGain: number;
  tailMs: number;
  variation: number;
};

/**
 * Modern weapon-shot structure: transient head, tonal/noise body, LFE weight,
 * mechanical action and a bounded tail. Automatic weapons deliberately keep
 * short tails so repeated shots stay articulate instead of smearing together.
 */
export const WEAPON_LAYER_PROFILES: Record<WeaponSoundType, WeaponLayerProfile> = {
  assalto: {
    baseLevel: 0.76,
    headHz: 4200, headGain: 0.23, headMs: 13,
    bodyStartHz: 310, bodyEndHz: 118, bodyGain: 0.20, bodyMs: 88,
    lfeStartHz: 92, lfeEndHz: 48, lfeGain: 0.15, lfeMs: 78,
    mechanicalHz: 1850, mechanicalGain: 0.10, mechanicalDelayMs: 31, mechanicalMs: 24,
    tailHz: 1050, tailGain: 0.075, tailMs: 72,
    variation: 0.035,
  },
  cecchino: {
    baseLevel: 0.72,
    headHz: 5200, headGain: 0.31, headMs: 18,
    bodyStartHz: 240, bodyEndHz: 62, bodyGain: 0.28, bodyMs: 245,
    lfeStartHz: 105, lfeEndHz: 31, lfeGain: 0.27, lfeMs: 260,
    mechanicalHz: 1280, mechanicalGain: 0.13, mechanicalDelayMs: 145, mechanicalMs: 70,
    tailHz: 720, tailGain: 0.12, tailMs: 360,
    variation: 0.025,
  },
  pompa: {
    baseLevel: 0.70,
    headHz: 3300, headGain: 0.28, headMs: 22,
    bodyStartHz: 205, bodyEndHz: 58, bodyGain: 0.30, bodyMs: 210,
    lfeStartHz: 88, lfeEndHz: 36, lfeGain: 0.30, lfeMs: 235,
    mechanicalHz: 930, mechanicalGain: 0.15, mechanicalDelayMs: 185, mechanicalMs: 92,
    tailHz: 610, tailGain: 0.12, tailMs: 280,
    variation: 0.045,
  },
  mitraglietta: {
    baseLevel: 0.80,
    headHz: 4800, headGain: 0.18, headMs: 9,
    bodyStartHz: 390, bodyEndHz: 155, bodyGain: 0.13, bodyMs: 48,
    lfeStartHz: 102, lfeEndHz: 58, lfeGain: 0.08, lfeMs: 42,
    mechanicalHz: 2450, mechanicalGain: 0.08, mechanicalDelayMs: 17, mechanicalMs: 15,
    tailHz: 1350, tailGain: 0.045, tailMs: 38,
    variation: 0.055,
  },
  coltello: {
    baseLevel: 0.82,
    headHz: 2850, headGain: 0.10, headMs: 8,
    bodyStartHz: 720, bodyEndHz: 280, bodyGain: 0.08, bodyMs: 82,
    lfeStartHz: 90, lfeEndHz: 62, lfeGain: 0.025, lfeMs: 45,
    mechanicalHz: 3600, mechanicalGain: 0.10, mechanicalDelayMs: 63, mechanicalMs: 18,
    tailHz: 1650, tailGain: 0.055, tailMs: 105,
    variation: 0.07,
  },
};

function boundedVariation(amount: number): number {
  return 1 + (Math.random() * 2 - 1) * amount;
}

export class EnhancedWeaponAudio {
  private readonly base: SoundSynthesizer;
  private ctx: AudioContext | null = null;
  private layerMaster: GainNode | null = null;
  private layerCompressor: DynamicsCompressorNode | null = null;
  private noise: AudioBuffer | null = null;
  private masterVolume = 1;
  private sfxVolume = 1;

  constructor(base = new SoundSynthesizer()) {
    this.base = base;
  }

  public async unlock(): Promise<void> {
    await this.base.unlock();
    this.ensureLayerGraph();
  }

  public async init(): Promise<void> {
    await this.unlock();
  }

  public setMasterVolume(volume: number): void {
    this.masterVolume = Math.max(0, Math.min(1, volume));
    this.base.setMasterVolume(this.masterVolume);
    this.updateLayerGain();
  }

  public setSfxVolume(volume: number): void {
    this.sfxVolume = Math.max(0, Math.min(1, volume));
    this.base.setSfxVolume(this.sfxVolume);
    this.updateLayerGain();
  }

  public getAudioContext(): AudioContext | null {
    return this.base.getAudioContext();
  }

  public isUnlocked(): boolean {
    return this.base.isUnlocked();
  }

  public playShot(weaponType: string | number, volumeScale = 1): void {
    const type = normalizeWeaponType(weaponType);
    this.playWeaponSound(type, volumeScale);
  }

  public playWeaponSound(weaponType: string, volumeScale = 1): void {
    const type = normalizeWeaponType(weaponType);
    const profile = WEAPON_LAYER_PROFILES[type];

    // Keep the existing verified synth as the tonal signature and add physical
    // weight/detail around it instead of replacing it with an unrelated sound.
    this.base.playWeaponSound(type, volumeScale * profile.baseLevel);
    this.ensureLayerGraph();
    if (!this.ctx || !this.layerMaster || this.ctx.state === 'closed') return;
    if (this.ctx.state === 'suspended') void this.ctx.resume();

    const level = Math.max(0, Math.min(2, volumeScale));
    if (level <= 0.0001 || this.masterVolume * this.sfxVolume <= 0.0001) return;
    this.synthesizeLayers(profile, type, level);
  }

  private ensureLayerGraph(): void {
    const ctx = this.base.getAudioContext();
    if (!ctx) return;
    if (this.ctx === ctx && this.layerMaster && this.layerCompressor && this.noise) return;

    this.ctx = ctx;
    this.layerMaster = ctx.createGain();
    this.layerCompressor = ctx.createDynamicsCompressor();
    this.layerCompressor.threshold.setValueAtTime(-10, ctx.currentTime);
    this.layerCompressor.knee.setValueAtTime(8, ctx.currentTime);
    this.layerCompressor.ratio.setValueAtTime(5, ctx.currentTime);
    this.layerCompressor.attack.setValueAtTime(0.0015, ctx.currentTime);
    this.layerCompressor.release.setValueAtTime(0.08, ctx.currentTime);
    this.layerMaster.connect(this.layerCompressor);
    this.layerCompressor.connect(ctx.destination);

    const length = Math.max(1, Math.floor(ctx.sampleRate * 0.6));
    this.noise = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = this.noise.getChannelData(0);
    for (let i = 0; i < data.length; i += 1) data[i] = Math.random() * 2 - 1;
    this.updateLayerGain();
  }

  private updateLayerGain(): void {
    if (!this.ctx || !this.layerMaster) return;
    const now = this.ctx.currentTime;
    this.layerMaster.gain.cancelScheduledValues(now);
    this.layerMaster.gain.setValueAtTime(this.masterVolume * this.sfxVolume, now);
  }

  private noiseBurst(
    frequency: number,
    gainValue: number,
    start: number,
    duration: number,
    destination: AudioNode,
    type: BiquadFilterType = 'bandpass',
    q = 1.1,
  ): AudioNode[] {
    const ctx = this.ctx;
    if (!ctx || !this.noise) return [];
    const source = ctx.createBufferSource();
    source.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.setValueAtTime(frequency, start);
    filter.Q.setValueAtTime(q, start);
    const gain = ctx.createGain();
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    source.connect(filter);
    filter.connect(gain);
    gain.connect(destination);
    source.start(start, Math.random() * Math.max(0.01, this.noise.duration - duration));
    source.stop(start + duration);
    return [source, filter, gain];
  }

  private oscillatorLayer(
    waveform: OscillatorType,
    startHz: number,
    endHz: number,
    gainValue: number,
    start: number,
    duration: number,
    destination: AudioNode,
  ): AudioNode[] {
    const ctx = this.ctx;
    if (!ctx) return [];
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = waveform;
    osc.frequency.setValueAtTime(Math.max(1, startHz), start);
    osc.frequency.exponentialRampToValueAtTime(Math.max(1, endHz), start + duration);
    gain.gain.setValueAtTime(Math.max(0.0001, gainValue), start);
    gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
    osc.connect(gain);
    gain.connect(destination);
    osc.start(start);
    osc.stop(start + duration);
    return [osc, gain];
  }

  private synthesizeLayers(profile: WeaponLayerProfile, type: WeaponSoundType, level: number): void {
    const ctx = this.ctx;
    const master = this.layerMaster;
    if (!ctx || !master) return;

    const now = ctx.currentTime;
    const variation = boundedVariation(profile.variation);
    const voice = ctx.createGain();
    voice.gain.setValueAtTime(level, now);
    voice.connect(master);
    const nodes: AudioNode[] = [voice];

    // HEAD: very short bright transient that defines immediacy/attack.
    nodes.push(...this.noiseBurst(
      profile.headHz * variation,
      profile.headGain,
      now,
      profile.headMs / 1000,
      voice,
      'highpass',
      0.8,
    ));

    // BODY: low-mid tonal impulse; knife gets a cleaner triangle instead of a gun-like saw.
    nodes.push(...this.oscillatorLayer(
      type === 'coltello' ? 'triangle' : 'sawtooth',
      profile.bodyStartHz * variation,
      profile.bodyEndHz / variation,
      profile.bodyGain,
      now,
      profile.bodyMs / 1000,
      voice,
    ));

    // LFE: weight without changing gameplay or spatial authority.
    nodes.push(...this.oscillatorLayer(
      'sine',
      profile.lfeStartHz * variation,
      profile.lfeEndHz,
      profile.lfeGain,
      now,
      profile.lfeMs / 1000,
      voice,
    ));

    // MECHANICAL: delayed bolt/pump/action detail separates weapon identities.
    const mechanicalStart = now + profile.mechanicalDelayMs / 1000;
    nodes.push(...this.noiseBurst(
      profile.mechanicalHz / variation,
      profile.mechanicalGain,
      mechanicalStart,
      profile.mechanicalMs / 1000,
      voice,
      'bandpass',
      3.4,
    ));

    // TAIL: bounded ambience/body release. Autos intentionally stay < 80 ms.
    const tailStart = now + Math.min(profile.bodyMs, 70) / 1000;
    nodes.push(...this.noiseBurst(
      profile.tailHz * variation,
      profile.tailGain,
      tailStart,
      profile.tailMs / 1000,
      voice,
      'lowpass',
      0.6,
    ));

    const longestMs = Math.max(
      profile.bodyMs,
      profile.lfeMs,
      profile.mechanicalDelayMs + profile.mechanicalMs,
      Math.min(profile.bodyMs, 70) + profile.tailMs,
    );
    window.setTimeout(() => {
      for (const node of nodes) {
        try { node.disconnect(); } catch { /* already disconnected */ }
      }
    }, longestMs + 120);
  }

  public dispose(): void {
    try { this.layerMaster?.disconnect(); } catch { /* no-op */ }
    try { this.layerCompressor?.disconnect(); } catch { /* no-op */ }
    this.layerMaster = null;
    this.layerCompressor = null;
    this.noise = null;
    this.ctx = null;
    this.base.dispose();
  }
}

export const enhancedWeaponAudio = new EnhancedWeaponAudio();

// tests/tier1_features/test_t1_audio_synth.mjs
// Tier 1 Feature Coverage: Procedural Web Audio SFX Synthesizer (F-6, F-7, R2)

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { assert, assertEqual, assertCloseTo, assertGreaterThan } from '../helpers/assertions.mjs';
import { MockAudioContext, MockOscillatorNode, MockAudioBufferSourceNode, MockBiquadFilterNode } from '../helpers/mock_audio.mjs';
import { SoundSynthesizer, normalizeWeaponType } from '../../game-web/src/audio/soundSynth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');

export async function run(suite) {
  // Test 1: Zero External Audio Assets (R2 Integrity Rule)
  suite.test('R2: game-web/src/audio contains zero external audio files (.wav, .mp3, .ogg, etc.)', () => {
    const audioDir = path.join(REPO_ROOT, 'game-web', 'src', 'audio');
    const files = fs.readdirSync(audioDir);
    const audioExtensions = ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.weba'];
    
    for (const file of files) {
      const ext = path.extname(file).toLowerCase();
      assert(!audioExtensions.includes(ext), `Forbidden audio asset file found: ${file}`);
    }

    const soundSynthCode = fs.readFileSync(path.join(audioDir, 'soundSynth.ts'), 'utf-8');
    for (const ext of audioExtensions) {
      assert(!soundSynthCode.includes(ext), `Forbidden audio extension reference '${ext}' found in soundSynth.ts`);
    }
    assert(!soundSynthCode.includes('new Audio('), 'soundSynth.ts must not use HTMLAudioElement new Audio()');
    assert(!soundSynthCode.includes('fetch('), 'soundSynth.ts must not fetch external audio files');
  });

  // Test 2: AudioSynthesizer Interface Contract
  suite.test('F-6: SoundSynthesizer adheres to AudioSynthesizer interface contract', () => {
    const synth = new SoundSynthesizer();
    assertEqual(typeof synth.unlock, 'function', 'unlock must be a function');
    assertEqual(typeof synth.playWeaponSound, 'function', 'playWeaponSound must be a function');
    assertEqual(typeof synth.playShot, 'function', 'playShot alias must be a function');
    assertEqual(typeof synth.setMasterVolume, 'function', 'setMasterVolume must be a function');
    assertEqual(typeof synth.setSfxVolume, 'function', 'setSfxVolume must be a function');
    assertEqual(typeof synth.dispose, 'function', 'dispose must be a function');
  });

  // Test 3: Weapon Normalization and Alias Mapping
  suite.test('F-6: Weapon types and aliases normalize correctly to canonical IDs', () => {
    assertEqual(normalizeWeaponType('assalto'), 'assalto');
    assertEqual(normalizeWeaponType('AR-42'), 'assalto');
    assertEqual(normalizeWeaponType('ar42'), 'assalto');
    assertEqual(normalizeWeaponType(0), 'assalto');

    assertEqual(normalizeWeaponType('cecchino'), 'cecchino');
    assertEqual(normalizeWeaponType('SR-99'), 'cecchino');
    assertEqual(normalizeWeaponType('sniper'), 'cecchino');
    assertEqual(normalizeWeaponType(1), 'cecchino');

    assertEqual(normalizeWeaponType('pompa'), 'pompa');
    assertEqual(normalizeWeaponType('SG-12'), 'pompa');
    assertEqual(normalizeWeaponType('shotgun'), 'pompa');
    assertEqual(normalizeWeaponType(2), 'pompa');

    assertEqual(normalizeWeaponType('mitraglietta'), 'mitraglietta');
    assertEqual(normalizeWeaponType('SMG-7'), 'mitraglietta');
    assertEqual(normalizeWeaponType('smg'), 'mitraglietta');
    assertEqual(normalizeWeaponType(3), 'mitraglietta');

    assertEqual(normalizeWeaponType('coltello'), 'coltello');
    assertEqual(normalizeWeaponType('CB-01'), 'coltello');
    assertEqual(normalizeWeaponType('knife'), 'coltello');
    assertEqual(normalizeWeaponType('melee'), 'coltello');
    assertEqual(normalizeWeaponType(4), 'coltello');

    // Unknown defaults to assalto
    assertEqual(normalizeWeaponType('unknown_weapon'), 'assalto');
  });

  // Test 4: AudioContext Initialization & Browser Unlock (F-7)
  suite.test('F-7: unlock() resumes AudioContext and initializes master dynamics compressor', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();

    await synth.unlock();
    const ctx = synth.getAudioContext();
    assert(ctx !== null, 'AudioContext must be created');
    assertEqual(ctx.state, 'running', 'Context state must be running after unlock');
    assertEqual(synth.isUnlocked(), true, 'isUnlocked() must return true');

    // Verify master graph nodes
    const compressor = ctx.createdNodes.find((n) => n.nodeType === 'DynamicsCompressorNode');
    assert(compressor !== undefined, 'Master graph must include DynamicsCompressorNode');
    assertEqual(compressor.threshold.value, -6, 'Compressor threshold must be -6 dB');
    assertEqual(compressor.ratio.value, 8, 'Compressor ratio must be 8:1');
    assertEqual(compressor.knee.value, 12, 'Compressor knee must be 12 dB');

    synth.dispose();
    assertEqual(ctx.state, 'closed', 'Context must be closed on dispose()');
  });

  // Test 5: Pre-computed 1.0s Shared Noise Buffer
  suite.test('F-6: Pre-computed 1.0s shared white noise buffer is created and reused', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    // Check shared noise buffer
    const buffer = synth['sharedNoiseBuffer'];
    assert(buffer !== null, 'Shared noise buffer must be initialized');
    assertEqual(buffer.numberOfChannels, 1, 'Noise buffer must be mono (1 channel)');
    assertEqual(buffer.length, 44100, 'Noise buffer must be exactly 1.0s (44100 samples)');
    assertCloseTo(buffer.duration, 1.0, 1e-4, 'Buffer duration must be 1.0s');

    // Verify non-zero variance and bounded in [-1.0, 1.0]
    const data = buffer.getChannelData(0);
    let minVal = 1.0;
    let maxVal = -1.0;
    for (let i = 0; i < 1000; i++) {
      if (data[i] < minVal) minVal = data[i];
      if (data[i] > maxVal) maxVal = data[i];
      assert(data[i] >= -1.0 && data[i] <= 1.0, `Sample ${data[i]} must be in [-1.0, 1.0]`);
    }
    assert(minVal < -0.5 && maxVal > 0.5, 'Noise buffer must contain varied non-zero white noise');

    synth.dispose();
  });

  // Test 6: Assalto Sound Synthesis Recipe
  suite.test('F-6: Assalto weapon sound has 920Hz -> 140Hz sawtooth sweep and 2200Hz bandpass punch', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('assalto');

    const newNodes = ctx.createdNodes.slice(initialNodeCount);
    const osc = newNodes.find((n) => n instanceof MockOscillatorNode);
    assert(osc !== undefined, 'Assalto must generate an oscillator');
    assertEqual(osc.type, 'sawtooth', 'Assalto osc must be sawtooth');

    const freqEvents = osc.frequency.events;
    const initialFreq = freqEvents.find((e) => e.type === 'setValueAtTime');
    const targetFreq = freqEvents.find((e) => e.type === 'exponentialRampToValueAtTime');
    assertEqual(initialFreq?.value, 920, 'Initial frequency must be 920Hz');
    assertEqual(targetFreq?.value, 140, 'Target frequency must be 140Hz');
    assertCloseTo(targetFreq?.time - initialFreq?.time, 0.11, 0.02, 'Ramp duration must be ~0.11s');

    // Check noise filter at 2200Hz, Q=2.5
    const filter = newNodes.find((n) => n instanceof MockBiquadFilterNode);
    assert(filter !== undefined, 'Assalto must generate a biquad filter for noise');
    assertEqual(filter.type, 'bandpass', 'Filter type must be bandpass');
    assertEqual(filter.frequency.value, 2200, 'Filter center frequency must be 2200Hz');
    assertEqual(filter.Q.value, 2.5, 'Filter Q must be 2.5');

    synth.dispose();
  });

  // Test 7: Cecchino Sound Synthesis Recipe
  suite.test('F-6: Cecchino sound features 2800Hz rail screech (Q=5), 160Hz sub-bass, and 1400Hz noise', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('cecchino');

    const newNodes = ctx.createdNodes.slice(initialNodeCount);
    const oscillators = newNodes.filter((n) => n instanceof MockOscillatorNode);
    assertEqual(oscillators.length, 2, 'Cecchino must generate 2 oscillators (rail screech + sub thump)');

    const screech = oscillators.find((o) => o.type === 'sawtooth');
    const sub = oscillators.find((o) => o.type === 'sine');
    assert(screech !== undefined, 'Cecchino must have sawtooth rail screech oscillator');
    assert(sub !== undefined, 'Cecchino must have sine sub-bass oscillator');

    assertEqual(screech.frequency.events[0]?.value, 2800, 'Screech start frequency must be 2800Hz');
    assertEqual(screech.frequency.events[1]?.value, 80, 'Screech end frequency must be 80Hz');

    assertEqual(sub.frequency.events[0]?.value, 160, 'Sub start frequency must be 160Hz');
    assertEqual(sub.frequency.events[1]?.value, 32, 'Sub end frequency must be 32Hz');

    const filter = newNodes.find((n) => n instanceof MockBiquadFilterNode && n.Q.value === 5.0);
    assert(filter !== undefined, 'Cecchino must feature high resonance filter (Q=5.0)');

    const noiseFilter = newNodes.find((n) => n instanceof MockBiquadFilterNode && n.frequency.value === 1400);
    assert(noiseFilter !== undefined, 'Cecchino must feature lowpass noise filter at 1400Hz');

    synth.dispose();
  });

  // Test 8: Pompa Sound Synthesis Recipe
  suite.test('F-6: Pompa sound features dual detuned square/saw (360Hz/280Hz -> 55Hz/45Hz) + 850Hz noise', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('pompa');

    const newNodes = ctx.createdNodes.slice(initialNodeCount);
    const oscillators = newNodes.filter((n) => n instanceof MockOscillatorNode);
    assert(oscillators.length >= 3, 'Pompa must have dual tone oscillators + sub oscillator');

    const squareOsc = oscillators.find((o) => o.type === 'square');
    const sawOsc = oscillators.find((o) => o.type === 'sawtooth');
    const sineOsc = oscillators.find((o) => o.type === 'sine');

    assert(squareOsc !== undefined, 'Pompa must have square wave oscillator');
    assert(sawOsc !== undefined, 'Pompa must have detuned sawtooth oscillator');
    assert(sineOsc !== undefined, 'Pompa must have sine sub-bass oscillator');

    assertEqual(squareOsc.frequency.events[0]?.value, 360, 'Square start frequency must be 360Hz');
    assertEqual(squareOsc.frequency.events[1]?.value, 55, 'Square end frequency must be 55Hz');

    assertEqual(sawOsc.frequency.events[0]?.value, 280, 'Saw start frequency must be 280Hz');
    assertEqual(sawOsc.frequency.events[1]?.value, 45, 'Saw end frequency must be 45Hz');

    const noiseFilter = newNodes.find((n) => n instanceof MockBiquadFilterNode && n.frequency.value === 850);
    assert(noiseFilter !== undefined, 'Pompa must feature lowpass noise blast filter at 850Hz');

    synth.dispose();
  });

  // Test 9: Mitraglietta Sound Synthesis Recipe (10 RPS spam safe)
  suite.test('F-6: Mitraglietta sound features 1350Hz -> 350Hz laser tone with 0.06s duration for 10 RPS', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('mitraglietta');

    const newNodes = ctx.createdNodes.slice(initialNodeCount);
    const osc = newNodes.find((n) => n instanceof MockOscillatorNode);
    assert(osc !== undefined, 'Mitraglietta must have tone oscillator');
    assertEqual(osc.type, 'triangle', 'Mitraglietta osc type must be triangle');
    assertEqual(osc.frequency.events[0]?.value, 1350, 'Start frequency must be 1350Hz');
    assertEqual(osc.frequency.events[1]?.value, 350, 'End frequency must be 350Hz');

    assert(osc.stopTime - osc.startTime <= 0.07, 'Mitraglietta shot duration must be <= 0.07s for 10 RPS playback');

    synth.dispose();
  });

  // Test 10: Coltello Sound Synthesis Recipe
  suite.test('F-6: Coltello melee features 550Hz -> 220Hz sine wave + swept 350Hz->1400Hz->300Hz bandpass', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('coltello');

    const newNodes = ctx.createdNodes.slice(initialNodeCount);
    const osc = newNodes.find((n) => n instanceof MockOscillatorNode);
    assert(osc !== undefined, 'Coltello must have blade tone oscillator');
    assertEqual(osc.type, 'sine', 'Coltello osc type must be sine');
    assertEqual(osc.frequency.events[0]?.value, 550, 'Start frequency must be 550Hz');
    assertEqual(osc.frequency.events[1]?.value, 220, 'End frequency must be 220Hz');

    const filter = newNodes.find((n) => n instanceof MockBiquadFilterNode);
    assert(filter !== undefined, 'Coltello must have bandpass blade whoosh filter');
    assertEqual(filter.type, 'bandpass', 'Filter type must be bandpass');

    const filterFreqs = filter.frequency.events.map((e) => e.value);
    assert(filterFreqs.includes(350), 'Filter sweep must start at 350Hz');
    assert(filterFreqs.includes(1400), 'Filter sweep must peak at 1400Hz');
    assert(filterFreqs.includes(300), 'Filter sweep must end at 300Hz');

    synth.dispose();
  });

  // Test 11: Anti-Leak Node Disconnection Lifecycle (F-7)
  suite.test('F-7: onended callback disconnects all ephemeral audio nodes to prevent memory leaks', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('assalto');
    const shotNodes = ctx.createdNodes.slice(initialNodeCount);

    const osc = shotNodes.find((n) => n instanceof MockOscillatorNode);
    assert(osc !== undefined, 'Oscillator must exist');
    assertEqual(osc.disconnected, false, 'Oscillator should not be disconnected before playback ends');

    // Trigger onended event on the primary oscillator source
    osc.triggerEnded();

    // Verify all ephemeral nodes created for this shot were disconnected
    for (const node of shotNodes) {
      assertEqual(node.disconnected, true, `${node.nodeType} must be disconnected on onended`);
      assertGreaterThan(node.disconnectCallCount, 0, 'disconnect() must have been invoked');
    }

    synth.dispose();
  });

  // Test 12: Click Spamming & Voice Budgeting
  suite.test('F-7: Rapid click spamming (100 shots) respects voice budget (32 max) without errors', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    // Spam 100 rapid weapon shots across all weapon types
    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    for (let i = 0; i < 100; i++) {
      const weapon = weapons[i % weapons.length];
      synth.playWeaponSound(weapon);
    }

    const activeVoices = synth['activeVoices'];
    assert(activeVoices.size <= 32, `Active voices (${activeVoices.size}) must never exceed MAX_CONCURRENT_VOICES (32)`);

    synth.dispose();
  });

  // Test 13: Zero Volume Bypass
  suite.test('F-6: Zero volumeScale or master volume produces zero ephemeral audio nodes', async () => {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodeCount = ctx.createdNodes.length;
    synth.playWeaponSound('assalto', 0.0);

    const nodeCountAfterMutedShot = ctx.createdNodes.length;
    assertEqual(nodeCountAfterMutedShot, initialNodeCount, 'Muted shot must not instantiate audio nodes');

    synth.dispose();
  });
}

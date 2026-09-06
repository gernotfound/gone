/**
 * Challenger M2 - Empirical Adversarial Audio Synthesis Stress Harness (Node.js)
 * Verifies Milestone 2: Procedural Web Audio SFX Synthesizer (F-6, F-7, R2)
 * 
 * Verifications:
 * - Pure Web Audio API synthesis (0 external audio assets, 0 fetch, 0 Audio tags).
 * - Exact acoustic recipes across all 5 weapons (frequencies, ramps, Q values, durations).
 * - 1.0s pre-computed shared white noise buffer statistical entropy.
 * - Dynamics compressor output stage calibration.
 * - Anti-leak lifecycle: 100% ephemeral node disconnection upon onended.
 * - 500-round continuous rapid fire stress & voice budget clamping (max 32 concurrent voices).
 * - Extreme boundary inputs (negative volume, volume > 2.0, NaN, weird strings).
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { MockAudioContext, MockOscillatorNode, MockBiquadFilterNode } from './helpers/mock_audio.mjs';
import { SoundSynthesizer, normalizeWeaponType } from '../game-web/src/audio/soundSynth.ts';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '..');

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`  ✘ [FAIL] ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  ✔ [PASS] ${message}`);
  }
}

async function runChallengerSuite() {
  console.log(`
================================================================================
         CHALLENGER M2: PROCEDURAL WEB AUDIO SFX EMPIRICAL STRESS SUITE         
================================================================================
`);

  // SECTION 1: Zero External Audio Assets & Integrity Rule (R2)
  console.log('>>> SECTION 1: Zero External Audio Assets & Integrity Rule (R2)');
  {
    const audioDir = path.join(REPO_ROOT, 'game-web', 'src', 'audio');
    const audioFiles = fs.readdirSync(audioDir);
    const forbiddenExts = ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.wma', '.weba'];

    assert(audioFiles.length >= 2, 'Audio directory contains soundSynth.ts and index.ts');
    for (const f of audioFiles) {
      const ext = path.extname(f).toLowerCase();
      assert(!forbiddenExts.includes(ext), `Zero binary audio assets: ${f} is valid code`);
    }

    const soundSynthCode = fs.readFileSync(path.join(audioDir, 'soundSynth.ts'), 'utf-8');
    for (const ext of forbiddenExts) {
      assert(!soundSynthCode.includes(ext), `soundSynth.ts does not reference extension ${ext}`);
    }
    assert(!soundSynthCode.includes('new Audio('), 'soundSynth.ts does not instantiate HTMLAudioElement new Audio()');
    assert(!soundSynthCode.includes('fetch('), 'soundSynth.ts does not invoke fetch() for audio assets');
    assert(!soundSynthCode.includes('XMLHttpRequest'), 'soundSynth.ts does not invoke XHR for audio assets');
  }

  // SECTION 2: Mathematical Properties of Pre-computed Shared Noise Buffer
  console.log('\n>>> SECTION 2: Mathematical Properties of Pre-computed Shared Noise Buffer');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const buffer = synth['sharedNoiseBuffer'];
    assert(buffer !== null, 'Shared noise buffer is allocated during initialization');
    assert(buffer.numberOfChannels === 1, 'Noise buffer is single-channel mono');
    assert(buffer.length === 44100, 'Noise buffer contains exactly 44100 samples (1.0s at 44.1kHz)');
    assert(Math.abs(buffer.duration - 1.0) < 1e-4, 'Noise buffer duration is exactly 1.0s');

    const data = buffer.getChannelData(0);
    let sum = 0;
    let sumSq = 0;
    let minVal = 1.0;
    let maxVal = -1.0;

    for (let i = 0; i < data.length; i++) {
      const s = data[i];
      if (s < minVal) minVal = s;
      if (s > maxVal) maxVal = s;
      sum += s;
      sumSq += s * s;
      if (s < -1.0 || s > 1.0) {
        throw new Error(`Sample out of bounds [-1.0, 1.0]: ${s}`);
      }
    }

    const mean = sum / data.length;
    const variance = sumSq / data.length - mean * mean;

    assert(Math.abs(mean) < 0.02, `Noise buffer mean is near zero (measured: ${mean.toFixed(5)})`);
    assert(variance > 0.28 && variance < 0.38, `Noise buffer variance matches uniform white noise ~0.333 (measured: ${variance.toFixed(5)})`);
    assert(minVal < -0.95 && maxVal > 0.95, `Noise buffer utilizes full dynamic range [-1, 1] (min: ${minVal.toFixed(3)}, max: ${maxVal.toFixed(3)})`);

    // Verify buffer is shared and reused across multiple shots
    const initialBufferRef = synth['sharedNoiseBuffer'];
    synth.playWeaponSound('assalto');
    synth.playWeaponSound('cecchino');
    assert(synth['sharedNoiseBuffer'] === initialBufferRef, 'Shared noise buffer is persistent across shots (0 reallocation)');

    synth.dispose();
  }

  // SECTION 3: Master Dynamics Compressor Calibration
  console.log('\n>>> SECTION 3: Master Dynamics Compressor Calibration');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const compressor = ctx.createdNodes.find((n) => n.nodeType === 'DynamicsCompressorNode');
    assert(compressor !== undefined, 'DynamicsCompressorNode is present in master graph');
    assert(compressor.threshold.value === -6, 'Compressor threshold calibrated to -6 dBFS for anti-clipping');
    assert(compressor.knee.value === 12, 'Compressor knee calibrated to 12 dB for soft transition');
    assert(compressor.ratio.value === 8, 'Compressor compression ratio calibrated to 8:1');
    assert(compressor.attack.value === 0.003, 'Compressor attack calibrated to fast 3ms transient catch');
    assert(compressor.release.value === 0.15, 'Compressor release calibrated to 150ms smooth recovery');

    synth.dispose();
  }

  // SECTION 4: Exact Acoustic Weapon Recipes
  console.log('\n>>> SECTION 4: Exact Acoustic Weapon Recipes Verification');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    // 4A: Assalto (AR-42 Viper)
    {
      const startCount = ctx.createdNodes.length;
      synth.playWeaponSound('assalto');
      const nodes = ctx.createdNodes.slice(startCount);

      const osc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sawtooth');
      assert(osc !== undefined, '[Assalto] Generates sawtooth oscillator');
      const f0 = osc.frequency.events.find((e) => e.type === 'setValueAtTime')?.value;
      const f1 = osc.frequency.events.find((e) => e.type === 'exponentialRampToValueAtTime')?.value;
      assert(f0 === 920, `[Assalto] Pitch drop begins at 920Hz (got ${f0})`);
      assert(f1 === 140, `[Assalto] Pitch drop drops to 140Hz (got ${f1})`);

      const filter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.type === 'bandpass');
      assert(filter !== undefined, '[Assalto] Generates bandpass noise filter');
      assert(filter.frequency.value === 2200, `[Assalto] Bandpass noise center is 2200Hz (got ${filter.frequency.value})`);
      assert(filter.Q.value === 2.5, `[Assalto] Bandpass noise resonance Q is 2.5 (got ${filter.Q.value})`);
    }

    // 4B: Cecchino (SR-99 Railphantom)
    {
      const startCount = ctx.createdNodes.length;
      synth.playWeaponSound('cecchino');
      const nodes = ctx.createdNodes.slice(startCount);

      const screechOsc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sawtooth');
      const subOsc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sine');
      assert(screechOsc !== undefined, '[Cecchino] Generates rail screech sawtooth oscillator');
      assert(subOsc !== undefined, '[Cecchino] Generates sub-bass sine oscillator');

      const screechF0 = screechOsc.frequency.events[0]?.value;
      const screechF1 = screechOsc.frequency.events[1]?.value;
      assert(screechF0 === 2800 && screechF1 === 80, `[Cecchino] Screech frequency sweeps 2800Hz -> 80Hz (got ${screechF0} -> ${screechF1})`);

      const subF0 = subOsc.frequency.events[0]?.value;
      const subF1 = subOsc.frequency.events[1]?.value;
      assert(subF0 === 160 && subF1 === 32, `[Cecchino] Sub thump sweeps 160Hz -> 32Hz (got ${subF0} -> ${subF1})`);

      const highQFilter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.Q.value === 5.0);
      assert(highQFilter !== undefined, '[Cecchino] Screech routed through high resonance filter Q=5.0');

      const noiseFilter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.frequency.value === 1400);
      assert(noiseFilter !== undefined, '[Cecchino] Lowpass noise punch centered at 1400Hz');
    }

    // 4C: Pompa (SG-12 Havoc)
    {
      const startCount = ctx.createdNodes.length;
      synth.playWeaponSound('pompa');
      const nodes = ctx.createdNodes.slice(startCount);

      const squareOsc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'square');
      const sawOsc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sawtooth');
      const subOsc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sine');

      assert(squareOsc !== undefined, '[Pompa] Generates square oscillator');
      assert(sawOsc !== undefined, '[Pompa] Generates detuned sawtooth oscillator');
      assert(subOsc !== undefined, '[Pompa] Generates sub-bass punch oscillator');

      assert(squareOsc.frequency.events[0]?.value === 360 && squareOsc.frequency.events[1]?.value === 55, '[Pompa] Square sweeps 360Hz -> 55Hz');
      assert(sawOsc.frequency.events[0]?.value === 280 && sawOsc.frequency.events[1]?.value === 45, '[Pompa] Saw sweeps detuned 280Hz -> 45Hz');
      assert(subOsc.frequency.events[0]?.value === 95 && subOsc.frequency.events[1]?.value === 40, '[Pompa] Sub sweeps 95Hz -> 40Hz');

      const noiseFilter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.frequency.value === 850);
      assert(noiseFilter !== undefined, '[Pompa] Lowpass noise blast filter at 850Hz');
    }

    // 4D: Mitraglietta (SMG-7 Neon Hornet)
    {
      const startCount = ctx.createdNodes.length;
      synth.playWeaponSound('mitraglietta');
      const nodes = ctx.createdNodes.slice(startCount);

      const osc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'triangle');
      assert(osc !== undefined, '[Mitraglietta] Generates triangle laser oscillator');
      assert(osc.frequency.events[0]?.value === 1350 && osc.frequency.events[1]?.value === 350, '[Mitraglietta] Sweeps 1350Hz -> 350Hz');
      assert(osc.stopTime - osc.startTime <= 0.07, '[Mitraglietta] Firing duration <= 0.07s strictly enables 10 RPS playback');

      const clickFilter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.frequency.value === 3200);
      assert(clickFilter !== undefined, '[Mitraglietta] Transient click bandpass filter at 3200Hz');
    }

    // 4E: Coltello (CB-01 Shadowfang)
    {
      const startCount = ctx.createdNodes.length;
      synth.playWeaponSound('coltello');
      const nodes = ctx.createdNodes.slice(startCount);

      const osc = nodes.find((n) => n instanceof MockOscillatorNode && n.type === 'sine');
      assert(osc !== undefined, '[Coltello] Generates sine blade oscillator');
      assert(osc.frequency.events[0]?.value === 550 && osc.frequency.events[1]?.value === 220, '[Coltello] Sweeps 550Hz -> 220Hz');

      const whooshFilter = nodes.find((n) => n instanceof MockBiquadFilterNode && n.type === 'bandpass');
      assert(whooshFilter !== undefined, '[Coltello] Generates bandpass whoosh filter');
      const sweepVals = whooshFilter.frequency.events.map((e) => e.value);
      assert(sweepVals[0] === 350 && sweepVals[1] === 1400 && sweepVals[2] === 300, '[Coltello] Bandpass whoosh sweeps 350Hz -> 1400Hz -> 300Hz');
    }

    synth.dispose();
  }

  // SECTION 5: Anti-Leak Lifecycle and Garbage Collection Guarantee (F-7)
  console.log('\n>>> SECTION 5: Anti-Leak Node Disconnection & Cleanup Guarantee (F-7)');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const startCount = ctx.createdNodes.length;
    synth.playWeaponSound('cecchino');
    const shotNodes = ctx.createdNodes.slice(startCount);

    const sources = shotNodes.filter((n) => typeof n.triggerEnded === 'function');
    assert(sources.length >= 1, 'Shot contains at least 1 schedulable source node');

    // Trigger onended on primary source
    sources[0].triggerEnded();

    // Confirm every single node created during that shot was disconnected
    let allDisconnected = true;
    for (const node of shotNodes) {
      if (!node.disconnected) {
        allDisconnected = false;
        console.error(`Node ${node.nodeType} was NOT disconnected!`);
      }
    }
    assert(allDisconnected, '100% of ephemeral audio nodes disconnected upon playback completion');

    synth.dispose();
  }

  // SECTION 6: High-Frequency Rapid Click Spamming (500 Shots)
  console.log('\n>>> SECTION 6: High-Frequency Rapid Click Spamming Stress (500 Shots)');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    const startTime = Date.now();

    for (let i = 0; i < 500; i++) {
      const w = weapons[i % weapons.length];
      synth.playWeaponSound(w, 0.8 + 0.4 * Math.random());
    }

    const elapsed = Date.now() - startTime;
    console.log(`    Simulated 500 rapid shots across all weapons in ${elapsed}ms`);

    const activeVoices = synth['activeVoices'];
    assert(activeVoices.size <= 32, `Voice count strictly clamped to <= 32 (measured: ${activeVoices.size})`);

    // Verify calling dispose cleans all remaining voices
    synth.dispose();
    assert(activeVoices.size === 0, 'Active voices cleanly emptied upon dispose');
  }

  // SECTION 7: Extreme Boundary Inputs & Defensive Exception Trapping
  console.log('\n>>> SECTION 7: Extreme Boundary Inputs & Defensive Exception Trapping');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    // Abnormal weapon names
    synth.playWeaponSound('');
    synth.playWeaponSound('   ');
    synth.playWeaponSound('non_existent_weapon_xyz');
    synth.playWeaponSound(null);
    synth.playWeaponSound(undefined);
    synth.playWeaponSound(99999);
    synth.playWeaponSound(-1);
    assert(true, 'Abnormal weapon identifiers handled gracefully without exception');

    // Volume boundary extremes
    synth.playWeaponSound('assalto', -10.0);
    synth.playWeaponSound('assalto', 0.0);
    synth.playWeaponSound('assalto', 999.0);
    synth.playWeaponSound('assalto', NaN);
    assert(true, 'Volume extremes (-10, 0, 999, NaN) handled cleanly');

    // Muted volume bypass check
    const ctx = synth.getAudioContext();
    const nodeCountBefore = ctx.createdNodes.length;
    synth.playWeaponSound('assalto', 0.0);
    synth.setMasterVolume(0.0);
    synth.playWeaponSound('assalto', 1.0);
    const nodeCountAfter = ctx.createdNodes.length;
    assert(nodeCountBefore === nodeCountAfter, 'Zero volume requests bypass node instantiation completely');

    // Re-unlocking multiple times
    await synth.unlock();
    await synth.unlock();
    assert(synth.isUnlocked(), 'Multiple unlock() calls are idempotent');

    synth.dispose();
    // Play after dispose should not crash
    synth.playWeaponSound('assalto');
    assert(true, 'playWeaponSound after dispose does not throw unhandled exception');
  }

  console.log(`
================================================================================
                          CHALLENGER EXECUTION SUMMARY                          
================================================================================
Total Assertions: ${totalTests}
Passed: ${passedTests}
Failed: ${failedTests}

✔ ALL CHALLENGER M2 AUDIO SYNTHESIS ASSERTIONS PASSED WITH 100% SUCCESS!
`);
}

runChallengerSuite().catch((err) => {
  console.error('CHALLENGER FAILURE:', err);
  process.exit(1);
});

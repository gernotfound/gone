/**
 * Challenger M2 Empirical Verification Harness
 * Tests acoustic signature uniqueness across all 5 weapons, zero-asset constraints,
 * voice budgeting, lifecycle memory cleanup, and adversarial input fuzzing.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import {
  MockAudioContext,
  MockOscillatorNode,
  MockAudioBufferSourceNode,
  MockBiquadFilterNode,
  MockGainNode,
} from './helpers/mock_audio.mjs';
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
    console.error(`  [FAIL] ${message}`);
    throw new Error(message);
  } else {
    passedTests++;
    console.log(`  [PASS] ${message}`);
  }
}

async function runEmpiricalVerification() {
  console.log('================================================================');
  console.log('  CHALLENGER M2: EMPIRICAL VERIFICATION OF SFX & ZERO ASSETS');
  console.log('================================================================\n');

  // TEST SUITE 1: ACOUSTIC SIGNATURE UNIQUENESS
  console.log('>>> TEST SUITE 1: Acoustic Signature Extraction & Uniqueness Verification');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];
    const signatures = new Map();

    for (const weapon of weapons) {
      const nodeIndexBefore = ctx.createdNodes.length;
      synth.playWeaponSound(weapon);
      const shotNodes = ctx.createdNodes.slice(nodeIndexBefore);

      const oscillators = shotNodes.filter((n) => n instanceof MockOscillatorNode);
      const filters = shotNodes.filter((n) => n instanceof MockBiquadFilterNode);
      const noiseSources = shotNodes.filter((n) => n instanceof MockAudioBufferSourceNode);

      const oscSignatures = oscillators.map((osc) => ({
        type: osc.type,
        startFreq: osc.frequency.events.find((e) => e.type === 'setValueAtTime')?.value,
        endFreq: osc.frequency.events.find((e) => e.type === 'exponentialRampToValueAtTime')?.value,
        duration: osc.stopTime - osc.startTime,
      }));

      const filterSignatures = filters.map((f) => ({
        type: f.type,
        freq: f.frequency.value,
        freqEvents: f.frequency.events.map((e) => e.value),
        Q: f.Q.value,
      }));

      const sig = {
        weapon,
        oscCount: oscillators.length,
        filterCount: filters.length,
        hasNoise: noiseSources.length > 0,
        oscillators: oscSignatures,
        filters: filterSignatures,
      };

      signatures.set(weapon, sig);
    }

    // Verify each weapon profile against specifications
    // 1. Assalto
    const assalto = signatures.get('assalto');
    assert(assalto.oscCount === 1, 'Assalto has exactly 1 oscillator');
    assert(assalto.oscillators[0].type === 'sawtooth', 'Assalto osc is sawtooth');
    assert(assalto.oscillators[0].startFreq === 920, 'Assalto start freq is 920Hz');
    assert(assalto.oscillators[0].endFreq === 140, 'Assalto end freq is 140Hz');
    assert(assalto.filterCount >= 1, 'Assalto has noise filter');
    assert(assalto.filters[0].type === 'bandpass', 'Assalto filter is bandpass');
    assert(assalto.filters[0].freq === 2200, 'Assalto filter center is 2200Hz');
    assert(assalto.filters[0].Q === 2.5, 'Assalto filter Q is 2.5');

    // 2. Cecchino
    const cecchino = signatures.get('cecchino');
    assert(cecchino.oscCount === 2, 'Cecchino has 2 oscillators (rail screech + sub-bass)');
    const cecchinoOscTypes = cecchino.oscillators.map((o) => o.type).sort();
    assert(cecchinoOscTypes[0] === 'sawtooth' && cecchinoOscTypes[1] === 'sine', 'Cecchino osc types are sawtooth & sine');
    const railOsc = cecchino.oscillators.find((o) => o.type === 'sawtooth');
    const subOsc = cecchino.oscillators.find((o) => o.type === 'sine');
    assert(railOsc.startFreq === 2800 && railOsc.endFreq === 80, 'Cecchino rail screech sweeps 2800Hz -> 80Hz');
    assert(subOsc.startFreq === 160 && subOsc.endFreq === 32, 'Cecchino sub sweeps 160Hz -> 32Hz');
    const cecchinoHighQ = cecchino.filters.find((f) => f.Q === 5.0);
    assert(cecchinoHighQ !== undefined, 'Cecchino has high-resonance Q=5.0 filter');
    const cecchinoNoiseFilt = cecchino.filters.find((f) => f.freq === 1400);
    assert(cecchinoNoiseFilt !== undefined, 'Cecchino has 1400Hz noise filter');

    // 3. Pompa
    const pompa = signatures.get('pompa');
    assert(pompa.oscCount === 3, 'Pompa has 3 oscillators (square + detuned saw + sub)');
    const pompaOscTypes = pompa.oscillators.map((o) => o.type).sort();
    assert(
      pompaOscTypes.includes('square') && pompaOscTypes.includes('sawtooth') && pompaOscTypes.includes('sine'),
      'Pompa osc types include square, sawtooth, and sine'
    );
    const pompaSquare = pompa.oscillators.find((o) => o.type === 'square');
    const pompaSaw = pompa.oscillators.find((o) => o.type === 'sawtooth');
    assert(pompaSquare.startFreq === 360 && pompaSquare.endFreq === 55, 'Pompa square sweeps 360Hz -> 55Hz');
    assert(pompaSaw.startFreq === 280 && pompaSaw.endFreq === 45, 'Pompa saw sweeps 280Hz -> 45Hz');
    const pompaNoiseFilt = pompa.filters.find((f) => f.freq === 850);
    assert(pompaNoiseFilt !== undefined, 'Pompa has 850Hz noise blast filter');

    // 4. Mitraglietta
    const mitraglietta = signatures.get('mitraglietta');
    assert(mitraglietta.oscCount === 1, 'Mitraglietta has 1 oscillator');
    assert(mitraglietta.oscillators[0].type === 'triangle', 'Mitraglietta osc is triangle');
    assert(mitraglietta.oscillators[0].startFreq === 1350, 'Mitraglietta start freq is 1350Hz');
    assert(mitraglietta.oscillators[0].endFreq === 350, 'Mitraglietta end freq is 350Hz');
    assert(mitraglietta.oscillators[0].duration <= 0.07, 'Mitraglietta shot duration <= 0.07s for 10 RPS spam');
    const smgClick = mitraglietta.filters.find((f) => f.freq === 3200);
    assert(smgClick !== undefined, 'Mitraglietta has 3200Hz transient click filter');

    // 5. Coltello
    const coltello = signatures.get('coltello');
    assert(coltello.oscCount === 1, 'Coltello has 1 oscillator');
    assert(coltello.oscillators[0].type === 'sine', 'Coltello osc is sine');
    assert(coltello.oscillators[0].startFreq === 550, 'Coltello start freq is 550Hz');
    assert(coltello.oscillators[0].endFreq === 220, 'Coltello end freq is 220Hz');
    const coltelloWhoosh = coltello.filters.find((f) => f.type === 'bandpass');
    assert(coltelloWhoosh !== undefined, 'Coltello has bandpass whoosh filter');
    assert(
      JSON.stringify(coltelloWhoosh.freqEvents) === JSON.stringify([350, 1400, 300]),
      'Coltello whoosh sweeps 350Hz -> 1400Hz -> 300Hz'
    );

    // PAIRWISE COLLISION MATRIX
    console.log('\n  Checking pairwise dissimilarity matrix across all 10 weapon pairs...');
    for (let i = 0; i < weapons.length; i++) {
      for (let j = i + 1; j < weapons.length; j++) {
        const w1 = weapons[i];
        const w2 = weapons[j];
        const s1 = signatures.get(w1);
        const s2 = signatures.get(w2);

        // Compute fingerprint: (oscCount, oscTypesString, startFreqs, filterFreqs)
        const fp1 = `${s1.oscCount}:${s1.oscillators.map((o) => `${o.type}_${o.startFreq}`).join(',')}:${s1.filters.map((f) => f.freq).join(',')}`;
        const fp2 = `${s2.oscCount}:${s2.oscillators.map((o) => `${o.type}_${o.startFreq}`).join(',')}:${s2.filters.map((f) => f.freq).join(',')}`;

        assert(fp1 !== fp2, `Acoustic signature collision check: ${w1} vs ${w2} are uniquely distinct`);
      }
    }

    synth.dispose();
  }

  // TEST SUITE 2: ZERO-ASSET AUDIO VERIFICATION
  console.log('\n>>> TEST SUITE 2: Zero-Asset Audio Verification');
  {
    const audioDir = path.join(REPO_ROOT, 'game-web', 'src', 'audio');
    const files = fs.readdirSync(audioDir);
    const audioExtensions = ['.wav', '.mp3', '.ogg', '.flac', '.aac', '.m4a', '.weba', '.wma', '.aiff'];

    // Check game-web/src/audio/ contains zero audio files
    for (const f of files) {
      const ext = path.extname(f).toLowerCase();
      assert(!audioExtensions.includes(ext), `game-web/src/audio contains zero audio files: ${f}`);
    }

    // Check game-web/src/audio/soundSynth.ts references
    const synthCode = fs.readFileSync(path.join(audioDir, 'soundSynth.ts'), 'utf-8');
    for (const ext of audioExtensions) {
      assert(!synthCode.includes(ext), `soundSynth.ts contains no reference to audio extension '${ext}'`);
    }
    assert(!synthCode.includes('new Audio('), 'soundSynth.ts does not use HTMLAudioElement new Audio()');
    assert(!synthCode.includes('fetch('), 'soundSynth.ts does not use fetch()');
    assert(!synthCode.includes('XMLHttpRequest'), 'soundSynth.ts does not use XMLHttpRequest');

    // Repo-wide audio file inventory
    const publicAudioFiles = [];
    const publicDir = path.join(REPO_ROOT, 'game-web', 'public');
    if (fs.existsSync(publicDir)) {
      const pubFiles = fs.readdirSync(publicDir);
      for (const pf of pubFiles) {
        const ext = path.extname(pf).toLowerCase();
        if (audioExtensions.includes(ext)) {
          publicAudioFiles.push(pf);
        }
      }
    }
    console.log(`    Repo public audio files: [${publicAudioFiles.join(', ')}]`);
    assert(
      publicAudioFiles.length === 1 && publicAudioFiles[0] === 'Colossus March.mp3',
      'Only pre-existing menu BGM (Colossus March.mp3) exists in public directory; zero weapon SFX assets exist'
    );
  }

  // TEST SUITE 3: VOICE BUDGETING AND CONCURRENT STRESS
  console.log('\n>>> TEST SUITE 3: Rapid Click Spamming & Concurrency Budget');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];

    // Rapid spam: 1000 weapon shots
    for (let i = 0; i < 1000; i++) {
      const w = weapons[i % weapons.length];
      synth.playWeaponSound(w);
    }

    const activeVoices = synth['activeVoices'];
    assert(activeVoices.size <= 32, `Voice count clamped to <= 32 (actual: ${activeVoices.size})`);

    // Verify eviction: when at max (32), adding 1 more voice evicts the oldest
    let oldestVoiceStopped = false;
    const firstVoice = activeVoices.values().next().value;
    const origStop = firstVoice.stop;
    firstVoice.stop = function () {
      oldestVoiceStopped = true;
      origStop.apply(this, arguments);
    };

    synth.playWeaponSound('assalto');
    assert(oldestVoiceStopped, 'Oldest voice is evicted when voice budget exceeds 32');
    assert(activeVoices.size <= 32, 'Active voices remain clamped to <= 32 after eviction');

    synth.dispose();
    assert(activeVoices.size === 0, 'All voices cleared upon dispose()');
  }

  // TEST SUITE 4: EPHEMERAL NODE LIFECYCLE & ZERO LEAKS
  console.log('\n>>> TEST SUITE 4: Ephemeral Node Lifecycle & Zero Leak Disconnection');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const initialNodes = ctx.createdNodes.length;
    synth.playWeaponSound('cecchino');
    const shotNodes = ctx.createdNodes.slice(initialNodes);

    const schedulableSources = shotNodes.filter((n) => typeof n.triggerEnded === 'function');
    assert(schedulableSources.length >= 1, 'Cecchino shot has schedulable primary source');

    // Trigger onended
    schedulableSources[0].triggerEnded();

    for (const node of shotNodes) {
      assert(node.disconnected === true, `Ephemeral node ${node.nodeType} properly disconnected onended`);
      assert(node.disconnectCallCount >= 1, `Ephemeral node ${node.nodeType} disconnect() was called`);
    }

    synth.dispose();
  }

  // TEST SUITE 5: ADVERSARIAL INPUT FUZZING
  console.log('\n>>> TEST SUITE 5: Adversarial Input Fuzzing');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    // Abnormal weapon names
    const weirdWeapons = [
      '',
      '   ',
      'UNKNOWN_WEAPON_999',
      null,
      undefined,
      12345,
      -1,
      NaN,
      {},
      [],
      true,
      false,
    ];

    for (const ww of weirdWeapons) {
      synth.playWeaponSound(ww);
    }
    assert(true, 'Handled 12 fuzzed weapon inputs without crashing');

    // Volume boundary fuzzing
    const weirdVolumes = [-100, -0.001, 0, 0.00001, 1.0, 2.0, 5.0, 1000, Infinity, -Infinity, NaN, null, undefined];
    for (const wv of weirdVolumes) {
      synth.playWeaponSound('assalto', wv);
    }
    assert(true, 'Handled 13 volume boundary edge cases without crashing');

    // Multiple unlock and dispose idempotency
    await synth.unlock();
    await synth.unlock();
    assert(synth.isUnlocked(), 'Multiple unlock calls are idempotent');

    synth.dispose();
    synth.dispose();
    assert(synth.getAudioContext() === null, 'Double dispose() is safe and idempotent');

    // Playing sound after dispose
    synth.playWeaponSound('assalto');
    assert(true, 'playWeaponSound after dispose does not throw unhandled exception');
  }

  console.log('\n================================================================');
  console.log(`  VERIFICATION COMPLETE: ${passedTests}/${totalTests} ASSERTIONS PASSED (100%)`);
  console.log('================================================================\n');
}

runEmpiricalVerification().catch((err) => {
  console.error('EMPERICAL VERIFICATION FAILURE:', err);
  process.exit(1);
});

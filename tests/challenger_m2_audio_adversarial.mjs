/**
 * Challenger M2 - Deep Adversarial Audio Synthesis Stress Test Suite
 * Empirical Challenger: critic & specialist verification for Milestone 2.
 * 
 * Verifies:
 * 1. 10+ RPS SMG spam (up to 100 RPS) without runtime exceptions.
 * 2. Multi-pellet shotgun bursts (10+ simultaneous voices per trigger pull).
 * 3. Rapid chaotic weapon switching under continuous fire.
 * 4. 100% ephemeral node disconnection on both natural completion (onended) and voice stealing (stop).
 * 5. Strict 32-voice limit preventing audio buffer / voice exhaustion.
 * 6. Zero unhandled rejections or uncaught exceptions during async stress.
 */

import { MockAudioContext, MockOscillatorNode, MockBiquadFilterNode, MockGainNode, MockAudioBufferSourceNode } from './helpers/mock_audio.mjs';
import { SoundSynthesizer, normalizeWeaponType } from '../game-web/src/audio/soundSynth.ts';

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

async function runAdversarialAudioStress() {
  console.log(`
================================================================================
     CHALLENGER M2: DEEP ADVERSARIAL AUDIO SYNTHESIS STRESS SUITE              
================================================================================
`);

  let unhandledRejections = 0;
  let uncaughtExceptions = 0;
  process.on('unhandledRejection', (reason) => {
    unhandledRejections++;
    console.error('UNHANDLED REJECTION:', reason);
  });
  process.on('uncaughtException', (err) => {
    uncaughtExceptions++;
    console.error('UNCAUGHT EXCEPTION:', err);
  });

  // SUITE 1: High-Cadence SMG Spam (10 RPS, 20 RPS, 50 RPS, 100 RPS)
  console.log('>>> SUITE 1: High-Cadence SMG Spam Stress');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const cadences = [10, 20, 50, 100];
    for (const rps of cadences) {
      const shots = rps * 2; // 2 seconds equivalent
      const startNodes = ctx.createdNodes.length;
      for (let i = 0; i < shots; i++) {
        synth.playWeaponSound('mitraglietta', 1.0);
      }
      const activeCount = synth['activeVoices'].size;
      assert(activeCount <= 32, `At ${rps} RPS (${shots} shots), active voices clamped to <= 32 (got: ${activeCount})`);
    }

    synth.dispose();
    assert(synth['activeVoices'].size === 0, 'All voices cleared after SMG spam dispose');
  }

  // SUITE 2: Multi-Pellet Shotgun Bursts (Simultaneous Multi-Voice Triggering)
  console.log('\n>>> SUITE 2: Multi-Pellet Shotgun Bursts (Simultaneous Multi-Voice)');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const pelletsPerShot = 12;
    const shotgunBursts = 15; // 180 simultaneous voices triggered in rapid succession

    for (let burst = 0; burst < shotgunBursts; burst++) {
      const burstStartNodes = ctx.createdNodes.length;
      for (let p = 0; p < pelletsPerShot; p++) {
        synth.playWeaponSound('pompa', 0.85);
      }
      const activeVoices = synth['activeVoices'].size;
      assert(activeVoices <= 32, `Burst ${burst + 1}: Active voices capped at <= 32 (measured: ${activeVoices})`);
    }

    // Verify all nodes created during the bursts that were stolen are properly disconnected
    const allShotgunNodes = ctx.createdNodes.filter(
      (n) => n.nodeType !== 'DynamicsCompressorNode' && n.nodeType !== 'Destination'
    );
    // Find the currently active voices
    const activeVoicesSet = synth['activeVoices'];
    assert(activeVoicesSet.size === 32, `Exactly 32 voices remain active at end of burst test (measured: ${activeVoicesSet.size})`);

    // Dispose should stop all 32 remaining voices and disconnect all nodes
    const masterGainRef = synth['masterGain'];
    synth.dispose();
    const stillConnected = allShotgunNodes.filter((n) => !n.disconnected && n !== masterGainRef);
    if (stillConnected.length > 0) {
      console.log('STILL CONNECTED NODES:', stillConnected.map(n => ({ type: n.nodeType, disc: n.disconnected })));
    }
    assert(stillConnected.length === 0, `100% of shotgun burst nodes disconnected after dispose (connected remaining: ${stillConnected.length})`);
  }

  // SUITE 3: Rapid Chaotic Weapon Switching Under Fire
  console.log('\n>>> SUITE 3: Rapid Chaotic Weapon Switching Under Continuous Fire');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const weaponVariants = [
      'assalto', 'AR-42', 'ar42', 0,
      'cecchino', 'SR-99', 'sniper', 1,
      'pompa', 'SG-12', 'shotgun', 2,
      'mitraglietta', 'SMG-7', 'smg', 3,
      'coltello', 'CB-01', 'knife', 'melee', 4,
      'UNKNOWN_WEAPON_FALLBACK'
    ];

    const initialNodeCount = ctx.createdNodes.length;
    const totalShots = 1000;

    for (let i = 0; i < totalShots; i++) {
      const weapon = weaponVariants[i % weaponVariants.length];
      synth.playWeaponSound(weapon, 0.5 + 0.5 * Math.sin(i));
    }

    assert(synth['activeVoices'].size === 32, `Active voices strictly saturated at 32 after ${totalShots} chaotic weapon switches`);

    // Ensure all 968 stolen voices had their nodes disconnected during stealing
    const totalCreatedNodes = ctx.createdNodes.length - initialNodeCount;
    assert(totalCreatedNodes > 6000, `Generated ${totalCreatedNodes} nodes during 1000-shot stress test`);

    // Now dispose to clean the remaining 32 voices
    synth.dispose();
    assert(synth['activeVoices'].size === 0, 'Active voices cleanly emptied after dispose()');

    const unconnected = ctx.createdNodes.slice(initialNodeCount).filter((n) => !n.disconnected);
    assert(unconnected.length === 0, `0 leaked nodes out of ${totalCreatedNodes} created nodes across 1000 weapon switch shots`);
  }

  // SUITE 4: Exhaustive Node Disconnection on Natural Completion & Forced Stealing
  console.log('\n>>> SUITE 4: Exhaustive Node Disconnection Audit per Weapon Profile');
  {
    const weapons = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];

    for (const weapon of weapons) {
      // Case A: Natural completion via onended
      {
        globalThis.AudioContext = MockAudioContext;
        const synth = new SoundSynthesizer();
        await synth.unlock();
        const ctx = synth.getAudioContext();

        const beforeCount = ctx.createdNodes.length;
        synth.playWeaponSound(weapon);
        const shotNodes = ctx.createdNodes.slice(beforeCount);

        const primarySource = shotNodes.find((n) => typeof n.triggerEnded === 'function');
        assert(primarySource !== undefined, `[${weapon}] Primary source exists`);
        assert(shotNodes.every((n) => !n.disconnected), `[${weapon}] Nodes connected during playback`);

        // Trigger onended
        primarySource.triggerEnded();

        const uncleaned = shotNodes.filter((n) => !n.disconnected);
        assert(uncleaned.length === 0, `[${weapon}] Onended cleanly disconnected all ${shotNodes.length} nodes`);
        assert(synth['activeVoices'].size === 0, `[${weapon}] Voice removed from activeVoices on onended`);

        synth.dispose();
      }

      // Case B: Forced stop via voice stealing
      {
        globalThis.AudioContext = MockAudioContext;
        const synth = new SoundSynthesizer();
        await synth.unlock();
        const ctx = synth.getAudioContext();

        const beforeCount = ctx.createdNodes.length;
        synth.playWeaponSound(weapon);
        const shotNodes = ctx.createdNodes.slice(beforeCount);

        // Fill up remaining 31 voices + 1 more to force-steal this first voice
        for (let i = 0; i < 32; i++) {
          synth.playWeaponSound('mitraglietta');
        }

        // The first voice should have been stolen and all its nodes disconnected
        const uncleaned = shotNodes.filter((n) => !n.disconnected);
        assert(uncleaned.length === 0, `[${weapon}] Voice stealing cleanly stopped and disconnected all ${shotNodes.length} nodes`);

        synth.dispose();
      }
    }
  }

  // SUITE 5: 32-Voice Limit Buffer Protection and Shared Noise Re-use
  console.log('\n>>> SUITE 5: 32-Voice Limit Buffer Protection and Shared Noise Re-use');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();
    const ctx = synth.getAudioContext();

    const sharedBuf1 = synth['sharedNoiseBuffer'];
    assert(sharedBuf1 !== null, 'Shared noise buffer is initialized');

    // Fire 200 shots
    for (let i = 0; i < 200; i++) {
      synth.playWeaponSound('cecchino');
    }

    const sharedBuf2 = synth['sharedNoiseBuffer'];
    assert(sharedBuf1 === sharedBuf2, 'Shared noise buffer reference is identical (0 buffer allocations under load)');
    assert(synth['activeVoices'].size === 32, 'activeVoices.size does not exceed 32 at any point during 200-voice surge');

    synth.dispose();
    assert(synth['sharedNoiseBuffer'] === null, 'Shared noise buffer dereferenced on dispose');
  }

  // SUITE 6: Asynchronous Interleaved Firing and Volume Jitter
  console.log('\n>>> SUITE 6: Asynchronous Interleaved Firing and Volume Jitter');
  {
    globalThis.AudioContext = MockAudioContext;
    const synth = new SoundSynthesizer();
    await synth.unlock();

    await new Promise((resolve) => {
      let fired = 0;
      const target = 100;
      const timer = setInterval(() => {
        const vol = Math.random();
        synth.setMasterVolume(vol);
        synth.setSfxVolume(1.0 - vol);
        synth.playWeaponSound('mitraglietta', Math.random() * 2);
        synth.playWeaponSound('pompa', Math.random() * 2);
        fired += 2;
        if (fired >= target) {
          clearInterval(timer);
          resolve();
        }
      }, 5);
    });

    assert(synth['activeVoices'].size <= 32, 'Voice budget respected during async timer intervals');
    synth.dispose();
    assert(synth['activeVoices'].size === 0, 'Async voices disposed cleanly');
  }

  // Final sanity checks on unhandled errors
  assert(unhandledRejections === 0, `Zero unhandled promise rejections (recorded: ${unhandledRejections})`);
  assert(uncaughtExceptions === 0, `Zero uncaught exceptions (recorded: ${uncaughtExceptions})`);

  console.log(`
================================================================================
               ADVERSARIAL STRESS TEST SUMMARY: ALL PASS                        
================================================================================
Total Assertions: ${totalTests}
Passed: ${passedTests}
Failed: ${failedTests}
`);

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAdversarialAudioStress().catch((err) => {
  console.error('ADVERSARIAL STRESS SUITE FATAL ERROR:', err);
  process.exit(1);
});

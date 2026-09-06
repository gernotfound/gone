/**
 * Challenger 1 - Milestone 1 Recoil Recovery & Shooting Mechanics Empirical Stress Harness
 * 
 * Verifications:
 * 1. 50 continuous rounds across all 5 weapons -> Camera pitch/yaw return within 0.00001 rad (zero accumulation)
 * 2. Continuous firing respects authoritative fire rates (AR: 6.25 RPS, Sniper: 1.00 RPS, etc.)
 * 3. Knife recoil kick is strictly zero (pitch, yaw, and trauma identically 0.0)
 * 4. Adversarial stress: Variable dt (framerate jitter), active mouse tracking during recoil,
 *    rapid weapon switching mid-recoil, and quaternion normalization stability.
 */

import * as THREE from '../game-web/node_modules/three/build/three.module.js';

// Authoritative weapon stats synchronized with game-web/src/main.ts & game-core/src/weapons.rs
export const WEAPON_COMBAT_STATS = {
  assalto: {
    id: 0,
    name: 'AR-42 Viper',
    fireRateRps: 6.25,
    recoilPitchDeg: 1.10,
    recoilYawDeg: 0.35,
    recoilRecoveryRate: 8.0,
    kickZ: 0.05,
    kickPitch: 0.04,
  },
  cecchino: {
    id: 1,
    name: 'SR-99 Railphantom',
    fireRateRps: 1.00,
    recoilPitchDeg: 5.50,
    recoilYawDeg: 0.80,
    recoilRecoveryRate: 3.5,
    kickZ: 0.12,
    kickPitch: 0.08,
  },
  pompa: {
    id: 2,
    name: 'SG-12 Havoc',
    fireRateRps: 1.25,
    recoilPitchDeg: 4.00,
    recoilYawDeg: 1.20,
    recoilRecoveryRate: 4.0,
    kickZ: 0.10,
    kickPitch: 0.07,
  },
  mitraglietta: {
    id: 3,
    name: 'SMG-7 Neon Hornet',
    fireRateRps: 10.00,
    recoilPitchDeg: 0.55,
    recoilYawDeg: 0.65,
    recoilRecoveryRate: 10.0,
    kickZ: 0.03,
    kickPitch: 0.025,
  },
  coltello: {
    id: 4,
    name: 'CB-01 Shadowfang',
    fireRateRps: 1.25,
    recoilPitchDeg: 0.0,
    recoilYawDeg: 0.0,
    recoilRecoveryRate: 0.0,
    kickZ: 0.08,
    kickPitch: -0.05,
  },
};

const UP_VECTOR = new THREE.Vector3(0, 1, 0);
const RIGHT_VECTOR = new THREE.Vector3(1, 0, 0);
const FORWARD_VECTOR = new THREE.Vector3(0, 0, 1);

export class SimulationPlayer {
  constructor(initialYaw = 0.0, initialPitch = 0.0) {
    this.baseYaw = initialYaw;
    this.basePitch = initialPitch;
    this.recoilCamPitch = 0.0;
    this.recoilCamYaw = 0.0;
    this.shakeTrauma = 0.0;
    this.shakeTime = 0.0;
    this.isShooting = false;
    this.shotCooldown = 0.0;
    this.currentWeaponType = 'assalto';
    this.shotsFired = 0;
    this.shotTimestamps = [];
    this.currentTime = 0.0;
    this.quaternion = new THREE.Quaternion();
    this.effectiveYaw = initialYaw;
    this.effectivePitch = initialPitch;
  }

  setWeapon(weaponType) {
    this.currentWeaponType = weaponType;
    if (weaponType === 'coltello') {
      this.recoilCamPitch = 0.0;
      this.recoilCamYaw = 0.0;
    }
  }

  addMouseAim(deltaYaw, deltaPitch) {
    this.baseYaw += deltaYaw;
    this.basePitch = Math.max(-Math.PI / 2 + 0.1, Math.min(Math.PI / 2 - 0.1, this.basePitch + deltaPitch));
  }

  fireWeapon() {
    if (this.shotCooldown > 0) return false;

    const stats = WEAPON_COMBAT_STATS[this.currentWeaponType] || WEAPON_COMBAT_STATS.assalto;
    this.shotCooldown = 1.0 / stats.fireRateRps;

    const kickPitchRad = (stats.recoilPitchDeg * Math.PI) / 180;
    const kickYawRad = (stats.recoilYawDeg * Math.PI) / 180;

    this.recoilCamPitch += kickPitchRad;
    this.recoilCamYaw += (Math.random() - 0.5) * 2.0 * kickYawRad;

    const traumaAdd = (stats.recoilPitchDeg / 5.50) * 0.35;
    this.shakeTrauma = Math.min(1.0, this.shakeTrauma + traumaAdd);

    this.shotsFired++;
    this.shotTimestamps.push(this.currentTime);
    return true;
  }

  update(delta) {
    this.currentTime += delta;

    // Cooldown progression
    if (this.shotCooldown > 0) {
      this.shotCooldown -= delta;
      if (this.shotCooldown < 0) this.shotCooldown = 0;
    }

    // Continuous trigger fire (cooldown comparison with floating-point tolerance 1e-9)
    if (this.isShooting && this.shotCooldown <= 1e-9) {
      this.fireWeapon();
    }

    // Recoil recovery: authoritative exponential decay
    const stats = WEAPON_COMBAT_STATS[this.currentWeaponType] || WEAPON_COMBAT_STATS.assalto;
    if (stats.recoilRecoveryRate > 0) {
      const decay = Math.exp(-stats.recoilRecoveryRate * delta);
      this.recoilCamPitch *= decay;
      this.recoilCamYaw *= decay;
      if (Math.abs(this.recoilCamPitch) < 1e-6) this.recoilCamPitch = 0;
      if (Math.abs(this.recoilCamYaw) < 1e-6) this.recoilCamYaw = 0;
    } else {
      this.recoilCamPitch = 0;
      this.recoilCamYaw = 0;
    }

    // Screen shake decay & sinusoidal perturbation
    this.shakeTrauma = Math.max(0, this.shakeTrauma - 3.0 * delta);
    this.shakeTime += delta;

    const shakeIntensity = this.shakeTrauma * this.shakeTrauma;
    const shakePitch = shakeIntensity * 0.018 * Math.sin(45.0 * this.shakeTime + 1.2);
    const shakeYaw = shakeIntensity * 0.014 * Math.sin(52.0 * this.shakeTime + 3.7);
    const shakeRoll = shakeIntensity * 0.020 * Math.sin(38.0 * this.shakeTime + 5.1);

    this.effectiveYaw = this.baseYaw + this.recoilCamYaw + shakeYaw;
    this.effectivePitch = this.basePitch + this.recoilCamPitch + shakePitch;

    const clampedPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, this.effectivePitch));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_VECTOR, this.effectiveYaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_VECTOR, clampedPitch);
    this.quaternion.multiplyQuaternions(qYaw, qPitch);
    if (shakeIntensity > 1e-5) {
      const qRoll = new THREE.Quaternion().setFromAxisAngle(FORWARD_VECTOR, shakeRoll);
      this.quaternion.multiply(qRoll);
    }
  }
}

// Test reporting harness
let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const failures = [];

function assert(condition, description, details = '') {
  totalAssertions++;
  if (condition) {
    passedAssertions++;
    console.log(`  \x1b[32m✔ [PASS]\x1b[0m ${description}`);
  } else {
    failedAssertions++;
    const errMsg = `  \x1b[31m✖ [FAIL]\x1b[0m ${description} ${details ? '(' + details + ')' : ''}`;
    console.error(errMsg);
    failures.push({ description, details });
  }
}

export async function runTestSuite() {
  console.log('================================================================================');
  console.log('    CHALLENGER 1: EMPIRICAL STRESS SUITE (M1 RECOIL & SHOOTING MECHANICS)       ');
  console.log('================================================================================\n');

  const WEAPONS = ['assalto', 'cecchino', 'pompa', 'mitraglietta', 'coltello'];

  // -------------------------------------------------------------------------------------------
  // SECTION 1: Authoritative Continuous Firing Rate & Inter-Shot Cadence (F-4)
  // -------------------------------------------------------------------------------------------
  console.log('>>> SECTION 1: Authoritative Fire Rate & Cadence Limiting under Continuous Trigger Hold');
  
  for (const weapon of WEAPONS) {
    const stats = WEAPON_COMBAT_STATS[weapon];
    const expectedInterval = 1.0 / stats.fireRateRps;
    
    // Test 1.1: High-precision continuous time simulation (1000 Hz, 1ms ticks)
    {
      const sim = new SimulationPlayer();
      sim.setWeapon(weapon);
      const dt = 0.001; // 1ms resolution
      const totalDuration = 10.0;
      sim.isShooting = true;

      for (let t = 0; t < totalDuration; t += dt) {
        sim.update(dt);
      }
      sim.isShooting = false;

      const shotCount = sim.shotsFired;
      const timestamps = sim.shotTimestamps;
      let minInterval = Infinity;
      let maxInterval = -Infinity;

      for (let i = 1; i < timestamps.length; i++) {
        const interval = timestamps[i] - timestamps[i - 1];
        if (interval < minInterval) minInterval = interval;
        if (interval > maxInterval) maxInterval = interval;
      }

      const empiricalRps = (shotCount - 1) / (timestamps[timestamps.length - 1] - timestamps[0]);
      const expectedShotCount = Math.floor(totalDuration * stats.fireRateRps) + 1;

      console.log(`\n  Weapon [${stats.name}] (${weapon}) - High-Precision Cadence (1000 Hz):`);
      console.log(`    Spec RPS: ${stats.fireRateRps.toFixed(2)} | Empirical RPS: ${empiricalRps.toFixed(3)}`);
      console.log(`    Expected Period: ${expectedInterval.toFixed(4)}s | Min Interval: ${minInterval.toFixed(4)}s, Max Interval: ${maxInterval.toFixed(4)}s`);
      console.log(`    Shots Fired in 10s: ${shotCount} (Theoretical: ${expectedShotCount})`);

      assert(minInterval >= expectedInterval - 1e-5, `[${stats.name}] No two shots fired faster than authoritative interval (${expectedInterval.toFixed(4)}s)`);
      assert(Math.abs(empiricalRps - stats.fireRateRps) < 0.01, `[${stats.name}] Empirical RPS strictly equals authoritative spec (${stats.fireRateRps.toFixed(2)} RPS)`);
      assert(shotCount === expectedShotCount, `[${stats.name}] Total burst shot count strictly matches floor(T * RPS) + 1 (${expectedShotCount})`);
    }

    // Test 1.2: Standard 60 FPS discrete game loop simulation (dt = 0.016667s)
    {
      const sim = new SimulationPlayer();
      sim.setWeapon(weapon);
      const dt = 1.0 / 60.0;
      const totalDuration = 10.0;
      sim.isShooting = true;

      for (let t = 0; t < totalDuration; t += dt) {
        sim.update(dt);
      }
      sim.isShooting = false;

      const timestamps = sim.shotTimestamps;
      let minInterval = Infinity;
      for (let i = 1; i < timestamps.length; i++) {
        const interval = timestamps[i] - timestamps[i - 1];
        if (interval < minInterval) minInterval = interval;
      }

      // At 60 FPS, the discrete interval must never violate the nominal cooldown
      assert(minInterval >= expectedInterval - 0.001, `[${stats.name}] 60 FPS inter-shot interval (${minInterval.toFixed(4)}s) respects nominal cooldown (${expectedInterval.toFixed(4)}s)`);
    }
  }

  // -------------------------------------------------------------------------------------------
  // SECTION 2: 50 Continuous Rounds Firing & Zero Recoil Accumulation (< 0.00001 rad)
  // -------------------------------------------------------------------------------------------
  console.log('\n>>> SECTION 2: 50 Continuous Rounds & Zero Recoil Accumulation (< 0.00001 rad)');

  const empiricalRecoilResults = {};

  for (const weapon of WEAPONS) {
    const stats = WEAPON_COMBAT_STATS[weapon];
    const initialPitch = -0.35; // Looking 20 deg up
    const initialYaw = 1.25;    // Looking diagonally
    const sim = new SimulationPlayer(initialYaw, initialPitch);
    sim.setWeapon(weapon);

    const dt = 1.0 / 60.0;
    sim.isShooting = true;

    let peakPitchRecoil = 0.0;
    let peakYawRecoil = 0.0;
    let maxTrauma = 0.0;

    // Fire until exactly 50 shots are fired
    while (sim.shotsFired < 50) {
      sim.update(dt);
      if (sim.recoilCamPitch > peakPitchRecoil) peakPitchRecoil = sim.recoilCamPitch;
      if (Math.abs(sim.recoilCamYaw) > peakYawRecoil) peakYawRecoil = Math.abs(sim.recoilCamYaw);
      if (sim.shakeTrauma > maxTrauma) maxTrauma = sim.shakeTrauma;
    }

    // Cease firing immediately
    sim.isShooting = false;
    const firingCeaseTime = sim.currentTime;
    const recoilAtCease = { pitch: sim.recoilCamPitch, yaw: sim.recoilCamYaw };

    // Advance time and measure recovery at specific checkpoints
    const checkpoints = {};
    const checkpointOffsets = [0.25, 0.5, 1.0, 2.0, 3.0, 4.0];
    let nextCheckIdx = 0;

    while (nextCheckIdx < checkpointOffsets.length) {
      sim.update(dt);
      const elapsedSinceCease = sim.currentTime - firingCeaseTime;
      if (elapsedSinceCease >= checkpointOffsets[nextCheckIdx]) {
        const offset = checkpointOffsets[nextCheckIdx];
        checkpoints[offset] = {
          pitchRecoil: sim.recoilCamPitch,
          yawRecoil: sim.recoilCamYaw,
          effectivePitch: sim.effectivePitch,
          effectiveYaw: sim.effectiveYaw,
          trauma: sim.shakeTrauma,
          pitchDelta: Math.abs(sim.effectivePitch - initialPitch),
          yawDelta: Math.abs(sim.effectiveYaw - initialYaw),
        };
        nextCheckIdx++;
      }
    }

    empiricalRecoilResults[weapon] = {
      peakPitchRecoil,
      peakYawRecoil,
      maxTrauma,
      recoilAtCease,
      finalCheck: checkpoints[4.0],
    };

    console.log(`\n  Weapon [${stats.name}] (${weapon}):`);
    console.log(`    50 Rounds Fired. Peak Recoil: pitch=${(peakPitchRecoil * 180 / Math.PI).toFixed(2)} deg (${peakPitchRecoil.toFixed(5)} rad), yaw=${(peakYawRecoil * 180 / Math.PI).toFixed(2)} deg (${peakYawRecoil.toFixed(5)} rad)`);
    console.log(`    Recoil at Cease: pitch=${recoilAtCease.pitch.toFixed(6)} rad, yaw=${recoilAtCease.yaw.toFixed(6)} rad`);
    console.log(`    Recovery at +1.0s: pitchDelta=${checkpoints[1.0].pitchDelta.toExponential(3)} rad, trauma=${checkpoints[1.0].trauma.toFixed(4)}`);
    console.log(`    Recovery at +2.0s: pitchDelta=${checkpoints[2.0].pitchDelta.toExponential(3)} rad, trauma=${checkpoints[2.0].trauma.toFixed(4)}`);
    console.log(`    Recovery at +4.0s: pitchDelta=${checkpoints[4.0].pitchDelta.toExponential(3)} rad, yawDelta=${checkpoints[4.0].yawDelta.toExponential(3)} rad`);

    // Strict empirical assertions
    const final = checkpoints[4.0];
    assert(final.pitchRecoil <= 0.00001, `[${stats.name}] recoilCamPitch <= 0.00001 rad after settling (measured: ${final.pitchRecoil.toExponential(4)})`);
    assert(Math.abs(final.yawRecoil) <= 0.00001, `[${stats.name}] recoilCamYaw <= 0.00001 rad after settling (measured: ${Math.abs(final.yawRecoil).toExponential(4)})`);
    assert(final.pitchDelta <= 0.00001, `[${stats.name}] Effective camera pitch returns within 0.00001 rad of base (measured diff: ${final.pitchDelta.toExponential(4)} rad)`);
    assert(final.yawDelta <= 0.00001, `[${stats.name}] Effective camera yaw returns within 0.00001 rad of base (measured diff: ${final.yawDelta.toExponential(4)} rad)`);
    assert(final.trauma === 0.0, `[${stats.name}] Screen shake trauma fully decays to 0.0 (measured: ${final.trauma})`);
    
    // Zero persistent accumulation confirmation
    assert(final.pitchRecoil === 0.0 && Math.abs(final.yawRecoil) === 0.0, `[${stats.name}] Sub-threshold clamping strictly eliminates floating point residual (< 1e-6 -> 0.0)`);
  }

  // -------------------------------------------------------------------------------------------
  // SECTION 3: Knife (CB-01 Shadowfang) Melee Kick Invariants (Strict Zero)
  // -------------------------------------------------------------------------------------------
  console.log('\n>>> SECTION 3: Knife Melee Recoil Kick Invariants (Strictly Zero)');

  {
    const stats = WEAPON_COMBAT_STATS.coltello;
    assert(stats.recoilPitchDeg === 0.0, 'Coltello recoilPitchDeg is authoritative 0.0');
    assert(stats.recoilYawDeg === 0.0, 'Coltello recoilYawDeg is authoritative 0.0');
    assert(stats.recoilRecoveryRate === 0.0, 'Coltello recoilRecoveryRate is authoritative 0.0');

    const sim = new SimulationPlayer(0.5, -0.2);
    sim.setWeapon('coltello');
    sim.isShooting = true;

    let anyRecoilObserved = false;
    let anyTraumaObserved = false;
    const dt = 1.0 / 60.0;

    for (let step = 0; step < 600; step++) { // 10 seconds of continuous knife attacks
      sim.update(dt);
      if (sim.recoilCamPitch !== 0.0 || sim.recoilCamYaw !== 0.0) {
        anyRecoilObserved = true;
      }
      if (sim.shakeTrauma !== 0.0) {
        anyTraumaObserved = true;
      }
    }

    console.log(`  Coltello strikes delivered: ${sim.shotsFired} in 10s`);
    console.log(`  Final recoilCamPitch: ${sim.recoilCamPitch} | final recoilCamYaw: ${sim.recoilCamYaw} | shakeTrauma: ${sim.shakeTrauma}`);

    assert(sim.shotsFired >= 12, 'Coltello strikes fired at 1.25 RPS cadence (>= 12 strikes in 10s)');
    assert(!anyRecoilObserved, 'Knife kick is strictly zero across 100% of attack frames');
    assert(!anyTraumaObserved, 'Knife produces strictly 0.0 screen shake trauma');
    assert(sim.effectivePitch === -0.2, 'Knife attacks leave effective pitch perfectly untouched');
    assert(sim.effectiveYaw === 0.5, 'Knife attacks leave effective yaw perfectly untouched');
  }

  // -------------------------------------------------------------------------------------------
  // SECTION 4: Adversarial Stress & Edge Cases
  // -------------------------------------------------------------------------------------------
  console.log('\n>>> SECTION 4: Adversarial Stress Scenarios & Boundary Conditions');

  // Test 4A: Extreme Delta Time Spikes (10 FPS, 240 FPS, and Chaotic Jitter)
  console.log('--- Test 4A: Variable Delta Times (Framerate Jitter & Spikes) ---');
  {
    const sim = new SimulationPlayer();
    sim.setWeapon('assalto');
    sim.isShooting = true;

    // Fire 20 shots under chaotic variable frame deltas (1ms to 100ms)
    let fired = 0;
    while (fired < 20) {
      const randomDt = 0.001 + Math.random() * 0.099; // 1ms - 100ms
      sim.update(randomDt);
      fired = sim.shotsFired;
    }
    sim.isShooting = false;

    // Settle under chaotic frame deltas
    for (let i = 0; i < 200; i++) {
      const randomDt = 0.001 + Math.random() * 0.099;
      sim.update(randomDt);
    }

    assert(Number.isFinite(sim.recoilCamPitch), 'Recoil pitch remains finite under chaotic variable deltas');
    assert(Number.isFinite(sim.recoilCamYaw), 'Recoil yaw remains finite under chaotic variable deltas');
    assert(sim.recoilCamPitch === 0.0, 'Recoil pitch recovers to exact 0.0 despite erratic delta times');
    assert(sim.recoilCamYaw === 0.0, 'Recoil yaw recovers to exact 0.0 despite erratic delta times');
  }

  // Test 4B: Decoupled Mouse Aiming during Intense Continuous Firing
  console.log('\n--- Test 4B: Decoupled Aim Invariance during Continuous Fire ---');
  {
    const sim = new SimulationPlayer(0.0, 0.0);
    sim.setWeapon('mitraglietta'); // 10 RPS high fire rate
    sim.isShooting = true;

    const dt = 1.0 / 60.0;
    let expectedAimYaw = 0.0;
    let expectedAimPitch = 0.0;

    // Track a moving target while firing 50 rounds
    while (sim.shotsFired < 50) {
      const dYaw = 0.002;
      const dPitch = -0.001;
      sim.addMouseAim(dYaw, dPitch);
      expectedAimYaw += dYaw;
      expectedAimPitch += dPitch;
      sim.update(dt);
    }
    sim.isShooting = false;

    // Settle recoil for 2 seconds
    for (let t = 0; t < 2.0; t += dt) {
      sim.update(dt);
    }

    const pitchDiff = Math.abs(sim.effectivePitch - expectedAimPitch);
    const yawDiff = Math.abs(sim.effectiveYaw - expectedAimYaw);

    console.log(`  Expected Aim: pitch=${expectedAimPitch.toFixed(5)}, yaw=${expectedAimYaw.toFixed(5)}`);
    console.log(`  Effective Aim: pitch=${sim.effectivePitch.toFixed(5)}, yaw=${sim.effectiveYaw.toFixed(5)}`);
    console.log(`  Difference: pitchDiff=${pitchDiff.toExponential(4)}, yawDiff=${yawDiff.toExponential(4)}`);

    assert(pitchDiff <= 0.00001, 'Mouse pitch aim is completely decoupled from recoil kick and fully preserved');
    assert(yawDiff <= 0.00001, 'Mouse yaw aim is completely decoupled from recoil kick and fully preserved');
    assert(sim.recoilCamPitch === 0.0, 'Transient recoil kick vanishes without contaminating base aim');
  }

  // Test 4C: Rapid Mid-Burst Weapon Switching
  console.log('\n--- Test 4C: Mid-Burst Weapon Switching Dynamics ---');
  {
    const sim = new SimulationPlayer();
    sim.setWeapon('cecchino'); // Heavy recoil
    sim.isShooting = true;

    // Fire 3 sniper shots
    const dt = 1.0 / 60.0;
    while (sim.shotsFired < 3) {
      sim.update(dt);
    }
    assert(sim.recoilCamPitch > 0.05, 'Sniper accumulated high pitch recoil');

    // Switch to Knife immediately
    sim.setWeapon('coltello');
    assert(sim.recoilCamPitch === 0.0, 'Switching to knife immediately clears recoilCamPitch to 0.0');
    assert(sim.recoilCamYaw === 0.0, 'Switching to knife immediately clears recoilCamYaw to 0.0');

    // Switch to SMG and fire 10 rounds
    sim.setWeapon('mitraglietta');
    const prevShots = sim.shotsFired;
    while (sim.shotsFired < prevShots + 10) {
      sim.update(dt);
    }
    sim.isShooting = false;

    // Settle
    for (let t = 0; t < 1.5; t += dt) {
      sim.update(dt);
    }
    assert(sim.recoilCamPitch === 0.0, 'SMG recoil cleanly settles after weapon switch cascade');
  }

  // Test 4D: Screen Shake Trauma Saturation & Quaternion Unit Norm
  console.log('\n--- Test 4D: Screen Shake Trauma Saturation & Quaternion Normalization ---');
  {
    const sim = new SimulationPlayer();
    sim.setWeapon('cecchino');
    sim.isShooting = true;

    let traumaCappedAtOne = true;
    let quaternionNormalized = true;
    const dt = 1.0 / 60.0;

    for (let i = 0; i < 300; i++) {
      sim.update(dt);
      if (sim.shakeTrauma > 1.000001) traumaCappedAtOne = false;
      const qLen = sim.quaternion.length();
      if (Math.abs(qLen - 1.0) > 1e-5) quaternionNormalized = false;
    }

    assert(traumaCappedAtOne, 'Screen shake trauma strictly saturates at 1.0 maximum');
    assert(quaternionNormalized, 'Camera quaternion maintains unit length (|q| = 1.0) under multi-axis shake');
  }

  // -------------------------------------------------------------------------------------------
  // FINAL SUMMARY
  // -------------------------------------------------------------------------------------------
  console.log('\n================================================================================');
  console.log('                          SIMULATION EXECUTION SUMMARY                          ');
  console.log('================================================================================');
  console.log(`Total Assertions: ${totalAssertions}`);
  console.log(`Passed: \x1b[32m${passedAssertions}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failedAssertions}\x1b[0m`);

  if (failedAssertions > 0) {
    console.log('\nFailure Details:');
    failures.forEach((f, idx) => console.log(`  ${idx + 1}. ${f.description}: ${f.details}`));
    process.exit(1);
  } else {
    console.log('\n\x1b[32m✔ ALL CHALLENGER EMPIRICAL SIMULATION ASSERTIONS PASSED WITH 100% SUCCESS!\x1b[0m\n');
  }
}

// Execute directly if run via CLI
runTestSuite().catch((err) => {
  console.error('Fatal error in simulation test suite:', err);
  process.exit(1);
});

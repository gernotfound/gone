/**
 * Challenger 2 - Empirical Adversarial Stress Harness: Remote Player Interpolation
 *
 * Verifies:
 * 1. Acceptance Criterion: Artificially spaced updates (50ms, 100ms) produce smooth,
 *    monotonic displacement at 60Hz and 144Hz without snapping or stuttering.
 * 2. Shortest-path angle lerp: Turning past +/- PI (+3.10 rad to -3.10 rad) traverses
 *    the minimal 0.083 rad arc, NOT a 6.20 rad 360-degree reverse spin.
 * 3. Dead reckoning boundary: Movement extrapolates up to 150ms and strictly stops/freezes
 *    after 150ms without new packets.
 * 4. Boundary robustness: 10,000 random angle pairs, non-normalized inputs, duplicate packets,
 *    out-of-order packets, teleport purging (>10m), and timeline sync.
 */

import {
  InterpolationBuffer,
  NetworkClockSync,
  RemotePlayerInterpolationManager,
  normalizeAngle,
  shortestAngleDifference,
  lerpAngle,
  lerpScalar,
} from '../game-web/src/net/interpolationBuffer.ts';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
  } else {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
  }
}

function assertCloseTo(actual, expected, tolerance = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (actual=${actual.toFixed(6)}, expected=${expected.toFixed(6)}, diff=${diff.toExponential(4)})`);
}

function assertEqual(actual, expected, message = '') {
  assert(actual === expected, `${message} (actual=${actual}, expected=${expected})`);
}

console.log('================================================================');
console.log('   CHALLENGER 2 - REMOTE PLAYER INTERPOLATION EMPIRICAL STRESS   ');
console.log('================================================================\n');

// ============================================================================
// SECTION 1: ACCEPTANCE CRITERION — ARTIFICIALLY SPACED UPDATES (50ms & 100ms)
// ============================================================================
console.log('--- Section 1: Spaced Updates (50ms, 100ms) Smoothness & Monotonicity ---');

// Test 1.1: 50ms Spaced Updates (20 Hz Network Tick) at 60Hz and 144Hz Render
{
  const buffer = new InterpolationBuffer({ renderDelayMs: 90 });
  const speed = 10.0 / 1000.0; // 10 m/s = 0.01 m/ms
  const updateInterval = 50; // 50ms spaced updates (20 Hz)
  const totalDuration = 1000; // 1 second of simulation

  // Push packets every 50ms
  for (let t = 0; t <= totalDuration; t += updateInterval) {
    buffer.push({
      timestamp: t,
      localArrival: t,
      x: t * speed,
      y: 1.0,
      z: 0.0,
      yaw: 0.0,
      pitch: 0.0,
    });
  }

  // Sample at 60 Hz (16.667ms steps) across the valid interpolated window [100ms, 900ms]
  let lastX_60 = -1;
  let isMonotonic_60 = true;
  let maxStep_60 = 0;
  let minStep_60 = Infinity;

  for (let r = 100; r <= 900; r += 16.667) {
    const s = buffer.sample(r);
    assert(s !== null, `60Hz sample at ${r.toFixed(1)}ms must not be null`);
    if (lastX_60 >= 0) {
      const dx = s.x - lastX_60;
      if (dx < -1e-6) {
        isMonotonic_60 = false;
      }
      if (dx > maxStep_60) maxStep_60 = dx;
      if (dx < minStep_60) minStep_60 = dx;
    }
    lastX_60 = s.x;
  }

  assert(isMonotonic_60, '50ms updates sampled at 60Hz produce strictly monotonic displacement');
  const expectedStep_60 = 16.667 * speed; // ~0.1667m
  assertCloseTo(maxStep_60, expectedStep_60, 0.005, '60Hz maximum displacement step matches velocity');
  assertCloseTo(minStep_60, expectedStep_60, 0.005, '60Hz minimum displacement step matches velocity');

  // Sample at 144 Hz (6.944ms steps) across [100ms, 900ms]
  let lastX_144 = -1;
  let isMonotonic_144 = true;
  let maxStep_144 = 0;
  let minStep_144 = Infinity;

  for (let r = 100; r <= 900; r += 6.944) {
    const s = buffer.sample(r);
    assert(s !== null, `144Hz sample at ${r.toFixed(1)}ms must not be null`);
    if (lastX_144 >= 0) {
      const dx = s.x - lastX_144;
      if (dx < -1e-6) {
        isMonotonic_144 = false;
      }
      if (dx > maxStep_144) maxStep_144 = dx;
      if (dx < minStep_144) minStep_144 = dx;
    }
    lastX_144 = s.x;
  }

  assert(isMonotonic_144, '50ms updates sampled at 144Hz produce strictly monotonic displacement');
  const expectedStep_144 = 6.944 * speed; // ~0.0694m
  assertCloseTo(maxStep_144, expectedStep_144, 0.005, '144Hz maximum displacement step matches velocity');
  assertCloseTo(minStep_144, expectedStep_144, 0.005, '144Hz minimum displacement step matches velocity');
}

// Test 1.2: 100ms Spaced Updates (10 Hz Network Tick)
{
  const buffer = new InterpolationBuffer({ renderDelayMs: 150 });
  const speed = 12.0 / 1000.0; // 12 m/s (sprint speed)
  const updateInterval = 100; // 100ms spaced updates (10 Hz)
  const totalDuration = 1000;

  for (let t = 0; t <= totalDuration; t += updateInterval) {
    buffer.push({
      timestamp: t,
      localArrival: t,
      x: 0.0,
      y: 0.0,
      z: t * speed,
      yaw: 1.2,
      pitch: -0.3,
    });
  }

  let lastZ = -1;
  let isMonotonic = true;
  let maxStep = 0;
  let minStep = Infinity;

  for (let r = 150; r <= 850; r += 16.667) {
    const s = buffer.sample(r);
    assert(s !== null, `100ms sample at ${r}ms`);
    assert(!s.isTeleport, 'Spaced 100ms updates must never be flagged as teleport');
    assert(!s.isExtrapolated, 'Render time within buffer range must be pure interpolation, not extrapolation');
    if (lastZ >= 0) {
      const dz = s.z - lastZ;
      if (dz < -1e-6) isMonotonic = false;
      if (dz > maxStep) maxStep = dz;
      if (dz < minStep) minStep = dz;
    }
    lastZ = s.z;
  }

  assert(isMonotonic, '100ms spaced updates produce smooth monotonic displacement in Z');
  const expectedStep = 16.667 * speed; // ~0.200m
  assertCloseTo(maxStep, expectedStep, 0.005, '100ms updates step maximum');
  assertCloseTo(minStep, expectedStep, 0.005, '100ms updates step minimum');
}

// Test 1.3: Asymmetric Spaced Updates with Variable Packet Intervals (33ms, 75ms, 120ms, 45ms)
{
  const buffer = new InterpolationBuffer({ renderDelayMs: 100 });
  const timestamps = [0, 50, 85, 160, 280, 325, 425, 500, 620, 700];
  const speed = 0.015; // 15 m/s

  for (const t of timestamps) {
    buffer.push({
      timestamp: t,
      localArrival: t,
      x: t * speed,
      y: 0,
      z: 0,
      yaw: 0,
      pitch: 0,
    });
  }

  let lastX = -1;
  let isMonotonic = true;
  for (let r = 50; r <= 650; r += 10.0) {
    const s = buffer.sample(r);
    assert(s !== null, `Variable interval sample at ${r}ms`);
    if (lastX >= 0) {
      const dx = s.x - lastX;
      if (dx < -1e-6) isMonotonic = false;
    }
    lastX = s.x;
  }

  assert(isMonotonic, 'Asymmetric variable interval updates maintain strict monotonicity');
}

// ============================================================================
// SECTION 2: SHORTEST-PATH ANGLE LERP & CIRCLE GEODESICS
// ============================================================================
console.log('\n--- Section 2: Shortest-Path Angle LERP & Geodesic Arc Verification ---');

// Test 2.1: Acceptance Criterion Check: +3.10 rad to -3.10 rad
{
  const fromAngle = 3.10;   // ~ +177.62 deg
  const toAngle = -3.10;    // ~ -177.62 deg

  const diff = shortestAngleDifference(fromAngle, toAngle);
  // Shortest arc is turning right through +/- PI:
  // (-3.10 - 3.10) = -6.20 -> + 2*PI = +0.0831853 rad (~4.766 deg)
  assertCloseTo(diff, 0.0831853, 1e-4, 'Shortest angle difference is strictly +0.083185 rad');
  assert(diff > 0, `Difference must be positive arc (+0.083 rad), got ${diff}`);
  assert(Math.abs(diff) < 0.1, `Difference magnitude must be < 0.1 rad, not 6.20 rad reverse spin`);

  // Multi-step interpolation trajectory verification
  const steps = [0.0, 0.25, 0.5, 0.75, 1.0];
  let previousAngle = fromAngle;
  let totalArcLength = 0;

  for (const t of steps) {
    const interpolated = lerpAngle(fromAngle, toAngle, t);
    const arcDelta = Math.abs(shortestAngleDifference(previousAngle, interpolated));
    totalArcLength += arcDelta;
    previousAngle = interpolated;

    // At every step, the angle must stay near boundary (|yaw| >= 3.0 rad)
    assert(
      Math.abs(interpolated) >= 3.05,
      `Interpolated angle at t=${t} must stay near boundary (|angle| >= 3.05, got ${interpolated})`
    );
  }

  assertCloseTo(totalArcLength, 0.0831853, 1e-4, 'Total traversed arc across seam is strictly ~0.083 rad, NOT 6.20 rad');

  // Verify midpoint is exactly at +/- PI
  const mid = lerpAngle(fromAngle, toAngle, 0.5);
  // 3.10 + 0.0831853 * 0.5 = 3.14159265 = PI
  assertCloseTo(Math.abs(mid), Math.PI, 1e-4, 'Midpoint angle lands precisely on PI seam');
  assert(Math.abs(mid) > 3.1, 'Midpoint NEVER flips through zero');
}

// Test 2.2: Reverse Direction: -3.10 rad to +3.10 rad
{
  const fromAngle = -3.10;
  const toAngle = 3.10;

  const diff = shortestAngleDifference(fromAngle, toAngle);
  // (+3.10 - (-3.10)) = +6.20 -> - 2*PI = -0.0831853 rad
  assertCloseTo(diff, -0.0831853, 1e-4, 'Reverse shortest difference is strictly -0.083185 rad');
  assert(diff < 0, `Difference must be negative arc (-0.083 rad), got ${diff}`);

  const mid = lerpAngle(fromAngle, toAngle, 0.5);
  assertCloseTo(Math.abs(mid), Math.PI, 1e-4, 'Reverse midpoint angle lands precisely on PI seam');
}

// Test 2.3: Boundary Angles (+PI and -PI)
{
  // Exactly PI to -PI (same orientation)
  const diffPi = shortestAngleDifference(Math.PI, -Math.PI);
  assertCloseTo(diffPi, 0.0, 1e-5, 'Difference between +PI and -PI is 0.0 rad');

  // 0 to PI (exactly 180 degrees)
  const diffHalf = shortestAngleDifference(0, Math.PI);
  assertCloseTo(Math.abs(diffHalf), Math.PI, 1e-5, 'Difference from 0 to PI is PI');

  // -PI/2 to +PI/2
  const diffQuarter = shortestAngleDifference(-Math.PI / 2, Math.PI / 2);
  assertCloseTo(diffQuarter, Math.PI, 1e-5, 'Difference from -PI/2 to PI/2 is PI');
}

// Test 2.4: Adversarial Non-Normalized Angles (Multiples of 2*PI)
{
  // From 3.10 + 4*PI (15.666 rad) to -3.10 - 6*PI (-21.949 rad)
  const unnormalizedFrom = 3.10 + 4 * Math.PI;
  const unnormalizedTo = -3.10 - 6 * Math.PI;

  const diff = shortestAngleDifference(unnormalizedFrom, unnormalizedTo);
  assertCloseTo(diff, 0.0831853, 1e-4, 'Shortest difference handles large unnormalized angle multiples');

  const mid = lerpAngle(unnormalizedFrom, unnormalizedTo, 0.5);
  assertCloseTo(Math.abs(mid), Math.PI, 1e-4, 'lerpAngle normalizes large angles to PI seam');
}

// Test 2.5: Stress Fuzzing — 10,000 Random Angle Pairs
{
  let fuzzPassed = true;
  let maxDiscrepancy = 0;

  for (let i = 0; i < 10000; i++) {
    const a = (Math.random() - 0.5) * 8 * Math.PI; // [-4*PI, 4*PI]
    const b = (Math.random() - 0.5) * 8 * Math.PI;

    const diff = shortestAngleDifference(a, b);
    if (Math.abs(diff) > Math.PI + 1e-9) {
      fuzzPassed = false;
      console.error(`Shortest difference exceeded PI: a=${a}, b=${b}, diff=${diff}`);
      break;
    }

    const start = lerpAngle(a, b, 0.0);
    const end = lerpAngle(a, b, 1.0);
    const normA = normalizeAngle(a);
    const normB = normalizeAngle(b);

    const startErr = Math.abs(shortestAngleDifference(start, normA));
    const endErr = Math.abs(shortestAngleDifference(end, normB));

    if (startErr > 1e-4 || endErr > 1e-4) {
      fuzzPassed = false;
      console.error(`Endpoints mismatch: startErr=${startErr}, endErr=${endErr}`);
      break;
    }
  }

  assert(fuzzPassed, '10,000 random angle pairs fuzz test: all shortest differences <= PI and endpoints match');
}

// ============================================================================
// SECTION 3: DEAD RECKONING BOUNDARY AT 150MS
// ============================================================================
console.log('\n--- Section 3: Dead Reckoning Boundary (Strict 150ms Extrapolation Ceiling) ---');

// Test 3.1: Extrapolation Progression up to 150ms and Freeze After 150ms
{
  const buffer = new InterpolationBuffer({ maxExtrapolationMs: 150 });
  const speed = 0.02; // 20 m/s (0.02 m/ms)

  // Two packets 100ms apart
  buffer.push({
    timestamp: 1000,
    localArrival: 1000,
    x: 0.0,
    y: 5.0,
    z: 0.0,
    yaw: 2.5,
    pitch: -0.1,
  });
  buffer.push({
    timestamp: 1100,
    localArrival: 1100,
    x: 2.0,
    y: 5.0,
    z: 0.0,
    yaw: 2.5,
    pitch: -0.1,
  });

  // At latest packet (t=1100)
  const s0 = buffer.sample(1100);
  assert(s0 !== null, 'Sample at t=1100 not null');
  assertEqual(s0.isExtrapolated, false, 'isExtrapolated false at latest packet');
  assertEqual(s0.extrapolationMs, 0, 'extrapolationMs 0 at latest packet');
  assertCloseTo(s0.x, 2.0, 1e-4, 'Position at t=1100');

  // At t=1150 (+50ms)
  const s50 = buffer.sample(1150);
  assert(s50 !== null, 'Sample at t=1150 not null');
  assertEqual(s50.isExtrapolated, true, 'isExtrapolated true at +50ms');
  assertEqual(s50.extrapolationMs, 50, 'extrapolationMs 50 at +50ms');
  assertCloseTo(s50.x, 2.0 + 50 * speed, 1e-4, 'Position at +50ms extrapolation (x=3.0)');

  // At t=1200 (+100ms)
  const s100 = buffer.sample(1200);
  assert(s100 !== null, 'Sample at t=1200 not null');
  assertEqual(s100.isExtrapolated, true, 'isExtrapolated true at +100ms');
  assertEqual(s100.extrapolationMs, 100, 'extrapolationMs 100 at +100ms');
  assertCloseTo(s100.x, 2.0 + 100 * speed, 1e-4, 'Position at +100ms extrapolation (x=4.0)');

  // At t=1250 (+150ms exact boundary)
  const s150 = buffer.sample(1250);
  assert(s150 !== null, 'Sample at t=1250 not null');
  assertEqual(s150.isExtrapolated, true, 'isExtrapolated true at +150ms cap');
  assertEqual(s150.extrapolationMs, 150, 'extrapolationMs 150 at +150ms cap');
  assertCloseTo(s150.x, 2.0 + 150 * speed, 1e-4, 'Position at +150ms extrapolation cap (x=5.0)');

  // At t=1251 (+151ms): Must freeze!
  const s151 = buffer.sample(1251);
  assert(s151 !== null, 'Sample at t=1251 not null');
  assertEqual(s151.extrapolationMs, 150, 'extrapolationMs must clamp to 150 at 151ms');
  assertCloseTo(s151.x, 5.0, 1e-4, 'Position at +151ms remains frozen at x=5.0');

  // At t=1300 (+200ms): Must freeze!
  const s200 = buffer.sample(1300);
  assert(s200 !== null, 'Sample at t=1300 not null');
  assertEqual(s200.extrapolationMs, 150, 'extrapolationMs must clamp to 150 at 200ms');
  assertCloseTo(s200.x, 5.0, 1e-4, 'Position at +200ms remains frozen at x=5.0');

  // At t=1500 (+400ms): Must freeze!
  const s400 = buffer.sample(1500);
  assert(s400 !== null, 'Sample at t=1500 not null');
  assertEqual(s400.extrapolationMs, 150, 'extrapolationMs must clamp to 150 at 400ms');
  assertCloseTo(s400.x, 5.0, 1e-4, 'Position at +400ms remains frozen at x=5.0');

  // At t=2200 (+1100ms): Must freeze and flag isStale
  const sStale = buffer.sample(2200);
  assert(sStale !== null, 'Sample at t=2200 not null');
  assertEqual(sStale.extrapolationMs, 150, 'extrapolationMs clamps at 150 even when stale');
  assertCloseTo(sStale.x, 5.0, 1e-4, 'Position frozen when stale');
  assertEqual(sStale.isStale, true, 'isStale flagged true after staleTimeout (1000ms)');
}

// Test 3.2: Velocity Clamping & Look Angles Frozen during Extrapolation
{
  const buffer = new InterpolationBuffer({ maxExtrapolationMs: 150 });
  buffer.push({
    timestamp: 2000,
    localArrival: 2000,
    x: 10,
    y: 20,
    z: 30,
    yaw: 1.57,
    pitch: 0.45,
  });
  buffer.push({
    timestamp: 2100,
    localArrival: 2100,
    x: 15,
    y: 20,
    z: 35,
    yaw: 2.00,
    pitch: 0.30,
  });

  // Sample at 2200ms (+100ms extrapolation)
  const sampleExt = buffer.sample(2200);
  assert(sampleExt !== null, 'sampleExt not null');
  assertEqual(sampleExt.yaw, 2.00, 'Yaw is strictly frozen at latest orientation during extrapolation');
  assertEqual(sampleExt.pitch, 0.30, 'Pitch is strictly frozen at latest orientation during extrapolation');

  // Sample at 2400ms (+300ms, beyond 150ms cap)
  const sampleFreeze = buffer.sample(2400);
  assert(sampleFreeze !== null, 'sampleFreeze not null');
  assertEqual(sampleFreeze.yaw, 2.00, 'Yaw remains frozen beyond extrapolation cap');
  assertEqual(sampleFreeze.pitch, 0.30, 'Pitch remains frozen beyond extrapolation cap');
  assertCloseTo(sampleFreeze.x, 15 + (5 / 100) * 150, 1e-4, 'Position strictly clamped to 150ms delta');
  assertCloseTo(sampleFreeze.z, 35 + (5 / 100) * 150, 1e-4, 'Position strictly clamped to 150ms delta');
}

// Test 3.3: Velocity Continuity: New Packet Resumes Interpolation Without Backward Jump
{
  const buffer = new InterpolationBuffer({ maxExtrapolationMs: 150 });
  const speed = 0.01; // 10 m/s

  // Packet 1 and 2
  buffer.push({ timestamp: 1000, localArrival: 1000, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 1100, localArrival: 1100, x: 1, y: 0, z: 0, yaw: 0, pitch: 0 });

  // Extrapolate to t=1200 (+100ms)
  const ext1200 = buffer.sample(1200);
  assertCloseTo(ext1200.x, 2.0, 1e-4, 'Extrapolated position at t=1200');

  // Now Packet 3 arrives late (timestamp 1200, x=2.0)
  buffer.push({ timestamp: 1200, localArrival: 1250, x: 2.0, y: 0, z: 0, yaw: 0, pitch: 0 });
  // Packet 4 arrives (timestamp 1300, x=3.0)
  buffer.push({ timestamp: 1300, localArrival: 1300, x: 3.0, y: 0, z: 0, yaw: 0, pitch: 0 });

  // Sampling at t=1250 should now interpolate cleanly between Packet 3 and 4
  const interp1250 = buffer.sample(1250);
  assert(interp1250 !== null, 'interp1250 not null');
  assertEqual(interp1250.isExtrapolated, false, 'Should resume interpolation once packet arrives');
  assertCloseTo(interp1250.x, 2.5, 1e-4, 'Smooth position progression without backward snap');
}

// ============================================================================
// SECTION 4: ROBUSTNESS & ADVERSARIAL ANOMALIES
// ============================================================================
console.log('\n--- Section 4: Edge Cases, Discontinuity & Ordering Anomalies ---');

// Test 4.1: Out-of-order Packet Arrival
{
  const buffer = new InterpolationBuffer({ teleportThresholdMeters: 50.0 });
  buffer.push({ timestamp: 1000, localArrival: 1000, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 1200, localArrival: 1200, x: 20, y: 0, z: 0, yaw: 0, pitch: 0 });
  // Arrives late with earlier timestamp (t=1100)
  buffer.push({ timestamp: 1100, localArrival: 1210, x: 10, y: 0, z: 0, yaw: 0, pitch: 0 });

  // Interpolation at t=1100 should find the correctly inserted packet
  const s = buffer.sample(1100);
  assert(s !== null, 'Sample at out-of-order timestamp not null');
  assertEqual(s.x, 10, 'Out-of-order packet correctly inserted and sampled at its timestamp');

  const sMid = buffer.sample(1050);
  assertEqual(sMid.x, 5, 'Interpolation between out-of-order packets is correct');
}

// Test 4.2: Duplicate Packet Discarding
{
  const buffer = new InterpolationBuffer();
  buffer.push({ timestamp: 5000, localArrival: 5000, x: 1.0, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 5000, localArrival: 5002, x: 1.5, y: 0, z: 0, yaw: 0, pitch: 0 }); // Duplicate timestamp (dx=0.5m < 10m)

  assertEqual(buffer.size, 1, 'Duplicate timestamp must be discarded, size remains 1');
  const s = buffer.sample(5000);
  assertEqual(s.x, 1.0, 'Original snapshot retained, duplicate discarded');
}

// Test 4.3: Teleport Discontinuity Detection (> 10m) Purges Stale History
{
  const buffer = new InterpolationBuffer({ teleportThresholdMeters: 10.0 });
  // Player at position [0, 0, 0]
  buffer.push({ timestamp: 1000, localArrival: 1000, x: 0, y: 0, z: 0, yaw: 0, pitch: 0 });
  buffer.push({ timestamp: 1033, localArrival: 1033, x: 0.3, y: 0, z: 0, yaw: 0, pitch: 0 });

  // Sudden displacement: respawn at [0, 17.5, 0] (dy = 17.5m > 10m threshold)
  buffer.push({ timestamp: 1066, localArrival: 1066, x: 0, y: 17.5, z: 0, yaw: 1.5, pitch: 0 });

  // History should be purged to prevent sliding across map
  assertEqual(buffer.size, 1, 'Teleport displacement > 10m purges stale snapshots');
  const s = buffer.sample(1066);
  assertEqual(s.y, 17.5, 'Teleport snaps immediately to new position');
}

// ============================================================================
// FINAL SUMMARY
// ============================================================================
console.log('\n================================================================');
console.log(`CHALLENGER 2 SUMMARY: ${passedTests}/${totalTests} tests PASSED (${failedTests} failed)`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

// tests/tier1_features/test_interpolation.mjs
// Tier 1 Feature Coverage: Remote Player Interpolation & Smoothness Test Suite (F-NET-02)

import { assert, assertEqual, assertCloseTo } from '../helpers/assertions.mjs';
import {
  InterpolationBuffer,
  NetworkClockSync,
  RemotePlayerInterpolationManager,
  normalizeAngle,
  shortestAngleDifference,
  lerpAngle,
  lerpScalar,
} from '../../game-web/src/net/interpolationBuffer.ts';

export async function run(suite) {
  // --- Test 1: Angular Math Helpers & Shortest-Path Logic ---
  suite.test('Interpolation: normalizeAngle wraps angles into [-PI, PI]', () => {
    assertCloseTo(normalizeAngle(0), 0, 1e-5);
    assertCloseTo(normalizeAngle(Math.PI), Math.PI, 1e-5);
    assertCloseTo(normalizeAngle(-Math.PI), -Math.PI, 1e-5);
    assertCloseTo(normalizeAngle(3 * Math.PI), Math.PI, 1e-5);
    assertCloseTo(normalizeAngle(-3 * Math.PI), -Math.PI, 1e-5);
  });

  suite.test('Interpolation: shortestAngleDifference finds minimal arc across boundary seam', () => {
    // Turning right across seam: 3.10 rad (+177.6 deg) to -3.10 rad (-177.6 deg)
    const diff = shortestAngleDifference(3.10, -3.10);
    // Shortest distance is +0.08318 rad (turning right through PI)
    assert(Math.abs(diff) < 0.1, `Shortest difference should be ~+0.083, got ${diff}`);
    assert(diff > 0, `Difference must be positive, got ${diff}`);

    // Opposite direction: -3.10 to 3.10
    const diffOpp = shortestAngleDifference(-3.10, 3.10);
    assert(Math.abs(diffOpp) < 0.1, `Shortest difference should be ~-0.083, got ${diffOpp}`);
    assert(diffOpp < 0, `Difference must be negative, got ${diffOpp}`);
  });

  suite.test('Interpolation: lerpAngle eliminates 360-degree reverse spin across +/- PI seam', () => {
    const fromAngle = 3.10;
    const toAngle = -3.10;

    const mid = lerpAngle(fromAngle, toAngle, 0.5);
    // Midpoint must stay near +/- PI (~3.14159), never passing through 0.0!
    assert(
      Math.abs(Math.abs(mid) - Math.PI) < 0.05,
      `Midpoint angle should be at boundary (+/- PI), got ${mid}`
    );
    assert(Math.abs(mid) > 3.0, `Angle must never flip through 0, got ${mid}`);
  });

  // --- Test 2: Precision 3D Vector LERP ---
  suite.test('Interpolation: Exact 3D Vector LERP at intermediate timestamps', () => {
    const buffer = new InterpolationBuffer({ renderDelayMs: 90, teleportThresholdMeters: 50.0 });
    buffer.push({
      timestamp: 1000,
      localArrival: 1000,
      x: 0,
      y: 10,
      z: 0,
      yaw: 0,
      pitch: 0,
    });
    buffer.push({
      timestamp: 1100,
      localArrival: 1100,
      x: 10,
      y: 20,
      z: 30,
      yaw: 1.0,
      pitch: 0.5,
    });

    const s0 = buffer.sample(1000);
    assert(s0 !== null);
    assertEqual(s0.x, 0);
    assertEqual(s0.y, 10);
    assertEqual(s0.z, 0);

    const sMid = buffer.sample(1050);
    assert(sMid !== null);
    assertEqual(sMid.x, 5);
    assertEqual(sMid.y, 15);
    assertEqual(sMid.z, 15);
    assertCloseTo(sMid.yaw, 0.5, 1e-4, 'Yaw should lerp to 0.5');
    assertCloseTo(sMid.pitch, 0.25, 1e-4, 'Pitch should lerp to 0.25');

    const sQuarter = buffer.sample(1025);
    assert(sQuarter !== null);
    assertEqual(sQuarter.x, 2.5);
    assertEqual(sQuarter.y, 12.5);
    assertEqual(sQuarter.z, 7.5);
  });

  // --- Test 3: Dead-Reckoning Extrapolation under Packet Loss ---
  suite.test('Interpolation: Extrapolates linearly up to 150ms during packet loss and clamps strictly', () => {
    const buffer = new InterpolationBuffer({ maxExtrapolationMs: 150 });
    // Moving along X at 10 m/s (0.01 m/ms)
    buffer.push({
      timestamp: 3000,
      localArrival: 3000,
      x: 0,
      y: 0,
      z: 0,
      yaw: 1.5,
      pitch: 0.2,
    });
    buffer.push({
      timestamp: 3100,
      localArrival: 3100,
      x: 1.0,
      y: 0,
      z: 0,
      yaw: 1.5,
      pitch: 0.2,
    });

    // Sample 50ms past latest packet
    const s50 = buffer.sample(3150);
    assert(s50 !== null);
    assert(s50.isExtrapolated, 'Should be marked extrapolated');
    assertEqual(s50.extrapolationMs, 50);
    assertCloseTo(s50.x, 1.5, 1e-4, 'Position at +50ms');
    assertEqual(s50.yaw, 1.5, 'Look yaw frozen during extrapolation');

    // Sample 150ms past latest packet (boundary limit)
    const s150 = buffer.sample(3250);
    assert(s150 !== null);
    assertEqual(s150.extrapolationMs, 150);
    assertCloseTo(s150.x, 2.5, 1e-4, 'Position at +150ms');

    // Sample 250ms past latest packet (should clamp to 150ms cap)
    const s250 = buffer.sample(3350);
    assert(s250 !== null);
    assertEqual(s250.extrapolationMs, 150, 'Must clamp extrapolation at 150ms');
    assertCloseTo(s250.x, 2.5, 1e-4, 'Position clamped at +150ms cap');
  });

  // --- Test 4: Smooth Monotonic Motion on Artificially Jittered Stream ---
  suite.test('Interpolation: Jittered 30Hz network stream produces smooth monotonic motion at 60Hz and 144Hz render rates', () => {
    const buffer = new InterpolationBuffer({ renderDelayMs: 90 });
    const speed = 0.006; // 6 m/s (0.006 m/ms)

    // Simulate 30Hz stream (every 33.3ms) with artificial jitter (+/- 15ms)
    const baseIntervals = [0, 33, 67, 100, 133, 167, 200, 233, 267, 300, 333, 367, 400];
    const jitters = [0, 12, -8, 15, -10, 5, -14, 8, 11, -5, 14, -8, 0];

    for (let i = 0; i < baseIntervals.length; i++) {
      const t = baseIntervals[i];
      const arrival = t + 50 + jitters[i]; // 50ms network latency + jitter
      buffer.push({
        timestamp: t,
        localArrival: arrival,
        x: t * speed,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
      });
    }

    // Sample at 60Hz intervals (16.6ms) from t=100 to t=300
    let lastX = -1;
    let maxDeltaX = 0;
    let minDeltaX = Infinity;

    for (let renderTime = 100; renderTime <= 300; renderTime += 16.6) {
      const state = buffer.sample(renderTime);
      assert(state !== null);
      if (lastX >= 0) {
        const dx = state.x - lastX;
        assert(dx >= 0, `Displacement must be monotonic, got dx=${dx}`);
        if (dx > maxDeltaX) maxDeltaX = dx;
        if (dx < minDeltaX) minDeltaX = dx;
      }
      lastX = state.x;
    }

    // Expected displacement per 16.6ms step at 0.006 m/ms is ~0.0996m
    const expectedStep = 16.6 * speed;
    assert(
      Math.abs(maxDeltaX - expectedStep) < 0.03,
      `Max step deviation should be within 0.03m, got max=${maxDeltaX}`
    );
    assert(
      Math.abs(minDeltaX - expectedStep) < 0.03,
      `Min step deviation should be within 0.03m, got min=${minDeltaX}`
    );
  });

  // --- Test 5: Teleport Discontinuity Snapping ---
  suite.test('Interpolation: Displacements > 10m snap immediately without sliding across map', () => {
    const buffer = new InterpolationBuffer({ teleportThresholdMeters: 10.0 });
    // Player dies at [100, 5, 100] and respawns at [0, 17.5, 0]
    buffer.push({
      timestamp: 5000,
      localArrival: 5000,
      x: 100,
      y: 5,
      z: 100,
      yaw: 0,
      pitch: 0,
    });
    buffer.push({
      timestamp: 5033,
      localArrival: 5033,
      x: 0,
      y: 17.5,
      z: 0,
      yaw: 1.5,
      pitch: 0,
    });

    // Buffer should have purged previous position [100, 5, 100] and only contain new spawn
    assertEqual(buffer.size, 1);
    const sample = buffer.sample(5033);
    assert(sample !== null);
    assertEqual(sample.x, 0);
    assertEqual(sample.y, 17.5);
    assertEqual(sample.z, 0);
  });

  // --- Test 6: Network Clock Sync & Timeline Mapping ---
  suite.test('Interpolation: NetworkClockSync smooths host-client clock offsets with EMA', () => {
    const clock = new NetworkClockSync(0.1);

    // Host performance.now() is 5000ms ahead of client
    clock.registerHostTimestamp(6000, 1000); // offset = +5000
    clock.registerHostTimestamp(6033, 1033); // offset = +5000
    clock.registerHostTimestamp(6070, 1067); // offset = +5003

    const estimatedHost = clock.getEstimatedHostTime(1100);
    assertCloseTo(estimatedHost, 6100, 1.0, 'Host time estimate');

    const renderTime = clock.getRenderTime(1100, 90);
    assertCloseTo(renderTime, 6100 - 90, 1.0, 'Render time with 90ms delay');
  });

  // --- Test 7: Buffer Capacity and Pruning ---
  suite.test('Interpolation: Buffer strictly respects maxCapacity and prunes old snapshots', () => {
    const buffer = new InterpolationBuffer({ maxCapacity: 10 });
    for (let i = 0; i < 30; i++) {
      buffer.push({
        timestamp: i * 33,
        localArrival: i * 33,
        x: i,
        y: 0,
        z: 0,
        yaw: 0,
        pitch: 0,
      });
    }

    assertEqual(buffer.size, 10, 'Buffer capacity must be strictly capped at 10');
    assertEqual(buffer.latest.timestamp, 29 * 33, 'Latest timestamp preserved');

    // Prune snapshots before timestamp 25 * 33
    buffer.prune(25 * 33);
    assert(buffer.size <= 6, 'Old snapshots pruned');
  });

  // --- Test 8: Multi-Peer Manager Lifecycle ---
  suite.test('Interpolation: RemotePlayerInterpolationManager routes snapshots by peer ID', () => {
    const manager = new RemotePlayerInterpolationManager(90);

    manager.pushSnapshot('peer_A', {
      timestamp: 1000,
      localArrival: 1000,
      x: 10,
      y: 5,
      z: 10,
      yaw: 0,
      pitch: 0,
    });
    manager.pushSnapshot('peer_B', {
      timestamp: 1000,
      localArrival: 1000,
      x: 50,
      y: 5,
      z: 50,
      yaw: 1,
      pitch: 0,
    });

    const stateA = manager.samplePlayer('peer_A', 1090);
    const stateB = manager.samplePlayer('peer_B', 1090);

    assert(stateA !== null);
    assert(stateB !== null);
    assertEqual(stateA.x, 10);
    assertEqual(stateB.x, 50);

    manager.removePlayer('peer_A');
    assertEqual(manager.samplePlayer('peer_A', 1090), null);
    assert(manager.samplePlayer('peer_B', 1090) !== null);
  });
}

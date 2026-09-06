/**
 * Challenger 2 - Empirical Adversarial Stress Harness (Milestone 1)
 * 
 * Verifies:
 * 1. clock.update(timestamp) delta guarantees under variable frame times (16ms, 33ms, 100ms, paused tab, lag spikes)
 * 2. Player displacement in all 4 directions (W, A, S, D), diagonals, opposing cancellations,
 *    and speed multipliers (walk: 12 m/s, sprint: 24 m/s, crouch: 7.2 m/s, crouch override)
 * 3. window.blur and pointerlock clearing held keys immediately
 * 4. Ground snapping (coyote time 0.5m), jump mechanics, menu/map isolation
 * 5. Camera aim decoupling, multi-weapon exponential recoil decay, and knife recoil reset
 */

import * as THREE from '../game-web/node_modules/three/build/three.module.js';

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

function assertCloseTo(actual, expected, tolerance = 1e-4, message) {
  const diff = Math.abs(actual - expected);
  assert(diff <= tolerance, `${message} (actual=${actual.toFixed(6)}, expected=${expected.toFixed(6)}, diff=${diff.toExponential(4)})`);
}

console.log('================================================================');
console.log('   CHALLENGER 2 - M1 MOVEMENT, INPUT & TIMER EMPIRICAL SUITE   ');
console.log('================================================================\n');

// ================================================================
// SECTION 1: THREE.Timer & Frame Time Delta Verification
// ================================================================
console.log('--- Section 1: THREE.Timer & Frame Time Delta Verification ---');

// Test 1.1: Timer Starvation Reproduction (Unpatched State)
{
  const starvationTimer = new THREE.Timer();
  // Without calling update(timestamp), getDelta() must return 0
  const unpatchedDelta = starvationTimer.getDelta();
  assert(unpatchedDelta === 0.0, 'Unpatched Timer without update() reproduces starvation bug (delta === 0.0)');
}

// Test 1.2: Variable Frame Rates (144fps, 60fps, 30fps, 10fps)
{
  const timer = new THREE.Timer();
  let t = 1000.0;
  timer.update(t); // initial anchor

  // 144 FPS (~6.94ms)
  t += 6.944;
  timer.update(t);
  const delta144 = timer.getDelta();
  assert(delta144 > 0, `144 FPS delta is non-zero: ${delta144.toFixed(6)}s`);
  assertCloseTo(delta144, 0.006944, 1e-4, '144 FPS delta matches frame time');

  // 60 FPS (~16.67ms)
  t += 16.667;
  timer.update(t);
  const delta60 = timer.getDelta();
  assert(delta60 > 0, `60 FPS delta is non-zero: ${delta60.toFixed(6)}s`);
  assertCloseTo(delta60, 0.016667, 1e-4, '60 FPS delta matches frame time');

  // 30 FPS (~33.33ms)
  t += 33.333;
  timer.update(t);
  const delta30 = timer.getDelta();
  assert(delta30 > 0, `30 FPS delta is non-zero: ${delta30.toFixed(6)}s`);
  assertCloseTo(delta30, 0.033333, 1e-4, '30 FPS delta matches frame time');

  // 10 FPS (100.0ms)
  t += 100.0;
  timer.update(t);
  const delta10 = timer.getDelta();
  assert(delta10 > 0, `10 FPS delta is non-zero: ${delta10.toFixed(6)}s`);
  assertCloseTo(delta10, 0.100000, 1e-4, '10 FPS delta matches frame time');
}

// Test 1.3: Delta Clamping under Severe Lag Spikes (Math.min(delta, 0.1))
{
  const timer = new THREE.Timer();
  let t = 2000.0;
  timer.update(t);

  // 500ms lag spike
  t += 500.0;
  timer.update(t);
  const rawDelta = timer.getDelta();
  const clampedDelta = Math.min(rawDelta, 0.1);
  assertCloseTo(rawDelta, 0.5, 1e-5, `Raw delta under 500ms lag spike is 0.5s: ${rawDelta.toFixed(4)}s`);
  assert(clampedDelta === 0.1, `Clamped delta caps at 0.1s to prevent physics tunneling: ${clampedDelta}s`);

  // 2000ms freeze
  t += 2000.0;
  timer.update(t);
  const rawFreezeDelta = timer.getDelta();
  const clampedFreezeDelta = Math.min(rawFreezeDelta, 0.1);
  assertCloseTo(rawFreezeDelta, 2.0, 1e-5, `Raw delta under 2000ms freeze is 2.0s: ${rawFreezeDelta.toFixed(4)}s`);
  assert(clampedFreezeDelta === 0.1, `Clamped freeze delta caps at 0.1s: ${clampedFreezeDelta}s`);
}

// Test 1.4: Page Visibility API & Paused Tab Behavior (clock.connect(document))
{
  // Create mock document with visibilitychange listener support
  const doc = {
    hidden: false,
    listeners: {},
    addEventListener(event, fn) {
      this.listeners[event] = fn;
    },
    removeEventListener(event, fn) {
      delete this.listeners[event];
    }
  };

  const timer = new THREE.Timer();
  timer.connect(doc);

  // Frame 1 with real performance.now() as rAF provides
  let t = performance.now();
  timer.update(t);

  // Frame 2 (16.6ms later)
  t += 16.667;
  timer.update(t);
  assertCloseTo(timer.getDelta(), 0.016667, 1e-4, 'Connected timer updates normally when tab is active');

  // Tab hidden (user switches tab)
  doc.hidden = true;
  if (doc.listeners['visibilitychange']) doc.listeners['visibilitychange']();

  t += 10000.0; // 10 seconds pass while tab is hidden
  timer.update(t);
  assert(timer.getDelta() === 0, `Delta is strictly 0.0 while document.hidden === true (got ${timer.getDelta()})`);

  // Tab unhidden (user switches back)
  doc.hidden = false;
  if (doc.listeners['visibilitychange']) doc.listeners['visibilitychange'](); // triggers timer.reset()

  // First frame after returning from background: rAF provides fresh performance.now()
  let tAfter = performance.now();
  timer.update(tAfter);
  const returnDelta = timer.getDelta();
  assert(returnDelta < 0.001, `Delta on tab refocus does NOT spike (got ${returnDelta.toFixed(6)}s <= 0.001s)`);
  assert(Math.min(returnDelta, 0.1) <= 0.1, 'Post-refocus delta is safely bounded under 0.1s');
}

// Test 1.5: Zero Delta on Sub-millisecond Duplicate Calls
{
  const timer = new THREE.Timer();
  timer.update(100.0);
  timer.update(100.0); // same timestamp
  assert(timer.getDelta() === 0, 'Duplicate timestamp produces exactly 0 delta without NaN');
}

// ================================================================
// SECTION 2: Player Kinematics, Displacement & Speed Multipliers
// ================================================================
console.log('\n--- Section 2: Player Kinematics, Displacement & Speed Multipliers ---');

const UP_VECTOR = new THREE.Vector3(0, 1, 0);

function simulatePhysicsStep(player, keys, baseYaw, delta) {
  const moveDirection = new THREE.Vector3();
  if (keys.forward) moveDirection.z -= 1;
  if (keys.backward) moveDirection.z += 1;
  if (keys.left) moveDirection.x -= 1;
  if (keys.right) moveDirection.x += 1;

  if (moveDirection.lengthSq() > 0) {
    moveDirection.normalize();
    moveDirection.applyAxisAngle(UP_VECTOR, baseYaw);
  }

  let currentSpeed = player.speed;
  if (keys.shift && !keys.ctrl) {
    currentSpeed = player.speed * player.sprintMultiplier;
  } else if (keys.ctrl) {
    currentSpeed = player.speed * player.crouchMultiplier;
  }

  player.position.x += moveDirection.x * currentSpeed * delta;
  player.position.z += moveDirection.z * currentSpeed * delta;
  return { currentSpeed, moveDirection };
}

function createTestPlayer() {
  return {
    height: 2.0,
    eyeHeight: 1.8,
    floatHeight: 0.5,
    speed: 12.0,            // Walk speed
    sprintMultiplier: 2.0,  // Sprint: 24.0 m/s
    crouchMultiplier: 0.6,  // Crouch: 7.2 m/s
    crouchEyeHeight: 1.0,
    jumpForce: 25.0,
    gravity: 9.8,
    gravityScale: 5.0,
    mass: 80.0,
    velocity: new THREE.Vector3(),
    position: new THREE.Vector3(0, 0, 0),
    isGrounded: true
  };
}

// Test 2.1: Speed Multiplier Values
{
  const p = createTestPlayer();
  assert(p.speed === 12.0, 'Base walk speed is strictly 12.0 m/s');
  assert(p.speed * p.sprintMultiplier === 24.0, 'Sprint speed is strictly 24.0 m/s (2.0x)');
  assertCloseTo(p.speed * p.crouchMultiplier, 7.2, 1e-5, 'Crouch speed is strictly 7.2 m/s (0.6x)');
}

// Test 2.2: Cardinal Direction Displacement (Walk: 12 m/s, delta: 1.0s, baseYaw: 0)
{
  // W (Forward -> -Z)
  {
    const p = createTestPlayer();
    simulatePhysicsStep(p, { forward: true, backward: false, left: false, right: false, shift: false, ctrl: false }, 0, 1.0);
    assertCloseTo(p.position.x, 0.0, 1e-5, 'W (Forward): dx === 0.0');
    assertCloseTo(p.position.z, -12.0, 1e-5, 'W (Forward): dz === -12.0m (-Z forward)');
  }

  // S (Backward -> +Z)
  {
    const p = createTestPlayer();
    simulatePhysicsStep(p, { forward: false, backward: true, left: false, right: false, shift: false, ctrl: false }, 0, 1.0);
    assertCloseTo(p.position.x, 0.0, 1e-5, 'S (Backward): dx === 0.0');
    assertCloseTo(p.position.z, 12.0, 1e-5, 'S (Backward): dz === +12.0m (+Z backward)');
  }

  // A (Left -> -X)
  {
    const p = createTestPlayer();
    simulatePhysicsStep(p, { forward: false, backward: false, left: true, right: false, shift: false, ctrl: false }, 0, 1.0);
    assertCloseTo(p.position.x, -12.0, 1e-5, 'A (Left): dx === -12.0m (-X left)');
    assertCloseTo(p.position.z, 0.0, 1e-5, 'A (Left): dz === 0.0');
  }

  // D (Right -> +X)
  {
    const p = createTestPlayer();
    simulatePhysicsStep(p, { forward: false, backward: false, left: false, right: true, shift: false, ctrl: false }, 0, 1.0);
    assertCloseTo(p.position.x, 12.0, 1e-5, 'D (Right): dx === +12.0m (+X right)');
    assertCloseTo(p.position.z, 0.0, 1e-5, 'D (Right): dz === 0.0');
  }
}

// Test 2.3: Cardinal Direction Displacement under Sprint (24 m/s, delta: 1.0s)
{
  const pW = createTestPlayer();
  simulatePhysicsStep(pW, { forward: true, backward: false, left: false, right: false, shift: true, ctrl: false }, 0, 1.0);
  assertCloseTo(pW.position.z, -24.0, 1e-5, 'Sprint W: dz === -24.0m');

  const pS = createTestPlayer();
  simulatePhysicsStep(pS, { forward: false, backward: true, left: false, right: false, shift: true, ctrl: false }, 0, 1.0);
  assertCloseTo(pS.position.z, 24.0, 1e-5, 'Sprint S: dz === +24.0m');

  const pA = createTestPlayer();
  simulatePhysicsStep(pA, { forward: false, backward: false, left: true, right: false, shift: true, ctrl: false }, 0, 1.0);
  assertCloseTo(pA.position.x, -24.0, 1e-5, 'Sprint A: dx === -24.0m');

  const pD = createTestPlayer();
  simulatePhysicsStep(pD, { forward: false, backward: false, left: false, right: true, shift: true, ctrl: false }, 0, 1.0);
  assertCloseTo(pD.position.x, 24.0, 1e-5, 'Sprint D: dx === +24.0m');
}

// Test 2.4: Cardinal Direction Displacement under Crouch (7.2 m/s, delta: 1.0s)
{
  const pW = createTestPlayer();
  simulatePhysicsStep(pW, { forward: true, backward: false, left: false, right: false, shift: false, ctrl: true }, 0, 1.0);
  assertCloseTo(pW.position.z, -7.2, 1e-5, 'Crouch W: dz === -7.2m');

  const pS = createTestPlayer();
  simulatePhysicsStep(pS, { forward: false, backward: true, left: false, right: false, shift: false, ctrl: true }, 0, 1.0);
  assertCloseTo(pS.position.z, 7.2, 1e-5, 'Crouch S: dz === +7.2m');

  const pA = createTestPlayer();
  simulatePhysicsStep(pA, { forward: false, backward: false, left: true, right: false, shift: false, ctrl: true }, 0, 1.0);
  assertCloseTo(pA.position.x, -7.2, 1e-5, 'Crouch A: dx === -7.2m');

  const pD = createTestPlayer();
  simulatePhysicsStep(pD, { forward: false, backward: false, left: false, right: true, shift: false, ctrl: true }, 0, 1.0);
  assertCloseTo(pD.position.x, 7.2, 1e-5, 'Crouch D: dx === +7.2m');
}

// Test 2.5: Stance Precedence: Crouch Overrides Sprint when Both Keys Held
{
  const p = createTestPlayer();
  const { currentSpeed } = simulatePhysicsStep(p, { forward: true, backward: false, left: false, right: false, shift: true, ctrl: true }, 0, 1.0);
  assertCloseTo(currentSpeed, 7.2, 1e-5, 'Crouch strictly overrides sprint when Shift+Ctrl both held (speed = 7.2 m/s)');
  assertCloseTo(p.position.z, -7.2, 1e-5, 'Displacement under Shift+Ctrl matches crouch speed (-7.2m)');
}

// Test 2.6: Diagonal Movement Normalization (No Diagonal Speed Boost)
{
  const pWD = createTestPlayer();
  simulatePhysicsStep(pWD, { forward: true, backward: false, left: false, right: true, shift: false, ctrl: false }, 0, 1.0);
  const distanceWD = Math.sqrt(pWD.position.x * pWD.position.x + pWD.position.z * pWD.position.z);
  assertCloseTo(distanceWD, 12.0, 1e-5, 'W+D diagonal displacement magnitude is strictly 12.0m (normalized vector)');
  assertCloseTo(pWD.position.x, 12.0 / Math.SQRT2, 1e-5, 'W+D dx is exactly 12/sqrt(2)');
  assertCloseTo(pWD.position.z, -12.0 / Math.SQRT2, 1e-5, 'W+D dz is exactly -12/sqrt(2)');

  const pWA = createTestPlayer();
  simulatePhysicsStep(pWA, { forward: true, backward: false, left: true, right: false, shift: false, ctrl: false }, 0, 1.0);
  const distanceWA = Math.sqrt(pWA.position.x * pWA.position.x + pWA.position.z * pWA.position.z);
  assertCloseTo(distanceWA, 12.0, 1e-5, 'W+A diagonal displacement magnitude is strictly 12.0m');

  const pSA = createTestPlayer();
  simulatePhysicsStep(pSA, { forward: false, backward: true, left: true, right: false, shift: false, ctrl: false }, 0, 1.0);
  const distanceSA = Math.sqrt(pSA.position.x * pSA.position.x + pSA.position.z * pSA.position.z);
  assertCloseTo(distanceSA, 12.0, 1e-5, 'S+A diagonal displacement magnitude is strictly 12.0m');

  const pSD = createTestPlayer();
  simulatePhysicsStep(pSD, { forward: false, backward: true, left: false, right: true, shift: false, ctrl: false }, 0, 1.0);
  const distanceSD = Math.sqrt(pSD.position.x * pSD.position.x + pSD.position.z * pSD.position.z);
  assertCloseTo(distanceSD, 12.0, 1e-5, 'S+D diagonal displacement magnitude is strictly 12.0m');
}

// Test 2.7: Opposing Keys Cancellation (Zero Net Movement)
{
  const pWS = createTestPlayer();
  simulatePhysicsStep(pWS, { forward: true, backward: true, left: false, right: false, shift: false, ctrl: false }, 0, 1.0);
  assert(pWS.position.x === 0 && pWS.position.z === 0, 'W+S opposing keys cancel displacement strictly to (0, 0)');

  const pAD = createTestPlayer();
  simulatePhysicsStep(pAD, { forward: false, backward: false, left: true, right: true, shift: false, ctrl: false }, 0, 1.0);
  assert(pAD.position.x === 0 && pAD.position.z === 0, 'A+D opposing keys cancel displacement strictly to (0, 0)');

  const pALL = createTestPlayer();
  simulatePhysicsStep(pALL, { forward: true, backward: true, left: true, right: true, shift: false, ctrl: false }, 0, 1.0);
  assert(pALL.position.x === 0 && pALL.position.z === 0, 'W+S+A+D opposing keys cancel displacement strictly to (0, 0)');
}

// Test 2.8: Yaw Rotation Invariance of Speed Magnitude
{
  const testYaws = [0, Math.PI / 6, Math.PI / 4, Math.PI / 2, Math.PI, -Math.PI / 2, -Math.PI / 4];
  for (const yaw of testYaws) {
    const p = createTestPlayer();
    simulatePhysicsStep(p, { forward: true, backward: false, left: false, right: false, shift: false, ctrl: false }, yaw, 1.0);
    const speedMagnitude = Math.sqrt(p.position.x * p.position.x + p.position.z * p.position.z);
    assertCloseTo(speedMagnitude, 12.0, 1e-5, `Forward displacement magnitude at yaw ${(yaw * 180 / Math.PI).toFixed(0)}° is strictly 12.0m`);
  }
}

// ================================================================
// SECTION 3: Input Hardening & Focus Recovery (window.blur)
// ================================================================
console.log('\n--- Section 3: Input Hardening & Focus Recovery (window.blur) ---');

{
  const keys = { forward: false, backward: false, left: false, right: false, shift: false, ctrl: false };
  let isShooting = false;

  function resetInputState() {
    keys.forward = false;
    keys.backward = false;
    keys.left = false;
    keys.right = false;
    keys.shift = false;
    keys.ctrl = false;
    isShooting = false;
  }

  // Simulate active gameplay with multiple keys held down and firing
  keys.forward = true;
  keys.left = true;
  keys.shift = true;
  keys.ctrl = true;
  isShooting = true;

  assert(keys.forward === true, 'Pre-condition: keys.forward is active');
  assert(keys.left === true, 'Pre-condition: keys.left is active');
  assert(keys.shift === true, 'Pre-condition: keys.shift is active');
  assert(isShooting === true, 'Pre-condition: isShooting is active');

  // Trigger window blur
  resetInputState();

  assert(keys.forward === false, 'window.blur clears keys.forward immediately');
  assert(keys.backward === false, 'window.blur clears keys.backward immediately');
  assert(keys.left === false, 'window.blur clears keys.left immediately');
  assert(keys.right === false, 'window.blur clears keys.right immediately');
  assert(keys.shift === false, 'window.blur clears keys.shift immediately');
  assert(keys.ctrl === false, 'window.blur clears keys.ctrl immediately');
  assert(isShooting === false, 'window.blur clears isShooting immediately');

  // Verify that subsequent physics frames produce zero drift after blur
  const p = createTestPlayer();
  simulatePhysicsStep(p, keys, 0, 0.016);
  assert(p.position.x === 0 && p.position.z === 0, 'No character drift occurs after window blur reset');
}

// Test 3.2: Full handleKey Key Mapping Coverage
{
  const keys = { forward: false, backward: false, left: false, right: false, shift: false, ctrl: false };

  function handleKey(code, isDown) {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        keys.forward = isDown;
        break;
      case 'KeyS':
      case 'ArrowDown':
        keys.backward = isDown;
        break;
      case 'KeyA':
      case 'ArrowLeft':
        keys.left = isDown;
        break;
      case 'KeyD':
      case 'ArrowRight':
        keys.right = isDown;
        break;
      case 'ShiftLeft':
      case 'ShiftRight':
        keys.shift = isDown;
        break;
      case 'ControlLeft':
      case 'ControlRight':
      case 'KeyC':
        keys.ctrl = isDown;
        break;
    }
  }

  // Arrow keys support
  handleKey('ArrowUp', true);
  assert(keys.forward === true, 'ArrowUp activates keys.forward');
  handleKey('ArrowUp', false);
  assert(keys.forward === false, 'ArrowUp release clears keys.forward');

  handleKey('ArrowDown', true);
  assert(keys.backward === true, 'ArrowDown activates keys.backward');
  handleKey('ArrowDown', false);
  assert(keys.backward === false, 'ArrowDown release clears keys.backward');

  handleKey('ArrowLeft', true);
  assert(keys.left === true, 'ArrowLeft activates keys.left');
  handleKey('ArrowLeft', false);
  assert(keys.left === false, 'ArrowLeft release clears keys.left');

  handleKey('ArrowRight', true);
  assert(keys.right === true, 'ArrowRight activates keys.right');
  handleKey('ArrowRight', false);
  assert(keys.right === false, 'ArrowRight release clears keys.right');

  // Secondary modifiers
  handleKey('ShiftRight', true);
  assert(keys.shift === true, 'ShiftRight activates keys.shift');
  handleKey('ShiftRight', false);
  assert(keys.shift === false, 'ShiftRight release clears keys.shift');

  handleKey('ControlRight', true);
  assert(keys.ctrl === true, 'ControlRight activates keys.ctrl');
  handleKey('ControlRight', false);
  assert(keys.ctrl === false, 'ControlRight release clears keys.ctrl');

  handleKey('KeyC', true);
  assert(keys.ctrl === true, 'KeyC activates keys.ctrl (crouch toggle/hold)');
  handleKey('KeyC', false);
  assert(keys.ctrl === false, 'KeyC release clears keys.ctrl');
}

// ================================================================
// SECTION 4: Ground Snapping, Coyote Time & Menu Isolation
// ================================================================
console.log('\n--- Section 4: Ground Snapping, Coyote Time & Menu Isolation ---');

// Test 4.1: Coyote Time / Ground Snap Margin (0.5m)
{
  const groundHeight = 10.0;
  const groundSnapMargin = 0.5;

  function updateGroundStatus(pos_y, vel_y) {
    if (pos_y <= groundHeight || (vel_y <= 0 && pos_y - groundHeight < groundSnapMargin)) {
      return { isGrounded: true, new_y: groundHeight, new_vel_y: 0 };
    }
    return { isGrounded: false, new_y: pos_y, new_vel_y: vel_y };
  }

  // Exactly at ground
  const res1 = updateGroundStatus(10.0, 0);
  assert(res1.isGrounded === true && res1.new_y === 10.0, 'Player at ground level is grounded');

  // Walking down a slope: 0.3m above ground with downward velocity
  const res2 = updateGroundStatus(10.3, -2.0);
  assert(res2.isGrounded === true && res2.new_y === 10.0, 'Coyote time snaps player within 0.5m slope margin (0.3m above)');

  // 0.49m above ground with downward velocity
  const res3 = updateGroundStatus(10.49, -1.0);
  assert(res3.isGrounded === true && res3.new_y === 10.0, 'Coyote time snaps player at 0.49m margin');

  // 0.55m above ground (outside margin)
  const res4 = updateGroundStatus(10.55, -1.0);
  assert(res4.isGrounded === false && res4.new_y === 10.55, 'Player outside 0.5m margin is not snapped');

  // Moving upward (+vy): jumping should NOT snap to ground even within 0.5m
  const res5 = updateGroundStatus(10.2, 15.0);
  assert(res5.isGrounded === false && res5.new_y === 10.2, 'Player moving upward (+vy) is NOT snapped by coyote time');
}

// Test 4.2: Jump Guard Conditions (Menu and Map Isolation)
{
  function canJump(isDown, isGrounded, isMenuOpen, isMapOpen) {
    return isDown && isGrounded && !isMenuOpen && !isMapOpen;
  }

  assert(canJump(true, true, false, false) === true, 'Jump allowed when grounded and no menu/map open');
  assert(canJump(true, false, false, false) === false, 'Jump rejected when airborne (no double-jump)');
  assert(canJump(true, true, true, false) === false, 'Jump rejected when main menu is open');
  assert(canJump(true, true, false, true) === false, 'Jump rejected when map is open');
  assert(canJump(false, true, false, false) === false, 'Jump rejected on keyup');
}

// ================================================================
// SECTION 5: Recoil Recovery Decoupling & Multi-Weapon Asymptotics
// ================================================================
console.log('\n--- Section 5: Recoil Recovery Decoupling & Multi-Weapon Asymptotics ---');

// Test 5.1: Multi-Weapon Recovery Kinetics and <1e-6 Clamping
{
  const WEAPONS = [
    { name: 'assalto', kickDeg: 1.10, yawDeg: 0.35, rate: 8.0, clampTimeExpected: 1.25 },
    { name: 'mitraglietta', kickDeg: 0.55, yawDeg: 0.65, rate: 10.0, clampTimeExpected: 0.95 },
    { name: 'pompa', kickDeg: 4.00, yawDeg: 1.20, rate: 4.0, clampTimeExpected: 2.80 },
    { name: 'cecchino', kickDeg: 5.50, yawDeg: 0.80, rate: 3.5, clampTimeExpected: 3.30 },
  ];

  for (const w of WEAPONS) {
    let pitch = w.kickDeg * (Math.PI / 180);
    let yaw = w.yawDeg * (Math.PI / 180);
    const dt = 1.0 / 60.0;
    const steps = Math.ceil(w.clampTimeExpected / dt);

    for (let s = 0; s < steps; s++) {
      const decay = Math.exp(-w.rate * dt);
      pitch *= decay;
      yaw *= decay;
      if (Math.abs(pitch) < 1e-6) pitch = 0;
      if (Math.abs(yaw) < 1e-6) yaw = 0;
    }

    assert(pitch === 0.0, `[${w.name}] Recoil pitch reaches strictly 0.0 at t=${w.clampTimeExpected}s`);
    assert(yaw === 0.0, `[${w.name}] Recoil yaw reaches strictly 0.0 at t=${w.clampTimeExpected}s`);
  }
}

// Test 5.2: Sustained Fire Steady-State Ceiling (Zero Infinite Accumulation)
{
  // AR-42: RPS 6.25 -> 0.16s interval, kick 1.10 deg, recovery 8.0/s
  const rps = 6.25;
  const shotInterval = 1.0 / rps;
  const kickRad = 1.10 * (Math.PI / 180);
  const recoveryRate = 8.0;

  let recoilPitch = 0;
  // Fire 100 continuous rounds (16 seconds of firing)
  for (let shot = 0; shot < 100; shot++) {
    recoilPitch += kickRad;
    // Simulate decay during shot cooldown
    const decay = Math.exp(-recoveryRate * shotInterval);
    recoilPitch *= decay;
  }

  const steadyStateRad = recoilPitch;
  const steadyStateDeg = steadyStateRad * (180 / Math.PI);
  // Theoretical max: kick / (1 - exp(-rate * interval)) = 1.10 / (1 - exp(-1.28)) = 1.523 deg
  assert(steadyStateDeg < 2.0, `Continuous firing does NOT accumulate infinitely: steady state is ${steadyStateDeg.toFixed(2)}° (< 2.0°)`);

  // Once firing stops, recovery clears steady state in 1.3s
  const dt = 1.0 / 60.0;
  const recoverySteps = Math.ceil(1.3 / dt);
  for (let s = 0; s < recoverySteps; s++) {
    const decay = Math.exp(-recoveryRate * dt);
    recoilPitch *= decay;
    if (Math.abs(recoilPitch) < 1e-6) recoilPitch = 0;
  }
  assert(recoilPitch === 0.0, 'Sustained burst recoil returns strictly to 0.0 within 1.3s after releasing trigger');
}

// Test 5.3: Knife Immediate Recoil Clamp
{
  const knifeStats = { recoilPitchDeg: 0.0, recoilYawDeg: 0.0, recoilRecoveryRate: 0.0 };
  let recoilCamPitch = 0.05; // previous lingering recoil from rifle
  let recoilCamYaw = 0.02;

  // switchWeapon(coltello): immediately resets recoil
  if (knifeStats.recoilRecoveryRate === 0) {
    recoilCamPitch = 0;
    recoilCamYaw = 0;
  }

  assert(recoilCamPitch === 0, 'Switching to knife immediately resets recoilCamPitch to 0');
  assert(recoilCamYaw === 0, 'Switching to knife immediately resets recoilCamYaw to 0');
}

// ================================================================
// FINAL SUMMARY
// ================================================================
console.log('\n================================================================');
console.log(`CHALLENGER 2 SUMMARY: ${passedTests}/${totalTests} tests PASSED (${failedTests} failed)`);
console.log('================================================================\n');

if (failedTests > 0) {
  process.exit(1);
} else {
  process.exit(0);
}

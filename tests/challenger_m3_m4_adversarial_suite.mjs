/**
 * Challenger M3 & M4: Deep Adversarial Combat Lifecycle & Invulnerability Shield Test Suite
 *
 * Verifies Acceptance Criteria for Milestones 3 & 4:
 * "Un giocatore che subisce danni fatali sparisce, rinasce dopo 5s esatti.
 *  Durante i 10s successivi, qualsiasi proiettile validato dall'Host contro di lui viene ignorato (0 danni registrati)."
 *
 * Sections:
 * 1. Fatal Damage, Overkill Clamping & 5.0s Death State Invariants
 * 2. Death Boundary Precision (t=4.999s locked, t=5.000s respawn trigger)
 * 3. Central Platform Respawn Coordinates [0.0, 17.5, 0.0] & 100 HP Restoration
 * 4. 10.0s Invulnerability Shield: All 5 Weapons & Headshots Blocked (Strictly 0 Damage)
 * 5. High-Frequency Sustained Fire Bombardment (500 Shots Blocked with Zero HP Loss)
 * 6. Shield Asymmetry: Shielded Shooter Successfully Inflicts Damage on Unshielded Targets
 * 7. Shield Expiration at 10.0s & Resumption of Normal Damage & Multi-Cycle Deaths
 * 8. 3D Cyan Sphere VFX (SphereGeometry 1.85m, 0x00F0FF, AdditiveBlending) & GPU Disposal
 * 9. P2P Binary Snapshot & HealthHUD Synchronization
 */

import * as THREE from '../game-web/node_modules/three/build/three.module.js';
import { P2PHost } from '../game-web/src/net/p2pHost.ts';
import { P2PClient } from '../game-web/src/net/p2pClient.ts';
import {
  PACKET_TYPE,
  STATE_FLAGS,
  HIT_FLAGS,
  encodeFireHitscan,
  decodeFireHitscan,
  encodeWorldSnapshot,
  decodeWorldSnapshot,
  encodeHitConfirmed,
  decodeHitConfirmed,
  encodeLobbyJoin,
} from '../game-web/src/net/binaryProtocol.ts';
import { HealthHUDController } from '../game-web/src/ui/healthHud.ts';
import { ShieldVFXController } from '../game-web/src/vfx/shieldVfx.ts';
import { MockDataChannel } from './helpers/p2p_mock_channel.mjs';

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;
const failureDetails = [];

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    failureDetails.push(message);
    console.error(`  ✘ [FAIL] ${message}`);
  } else {
    passedTests++;
    console.log(`  ✔ [PASS] ${message}`);
  }
}

function assertEqual(actual, expected, message = '') {
  assert(
    actual === expected,
    `${message} Expected: ${JSON.stringify(expected)}, Got: ${JSON.stringify(actual)}`
  );
}

function assertCloseTo(actual, expected, epsilon = 1e-4, message = '') {
  const diff = Math.abs(actual - expected);
  assert(
    diff <= epsilon,
    `${message} Expected ~${expected}, Got ${actual} (diff ${diff.toFixed(6)} > ${epsilon})`
  );
}

function assertGreaterThan(actual, min, message = '') {
  assert(actual > min, `${message} Expected ${actual} > ${min}`);
}

async function runAdversarialSuite() {
  console.log(`
================================================================================
  CHALLENGER M3/M4: ADVERSARIAL COMBAT LIFECYCLE & SHIELD VERIFICATION SUITE
================================================================================
`);

  // ===========================================================================
  // SECTION 1: Fatal Damage, Overkill Clamping & Death State Invariants
  // ===========================================================================
  console.log('--- Section 1: Fatal Damage, Overkill Clamping & Death State Invariants ---');

  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_1', hostChan);
    host.handleChannelMessage('victim_1', hostChan, encodeLobbyJoin('victim_1', 'VictimOne', '#FF0055'));

    const victim = host.playerRecords.get('victim_1');
    assert(victim !== undefined, 'Victim 1 registered successfully');
    assertEqual(victim.hp, 100, 'Initial HP is 100');
    assertEqual(victim.isAlive, true, 'Victim starts alive');

    // Test sub-lethal damage (99 HP)
    victim.shieldExpiresAt = 0; // Drop initial shield for test
    const subLethal = host.dealDamage('victim_1', 99);
    assertEqual(subLethal.effectiveDamage, 99, 'Sub-lethal damage deals exactly 99 HP');
    assertEqual(subLethal.newHp, 1, 'Victim HP is 1 after 99 damage');
    assertEqual(subLethal.isFatal, false, 'Damage is not fatal');
    assertEqual(victim.isAlive, true, 'Victim remains alive at 1 HP');
    assertEqual(victim.deathTime, 0, 'deathTime is 0 while alive');

    // Deal 1 final HP
    const lethal = host.dealDamage('victim_1', 1);
    assertEqual(lethal.effectiveDamage, 1, '1 HP damage deals 1 HP');
    assertEqual(lethal.newHp, 0, 'HP drops to 0');
    assertEqual(lethal.isFatal, true, 'Damage is fatal');
    assertEqual(victim.isAlive, false, 'Victim is dead');
    assertGreaterThan(victim.deathTime, 0, 'deathTime timestamp recorded');

    // Overkill test on a fresh player: deal 10,000 damage
    host.registerPeer('victim_overkill', hostChan);
    host.handleChannelMessage('victim_overkill', hostChan, encodeLobbyJoin('victim_overkill', 'OverkillVictim', '#39FF14'));
    const overkillVic = host.playerRecords.get('victim_overkill');
    overkillVic.shieldExpiresAt = 0;

    const overkillResult = host.dealDamage('victim_overkill', 10000);
    assertEqual(overkillResult.isFatal, true, 'Massive damage is fatal');
    assertEqual(overkillResult.effectiveDamage, 100, 'Effective damage clamped to victim HP (100)');
    assertEqual(overkillResult.newHp, 0, 'HP is clamped to 0, never negative');
    assertEqual(overkillVic.hp, 0, 'Authoritative HP is 0');
    assertEqual(overkillVic.isAlive, false, 'Victim is dead');

    // Subsequent damage against dead player must be completely ignored
    const postMortem = host.dealDamage('victim_overkill', 500);
    assertEqual(postMortem.effectiveDamage, 0, 'Damage against dead player deals 0 effective damage');
    assertEqual(postMortem.newHp, 0, 'HP remains 0');
    assertEqual(postMortem.isFatal, false, 'Post-mortem hit is not flagged as fatal kill');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 2: 5.0s Death Boundary Precision & Post-Mortem Shot Rejection
  // ===========================================================================
  console.log('\n--- Section 2: 5.0s Death Boundary Precision & Post-Mortem Shot Rejection ---');

  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_death_timing', hostChan);
    host.handleChannelMessage('victim_death_timing', hostChan, encodeLobbyJoin('victim_death_timing', 'TimingVictim', '#FFFF00'));

    const vic = host.playerRecords.get('victim_death_timing');
    vic.shieldExpiresAt = 0;
    vic.position = { x: 0, y: 17.5, z: 5 };

    // Kill victim at t = 100000ms
    const deathInstant = 100000;
    vic.hp = 0;
    vic.isAlive = false;
    vic.deathTime = deathInstant;

    // Test multiple ticks at t < 5.0s
    // At t = 1000ms after death
    host.tickSnapshot(deathInstant + 1000);
    assertEqual(vic.isAlive, false, 'Dead at +1.0s');
    assertEqual(vic.hp, 0, 'HP is 0 at +1.0s');

    // At t = 2500ms after death
    host.tickSnapshot(deathInstant + 2500);
    assertEqual(vic.isAlive, false, 'Dead at +2.5s');

    // At t = 4900ms after death (4.9s elapsed)
    host.tickSnapshot(deathInstant + 4900);
    assertEqual(vic.isAlive, false, 'Dead at +4.9s');

    // At t = 4999ms after death (4.999s elapsed - exactly 1ms before respawn)
    host.tickSnapshot(deathInstant + 4999);
    assertEqual(vic.isAlive, false, 'Dead at +4.999s (must not respawn early)');
    assertEqual(vic.deathTime, deathInstant, 'deathTime preserved at +4.999s');

    // Fire 50 hitscan shots straight at dead victim's position during death phase
    let confirmedHits = 0;
    host.options.onHitConfirmed = () => { confirmedHits++; };

    for (let i = 0; i < 50; i++) {
      host.fireHitscan('host_leader', 0, [0, 18.0, 0], [0, 0, 1]);
    }
    assertEqual(confirmedHits, 0, 'All 50 shots against dead player must be ignored (0 hits confirmed)');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 3: Central Platform Respawn Coordinates [0.0, 17.5, 0.0] & Full HP
  // ===========================================================================
  console.log('\n--- Section 3: Central Platform Respawn Coordinates [0.0, 17.5, 0.0] & Full HP ---');

  {
    let respawnEventPlayerId = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
      onPlayerRespawned: (id) => { respawnEventPlayerId = id; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_respawn', hostChan);
    host.handleChannelMessage('victim_respawn', hostChan, encodeLobbyJoin('victim_respawn', 'RespawnVictim', '#FF00FF'));

    const vic = host.playerRecords.get('victim_respawn');
    vic.shieldExpiresAt = 0;
    // Set death position far away from center platform
    vic.position = { x: -150.5, y: 42.0, z: 275.8 };
    vic.hp = 0;
    vic.isAlive = false;
    const deathInstant = 200000;
    vic.deathTime = deathInstant;

    // At t = 5000ms: exact respawn boundary
    const respawnTime = deathInstant + 5000;
    host.tickSnapshot(respawnTime);

    assertEqual(vic.isAlive, true, 'Player must be alive at t = 5000ms');
    assertEqual(vic.hp, 100, 'HP restored to exactly 100');
    assertEqual(vic.deathTime, 0, 'deathTime reset to 0');
    assertEqual(vic.position.x, 0.0, 'Respawn position.x is strictly 0.0');
    assertEqual(vic.position.y, 17.5, 'Respawn position.y is strictly 17.5');
    assertEqual(vic.position.z, 0.0, 'Respawn position.z is strictly 0.0');
    assertEqual(respawnEventPlayerId, 'victim_respawn', 'onPlayerRespawned callback invoked with victim ID');
    assertEqual(vic.shieldExpiresAt, respawnTime + 10000, 'shieldExpiresAt set to exactly now + 10000ms');
    assertEqual((vic.stateFlags & STATE_FLAGS.ALIVE) !== 0, true, 'STATE_FLAGS.ALIVE bit set');
    assertEqual((vic.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) !== 0, true, 'STATE_FLAGS.SHIELD_ACTIVE bit set');

    // Also test direct host.respawnPlayer(id) API
    vic.hp = 20;
    vic.position = { x: 80, y: 10, z: 80 };
    const directRespawnOk = host.respawnPlayer('victim_respawn');
    assertEqual(directRespawnOk, true, 'respawnPlayer returns true for valid player');
    assertEqual(vic.hp, 100, 'Direct respawn restores 100 HP');
    assertEqual(vic.position.x, 0.0, 'Direct respawn moves X to 0.0');
    assertEqual(vic.position.y, 17.5, 'Direct respawn moves Y to 17.5');
    assertEqual(vic.position.z, 0.0, 'Direct respawn moves Z to 0.0');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 4: 10.0s Invulnerability Shield: All 5 Weapons & Headshots Blocked
  // ===========================================================================
  console.log('\n--- Section 4: 10.0s Invulnerability Shield: All 5 Weapons & Headshots Blocked ---');

  {
    let lastHitEvent = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => { lastHitEvent = evt; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_shield_weapons', hostChan);
    host.handleChannelMessage('victim_shield_weapons', hostChan, encodeLobbyJoin('victim_shield_weapons', 'ShieldVictim', '#FF0077'));

    const vic = host.playerRecords.get('victim_shield_weapons');
    host.respawnPlayer('victim_shield_weapons'); // Respawn at [0, 17.5, 0] with 10s shield

    // Test weapons: 0: Assalto, 1: Cecchino, 2: Pompa, 3: Mitraglietta, 4: Coltello
    const weapons = [
      { id: 0, name: 'Assalto (AR)' },
      { id: 1, name: 'Cecchino (Sniper)' },
      { id: 2, name: 'Pompa (Shotgun)' },
      { id: 3, name: 'Mitraglietta (SMG)' },
      { id: 4, name: 'Coltello (Knife)' },
    ];

    for (const w of weapons) {
      lastHitEvent = null;
      // Host fires from [0, 18.0, -5] towards victim at [0, 17.5, 0]
      host.fireHitscan('host_leader', w.id, [0, 18.0, -5], [0, 0, 1]);

      assert(lastHitEvent !== null, `${w.name}: Hitscan confirms intersection`);
      assertEqual(lastHitEvent.isShieldBlocked, true, `${w.name}: Hit is marked isShieldBlocked`);
      assertEqual(lastHitEvent.damage, 0, `${w.name}: Damage is strictly 0`);
      assertEqual(lastHitEvent.newHp, 100, `${w.name}: newHp in hit event is 100`);
      assertEqual(vic.hp, 100, `${w.name}: Authoritative victim HP remains 100`);
    }

    // Headshot test against shielded victim: Sniper shot aimed at head height (17.5 + 2.0 * 0.9 = 19.3)
    lastHitEvent = null;
    host.fireHitscan('host_leader', 1, [0, 19.3, -5], [0, 0, 1]);
    assert(lastHitEvent !== null, 'Headshot: Hit confirmed');
    assertEqual(lastHitEvent.isHeadshot, true, 'Headshot: Flagged as headshot');
    assertEqual(lastHitEvent.isShieldBlocked, true, 'Headshot: Blocked by shield');
    assertEqual(lastHitEvent.damage, 0, 'Headshot: 0 damage despite 2.0x multiplier');
    assertEqual(vic.hp, 100, 'Headshot: Victim HP remains 100');

    // Test timing checkpoints throughout 10s shield window:
    const now = performance.now();
    // Checkpoint at t = 0.001s
    vic.shieldExpiresAt = now + 9999;
    lastHitEvent = null;
    host.fireHitscan('host_leader', 0, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(lastHitEvent.damage, 0, 't = 0.001s: 0 damage');

    // Checkpoint at t = 5.000s
    vic.shieldExpiresAt = now + 5000;
    lastHitEvent = null;
    host.fireHitscan('host_leader', 1, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(lastHitEvent.damage, 0, 't = 5.000s: 0 damage');

    // Checkpoint at t = 9.999s (just before expiration)
    const freshNow = performance.now();
    vic.shieldExpiresAt = freshNow + 50;
    lastHitEvent = null;
    host.fireHitscan('host_leader', 0, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(lastHitEvent.damage, 0, 't = 9.999s: 0 damage');
    assertEqual(vic.hp, 100, 'Victim HP is still 100');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 5: High-Frequency Sustained Fire Bombardment (500 Shots Blocked)
  // ===========================================================================
  console.log('\n--- Section 5: High-Frequency Sustained Fire Bombardment (500 Shots Blocked) ---');

  {
    let hitsCount = 0;
    let totalDmgRegistered = 0;

    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => {
        hitsCount++;
        totalDmgRegistered += evt.damage;
      },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_barrage', hostChan);
    host.handleChannelMessage('victim_barrage', hostChan, encodeLobbyJoin('victim_barrage', 'BarrageVictim', '#FF3366'));

    const vic = host.playerRecords.get('victim_barrage');
    host.respawnPlayer('victim_barrage');

    // Bombard victim with 500 consecutive hitscan rounds alternating weapons
    for (let i = 0; i < 500; i++) {
      const weaponType = i % 5;
      host.fireHitscan('host_leader', weaponType, [0, 18.0, -5], [0, 0, 1]);
    }

    assertEqual(hitsCount, 500, '500/500 hitscan shots validated against victim cylinder');
    assertEqual(totalDmgRegistered, 0, 'Total cumulative damage registered across 500 shots is strictly 0');
    assertEqual(vic.hp, 100, 'Authoritative HP remains exactly 100 after 500 shots');
    assertEqual(vic.isAlive, true, 'Victim remains alive');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 6: Shield Asymmetry: Shielded Shooter Inflicts Damage on Unshielded Targets
  // ===========================================================================
  console.log('\n--- Section 6: Shield Asymmetry: Shielded Shooter Inflicts Damage ---');

  {
    let lastHitEvent = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => { lastHitEvent = evt; },
    });

    const hostChan2 = new MockDataChannel('host2');
    const clientChan2 = new MockDataChannel('client2');
    hostChan2.connect(clientChan2);

    host.registerPeer('victim_unshielded', hostChan2);
    host.handleChannelMessage('victim_unshielded', hostChan2, encodeLobbyJoin('victim_unshielded', 'UnshieldedVictim', '#FF6600'));

    const shooter = host.playerRecords.get('host_leader');
    const victim = host.playerRecords.get('victim_unshielded');

    // Shooter (host_leader) is shielded for 10s
    shooter.shieldExpiresAt = performance.now() + 10000;
    // Victim's shield has expired
    victim.shieldExpiresAt = 0;
    victim.position = { x: 0, y: 17.5, z: 10 };

    // Shielded shooter fires sniper (weapon 1, base 90) at unshielded victim
    lastHitEvent = null;
    host.fireHitscan('host_leader', 1, [0, 18.0, 0], [0, 0, 1]);

    assert(lastHitEvent !== null, 'Hit confirmed from shielded shooter');
    assertEqual(lastHitEvent.isShieldBlocked, false, 'Hit against unshielded victim is NOT blocked');
    assertEqual(lastHitEvent.damage, 90, 'Victim receives full 90 damage');
    assertEqual(lastHitEvent.newHp, 10, 'Victim newHp is 10');
    assertEqual(victim.hp, 10, 'Victim record HP reduced to 10');

    // Shooter itself remains at 100 HP and shielded
    assertEqual(shooter.hp, 100, 'Shooter HP remains 100');
    assertGreaterThan(shooter.shieldExpiresAt, performance.now(), 'Shooter shield still active');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 7: Shield Expiration at 10.0s & Multi-Cycle Death / Respawn
  // ===========================================================================
  console.log('\n--- Section 7: Shield Expiration at 10.0s & Multi-Cycle Death / Respawn ---');

  {
    let lastHitEvent = null;
    let respawnCount = 0;

    const host = new P2PHost({
      hostPlayer: { id: 'host_leader', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => { lastHitEvent = evt; },
      onPlayerRespawned: () => { respawnCount++; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);

    host.registerPeer('victim_recycle', hostChan);
    host.handleChannelMessage('victim_recycle', hostChan, encodeLobbyJoin('victim_recycle', 'RecycleVictim', '#CC00FF'));

    const vic = host.playerRecords.get('victim_recycle');
    host.respawnPlayer('victim_recycle');
    respawnCount = 1;

    // Fast-forward simulated time to 10.001s post-respawn (shield expired)
    const baseTime = performance.now();
    vic.shieldExpiresAt = baseTime - 1; // Expired 1ms ago

    // Run snapshot tick to update flags
    host.tickSnapshot(baseTime);
    assertEqual((vic.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) === 0, true, 'SHIELD_ACTIVE flag cleared after 10s');

    // Shoot assault rifle (34 base dmg)
    lastHitEvent = null;
    host.fireHitscan('host_leader', 0, [0, 18.0, -5], [0, 0, 1]);
    assert(lastHitEvent !== null, 'Hit confirmed post-shield');
    assertEqual(lastHitEvent.isShieldBlocked, false, 'Hit NOT blocked after shield expiration');
    assertEqual(lastHitEvent.damage, 34, 'Normal damage 34 dealt');
    assertEqual(vic.hp, 66, 'HP reduced to 66');

    // Deal fatal damage to trigger 2nd death cycle
    const lethal2 = host.dealDamage('victim_recycle', 70);
    assertEqual(lethal2.isFatal, true, 'Second death is fatal');
    assertEqual(vic.isAlive, false, 'Victim dead again');
    assertEqual(vic.hp, 0, 'HP is 0');
    const deathTime2 = baseTime + 1000;
    vic.deathTime = deathTime2;

    // Simulate 4.9s in 2nd death cycle
    host.tickSnapshot(deathTime2 + 4900);
    assertEqual(vic.isAlive, false, 'Victim still dead at +4.9s in 2nd cycle');

    // Simulate 5.0s: 2nd respawn
    host.tickSnapshot(deathTime2 + 5000);
    assertEqual(vic.isAlive, true, 'Victim respawned in 2nd cycle');
    assertEqual(vic.hp, 100, 'HP restored to 100 in 2nd cycle');
    assertEqual(vic.position.x, 0.0, 'Respawned at X=0.0 in 2nd cycle');
    assertEqual(vic.position.y, 17.5, 'Respawned at Y=17.5 in 2nd cycle');
    assertEqual(vic.position.z, 0.0, 'Respawned at Z=0.0 in 2nd cycle');
    assertGreaterThan(vic.shieldExpiresAt, deathTime2 + 5000 + 9000, 'Fresh 10s shield granted on 2nd respawn');
    assertEqual(respawnCount, 2, '2nd respawn callback triggered');

    // Confirm fresh shield blocks damage again
    lastHitEvent = null;
    host.fireHitscan('host_leader', 1, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(lastHitEvent.damage, 0, 'Fresh shield in 2nd cycle blocks damage');
    assertEqual(vic.hp, 100, 'HP remains 100');

    host.destroy();
  }

  // ===========================================================================
  // SECTION 8: 3D Cyan Sphere VFX (SphereGeometry 1.85m, 0x00F0FF) & Disposal
  // ===========================================================================
  console.log('\n--- Section 8: 3D Cyan Sphere VFX & GPU Disposal ---');

  {
    const vfx = new ShieldVFXController();
    const scene = new THREE.Scene();
    const playerGroup = new THREE.Group();
    scene.add(playerGroup);

    const shieldInst = vfx.attachShield(playerGroup, 10.0);
    assert(shieldInst !== undefined, 'Shield instance created');
    assertEqual(vfx.getActiveCount(), 1, 'Active shield count is 1');
    assertEqual(vfx.hasShield(playerGroup), true, 'hasShield is true');

    // Geometry & Material checks
    const geo = shieldInst.mesh.geometry;
    assertEqual(geo.parameters.radius, 1.85, 'Radius is exactly 1.85m');
    assertEqual(geo.parameters.widthSegments, 32, 'widthSegments is 32');
    assertEqual(geo.parameters.heightSegments, 32, 'heightSegments is 32');

    const mat = shieldInst.mesh.material;
    assertEqual(mat.color.getHex(), 0x00f0ff, 'Color is 0x00F0FF');
    assertCloseTo(mat.opacity, 0.28, 1e-4, 'Base opacity is 0.28');
    assertEqual(mat.transparent, true, 'Material transparent is true');
    assertEqual(mat.depthWrite, false, 'Material depthWrite is false');
    assertEqual(mat.blending, THREE.AdditiveBlending, 'Material blending is AdditiveBlending');

    // Energy pulse update
    const origScale = shieldInst.mesh.scale.x;
    vfx.update(0.26); // near peak of sin(6*t)
    assert(shieldInst.mesh.scale.x !== origScale, 'Scale modulates during update');
    assertGreaterThan(shieldInst.mesh.scale.x, 0.98, 'Scale pulse stays within bounds');

    // Re-attach refresh test: attaching again should refresh duration to 10.0s without duplicate mesh
    const childCountBefore = playerGroup.children.length;
    vfx.attachShield(playerGroup, 10.0);
    assertEqual(playerGroup.children.length, childCountBefore, 'Child mesh count does not duplicate on re-attach');
    assertEqual(shieldInst.remainingTime, 10.0, 'Timer refreshed to 10.0s');

    // Advance to 9.9s: shield still active
    vfx.update(9.9);
    assertEqual(vfx.hasShield(playerGroup), true, 'Shield active at 9.9s');
    assertEqual(playerGroup.children.includes(shieldInst.mesh), true, 'Mesh still attached at 9.9s');

    // Advance 0.2s: total 10.1s -> automatic disposal
    let geoDisposed = false;
    let matDisposed = false;
    shieldInst.geometry.dispose = () => { geoDisposed = true; };
    shieldInst.material.dispose = () => { matDisposed = true; };

    vfx.update(0.2);
    assertEqual(vfx.hasShield(playerGroup), false, 'Shield expired and inactive at 10.1s');
    assertEqual(vfx.getActiveCount(), 0, 'Active shield count is 0');
    assertEqual(playerGroup.children.includes(shieldInst.mesh), false, 'Mesh detached from playerGroup');
    assertEqual(geoDisposed, true, 'Geometry disposed on expiration');
    assertEqual(matDisposed, true, 'Material disposed on expiration');
    assertEqual(shieldInst.disposed, true, 'Instance disposed flag set');

    // Manual detach check on fresh instance
    const freshTarget = new THREE.Group();
    const inst2 = vfx.attachShield(freshTarget, 10.0);
    assertEqual(vfx.hasShield(freshTarget), true);
    vfx.detachShield(freshTarget);
    assertEqual(vfx.hasShield(freshTarget), false);
    assertEqual(freshTarget.children.length, 0, 'Mesh removed on detach');

    vfx.disposeAll();
  }

  // ===========================================================================
  // SECTION 9: P2P Binary Snapshot & HealthHUD Synchronization
  // ===========================================================================
  console.log('\n--- Section 9: P2P Binary Snapshot & HealthHUD Synchronization ---');

  {
    // Mock DOM elements for HUD
    const mockHpVal = { textContent: '', className: '' };
    const mockHpBar = { style: { width: '' }, className: '' };
    const mockBadge = {
      classList: {
        set: new Set(['hidden']),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
        contains(c) { return this.set.has(c); },
      },
    };
    const mockShieldTimer = { textContent: '' };
    const mockOverlay = {
      classList: {
        set: new Set(['hidden']),
        add(c) { this.set.add(c); },
        remove(c) { this.set.delete(c); },
        contains(c) { return this.set.has(c); },
      },
    };
    const mockDeathCountdown = { textContent: '' };

    const hud = new HealthHUDController({
      hpVal: mockHpVal,
      hpBar: mockHpBar,
      shieldBadge: mockBadge,
      shieldTimer: mockShieldTimer,
      deathOverlay: mockOverlay,
      deathCountdown: mockDeathCountdown,
    });

    // Test HUD health full
    hud.updateHealth(100, 100);
    assertEqual(mockHpVal.textContent, '100 HP');
    assertEqual(mockHpBar.style.width, '100%');
    assert(mockHpVal.className.includes('text-emerald-400'), 'Full health emerald text');

    // Test HUD health critical (<= 30%)
    hud.updateHealth(25, 100);
    assertEqual(mockHpVal.textContent, '25 HP');
    assertEqual(mockHpBar.style.width, '25%');
    assert(mockHpVal.className.includes('text-rose-500'), 'Critical health rose-500 text');
    assert(mockHpBar.className.includes('from-red-600'), 'Critical health red gradient bar');

    // Test HUD shield countdown
    hud.updateShield(9.5);
    assertEqual(hud.isShieldActive, true);
    assertEqual(mockBadge.classList.contains('flex'), true);
    assertEqual(mockShieldTimer.textContent, '9.5s');

    hud.updateShield(0);
    assertEqual(hud.isShieldActive, false);
    assertEqual(mockBadge.classList.contains('hidden'), true);

    // Test HUD death overlay
    hud.showDeathOverlay(5.0);
    assertEqual(hud.isDeathOverlayVisible, true);
    assertEqual(mockOverlay.classList.contains('flex'), true);
    assertEqual(mockDeathCountdown.textContent, '5.0');

    hud.updateDeathCountdown(2.4);
    assertEqual(mockDeathCountdown.textContent, '2.4');

    hud.hideDeathOverlay();
    assertEqual(hud.isDeathOverlayVisible, false);
    assertEqual(mockOverlay.classList.contains('hidden'), true);

    // Test P2PClient binary snapshot ingestion
    let clientSnapshot = null;
    const client = new P2PClient({
      playerId: 'test_client',
      playerName: 'Hero',
      onWorldSnapshot: (s) => { clientSnapshot = s; },
    });
    client.playerSlot = 3;

    // Encode binary world snapshot with 100 HP and shield
    const snapshotBuffer = encodeWorldSnapshot(
      1,
      123456.0,
      [
        {
          slot: 3,
          hp: 100,
          flags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
          activeWeapon: 0,
          x: 0.0,
          y: 17.5,
          z: 0.0,
          yaw: 0.0,
          pitch: 0.0,
          timerRemainingMs: 9800,
        },
      ]
    );

    client.handleMessage(snapshotBuffer);
    assert(clientSnapshot !== null, 'Binary snapshot decoded by P2PClient');
    assertEqual(client.clientHp, 100, 'clientHp set to 100');
    assertEqual(client.isAlive, true, 'isAlive set to true');
    assertEqual(client.isShielded, true, 'isShielded set to true');
    assertEqual(client.timerRemainingMs, 9800, 'timerRemainingMs set to 9800');

    // Send fatal binary hit confirmed
    const fatalHitBuffer = encodeHitConfirmed(
      3, // victimSlot
      0, // shooterSlot
      HIT_FLAGS.FATAL_KILL,
      100,
      0,
      0.0,
      17.5,
      0.0
    );

    client.handleMessage(fatalHitBuffer);
    assertEqual(client.clientHp, 0, 'clientHp dropped to 0 on fatal hit');
    assertEqual(client.isAlive, false, 'isAlive transitioned to false on fatal hit');
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log(`
================================================================================
  CHALLENGER M3/M4 SUITE COMPLETE
  Total Assertions: ${totalTests}
  Passed:           ${passedTests}
  Failed:           ${failedTests}
================================================================================
`);

  if (failedTests > 0) {
    console.error('FAILURES ENCOUNTERED:');
    failureDetails.forEach((f, i) => console.error(`  ${i + 1}. ${f}`));
    process.exit(1);
  }
}

runAdversarialSuite().catch((err) => {
  console.error('UNCAUGHT ERROR IN ADVERSARIAL SUITE:', err);
  process.exit(1);
});

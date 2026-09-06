/**
 * tests/challenger_m3_m4_3_adversarial_suite.mjs
 *
 * Empirical Adversarial Challenger 3 Suite for Milestones 3 & 4:
 * Combat Lifecycle (Health, Death, 5s Respawn, Central Platform) &
 * Invulnerability Shield (10s Immunity, 0 Damage, 3D Cyan Sphere VFX).
 *
 * Strictly tests:
 * 1. Fatal damage -> death state lasting exactly 5.0 seconds.
 * 2. Respawn at central platform [0.0, 17.5, 0.0] with 100 HP.
 * 3. During 10.0 seconds of immunity, shots validated by Host deal strictly 0 damage.
 * 4. After 10.0 seconds, immunity expires and shots inflict normal damage.
 * 5. High-concurrency 8-player staggered death/respawn matrix.
 * 6. Shielded player offensive asymmetry.
 * 7. 3D cyan sphere VFX lifecycle, sinusoidal pulse & GPU resource disposal.
 * 8. Binary wire protocol and HUD synchronization.
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

let totalAssertions = 0;
let passedAssertions = 0;
let failedAssertions = 0;
const failureDetails = [];

function assert(condition, message) {
  totalAssertions++;
  if (!condition) {
    failedAssertions++;
    failureDetails.push(message);
    console.error(`  ✘ [FAIL] ${message}`);
  } else {
    passedAssertions++;
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

async function runEmpiricalChallengerSuite() {
  console.log(`
================================================================================
  EMPIRICAL CHALLENGER 3: ADVERSARIAL COMBAT LIFECYCLE & SHIELD SUITE
================================================================================
`);

  // ===========================================================================
  // SECTION 1: Fatal Damage, Overkill & Sub-Lethal Invariants
  // ===========================================================================
  console.log('--- Section 1: Fatal Damage, Overkill & Sub-Lethal Invariants ---');
  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_victim', hostChan);
    host.handleChannelMessage('peer_victim', hostChan, encodeLobbyJoin('peer_victim', 'VictimPlayer', '#FF0055'));

    const victim = host.playerRecords.get('peer_victim');
    victim.shieldExpiresAt = 0; // strip initial shield

    // Sub-lethal damage test: 100 -> takes 99 damage
    const subLethal = host.dealDamage('peer_victim', 99);
    assertEqual(subLethal.effectiveDamage, 99, 'Sub-lethal damage matches dealt amount');
    assertEqual(subLethal.newHp, 1, 'Victim survives with 1 HP');
    assertEqual(subLethal.isFatal, false, 'Damage is not fatal');
    assertEqual(victim.isAlive, true, 'Victim remains alive at 1 HP');
    assertEqual(victim.deathTime, 0, 'deathTime is not set for living player');

    // Lethal 1 HP damage: 1 -> takes 1 damage
    const lethal = host.dealDamage('peer_victim', 1);
    assertEqual(lethal.effectiveDamage, 1, 'Lethal damage matches remaining HP');
    assertEqual(lethal.newHp, 0, 'Victim HP reaches 0');
    assertEqual(lethal.isFatal, true, 'Damage is fatal');
    assertEqual(victim.isAlive, false, 'Victim is dead');
    assertGreaterThan(victim.deathTime, 0, 'deathTime is recorded');

    // Overkill test on fresh player: 100 HP taking 500 damage
    host.respawnPlayer('peer_victim');
    victim.shieldExpiresAt = 0;
    const overkill = host.dealDamage('peer_victim', 500);
    assertEqual(overkill.effectiveDamage, 100, 'Effective damage is capped at 100 HP');
    assertEqual(overkill.newHp, 0, 'HP clamps strictly to 0 (no negative HP)');
    assertEqual(victim.hp, 0, 'Victim record HP is strictly 0');
    assertEqual(victim.isAlive, false, 'Victim marked dead on overkill');

    // Negative damage check (attempted healing exploit)
    const negativeDmg = host.dealDamage('peer_victim', -50);
    assertEqual(negativeDmg.effectiveDamage, 0, 'Negative damage yields 0 effective damage');
    assertEqual(victim.hp, 0, 'Victim cannot be revived via negative damage');

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 2: Temporal Invariance of the 5.0-Second Death Phase
  // ===========================================================================
  console.log('--- Section 2: Temporal Invariance of 5.0-Second Death Phase ---');
  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });
    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_dead', hostChan);
    host.handleChannelMessage('peer_dead', hostChan, encodeLobbyJoin('peer_dead', 'DeadPlayer', '#FF0055'));

    const deadRecord = host.playerRecords.get('peer_dead');
    deadRecord.shieldExpiresAt = 0;
    host.dealDamage('peer_dead', 100);

    const baseDeathTime = 100000.0;
    deadRecord.deathTime = baseDeathTime;

    // Test checkpoints: t = 1ms, 1000ms, 2500ms, 4999ms after death
    const testOffsets = [1, 500, 1000, 2500, 4000, 4999];
    for (const offset of testOffsets) {
      const sampleTime = baseDeathTime + offset;
      host.tickSnapshot(sampleTime);

      assertEqual(deadRecord.isAlive, false, `Dead player must not be alive at +${offset}ms`);
      assertEqual(deadRecord.hp, 0, `Dead player HP must be 0 at +${offset}ms`);
      assertEqual(deadRecord.deathTime, baseDeathTime, `deathTime must remain unchanged at +${offset}ms`);

      // Fire hitscan directly at dead player
      let hitBroadcast = false;
      host.options.onHitConfirmed = () => { hitBroadcast = true; };
      host.fireHitscan('host_01', 1, [0, 18.0, -10], [0, 0, 1]);
      assertEqual(hitBroadcast, false, `Shots at dead player must be ignored at +${offset}ms`);

      // Attempt dealDamage directly
      const dmgRes = host.dealDamage('peer_dead', 50);
      assertEqual(dmgRes.effectiveDamage, 0, `dealDamage on dead player must do 0 damage at +${offset}ms`);
      assertEqual(dmgRes.isFatal, false, `dealDamage on dead player cannot be fatal at +${offset}ms`);
    }

    // Dead player cannot fire weapons
    let shotRelayed = false;
    host.options.onHitscanFired = () => { shotRelayed = true; };
    const shotData = {
      opcode: PACKET_TYPE.FIRE_HITSCAN,
      shooterSlot: deadRecord.slot,
      weaponType: 0,
      shotSeq: 1,
      shotSequence: 1,
      clientTimestamp: baseDeathTime + 2000,
      originX: 0, originY: 17.5, originZ: 0,
      origin: [0, 17.5, 0],
      dirX: 0, dirY: 0, dirZ: 1,
      direction: [0, 0, 1],
    };
    // Direct call to processFireHitscan through binary packet
    const binFire = encodeFireHitscan(
      deadRecord.slot,
      0,
      1,
      baseDeathTime + 2000,
      [0, 17.5, 0],
      [0, 0, 1]
    );
    host.handleChannelMessage('peer_dead', hostChan, binFire);
    assertEqual(shotRelayed, false, 'Dead player fire hitscan is rejected and not relayed');

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 3: Exact 5.000s Respawn at Central Platform [0.0, 17.5, 0.0]
  // ===========================================================================
  console.log('--- Section 3: Exact 5.000s Respawn at Central Platform ---');
  {
    let respawnFiredCount = 0;
    let respawnedPlayerId = '';
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onPlayerRespawned: (id) => {
        respawnFiredCount++;
        respawnedPlayerId = id;
      },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_respawn', hostChan);
    host.handleChannelMessage('peer_respawn', hostChan, encodeLobbyJoin('peer_respawn', 'RespawnSubject', '#FF0055'));

    const subject = host.playerRecords.get('peer_respawn');
    subject.shieldExpiresAt = 0;
    // Set position far away before dying
    subject.position = { x: 777.7, y: -45.0, z: -888.8 };

    const deathInstant = 200000.0;
    host.dealDamage('peer_respawn', 100);
    subject.deathTime = deathInstant;

    // t = 4999ms: NO respawn
    host.tickSnapshot(deathInstant + 4999.0);
    assertEqual(subject.isAlive, false, 'At 4999ms, player is still dead');
    assertEqual(respawnFiredCount, 0, 'No respawn event at 4999ms');

    // t = 5000ms: EXACT RESPAWN
    host.tickSnapshot(deathInstant + 5000.0);
    assertEqual(subject.isAlive, true, 'At exactly 5000ms, player is alive');
    assertEqual(respawnFiredCount, 1, 'Respawn event fired exactly once');
    assertEqual(respawnedPlayerId, 'peer_respawn', 'Respawn event references correct ID');
    assertEqual(subject.hp, 100, 'HP restored to exactly 100');
    assertEqual(subject.deathTime, 0, 'deathTime reset to 0');
    assertEqual(subject.position.x, 0.0, 'Respawn position X is 0.0');
    assertEqual(subject.position.y, 17.5, 'Respawn position Y is 17.5m');
    assertEqual(subject.position.z, 0.0, 'Respawn position Z is 0.0');
    assertEqual(subject.shieldExpiresAt, deathInstant + 5000.0 + 10000.0, '10s shield granted at respawn');

    // Subsequent tick does not re-trigger respawn
    host.tickSnapshot(deathInstant + 5050.0);
    assertEqual(respawnFiredCount, 1, 'Respawn event does not repeat on subsequent ticks');

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 4: 10.0s Invulnerability Shield - All Weapons & Headshots (0 Damage)
  // ===========================================================================
  console.log('--- Section 4: 10.0s Invulnerability Shield - All Weapons (0 Damage) ---');
  {
    let confirmedHit = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (e) => { confirmedHit = e; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_shielded', hostChan);
    host.handleChannelMessage('peer_shielded', hostChan, encodeLobbyJoin('peer_shielded', 'ShieldedTarget', '#FF0055'));

    const victim = host.playerRecords.get('peer_shielded');
    host.respawnPlayer('peer_shielded');
    const respawnTime = performance.now();
    victim.shieldExpiresAt = respawnTime + 10000;
    victim.position = { x: 0, y: 17.5, z: 0 };

    // Test each weapon type: 0=AR, 1=Sniper, 2=Shotgun, 3=SMG, 4=Knife
    const weapons = [
      { id: 0, name: 'Assalto' },
      { id: 1, name: 'Cecchino' },
      { id: 2, name: 'Pompa' },
      { id: 3, name: 'Mitraglietta' },
      { id: 4, name: 'Coltello' },
    ];

    for (const w of weapons) {
      confirmedHit = null;
      host.fireHitscan('host_01', w.id, [0, 18.0, -5], [0, 0, 1]);

      assert(confirmedHit !== null, `${w.name}: Hitscan confirms hit on cylinder`);
      assertEqual(confirmedHit.isShieldBlocked, true, `${w.name}: Hit is flagged as shield blocked`);
      assertEqual(confirmedHit.damage, 0, `${w.name}: Registered damage is strictly 0 HP`);
      assertEqual(confirmedHit.newHp, 100, `${w.name}: Reported newHp is 100`);
      assertEqual(victim.hp, 100, `${w.name}: Authoritative victim HP remains 100`);
    }

    // Headshot test (origin aimed at top 20% of cylinder: Y = 17.5 + 1.85 = 19.35)
    confirmedHit = null;
    host.fireHitscan('host_01', 1, [0, 19.35, -5], [0, 0, 1]);
    assert(confirmedHit !== null, 'Headshot hit confirmed');
    assertEqual(confirmedHit.isHeadshot, true, 'Hit is identified as headshot');
    assertEqual(confirmedHit.isShieldBlocked, true, 'Headshot is blocked by shield');
    assertEqual(confirmedHit.damage, 0, 'Headshot damage is strictly 0');
    assertEqual(victim.hp, 100, 'Victim HP unaffected by headshot');

    // Shots from all 4 cardinal angles: North, South, East, West
    const cardinalOrigins = [
      { name: 'North (+Z)', origin: [0, 18.0, 5], dir: [0, 0, -1] },
      { name: 'South (-Z)', origin: [0, 18.0, -5], dir: [0, 0, 1] },
      { name: 'East (+X)', origin: [5, 18.0, 0], dir: [-1, 0, 0] },
      { name: 'West (-X)', origin: [-5, 18.0, 0], dir: [1, 0, 0] },
    ];

    for (const card of cardinalOrigins) {
      confirmedHit = null;
      host.fireHitscan('host_01', 0, card.origin, card.dir);
      assert(confirmedHit !== null, `Hit from ${card.name} confirmed`);
      assertEqual(confirmedHit.damage, 0, `Hit from ${card.name} deals 0 damage`);
      assertEqual(confirmedHit.isShieldBlocked, true, `Hit from ${card.name} is blocked`);
    }

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 5: Massive Burst Bombardment (1000 Shots Fired at Shield)
  // ===========================================================================
  console.log('--- Section 5: Massive Burst Bombardment (1000 Shots Fired at Shield) ---');
  {
    let totalBlockedHits = 0;
    let totalDamageDealt = 0;

    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (e) => {
        if (e.isShieldBlocked) totalBlockedHits++;
        totalDamageDealt += e.damage;
      },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_target', hostChan);
    host.handleChannelMessage('peer_target', hostChan, encodeLobbyJoin('peer_target', 'BunkerTarget', '#FF0055'));

    const target = host.playerRecords.get('peer_target');
    host.respawnPlayer('peer_target');
    target.position = { x: 0, y: 17.5, z: 0 };
    target.shieldExpiresAt = performance.now() + 10000;

    // Fire 1,000 rapid-fire shots alternating weapons
    for (let i = 0; i < 1000; i++) {
      const weaponType = i % 5;
      host.fireHitscan('host_01', weaponType, [0, 18.0, -8], [0, 0, 1]);
    }

    assertEqual(totalBlockedHits, 1000, 'All 1,000 shots confirmed and blocked');
    assertEqual(totalDamageDealt, 0, 'Cumulative damage across 1,000 shots is 0');
    assertEqual(target.hp, 100, 'Target HP remains strictly 100 after 1,000 shots');
    assertEqual(target.isAlive, true, 'Target remains alive');

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 6: Exact 10.0s Shield Expiration & Damage Resumption
  // ===========================================================================
  console.log('--- Section 6: Exact 10.0s Shield Expiration & Damage Resumption ---');
  {
    let confirmedHit = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (e) => { confirmedHit = e; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('peer_expiring', hostChan);
    host.handleChannelMessage('peer_expiring', hostChan, encodeLobbyJoin('peer_expiring', 'ExpiringTarget', '#FF0055'));

    const subject = host.playerRecords.get('peer_expiring');
    host.respawnPlayer('peer_expiring');
    const respawnBase = 500000.0;
    subject.position = { x: 0, y: 17.5, z: 0 };
    subject.shieldExpiresAt = respawnBase + 10000.0;

    // t = 9999ms (1ms before expiration): Still immune!
    let blockedAt9999 = false;
    host.options.onHitConfirmed = (e) => { blockedAt9999 = e.isShieldBlocked; };
    // Temporarily mock performance.now for the hitscan check
    const origNow = performance.now;
    performance.now = () => respawnBase + 9999.0;
    host.fireHitscan('host_01', 0, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(blockedAt9999, true, 'At 9999ms, shot is still blocked by shield');
    assertEqual(subject.hp, 100, 'HP is still 100 at 9999ms');

    // t = 10001ms (1ms past expiration): Immunity expired, normal damage taken!
    let blockedAt10001 = true;
    let damageAt10001 = 0;
    performance.now = () => respawnBase + 10001.0;
    host.options.onHitConfirmed = (e) => {
      blockedAt10001 = e.isShieldBlocked;
      damageAt10001 = e.damage;
    };
    host.tickSnapshot(respawnBase + 10001.0);
    assertEqual((subject.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) === 0, true, 'SHIELD_ACTIVE flag cleared at 10001ms');

    // Fire assault rifle (base 34 dmg)
    host.fireHitscan('host_01', 0, [0, 18.0, -5], [0, 0, 1]);
    assertEqual(blockedAt10001, false, 'At 10001ms, shot is NOT blocked');
    assertEqual(damageAt10001, 34, 'Normal assault rifle damage (34 HP) inflicted');
    assertEqual(subject.hp, 66, 'HP reduced to 66');

    performance.now = origNow;
    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 7: Shield Asymmetry - Shielded Player Inflicts Damage on Unshielded
  // ===========================================================================
  console.log('--- Section 7: Shield Asymmetry (Shooter Shielded, Victim Unshielded) ---');
  {
    let confirmedHit = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (e) => { confirmedHit = e; },
    });

    const chanA = new MockDataChannel('chanA');
    const chanB = new MockDataChannel('chanB');
    chanA.connect(chanB);
    host.registerPeer('player_A', chanA);
    host.handleChannelMessage('player_A', chanA, encodeLobbyJoin('player_A', 'PlayerA', '#FF0055'));

    const chanC = new MockDataChannel('chanC');
    const chanD = new MockDataChannel('chanD');
    chanC.connect(chanD);
    host.registerPeer('player_B', chanC);
    host.handleChannelMessage('player_B', chanC, encodeLobbyJoin('player_B', 'PlayerB', '#00FF66'));

    const playerA = host.playerRecords.get('player_A');
    const playerB = host.playerRecords.get('player_B');
    // Move host_01 away so it doesn't intercept the hitscan ray
    host.playerRecords.get('host_01').position = { x: 500, y: 500, z: 500 };

    // Player A is shielded (just respawned)
    host.respawnPlayer('player_A');
    playerA.position = { x: 0, y: 17.5, z: -10 };

    // Player B is unshielded
    host.respawnPlayer('player_B');
    playerB.shieldExpiresAt = 0;
    playerB.position = { x: 0, y: 17.5, z: 0 };

    // A shoots B with sniper (90 dmg)
    confirmedHit = null;
    host.fireHitscan('player_A', 1, [0, 18.0, -10], [0, 0, 1]);

    assert(confirmedHit !== null, 'Hit on player B confirmed');
    assertEqual(confirmedHit.shooterId, 'player_A', 'Shooter is Player A');
    assertEqual(confirmedHit.victimId, 'player_B', 'Victim is Player B');
    assertEqual(confirmedHit.isShieldBlocked, false, 'Hit against unshielded B is not blocked');
    assertEqual(confirmedHit.damage, 90, 'Full sniper damage (90 HP) inflicted on B');
    assertEqual(playerB.hp, 10, 'Player B HP dropped to 10');

    // B shoots A with sniper (90 dmg)
    confirmedHit = null;
    host.fireHitscan('player_B', 1, [0, 18.0, 0], [0, 0, -1]);

    assert(confirmedHit !== null, 'Hit on player A confirmed');
    assertEqual(confirmedHit.isShieldBlocked, true, 'Hit against shielded A is blocked');
    assertEqual(confirmedHit.damage, 0, 'Damage to shielded A is 0');
    assertEqual(playerA.hp, 100, 'Player A HP remains 100');

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 8: Multi-Cycle Lifecycle Loop (20 Consecutive Death/Respawn Cycles)
  // ===========================================================================
  console.log('--- Section 8: Multi-Cycle Lifecycle Loop (20 Cycles) ---');
  {
    let respawnCount = 0;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onPlayerRespawned: () => { respawnCount++; },
    });

    const hostChan = new MockDataChannel('host');
    const clientChan = new MockDataChannel('client');
    hostChan.connect(clientChan);
    host.registerPeer('cycle_player', hostChan);
    host.handleChannelMessage('cycle_player', hostChan, encodeLobbyJoin('cycle_player', 'Cycler', '#FF0055'));

    const p = host.playerRecords.get('cycle_player');
    let simTime = 1000.0;
    const origPerfNow = performance.now;
    performance.now = () => simTime;

    // Initial respawn at simTime = 1000
    host.respawnPlayer('cycle_player');
    respawnCount = 0; // reset to count only the 20 loop respawns

    for (let cycle = 1; cycle <= 20; cycle++) {
      // 1. Player is alive with shield
      assertEqual(p.isAlive, true, `Cycle ${cycle}: Player must be alive at start`);
      assertEqual(p.hp, 100, `Cycle ${cycle}: Player HP must be 100`);

      // 2. Fast-forward past 10s shield (10.001s elapsed)
      simTime += 10001.0;
      host.tickSnapshot(simTime);
      assertEqual((p.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) === 0, true, `Cycle ${cycle}: Shield expired after 10s`);

      // 3. Inflict fatal damage
      const killRes = host.dealDamage('cycle_player', 150);
      assertEqual(killRes.isFatal, true, `Cycle ${cycle}: Kill must be fatal`);
      assertEqual(p.isAlive, false, `Cycle ${cycle}: Player is dead`);
      assertEqual(p.hp, 0, `Cycle ${cycle}: HP is 0`);
      // Scramble position to prove respawn resets it
      p.position = { x: cycle * 10, y: cycle * 5, z: cycle * -10 };

      // 4. Advance 4.9s: still dead
      simTime += 4900.0;
      host.tickSnapshot(simTime);
      assertEqual(p.isAlive, false, `Cycle ${cycle}: Player still dead at +4.9s`);

      // 5. Advance 0.1s (total 5.0s elapsed): respawn triggers
      simTime += 100.0;
      host.tickSnapshot(simTime);
      assertEqual(p.isAlive, true, `Cycle ${cycle}: Player respawned at +5.0s`);
      assertEqual(p.hp, 100, `Cycle ${cycle}: HP reset to 100`);
      assertEqual(p.position.x, 0.0, `Cycle ${cycle}: Position X is 0.0`);
      assertEqual(p.position.y, 17.5, `Cycle ${cycle}: Position Y is 17.5`);
      assertEqual(p.position.z, 0.0, `Cycle ${cycle}: Position Z is 0.0`);
      assertGreaterThan(p.shieldExpiresAt, simTime + 9000, `Cycle ${cycle}: Fresh 10s shield granted`);
    }

    assertEqual(respawnCount, 20, 'All 20 respawns completed cleanly');
    performance.now = origPerfNow;
    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 9: 8-Player Concurrent Staggered Death/Respawn Matrix
  // ===========================================================================
  console.log('--- Section 9: 8-Player Concurrent Staggered Death/Respawn Matrix ---');
  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });

    const colors = ['#FF0055', '#00FF66', '#FF9900', '#CC00FF', '#FFFF00', '#00FFFF', '#FF00AA'];
    const clients = [];

    for (let i = 0; i < 7; i++) {
      const pid = `client_${i + 1}`;
      const cHost = new MockDataChannel(`host_${i}`);
      const cClient = new MockDataChannel(`client_${i}`);
      cHost.connect(cClient);
      host.registerPeer(pid, cHost);
      host.handleChannelMessage(pid, cHost, JSON.stringify({
        type: 'JOIN_REQUEST', playerId: pid, playerName: `Bot_${i + 1}`, proposedColor: colors[i],
      }));
      clients.push(pid);
    }

    // Stagger death times: client i dies at base + (i * 1000) ms
    const baseTime = 10000.0;
    for (let i = 0; i < clients.length; i++) {
      const pid = clients[i];
      const rec = host.playerRecords.get(pid);
      rec.shieldExpiresAt = 0;
      host.dealDamage(pid, 100);
      rec.deathTime = baseTime + (i * 1000.0);
    }

    // Step through time from baseTime to baseTime + 12000ms in 500ms increments
    for (let t = baseTime; t <= baseTime + 12000.0; t += 500.0) {
      host.tickSnapshot(t);

      for (let i = 0; i < clients.length; i++) {
        const pid = clients[i];
        const rec = host.playerRecords.get(pid);
        const deathInstant = baseTime + (i * 1000.0);
        const elapsedSinceDeath = t - deathInstant;

        if (elapsedSinceDeath < 5000.0) {
          // Should still be dead
          assert(!rec.isAlive, `Client ${pid} must be dead at elapsed ${elapsedSinceDeath}ms`);
        } else {
          // Should be respawned
          assert(rec.isAlive, `Client ${pid} must be alive at elapsed ${elapsedSinceDeath}ms`);
          assertEqual(rec.hp, 100, `Client ${pid} HP must be 100`);
          assertEqual(rec.position.y, 17.5, `Client ${pid} at central platform`);
        }
      }
    }

    host.stopSnapshotTick();
  }

  // ===========================================================================
  // SECTION 10: 3D Cyan Sphere VFX Lifecycle, Pulse & Memory Disposal
  // ===========================================================================
  console.log('--- Section 10: 3D Cyan Sphere VFX Lifecycle, Pulse & Disposal ---');
  {
    const vfx = new ShieldVFXController();
    const parentGroup = new THREE.Group();

    // 1. Verify exact geometry and material specifications
    const mesh = vfx.createShieldMesh();
    assertEqual(mesh.geometry.parameters.radius, 1.85, 'Radius is 1.85m');
    assertEqual(mesh.geometry.parameters.widthSegments, 32, 'widthSegments is 32');
    assertEqual(mesh.geometry.parameters.heightSegments, 32, 'heightSegments is 32');
    assertEqual(mesh.material.color.getHex(), 0x00F0FF, 'Color is cyan 0x00F0FF');
    assertEqual(mesh.material.transparent, true, 'Transparent is true');
    assertEqual(mesh.material.depthWrite, false, 'depthWrite is false');
    assertEqual(mesh.material.blending, THREE.AdditiveBlending, 'AdditiveBlending is set');

    // 2. Attachment and child hierarchy
    const inst = vfx.attachShield(parentGroup, 10.0, new THREE.Vector3(0, 0.9, 0));
    assertEqual(vfx.hasShield(parentGroup), true, 'hasShield is true');
    assertEqual(parentGroup.children.length, 1, 'Child added to parent');
    assertEqual(inst.remainingTime, 10.0, 'Remaining time initialized to 10.0s');

    // 3. Pulse oscillation
    const s0 = inst.mesh.scale.x;
    vfx.update(0.3); // update delta
    const s1 = inst.mesh.scale.x;
    assert(Math.abs(s1 - s0) > 1e-4, 'Scale pulses with elapsed time');
    assert(s1 >= 0.95 && s1 <= 1.05, 'Scale pulse stays within +/- 5%');

    // 4. Expiration and GPU disposal
    let geoDisposed = false;
    let matDisposed = false;
    inst.geometry.dispose = () => { geoDisposed = true; };
    inst.material.dispose = () => { matDisposed = true; };

    // Advance 9.6s more (total 9.9s)
    vfx.update(9.6);
    assertEqual(vfx.hasShield(parentGroup), true, 'Still active at 9.9s');
    assertEqual(parentGroup.children.length, 1, 'Still in parent at 9.9s');

    // Advance 0.2s more (total 10.1s -> expired!)
    vfx.update(0.2);
    assertEqual(vfx.hasShield(parentGroup), false, 'Inactive after 10.1s');
    assertEqual(parentGroup.children.length, 0, 'Removed from parent graph');
    assertEqual(geoDisposed, true, 'Geometry disposed on expiration');
    assertEqual(matDisposed, true, 'Material disposed on expiration');
    assertEqual(vfx.getActiveCount(), 0, 'Active shield count is 0');

    // 5. Stress attach/detach memory leak test: 100 iterations
    for (let k = 0; k < 100; k++) {
      vfx.attachShield(parentGroup, 10.0);
      vfx.detachShield(parentGroup);
    }
    assertEqual(parentGroup.children.length, 0, 'Parent has 0 leaked children after 100 cycles');
    assertEqual(vfx.getActiveCount(), 0, 'Active count is 0 after 100 cycles');
  }

  // ===========================================================================
  // SECTION 11: Binary WORLD_SNAPSHOT Wire Protocol Verification
  // ===========================================================================
  console.log('--- Section 11: Binary WORLD_SNAPSHOT Wire Protocol ---');
  {
    // Encode snapshot with 1 dead player and 1 shielded player
    const buf = encodeWorldSnapshot({
      snapshotSeq: 42,
      hostTimestamp: 98765.4,
      players: [
        {
          slot: 0,
          hp: 100,
          flags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
          activeWeapon: 0,
          x: 0.0,
          y: 17.5,
          z: 0.0,
          yaw: 1.57,
          pitch: -0.1,
          timerRemainingMs: 9500,
        },
        {
          slot: 1,
          hp: 0,
          flags: 0, // dead, not shielded
          activeWeapon: 2,
          x: 50.0,
          y: 20.0,
          z: 50.0,
          yaw: 0,
          pitch: 0,
          timerRemainingMs: 3200, // 3.2s left on death
        },
      ],
    });

    const decoded = decodeWorldSnapshot(buf);
    assert(decoded !== null, 'World snapshot binary decode success');
    assertEqual(decoded.snapshotSeq, 42, 'Sequence number matches');
    assertEqual(decoded.players.length, 2, 'Player count is 2');

    // Verify player 0 (shielded)
    const p0 = decoded.players[0];
    assertEqual(p0.slot, 0);
    assertEqual(p0.hp, 100);
    assertEqual((p0.flags & STATE_FLAGS.ALIVE) !== 0, true, 'Player 0 is alive');
    assertEqual((p0.flags & STATE_FLAGS.SHIELD_ACTIVE) !== 0, true, 'Player 0 is shielded');
    assertEqual(p0.timerRemainingMs, 9500, 'Shield countdown is 9500ms');
    assertCloseTo(p0.y, 17.5, 1e-2, 'Spawn height is 17.5m');

    // Verify player 1 (dead)
    const p1 = decoded.players[1];
    assertEqual(p1.slot, 1);
    assertEqual(p1.hp, 0, 'Player 1 HP is 0');
    assertEqual((p1.flags & STATE_FLAGS.ALIVE) !== 0, false, 'Player 1 is not alive');
    assertEqual((p1.flags & STATE_FLAGS.SHIELD_ACTIVE) !== 0, false, 'Player 1 is not shielded');
    assertEqual(p1.timerRemainingMs, 3200, 'Death timer countdown is 3200ms');

    // Verify P2PClient state ingestion
    const client = new P2PClient({
      playerId: 'client_slot_1',
      playerName: 'HeroClient',
    });
    client.playerSlot = 1;
    client.handleMessage(buf);

    assertEqual(client.clientHp, 0, 'Client HP updated to 0');
    assertEqual(client.isAlive, false, 'Client isAlive updated to false');
    assertEqual(client.isShielded, false, 'Client isShielded updated to false');
    assertEqual(client.timerRemainingMs, 3200, 'Client timerRemainingMs updated to 3200');
  }

  // ===========================================================================
  // SECTION 12: HealthHUD Controller Bounds & Styling Invariants
  // ===========================================================================
  console.log('--- Section 12: HealthHUD Controller Bounds & Styling Invariants ---');
  {
    const mockHpVal = { textContent: '', className: '' };
    const mockHpBar = { style: { width: '' }, className: '' };
    const mockShieldBadge = {
      classList: {
        classes: new Set(['hidden']),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
      },
    };
    const mockShieldTimer = { textContent: '' };
    const mockDeathOverlay = {
      classList: {
        classes: new Set(['hidden']),
        add(c) { this.classes.add(c); },
        remove(c) { this.classes.delete(c); },
        contains(c) { return this.classes.has(c); },
      },
    };
    const mockDeathCountdown = { textContent: '' };

    const hud = new HealthHUDController({
      hpVal: mockHpVal,
      hpBar: mockHpBar,
      shieldBadge: mockShieldBadge,
      shieldTimer: mockShieldTimer,
      deathOverlay: mockDeathOverlay,
      deathCountdown: mockDeathCountdown,
    });

    // 100 HP display
    hud.updateHealth(100, 100);
    assertEqual(mockHpVal.textContent, '100 HP');
    assertEqual(mockHpBar.style.width, '100%');
    assert(mockHpVal.className.includes('text-emerald-400'), 'Healthy text uses emerald-400');

    // 30 HP critical threshold
    hud.updateHealth(30, 100);
    assertEqual(mockHpVal.textContent, '30 HP');
    assertEqual(mockHpBar.style.width, '30%');
    assert(mockHpVal.className.includes('text-rose-500'), '30 HP triggers rose-500');
    assert(mockHpBar.className.includes('from-red-600'), '30 HP bar uses red-600 gradient');

    // Death overlay lifecycle
    hud.showDeathOverlay(5.0);
    assertEqual(mockDeathOverlay.classList.contains('hidden'), false, 'Death overlay visible');
    assertEqual(mockDeathCountdown.textContent, '5.0', 'Initial countdown is 5.0');
    hud.updateDeathCountdown(3.7);
    assertEqual(mockDeathCountdown.textContent, '3.7', 'Countdown updates to 3.7');
    hud.hideDeathOverlay();
    assertEqual(mockDeathOverlay.classList.contains('hidden'), true, 'Death overlay hidden');

    // Shield badge lifecycle
    hud.updateShield(8.4);
    assertEqual(mockShieldBadge.classList.contains('hidden'), false, 'Shield badge visible');
    assertEqual(mockShieldTimer.textContent, '8.4s', 'Shield timer formatted to 8.4s');
    hud.updateShield(0);
    assertEqual(mockShieldBadge.classList.contains('hidden'), true, 'Shield badge hidden at 0s');
  }

  // ===========================================================================
  // SUMMARY
  // ===========================================================================
  console.log(`
================================================================================
  EMPIRICAL CHALLENGER 3 SUITE COMPLETE
  Total Assertions: ${totalAssertions}
  Passed:           ${passedAssertions}
  Failed:           ${failedAssertions}
================================================================================
`);

  if (failedAssertions > 0) {
    console.error(`FAILED with ${failedAssertions} assertion failures!`);
    for (const fail of failureDetails) {
      console.error(`  - ${fail}`);
    }
    process.exit(1);
  } else {
    console.log('ALL ADVERSARIAL CHALLENGES PASSED (100% SUCCESS)!');
    process.exit(0);
  }
}

runEmpiricalChallengerSuite().catch((err) => {
  console.error('Unhandled exception in challenger suite:', err);
  process.exit(1);
});

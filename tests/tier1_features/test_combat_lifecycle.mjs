// tests/tier1_features/test_combat_lifecycle.mjs
// Tier 1 Feature Coverage: Combat Lifecycle, Host Authoritative Health, 5s Death Phase, Respawn & 10s Invulnerability (R1, R2, Acceptance Criteria)

import { assert, assertEqual, assertCloseTo, assertGreaterThan } from '../helpers/assertions.mjs';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';
import { P2PClient } from '../../game-web/src/net/p2pClient.ts';
import {
  PACKET_OPCODES,
  STATE_FLAGS,
  HIT_FLAGS,
  encodeFireHitscan,
  decodeHitConfirmed,
  encodeWorldSnapshot,
  decodeWorldSnapshot,
  HIT_CONFIRMED_BYTES,
  encodeLobbyJoin,
} from '../../game-web/src/net/binaryProtocol.ts';
import { HealthHUDController } from '../../game-web/src/ui/healthHud.ts';
import { MockDataChannel } from '../helpers/p2p_mock_channel.mjs';

export async function run(suite) {
  // ---------------------------------------------------------------------------
  // 1. Initial State & Base 100 HP on Spawn
  // ---------------------------------------------------------------------------
  suite.test('R1 / R2: Host initializes player with 100 HP and 10s spawn invulnerability', () => {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostRecord = host.playerRecords.get('host_01');
    assert(hostRecord !== undefined, 'Host player record must exist');
    assertEqual(hostRecord.hp, 100, 'Base HP must be exactly 100');
    assertEqual(hostRecord.isAlive, true, 'Player must be alive on spawn');
    assertEqual(hostRecord.position.x, 0);
    assertEqual(hostRecord.position.y, 17.5, 'Spawn height must be 17.5m');
    assertEqual(hostRecord.position.z, 0);

    const now = performance.now();
    assertGreaterThan(hostRecord.shieldExpiresAt, now + 9000, 'Initial shield must expire in ~10s');
    assertEqual((hostRecord.stateFlags & STATE_FLAGS.ALIVE) !== 0, true, 'STATE_FLAGS.ALIVE must be set');
    assertEqual((hostRecord.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) !== 0, true, 'STATE_FLAGS.SHIELD_ACTIVE must be set');

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 2. Fatal Damage & Death Transition
  // ---------------------------------------------------------------------------
  suite.test('R1: Player taking fatal damage (HP <= 0) transitions to dead state and records death timestamp', () => {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostChannel = new MockDataChannel('host');
    const clientChannel = new MockDataChannel('client');
    hostChannel.connect(clientChannel);

    host.registerPeer('victim_peer', hostChannel);
    host.handleChannelMessage('victim_peer', hostChannel, encodeLobbyJoin('victim_peer', 'TargetVictim', '#FF0055'));

    const victim = host.playerRecords.get('victim_peer');
    assert(victim !== undefined, 'Victim player record must exist');
    assertEqual(victim.hp, 100);
    assertEqual(victim.isAlive, true);

    // Expire initial shield so damage can be applied
    victim.shieldExpiresAt = 0;

    // Apply fatal sniper damage (140 HP)
    const result = host.dealDamage('victim_peer', 140);
    assertEqual(result.isFatal, true, 'Damage must be fatal');
    assertEqual(result.newHp, 0, 'HP must be 0 after fatal damage');
    assertEqual(victim.hp, 0);
    assertEqual(victim.isAlive, false, 'Player must not be alive');
    assertGreaterThan(victim.deathTime, 0, 'deathTime timestamp must be recorded');

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 3. 5-Second Death Phase: Shots Ignored & No Early Respawn
  // ---------------------------------------------------------------------------
  suite.test('R1: During 5.0s death phase, shots against victim are ignored and player does not respawn early', () => {
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
    });

    const hostChannel = new MockDataChannel('host');
    const clientChannel = new MockDataChannel('client');
    hostChannel.connect(clientChannel);

    host.registerPeer('victim_peer', hostChannel);
    host.handleChannelMessage('victim_peer', hostChannel, encodeLobbyJoin('victim_peer', 'TargetVictim', '#FF0055'));

    const victim = host.playerRecords.get('victim_peer');
    victim.shieldExpiresAt = 0;
    victim.position = { x: 0, y: 17.5, z: 10 };

    // Kill victim
    host.dealDamage('victim_peer', 100);
    assertEqual(victim.isAlive, false);
    const deathTime = victim.deathTime;

    // Simulate 2.5 seconds passing (halfway through 5s death phase)
    victim.deathTime = deathTime - 2500;

    // Shoot at dead victim position
    let hitBroadcast = false;
    host.options.onHitConfirmed = () => { hitBroadcast = true; };

    host.fireHitscan(
      'host_01',
      0, // assault rifle
      [0, 18.0, 0], // origin
      [0, 0, 1]     // straight at victim
    );

    assertEqual(hitBroadcast, false, 'Shots against dead players must not confirm hits');
    assertEqual(victim.isAlive, false, 'Player must not be alive at t=2.5s');

    // Run snapshot tick: 2500ms elapsed is less than 5000ms, should NOT respawn
    host.tickSnapshot();
    assertEqual(victim.isAlive, false, 'Player must not respawn before 5.0 seconds');
    assertEqual(victim.hp, 0, 'HP must remain 0 during death phase');

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 4. Authoritative Respawn at Central Platform [0.0, 17.5, 0.0]
  // ---------------------------------------------------------------------------
  suite.test('R1: After exactly 5.0 seconds, player respawns at [0.0, 17.5, 0.0] with restored 100 HP', () => {
    let respawnReportedId = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onPlayerRespawned: (id) => { respawnReportedId = id; },
    });

    const hostChannel = new MockDataChannel('host');
    const clientChannel = new MockDataChannel('client');
    hostChannel.connect(clientChannel);

    host.registerPeer('victim_peer', hostChannel);
    host.handleChannelMessage('victim_peer', hostChannel, encodeLobbyJoin('victim_peer', 'TargetVictim', '#FF0055'));

    const victim = host.playerRecords.get('victim_peer');
    victim.shieldExpiresAt = 0;
    victim.position = { x: 50, y: 30, z: -80 }; // Died far away from center

    host.dealDamage('victim_peer', 100);
    assertEqual(victim.isAlive, false);

    // Fast-forward death time to 5001 ms ago
    victim.deathTime = performance.now() - 5001;

    // Trigger host tick
    host.tickSnapshot();

    assertEqual(victim.isAlive, true, 'Player must be alive after 5s death phase');
    assertEqual(victim.hp, 100, 'HP must be fully restored to 100');
    assertEqual(victim.deathTime, 0, 'deathTime must be reset to 0');
    assertEqual(victim.position.x, 0.0, 'Respawn X must be 0.0 (central platform)');
    assertEqual(victim.position.y, 17.5, 'Respawn Y must be 17.5 (ground height 15.0 + 2.5)');
    assertEqual(victim.position.z, 0.0, 'Respawn Z must be 0.0 (central platform)');
    assertEqual(respawnReportedId, 'victim_peer', 'Host onPlayerRespawned callback must fire');

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 5. 10-Second Invulnerability Shield: All Validated Hits Deal 0 Damage
  // ---------------------------------------------------------------------------
  suite.test('R2 / AC: During 10 seconds post-respawn, validated shots against shielded player deal strictly 0 damage', () => {
    let confirmedHitEvent = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => { confirmedHitEvent = evt; },
    });

    const hostChannel = new MockDataChannel('host');
    const clientChannel = new MockDataChannel('client');
    hostChannel.connect(clientChannel);

    host.registerPeer('victim_peer', hostChannel);
    host.handleChannelMessage('victim_peer', hostChannel, encodeLobbyJoin('victim_peer', 'TargetVictim', '#FF0055'));

    const victim = host.playerRecords.get('victim_peer');
    // Kill and respawn
    host.respawnPlayer('victim_peer');
    assertEqual(victim.isAlive, true);
    assertEqual(victim.hp, 100);

    // Victim is at central platform [0, 17.5, 0]. Host is at [0, 17.5, -10] aiming +Z
    const now = performance.now();
    assertGreaterThan(victim.shieldExpiresAt, now + 8000, 'Shield must be active for ~10s');

    // Host fires high-damage sniper shot (weaponType = 1, base damage 70) directly at victim
    confirmedHitEvent = null;
    host.fireHitscan(
      'host_01',
      1, // cecchino
      [0, 17.0, -10], // origin 10m south at valid fallback-collider body height
      [0, 0, 1]        // direction north towards [0, 17.5, 0]
    );

    assert(confirmedHitEvent !== null, 'Hitscan must confirm ray-cylinder intersection with victim');
    assertEqual(confirmedHitEvent.isShieldBlocked, true, 'Hit must be flagged as shield blocked');
    assertEqual(confirmedHitEvent.damage, 0, 'Damage must be strictly 0 HP');
    assertEqual(confirmedHitEvent.newHp, 100, 'Victim HP must remain at 100 HP');
    assertEqual(victim.hp, 100, 'Authoritative victim record must not lose HP');

    // Fire 5 more assault rifle shots
    for (let i = 0; i < 5; i++) {
      host.fireHitscan('host_01', 0, [0, 17.0, -10], [0, 0, 1]);
    }
    assertEqual(victim.hp, 100, 'Victim HP must remain 100 after multiple shots during shield');

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 6. Shield Expiration at 10.0s: Normal Damage Resumes
  // ---------------------------------------------------------------------------
  suite.test('R2 / AC: After 10.0 seconds, shield expires and subsequent shots inflict normal damage', () => {
    let confirmedHitEvent = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host_01', name: 'HostLeader', color: '#00F0FF' },
      onHitConfirmed: (evt) => { confirmedHitEvent = evt; },
    });

    const hostChannel = new MockDataChannel('host');
    const clientChannel = new MockDataChannel('client');
    hostChannel.connect(clientChannel);

    host.registerPeer('victim_peer', hostChannel);
    host.handleChannelMessage('victim_peer', hostChannel, encodeLobbyJoin('victim_peer', 'TargetVictim', '#FF0055'));

    const victim = host.playerRecords.get('victim_peer');
    host.respawnPlayer('victim_peer');

    // Fast-forward time past the 10.0s shield expiration
    victim.shieldExpiresAt = performance.now() - 100;

    // Run snapshot tick to update state flags
    host.tickSnapshot();
    assertEqual((victim.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) === 0, true, 'Shield flag must be cleared');

    // Host shoots assault rifle (weaponType 0, base 18) at victim
    confirmedHitEvent = null;
    host.fireHitscan(
      'host_01',
      0, // assalto
      [0, 17.0, -10],
      [0, 0, 1]
    );

    assert(confirmedHitEvent !== null, 'Hit must be confirmed');
    assertEqual(confirmedHitEvent.isShieldBlocked, false, 'Hit must NOT be shield blocked');
    assertGreaterThan(confirmedHitEvent.damage, 0, 'Damage must be greater than 0');
    assertEqual(confirmedHitEvent.newHp, 100 - confirmedHitEvent.damage);
    assertEqual(victim.hp, 100 - confirmedHitEvent.damage);

    host.destroy();
  });

  // ---------------------------------------------------------------------------
  // 7. HealthHUD Controller UI Logic & Edge Cases
  // ---------------------------------------------------------------------------
  suite.test('R1 / R2: HealthHUD controller updates HP bar, critical colors, shield badge, and death overlay', () => {
    // Mock DOM elements
    const mockHpVal = { textContent: '', className: '' };
    const mockHpBar = { style: { width: '' }, className: '' };
    const mockShieldBadge = {
      classList: {
        classes: new Set(['hidden']),
        add: function (c) { this.classes.add(c); },
        remove: function (c) { this.classes.delete(c); },
        contains: function (c) { return this.classes.has(c); },
      },
    };
    const mockShieldTimer = { textContent: '' };
    const mockDeathOverlay = {
      classList: {
        classes: new Set(['hidden']),
        add: function (c) { this.classes.add(c); },
        remove: function (c) { this.classes.delete(c); },
        contains: function (c) { return this.classes.has(c); },
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

    // Initial state
    hud.updateHealth(100, 100);
    assertEqual(mockHpVal.textContent, '100 HP');
    assertEqual(mockHpBar.style.width, '100%');
    assert(mockHpVal.className.includes('text-emerald-400'), 'Healthy HP must be emerald');

    // Damage to 50 HP
    hud.updateHealth(50, 100);
    assertEqual(mockHpVal.textContent, '50 HP');
    assertEqual(mockHpBar.style.width, '50%');

    // Critical low HP (<= 30 HP) triggers red/rose pulse styling
    hud.updateHealth(25, 100);
    assertEqual(mockHpVal.textContent, '25 HP');
    assertEqual(mockHpBar.style.width, '25%');
    assert(mockHpVal.className.includes('text-rose-500'), 'Low HP text must use rose-500');
    assert(mockHpBar.className.includes('from-red-600'), 'Low HP bar must use red gradient');

    // Shield badge visibility and countdown
    hud.updateShield(9.5);
    assertEqual(hud.isShieldActive, true);
    assertEqual(mockShieldBadge.classList.contains('hidden'), false);
    assertEqual(mockShieldBadge.classList.contains('flex'), true);
    assertEqual(mockShieldTimer.textContent, '9.5s');

    // Shield expiration
    hud.updateShield(0);
    assertEqual(hud.isShieldActive, false);
    assertEqual(mockShieldBadge.classList.contains('hidden'), true);

    // Death overlay activation
    hud.showDeathOverlay(5.0);
    assertEqual(hud.isDeathOverlayVisible, true);
    assertEqual(mockDeathOverlay.classList.contains('hidden'), false);
    assertEqual(mockDeathCountdown.textContent, '5.0');

    // Death countdown updates
    hud.updateDeathCountdown(2.3);
    assertEqual(mockDeathCountdown.textContent, '2.3');

    // Hide death overlay on respawn
    hud.hideDeathOverlay();
    assertEqual(hud.isDeathOverlayVisible, false);
    assertEqual(mockDeathOverlay.classList.contains('hidden'), true);
  });

  // ---------------------------------------------------------------------------
  // 8. P2P Client Synchronizes Authoritative HP, Death & Shield from World Snapshot
  // ---------------------------------------------------------------------------
  suite.test('R3: P2PClient decodes binary snapshot and maintains clientHp, isAlive, and isShielded', () => {
    let capturedSnapshot = null;
    const client = new P2PClient({
      playerId: 'test_client_p',
      playerName: 'HeroClient',
      onWorldSnapshot: (s) => { capturedSnapshot = s; },
    });

    client.playerSlot = 2;

    // Simulate binary WORLD_SNAPSHOT from host
    const snapshotBuffer = encodeWorldSnapshot({
      snapshotSeq: 10,
      hostTimestamp: 12345.6,
      players: [
        {
          slot: 2,
          hp: 100,
          flags: STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE,
          activeWeapon: 0,
          x: 0,
          y: 17.5,
          z: 0,
          yaw: 0,
          pitch: 0,
          timerRemainingMs: 8500,
        },
      ],
    });

    client.handleMessage(snapshotBuffer);

    assert(capturedSnapshot !== null, 'Snapshot must be ingested');
    assertEqual(client.clientHp, 100, 'Client HP must equal 100');
    assertEqual(client.isAlive, true, 'Client must be alive');
    assertEqual(client.isShielded, true, 'Client shield must be active');
    assertEqual(client.timerRemainingMs, 8500);

    // Next snapshot: player took fatal damage and is dead
    const deadSnapshotBuffer = encodeWorldSnapshot({
      snapshotSeq: 11,
      hostTimestamp: 12400.0,
      players: [
        {
          slot: 2,
          hp: 0,
          flags: 0, // Not alive, not shielded
          activeWeapon: 0,
          x: 0,
          y: 17.5,
          z: 0,
          yaw: 0,
          pitch: 0,
          timerRemainingMs: 4800, // 4.8s left on death timer
        },
      ],
    });

    client.handleMessage(deadSnapshotBuffer);

    assertEqual(client.clientHp, 0);
    assertEqual(client.isAlive, false, 'Client must transition to dead');
    assertEqual(client.isShielded, false);
    assertEqual(client.timerRemainingMs, 4800);
  });
}

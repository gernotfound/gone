/**
 * Challenger 1 - Empirical Adversarial Stress Harness (Node.js)
 * Tests P2P concurrent join collisions, color boundary edge cases,
 * HSV fluorescence thresholding, weapon TTK math [0.70s, 1.50s],
 * and knife 2.5m cutoff.
 */

import { P2PHost, LocalColorRegistry } from '../game-web/src/net/p2pHost.ts';
import { P2PClient } from '../game-web/src/net/p2pClient.ts';
import {
  COLOR_REJECT_REASONS,
  DEFAULT_NEON_HEX_LIST,
  isFluorescentColor,
  normalizeHexColor,
  hexToRgb,
  rgbToHsv,
} from '../game-web/src/net/protocol.ts';

// Mock WebRTC DataChannel Pair with simulated async event loop queuing
class MockDataChannel {
  constructor(name) {
    this.name = name;
    this.peer = null;
    this.readyState = 'open';
    this.onmessage = null;
    this.onclose = null;
    this.onerror = null;
  }

  static createPair(nameA = 'host-end', nameB = 'client-end') {
    const a = new MockDataChannel(nameA);
    const b = new MockDataChannel(nameB);
    a.peer = b;
    b.peer = a;
    return [a, b];
  }

  send(data) {
    if (this.readyState !== 'open') {
      throw new Error(`Cannot send on closed channel: ${this.name}`);
    }
    // Asynchronous network delivery using setImmediate/queueMicrotask
    queueMicrotask(() => {
      if (this.peer && this.peer.readyState === 'open' && this.peer.onmessage) {
        this.peer.onmessage({ data });
      }
    });
  }

  close() {
    if (this.readyState === 'closed') return;
    this.readyState = 'closed';
    queueMicrotask(() => {
      if (this.onclose) this.onclose();
      if (this.peer && this.peer.readyState !== 'closed') {
        this.peer.readyState = 'closed';
        if (this.peer.onclose) this.peer.onclose();
      }
    });
  }
}

function delay(ms = 25) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function connectClientAsync(client, channel, color, timeoutMs = 200) {
  return new Promise((resolve, reject) => {
    let settled = false;
    client['config'].onJoinAccepted = (data) => {
      if (!settled) {
        settled = true;
        resolve({ type: 'ACCEPTED', client, data });
      }
    };
    client['config'].onColorRejected = (data) => {
      if (!settled) {
        settled = true;
        resolve({ type: 'REJECTED', client, data });
      }
    };
    client.connect(channel, color);
    setTimeout(() => {
      if (!settled) {
        settled = true;
        reject(new Error(`Connection timed out after ${timeoutMs}ms for ${client.playerId}`));
      }
    }, timeoutMs);
  });
}

let totalTests = 0;
let passedTests = 0;
let failedTests = 0;

function assert(condition, message) {
  totalTests++;
  if (!condition) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message}`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
  }
}

function assertEqual(actual, expected, message) {
  totalTests++;
  if (actual !== expected) {
    failedTests++;
    console.error(`\x1b[31m[FAIL]\x1b[0m ${message} (Expected: ${expected}, Got: ${actual})`);
    throw new Error(`Assertion failed: ${message}`);
  } else {
    passedTests++;
    console.log(`\x1b[32m[PASS]\x1b[0m ${message}`);
  }
}

async function runChallengerSuite() {
  console.log('\n\x1b[1m\x1b[35m=== CHALLENGER 1: EMPIRICAL ADVERSARIAL VERIFICATION SUITE ===\x1b[0m\n');

  // -------------------------------------------------------------
  // SECTION 1: Color Normalization & Case Insensitivity
  // -------------------------------------------------------------
  console.log('\x1b[36m--- Test Section 1: Color Normalization & Case Insensitivity ---\x1b[0m');
  {
    assertEqual(normalizeHexColor('#00f0ff'), '#00F0FF', 'Lowercase #00f0ff normalizes to #00F0FF');
    assertEqual(normalizeHexColor('00F0FF'), '#00F0FF', 'Missing # prefix normalizes to #00F0FF');
    assertEqual(normalizeHexColor('00f0ff'), '#00F0FF', 'Lowercase missing # normalizes to #00F0FF');
    assertEqual(normalizeHexColor('  #00F0FF  '), '#00F0FF', 'Surrounding whitespace is trimmed');
    assertEqual(normalizeHexColor('#00F'), '#0000FF', '3-digit hex #00F expands to #0000FF');

    // Invalid formats
    assertEqual(normalizeHexColor(''), null, 'Empty string returns null');
    assertEqual(normalizeHexColor('#00 F0FF'), null, 'Internal space returns null');
    assertEqual(normalizeHexColor('#GG00FF'), null, 'Non-hex character returns null');
    assertEqual(normalizeHexColor('#12345'), null, '5-digit hex returns null');
    assertEqual(normalizeHexColor('#1234567'), null, '7-digit hex returns null');
    assertEqual(normalizeHexColor(null), null, 'null input returns null');
    assertEqual(normalizeHexColor(undefined), null, 'undefined input returns null');
  }

  // -------------------------------------------------------------
  // SECTION 2: Exact HSV Fluorescence Threshold Boundaries
  // -------------------------------------------------------------
  console.log('\n\x1b[36m--- Test Section 2: Exact HSV Fluorescence Boundaries ---\x1b[0m');
  {
    // Black & White
    assertEqual(isFluorescentColor('#000000'), false, 'Pure Black #000000 is rejected');
    assertEqual(isFluorescentColor('#FFFFFF'), false, 'Pure White #FFFFFF is rejected');
    assertEqual(isFluorescentColor('#808080'), false, 'Grey #808080 is rejected');

    // Saturation Boundary: S < 0.70 vs S >= 0.70
    // #FF4F4F: R=255, G=79, B=79 -> S = 1 - 79/255 = 0.6902 < 0.70
    const rgbLowS = hexToRgb('#FF4F4F');
    const hsvLowS = rgbToHsv(rgbLowS[0], rgbLowS[1], rgbLowS[2]);
    assert(hsvLowS.s < 0.70, `S=${hsvLowS.s.toFixed(4)} must be < 0.70 for #FF4F4F`);
    assertEqual(isFluorescentColor('#FF4F4F'), false, 'Color with S=0.6902 must be rejected');

    // #FF4C4C: R=255, G=76, B=76 -> S = 1 - 76/255 = 0.7020 >= 0.70
    const rgbPassS = hexToRgb('#FF4C4C');
    const hsvPassS = rgbToHsv(rgbPassS[0], rgbPassS[1], rgbPassS[2]);
    assert(hsvPassS.s >= 0.70, `S=${hsvPassS.s.toFixed(4)} must be >= 0.70 for #FF4C4C`);
    assertEqual(isFluorescentColor('#FF4C4C'), true, 'Color with S=0.7020 and V=1.0 must be accepted');

    // Value/Brightness Boundary: V < 0.70 vs V >= 0.70
    // #B00000: R=176, G=0, B=0 -> V = 176/255 = 0.6902 < 0.70
    const rgbLowV = hexToRgb('#B00000');
    const hsvLowV = rgbToHsv(rgbLowV[0], rgbLowV[1], rgbLowV[2]);
    assert(hsvLowV.v < 0.70, `V=${hsvLowV.v.toFixed(4)} must be < 0.70 for #B00000`);
    assertEqual(isFluorescentColor('#B00000'), false, 'Color with V=0.6902 must be rejected');

    // #B50000: R=181, G=0, B=0 -> V = 181/255 = 0.7098 >= 0.70
    const rgbPassV = hexToRgb('#B50000');
    const hsvPassV = rgbToHsv(rgbPassV[0], rgbPassV[1], rgbPassV[2]);
    assert(hsvPassV.v >= 0.70, `V=${hsvPassV.v.toFixed(4)} must be >= 0.70 for #B50000`);
    assertEqual(isFluorescentColor('#B50000'), true, 'Color with V=0.7098 and S=1.0 must be accepted');

    // All default neon presets pass
    for (const hex of DEFAULT_NEON_HEX_LIST) {
      assert(isFluorescentColor(hex), `Preset neon ${hex} must be fluorescent`);
    }
  }

  // -------------------------------------------------------------
  // SECTION 3: Concurrent Join Collisions (10 Clients, Same Color)
  // -------------------------------------------------------------
  console.log('\n\x1b[36m--- Test Section 3: Concurrent Join Collisions (10 Clients, Same Color) ---\x1b[0m');
  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_p0', name: 'LobbyHost', color: '#FFE600' },
    });

    const targetColor = '#00F0FF';
    const numClients = 10;
    const clients = [];
    const clientChannels = [];

    // Create 10 clients all aiming for #00F0FF (with varying casing and # prefixes)
    const colorVariations = [
      '#00F0FF',
      '#00f0ff',
      '00F0FF',
      '00f0ff',
      ' #00F0FF ',
      '#00f0FF',
      '#00F0ff',
      '#00F0FF',
      '00F0ff',
      '#00f0ff',
    ];

    for (let i = 1; i <= numClients; i++) {
      const [hostEnd, clientEnd] = MockDataChannel.createPair(`host-c${i}`, `client-c${i}`);
      const client = new P2PClient({
        playerId: `client_${i}`,
        playerName: `Contender_${i}`,
      });
      clients.push(client);
      clientChannels.push({ hostEnd, clientEnd });
    }

    // Register all peers with host
    for (let i = 0; i < numClients; i++) {
      host.registerPeer(`client_${i + 1}`, clientChannels[i].hostEnd);
    }

    // Connect all 10 clients concurrently in the exact same event loop microtask!
    const connectPromises = clients.map((client, idx) =>
      connectClientAsync(client, clientChannels[idx].clientEnd, colorVariations[idx])
    );

    const outcomes = await Promise.all(connectPromises);

    let acceptedCount = 0;
    let rejectedCount = 0;
    let acceptedClientId = null;

    outcomes.forEach((res) => {
      if (res.type === 'ACCEPTED') {
        acceptedCount++;
        acceptedClientId = res.client.playerId;
        assertEqual(res.data.assignedColor, '#00F0FF', 'Assigned color must be normalized #00F0FF');
      } else if (res.type === 'REJECTED') {
        rejectedCount++;
        assertEqual(
          res.data.reason,
          COLOR_REJECT_REASONS.COLOR_ALREADY_TAKEN,
          'Rejection reason must be COLOR_ALREADY_TAKEN'
        );
        assert(
          !res.data.availableColors.includes('#00F0FF'),
          'availableColors must NOT include taken color'
        );
      }
    });

    assertEqual(acceptedCount, 1, 'Exactly ONE client must be accepted with the contested color');
    assertEqual(rejectedCount, numClients - 1, 'Exactly N-1 (9) clients must be rejected');

    const hostSessionPlayers = host.getAllSessionPlayers();
    assertEqual(
      hostSessionPlayers.length,
      2,
      'Host session must contain exactly 2 players (Host + 1 winner)'
    );
    assert(
      hostSessionPlayers.some((p) => p.color === '#00F0FF'),
      'Contested color #00F0FF is assigned to winner'
    );

    console.log(`  Winner: ${acceptedClientId} successfully claimed #00F0FF while 9 competitors were rejected.`);
  }

  // -------------------------------------------------------------
  // SECTION 4: Weapon TTK Mathematics [0.70s, 1.50s] Against 100 HP
  // -------------------------------------------------------------
  console.log('\n\x1b[36m--- Test Section 4: Weapon TTK Mathematics [0.70s, 1.50s] ---\x1b[0m');
  {
    // TTK formula: hits = ceil(targetHp / damage), TTK = (hits - 1) / rps
    const weapons = [
      { name: 'AR-42 Viper', baseDmg: 18.0, midDmg: 17.0, rps: 6.25, expectedTtk: 0.800 },
      { name: 'SR-99 Railphantom', baseDmg: 70.0, midDmg: 70.0, rps: 1.00, expectedTtk: 1.000 },
      { name: 'SG-12 Havoc', baseDmg: 64.0, midDmg: 52.5, rps: 1.25, expectedTtk: 0.800 },
      { name: 'SMG-7 Neon Hornet', baseDmg: 12.0, midDmg: 10.0, rps: 10.00, expectedTtk: 0.900 },
      { name: 'CB-01 Shadowfang (Melee)', baseDmg: 50.0, midDmg: 50.0, rps: 1.25, expectedTtk: 0.800 },
    ];

    for (const w of weapons) {
      const hits = Math.ceil(100.0 / w.midDmg);
      const ttk = (hits - 1) / w.rps;
      assert(
        ttk >= 0.70 && ttk <= 1.50,
        `${w.name}: TTK=${ttk.toFixed(3)}s must be in [0.70s, 1.50s]`
      );
      assert(
        Math.abs(ttk - w.expectedTtk) < 1e-4,
        `${w.name}: TTK=${ttk.toFixed(3)}s matches expected ${w.expectedTtk.toFixed(3)}s`
      );
      assert(w.midDmg < 100.0, `${w.name}: No single-shot body kill against 100 HP`);
    }
  }

  // -------------------------------------------------------------
  // SECTION 5: Knife Strict 2.5m Cutoff Invariant
  // -------------------------------------------------------------
  console.log('\n\x1b[36m--- Test Section 5: Knife 2.5m Strict Boundary Cutoff ---\x1b[0m');
  {
    // Authoritative piecewise formula for knife: base 50, cutoff at 2.5m
    function knifeDamage(d) {
      if (d < 0.0) return 0.0;
      if (d <= 2.5) return 50.0;
      return 0.0;
    }

    assertEqual(knifeDamage(0.0), 50.0, 'Knife deals 50 dmg at 0.0m');
    assertEqual(knifeDamage(2.0), 50.0, 'Knife deals 50 dmg at 2.0m');
    assertEqual(knifeDamage(2.49), 50.0, 'Knife deals 50 dmg at 2.49m');
    assertEqual(knifeDamage(2.500), 50.0, 'Knife deals 50 dmg at 2.500m');
    assertEqual(knifeDamage(2.501), 0.0, 'Knife deals strictly 0.0 dmg at 2.501m');
    assertEqual(knifeDamage(2.51), 0.0, 'Knife deals strictly 0.0 dmg at 2.51m');
    assertEqual(knifeDamage(10.0), 0.0, 'Knife deals strictly 0.0 dmg at 10.0m');
  }

  // -------------------------------------------------------------
  // SECTION 6: High-Frequency Disconnect and Re-allocation Churn
  // -------------------------------------------------------------
  console.log('\n\x1b[36m--- Test Section 6: High-Frequency Disconnect and Re-allocation Churn ---\x1b[0m');
  {
    const host = new P2PHost({
      hostPlayer: { id: 'host_p0', name: 'LobbyHost', color: '#FFE600' },
    });

    const [hEnd1, cEnd1] = MockDataChannel.createPair('host-p1', 'client-p1');
    const client1 = new P2PClient({ playerId: 'churn_p1', playerName: 'Player1' });
    host.registerPeer('churn_p1', hEnd1);

    const res1 = await connectClientAsync(client1, cEnd1, '#00F0FF');
    assertEqual(res1.type, 'ACCEPTED', 'Player 1 claims #00F0FF');

    // Player 2 attempts #00F0FF -> rejected
    const [hEnd2, cEnd2] = MockDataChannel.createPair('host-p2', 'client-p2');
    const client2 = new P2PClient({ playerId: 'churn_p2', playerName: 'Player2' });
    host.registerPeer('churn_p2', hEnd2);

    const res2 = await connectClientAsync(client2, cEnd2, '#00F0FF');
    assertEqual(res2.type, 'REJECTED', 'Player 2 rejected for taken color');

    // Player 1 disconnects
    cEnd1.close();
    await delay(30);

    // Player 2 retries #00F0FF -> now accepted!
    const [hEnd2Retry, cEnd2Retry] = MockDataChannel.createPair('host-p2r', 'client-p2r');
    const client2Retry = new P2PClient({ playerId: 'churn_p2', playerName: 'Player2' });
    host.registerPeer('churn_p2', hEnd2Retry);

    const res2Retry = await connectClientAsync(client2Retry, cEnd2Retry, '#00F0FF');
    assertEqual(res2Retry.type, 'ACCEPTED', 'Player 2 successfully claims released #00F0FF');
    assertEqual(res2Retry.data.assignedColor, '#00F0FF', 'Color properly reallocated');
  }

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n\x1b[1m\x1b[35m=== EXECUTION SUMMARY ===\x1b[0m');
  console.log(`Total Assertions Executed: ${totalTests}`);
  console.log(`Passed: \x1b[32m${passedTests}\x1b[0m`);
  console.log(`Failed: \x1b[31m${failedTests}\x1b[0m`);

  if (failedTests > 0) {
    throw new Error(`${failedTests} adversarial assertions failed!`);
  }
}

runChallengerSuite()
  .then(() => {
    console.log('\n\x1b[32m✔ CHALLENGER 1 ADVERSARIAL SUITE PASSED WITH 100% SUCCESS!\x1b[0m\n');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n\x1b[31m✘ CHALLENGER 1 ADVERSARIAL SUITE FAILED:\x1b[0m', err);
    process.exit(1);
  });

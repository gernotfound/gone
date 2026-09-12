/**
 * Release hardening gate: one authoritative browser host + seven guests.
 * Exercises join/slot allocation, 30 Hz client state, world snapshots,
 * simultaneous shots, disconnect cleanup, slot reuse and deathmatch score wire
 * compatibility without external multiplayer infrastructure.
 */
import { P2PHost } from '../game-web/src/net/p2pHost.ts';
import { P2PClient } from '../game-web/src/net/p2pClient.ts';
import { startPvpHardening } from '../game-web/src/net/pvpHardening.ts';
import { DEFAULT_NEON_HEX_LIST } from '../game-web/src/net/protocol.ts';
import {
  DEATHMATCH_TARGET_KILLS,
  decodeDeathmatchSnapshot,
  encodeDeathmatchSnapshot,
} from '../game-web/src/net/deathmatchProtocol.ts';
import { MockDataChannel } from './helpers/p2p_mock_channel.mjs';

let assertions = 0;
let failures = 0;
function assert(condition, message) {
  assertions += 1;
  if (!condition) {
    failures += 1;
    console.error(`✘ ${message}`);
  } else {
    console.log(`✔ ${message}`);
  }
}

function readyChannel(label) {
  const channel = new MockDataChannel(label);
  Object.defineProperty(channel, 'readyState', {
    configurable: true,
    get() { return channel.isOpen ? 'open' : 'closed'; },
  });
  channel.bufferedAmount = 0;
  return channel;
}

function pair(label) {
  const host = readyChannel(`${label}-host`);
  const client = readyChannel(`${label}-client`);
  host.connect(client);
  return { host, client };
}

async function flush(rounds = 4) {
  for (let i = 0; i < rounds; i++) await new Promise((resolve) => setTimeout(resolve, 0));
}

startPvpHardening();

const scorePacket = encodeDeathmatchSnapshot({
  round: 7,
  targetKills: DEATHMATCH_TARGET_KILLS,
  winnerSlot: 3,
  resetRemainingMs: 4200,
  rows: [
    { slot: 0, kills: 12, deaths: 4, damage: 1337, headshots: 5 },
    { slot: 3, kills: 20, deaths: 6, damage: 2450, headshots: 9 },
  ],
});
const decodedScore = decodeDeathmatchSnapshot(scorePacket);
assert(decodedScore?.round === 7, 'deathmatch wire preserves round');
assert(decodedScore?.targetKills === DEATHMATCH_TARGET_KILLS, 'deathmatch wire preserves target kills');
assert(decodedScore?.winnerSlot === 3, 'deathmatch wire preserves winner slot');
assert(decodedScore?.resetRemainingMs === 4200, 'deathmatch wire preserves round reset countdown');
assert(decodedScore?.rows[1]?.kills === 20 && decodedScore?.rows[1]?.damage === 2450, 'deathmatch wire preserves authoritative score rows');

const palette = DEFAULT_NEON_HEX_LIST.slice(0, 8);
assert(palette.length >= 8, 'palette provides eight unique session colors');

const host = new P2PHost({
  hostPlayer: { id: 'release-host', name: 'HOST', color: palette[0] },
});
const clients = [];
const snapshotCounts = new Map();

for (let i = 1; i <= 7; i++) {
  const id = `release-guest-${i}`;
  const channels = pair(id);
  host.registerPeer(id, channels.host);
  const client = new P2PClient({
    playerId: id,
    playerName: `GUEST_${i}`,
    onWorldSnapshot: () => snapshotCounts.set(id, (snapshotCounts.get(id) ?? 0) + 1),
  });
  client.connect(channels.client, palette[i]);
  clients.push({ id, client, channels });
}

await flush(8);
assert(host.playerRecords.size === 8, 'host owns exactly 8 authoritative player records (1+7)');
assert(clients.every(({ client }) => client.status === 'connected'), 'all seven guests reach connected state');
const slots = [...host.playerRecords.values()].map((record) => record.slot).sort((a, b) => a - b);
assert(new Set(slots).size === 8, 'all eight players have unique slots');
assert(slots.every((slot, index) => slot === index), 'slots 0..7 are allocated contiguously');

for (let i = 0; i < clients.length; i++) {
  const { client } = clients[i];
  client.setStateProvider(() => ({
    position: { x: 200 + i * 25, y: 20, z: -300 - i * 30 },
    yaw: i * 0.15,
    pitch: 0,
    activeWeapon: 0,
    flags: 1,
  }));
  client.startStateTick(30);
}
await new Promise((resolve) => setTimeout(resolve, 90));
await flush(4);
assert(clients.every(({ id }) => (host.playerRecords.get(id)?.lastClientSeq ?? 0) > 0), 'all guest state streams advance at 30 Hz');

host.tickSnapshot(performance.now());
await flush(4);
assert(clients.every(({ id }) => (snapshotCounts.get(id) ?? 0) >= 1), 'one host snapshot reaches all seven guests');

for (const { client } of clients) {
  client.fireHitscan(0, [0, 20, 0], [0, 0, -1]);
}
await flush(8);
const hardening = host.__gonePvpHardeningState;
assert((hardening?.accepted ?? 0) >= 7, 'host hardening accepts one valid simultaneous shot per guest');
assert((hardening?.rejectedDirection ?? 0) === 0, 'valid guest shot directions are not rejected');

const leaving = clients[3];
const freedSlot = host.playerRecords.get(leaving.id)?.slot;
leaving.client.disconnect();
await flush(6);
assert(!host.playerRecords.has(leaving.id), 'disconnect removes guest authoritative record');

const replacementId = 'release-guest-replacement';
const replacementPair = pair(replacementId);
host.registerPeer(replacementId, replacementPair.host);
const replacement = new P2PClient({ playerId: replacementId, playerName: 'REJOIN' });
replacement.connect(replacementPair.client, palette[4]);
await flush(8);
assert(replacement.status === 'connected', 'replacement guest reconnects successfully');
assert(host.playerRecords.get(replacementId)?.slot === freedSlot, 'freed multiplayer slot is reused deterministically');
assert(host.playerRecords.size === 8, 'session returns to exactly eight authoritative players');

for (const { client } of clients) client.stopStateTick();
replacement.stopStateTick();
host.stopSnapshotTick();

console.log(`\nrelease_hardening_1_host_7_guests: ${assertions - failures}/${assertions} assertions passed`);
if (failures > 0) process.exitCode = 1;

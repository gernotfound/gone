import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  const direct = source('game-web', 'src', 'net', 'directWebRtc.ts');
  const protocol = source('game-web', 'src', 'net', 'protocol.ts');
  const signaling = source('game-web', 'src', 'net', 'firestoreSignaling.ts');
  const controller = source('game-web', 'src', 'net', 'multiplayerSessionController.ts');
  const menu = source('game-web', 'src', 'ui', 'menu.ts');
  const lobby = source('game-web', 'src', 'ui', 'lobby.ts');
  const vercel = source('game-web', 'vercel.json');
  const setup = source('docs', 'firestore_multiplayer_signaling.md');

  suite.test('Direct WebRTC uses public STUN without TURN relay', () => {
    assert(direct.includes("PUBLIC_STUN_URL = 'stun:stun.cloudflare.com:3478'"), 'direct WebRTC must use the approved public STUN endpoint');
    assert(direct.includes('iceServers: [{ urls: PUBLIC_STUN_URL }]'), 'peer connection must install the STUN server');
    assert(!direct.includes("'turn:"), 'no TURN endpoint may be configured under the zero-cost architecture');
    assert(!direct.includes('turn.cloudflare.com'), 'Cloudflare TURN must not be enabled');
  });

  suite.test('Realtime state uses an unordered zero-retransmit channel', () => {
    assert(direct.includes("createDataChannel('gone-control'"), 'critical traffic must have a dedicated control channel');
    assert(direct.includes("createDataChannel('gone-realtime'"), 'movement/snapshot traffic must have a dedicated realtime channel');
    assert(direct.includes('ordered: false') && direct.includes('maxRetransmits: 0'), 'realtime channel must not retransmit stale state or impose ordering');
    assert(direct.includes('opcode === CLIENT_STATE_OPCODE || opcode === WORLD_SNAPSHOT_OPCODE'), 'only disposable state/snapshot opcodes should route to realtime');
    assert(direct.includes("const SIGNAL_VERSION = 2;"), 'dual-channel signaling must reject incompatible v1 direct invitations explicitly');
    assert(direct.includes("if (this.controlChannel.readyState !== 'open') return;"), 'critical session readiness must depend on the reliable control channel only');
    assert(direct.includes("&& this.realtimeChannel.readyState === 'open'"), 'realtime packets must prefer the unordered channel only while it is usable');
    assert(direct.includes('return this.controlChannel;'), 'realtime degradation must preserve playability through reliable control fallback');
  });

  suite.test('Real WebRTC send queue is exposed to adaptive backpressure', () => {
    assert(protocol.includes('readonly bufferedAmount?: number;'), 'IDataChannel must expose bufferedAmount');
    assert(direct.includes('get bufferedAmount(): number'), 'native RTC adapter must expose the browser queue');
    assert(direct.includes('this.channels.reduce((sum, channel) => sum + channel.bufferedAmount, 0)'), 'bufferedAmount must aggregate the native RTC queues');
    assert(direct.includes('target.bufferedAmount > REALTIME_BACKPRESSURE_BYTES'), 'only congested realtime traffic should be disposable under backpressure');
  });

  suite.test('Firestore is signaling-only and expires pending rooms', () => {
    assert(signaling.includes("ROOM_COLLECTION = 'gone_signaling_rooms_v1'"), 'signaling must use its isolated collection');
    assert(signaling.includes('ROOM_TTL_MS = 2 * 60 * 1000'), 'pending signaling documents must be short-lived');
    assert(signaling.includes('firestore.googleapis.com/v1/projects/'), 'signaling must use Firestore REST without adding a runtime SDK');
    assert(signaling.includes('VITE_FIREBASE_PROJECT_ID'), 'Firebase project selection must be environment-driven');
    assert(!signaling.includes('CLIENT_STATE') && !signaling.includes('WORLD_SNAPSHOT') && !signaling.includes('FIRE_HITSCAN'), 'gameplay packets must never enter Firestore signaling');
    assert(!signaling.includes('P2PHost') && !signaling.includes('P2PClient'), 'signaling transport must not own gameplay/session state');
  });

  suite.test('Session owner automates Firestore offer/answer with manual fallback', () => {
    assert(controller.includes('createFirestoreSignalingRoom(offer.offerCode)'), 'host must publish the gathered WebRTC offer when Firestore is configured');
    assert(controller.includes('waitForFirestoreSignalingAnswer(roomId, abort.signal)'), 'host must wait for the guest answer automatically');
    assert(controller.includes('publishFirestoreSignalingAnswer(room.roomId, session.answerCode)'), 'guest must publish its answer automatically');
    assert(controller.includes("this.inviteKind = 'host-link'"), 'manual direct invite must remain a fallback');
    assert(controller.includes('buildDirectInviteUrl(offer.offerCode)'), 'manual SDP path must remain usable if Firestore fails');
  });

  suite.test('Terminal Firestore sessions derive one-shot recovery mailboxes without gameplay relay', () => {
    assert(signaling.includes("RECOVERY_ROOM_DOMAIN = 'gone-recovery-v1'"), 'recovery mailbox ids must be domain-separated from random invite ids');
    assert(signaling.includes("crypto.subtle.digest('SHA-256'"), 'recovery mailbox ids must derive deterministically from the original room secret');
    assert(signaling.includes('createFirestoreRecoverySignalingRoom'), 'host must be able to publish a one-shot recovery offer');
    assert(signaling.includes('waitForFirestoreSignalingRoom'), 'guest must be able to wait for the matching recovery generation without collection listing');
    assert(signaling.includes('(error.status === 403 || error.status === 404)'), 'exact recovery mailbox polling must tolerate not-yet-created documents without enabling collection listing');
    assert(signaling.includes('error.status === 409'), 'deterministic mailbox collisions must be reconciled explicitly');
    assert(!signaling.includes('setInterval('), 'Firestore recovery signaling must not install a continuous gameplay poller');
  });

  suite.test('Firestore recovery retries only transient network/write ambiguity within a bounded window', () => {
    assert(signaling.includes('TRANSIENT_WRITE_RETRY_MS = 30_000'), 'write recovery must have a bounded transient retry window');
    assert(signaling.includes('isTransientFirestoreError'), 'network/429/5xx errors must be classified separately from schema and permission failures');
    assert(signaling.includes('error.status === 408 || error.status === 429 || error.status >= 500'), 'only retryable HTTP classes should enter transient backoff');
    assert(signaling.includes('existing?.offerCode === offer'), 'ambiguous deterministic POST must confirm an already-created matching offer before retrying');
    assert(signaling.includes("existing?.answerCode === answer && existing.status === 'answered'"), 'ambiguous one-shot PATCH must confirm the stored answer before retrying');
    assert(signaling.includes('retryDelay(elapsed)'), 'transient retries must back off instead of spinning');
  });

  suite.test('Logical RTC channel preserves authoritative session state across transport replacement', () => {
    assert(direct.includes("type RecoveryRole = 'host' | 'guest'"), 'transport recovery must be symmetric for host and guest');
    assert(direct.includes('private transportEpoch = 0'), 'stale native transport callbacks must be generation-fenced');
    assert(direct.includes('this.retireCurrentTransport();'), 'a failed native transport must be retired without closing the logical session first');
    assert(direct.includes('if (this.recovering) return;'), 'outbound gameplay must be dropped rather than tearing down the logical session during recovery');
    assert(direct.includes("new CustomEvent('gone-rtc-recovery-state'"), 'recovery state must be observable by presentation/diagnostics');
    assert(direct.includes('answer.peerId !== recoveryPeerId'), 'host recovery must reject an answer from a different guest identity');
    assert(direct.includes('createFirestoreRecoverySignalingRoom('), 'host recovery must publish the replacement offer through the one-shot mailbox');
    assert(direct.includes('recoveryOfferCode,\n                signal,'), 'host recovery mailbox creation must abort immediately with the logical session');
    assert(direct.includes('waitForFirestoreSignalingRoom(recoveryRoomId, signal)'), 'guest recovery must use the matching deterministic generation with the recovery abort signal');
    assert(direct.includes('publishFirestoreSignalingAnswer(room.roomId, recoveryAnswerCode, signal)'), 'guest recovery answer publish must abort immediately with the logical session');
    assert(direct.includes('getFirestoreSignalingRoom(room.roomId, signal)'), 'ambiguous PATCH confirmation GET must share the recovery abort signal');
    assert(direct.includes('recoveryRoomId = await deriveFirestoreRecoveryRoomId(anchorRoomId, generation);'), 'host must know the deterministic recovery mailbox before an abortable POST can become ambiguous');
    assert(direct.includes('if (recoveryRoomId) void deleteFirestoreSignalingRoom(recoveryRoomId);'), 'abort/failure cleanup must retain the deterministic mailbox id even if create never returns');
    assert(direct.includes('void deleteFirestoreSignalingRoom(room.roomId);'), 'best-effort mailbox cleanup must remain independent from an already-aborted recovery signal');
  });

  suite.test('Room links enter the existing lobby/session owner', () => {
    assert(menu.includes('readFirestoreRoomFromLocation()'), 'menu must recognize Firestore room links');
    assert(menu.includes('openJoinLobby({ roomId }'), 'room links must enter the normal lobby');
    assert(lobby.includes('multiplayerSessionController.startFirestoreGuest(options.roomId'), 'lobby must delegate automatic join to the session controller');
    assert(!lobby.includes('createFirestoreSignalingRoom'), 'UI must not own Firestore room creation');
  });

  suite.test('Feature branch remains excluded from Vercel preview deployment', () => {
    assert(vercel.includes('"feat/stable-internet-multiplayer": false'), 'stable multiplayer branch must not consume a Vercel preview deployment');
  });

  suite.test('Firestore setup documents scoped rules instead of opening the database', () => {
    assert(setup.includes('allow list: if false;'), 'signaling collection listing must remain forbidden');
    assert(setup.includes('gone_signaling_rooms_v1/{roomId}'), 'rules must be scoped to only the signaling collection');
    assert(setup.includes('Do not replace unrelated rules'), 'existing Firestore projects must preserve unrelated rules');
  });
}

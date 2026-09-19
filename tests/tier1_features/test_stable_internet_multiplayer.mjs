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
  const p2pHost = source('game-web', 'src', 'net', 'p2pHost.ts');
  const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const menu = source('game-web', 'src', 'ui', 'menu.ts');
  const lobby = source('game-web', 'src', 'ui', 'lobby.ts');
  const vercel = source('game-web', 'vercel.json');
  const setup = source('docs', 'firestore_multiplayer_signaling.md');

  suite.test('Direct WebRTC uses redundant public STUN without TURN relay', () => {
    assert(direct.includes("PUBLIC_STUN_URL = 'stun:stun.cloudflare.com:3478'"), 'direct WebRTC must keep Cloudflare as its primary public STUN endpoint');
    assert(direct.includes("'stun:stun.l.google.com:19302'"), 'direct WebRTC must have a second public STUN discovery endpoint');
    assert(direct.includes('iceServers: [{ urls: [...PUBLIC_STUN_URLS] }]'), 'every peer connection must install the redundant STUN list');
    assert(!direct.includes("'turn:"), 'no TURN endpoint may be configured under the zero-cost architecture');
    assert(!direct.includes('turn.cloudflare.com'), 'Cloudflare TURN must not be enabled');
  });

  suite.test('ICE signaling never publishes an SDP with zero candidates', () => {
    assert(direct.includes('const ICE_GATHER_HARD_TIMEOUT_MS = 15_000;'), 'ICE gathering must have a bounded hard deadline');
    assert(direct.includes('function hasIceCandidate(pc: RTCPeerConnection): boolean'), 'ICE gathering must inspect the actual local SDP for candidates');
    assert(direct.includes("throw new ZeroIceCandidatesError('Nessun candidato ICE disponibile per la connessione WebRTC.')"), 'completed zero-candidate gathering must fail explicitly with the retryable error class');
    assert(direct.includes("fail(new ZeroIceCandidatesError('Timeout ICE: nessun candidato di rete disponibile.'))"), 'hard timeout must reject zero-candidate SDP with the retryable error class instead of publishing it');
    assert(direct.includes('if (softTimeoutElapsed && candidateSeen) finish();'), 'soft timeout may return only after at least one candidate exists');
    assert(direct.includes("pc.addEventListener('icecandidate', onCandidate)"), 'late candidates must be observed after the soft deadline');
  });

  suite.test('Zero-candidate recovery retry is bounded, fresh and abort-aware', () => {
    assert(direct.includes('for (let attempt = 1; attempt <= ICE_CANDIDATE_ATTEMPTS; attempt += 1)'), 'logical RTC recovery must bound zero-candidate retries to the same finite attempt budget');
    assert(direct.includes('replacement = await this.recoveryHandler(abort.signal);'), 'each retry must re-invoke the recovery handler, which creates a fresh PeerConnection transport');
    assert(direct.includes('!isZeroIceCandidatesError(error)'), 'recovery must not retry protocol, identity or signaling failures generically');
    assert(direct.includes('attempt >= ICE_CANDIDATE_ATTEMPTS'), 'recovery must stop after the configured candidate attempt budget');
    assert(direct.includes('await waitForIceRetry(attempt, abort.signal);'), 'recovery retry backoff must share the session AbortSignal');
    assert(direct.includes('async function waitForIceRetry(attempt: number, signal?: AbortSignal): Promise<void>'), 'ICE retry helper must support abort-aware recovery backoff');
    assert(direct.includes("signal?.addEventListener('abort', onAbort, { once: true });"), 'aborting a recovery must interrupt the ICE retry delay instead of waiting for another attempt');
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

  suite.test('P2PHost owns stable broadcast lifecycle without runtime prototype patches', () => {
    const obsoletePatch = path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'networkStabilityFix.ts');
    assert(p2pHost.includes('const stalePeers: string[] = []'), 'canonical host broadcast must track stale peer cleanup itself');
    assert(p2pHost.includes("if (state && state !== 'open')"), 'canonical host broadcast must skip native channels that are not open');
    assert(p2pHost.includes('this.handlePeerDisconnect(id);'), 'canonical host broadcast must clean terminal peer channels after iteration');
    assert(!runtime.includes('networkStabilityFix'), 'runtime composition must not mutate P2PHost broadcast behavior after startup');
    assert(!fs.existsSync(obsoletePatch), 'prototype monkey-patch module must remain removed');
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

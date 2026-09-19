import type { IDataChannel } from './protocol.ts';
import {
    createFirestoreRecoverySignalingRoom,
    deleteFirestoreSignalingRoom,
    deriveFirestoreRecoveryRoomId,
    getFirestoreRecoveryAnchorForOffer,
    publishFirestoreSignalingAnswer,
    waitForFirestoreSignalingAnswer,
    waitForFirestoreSignalingRoom,
} from './firestoreSignaling.ts';

const SIGNAL_VERSION = 2;
const ICE_GATHER_TIMEOUT_MS = 7000;
const CONTROL_CHANNEL_ID = 0;
const REALTIME_CHANNEL_ID = 1;
const DISCONNECTED_GRACE_MS = 6000;
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 15000;
const RECOVERY_OPEN_TIMEOUT_MS = 20_000;
const HEARTBEAT_PING = '__gone_ping__';
const HEARTBEAT_PONG = '__gone_pong__';
const REALTIME_BACKPRESSURE_BYTES = 128 * 1024;
const CLIENT_STATE_OPCODE = 0x01;
const WORLD_SNAPSHOT_OPCODE = 0x02;
export const PUBLIC_STUN_URL = 'stun:stun.cloudflare.com:3478';

interface SignalPayload {
    v: number;
    type: 'offer' | 'answer';
    connectionId: string;
    sdp: string;
    peerId?: string;
}

export interface DirectConnectionDiagnostics {
    candidateCount: number;
    ipv4Candidates: number;
    ipv6Candidates: number;
    mdnsCandidates: number;
    hasGlobalIpv6: boolean;
    scope: 'none' | 'local' | 'internet-ipv6-capable';
}

export interface DirectHostOffer {
    connectionId: string;
    offerCode: string;
    channel: IDataChannel;
    diagnostics: DirectConnectionDiagnostics;
    applyAnswer(answerCode: string, onPeerIdentified?: (peerId: string) => void): Promise<string>;
    close(): void;
}

export interface DirectGuestAnswer {
    connectionId: string;
    answerCode: string;
    channel: IDataChannel;
    diagnostics: DirectConnectionDiagnostics;
    close(): void;
}

type RecoveryRole = 'host' | 'guest';
type RecoveryState = 'recovering' | 'recovered' | 'failed';
type NativeTransport = {
    pc: RTCPeerConnection;
    controlChannel: RTCDataChannel;
    realtimeChannel: RTCDataChannel;
};
type RecoveryTransport = NativeTransport & { generation: number };
type RecoveryHandler = (signal: AbortSignal) => Promise<RecoveryTransport | null>;

function randomId(): string {
    const raw = typeof crypto !== 'undefined' && 'randomUUID' in crypto
        ? crypto.randomUUID().replace(/-/g, '').slice(0, 16)
        : Math.random().toString(36).slice(2, 18);
    return `direct-${raw}`;
}

function encodeBase64Url(text: string): string {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
        .replace(/\+/g, '-')
        .replace(/\//g, '_')
        .replace(/=+$/g, '');
}

function decodeBase64Url(value: string): string {
    const normalized = value.replace(/-/g, '+').replace(/_/g, '/');
    const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
    const binary = atob(padded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return new TextDecoder().decode(bytes);
}

function encodeSignal(payload: SignalPayload): string {
    return encodeBase64Url(JSON.stringify(payload));
}

function decodeSignal(code: string, expectedType: SignalPayload['type']): SignalPayload {
    let parsed: unknown;
    try {
        parsed = JSON.parse(decodeBase64Url(code.trim()));
    } catch {
        throw new Error('Codice di connessione non valido.');
    }

    if (!parsed || typeof parsed !== 'object') {
        throw new Error('Codice di connessione non valido.');
    }

    const payload = parsed as Partial<SignalPayload>;
    if (
        payload.v !== SIGNAL_VERSION ||
        payload.type !== expectedType ||
        typeof payload.connectionId !== 'string' ||
        typeof payload.sdp !== 'string' ||
        payload.sdp.length < 20 ||
        (expectedType === 'answer' && (typeof payload.peerId !== 'string' || payload.peerId.length < 3))
    ) {
        throw new Error(`Codice ${expectedType} non valido o incompatibile.`);
    }

    return payload as SignalPayload;
}

function throwIfAborted(signal?: AbortSignal): void {
    if (signal?.aborted) throw new DOMException('Operazione annullata.', 'AbortError');
}

async function waitForIceGatheringComplete(pc: RTCPeerConnection, signal?: AbortSignal): Promise<void> {
    throwIfAborted(signal);
    if (pc.iceGatheringState === 'complete') return;

    await new Promise<void>((resolve, reject) => {
        let done = false;
        const finish = (error?: unknown) => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            pc.removeEventListener('icegatheringstatechange', onState);
            signal?.removeEventListener('abort', onAbort);
            if (error) reject(error);
            else resolve();
        };
        const onState = () => {
            if (pc.iceGatheringState === 'complete') finish();
        };
        const onAbort = () => finish(new DOMException('Operazione annullata.', 'AbortError'));
        const timer = window.setTimeout(() => finish(), ICE_GATHER_TIMEOUT_MS);
        pc.addEventListener('icegatheringstatechange', onState);
        signal?.addEventListener('abort', onAbort, { once: true });
    });
}

function isGlobalIpv6(address: string): boolean {
    const value = address.toLowerCase();
    if (!value.includes(':')) return false;
    if (value === '::1' || value.startsWith('fe8') || value.startsWith('fe9') || value.startsWith('fea') || value.startsWith('feb')) return false;
    if (value.startsWith('fc') || value.startsWith('fd')) return false;
    return true;
}

function inspectSdp(sdp: string): DirectConnectionDiagnostics {
    const candidateLines = sdp
        .split(/\r?\n/)
        .filter((line) => line.startsWith('a=candidate:'));

    let ipv4Candidates = 0;
    let ipv6Candidates = 0;
    let mdnsCandidates = 0;
    let hasGlobalIpv6 = false;

    for (const line of candidateLines) {
        const parts = line.slice(2).split(/\s+/);
        const address = parts[4] || '';
        if (!address) continue;
        if (address.endsWith('.local')) {
            mdnsCandidates += 1;
        } else if (address.includes(':')) {
            ipv6Candidates += 1;
            if (isGlobalIpv6(address)) hasGlobalIpv6 = true;
        } else if (/^\d{1,3}(?:\.\d{1,3}){3}$/.test(address)) {
            ipv4Candidates += 1;
        }
    }

    return {
        candidateCount: candidateLines.length,
        ipv4Candidates,
        ipv6Candidates,
        mdnsCandidates,
        hasGlobalIpv6,
        scope: candidateLines.length === 0
            ? 'none'
            : hasGlobalIpv6
                ? 'internet-ipv6-capable'
                : 'local',
    };
}

function createPeerConnection(): RTCPeerConnection {
    // Public STUN discovers server-reflexive candidates without relaying gameplay.
    // No TURN server is configured: game traffic remains browser-to-browser.
    return new RTCPeerConnection({
        iceServers: [{ urls: PUBLIC_STUN_URL }],
        bundlePolicy: 'max-bundle',
        iceCandidatePoolSize: 1,
    });
}

function getOpcode(data: ArrayBuffer | ArrayBufferView): number | null {
    if (data instanceof ArrayBuffer) {
        return data.byteLength > 0 ? new Uint8Array(data, 0, 1)[0] : null;
    }
    if (data.byteLength < 1) return null;
    return new Uint8Array(data.buffer, data.byteOffset, 1)[0];
}

function createNegotiatedTransport(pc: RTCPeerConnection): NativeTransport {
    const controlChannel = pc.createDataChannel('gone-control', {
        ordered: true,
        negotiated: true,
        id: CONTROL_CHANNEL_ID,
    });
    const realtimeChannel = pc.createDataChannel('gone-realtime', {
        ordered: false,
        maxRetransmits: 0,
        negotiated: true,
        id: REALTIME_CHANNEL_ID,
    });
    return { pc, controlChannel, realtimeChannel };
}

function createNegotiatedChannel(pc: RTCPeerConnection): NativeRtcDataChannel {
    const transport = createNegotiatedTransport(pc);
    return new NativeRtcDataChannel(transport.controlChannel, pc, transport.realtimeChannel);
}

function closeNativeTransport(transport: NativeTransport): void {
    const channels = transport.realtimeChannel === transport.controlChannel
        ? [transport.controlChannel]
        : [transport.controlChannel, transport.realtimeChannel];
    for (const channel of channels) {
        try {
            if (channel.readyState !== 'closed') channel.close();
        } catch {
            // Best-effort teardown of an already-failed SCTP stream.
        }
    }
    try {
        if (transport.pc.connectionState !== 'closed') transport.pc.close();
    } catch {
        // no-op
    }
}

function dispatchRecoveryState(state: RecoveryState, role: RecoveryRole, generation: number): void {
    if (typeof window === 'undefined') return;
    window.dispatchEvent(new CustomEvent('gone-rtc-recovery-state', {
        detail: { state, role, generation },
    }));
}

/**
 * Presents two native RTCDataChannels as the existing single IDataChannel
 * boundary. Control/combat packets stay reliable+ordered; disposable movement
 * and world snapshots use an unordered, zero-retransmit channel so packet loss
 * cannot head-of-line block newer realtime state.
 *
 * Session/lobby readiness and terminal lifecycle depend only on the reliable
 * control channel plus the peer connection. If the optional realtime channel is
 * unavailable, disposable state falls back to control instead of killing the
 * session; this preserves playability while sacrificing only latency isolation.
 *
 * For Firestore-backed sessions the logical channel can survive a terminal
 * underlying RTC failure: it retires the broken native PeerConnection, performs
 * a one-shot generation-specific SDP exchange through Firestore and installs a
 * replacement control/realtime pair without emitting logical close. P2PHost and
 * P2PClient therefore keep their authoritative slot/HP/roster identity.
 *
 * The third constructor argument is optional for isolated legacy tests/adapters:
 * when omitted, all traffic uses the supplied channel exactly as before.
 */
export class NativeRtcDataChannel implements IDataChannel {
    public binaryType: 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;

    private controlChannel: RTCDataChannel;
    private realtimeChannel: RTCDataChannel;
    private channels: readonly RTCDataChannel[];
    private pc: RTCPeerConnection;
    private transportEpoch = 0;
    private disconnectTimer: number | null = null;
    private heartbeatTimer: number | null = null;
    private recoveryOpenTimer: number | null = null;
    private lastInboundAt = performance.now();
    private openNotified = false;
    private closeNotified = false;
    private terminating = false;
    private recoveryHandler: RecoveryHandler | null = null;
    private recoveryRole: RecoveryRole | null = null;
    private recoveryGeneration = 1;
    private recovering = false;
    private recoveryAbort: AbortController | null = null;
    private readonly pageHideHandler: () => void;

    constructor(controlChannel: RTCDataChannel, pc: RTCPeerConnection, realtimeChannel?: RTCDataChannel) {
        this.controlChannel = controlChannel;
        this.realtimeChannel = realtimeChannel ?? controlChannel;
        this.channels = this.realtimeChannel === this.controlChannel
            ? [this.controlChannel]
            : [this.controlChannel, this.realtimeChannel];
        this.pc = pc;
        this.pageHideHandler = () => this.close();
        this.installTransport(this.controlChannel, this.pc, this.realtimeChannel, false);
        window.addEventListener('pagehide', this.pageHideHandler);
    }

    public setRecoveryHandler(role: RecoveryRole, handler: RecoveryHandler): void {
        this.recoveryRole = role;
        this.recoveryHandler = handler;
    }

    private installTransport(
        controlChannel: RTCDataChannel,
        pc: RTCPeerConnection,
        realtimeChannel: RTCDataChannel,
        replacement: boolean,
    ): void {
        this.controlChannel = controlChannel;
        this.realtimeChannel = realtimeChannel;
        this.channels = this.realtimeChannel === this.controlChannel
            ? [this.controlChannel]
            : [this.controlChannel, this.realtimeChannel];
        this.pc = pc;
        const epoch = ++this.transportEpoch;

        for (const channel of this.channels) {
            channel.binaryType = 'arraybuffer';
            channel.addEventListener('open', () => {
                if (epoch !== this.transportEpoch) return;
                if (replacement) this.completeRecovery();
                else this.maybeNotifyOpen();
            });
            channel.addEventListener('message', (event) => {
                if (epoch === this.transportEpoch) this.handleRawMessage(event.data);
            });
        }

        this.controlChannel.addEventListener('close', () => {
            if (epoch === this.transportEpoch) this.handleTransportFailure(new Error('WebRTC control DataChannel chiuso.'));
        });
        this.controlChannel.addEventListener('error', () => {
            if (epoch === this.transportEpoch) this.handleTransportFailure(new Error('WebRTC control DataChannel in errore.'));
        });

        this.pc.addEventListener('connectionstatechange', () => this.handlePeerConnectionState(pc, epoch));
        this.pc.addEventListener('iceconnectionstatechange', () => this.handlePeerConnectionState(pc, epoch));

        if (replacement) {
            this.recoveryOpenTimer = window.setTimeout(() => {
                if (epoch !== this.transportEpoch || !this.recovering) return;
                this.failRecovery(new Error('Timeout apertura trasporto WebRTC di recovery.'));
            }, RECOVERY_OPEN_TIMEOUT_MS);
        } else {
            this.maybeNotifyOpen();
        }
    }

    private maybeNotifyOpen(): void {
        if (this.openNotified || this.closeNotified || this.recovering) return;
        if (this.controlChannel.readyState !== 'open') return;
        this.openNotified = true;
        this.lastInboundAt = performance.now();
        this.startHeartbeat();
        this.onopen?.();
    }

    private handleRawMessage(data: unknown): void {
        this.lastInboundAt = performance.now();

        if (data === HEARTBEAT_PING) {
            if (this.controlChannel.readyState === 'open') {
                try {
                    this.controlChannel.send(HEARTBEAT_PONG);
                } catch (error) {
                    this.handleTransportFailure(error instanceof Error ? error : new Error(String(error)));
                }
            }
            return;
        }

        if (data === HEARTBEAT_PONG) return;
        this.onmessage?.({ data });
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer !== null || this.recovering || this.closeNotified) return;
        this.heartbeatTimer = window.setInterval(() => {
            if (this.controlChannel.readyState !== 'open') return;

            const silenceMs = performance.now() - this.lastInboundAt;
            if (silenceMs >= HEARTBEAT_TIMEOUT_MS) {
                this.handleTransportFailure(new Error('Peer non raggiungibile: heartbeat WebRTC scaduto.'));
                return;
            }

            try {
                this.controlChannel.send(HEARTBEAT_PING);
            } catch (error) {
                this.handleTransportFailure(error instanceof Error ? error : new Error(String(error)));
            }
        }, HEARTBEAT_INTERVAL_MS);
    }

    private clearHeartbeat(): void {
        if (this.heartbeatTimer !== null) {
            window.clearInterval(this.heartbeatTimer);
            this.heartbeatTimer = null;
        }
    }

    private clearDisconnectTimer(): void {
        if (this.disconnectTimer !== null) {
            window.clearTimeout(this.disconnectTimer);
            this.disconnectTimer = null;
        }
    }

    private clearRecoveryOpenTimer(): void {
        if (this.recoveryOpenTimer !== null) {
            window.clearTimeout(this.recoveryOpenTimer);
            this.recoveryOpenTimer = null;
        }
    }

    private notifyClose(): void {
        if (this.closeNotified) return;
        this.closeNotified = true;
        this.clearDisconnectTimer();
        this.clearHeartbeat();
        this.clearRecoveryOpenTimer();
        window.removeEventListener('pagehide', this.pageHideHandler);
        this.onclose?.();
    }

    private retireCurrentTransport(): void {
        const transport: NativeTransport = {
            pc: this.pc,
            controlChannel: this.controlChannel,
            realtimeChannel: this.realtimeChannel,
        };
        ++this.transportEpoch;
        closeNativeTransport(transport);
    }

    private terminate(error?: Error): void {
        if (this.closeNotified || this.terminating) return;
        this.terminating = true;
        this.recoveryAbort?.abort();
        this.recoveryAbort = null;
        this.recovering = false;
        this.clearDisconnectTimer();
        this.clearHeartbeat();
        this.clearRecoveryOpenTimer();
        if (error) this.onerror?.(error);
        this.retireCurrentTransport();
        this.terminating = false;
        this.notifyClose();
    }

    private handleTransportFailure(error: Error): void {
        if (this.closeNotified || this.terminating) return;
        if (this.recovering) {
            this.failRecovery(error);
            return;
        }
        if (!this.recoveryHandler || !this.recoveryRole) {
            this.terminate(error);
            return;
        }
        void this.beginRecovery(error);
    }

    private async beginRecovery(originalError: Error): Promise<void> {
        if (this.recovering || this.closeNotified || !this.recoveryHandler || !this.recoveryRole) return;
        this.recovering = true;
        this.clearDisconnectTimer();
        this.clearHeartbeat();
        this.clearRecoveryOpenTimer();
        const abort = new AbortController();
        this.recoveryAbort = abort;
        const role = this.recoveryRole;
        const nextGeneration = this.recoveryGeneration + 1;

        // Retire the broken native transport without notifying P2PHost/P2PClient.
        // The logical channel remains alive and drops outbound traffic while the
        // one-shot Firestore mailbox negotiates a replacement PeerConnection.
        this.retireCurrentTransport();

        try {
            const replacement = await this.recoveryHandler(abort.signal);
            if (abort.signal.aborted || this.closeNotified) {
                if (replacement) closeNativeTransport(replacement);
                return;
            }
            if (!replacement) {
                this.recovering = false;
                this.recoveryAbort = null;
                this.terminate(originalError);
                return;
            }

            this.recoveryGeneration = replacement.generation;
            dispatchRecoveryState('recovering', role, replacement.generation || nextGeneration);
            this.installTransport(
                replacement.controlChannel,
                replacement.pc,
                replacement.realtimeChannel,
                true,
            );
        } catch (error) {
            if (abort.signal.aborted || this.closeNotified) return;
            const recoveryError = error instanceof Error ? error : new Error(String(error));
            this.recovering = false;
            this.recoveryAbort = null;
            dispatchRecoveryState('failed', role, nextGeneration);
            this.terminate(new Error(`${originalError.message} Recovery automatica fallita: ${recoveryError.message}`));
        }
    }

    private completeRecovery(): void {
        if (!this.recovering || this.closeNotified || this.controlChannel.readyState !== 'open') return;
        this.recovering = false;
        this.recoveryAbort = null;
        this.clearRecoveryOpenTimer();
        this.lastInboundAt = performance.now();
        if (!this.openNotified) this.maybeNotifyOpen();
        else this.startHeartbeat();
        if (this.recoveryRole) dispatchRecoveryState('recovered', this.recoveryRole, this.recoveryGeneration);
    }

    private failRecovery(error: Error): void {
        if (!this.recovering || this.closeNotified) return;
        const role = this.recoveryRole;
        const generation = this.recoveryGeneration;
        this.recoveryAbort?.abort();
        this.recoveryAbort = null;
        this.recovering = false;
        this.clearRecoveryOpenTimer();
        if (role) dispatchRecoveryState('failed', role, generation);
        this.terminate(error);
    }

    private handlePeerConnectionState(pc: RTCPeerConnection, epoch: number): void {
        if (epoch !== this.transportEpoch || this.closeNotified) return;
        const state = pc.connectionState;
        const iceState = pc.iceConnectionState;

        if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
            this.clearDisconnectTimer();
            return;
        }

        if (state === 'failed' || iceState === 'failed') {
            this.clearDisconnectTimer();
            this.handleTransportFailure(new Error('Connessione WebRTC diretta fallita: rete/NAT non raggiungibile.'));
            return;
        }

        if (state === 'disconnected' || iceState === 'disconnected') {
            if (this.disconnectTimer === null) {
                this.disconnectTimer = window.setTimeout(() => {
                    this.disconnectTimer = null;
                    if (epoch !== this.transportEpoch) return;
                    if (pc.connectionState === 'disconnected' || pc.iceConnectionState === 'disconnected') {
                        this.handleTransportFailure(new Error('Connessione WebRTC diretta interrotta.'));
                    }
                }, DISCONNECTED_GRACE_MS);
            }
        }
    }

    private isRealtimePayload(data: string | ArrayBuffer | ArrayBufferView): boolean {
        if (typeof data === 'string') return false;
        const opcode = getOpcode(data);
        return opcode === CLIENT_STATE_OPCODE || opcode === WORLD_SNAPSHOT_OPCODE;
    }

    private channelFor(data: string | ArrayBuffer | ArrayBufferView): RTCDataChannel {
        if (
            this.isRealtimePayload(data)
            && this.realtimeChannel !== this.controlChannel
            && this.realtimeChannel.readyState === 'open'
        ) {
            return this.realtimeChannel;
        }
        return this.controlChannel;
    }

    get readyState(): string {
        if (this.closeNotified) return 'closed';
        if (this.recovering) return this.openNotified ? 'open' : 'connecting';
        if (this.controlChannel.readyState === 'closed') return 'closed';
        if (this.controlChannel.readyState === 'closing') return 'closing';
        if (this.controlChannel.readyState === 'open') return 'open';
        return 'connecting';
    }

    get bufferedAmount(): number {
        if (this.recovering) return 0;
        return this.channels.reduce((sum, channel) => sum + channel.bufferedAmount, 0);
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        // A recoverable logical session intentionally drops traffic while the
        // replacement RTC transport is negotiated. This prevents higher layers
        // from tearing down authoritative match state because SCTP is transiently absent.
        if (this.recovering) return;
        if (this.readyState !== 'open') {
            throw new Error('WebRTC DataChannel non aperto.');
        }

        const realtimePayload = this.isRealtimePayload(data);
        const target = this.channelFor(data);
        const usesRealtimeChannel = target === this.realtimeChannel && this.realtimeChannel !== this.controlChannel;

        if (usesRealtimeChannel && target.bufferedAmount > REALTIME_BACKPRESSURE_BYTES) {
            return;
        }
        if (target.readyState !== 'open') {
            if (realtimePayload) return;
            throw new Error('WebRTC control DataChannel non aperto.');
        }

        if (typeof data === 'string') {
            target.send(data);
            return;
        }
        if (data instanceof ArrayBuffer) {
            target.send(data);
            return;
        }

        const copied = new Uint8Array(data.byteLength);
        copied.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        target.send(copied);
    }

    close(): void {
        this.terminate();
    }
}

export async function createDirectHostOffer(): Promise<DirectHostOffer> {
    const pc = createPeerConnection();
    const connectionId = randomId();
    const channel = createNegotiatedChannel(pc);

    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);
    await waitForIceGatheringComplete(pc);

    if (!pc.localDescription?.sdp) {
        pc.close();
        throw new Error('Impossibile creare l\'invito WebRTC.');
    }

    const localSdp = pc.localDescription.sdp;
    const offerCode = encodeSignal({
        v: SIGNAL_VERSION,
        type: 'offer',
        connectionId,
        sdp: localSdp,
    });

    let answerApplied = false;
    let recoveryPeerId: string | null = null;
    let recoveryGeneration = 1;

    channel.setRecoveryHandler('host', async (signal) => {
        const anchorRoomId = getFirestoreRecoveryAnchorForOffer(offerCode);
        if (!anchorRoomId || !recoveryPeerId) return null;
        throwIfAborted(signal);

        const generation = recoveryGeneration + 1;
        const recoveryPc = createPeerConnection();
        const transport = createNegotiatedTransport(recoveryPc);
        let recoveryRoomId: string | null = null;

        try {
            const recoveryConnectionId = randomId();
            const recoveryOffer = await recoveryPc.createOffer();
            throwIfAborted(signal);
            await recoveryPc.setLocalDescription(recoveryOffer);
            await waitForIceGatheringComplete(recoveryPc, signal);
            throwIfAborted(signal);
            if (!recoveryPc.localDescription?.sdp) {
                throw new Error('Impossibile creare l\'offerta di recovery WebRTC.');
            }

            const recoveryOfferCode = encodeSignal({
                v: SIGNAL_VERSION,
                type: 'offer',
                connectionId: recoveryConnectionId,
                sdp: recoveryPc.localDescription.sdp,
            });
            const room = await createFirestoreRecoverySignalingRoom(
                anchorRoomId,
                generation,
                recoveryOfferCode,
                signal,
            );
            recoveryRoomId = room.roomId;
            const answerCode = await waitForFirestoreSignalingAnswer(room.roomId, signal);
            throwIfAborted(signal);
            const answer = decodeSignal(answerCode, 'answer');
            if (answer.connectionId !== recoveryConnectionId) {
                throw new Error('La risposta recovery appartiene a un altro trasporto.');
            }
            if (answer.peerId !== recoveryPeerId) {
                throw new Error('Identità guest non valida durante la recovery.');
            }
            await recoveryPc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
            recoveryGeneration = generation;
            void deleteFirestoreSignalingRoom(room.roomId);
            return { ...transport, generation };
        } catch (error) {
            closeNativeTransport(transport);
            if (recoveryRoomId) void deleteFirestoreSignalingRoom(recoveryRoomId);
            throw error;
        }
    });

    return {
        connectionId,
        offerCode,
        channel,
        diagnostics: inspectSdp(localSdp),
        async applyAnswer(answerCode: string, onPeerIdentified?: (peerId: string) => void) {
            if (answerApplied) throw new Error('Questa risposta è già stata applicata.');
            const answer = decodeSignal(answerCode, 'answer');
            if (answer.connectionId !== connectionId) {
                throw new Error('La risposta appartiene a un altro invito.');
            }
            const peerId = answer.peerId!;
            recoveryPeerId = peerId;
            // Bind the authoritative host channel to the actual guest identity
            // before setRemoteDescription can open the negotiated DataChannels.
            onPeerIdentified?.(peerId);
            await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
            answerApplied = true;
            return peerId;
        },
        close() {
            try { channel.close?.(); } finally {
                if (pc.connectionState !== 'closed') pc.close();
            }
        },
    };
}

export async function createDirectGuestAnswer(offerCode: string, peerId: string): Promise<DirectGuestAnswer> {
    if (!peerId || peerId.length < 3) throw new Error('Identità giocatore non valida.');
    const offer = decodeSignal(offerCode, 'offer');
    const pc = createPeerConnection();

    try {
        await pc.setRemoteDescription({ type: 'offer', sdp: offer.sdp });
        const channel = createNegotiatedChannel(pc);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        await waitForIceGatheringComplete(pc);

        if (!pc.localDescription?.sdp) {
            throw new Error('Impossibile creare la risposta WebRTC.');
        }

        const localSdp = pc.localDescription.sdp;
        const answerCode = encodeSignal({
            v: SIGNAL_VERSION,
            type: 'answer',
            connectionId: offer.connectionId,
            peerId,
            sdp: localSdp,
        });
        let recoveryGeneration = 1;

        channel.setRecoveryHandler('guest', async (signal) => {
            const anchorRoomId = getFirestoreRecoveryAnchorForOffer(offerCode);
            if (!anchorRoomId) return null;
            throwIfAborted(signal);

            const generation = recoveryGeneration + 1;
            const recoveryRoomId = await deriveFirestoreRecoveryRoomId(anchorRoomId, generation);
            const room = await waitForFirestoreSignalingRoom(recoveryRoomId, signal);
            throwIfAborted(signal);
            const recoveryOffer = decodeSignal(room.offerCode, 'offer');
            const recoveryPc = createPeerConnection();
            let transport: NativeTransport | null = null;

            try {
                await recoveryPc.setRemoteDescription({ type: 'offer', sdp: recoveryOffer.sdp });
                transport = createNegotiatedTransport(recoveryPc);
                const recoveryAnswer = await recoveryPc.createAnswer();
                throwIfAborted(signal);
                await recoveryPc.setLocalDescription(recoveryAnswer);
                await waitForIceGatheringComplete(recoveryPc, signal);
                throwIfAborted(signal);
                if (!recoveryPc.localDescription?.sdp) {
                    throw new Error('Impossibile creare la risposta recovery WebRTC.');
                }

                const recoveryAnswerCode = encodeSignal({
                    v: SIGNAL_VERSION,
                    type: 'answer',
                    connectionId: recoveryOffer.connectionId,
                    peerId,
                    sdp: recoveryPc.localDescription.sdp,
                });

                try {
                    await publishFirestoreSignalingAnswer(room.roomId, recoveryAnswerCode, signal);
                } catch (publishError) {
                    const confirmedRoom = await getFirestoreSignalingRoom(room.roomId, signal).catch(() => null);
                    if (confirmedRoom?.answerCode !== recoveryAnswerCode) throw publishError;
                }

                recoveryGeneration = generation;
                return { ...transport, generation };
            } catch (error) {
                if (transport) closeNativeTransport(transport);
                else {
                    try { recoveryPc.close(); } catch { /* no-op */ }
                }
                throw error;
            }
        });

        return {
            connectionId: offer.connectionId,
            answerCode,
            channel,
            diagnostics: inspectSdp(localSdp),
            close() {
                try { channel.close?.(); } finally {
                    if (pc.connectionState !== 'closed') pc.close();
                }
            },
        };
    } catch (error) {
        pc.close();
        throw error;
    }
}

export function buildDirectInviteUrl(offerCode: string): string {
    const url = new URL(window.location.href);
    url.search = '';
    url.hash = `direct=${encodeURIComponent(offerCode)}`;
    return url.toString();
}

export function readDirectOfferFromLocation(): string | null {
    const hash = window.location.hash.replace(/^#/, '');
    const params = new URLSearchParams(hash);
    return params.get('direct');
}
import type { IDataChannel } from './protocol.ts';

const SIGNAL_VERSION = 2;
const ICE_GATHER_TIMEOUT_MS = 7000;
const CONTROL_CHANNEL_ID = 0;
const REALTIME_CHANNEL_ID = 1;
const DISCONNECTED_GRACE_MS = 6000;
const HEARTBEAT_INTERVAL_MS = 3000;
const HEARTBEAT_TIMEOUT_MS = 15000;
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

async function waitForIceGatheringComplete(pc: RTCPeerConnection): Promise<void> {
    if (pc.iceGatheringState === 'complete') return;

    await new Promise<void>((resolve) => {
        let done = false;
        const finish = () => {
            if (done) return;
            done = true;
            clearTimeout(timer);
            pc.removeEventListener('icegatheringstatechange', onState);
            resolve();
        };
        const onState = () => {
            if (pc.iceGatheringState === 'complete') finish();
        };
        const timer = window.setTimeout(finish, ICE_GATHER_TIMEOUT_MS);
        pc.addEventListener('icegatheringstatechange', onState);
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

function createNegotiatedChannel(pc: RTCPeerConnection): NativeRtcDataChannel {
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
    return new NativeRtcDataChannel(controlChannel, pc, realtimeChannel);
}

/**
 * Presents two native RTCDataChannels as the existing single IDataChannel
 * boundary. Control/combat packets stay reliable+ordered; disposable movement
 * and world snapshots use an unordered, zero-retransmit channel so packet loss
 * cannot head-of-line block newer realtime state.
 *
 * Session/lobby readiness depends only on the reliable control channel. A
 * realtime channel that is still connecting simply drops disposable state until
 * it opens; it must never block JOIN or other critical control traffic.
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

    private readonly controlChannel: RTCDataChannel;
    private readonly realtimeChannel: RTCDataChannel;
    private readonly channels: readonly RTCDataChannel[];
    private readonly pc: RTCPeerConnection;
    private disconnectTimer: number | null = null;
    private heartbeatTimer: number | null = null;
    private lastInboundAt = performance.now();
    private openNotified = false;
    private closeNotified = false;
    private terminating = false;
    private readonly pageHideHandler: () => void;

    constructor(controlChannel: RTCDataChannel, pc: RTCPeerConnection, realtimeChannel?: RTCDataChannel) {
        this.controlChannel = controlChannel;
        this.realtimeChannel = realtimeChannel ?? controlChannel;
        this.channels = this.realtimeChannel === this.controlChannel
            ? [this.controlChannel]
            : [this.controlChannel, this.realtimeChannel];
        this.pc = pc;
        this.pageHideHandler = () => this.close();

        for (const channel of this.channels) {
            channel.binaryType = 'arraybuffer';
            channel.addEventListener('open', () => this.maybeNotifyOpen());
            channel.addEventListener('close', () => this.terminate());
            // Browsers may emit RTCErrorEvent immediately before a normal remote
            // close. Treat that transport event as disconnect semantics; hard ICE
            // failures and heartbeat expiry still surface through onerror below.
            channel.addEventListener('error', () => this.terminate());
            channel.addEventListener('message', (event) => this.handleRawMessage(event.data));
        }

        this.pc.addEventListener('connectionstatechange', () => this.handlePeerConnectionState());
        this.pc.addEventListener('iceconnectionstatechange', () => this.handlePeerConnectionState());
        window.addEventListener('pagehide', this.pageHideHandler);
        this.maybeNotifyOpen();
    }

    private maybeNotifyOpen(): void {
        if (this.openNotified || this.closeNotified) return;
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
                    this.terminate(error instanceof Error ? error : new Error(String(error)));
                }
            }
            return;
        }

        if (data === HEARTBEAT_PONG) return;
        this.onmessage?.({ data });
    }

    private startHeartbeat(): void {
        if (this.heartbeatTimer !== null) return;
        this.heartbeatTimer = window.setInterval(() => {
            if (this.controlChannel.readyState !== 'open') return;

            const silenceMs = performance.now() - this.lastInboundAt;
            if (silenceMs >= HEARTBEAT_TIMEOUT_MS) {
                this.terminate(new Error('Peer non raggiungibile: heartbeat WebRTC scaduto.'));
                return;
            }

            try {
                this.controlChannel.send(HEARTBEAT_PING);
            } catch (error) {
                this.terminate(error instanceof Error ? error : new Error(String(error)));
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

    private notifyClose(): void {
        if (this.closeNotified) return;
        this.closeNotified = true;
        this.clearDisconnectTimer();
        this.clearHeartbeat();
        window.removeEventListener('pagehide', this.pageHideHandler);
        this.onclose?.();
    }

    private terminate(error?: Error): void {
        if (this.closeNotified || this.terminating) return;
        this.terminating = true;
        if (error) this.onerror?.(error);
        for (const channel of this.channels) {
            try {
                if (channel.readyState !== 'closed') channel.close();
            } catch {
                // Continue with deterministic local teardown even if the browser
                // refuses to close an already-failed SCTP channel.
            }
        }
        try {
            if (this.pc.connectionState !== 'closed') this.pc.close();
        } catch {
            // no-op
        }
        this.terminating = false;
        this.notifyClose();
    }

    private handlePeerConnectionState(): void {
        const state = this.pc.connectionState;
        const iceState = this.pc.iceConnectionState;

        if (state === 'connected' || iceState === 'connected' || iceState === 'completed') {
            this.clearDisconnectTimer();
            return;
        }

        if (state === 'failed' || iceState === 'failed') {
            this.clearDisconnectTimer();
            this.terminate(new Error('Connessione WebRTC diretta fallita: rete/NAT non raggiungibile.'));
            return;
        }

        if (state === 'disconnected' || iceState === 'disconnected') {
            if (this.disconnectTimer === null) {
                this.disconnectTimer = window.setTimeout(() => {
                    this.disconnectTimer = null;
                    if (this.pc.connectionState === 'disconnected' || this.pc.iceConnectionState === 'disconnected') {
                        this.terminate(new Error('Connessione WebRTC diretta interrotta.'));
                    }
                }, DISCONNECTED_GRACE_MS);
            }
        }
    }

    private channelFor(data: string | ArrayBuffer | ArrayBufferView): RTCDataChannel {
        if (typeof data === 'string') return this.controlChannel;
        const opcode = getOpcode(data);
        return opcode === CLIENT_STATE_OPCODE || opcode === WORLD_SNAPSHOT_OPCODE
            ? this.realtimeChannel
            : this.controlChannel;
    }

    get readyState(): string {
        if (this.closeNotified || this.controlChannel.readyState === 'closed') return 'closed';
        if (this.controlChannel.readyState === 'closing') return 'closing';
        if (this.controlChannel.readyState === 'open') return 'open';
        return 'connecting';
    }

    get bufferedAmount(): number {
        return this.channels.reduce((sum, channel) => sum + channel.bufferedAmount, 0);
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.readyState !== 'open') {
            throw new Error('WebRTC DataChannel non aperto.');
        }

        const target = this.channelFor(data);
        const isRealtime = target === this.realtimeChannel && this.realtimeChannel !== this.controlChannel;
        if (isRealtime && target.readyState !== 'open') {
            return;
        }
        if (isRealtime && target.bufferedAmount > REALTIME_BACKPRESSURE_BYTES) {
            return;
        }
        if (!isRealtime && target.readyState !== 'open') {
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

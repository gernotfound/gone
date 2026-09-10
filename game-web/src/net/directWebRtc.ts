import type { IDataChannel } from './protocol.ts';

const SIGNAL_VERSION = 1;
const ICE_GATHER_TIMEOUT_MS = 4500;
const DATA_CHANNEL_ID = 0;

interface SignalPayload {
    v: number;
    type: 'offer' | 'answer';
    connectionId: string;
    sdp: string;
    peerId?: string;
}

export interface DirectHostOffer {
    connectionId: string;
    offerCode: string;
    channel: IDataChannel;
    applyAnswer(answerCode: string, onPeerIdentified?: (peerId: string) => void): Promise<string>;
    close(): void;
}

export interface DirectGuestAnswer {
    connectionId: string;
    answerCode: string;
    channel: IDataChannel;
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

function createPeerConnection(): RTCPeerConnection {
    // Intentionally no STUN/TURN: no third-party multiplayer/signaling/relay
    // infrastructure is contacted. The room creator remains the game server.
    return new RTCPeerConnection({
        iceServers: [],
        bundlePolicy: 'max-bundle',
    });
}

function createNegotiatedChannel(pc: RTCPeerConnection): NativeRtcDataChannel {
    const rawChannel = pc.createDataChannel('gone-game', {
        ordered: true,
        negotiated: true,
        id: DATA_CHANNEL_ID,
    });
    return new NativeRtcDataChannel(rawChannel);
}

export class NativeRtcDataChannel implements IDataChannel {
    public binaryType: 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;

    private readonly channel: RTCDataChannel;

    constructor(channel: RTCDataChannel) {
        this.channel = channel;
        this.channel.binaryType = 'arraybuffer';
        this.channel.addEventListener('open', () => this.onopen?.());
        this.channel.addEventListener('close', () => this.onclose?.());
        this.channel.addEventListener('error', (event) => this.onerror?.(event));
        this.channel.addEventListener('message', (event) => this.onmessage?.({ data: event.data }));
    }

    get readyState(): string {
        return this.channel.readyState;
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.channel.readyState !== 'open') {
            throw new Error('WebRTC DataChannel non aperto.');
        }

        if (typeof data === 'string') {
            this.channel.send(data);
            return;
        }
        if (data instanceof ArrayBuffer) {
            this.channel.send(data);
            return;
        }

        const copied = new Uint8Array(data.byteLength);
        copied.set(new Uint8Array(data.buffer, data.byteOffset, data.byteLength));
        this.channel.send(copied);
    }

    close(): void {
        if (this.channel.readyState !== 'closed') this.channel.close();
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

    const offerCode = encodeSignal({
        v: SIGNAL_VERSION,
        type: 'offer',
        connectionId,
        sdp: pc.localDescription.sdp,
    });

    let answerApplied = false;

    return {
        connectionId,
        offerCode,
        channel,
        async applyAnswer(answerCode: string, onPeerIdentified?: (peerId: string) => void) {
            if (answerApplied) throw new Error('Questa risposta è già stata applicata.');
            const answer = decodeSignal(answerCode, 'answer');
            if (answer.connectionId !== connectionId) {
                throw new Error('La risposta appartiene a un altro invito.');
            }
            const peerId = answer.peerId!;
            // Bind the authoritative host channel to the actual guest identity
            // before setRemoteDescription can open the negotiated DataChannel.
            onPeerIdentified?.(peerId);
            await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
            answerApplied = true;
            return peerId;
        },
        close() {
            try { channel.close?.(); } finally { pc.close(); }
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

        const answerCode = encodeSignal({
            v: SIGNAL_VERSION,
            type: 'answer',
            connectionId: offer.connectionId,
            peerId,
            sdp: pc.localDescription.sdp,
        });

        return {
            connectionId: offer.connectionId,
            answerCode,
            channel,
            close() {
                try { channel.close?.(); } finally { pc.close(); }
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
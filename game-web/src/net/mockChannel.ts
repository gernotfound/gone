import type { IDataChannel } from './protocol.ts';
import { P2PHost } from './p2pHost.ts';
import { Peer, type DataConnection } from 'peerjs';

const WEBRTC_CONNECT_TIMEOUT_MS = 12000;

function buildPeerOptions() {
    const iceServers: RTCIceServer[] = [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' },
    ];

    // Optional TURN relay. These values are intentionally read from Vite env
    // so a production deployment can support symmetric NAT without changing code.
    const turnUrl = import.meta.env.VITE_TURN_URL as string | undefined;
    const turnUsername = import.meta.env.VITE_TURN_USERNAME as string | undefined;
    const turnCredential = import.meta.env.VITE_TURN_CREDENTIAL as string | undefined;
    if (turnUrl) {
        iceServers.push({
            urls: turnUrl,
            username: turnUsername || undefined,
            credential: turnCredential || undefined,
        });
    }

    return {
        debug: import.meta.env.DEV ? 1 : 0,
        config: {
            iceServers,
            sdpSemantics: 'unified-plan' as const,
        },
    };
}

// ---------------------------------------------------------------------------
// PeerJsDataChannel: IDataChannel wrapper around PeerJS DataConnection
// ---------------------------------------------------------------------------
export class PeerJsDataChannel implements IDataChannel {
    public binaryType?: 'blob' | 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;
    public readyState: string = 'connecting';

    private closed = false;

    constructor(
        private readonly conn: DataConnection,
        private readonly ownerPeer?: Peer,
        private readonly destroyPeerOnClose = false,
    ) {
        this.conn.on('open', () => {
            if (this.closed) return;
            this.readyState = 'open';
            this.onopen?.();
        });

        this.conn.on('close', () => {
            this.finishClose();
        });

        this.conn.on('error', (err: any) => {
            this.onerror?.(err);
        });

        this.conn.on('data', (data: any) => {
            this.onmessage?.({ data });
        });

        if (this.conn.open) {
            this.readyState = 'open';
            queueMicrotask(() => {
                if (!this.closed) this.onopen?.();
            });
        }
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.readyState !== 'open' || !this.conn.open) {
            throw new Error('WebRTC DataChannel is not open');
        }
        this.conn.send(data);
    }

    close(): void {
        if (this.closed) return;
        try { this.conn.close(); } finally { this.finishClose(); }
    }

    private finishClose() {
        if (this.closed) return;
        this.closed = true;
        this.readyState = 'closed';
        if (this.destroyPeerOnClose && this.ownerPeer && !this.ownerPeer.destroyed) {
            this.ownerPeer.destroy();
        }
        this.onclose?.();
    }
}

// ---------------------------------------------------------------------------
// BroadcastChannel fallback for multiple tabs on the same browser/device.
// ---------------------------------------------------------------------------
export class MockBroadcastChannel implements IDataChannel {
    private bc: BroadcastChannel;
    public binaryType?: 'blob' | 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;
    public readyState: string = 'open';

    constructor(channelName: string) {
        this.bc = new BroadcastChannel(channelName);
        this.bc.onmessage = (ev) => this.onmessage?.(ev);
        queueMicrotask(() => this.onopen?.());
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.readyState !== 'open') throw new Error('BroadcastChannel is closed');
        this.bc.postMessage(data);
    }

    close(): void {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.bc.close();
        this.onclose?.();
    }
}

async function isLocalHost(hostId: string): Promise<boolean> {
    if (typeof BroadcastChannel === 'undefined') return false;

    return new Promise((resolve) => {
        const probeCh = new BroadcastChannel(`gone-probe-${hostId}`);
        let settled = false;
        const finish = (value: boolean) => {
            if (settled) return;
            settled = true;
            probeCh.close();
            resolve(value);
        };

        probeCh.onmessage = (ev) => {
            if (ev.data?.type === 'PROBE_ACK') finish(true);
        };
        probeCh.postMessage({ type: 'PROBE' });
        setTimeout(() => finish(false), 220);
    });
}

// ---------------------------------------------------------------------------
// HOST SIGNALING
// ---------------------------------------------------------------------------
export function startHostSignaling(hostId: string, p2pHost: P2PHost): void {
    let localSig: BroadcastChannel | null = null;
    let localProbe: BroadcastChannel | null = null;

    if (typeof BroadcastChannel !== 'undefined') {
        localSig = new BroadcastChannel(`gone-sig-${hostId}`);
        localProbe = new BroadcastChannel(`gone-probe-${hostId}`);
        const registeredLocalPeers = new Set<string>();

        localProbe.onmessage = (ev) => {
            if (ev.data?.type === 'PROBE') localProbe?.postMessage({ type: 'PROBE_ACK' });
        };

        localSig.onmessage = (ev) => {
            const msg = ev.data;
            if (msg?.type !== 'PEER_CONNECT' || registeredLocalPeers.has(msg.peerId)) return;
            registeredLocalPeers.add(msg.peerId);
            const dataChannelName = `gone-data-${hostId}-${msg.peerId}`;
            const channel = new MockBroadcastChannel(dataChannelName);
            p2pHost.registerPeer(msg.peerId, channel);
            localSig?.postMessage({
                type: 'PEER_ACCEPT',
                peerId: msg.peerId,
                channelName: dataChannelName,
            });
        };
    }

    const peer = new Peer(hostId, buildPeerOptions());

    peer.on('open', (id) => {
        console.info(`[G.O.N.E.] Host signaling ready: ${id}`);
    });

    peer.on('connection', (conn) => {
        const channel = new PeerJsDataChannel(conn);
        p2pHost.registerPeer(conn.peer, channel);
    });

    peer.on('error', (err) => {
        console.error('[G.O.N.E.] Host PeerJS error:', err);
        p2pHost.options.onError?.(err instanceof Error ? err : new Error(String(err)));
    });

    (p2pHost as any).__stopHostSignaling = () => {
        localSig?.close();
        localProbe?.close();
        if (!peer.destroyed) peer.destroy();
    };
}

// ---------------------------------------------------------------------------
// CLIENT SIGNALING
// ---------------------------------------------------------------------------
export async function connectClientSignaling(hostId: string, peerId: string): Promise<IDataChannel> {
    if (await isLocalHost(hostId)) {
        try {
            return await connectLocally(hostId, peerId);
        } catch {
            // Local probing can race with tab lifecycle; WebRTC is a valid fallback.
        }
    }
    return connectViaPeerJS(hostId, peerId);
}

function connectLocally(hostId: string, peerId: string): Promise<IDataChannel> {
    return new Promise((resolve, reject) => {
        if (typeof BroadcastChannel === 'undefined') {
            reject(new Error('BroadcastChannel unavailable'));
            return;
        }

        const localSig = new BroadcastChannel(`gone-sig-${hostId}`);
        let settled = false;
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            localSig.close();
            reject(new Error('Local host handshake timed out'));
        }, 700);

        localSig.onmessage = (ev) => {
            const msg = ev.data;
            if (msg?.type !== 'PEER_ACCEPT' || msg.peerId !== peerId || settled) return;
            settled = true;
            clearTimeout(timer);
            localSig.close();
            resolve(new MockBroadcastChannel(msg.channelName));
        };

        localSig.postMessage({ type: 'PEER_CONNECT', peerId });
    });
}

function connectViaPeerJS(hostId: string, peerId: string): Promise<IDataChannel> {
    return new Promise((resolve, reject) => {
        const peer = new Peer(peerId, buildPeerOptions());
        let settled = false;
        let connection: DataConnection | null = null;

        const timeout = setTimeout(() => {
            if (settled) return;
            settled = true;
            try { connection?.close(); } catch { /* no-op */ }
            if (!peer.destroyed) peer.destroy();
            reject(new Error('Timeout durante la connessione WebRTC all\'host'));
        }, WEBRTC_CONNECT_TIMEOUT_MS);

        const fail = (err: unknown) => {
            if (settled) return;
            settled = true;
            clearTimeout(timeout);
            try { connection?.close(); } catch { /* no-op */ }
            if (!peer.destroyed) peer.destroy();
            reject(err instanceof Error ? err : new Error(String(err)));
        };

        peer.on('open', () => {
            connection = peer.connect(hostId, {
                reliable: false,
                serialization: 'none',
                metadata: { game: 'gone', version: 1 },
            });

            connection.on('open', () => {
                if (settled || !connection) return;
                settled = true;
                clearTimeout(timeout);
                resolve(new PeerJsDataChannel(connection, peer, true));
            });

            connection.on('error', fail);
            connection.on('close', () => {
                if (!settled) fail(new Error('DataChannel chiuso prima della connessione'));
            });
        });

        peer.on('error', fail);
    });
}

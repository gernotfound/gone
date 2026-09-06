import type { IDataChannel } from './protocol.ts';
import { P2PHost } from './p2pHost.ts';
import { Peer, type DataConnection } from 'peerjs';

// ---------------------------------------------------------------------------
// PeerJsDataChannel: wrapper intorno a DataConnection di PeerJS
// ---------------------------------------------------------------------------
export class PeerJsDataChannel implements IDataChannel {
    public binaryType?: 'blob' | 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;
    public readyState: string = 'connecting';
    
    private conn: DataConnection;

    constructor(conn: DataConnection) {
        this.conn = conn;

        this.conn.on('open', () => {
            this.readyState = 'open';
            if (this.onopen) this.onopen();
        });

        this.conn.on('close', () => {
            this.readyState = 'closed';
            if (this.onclose) this.onclose();
        });

        this.conn.on('error', (err: any) => {
            if (this.onerror) this.onerror(err);
        });

        this.conn.on('data', (data: any) => {
            if (this.onmessage) this.onmessage({ data });
        });

        if (this.conn.open) {
            this.readyState = 'open';
            setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
        }
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.readyState === 'open') {
            this.conn.send(data);
        }
    }

    close(): void {
        this.conn.close();
        this.readyState = 'closed';
    }
}

// ---------------------------------------------------------------------------
// MockBroadcastChannel: usato come fallback per test locali (stesso browser)
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
        this.bc.onmessage = (ev) => {
            if (this.onmessage) this.onmessage(ev);
        };
        setTimeout(() => {
            if (this.onopen) this.onopen();
        }, 10);
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        this.bc.postMessage(data);
    }

    close(): void {
        this.readyState = 'closed';
        this.bc.close();
        if (this.onclose) this.onclose();
    }
}

// ---------------------------------------------------------------------------
// Utility: rilevazione se siamo su stesso device (stesso origin, stesso browser)
// Usa BroadcastChannel locale: se l'host risponde entro 200ms siamo locali.
// ---------------------------------------------------------------------------
async function isLocalHost(hostId: string): Promise<boolean> {
    return new Promise((resolve) => {
        const probeCh = new BroadcastChannel(`gone-probe-${hostId}`);
        let resolved = false;
        probeCh.onmessage = (ev) => {
            if (ev.data?.type === 'PROBE_ACK') {
                resolved = true;
                probeCh.close();
                resolve(true);
            }
        };
        probeCh.postMessage({ type: 'PROBE' });
        setTimeout(() => {
            if (!resolved) {
                probeCh.close();
                resolve(false);
            }
        }, 200);
    });
}

// ---------------------------------------------------------------------------
// HOST SIGNALING
// ---------------------------------------------------------------------------
export function startHostSignaling(hostId: string, p2pHost: P2PHost): void {
    // ---- Fallback locale: BroadcastChannel (stesso browser) ----
    const localSig = new BroadcastChannel(`gone-sig-${hostId}`);
    const localProbe = new BroadcastChannel(`gone-probe-${hostId}`);
    const registeredLocalPeers = new Set<string>();

    localProbe.onmessage = (ev) => {
        if (ev.data?.type === 'PROBE') {
            localProbe.postMessage({ type: 'PROBE_ACK' });
        }
    };

    localSig.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'PEER_CONNECT' && !registeredLocalPeers.has(msg.peerId)) {
            registeredLocalPeers.add(msg.peerId);
            const dataChannelName = `gone-data-${hostId}-${msg.peerId}`;
            const channel = new MockBroadcastChannel(dataChannelName);
            p2pHost.registerPeer(msg.peerId, channel);
            localSig.postMessage({
                type: 'PEER_ACCEPT',
                peerId: msg.peerId,
                channelName: dataChannelName,
            });
        }
    };

    // ---- PeerJS WebRTC per cross-device ----
    const peer = new Peer(hostId);
    
    peer.on('open', (id) => {
        console.log(`[Host] PeerJS host registered with ID: ${id}`);
    });

    peer.on('connection', (conn) => {
        const peerId = conn.peer;
        const channel = new PeerJsDataChannel(conn);
        p2pHost.registerPeer(peerId, channel);
    });

    peer.on('error', (err) => {
        console.error('[Host] PeerJS Error:', err);
    });

    (p2pHost as any).__stopHostSignaling = () => {
        localSig.close();
        localProbe.close();
        peer.destroy();
    };
}

// ---------------------------------------------------------------------------
// CLIENT SIGNALING
// ---------------------------------------------------------------------------
export function connectClientSignaling(hostId: string, peerId: string): Promise<IDataChannel> {
    return new Promise(async (resolve, reject) => {
        // Prima tenta connessione locale via BroadcastChannel (stesso browser)
        const isLocal = await isLocalHost(hostId);

        if (isLocal) {
            // Connessione locale: usa BroadcastChannel
            let resolvedLocal = false;
            const localSig = new BroadcastChannel(`gone-sig-${hostId}`);
            localSig.onmessage = (ev) => {
                const msg = ev.data;
                if (msg.type === 'PEER_ACCEPT' && msg.peerId === peerId && !resolvedLocal) {
                    resolvedLocal = true;
                    localSig.close();
                    resolve(new MockBroadcastChannel(msg.channelName));
                }
            };
            localSig.postMessage({ type: 'PEER_CONNECT', peerId });

            // Timeout fallback a WebRTC
            setTimeout(() => {
                if (!resolvedLocal) {
                    localSig.close();
                    connectViaPeerJS(hostId, peerId).then(resolve).catch(reject);
                }
            }, 300);
        } else {
            // Connessione cross-device: usa PeerJS
            connectViaPeerJS(hostId, peerId).then(resolve).catch(reject);
        }
    });
}

function connectViaPeerJS(hostId: string, peerId: string): Promise<IDataChannel> {
    return new Promise((resolve, reject) => {
        const peer = new Peer(peerId);
        
        peer.on('open', () => {
            // Connessi al signaling server, ora mi connetto all'host
            const conn = peer.connect(hostId, {
                reliable: false, 
                serialization: 'none'
            });
            
            const channel = new PeerJsDataChannel(conn);
            
            // Risolviamo subito, il channel poi lancerà onopen
            resolve(channel);
        });

        peer.on('error', (err) => {
            console.error('[Client] PeerJS Error:', err);
            reject(err);
        });
    });
}

import type { IDataChannel } from './protocol.ts';
import { P2PHost } from './p2pHost.ts';

/**
 * Legacy same-origin transport used only for local multi-tab development.
 *
 * Production/friends multiplayer lives in directWebRtc.ts and creates a
 * dedicated native RTCPeerConnection for every guest. This module deliberately
 * contains no PeerJS, STUN, TURN, signaling SaaS, or remote network endpoint.
 */
export class MockBroadcastChannel implements IDataChannel {
    private bc: BroadcastChannel;
    public binaryType?: 'blob' | 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;
    public readyState = 'open';

    constructor(channelName: string) {
        if (typeof BroadcastChannel === 'undefined') {
            throw new Error('BroadcastChannel non disponibile in questo browser.');
        }
        this.bc = new BroadcastChannel(channelName);
        this.bc.onmessage = (ev) => this.onmessage?.(ev);
        queueMicrotask(() => this.onopen?.());
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.readyState !== 'open') throw new Error('BroadcastChannel chiuso.');
        this.bc.postMessage(data);
    }

    close(): void {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.bc.close();
        this.onclose?.();
    }
}

/**
 * Backward-compatible local signaling for old tests/dev flows. It can connect
 * tabs/windows on the same origin and device only; it never accesses Internet
 * infrastructure. New multiplayer UI does not use this path.
 */
export function startHostSignaling(hostId: string, p2pHost: P2PHost): void {
    if (typeof BroadcastChannel === 'undefined') {
        p2pHost.options.onError?.(new Error('BroadcastChannel non disponibile.'));
        return;
    }

    const signal = new BroadcastChannel(`gone-sig-${hostId}`);
    const probe = new BroadcastChannel(`gone-probe-${hostId}`);
    const registered = new Set<string>();

    probe.onmessage = (ev) => {
        if (ev.data?.type === 'PROBE') probe.postMessage({ type: 'PROBE_ACK' });
    };

    signal.onmessage = (ev) => {
        const msg = ev.data;
        if (msg?.type !== 'PEER_CONNECT' || typeof msg.peerId !== 'string' || registered.has(msg.peerId)) return;
        registered.add(msg.peerId);
        const channelName = `gone-data-${hostId}-${msg.peerId}`;
        const channel = new MockBroadcastChannel(channelName);
        p2pHost.registerPeer(msg.peerId, channel);
        signal.postMessage({ type: 'PEER_ACCEPT', peerId: msg.peerId, channelName });
    };

    (p2pHost as any).__stopHostSignaling = () => {
        signal.close();
        probe.close();
    };
}

export async function connectClientSignaling(hostId: string, peerId: string): Promise<IDataChannel> {
    if (typeof BroadcastChannel === 'undefined') {
        throw new Error('Connessione locale non disponibile. Usa l’invito WebRTC diretto.');
    }

    return new Promise<IDataChannel>((resolve, reject) => {
        const signal = new BroadcastChannel(`gone-sig-${hostId}`);
        let settled = false;
        const timeout = window.setTimeout(() => {
            if (settled) return;
            settled = true;
            signal.close();
            reject(new Error('Host locale non trovato. Usa l’invito WebRTC diretto.'));
        }, 1000);

        signal.onmessage = (ev) => {
            const msg = ev.data;
            if (settled || msg?.type !== 'PEER_ACCEPT' || msg.peerId !== peerId || typeof msg.channelName !== 'string') return;
            settled = true;
            clearTimeout(timeout);
            signal.close();
            resolve(new MockBroadcastChannel(msg.channelName));
        };

        signal.postMessage({ type: 'PEER_CONNECT', peerId });
    });
}

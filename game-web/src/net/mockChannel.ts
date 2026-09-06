import type { IDataChannel } from './protocol.ts';
import { P2PHost } from './p2pHost.ts';

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
            if (this.onmessage) {
                this.onmessage(ev);
            }
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

// Simulated signaling
export function startHostSignaling(hostId: string, p2pHost: P2PHost) {
    const sigChannel = new BroadcastChannel(`gone-sig-${hostId}`);
    sigChannel.onmessage = (ev) => {
        const msg = ev.data;
        if (msg.type === 'PEER_CONNECT') {
            const peerId = msg.peerId;
            const dataChannelName = `gone-data-${hostId}-${peerId}`;
            const channel = new MockBroadcastChannel(dataChannelName);
            p2pHost.registerPeer(peerId, channel);
            
            sigChannel.postMessage({
                type: 'PEER_ACCEPT',
                peerId: peerId,
                channelName: dataChannelName
            });
        }
    };
    return sigChannel;
}

export function connectClientSignaling(hostId: string, peerId: string): Promise<MockBroadcastChannel> {
    return new Promise((resolve) => {
        const sigChannel = new BroadcastChannel(`gone-sig-${hostId}`);
        sigChannel.onmessage = (ev) => {
            const msg = ev.data;
            if (msg.type === 'PEER_ACCEPT' && msg.peerId === peerId) {
                const channel = new MockBroadcastChannel(msg.channelName);
                sigChannel.close();
                resolve(channel);
            }
        };
        sigChannel.postMessage({
            type: 'PEER_CONNECT',
            peerId: peerId
        });
    });
}

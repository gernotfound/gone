import type { IDataChannel } from './protocol.ts';
import { P2PHost } from './p2pHost.ts';

// ---------------------------------------------------------------------------
// URL dell'endpoint di signaling Vercel (relativo: funziona su qualsiasi dominio)
// ---------------------------------------------------------------------------
const SIGNAL_BASE = '/api/signal';

// ICE servers STUN pubblici gratuiti
const ICE_SERVERS: RTCIceServer[] = [
    { urls: 'stun:stun.l.google.com:19302' },
    { urls: 'stun:stun1.l.google.com:19302' },
    { urls: 'stun:stun.cloudflare.com:3478' },
];

// ---------------------------------------------------------------------------
// WebRtcDataChannel: wrapper intorno a RTCDataChannel che implementa IDataChannel
// ---------------------------------------------------------------------------
export class WebRtcDataChannel implements IDataChannel {
    public binaryType?: 'blob' | 'arraybuffer' = 'arraybuffer';
    public onmessage?: ((ev: { data: any }) => void) | null;
    public onopen?: (() => void) | null;
    public onclose?: (() => void) | null;
    public onerror?: ((err: any) => void) | null;
    public readyState: string = 'connecting';

    private channel: RTCDataChannel;
    private pc: RTCPeerConnection;

    constructor(pc: RTCPeerConnection, channel: RTCDataChannel) {
        this.pc = pc;
        this.channel = channel;
        this.channel.binaryType = 'arraybuffer';

        this.channel.onopen = () => {
            this.readyState = 'open';
            if (this.onopen) this.onopen();
        };
        this.channel.onclose = () => {
            this.readyState = 'closed';
            if (this.onclose) this.onclose();
        };
        this.channel.onerror = (err) => {
            if (this.onerror) this.onerror(err);
        };
        this.channel.onmessage = (ev) => {
            if (this.onmessage) this.onmessage(ev);
        };

        // Se già aperto (caso raro)
        if (this.channel.readyState === 'open') {
            this.readyState = 'open';
            setTimeout(() => { if (this.onopen) this.onopen(); }, 0);
        }
    }

    send(data: string | ArrayBuffer | ArrayBufferView): void {
        if (this.channel.readyState === 'open') {
            this.channel.send(data as any);
        }
    }

    close(): void {
        this.channel.close();
        this.pc.close();
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
    // Registra l'host sul server HTTP
    fetch(`${SIGNAL_BASE}?action=host_register&hostId=${encodeURIComponent(hostId)}`, {
        method: 'POST',
    }).catch(err => console.warn('[Signaling] host_register error:', err));

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

    // ---- Polling HTTP: WebRTC per cross-device ----
    const handledPeers = new Set<string>();
    let pollingActive = true;

    const pollOffers = async () => {
        if (!pollingActive) return;
        try {
            const res = await fetch(`${SIGNAL_BASE}?action=poll_offers&hostId=${encodeURIComponent(hostId)}`);
            if (res.ok) {
                const data = await res.json() as { offers: Array<{ peerId: string; sdp: string }> };
                for (const { peerId, sdp } of data.offers) {
                    if (handledPeers.has(peerId)) continue;
                    handledPeers.add(peerId);
                    handleIncomingOffer(hostId, peerId, sdp, p2pHost);
                }
            }
        } catch (_) { /* ignora errori transienti */ }
        if (pollingActive) setTimeout(pollOffers, 600);
    };

    pollOffers();

    (p2pHost as any).__stopHostSignaling = () => {
        pollingActive = false;
        localSig.close();
        localProbe.close();
    };
}

async function handleIncomingOffer(hostId: string, peerId: string, offerSdp: string, p2pHost: P2PHost) {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });

    // Manda ICE candidates via HTTP
    pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
            try {
                await fetch(
                    `${SIGNAL_BASE}?action=host_ice&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ candidate: ev.candidate }),
                    }
                );
            } catch (_) {}
        }
    };

    // Gestisci il DataChannel in arrivo
    pc.ondatachannel = (ev) => {
        const dc = ev.channel;
        const channel = new WebRtcDataChannel(pc, dc);
        p2pHost.registerPeer(peerId, channel);
    };

    // Applica offer e crea answer
    await pc.setRemoteDescription({ type: 'offer', sdp: offerSdp });
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);

    // Invia answer
    await fetch(
        `${SIGNAL_BASE}?action=host_answer&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: answer.sdp }),
        }
    );

    // Polling ICE candidates del client
    let icePollActive = true;
    const pollClientIce = async () => {
        if (!icePollActive) return;
        try {
            const res = await fetch(
                `${SIGNAL_BASE}?action=poll_client_ice&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`
            );
            if (res.ok) {
                const data = await res.json() as { candidates: RTCIceCandidateInit[] };
                for (const candidate of data.candidates) {
                    try { await pc.addIceCandidate(candidate); } catch (_) {}
                }
            }
        } catch (_) {}
        if (icePollActive && pc.connectionState !== 'connected') {
            setTimeout(pollClientIce, 600);
        } else {
            icePollActive = false;
        }
    };
    pollClientIce();
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
                    connectViaWebRTC(hostId, peerId).then(resolve).catch(reject);
                }
            }, 300);
        } else {
            // Connessione cross-device: usa WebRTC
            connectViaWebRTC(hostId, peerId).then(resolve).catch(reject);
        }
    });
}

async function connectViaWebRTC(hostId: string, peerId: string): Promise<IDataChannel> {
    const pc = new RTCPeerConnection({ iceServers: ICE_SERVERS });
    const dc = pc.createDataChannel('gone', { ordered: false, maxRetransmits: 0 });
    const channel = new WebRtcDataChannel(pc, dc);

    // Manda ICE candidates via HTTP
    pc.onicecandidate = async (ev) => {
        if (ev.candidate) {
            try {
                await fetch(
                    `${SIGNAL_BASE}?action=client_ice&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`,
                    {
                        method: 'POST',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ candidate: ev.candidate }),
                    }
                );
            } catch (_) {}
        }
    };

    // Crea offer
    const offer = await pc.createOffer();
    await pc.setLocalDescription(offer);

    // Invia offer al server
    await fetch(
        `${SIGNAL_BASE}?action=client_offer&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`,
        {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ sdp: offer.sdp }),
        }
    );

    // Polling per la answer dell'host
    const maxPolls = 60;
    let pollCount = 0;

    await new Promise<void>((resolveAnswer, rejectAnswer) => {
        const pollAnswer = async () => {
            if (pollCount >= maxPolls) {
                rejectAnswer(new Error('Timeout: host non risponde'));
                return;
            }
            pollCount++;
            try {
                const res = await fetch(
                    `${SIGNAL_BASE}?action=poll_answer&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`
                );
                if (res.ok) {
                    const data = await res.json() as { answer: string | null };
                    if (data.answer) {
                        await pc.setRemoteDescription({ type: 'answer', sdp: data.answer });
                        resolveAnswer();
                        return;
                    }
                }
            } catch (_) {}
            setTimeout(pollAnswer, 500);
        };
        pollAnswer();
    });

    // Polling ICE candidates dell'host
    let icePollActive = true;
    const pollHostIce = async () => {
        if (!icePollActive) return;
        try {
            const res = await fetch(
                `${SIGNAL_BASE}?action=poll_host_ice&hostId=${encodeURIComponent(hostId)}&peerId=${encodeURIComponent(peerId)}`
            );
            if (res.ok) {
                const data = await res.json() as { candidates: RTCIceCandidateInit[] };
                for (const candidate of data.candidates) {
                    try { await pc.addIceCandidate(candidate); } catch (_) {}
                }
            }
        } catch (_) {}
        if (icePollActive && pc.connectionState !== 'connected') {
            setTimeout(pollHostIce, 600);
        } else {
            icePollActive = false;
        }
    };
    pollHostIce();

    return channel;
}

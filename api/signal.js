/**
 * G.O.N.E. Signaling Server (Vercel Serverless Function)
 * 
 * Endpoint: /api/signal
 * Gestisce lo scambio di offerte/risposte WebRTC SDP + ICE candidates
 * tra host e client per stabilire una connessione P2P reale.
 *
 * Non usa DB: store in-memory (TTL 120s).
 * Funziona con Vercel Edge Runtime.
 */

// Store globale in-memory
// { [hostId]: { ts, peers: Map { [peerId]: { offer, answer, hostIce[], clientIce[], channelName } } } }
const store = new Map();
const TTL_MS = 120_000;

function cleanup() {
    const now = Date.now();
    for (const [k, v] of store.entries()) {
        if (now - v.ts > TTL_MS) store.delete(k);
    }
}

function json(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
            'Cache-Control': 'no-store',
        }
    });
}

export default async function handler(req) {
    if (req.method === 'OPTIONS') {
        return new Response(null, {
            status: 204,
            headers: {
                'Access-Control-Allow-Origin': '*',
                'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
                'Access-Control-Allow-Headers': 'Content-Type',
            }
        });
    }

    cleanup();

    const url = new URL(req.url, 'https://placeholder.vercel.app');
    const action = url.searchParams.get('action');
    const hostId = url.searchParams.get('hostId');
    const peerId = url.searchParams.get('peerId');

    if (!action || !hostId) return json({ error: 'Missing params' }, 400);

    // === HOST: si registra ===
    if (action === 'host_register' && req.method === 'POST') {
        if (!store.has(hostId)) {
            store.set(hostId, { ts: Date.now(), peers: new Map() });
        } else {
            store.get(hostId).ts = Date.now();
        }
        return json({ ok: true });
    }

    // === CLIENT: invia la propria offer SDP ===
    if (action === 'client_offer' && req.method === 'POST') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ error: 'Host not found' }, 404);

        const body = await req.json();
        if (!host.peers.has(peerId)) {
            host.peers.set(peerId, {
                offer: body.sdp,
                answer: null,
                hostIce: [],
                clientIce: [],
            });
        } else {
            host.peers.get(peerId).offer = body.sdp;
        }
        host.ts = Date.now();
        return json({ ok: true });
    }

    // === HOST: fa polling per nuove offer ===
    if (action === 'poll_offers' && req.method === 'GET') {
        const host = store.get(hostId);
        if (!host) return json({ offers: [] });

        const offers = [];
        for (const [pid, peerEntry] of host.peers.entries()) {
            if (peerEntry.offer && !peerEntry.answer) {
                offers.push({ peerId: pid, sdp: peerEntry.offer });
            }
        }
        return json({ offers });
    }

    // === HOST: invia la propria answer SDP ===
    if (action === 'host_answer' && req.method === 'POST') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ error: 'Host not found' }, 404);
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ error: 'Peer not found' }, 404);

        const body = await req.json();
        peerEntry.answer = body.sdp;
        host.ts = Date.now();
        return json({ ok: true });
    }

    // === CLIENT: fa polling per la answer ===
    if (action === 'poll_answer' && req.method === 'GET') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ answer: null });
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ answer: null });
        return json({ answer: peerEntry.answer });
    }

    // === HOST: invia ICE candidate per un peer ===
    if (action === 'host_ice' && req.method === 'POST') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ error: 'Host not found' }, 404);
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ error: 'Peer not found' }, 404);

        const body = await req.json();
        peerEntry.hostIce.push(body.candidate);
        host.ts = Date.now();
        return json({ ok: true });
    }

    // === CLIENT: invia ICE candidate ===
    if (action === 'client_ice' && req.method === 'POST') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ error: 'Host not found' }, 404);
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ error: 'Peer not found' }, 404);

        const body = await req.json();
        peerEntry.clientIce.push(body.candidate);
        host.ts = Date.now();
        return json({ ok: true });
    }

    // === HOST: fa polling ICE candidates del client ===
    if (action === 'poll_client_ice' && req.method === 'GET') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ candidates: [] });
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ candidates: [] });
        const candidates = [...peerEntry.clientIce];
        peerEntry.clientIce = [];
        return json({ candidates });
    }

    // === CLIENT: fa polling ICE candidates dell'host ===
    if (action === 'poll_host_ice' && req.method === 'GET') {
        if (!peerId) return json({ error: 'Missing peerId' }, 400);
        const host = store.get(hostId);
        if (!host) return json({ candidates: [] });
        const peerEntry = host.peers.get(peerId);
        if (!peerEntry) return json({ candidates: [] });
        const candidates = [...peerEntry.hostIce];
        peerEntry.hostIce = [];
        return json({ candidates });
    }

    return json({ error: 'Unknown action' }, 400);
}

export const config = {
    runtime: 'edge',
};

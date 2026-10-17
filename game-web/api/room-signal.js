// Short-code WebRTC rendezvous. SDP only; gameplay and authority stay in the host browser.
// Private Vercel Blob is the cross-instance store. No in-process room state.
import { createHash, randomInt, timingSafeEqual } from 'node:crypto';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_RE = /^[A-HJ-NP-Z2-9]{5}$/;
const ROOM_TTL_MS = 120_000;
const MAX_SIGNAL_LENGTH = 40_000;
const BLOB_API = 'https://vercel.com/api/blob';
const ROOT = 'gone-invites/';
const jsonHeaders = { 'Cache-Control': 'no-store, max-age=0', 'Content-Type': 'application/json; charset=utf-8' };

function error(res, status, code) { return res.status(status).json({ ok: false, error: code }); }
function secretHash(value) { return createHash('sha256').update(value).digest(); }
function ownsRoom(record, secret) {
  return typeof secret === 'string' && secret.length >= 32 && secret.length <= 128
    && timingSafeEqual(Buffer.from(record.hostHash, 'hex'), secretHash(secret));
}
function token() { return process.env.BLOB_READ_WRITE_TOKEN || ''; }
function storeId() { return token().split('_')[3] || ''; }
function resource(path) { return `https://${storeId()}.private.blob.vercel-storage.com/${path}?cache=0`; }
function roomPath(code, kind) { return `${ROOT}${code}/${kind}.json`; }

async function blobApi(path, init) {
  const response = await fetch(`${BLOB_API}${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token()}`,
      'x-api-version': '12',
      ...init.headers,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 409 || response.status === 412) return { collision: true };
  if (!response.ok) throw new Error(`blob_api_${response.status}`);
  const text = await response.text();
  return text ? JSON.parse(text) : {};
}
async function store(path, payload) {
  return blobApi(`/?pathname=${encodeURIComponent(path)}`, {
    method: 'PUT',
    headers: {
      'x-vercel-blob-access': 'private',
      'x-content-type': 'application/json',
      'x-allow-overwrite': '0',
      'x-cache-control-max-age': '60',
    },
    body: JSON.stringify(payload),
  });
}
async function load(path) {
  const response = await fetch(resource(path), {
    headers: { authorization: `Bearer ${token()}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`blob_read_${response.status}`);
  return response.json();
}
// Vercel Blob has no TTL primitive: records are logically expired at 120s,
 // and stale physical files are opportunistically removed during room creation.
async function sweepExpired() {
  const listing = await blobApi(`?prefix=${encodeURIComponent(ROOT)}&limit=100`, { method: 'GET', headers: {} });
  const stale = (listing.blobs || [])
    .filter((entry) => Date.now() - Date.parse(entry.uploadedAt) > 5 * 60_000)
    .map((entry) => entry.pathname);
  if (stale.length) await remove(stale);
}

async function remove(paths) {
  await blobApi('/delete', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ urls: paths }),
  });
}
function roomCode() {
  return Array.from({ length: 5 }, () => ALPHABET[randomInt(ALPHABET.length)]).join('');
}
function signal(value, type, connectionId = null) {
  if (typeof value !== 'string' || value.length < 40 || value.length > MAX_SIGNAL_LENGTH || !/^[A-Za-z0-9_-]+$/.test(value)) return false;
  try {
    const parsed = JSON.parse(Buffer.from(value, 'base64url').toString('utf8'));
    return parsed?.v === 1 && parsed?.type === type
      && typeof parsed.sdp === 'string' && parsed.sdp.length >= 20 && parsed.sdp.length <= 28_000
      && typeof parsed.connectionId === 'string' && parsed.connectionId.length >= 8 && parsed.connectionId.length <= 100
      && (connectionId === null || parsed.connectionId === connectionId)
      && (type !== 'answer' || (typeof parsed.peerId === 'string' && parsed.peerId.length >= 3 && parsed.peerId.length <= 100));
  } catch { return false; }
}
function parseBody(req) {
  if (typeof req.body === 'string') { try { return JSON.parse(req.body); } catch { return {}; } }
  return req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? req.body : {};
}
function validCode(value) { return typeof value === 'string' && CODE_RE.test(value); }

export default async function handler(req, res) {
  for (const [key, value] of Object.entries(jsonHeaders)) res.setHeader(key, value);
  if (req.method !== 'POST') { res.setHeader('Allow', 'POST'); return error(res, 405, 'method_not_allowed'); }
  const length = Number(req.headers['content-length'] || 0);
  if (length > 90_000) return error(res, 413, 'payload_too_large');
  const input = parseBody(req);
  if (!token() || !storeId()) return error(res, 503, 'rendezvous_not_configured');
  const operation = input.operation;
  const code = input.code;
  if (operation !== 'create' && !validCode(code)) return error(res, 400, 'invalid_code');

  try {
    if (operation === 'create') {
      if (!signal(input.offer, 'offer') || typeof input.hostSecret !== 'string' || input.hostSecret.length < 32 || input.hostSecret.length > 128) {
        return error(res, 400, 'invalid_offer');
      }
      const decoded = JSON.parse(Buffer.from(input.offer, 'base64url').toString('utf8'));
      // Cleanup is best-effort and must not make a new invitation unavailable.
      try { await sweepExpired(); } catch (cleanupError) {
        console.warn('[G.O.N.E. signaling] stale cleanup unavailable:', cleanupError instanceof Error ? cleanupError.message : 'unknown');
      }
      const expiresAt = Date.now() + ROOM_TTL_MS;
      for (let attempt = 0; attempt < 7; attempt += 1) {
        const selected = roomCode();
        const created = await store(roomPath(selected, 'offer'), {
          offer: input.offer,
          connectionId: decoded.connectionId,
          hostHash: secretHash(input.hostSecret).toString('hex'),
          expiresAt,
        });
        if (created.collision) continue;
        return res.status(201).json({ ok: true, code: selected, expiresAt });
      }
      return error(res, 503, 'room_capacity');
    }

    const record = await load(roomPath(code, 'offer'));
    if (!record) return error(res, 404, 'room_not_found');
    if (operation === 'close') {
      if (!ownsRoom(record, input.hostSecret)) return error(res, 403, 'invalid_host');
      await remove([roomPath(code, 'offer'), roomPath(code, 'answer')]);
      return res.status(200).json({ ok: true });
    }
    if (!Number.isFinite(record.expiresAt) || Date.now() >= record.expiresAt) return error(res, 410, 'room_expired');

    if (operation === 'offer') {
      return res.status(200).json({ ok: true, offer: record.offer, expiresAt: record.expiresAt });
    }
    if (operation === 'answer') {
      if (!signal(input.answer, 'answer', record.connectionId)) return error(res, 400, 'invalid_answer');
      const saved = await store(roomPath(code, 'answer'), { answer: input.answer });
      if (saved.collision) return error(res, 409, 'room_already_claimed');
      return res.status(201).json({ ok: true });
    }
    if (operation === 'poll') {
      if (!ownsRoom(record, input.hostSecret)) return error(res, 403, 'invalid_host');
      const answer = await load(roomPath(code, 'answer'));
      return res.status(200).json({ ok: true, answer: answer?.answer ?? null, expiresAt: record.expiresAt });
    }
    return error(res, 400, 'invalid_operation');
  } catch (cause) {
    console.error('[G.O.N.E. signaling] unavailable:', cause instanceof Error ? cause.message : 'unknown');
    return error(res, 503, 'rendezvous_unavailable');
  }
}

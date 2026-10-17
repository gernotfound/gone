import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import roomHandler from '../../game-web/api/room-signal.js';

export async function run(suite) {
  suite.test('Short-code API enforces private single-use SDP exchange, expiry and owner permissions', async () => {
const previousToken = process.env.BLOB_READ_WRITE_TOKEN;
process.env.BLOB_READ_WRITE_TOKEN = 'vercel_blob_rw_TESTSTORE_test';
const originalFetch = globalThis.fetch;
const originalNow = Date.now;
const data = new Map();
let operations = 0;

function response(code, body = {}) {
  return new Response(JSON.stringify(body), { status: code, headers: { 'content-type': 'application/json' } });
}
globalThis.fetch = async (input, init) => {
  operations += 1;
  const url = new URL(input);
  if (url.hostname === 'vercel.com') {
    if (init.method === 'GET') {
      return response(200, { blobs: [...data].map(([pathname]) => ({
        pathname, uploadedAt: new Date().toISOString(),
      })) });
    }
    if (init.method === 'PUT') {
      const path = url.searchParams.get('pathname');
      if (data.has(path)) return response(409, { error: { code: 'blob_already_exists' } });
      data.set(path, JSON.parse(init.body));
      return response(200, { pathname: path });
    }
    if (url.pathname.endsWith('/delete')) {
      for (const p of JSON.parse(init.body).urls) data.delete(p);
      return response(200, {});
    }
  }
  if (url.hostname.endsWith('.private.blob.vercel-storage.com')) {
    const path = url.pathname.slice(1);
    if (!data.has(path)) return response(404);
    return response(200, data.get(path));
  }
  throw new Error('Unexpected Blob API operation ' + url.href);
};

async function call(body, method = 'POST') {
  const headers = {};
  let status = 200;
  const res = {
    setHeader(name, value) { headers[name.toLowerCase()] = value; },
    status(value) { status = value; return this; },
    json(value) { return { status, headers, body: value }; },
  };
  return roomHandler({ method, headers: {}, body }, res);
}

function encoded(type, connectionId, peerId) {
  const value = { v: 1, type, connectionId, sdp: 'v=0\r\na=candidate:42 1 udp 11 127.0.0.1 4566 typ host\r\n' };
  if (peerId) value.peerId = peerId;
  return Buffer.from(JSON.stringify(value)).toString('base64url');
}

try {
  const offer = encoded('offer', 'direct-123456789abcdef0');
  const answer = encoded('answer', 'direct-123456789abcdef0', 'guest-123456789');
  let result = await call({ operation: 'create', hostSecret: 'S'.repeat(64), offer });
  assert.equal(result.status, 201);
  assert.match(result.body.code, /^[A-HJ-NP-Z2-9]{5}$/);
  assert.equal(result.headers['cache-control'], 'no-store, max-age=0');
  const room = result.body.code;
  const known = data.get('gone-invites/' + room + '/offer.json');
  assert.ok(known.hostHash);
  assert.ok(!JSON.stringify(known).includes('S'.repeat(64)));

  result = await call({ operation: 'offer', code: room });
  assert.equal(result.status, 200);
  assert.equal(result.body.offer, offer);
  assert.equal(result.body.hostSecret, undefined);

  result = await call({ operation: 'poll', code: room, hostSecret: 'H'.repeat(64) });
  assert.equal(result.status, 403, 'non-host must not read the guest answer');

  result = await call({ operation: 'answer', code: room, answer: encoded('answer', 'direct-otherconnection', 'guest-abc') });
  assert.equal(result.status, 400, 'answer must match the offered connection');
  result = await call({ operation: 'answer', code: room, answer });
  assert.equal(result.status, 201);
  result = await call({ operation: 'answer', code: room, answer });
  assert.equal(result.status, 409, 'only the first guest may claim a code');
  result = await call({ operation: 'poll', code: room, hostSecret: 'S'.repeat(64) });
  assert.equal(result.status, 200);
  assert.equal(result.body.answer, answer);
  result = await call({ operation: 'close', code: room, hostSecret: 'S'.repeat(64) });
  assert.equal(result.status, 200);
  result = await call({ operation: 'offer', code: room });
  assert.equal(result.status, 404);

  result = await call({ operation: 'offer', code: '%%%%%' });
  assert.equal(result.status, 400);
  const before = operations;
  result = await call({ operation: 'create', hostSecret: 'x', offer });
  assert.equal(result.status, 400);
  assert.equal(operations, before);

  result = await call({ operation: 'create', hostSecret: 'S'.repeat(64), offer });
  const expiringCode = result.body.code;
  Date.now = () => result.body.expiresAt + 1;
  assert.equal((await call({ operation: 'offer', code: expiringCode })).status, 410);
  assert.equal((await call({ operation: 'answer', code: expiringCode, answer })).status, 410);
  Date.now = originalNow;

  process.env.BLOB_READ_WRITE_TOKEN = '';
  result = await call({ operation: 'create', hostSecret: 'S'.repeat(64), offer });
  assert.equal(result.status, 503, 'missing storage must fail closed');
  console.log('[room-signaling] PASS: private code, single guest, host auth, expiry, validation, missing storage');
} finally {
  globalThis.fetch = originalFetch;
  Date.now = originalNow;
  if (previousToken === undefined) delete process.env.BLOB_READ_WRITE_TOKEN;
  else process.env.BLOB_READ_WRITE_TOKEN = previousToken;
}
  });
}

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { extname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { networkInterfaces } from 'node:os';
import { randomBytes } from 'node:crypto';
import { spawn } from 'node:child_process';
import { WebSocket, WebSocketServer } from 'ws';

const HERE = resolve(fileURLToPath(new URL('.', import.meta.url)));
const DIST = resolve(HERE, '../game-web/dist');
const RELAY_PATH = '/__gone_host/ws';
const STATUS_PATH = '/__gone_host/status';
const MAX_GUESTS = 7;
const RELAY_PROTOCOL_VERSION = 1;

function readArg(name, fallback = null) {
  const exact = process.argv.find((arg) => arg.startsWith(`${name}=`));
  if (exact) return exact.slice(name.length + 1);
  const index = process.argv.indexOf(name);
  if (index >= 0 && process.argv[index + 1] && !process.argv[index + 1].startsWith('--')) return process.argv[index + 1];
  return fallback;
}

const port = Number(readArg('--port', process.env.GONE_PORT || '7777'));
const bindHost = readArg('--bind', process.env.GONE_BIND || '0.0.0.0');
const disableUpnp = process.argv.includes('--no-upnp') || process.env.GONE_NO_UPNP === '1';
const disableOpen = process.argv.includes('--no-open') || process.env.GONE_NO_OPEN === '1';
const token = process.env.GONE_TOKEN || randomBytes(24).toString('base64url');

if (!Number.isInteger(port) || port < 1024 || port > 65535) {
  console.error('[G.O.N.E. Host] Porta non valida. Usa --port 7777 (1024-65535).');
  process.exit(2);
}

const MIME = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.wasm', 'application/wasm'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.svg', 'image/svg+xml'],
  ['.glb', 'model/gltf-binary'],
  ['.mp3', 'audio/mpeg'],
  ['.wav', 'audio/wav'],
  ['.ogg', 'audio/ogg'],
]);

function firstLanIpv4() {
  for (const entries of Object.values(networkInterfaces())) {
    for (const entry of entries || []) {
      if (entry.family === 'IPv4' && !entry.internal && entry.address && !entry.address.startsWith('169.254.')) {
        return entry.address;
      }
    }
  }
  return '127.0.0.1';
}

function isLoopback(address = '') {
  const normalized = address.replace(/^::ffff:/, '');
  return normalized === '::1' || normalized.startsWith('127.');
}

function ipv4Number(ip) {
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4 || parts.some((v) => !Number.isInteger(v) || v < 0 || v > 255)) return null;
  return (((parts[0] << 24) >>> 0) + (parts[1] << 16) + (parts[2] << 8) + parts[3]) >>> 0;
}

function isNonPublicIpv4(ip) {
  const n = ipv4Number(ip);
  if (n === null) return false;
  const inRange = (base, bits) => {
    const mask = bits === 0 ? 0 : (0xffffffff << (32 - bits)) >>> 0;
    return (n & mask) === (ipv4Number(base) & mask);
  };
  return inRange('10.0.0.0', 8)
    || inRange('172.16.0.0', 12)
    || inRange('192.168.0.0', 16)
    || inRange('100.64.0.0', 10)
    || inRange('127.0.0.0', 8)
    || inRange('169.254.0.0', 16);
}

function inviteFor(hostname) {
  const url = new URL(`http://${hostname}:${port}/`);
  url.searchParams.set('goneHost', 'guest');
  url.searchParams.set('token', token);
  return url.toString();
}

const lanIp = firstLanIpv4();
let mapped = false;
let cgnat = false;
let externalIp = null;
let natGateway = null;

function currentStatus() {
  return {
    version: '0.3.0',
    port,
    mapped,
    cgnat,
    lanIp,
    externalIp,
    lanInviteUrl: inviteFor(lanIp),
    publicInviteUrl: mapped && externalIp && !cgnat ? inviteFor(externalIp) : null,
  };
}

async function ensureDist() {
  try {
    const info = await stat(resolve(DIST, 'index.html'));
    if (!info.isFile()) throw new Error('index.html missing');
  } catch {
    console.error('[G.O.N.E. Host] game-web/dist non trovato. Prima esegui: npm run build --prefix game-web');
    process.exit(3);
  }
}

async function serveStatic(req, res) {
  const requestUrl = new URL(req.url || '/', 'http://localhost');
  if (requestUrl.pathname === STATUS_PATH) {
    res.writeHead(200, {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
    });
    res.end(JSON.stringify(currentStatus()));
    return;
  }

  let pathname;
  try {
    pathname = decodeURIComponent(requestUrl.pathname);
  } catch {
    res.writeHead(400);
    res.end('Bad request');
    return;
  }

  if (pathname === '/') pathname = '/index.html';
  const candidate = resolve(DIST, `.${pathname}`);
  if (candidate !== DIST && !candidate.startsWith(`${DIST}${sep}`)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  let target = candidate;
  try {
    const info = await stat(target);
    if (!info.isFile()) throw new Error('not a file');
  } catch {
    if (extname(pathname)) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    target = resolve(DIST, 'index.html');
  }

  try {
    const body = await readFile(target);
    res.writeHead(200, {
      'content-type': MIME.get(extname(target).toLowerCase()) || 'application/octet-stream',
      'cache-control': target.endsWith('index.html') ? 'no-store' : 'public, max-age=3600',
      'x-content-type-options': 'nosniff',
      'referrer-policy': 'no-referrer',
    });
    res.end(body);
  } catch {
    res.writeHead(500);
    res.end('Internal server error');
  }
}

const server = createServer((req, res) => {
  serveStatic(req, res).catch((error) => {
    console.error('[G.O.N.E. Host] HTTP error', error);
    if (!res.headersSent) res.writeHead(500);
    res.end('Internal server error');
  });
});

const wss = new WebSocketServer({
  server,
  path: RELAY_PATH,
  perMessageDeflate: false,
  maxPayload: 512 * 1024,
});

let hostSocket = null;
const guests = new Map();

function sendJson(ws, value) {
  if (ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value));
}

function closeWithError(ws, message, code = 4000) {
  sendJson(ws, { type: 'error', message });
  try { ws.close(code, message.slice(0, 100)); } catch { /* no-op */ }
}

function encodeGuestFrame(peerId, payload) {
  const id = Buffer.from(peerId, 'utf8');
  if (id.length === 0 || id.length > 0xffff) return null;
  const body = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  const frame = Buffer.allocUnsafe(3 + id.length + body.length);
  frame[0] = RELAY_PROTOCOL_VERSION;
  frame.writeUInt16BE(id.length, 1);
  id.copy(frame, 3);
  body.copy(frame, 3 + id.length);
  return frame;
}

function decodeHostFrame(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length < 3 || buffer[0] !== RELAY_PROTOCOL_VERSION) return null;
  const idLength = buffer.readUInt16BE(1);
  if (idLength === 0 || 3 + idLength > buffer.length) return null;
  return {
    peerId: buffer.subarray(3, 3 + idLength).toString('utf8'),
    payload: buffer.subarray(3 + idLength),
  };
}

function cleanupGuest(peerId, ws) {
  if (guests.get(peerId) !== ws) return;
  guests.delete(peerId);
  if (hostSocket?.readyState === WebSocket.OPEN) sendJson(hostSocket, { type: 'peer-close', peerId });
}

function cleanupHost(ws) {
  if (hostSocket !== ws) return;
  hostSocket = null;
  for (const guest of guests.values()) {
    sendJson(guest, { type: 'host-close' });
    try { guest.close(4001, 'host-close'); } catch { /* no-op */ }
  }
  guests.clear();
}

wss.on('connection', (ws, req) => {
  ws.isAlive = true;
  ws.role = null;
  ws.peerId = null;
  ws.isLocal = isLoopback(req.socket.remoteAddress || '');
  ws.on('pong', () => { ws.isAlive = true; });

  const helloTimer = setTimeout(() => {
    if (!ws.role) closeWithError(ws, 'Handshake timeout.', 4008);
  }, 5000);

  ws.on('message', (data, isBinary) => {
    if (!ws.role) {
      if (isBinary) return closeWithError(ws, 'Handshake non valido.');
      let hello;
      try { hello = JSON.parse(data.toString('utf8')); } catch { return closeWithError(ws, 'Handshake non valido.'); }
      if (hello?.type !== 'hello' || hello?.v !== RELAY_PROTOCOL_VERSION || hello?.token !== token) {
        return closeWithError(ws, 'Sessione G.O.N.E. non valida.', 4003);
      }

      if (hello.role === 'host') {
        if (!ws.isLocal) return closeWithError(ws, 'Il ruolo host è consentito solo sul PC locale.', 4003);
        if (hostSocket && hostSocket !== ws) {
          try { hostSocket.close(4002, 'host-replaced'); } catch { /* no-op */ }
        }
        ws.role = 'host';
        hostSocket = ws;
        clearTimeout(helloTimer);
        sendJson(ws, { type: 'ready' });
        return;
      }

      if (hello.role === 'guest' && typeof hello.peerId === 'string' && /^guest-[a-zA-Z0-9_-]{6,64}$/.test(hello.peerId)) {
        if (!hostSocket || hostSocket.readyState !== WebSocket.OPEN) return closeWithError(ws, 'Host non ancora pronto.', 4004);
        if (guests.size >= MAX_GUESTS) return closeWithError(ws, 'Stanza piena (8 giocatori massimo).', 4005);
        if (guests.has(hello.peerId)) return closeWithError(ws, 'Identità guest già in uso.', 4006);
        ws.role = 'guest';
        ws.peerId = hello.peerId;
        guests.set(hello.peerId, ws);
        clearTimeout(helloTimer);
        sendJson(hostSocket, { type: 'peer-open', peerId: hello.peerId });
        sendJson(ws, { type: 'ready' });
        return;
      }

      return closeWithError(ws, 'Ruolo G.O.N.E. non valido.');
    }

    if (ws.role === 'guest') {
      if (!isBinary || !ws.peerId || !hostSocket || hostSocket.readyState !== WebSocket.OPEN) return;
      const frame = encodeGuestFrame(ws.peerId, data);
      if (frame) hostSocket.send(frame);
      return;
    }

    if (ws.role === 'host') {
      if (!isBinary) {
        let control;
        try { control = JSON.parse(data.toString('utf8')); } catch { return; }
        if (control?.type === 'peer-kick' && typeof control.peerId === 'string') {
          const guest = guests.get(control.peerId);
          if (guest) {
            guests.delete(control.peerId);
            try { guest.close(4007, 'kicked'); } catch { /* no-op */ }
          }
        }
        return;
      }
      const frame = decodeHostFrame(data);
      if (!frame) return;
      const guest = guests.get(frame.peerId);
      if (guest?.readyState === WebSocket.OPEN) guest.send(frame.payload);
    }
  });

  ws.on('close', () => {
    clearTimeout(helloTimer);
    if (ws.role === 'host') cleanupHost(ws);
    if (ws.role === 'guest' && ws.peerId) cleanupGuest(ws.peerId, ws);
  });
  ws.on('error', (error) => {
    console.warn('[G.O.N.E. Host] WebSocket error:', error.message);
  });
});

const heartbeat = setInterval(() => {
  for (const ws of wss.clients) {
    if (ws.isAlive === false) {
      ws.terminate();
      continue;
    }
    ws.isAlive = false;
    try { ws.ping(); } catch { ws.terminate(); }
  }
}, 10_000);
heartbeat.unref();

async function tryMapPort() {
  if (disableUpnp) return;
  try {
    const { upnpNat } = await import('@achingbrain/nat-port-mapper');
    const client = upnpNat();
    const signal = AbortSignal.timeout(5000);
    for await (const gateway of client.findGateways({ signal })) {
      natGateway = gateway;
      let mappedExternal = null;
      for await (const mapping of gateway.mapAll(port, { protocol: 'tcp' })) {
        mappedExternal = mapping.externalHost || null;
        if (mapping.externalPort && mapping.externalPort !== port) {
          console.warn(`[G.O.N.E. Host] Router ha assegnato la porta esterna ${mapping.externalPort} invece di ${port}.`);
        }
        break;
      }
      externalIp = mappedExternal || await gateway.externalIp().catch(() => null);
      mapped = Boolean(externalIp);
      cgnat = Boolean(externalIp && isNonPublicIpv4(externalIp));
      break;
    }
    if (!mapped) await client.stop?.();
  } catch (error) {
    console.warn('[G.O.N.E. Host] UPnP/NAT-PMP non disponibile:', error?.message || error);
  }
}

function openBrowser(url) {
  if (disableOpen) return;
  try {
    if (process.platform === 'win32') {
      spawn('cmd', ['/c', 'start', '', url], { detached: true, stdio: 'ignore' }).unref();
    } else if (process.platform === 'darwin') {
      spawn('open', [url], { detached: true, stdio: 'ignore' }).unref();
    } else {
      spawn('xdg-open', [url], { detached: true, stdio: 'ignore' }).unref();
    }
  } catch {
    // The URL is also printed below, so browser auto-open is optional.
  }
}

async function shutdown(signal) {
  console.log(`\n[G.O.N.E. Host] ${signal}: chiusura stanza...`);
  clearInterval(heartbeat);
  for (const ws of wss.clients) {
    try { ws.close(1001, 'server-shutdown'); } catch { /* no-op */ }
  }
  if (natGateway) {
    try { await natGateway.unmap(port); } catch { /* no-op */ }
    try { await natGateway.stop(); } catch { /* no-op */ }
  }
  await new Promise((resolveClose) => server.close(resolveClose));
  process.exit(0);
}

process.once('SIGINT', () => { shutdown('SIGINT').catch(() => process.exit(1)); });
process.once('SIGTERM', () => { shutdown('SIGTERM').catch(() => process.exit(1)); });

await ensureDist();
await new Promise((resolveListen, reject) => {
  server.once('error', reject);
  server.listen(port, bindHost, resolveListen);
});

console.log(`[G.O.N.E. Host] Server locale attivo su 0.0.0.0:${port}`);
await tryMapPort();

const hostUrl = new URL(`http://127.0.0.1:${port}/`);
hostUrl.searchParams.set('goneHost', 'host');
hostUrl.searchParams.set('token', token);

const status = currentStatus();
console.log(`[G.O.N.E. Host] Host locale: ${hostUrl}`);
console.log(`[G.O.N.E. Host] Invito LAN:   ${status.lanInviteUrl}`);
if (status.publicInviteUrl) {
  console.log(`[G.O.N.E. Host] Invito Internet: ${status.publicInviteUrl}`);
} else if (status.cgnat) {
  console.warn('[G.O.N.E. Host] IP WAN non pubblico/CGNAT rilevato: il port forwarding non può rendere la stanza raggiungibile da Internet.');
} else {
  console.warn(`[G.O.N.E. Host] Porta automatica non disponibile. Se hai un IP pubblico, inoltra manualmente TCP ${port} al PC host.`);
}
console.log('[G.O.N.E. Host] Ctrl+C chiude stanza e mapping.');
openBrowser(hostUrl.toString());

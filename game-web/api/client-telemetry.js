const ALLOWED_KINDS = new Set([
  'client_boot',
  'window_error',
  'unhandled_rejection',
  'runtime_start_error',
  'runtime_lifecycle_error',
  'webgl_context_lost',
  'webgl_context_restored',
  'network_disconnect',
  'network_resume',
]);

function clean(value, max = 1200) {
  return String(value ?? '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/\s{2,}/g, ' ')
    .trim()
    .slice(0, max);
}

function bodyOf(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string') {
    try { return JSON.parse(req.body); } catch { return {}; }
  }
  return {};
}

export default function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store, max-age=0');
  res.setHeader('Content-Type', 'application/json; charset=utf-8');

  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST');
    return res.status(405).json({ ok: false, error: 'method_not_allowed' });
  }

  const length = Number(req.headers['content-length'] || 0);
  if (Number.isFinite(length) && length > 16_384) {
    return res.status(413).json({ ok: false, error: 'payload_too_large' });
  }

  const raw = bodyOf(req);
  const kind = ALLOWED_KINDS.has(raw.kind) ? raw.kind : 'window_error';
  const record = {
    level: kind === 'client_boot' || kind === 'network_resume' || kind === 'webgl_context_restored' ? 'info' : 'error',
    source: 'gone-client',
    kind,
    buildId: clean(raw.buildId, 80),
    message: clean(raw.message, 1000),
    stack: clean(raw.stack, 2400),
    path: clean(raw.path, 180),
    device: clean(raw.device, 40),
    inputMode: clean(raw.inputMode, 24),
    standalone: Boolean(raw.standalone),
    online: Boolean(raw.online),
    visibility: clean(raw.visibility, 20),
    clientTimestamp: clean(raw.timestamp, 64),
    requestId: clean(req.headers['x-vercel-id'], 160),
  };

  const output = JSON.stringify(record);
  if (record.level === 'error') console.error(output);
  else console.log(output);
  return res.status(204).end();
}

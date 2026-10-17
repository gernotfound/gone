import { chromium } from 'playwright';

const BASE_URL = process.env.GONE_SMOKE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 45_000;

async function waitFor(fn, description, timeout = TIMEOUT) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (await fn()) return;
    await new Promise((resolve) => setTimeout(resolve, 150));
  }
  throw new Error('Timeout: ' + description);
}

const rooms = new Map();
let serial = 0;
const issued = ['K7M2Q', 'R9T3W', 'P4X6Z'];
const errors = [];
const browser = await chromium.launch({
  headless: true,
  args: ['--use-gl=swiftshader', '--enable-webgl', '--ignore-gpu-blocklist', '--disable-dev-shm-usage'],
});
const context = await browser.newContext({ viewport: { width: 900, height: 700 } });

await context.route('**/api/room-signal', async (route) => {
  const body = JSON.parse(route.request().postData() || '{}');
  const { operation, code, hostSecret } = body;
  let status = 200;
  let payload = { ok: true };
  if (operation === 'create') {
    const next = issued[serial++];
    if (!next) throw new Error('Unexpected room rotation');
    rooms.set(next, { offer: body.offer, hostSecret, answer: null });
    status = 201;
    payload = { ok: true, code: next, expiresAt: Date.now() + 120_000 };
  } else {
    const room = rooms.get(code);
    if (!room) { status = 404; payload = { ok: false, error: 'room_not_found' }; }
    else if (operation === 'offer') payload = { ok: true, offer: room.offer, expiresAt: Date.now() + 60_000 };
    else if (operation === 'answer') {
      if (room.answer) { status = 409; payload = { ok: false, error: 'room_already_claimed' }; }
      else { room.answer = body.answer; status = 201; }
    } else if (operation === 'poll' || operation === 'close') {
      if (hostSecret !== room.hostSecret) { status = 403; payload = { ok: false, error: 'invalid_host' }; }
      else if (operation === 'close') rooms.delete(code);
      else payload = { ok: true, answer: room.answer, expiresAt: Date.now() + 60_000 };
    } else { status = 400; payload = { ok: false, error: 'invalid_operation' }; }
  }
  await route.fulfill({ status, contentType: 'application/json', headers: { 'Cache-Control': 'no-store' }, body: JSON.stringify(payload) });
});

const host = await context.newPage();
const guest = await context.newPage();
for (const [page, label] of [[host, 'host'], [guest, 'guest']]) {
  page.on('pageerror', (error) => errors.push(label + ': ' + error.message));
}

try {
  await host.goto(BASE_URL);
  await host.locator('#btn-multiplayer').click();
  await host.locator('#multiplayer-lobby').waitFor({ state: 'visible' });
  await waitFor(async () => await host.locator('#invite-link-input').inputValue() === 'K7M2Q', 'host five-character invitation');
  if (await host.locator('#direct-host-answer-input').count()) throw new Error('Manual answer prompt must be absent for room codes');
  if (!(await host.locator('#invite-link-container label').textContent()).includes('5 CARATTERI')) throw new Error('Room label is not visible');

  await guest.goto(BASE_URL);
  await guest.locator('#room-code-input').fill('k7m2q');
  await guest.locator('#btn-join-room').click();
  await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible' });

  await waitFor(async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'), 'guest connected with only five characters');
  await waitFor(async () => host.evaluate(() => window.goneGame?.getP2PHost?.()?.getClientCount?.() === 1), 'host sees the guest');
  if (await guest.locator('#direct-guest-help').count()) throw new Error('Guest should not be asked to send SDP');
  if (errors.length) throw new Error('Browser errors: ' + errors.join('; '));

  await waitFor(async () => await host.locator('#invite-link-input').inputValue() === 'R9T3W', 'fresh code after accepted join');
  console.log('[short-room-code] PASS host/guest auto signaling, no huge link/answer, rotation');
} finally {
  await context.close();
  await browser.close();
}

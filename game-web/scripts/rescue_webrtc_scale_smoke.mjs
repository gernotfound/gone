import { chromium } from 'playwright';

const BASE_URL = process.env.GONE_SMOKE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 25_000;
const GUEST_COUNT = 7;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(fn, description, timeout = TIMEOUT, interval = 100) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function lobbyPlayerCount(page) {
  return page.locator('#lobby-player-list > li').count();
}

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] console.error: ${msg.text()}`);
  });
}

async function guestConnectionDiagnostics(guest) {
  return guest.evaluate(() => {
    const client = window.goneGame?.getP2PClient?.();
    return {
      clientStatus: client?.status ?? 'missing',
      channelReadyState: client?.channel?.readyState ?? 'missing',
      playerSlot: client?.playerSlot ?? null,
      session: window.goneSession?.snapshot?.() ?? null,
    };
  }).catch((error) => ({ diagnosticsError: error?.message || String(error) }));
}

async function readFreshInvite(host, previousInvite = null) {
  return waitFor(async () => {
    const value = await host.locator('#invite-link-input').inputValue();
    if (!value.includes('#direct=')) return null;
    if (previousInvite && value === previousInvite) return null;
    return value;
  }, 'fresh native WebRTC invite link', 15_000);
}

async function connectGuest(host, guest, guestIndex, previousInvite) {
  const label = `guest-${guestIndex + 1}`;
  const invite = await readFreshInvite(host, previousInvite);
  await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
  await guest.locator('#player-username').fill(`ScaleGuest${guestIndex + 1}`);

  const answer = await waitFor(async () => {
    const answerLabel = await guest.locator('#invite-link-container label').textContent().catch(() => '');
    const value = await guest.locator('#invite-link-input').inputValue().catch(() => '');
    return answerLabel?.includes('RISPOSTA') && value.length > 100 ? value : null;
  }, `${label} WebRTC answer`, 15_000);

  await host.locator('#direct-host-answer-input').fill(answer);
  await host.locator('#btn-direct-apply-answer').click();

  try {
    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      `${label} connected`,
      TIMEOUT,
    );
  } catch (error) {
    const diagnostics = await guestConnectionDiagnostics(guest);
    throw new Error(`${error?.message || error} Transport diagnostics: ${JSON.stringify(diagnostics)}`);
  }

  await waitFor(
    async () => host.evaluate((expected) => window.goneGame?.getP2PHost?.()?.getClientCount?.() === expected, guestIndex + 1),
    `host client count ${guestIndex + 1}`,
    TIMEOUT,
  );

  console.log(`[scale] ${label} connected`);
  return invite;
}

async function main() {
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-gl=swiftshader',
      '--enable-webgl',
      '--ignore-gpu-blocklist',
      '--disable-dev-shm-usage',
    ],
  });

  const context = await browser.newContext({ viewport: { width: 1024, height: 720 } });
  const errors = [];
  const host = await context.newPage();
  attachDiagnostics(host, 'host', errors);
  const guests = [];

  try {
    console.log('[scale] Opening host-owned room for 8-browser test');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await host.locator('#player-username').fill('ScaleHost');

    let previousInvite = null;
    for (let i = 0; i < GUEST_COUNT; i += 1) {
      const page = await context.newPage();
      attachDiagnostics(page, `guest-${i + 1}`, errors);
      guests.push(page);
      previousInvite = await connectGuest(host, page, i, previousInvite);
    }

    await waitFor(
      async () => (await lobbyPlayerCount(host)) === GUEST_COUNT + 1,
      'host lobby to contain 8 players',
      TIMEOUT,
    );

    for (let i = 0; i < guests.length; i += 1) {
      await waitFor(
        async () => (await lobbyPlayerCount(guests[i])) === GUEST_COUNT + 1,
        `guest-${i + 1} lobby to contain 8 players`,
        TIMEOUT,
      );
    }

    const hostState = await host.evaluate(() => ({
      clients: window.goneGame?.getP2PHost?.()?.getClientCount?.(),
      slots: Array.from(window.goneGame?.getP2PHost?.()?.playerIdToSlot?.values?.() ?? []),
    }));
    invariant(hostState.clients === GUEST_COUNT, `Host expected ${GUEST_COUNT} clients, got ${hostState.clients}`);

    const guestStates = await Promise.all(guests.map((page) => page.evaluate(() => ({
      status: window.goneGame?.getP2PClient?.()?.status,
      slot: window.goneGame?.getP2PClient?.()?.playerSlot,
      playerId: window.goneGame?.getP2PClient?.()?.playerId,
    }))));

    const slots = guestStates.map((state) => state.slot);
    invariant(guestStates.every((state) => state.status === 'connected'), `Some guests are disconnected: ${JSON.stringify(guestStates)}`);
    invariant(slots.every(Number.isInteger), `Some guests have no slot: ${JSON.stringify(slots)}`);
    invariant(new Set(slots).size === GUEST_COUNT, `Guest slots are not unique: ${JSON.stringify(slots)}`);

    if (errors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${errors.join('\n')}`);
    }

    console.log('[scale] PASS', JSON.stringify({
      players: GUEST_COUNT + 1,
      hostClients: hostState.clients,
      guestSlots: slots,
    }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[scale] FAIL');
  console.error(err?.stack || err);
  process.exit(1);
});

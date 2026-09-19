import { chromium } from 'playwright';

const BASE_URL = process.env.GONE_SMOKE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 25_000;
const PEER_LOSS_TIMEOUT = 22_000;

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

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] console.error: ${msg.text()}`);
  });
}

function isExpectedIntentionalHostLossError(message) {
  if (!message.startsWith('[host]') && !message.startsWith('[guest-b]')) return false;
  return /WebRTC control DataChannel (?:chiuso|in errore)|DataChannel error: Error: WebRTC control DataChannel (?:chiuso|in errore)/i.test(message);
}

async function playerCount(page) {
  return page.locator('#lobby-player-list > li').count();
}

async function readInvite(host, previous = null) {
  return waitFor(async () => {
    const value = await host.locator('#invite-link-input').inputValue().catch(() => '');
    if (!value.includes('#direct=')) return null;
    if (previous && value === previous) return null;
    return value;
  }, 'fresh host invitation', 15_000);
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

async function connectGuest(host, guest, previousInvite = null) {
  const invite = await readInvite(host, previousInvite);
  await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

  const answer = await waitFor(async () => {
    const label = await guest.locator('#invite-link-container label').textContent().catch(() => '');
    const value = await guest.locator('#invite-link-input').inputValue().catch(() => '');
    return label?.includes('RISPOSTA') && value.length > 100 ? value : null;
  }, 'guest WebRTC answer', 15_000);

  await host.locator('#direct-host-answer-input').fill(answer);
  await host.locator('#btn-direct-apply-answer').click();
  try {
    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      'guest connected',
      TIMEOUT,
    );
  } catch (error) {
    const diagnostics = await guestConnectionDiagnostics(guest);
    throw new Error(`${error?.message || error} Transport diagnostics: ${JSON.stringify(diagnostics)}`);
  }
  return invite;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const hostContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const guestAContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const guestBContext = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  const host = await hostContext.newPage();
  const guestA = await guestAContext.newPage();
  const guestB = await guestBContext.newPage();
  attachDiagnostics(host, 'host', errors);
  attachDiagnostics(guestA, 'guest-a', errors);
  attachDiagnostics(guestB, 'guest-b', errors);

  try {
    console.log('[resilience] Creating host room in an isolated browser context');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await host.locator('#player-username').fill('ResilienceHost');

    console.log('[resilience] Connecting first independent guest');
    const firstInvite = await connectGuest(host, guestA);
    await waitFor(
      async () => (await playerCount(host)) === 2,
      'host to show first guest',
      10_000,
    );

    const guestAState = await guestA.evaluate(() => ({
      id: window.goneGame.getP2PClient().playerId,
      slot: window.goneGame.getP2PClient().playerSlot,
      color: window.goneGame.getP2PClient().assignedColor,
    }));
    invariant(guestAState.slot === 1, `First guest should own slot 1: ${JSON.stringify(guestAState)}`);

    console.log('[resilience] Abruptly closing first guest and checking authoritative cleanup');
    await guestA.close();
    await waitFor(async () => host.evaluate(() => {
      const server = window.goneGame?.getP2PHost?.();
      return server?.getClientCount?.() === 0 && server?.playerRecords?.size === 1;
    }), 'host peer/record cleanup after guest close', PEER_LOSS_TIMEOUT);
    await waitFor(
      async () => (await playerCount(host)) === 1,
      'lobby cleanup after guest close',
      10_000,
    );

    console.log('[resilience] Connecting replacement guest without recreating the room');
    await connectGuest(host, guestB, firstInvite);
    await waitFor(
      async () => (await playerCount(host)) === 2,
      'replacement guest in host lobby',
      10_000,
    );

    const guestBState = await guestB.evaluate(() => ({
      id: window.goneGame.getP2PClient().playerId,
      slot: window.goneGame.getP2PClient().playerSlot,
      color: window.goneGame.getP2PClient().assignedColor,
      status: window.goneGame.getP2PClient().status,
    }));
    invariant(guestBState.status === 'connected', `Replacement guest not connected: ${JSON.stringify(guestBState)}`);
    invariant(guestBState.slot === 1, `Released slot should be reusable, got ${guestBState.slot}`);
    invariant(guestBState.id !== guestAState.id, 'Replacement guest must have a fresh identity');

    // The test intentionally kills the server transport below. Capture the
    // diagnostics boundary first so only the expected terminal WebRTC errors
    // emitted by that action are tolerated; any earlier or unrelated browser
    // exception remains a hard failure.
    const errorsBeforeIntentionalHostLoss = errors.length;
    console.log('[resilience] Closing host and verifying client observes server loss');
    await host.close();
    await waitFor(
      async () => guestB.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'disconnected'),
      'guest to detect host/server shutdown',
      PEER_LOSS_TIMEOUT,
    );

    const unexpectedErrors = errors.filter((message, index) =>
      index < errorsBeforeIntentionalHostLoss || !isExpectedIntentionalHostLossError(message)
    );
    if (unexpectedErrors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${unexpectedErrors.join('\n')}`);
    }

    console.log('[resilience] PASS', JSON.stringify({
      firstGuestSlot: guestAState.slot,
      replacementGuestSlot: guestBState.slot,
      hostLossDetected: true,
      expectedTerminalErrors: errors.length - unexpectedErrors.length - errorsBeforeIntentionalHostLoss,
    }));
  } finally {
    await Promise.allSettled([
      hostContext.close(),
      guestAContext.close(),
      guestBContext.close(),
    ]);
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[resilience] FAIL');
  console.error(err?.stack || err);
  process.exit(1);
});
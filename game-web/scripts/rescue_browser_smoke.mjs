import { chromium } from 'playwright';

const BASE_URL = process.env.GONE_SMOKE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 25_000;

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
    if (msg.type() === 'error') console.warn(`[${label}] console.error: ${msg.text()}`);
  });
}

async function lobbyPlayerCount(page) {
  return page.locator('#lobby-player-list > li').count();
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

  const context = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const browserErrors = [];
  const host = await context.newPage();
  const guest = await context.newPage();
  attachDiagnostics(host, 'host', browserErrors);
  attachDiagnostics(guest, 'guest', browserErrors);

  try {
    console.log('[smoke] Opening host-owned room');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#player-username').fill('SmokeHost');
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

    const invite = await waitFor(async () => {
      const value = await host.locator('#invite-link-input').inputValue();
      return value.includes('#direct=') ? value : null;
    }, 'native WebRTC invite link');
    invariant(await lobbyPlayerCount(host) === 1, 'Host lobby should begin with one player');

    console.log('[smoke] Guest opens direct invite and creates answer');
    await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

    const answer = await waitFor(async () => {
      const label = await guest.locator('#invite-link-container label').textContent().catch(() => '');
      const value = await guest.locator('#invite-link-input').inputValue().catch(() => '');
      return label?.includes('RISPOSTA') && value.length > 100 ? value : null;
    }, 'guest WebRTC answer');

    console.log('[smoke] Host applies guest answer');
    await host.locator('#direct-host-answer-input').fill(answer);
    await host.locator('#btn-direct-apply-answer').click();

    await waitFor(
      async () => (await lobbyPlayerCount(host)) === 2 && (await lobbyPlayerCount(guest)) === 2,
      'both pages to show a two-player direct lobby',
      15_000,
    );

    const hostNetwork = await host.evaluate(() => ({
      hasApi: !!window.goneGame,
      clients: window.goneGame?.getP2PHost?.()?.getClientCount?.() ?? -1,
    }));
    const guestNetwork = await guest.evaluate(() => ({
      status: window.goneGame?.getP2PClient?.()?.status,
      slot: window.goneGame?.getP2PClient?.()?.playerSlot,
    }));
    invariant(hostNetwork.hasApi && hostNetwork.clients === 1, `Host network state invalid: ${JSON.stringify(hostNetwork)}`);
    invariant(guestNetwork.status === 'connected', `Guest did not reach connected state: ${JSON.stringify(guestNetwork)}`);
    invariant(Number.isInteger(guestNetwork.slot), `Guest did not receive an authoritative slot: ${JSON.stringify(guestNetwork)}`);

    console.log('[smoke] Starting match on both pages');
    await host.locator('#btn-play-multiplayer').click();

    await waitFor(
      async () => host.evaluate(() => !document.querySelector('#game-canvas')?.classList.contains('hidden')),
      'host gameplay canvas',
      30_000,
    );
    await waitFor(
      async () => guest.evaluate(() => !document.querySelector('#game-canvas')?.classList.contains('hidden')),
      'guest gameplay canvas',
      30_000,
    );

    await waitFor(
      async () => host.evaluate(() => window.goneGame?.remotePlayers?.size === 1),
      'host to render the guest player',
      15_000,
    );
    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.remotePlayers?.size === 1),
      'guest to render the host player',
      15_000,
    );

    console.log('[smoke] Verifying live movement propagation');
    const guestId = await guest.evaluate(() => window.goneGame?.getP2PClient?.()?.playerId);
    invariant(typeof guestId === 'string' && guestId.length > 0, 'Guest player id unavailable');

    const beforeX = await host.evaluate((id) => window.goneGame?.remotePlayers?.get(id)?.group?.position?.x, guestId);
    invariant(Number.isFinite(beforeX), `Host has no rendered guest X position (${beforeX})`);

    await guest.evaluate(() => {
      window.goneGame.player.position.x += 7;
    });

    await waitFor(async () => {
      const x = await host.evaluate((id) => window.goneGame?.remotePlayers?.get(id)?.group?.position?.x, guestId);
      return Number.isFinite(x) && Math.abs(x - beforeX) > 3;
    }, 'guest movement to propagate to host', 10_000);

    console.log('[smoke] Verifying authoritative health propagation');
    await host.evaluate((id) => {
      const hostSession = window.goneGame.getP2PHost();
      const record = hostSession.playerRecords.get(id);
      if (!record) throw new Error('Guest combat record missing');
      record.shieldExpiresAt = 0;
      const result = hostSession.dealDamage(id, 37);
      if (result.newHp !== 63) throw new Error(`Unexpected authoritative HP: ${result.newHp}`);
      hostSession.tickSnapshot();
    }, guestId);

    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.clientHp === 63),
      'authoritative health update on guest',
      5_000,
    );

    if (browserErrors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${browserErrors.join('\n')}`);
    }

    const finalState = await Promise.all([
      host.evaluate(() => ({
        clients: window.goneGame.getP2PHost().getClientCount(),
        remotes: window.goneGame.remotePlayers.size,
      })),
      guest.evaluate(() => ({
        status: window.goneGame.getP2PClient().status,
        hp: window.goneGame.getP2PClient().clientHp,
        remotes: window.goneGame.remotePlayers.size,
      })),
    ]);

    console.log('[smoke] PASS', JSON.stringify({ host: finalState[0], guest: finalState[1] }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[smoke] FAIL');
  console.error(err?.stack || err);
  process.exit(1);
});
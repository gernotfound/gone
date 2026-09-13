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

async function readFreshInvite(host, previousInvite = null) {
  return waitFor(async () => {
    const value = await host.locator('#invite-link-input').inputValue();
    if (!value.includes('#direct=')) return null;
    if (previousInvite && value === previousInvite) return null;
    return value;
  }, 'fresh native WebRTC invite link');
}

async function connectGuest(host, guest, label, previousInvite = null) {
  const invite = await readFreshInvite(host, previousInvite);
  console.log(`[smoke] ${label} opens direct invite and creates answer`);
  await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
  await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

  const answer = await waitFor(async () => {
    const answerLabel = await guest.locator('#invite-link-container label').textContent().catch(() => '');
    const value = await guest.locator('#invite-link-input').inputValue().catch(() => '');
    return answerLabel?.includes('RISPOSTA') && value.length > 100 ? value : null;
  }, `${label} WebRTC answer`);

  console.log(`[smoke] Host applies ${label} answer`);
  await host.locator('#direct-host-answer-input').fill(answer);
  await host.locator('#btn-direct-apply-answer').click();

  await waitFor(
    async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
    `${label} to reach connected state`,
    15_000,
  );

  return invite;
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const browserErrors = [];
  const host = await context.newPage();
  const guestA = await context.newPage();
  const guestB = await context.newPage();
  attachDiagnostics(host, 'host', browserErrors);
  attachDiagnostics(guestA, 'guestA', browserErrors);
  attachDiagnostics(guestB, 'guestB', browserErrors);

  try {
    console.log('[smoke] Opening host-owned room');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await host.locator('#player-username').fill('SmokeHost');
    invariant(await lobbyPlayerCount(host) === 1, 'Host lobby should begin with one player');

    const firstInvite = await connectGuest(host, guestA, 'Guest A');
    await waitFor(
      async () => (await lobbyPlayerCount(host)) === 2 && (await lobbyPlayerCount(guestA)) === 2,
      'two-player direct lobby',
      15_000,
    );

    await connectGuest(host, guestB, 'Guest B', firstInvite);
    await waitFor(
      async () =>
        (await lobbyPlayerCount(host)) === 3 &&
        (await lobbyPlayerCount(guestA)) === 3 &&
        (await lobbyPlayerCount(guestB)) === 3,
      'three-player direct lobby on every page',
      15_000,
    );

    const hostNetwork = await host.evaluate(() => ({
      clients: window.goneGame?.getP2PHost?.()?.getClientCount?.() ?? -1,
    }));
    const guestStates = await Promise.all([guestA, guestB].map((page) => page.evaluate(() => ({
      status: window.goneGame?.getP2PClient?.()?.status,
      slot: window.goneGame?.getP2PClient?.()?.playerSlot,
      playerId: window.goneGame?.getP2PClient?.()?.playerId,
    }))));

    invariant(hostNetwork.clients === 2, `Host should own two client connections: ${JSON.stringify(hostNetwork)}`);
    for (const [index, state] of guestStates.entries()) {
      invariant(state.status === 'connected', `Guest ${index + 1} not connected: ${JSON.stringify(state)}`);
      invariant(Number.isInteger(state.slot), `Guest ${index + 1} missing authoritative slot: ${JSON.stringify(state)}`);
      invariant(typeof state.playerId === 'string' && state.playerId.length > 0, `Guest ${index + 1} missing player id`);
    }
    invariant(guestStates[0].slot !== guestStates[1].slot, 'Guests must receive distinct authoritative slots');

    const guestAId = guestStates[0].playerId;
    const guestBId = guestStates[1].playerId;

    // Networking is deliberately tested before starting Three.js. The host is
    // expected to keep receiving accepted state packets even while positions are
    // stationary; anti-teleport behavior is covered by the adversarial suite.
    console.log('[smoke] Verifying both guests continuously feed authoritative state to host');
    const before = await host.evaluate(([aId, bId]) => {
      const session = window.goneGame.getP2PHost();
      const a = session.playerRecords.get(aId);
      const b = session.playerRecords.get(bId);
      if (!a || !b) throw new Error('Authoritative guest records missing');
      return { aSeq: a.lastClientSeq, bSeq: b.lastClientSeq };
    }, [guestAId, guestBId]);

    await waitFor(async () => host.evaluate(([aId, bId, initial]) => {
      const session = window.goneGame.getP2PHost();
      const a = session.playerRecords.get(aId);
      const b = session.playerRecords.get(bId);
      return !!a && !!b &&
        a.lastClientSeq !== initial.aSeq &&
        b.lastClientSeq !== initial.bSeq;
    }, [guestAId, guestBId, before]), 'both guest state streams on host', 12_000);

    console.log('[smoke] Verifying authoritative health on Guest A');
    await host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      if (!record) throw new Error('Guest A record missing');
      record.shieldExpiresAt = 0;
      const result = session.dealDamage(id, 37);
      if (result.newHp !== 63) throw new Error(`Unexpected HP: ${result.newHp}`);
      session.tickSnapshot();
    }, guestAId);

    await waitFor(
      async () => guestA.evaluate(() => window.goneGame?.getP2PClient?.()?.clientHp === 63),
      'Guest A authoritative HP',
      5_000,
    );

    console.log('[smoke] Verifying death and authoritative respawn on Guest B');
    const deathTime = await host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      if (!record) throw new Error('Guest B record missing');
      record.shieldExpiresAt = 0;
      const result = session.dealDamage(id, 1000);
      if (!result.isFatal || result.newHp !== 0) throw new Error(`Guest B should be dead: ${JSON.stringify(result)}`);
      session.tickSnapshot();
      return session.playerRecords.get(id).deathTime;
    }, guestBId);

    await waitFor(
      async () => guestB.evaluate(() => {
        const client = window.goneGame?.getP2PClient?.();
        return client?.clientHp === 0 && client?.isAlive === false;
      }),
      'Guest B death state',
      5_000,
    );

    await host.evaluate(([id, when]) => {
      const session = window.goneGame.getP2PHost();
      session.tickSnapshot(when + 5001);
    }, [guestBId, deathTime]);

    await waitFor(
      async () => guestB.evaluate(() => {
        const client = window.goneGame?.getP2PClient?.();
        return client?.clientHp === 100 && client?.isAlive === true;
      }),
      'Guest B respawn state',
      5_000,
    );

    // Confirm the host can still fan out one lobby command to every connected
    // DataChannel. We intentionally do not initialize three GPU-heavy scenes in
    // this networking smoke test.
    console.log('[smoke] Verifying host fan-out to both guests');
    await host.evaluate(() => {
      const button = document.querySelector('#btn-play-multiplayer');
      if (!button) throw new Error('Host play button missing');
      // GAME_START is sent synchronously by the click handler before game loading.
      button.click();
    });

    await waitFor(async () => {
      const hidden = await Promise.all([guestA, guestB].map((page) =>
        page.evaluate(() => document.querySelector('#multiplayer-lobby')?.classList.contains('hidden') === true),
      ));
      return hidden.every(Boolean);
    }, 'GAME_START fan-out to both guests', 8_000);

    if (browserErrors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${browserErrors.join('\n')}`);
    }

    console.log('[smoke] PASS', JSON.stringify({
      hostClients: hostNetwork.clients,
      guestA: { slot: guestStates[0].slot, hp: 63 },
      guestB: { slot: guestStates[1].slot, aliveAfterRespawn: true },
    }));
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

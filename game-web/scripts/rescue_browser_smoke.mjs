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
      hasApi: !!window.goneGame,
      clients: window.goneGame?.getP2PHost?.()?.getClientCount?.() ?? -1,
    }));
    const guestStates = await Promise.all([guestA, guestB].map((page) => page.evaluate(() => ({
      status: window.goneGame?.getP2PClient?.()?.status,
      slot: window.goneGame?.getP2PClient?.()?.playerSlot,
      playerId: window.goneGame?.getP2PClient?.()?.playerId,
    }))));

    invariant(hostNetwork.hasApi && hostNetwork.clients === 2, `Host network state invalid: ${JSON.stringify(hostNetwork)}`);
    for (const [index, state] of guestStates.entries()) {
      invariant(state.status === 'connected', `Guest ${index + 1} did not reach connected state: ${JSON.stringify(state)}`);
      invariant(Number.isInteger(state.slot), `Guest ${index + 1} has no authoritative slot: ${JSON.stringify(state)}`);
      invariant(typeof state.playerId === 'string' && state.playerId.length > 0, `Guest ${index + 1} has no player id`);
    }
    invariant(guestStates[0].slot !== guestStates[1].slot, 'Guests must receive unique authoritative slots');

    console.log('[smoke] Starting three-player match');
    await host.locator('#btn-play-multiplayer').click();

    for (const [page, label] of [[host, 'host'], [guestA, 'guest A'], [guestB, 'guest B']]) {
      await waitFor(
        async () => page.evaluate(() => !document.querySelector('#game-canvas')?.classList.contains('hidden')),
        `${label} gameplay canvas`,
        35_000,
      );
    }

    await waitFor(
      async () => host.evaluate(() => window.goneGame?.remotePlayers?.size === 2),
      'host to render both guests',
      20_000,
    );
    await waitFor(
      async () => guestA.evaluate(() => window.goneGame?.remotePlayers?.size === 2),
      'guest A to render host and guest B',
      20_000,
    );
    await waitFor(
      async () => guestB.evaluate(() => window.goneGame?.remotePlayers?.size === 2),
      'guest B to render host and guest A',
      20_000,
    );

    const guestAId = guestStates[0].playerId;
    const guestBId = guestStates[1].playerId;

    console.log('[smoke] Verifying both guests feed authoritative state to host');
    const initialHostRecords = await host.evaluate(([aId, bId]) => {
      const session = window.goneGame.getP2PHost();
      return {
        a: { x: session.playerRecords.get(aId)?.position?.x, seq: session.playerRecords.get(aId)?.lastClientSeq },
        b: { z: session.playerRecords.get(bId)?.position?.z, seq: session.playerRecords.get(bId)?.lastClientSeq },
      };
    }, [guestAId, guestBId]);

    await guestA.evaluate(() => { window.goneGame.player.position.x += 7; });
    await guestB.evaluate(() => { window.goneGame.player.position.z -= 8; });

    await waitFor(async () => host.evaluate(([aId, bId, before]) => {
      const session = window.goneGame.getP2PHost();
      const a = session.playerRecords.get(aId);
      const b = session.playerRecords.get(bId);
      return !!a && !!b &&
        Math.abs(a.position.x - before.a.x) > 3 &&
        Math.abs(b.position.z - before.b.z) > 3 &&
        a.lastClientSeq !== before.a.seq &&
        b.lastClientSeq !== before.b.seq;
    }, [guestAId, guestBId, initialHostRecords]), 'both authoritative host player records to move', 12_000);

    await waitFor(async () => host.evaluate(([aId, bId, before]) => {
      const a = window.goneGame?.remotePlayers?.get(aId)?.group?.position;
      const b = window.goneGame?.remotePlayers?.get(bId)?.group?.position;
      return !!a && !!b && Math.abs(a.x - before.a.x) > 3 && Math.abs(b.z - before.b.z) > 3;
    }, [guestAId, guestBId, initialHostRecords]), 'both guest models to move on host', 12_000);

    console.log('[smoke] Verifying authoritative damage propagation');
    await host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      if (!record) throw new Error('Guest A combat record missing');
      record.shieldExpiresAt = 0;
      const result = session.dealDamage(id, 37);
      if (result.newHp !== 63) throw new Error(`Unexpected authoritative HP: ${result.newHp}`);
      session.tickSnapshot();
    }, guestAId);

    await waitFor(
      async () => guestA.evaluate(() => window.goneGame?.getP2PClient?.()?.clientHp === 63),
      'authoritative health update on guest A',
      5_000,
    );

    console.log('[smoke] Verifying death and authoritative respawn');
    await host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      if (!record) throw new Error('Guest B combat record missing');
      record.shieldExpiresAt = 0;
      const result = session.dealDamage(id, 1000);
      if (!result.isFatal || result.newHp !== 0) throw new Error(`Guest B should be dead: ${JSON.stringify(result)}`);
      session.tickSnapshot();
    }, guestBId);

    await waitFor(
      async () => guestB.evaluate(() => {
        const client = window.goneGame?.getP2PClient?.();
        return client?.clientHp === 0 && client?.isAlive === false && window.goneGame?.player?.isAlive === false;
      }),
      'guest B death state',
      5_000,
    );

    await host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      if (!record) throw new Error('Guest B record missing before respawn');
      session.tickSnapshot(record.deathTime + 5001);
    }, guestBId);

    await waitFor(
      async () => guestB.evaluate(() => {
        const client = window.goneGame?.getP2PClient?.();
        return client?.clientHp === 100 && client?.isAlive === true && window.goneGame?.player?.isAlive === true;
      }),
      'guest B authoritative respawn state',
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
      guestA.evaluate(() => ({
        status: window.goneGame.getP2PClient().status,
        hp: window.goneGame.getP2PClient().clientHp,
        remotes: window.goneGame.remotePlayers.size,
      })),
      guestB.evaluate(() => ({
        status: window.goneGame.getP2PClient().status,
        hp: window.goneGame.getP2PClient().clientHp,
        alive: window.goneGame.getP2PClient().isAlive,
        remotes: window.goneGame.remotePlayers.size,
      })),
    ]);

    console.log('[smoke] PASS', JSON.stringify({ host: finalState[0], guestA: finalState[1], guestB: finalState[2] }));
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
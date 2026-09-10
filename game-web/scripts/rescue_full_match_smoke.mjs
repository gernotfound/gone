import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.GONE_FULL_MATCH_PORT || 7790);
const TOKEN = 'ci-full-match-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT = 45_000;

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
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`[${label}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${label}] console.error: ${message.text()}`);
  });
}

function planarDistance(a, b) {
  return Math.hypot(a.x - b.x, a.z - b.z);
}

async function main() {
  const hostProcess = spawn(process.execPath, ['../gone-host/server.mjs', '--no-upnp', '--no-open', '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: {
      ...process.env,
      GONE_TOKEN: TOKEN,
      GONE_NO_UPNP: '1',
      GONE_NO_OPEN: '1',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let serverLog = '';
  hostProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  hostProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  let browser;
  let hostContext;
  let guestContext;
  try {
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/__gone_host/status`)).ok; } catch { return false; }
    }, 'local G.O.N.E. Host');

    browser = await chromium.launch({
      headless: true,
      args: ['--use-angle=swiftshader', '--enable-webgl'],
    });
    hostContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
    guestContext = await browser.newContext({ viewport: { width: 960, height: 640 } });
    const host = await hostContext.newPage();
    const guest = await guestContext.newPage();
    const errors = [];
    attachDiagnostics(host, 'host', errors);
    attachDiagnostics(guest, 'guest', errors);

    console.log('[full-match] Opening host and guest through G.O.N.E. Host');
    await host.goto(`${BASE}/?goneHost=host#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await waitFor(async () => host.evaluate(() => Boolean(window.goneGame?.getP2PHost?.())), 'authoritative host object');

    await guest.goto(`${BASE}/?goneHost=guest#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      'guest connected',
    );
    await waitFor(
      async () => host.evaluate(() => window.goneGame?.getP2PHost?.()?.getClientCount?.() === 1),
      'host client registration',
    );

    const guestId = await guest.evaluate(() => window.goneGame.getP2PClient().playerId);

    console.log('[full-match] Host starts the actual 3D match');
    await host.locator('#btn-play-multiplayer').click();

    await Promise.all([
      host.locator('#game-canvas').waitFor({ state: 'visible', timeout: TIMEOUT }),
      guest.locator('#game-canvas').waitFor({ state: 'visible', timeout: TIMEOUT }),
      host.locator('#game-ui').waitFor({ state: 'visible', timeout: TIMEOUT }),
      guest.locator('#game-ui').waitFor({ state: 'visible', timeout: TIMEOUT }),
    ]);

    console.log('[full-match] Verifying both render loops and remote avatars');
    await waitFor(async () => {
      const [hostFps, guestFps] = await Promise.all([
        host.locator('#fps-counter').textContent().catch(() => '0'),
        guest.locator('#fps-counter').textContent().catch(() => '0'),
      ]);
      return Number(hostFps) > 0 && Number(guestFps) > 0;
    }, 'non-zero FPS counters on host and guest', 20_000);

    await waitFor(
      async () => host.evaluate((id) => window.goneGame?.remotePlayers?.has?.(id) === true, guestId),
      'guest avatar rendered on host',
      15_000,
    );
    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.remotePlayers?.size >= 1),
      'host avatar rendered on guest',
      15_000,
    );

    const runtimeState = await Promise.all([host, guest].map((page) => page.evaluate(() => ({
      canvasVisible: !document.querySelector('#game-canvas')?.classList.contains('hidden'),
      gameUiVisible: !document.querySelector('#game-ui')?.classList.contains('hidden'),
      x: window.goneGame.player.position.x,
      y: window.goneGame.player.position.y,
      z: window.goneGame.player.position.z,
      remotes: window.goneGame.remotePlayers.size,
    }))));
    for (const [index, state] of runtimeState.entries()) {
      invariant(state.canvasVisible && state.gameUiVisible, `Player ${index} did not enter gameplay: ${JSON.stringify(state)}`);
      invariant([state.x, state.y, state.z].every(Number.isFinite), `Player ${index} has invalid physics state: ${JSON.stringify(state)}`);
      invariant(state.remotes >= 1, `Player ${index} has no remote avatar: ${JSON.stringify(state)}`);
    }

    // Take the movement baseline only after both 3D scenes, physics loops and
    // networking are fully active. Pre-load terrain/respawn settling must not be
    // mistaken for player input movement.
    const localBaseline = await guest.evaluate(() => ({
      x: window.goneGame.player.position.x,
      z: window.goneGame.player.position.z,
    }));
    const hostBaseline = await host.evaluate((id) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(id);
      if (!record) throw new Error('Guest record missing after game start');
      return { x: record.position.x, z: record.position.z, seq: record.lastClientSeq };
    }, guestId);

    console.log('[full-match] Driving real W-key movement through input, physics and networking');
    await guest.bringToFront();
    try {
      await guest.keyboard.down('KeyW');
      await new Promise((resolve) => setTimeout(resolve, 1200));
    } finally {
      await guest.keyboard.up('KeyW').catch(() => {});
    }

    const localMoved = await waitFor(async () => guest.evaluate((start) => {
      const position = window.goneGame.player.position;
      const distance = Math.hypot(position.x - start.x, position.z - start.z);
      return distance > 2 ? { distance, x: position.x, z: position.z } : null;
    }, localBaseline), 'guest local physics movement from real W key', 8_000);

    const replicated = await waitFor(async () => host.evaluate(([id, start]) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(id);
      if (!record) return null;
      const distance = Math.hypot(record.position.x - start.x, record.position.z - start.z);
      return distance > 2 && record.lastClientSeq !== start.seq
        ? { distance, seq: record.lastClientSeq, x: record.position.x, z: record.position.z }
        : null;
    }, [guestId, hostBaseline]), 'authoritative host to receive in-game guest movement', 12_000);

    invariant(planarDistance(localMoved, replicated) < 6, `Host and guest movement diverged excessively: local=${JSON.stringify(localMoved)} host=${JSON.stringify(replicated)}`);

    if (errors.length) throw new Error(`Runtime/browser errors detected:\n${errors.join('\n')}`);

    console.log('[full-match] PASS', JSON.stringify({
      guestId,
      bothScenesRunning: true,
      remoteAvatarsVisible: true,
      localMovementDistance: localMoved.distance,
      authoritativeMovementDistance: replicated.distance,
      authoritativeSequence: replicated.seq,
    }));
  } finally {
    if (hostContext) await hostContext.close().catch(() => {});
    if (guestContext) await guestContext.close().catch(() => {});
    if (browser) await browser.close().catch(() => {});
    hostProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => hostProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (hostProcess.exitCode && hostProcess.exitCode !== 0) {
      console.error('[full-match] Host process log:\n' + serverLog);
    }
  }
}

main().catch((error) => {
  console.error('[full-match] FAIL');
  console.error(error?.stack || error);
  process.exit(1);
});

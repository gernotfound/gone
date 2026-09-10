import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.GONE_SELFHOST_TEST_PORT || 7788);
const TOKEN = 'ci-selfhost-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;
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
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function waitForServer() {
  await waitFor(async () => {
    try {
      const response = await fetch(`${BASE}/__gone_host/status`);
      return response.ok ? await response.json() : null;
    } catch {
      return null;
    }
  }, 'local G.O.N.E. Host HTTP server');
}

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`[${label}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') errors.push(`[${label}] console.error: ${message.text()}`);
  });
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
  try {
    await waitForServer();
    browser = await chromium.launch({ headless: true });
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

    console.log('[selfhost] Opening local authoritative host browser');
    await host.goto(`${BASE}/?goneHost=host#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });
    await waitFor(
      async () => host.evaluate(() => Boolean(window.goneGame?.getP2PHost?.())),
      'authoritative host object',
    );

    const invite = await waitFor(async () => {
      const value = await host.locator('#invite-link-input').inputValue().catch(() => '');
      return value.includes('?goneHost=guest') && value.includes('#token=') ? value : null;
    }, 'fragment-secret guest invite');
    invariant(!invite.includes('token=' + TOKEN + '&'), 'Session token must not be serialized as an HTTP query parameter.');

    console.log('[selfhost] Connecting two independent guest browsers through the local relay');
    await Promise.all([
      guestA.goto(`${BASE}/?goneHost=guest#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }),
      guestB.goto(`${BASE}/?goneHost=guest#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT }),
    ]);

    await waitFor(
      async () => guestA.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      'guest A relay join',
    );
    await waitFor(
      async () => guestB.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      'guest B relay join',
    );
    await waitFor(
      async () => host.evaluate(() => window.goneGame?.getP2PHost?.()?.getClientCount?.() === 2),
      'host to own two relay clients',
    );

    const state = await host.evaluate(() => {
      const server = window.goneGame.getP2PHost();
      return {
        clients: server.getClientCount(),
        records: [...server.playerRecords.values()].map((record) => ({ id: record.id, slot: record.slot })),
      };
    });
    invariant(state.clients === 2, `Expected 2 clients, got ${state.clients}`);
    const slots = state.records.filter((record) => record.slot !== 0).map((record) => record.slot).sort((a, b) => a - b);
    invariant(JSON.stringify(slots) === JSON.stringify([1, 2]), `Unexpected guest slots: ${JSON.stringify(slots)}`);

    console.log('[selfhost] Verifying binary state traffic reaches the authoritative host');
    await guestA.evaluate(() => {
      const client = window.goneGame.getP2PClient();
      client.setStateProvider(() => ({
        position: { x: 12.5, y: 17.5, z: -7.25 },
        yaw: 0.75,
        pitch: -0.15,
        activeWeapon: 3,
        flags: 1,
      }));
      client.sendCurrentState();
    });

    const guestAId = await guestA.evaluate(() => window.goneGame.getP2PClient().playerId);
    await waitFor(async () => host.evaluate((id) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(id);
      return record && Math.abs(record.position.x - 12.5) < 0.01 && Math.abs(record.position.z + 7.25) < 0.01;
    }, guestAId), 'authoritative relay state update');

    console.log('[selfhost] Closing one guest and checking slot/session cleanup');
    await guestA.close();
    await waitFor(
      async () => host.evaluate(() => window.goneGame.getP2PHost().getClientCount() === 1),
      'relay guest disconnect cleanup',
      10_000,
    );

    console.log('[selfhost] Closing the host browser and checking guest shutdown propagation');
    await host.close();
    await waitFor(
      async () => guestB.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'disconnected'),
      'host-close propagation through relay',
      10_000,
    );

    if (errors.length) throw new Error(`Browser exceptions detected:\n${errors.join('\n')}`);

    console.log('[selfhost] PASS', JSON.stringify({
      clients: 2,
      slots,
      fragmentSecret: true,
      binaryStateForwarded: true,
      guestCleanup: true,
      hostLossDetected: true,
    }));

    await Promise.allSettled([hostContext.close(), guestAContext.close(), guestBContext.close()]);
  } finally {
    if (browser) await browser.close().catch(() => {});
    hostProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => hostProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (!hostProcess.killed) hostProcess.kill('SIGKILL');
    if (hostProcess.exitCode && hostProcess.exitCode !== 0) {
      console.error('[selfhost] Host process log:\n' + serverLog);
    }
  }
}

main().catch((error) => {
  console.error('[selfhost] FAIL');
  console.error(error?.stack || error);
  process.exit(1);
});

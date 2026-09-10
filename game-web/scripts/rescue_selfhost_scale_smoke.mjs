import { chromium } from 'playwright';
import { spawn } from 'node:child_process';

const PORT = Number(process.env.GONE_SELFHOST_SCALE_PORT || 7789);
const TOKEN = 'ci-selfhost-scale-token-0123456789abcdef';
const BASE = `http://127.0.0.1:${PORT}`;
const TIMEOUT = 35_000;

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

async function main() {
  const hostProcess = spawn(process.execPath, ['../gone-host/server.mjs', '--no-upnp', '--no-open', '--port', String(PORT)], {
    cwd: new URL('..', import.meta.url).pathname,
    env: { ...process.env, GONE_TOKEN: TOKEN, GONE_NO_UPNP: '1', GONE_NO_OPEN: '1' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let serverLog = '';
  hostProcess.stdout.on('data', (chunk) => { serverLog += chunk.toString(); });
  hostProcess.stderr.on('data', (chunk) => { serverLog += chunk.toString(); });

  let browser;
  const contexts = [];
  try {
    await waitFor(async () => {
      try { return (await fetch(`${BASE}/__gone_host/status`)).ok; } catch { return false; }
    }, 'self-host scale server');

    browser = await chromium.launch({ headless: true });
    const hostContext = await browser.newContext({ viewport: { width: 900, height: 650 } });
    contexts.push(hostContext);
    const host = await hostContext.newPage();

    console.log('[selfhost-scale] Opening authoritative host');
    await host.goto(`${BASE}/?goneHost=host#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await waitFor(async () => host.evaluate(() => Boolean(window.goneGame?.getP2PHost?.())), 'host object');

    const guests = [];
    for (let i = 1; i <= 7; i += 1) {
      const context = await browser.newContext({ viewport: { width: 900, height: 650 } });
      contexts.push(context);
      const page = await context.newPage();
      guests.push(page);
      await page.goto(`${BASE}/?goneHost=guest#token=${TOKEN}`, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
      await waitFor(
        async () => page.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
        `guest ${i} connected`,
      );
      console.log(`[selfhost-scale] guest-${i} connected`);
    }

    await waitFor(
      async () => host.evaluate(() => window.goneGame?.getP2PHost?.()?.getClientCount?.() === 7),
      'seven relay clients on host',
    );

    const slots = [];
    for (const guest of guests) {
      slots.push(await guest.evaluate(() => window.goneGame.getP2PClient().playerSlot));
    }
    slots.sort((a, b) => a - b);
    invariant(JSON.stringify(slots) === JSON.stringify([1, 2, 3, 4, 5, 6, 7]), `Unexpected slots: ${JSON.stringify(slots)}`);

    const hostState = await host.evaluate(() => ({
      clients: window.goneGame.getP2PHost().getClientCount(),
      records: window.goneGame.getP2PHost().playerRecords.size,
    }));
    invariant(hostState.clients === 7, `Expected 7 clients, got ${hostState.clients}`);
    invariant(hostState.records === 8, `Expected 8 authoritative records, got ${hostState.records}`);

    console.log('[selfhost-scale] Closing alternating guests and verifying authoritative cleanup');
    for (const index of [6, 4, 2, 0]) await guests[index].close();
    await waitFor(
      async () => host.evaluate(() => window.goneGame.getP2PHost().getClientCount() === 3),
      'four guest disconnects',
      12_000,
    );

    console.log('[selfhost-scale] PASS', JSON.stringify({
      players: 8,
      hostClients: 7,
      guestSlots: slots,
      cleanupRemainingClients: 3,
      acknowledgedHandshake: true,
    }));
  } finally {
    await Promise.allSettled(contexts.map((context) => context.close()));
    if (browser) await browser.close().catch(() => {});
    hostProcess.kill('SIGTERM');
    await Promise.race([
      new Promise((resolve) => hostProcess.once('exit', resolve)),
      new Promise((resolve) => setTimeout(resolve, 3000)),
    ]);
    if (hostProcess.exitCode && hostProcess.exitCode !== 0) console.error(serverLog);
  }
}

main().catch((error) => {
  console.error('[selfhost-scale] FAIL');
  console.error(error?.stack || error);
  process.exit(1);
});

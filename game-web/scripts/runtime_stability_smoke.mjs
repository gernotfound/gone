import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => {
  if (!condition) throw new Error(message);
};

async function waitFor(page, predicate, label, timeout = 60_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) {
      last = error;
    }
    await page.waitForTimeout(100);
  }
  throw new Error(`Timeout waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({ viewport: { width: 1100, height: 720 } });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(
    page,
    () => page.evaluate(() => Boolean(window.goneGame?.runtimeSnapshot && window.__goneClientRuntimeStarted)),
    'client runtime bootstrap',
  );

  const duringLaunch = await page.evaluate(() => {
    const button = document.getElementById('btn-enter');
    if (!button) throw new Error('Missing enter button');
    button.click();
    button.click();
    button.click();
    return window.goneGame.runtimeSnapshot();
  });
  assert(duringLaunch.preloadInFlight, 'rapid launch gestures must share one in-flight preload');

  await waitFor(page, () => page.evaluate(() => {
    const runtime = window.goneGame.runtimeSnapshot();
    const gameUi = document.getElementById('game-ui');
    return runtime.hasInitializedGame && !runtime.preloadInFlight && Boolean(gameUi && !gameUi.classList.contains('hidden'));
  }), 'single-flight gameplay initialization', 90_000);

  const ready = await page.evaluate(() => window.goneGame.runtimeSnapshot());
  assert(ready.hasInitializedWasm, 'WASM must initialize');
  assert(ready.hasInitializedGame, 'game runtime must initialize');
  assert(ready.renderLoopStarted, 'render loop must start');
  assert(ready.isGameRunning, 'game runtime must be active');

  const released = await page.evaluate(() => {
    window.goneGame.keys.forward = true;
    window.goneGame.keys.fire = true;
    window.dispatchEvent(new Event('pagehide'));
    return {
      forward: window.goneGame.keys.forward,
      fire: window.goneGame.keys.fire,
    };
  });
  assert(!released.forward && !released.fire, 'pagehide must release held movement and fire inputs');

  await page.evaluate(async () => {
    if (window.gonePwa?.checkForUpdate) {
      await Promise.all([
        window.gonePwa.checkForUpdate(),
        window.gonePwa.checkForUpdate(),
        window.gonePwa.checkForUpdate(),
      ]);
    }
  });

  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);
  console.log('[runtime-stability] PASS', JSON.stringify({ duringLaunch, ready, released }));
  await context.close();
} finally {
  await browser.close();
}

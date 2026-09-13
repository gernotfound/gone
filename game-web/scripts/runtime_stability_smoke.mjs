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
    () => page.evaluate(() => Boolean(
      window.goneGame?.runtimeSnapshot &&
      window.__goneClientRuntimeStarted &&
      window.goneRuntimeHealth?.snapshot &&
      window.goneBrowserLifecycle?.snapshot,
    )),
    'runtime kernel bootstrap',
  );

  await waitFor(page, () => page.evaluate(() => window.goneRuntimeHealth.snapshot().status === 'healthy'), 'healthy runtime graph');
  const bootHealth = await page.evaluate(() => ({
    health: window.goneRuntimeHealth.snapshot(),
    lifecycle: window.goneBrowserLifecycle.snapshot(),
  }));
  assert(bootHealth.health.failed === 0 && bootHealth.health.blocked === 0, 'runtime graph must boot without failed/blocked modules');
  assert(bootHealth.lifecycle.started, 'browser lifecycle broker must be active');
  for (const critical of ['browserLifecycle', 'bootstrap', 'advancedWeaponController']) {
    const module = bootHealth.health.modules.find((candidate) => candidate.name === critical);
    assert(module?.state === 'ready', `critical runtime module ${critical} must be ready`);
  }

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
      lifecycle: window.goneBrowserLifecycle.snapshot(),
    };
  });
  assert(!released.forward && !released.fire, 'pagehide must release held movement and fire inputs');
  assert(released.lifecycle.dispatches > 0, 'pagehide must flow through the lifecycle broker');

  const reconciliation = await page.evaluate(async () => {
    const healthBefore = window.goneRuntimeHealth.snapshot();
    const before = healthBefore.modules.find((module) => module.name === 'smartphoneControlsGuard');
    window.goneInputMode?.setMode?.('screen');
    await new Promise((resolve) => setTimeout(resolve, 50));
    window.goneInputMode?.setMode?.('keyboard');
    await new Promise((resolve) => setTimeout(resolve, 50));
    const healthAfter = window.goneRuntimeHealth.snapshot();
    const after = healthAfter.modules.find((module) => module.name === 'smartphoneControlsGuard');
    return {
      before,
      after,
      healthAfter,
      controlRoots: document.querySelectorAll('#gone-mobile-controls').length,
    };
  });
  assert(reconciliation.before?.attempts === 1, 'touch guard must have exactly one startup attempt before mode changes');
  assert(reconciliation.after?.attempts === 1, 'input mode changes must not restart the touch guard');
  assert(reconciliation.after?.reconciliations >= 2, 'input mode changes must use declared reconciliation');
  assert(reconciliation.controlRoots <= 1, 'reconciliation must never duplicate the touch-control root');
  assert(reconciliation.healthAfter.status === 'healthy', 'runtime must remain healthy after repeated input-mode reconciliation');

  await page.evaluate(async () => {
    if (window.gonePwa?.checkForUpdate) {
      await Promise.all([
        window.gonePwa.checkForUpdate(),
        window.gonePwa.checkForUpdate(),
        window.gonePwa.checkForUpdate(),
      ]);
    }
  });

  const finalHealth = await page.evaluate(() => ({
    runtime: window.goneRuntimeHealth.snapshot(),
    lifecycle: window.goneBrowserLifecycle.snapshot(),
  }));
  assert(finalHealth.runtime.failed === 0 && finalHealth.runtime.blocked === 0, 'runtime health must remain clean after stress actions');
  assert(finalHealth.lifecycle.handlerFailures === 0, 'lifecycle subscribers must not throw during stress actions');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);
  console.log('[runtime-stability] PASS', JSON.stringify({ duringLaunch, ready, released, reconciliation, finalHealth }));
  await context.close();
} finally {
  await browser.close();
}

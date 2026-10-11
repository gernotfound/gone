import { webkit } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const errors = [];

const browser = await webkit.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  try {
    const page = await context.newPage();
    page.on('pageerror', (error) => errors.push(error.message));
    await page.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
    await page.waitForFunction(
      () => Boolean(window.goneRuntimeHealth?.snapshot && window.gonePubgTouchControls?.snapshot?.().attached),
      null,
      { timeout: 60_000 },
    );
    // The HUD is intentionally hidden in the main menu. Validate settings first.
    await page.locator('#btn-settings').click();
    await page.waitForFunction(() => !document.getElementById('settings-menu')?.classList.contains('hidden'));
    assert(await page.locator('#input-mode-setting').isVisible(), 'WebKit settings must expose the input mode');
    assert(await page.locator('#touch-control-settings').isVisible(), 'WebKit settings must expose touch controls');
    await page.locator('#btn-back').click();
    await page.locator('#btn-enter').click();
    await page.waitForFunction(() => {
      const ui = document.getElementById('game-ui');
      return Boolean(ui && !ui.classList.contains('hidden')
        && window.goneGame && window.goneMobileControls?.snapshot?.().gameplayActive);
    }, null, { timeout: 90_000 });

    const state = await page.evaluate(() => {
      const controls = document.getElementById('gone-mobile-controls');
      const fire = document.getElementById('mc-fire');
      const rect = fire?.getBoundingClientRect();
      const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') ?? '';
      return {
        profile: document.documentElement.classList.contains('gone-smartphone'),
        inputMode: document.documentElement.dataset.goneInputMode,
        runtime: window.goneRuntimeHealth?.snapshot?.().status,
        controlsVisible: Boolean(controls && getComputedStyle(controls).display !== 'none'),
        fireVisible: Boolean(rect && rect.width >= 40 && rect.height >= 40),
        fireInsideViewport: Boolean(rect && rect.left >= -2 && rect.right <= innerWidth + 2
          && rect.top >= -2 && rect.bottom <= innerHeight + 2),
        touchAttached: window.gonePubgTouchControls?.snapshot?.().attached,
        safeArea: viewport.includes('viewport-fit=cover'),
      };
    });
    console.log('[mobile-webkit] gameplay state ' + JSON.stringify(state));
    assert(state.profile, 'WebKit mobile smartphone layout missing');
    assert(state.inputMode === 'screen', 'WebKit mobile touch mode missing');
    assert(state.runtime === 'healthy', 'WebKit runtime failed startup');
    assert(state.controlsVisible && state.fireVisible && state.fireInsideViewport, 'WebKit FIRE target is missing or outside viewport');
    assert(state.touchAttached, 'WebKit FIRE drag controller not bound');
    assert(state.safeArea, 'WebKit iOS viewport safe-area metadata missing');

    assert(errors.length === 0, 'WebKit page errors: ' + errors.join('; '));
    console.log('[mobile-webkit] PASS ' + JSON.stringify(state));
  } finally {
    await context.close();
  }
} finally {
  await browser.close();
}

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
    await page.waitForTimeout(150);
  }
  throw new Error(`Timeout waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

async function pointer(page, id, type, pointerId, fx = 0.5, fy = 0.5) {
  await page.evaluate(({ id, type, pointerId, fx, fy }) => {
    const element = document.getElementById(id);
    if (!element) throw new Error(`Missing ${id}`);
    const rect = element.getBoundingClientRect();
    element.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      button: 0,
      buttons: type === 'pointerup' ? 0 : 1,
      clientX: rect.left + rect.width * fx,
      clientY: rect.top + rect.height * fy,
    }));
  }, { id, type, pointerId, fx, fy });
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(window.goneCompetitiveTouchControls?.snapshot)), 'competitive touch runtime');
  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => {
    const ui = document.getElementById('game-ui');
    return Boolean(ui && !ui.classList.contains('hidden') && window.goneGame && window.goneMobileControls?.snapshot?.().gameplayActive);
  }), 'gameplay start', 90_000);

  await page.evaluate(async () => {
    await window.goneGame.switchWeapon(0);
    const key = window.goneGame.getActiveWeapon();
    window.goneWeapons.ammo[key].magazine = 2;
    window.goneWeapons.ammo[key].reserve = 10;
  });
  await page.waitForTimeout(120);

  await pointer(page, 'mc-map', 'pointerdown', 201);
  await pointer(page, 'mc-map', 'pointerup', 201);
  await waitFor(page, () => page.evaluate(() => !document.getElementById('map-ui').classList.contains('hidden')), 'live map open');

  const mapState = await page.evaluate(() => {
    const map = document.getElementById('map-ui');
    const canvas = document.getElementById('minimap-canvas');
    const stick = document.getElementById('mobile-stick');
    const fire = document.getElementById('mc-fire');
    const switcher = document.getElementById('mc-weapon-switcher');
    return {
      competitive: window.goneCompetitiveTouchControls.snapshot(),
      mapBackground: getComputedStyle(map).backgroundColor,
      canvasOpacity: Number(getComputedStyle(canvas).opacity),
      stickVisible: getComputedStyle(stick).display !== 'none',
      fireVisible: getComputedStyle(fire).display !== 'none',
      switcherVisible: getComputedStyle(switcher).display !== 'none',
      pointerLockBridge: document.pointerLockElement === document.body,
    };
  });
  assert(mapState.competitive.mapOpen, 'competitive runtime must see the open live map');
  assert(mapState.stickVisible && mapState.fireVisible && mapState.switcherVisible, 'combat controls must stay visible while map is open');
  assert(mapState.canvasOpacity <= 0.9, `mobile map canvas should be transparent, got ${mapState.canvasOpacity}`);
  assert(mapState.pointerLockBridge, 'on-screen map must preserve the virtual gameplay input lock');

  await pointer(page, 'mobile-stick', 'pointerdown', 202, 0.5, 0.5);
  await pointer(page, 'mobile-stick', 'pointermove', 202, 0.5, 0.02);
  await page.waitForTimeout(100);
  const movingOnMap = await page.evaluate(() => ({
    mobile: window.goneMobileControls.snapshot(),
    competitive: window.goneCompetitiveTouchControls.snapshot(),
  }));
  assert(movingOnMap.mobile.forward, 'joystick must keep forward movement active with map open');
  assert(movingOnMap.competitive.autoSprint, 'forward joystick edge must engage auto sprint');

  const ammoBefore = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine;
  });
  await pointer(page, 'mc-fire', 'pointerdown', 203, 0.5, 0.5);
  await page.waitForTimeout(260);
  await pointer(page, 'mc-fire', 'pointerup', 203, 0.5, 0.5);
  await waitFor(page, () => page.evaluate((before) => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine < before;
  }, ammoBefore), 'map-open fire consumes magazine');
  const ammoAfter = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine;
  });
  assert(ammoAfter >= 0 && ammoAfter < ammoBefore, `map-open fire must use limited magazine ammo (${ammoBefore} -> ${ammoAfter})`);

  await pointer(page, 'mobile-stick', 'pointerup', 202, 0.5, 0.5);
  await page.waitForTimeout(40);
  assert(!(await page.evaluate(() => window.goneMobileControls.snapshot().forward)), 'map-open joystick must release cleanly');

  await pointer(page, 'mc-map', 'pointerdown', 204);
  await pointer(page, 'mc-map', 'pointerup', 204);
  await waitFor(page, () => page.evaluate(() => document.getElementById('map-ui').classList.contains('hidden')), 'live map close');

  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);
  console.log('[competitive-mobile] PASS', JSON.stringify({ ammoBefore, ammoAfter, mapBackground: mapState.mapBackground }));
  await context.close();
} finally {
  await browser.close();
}

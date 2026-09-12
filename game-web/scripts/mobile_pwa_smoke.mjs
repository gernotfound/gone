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
    await page.waitForTimeout(250);
  }
  throw new Error(`Timeout waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

const html = await (await fetch(`${BASE}/`)).text();
assert(html.includes('rel="manifest"') && html.includes('/manifest.webmanifest'), 'manifest link must exist in initial HTML');
assert(html.includes('apple-mobile-web-app-capable'), 'Apple standalone meta must exist in initial HTML');
assert(html.includes('apple-touch-icon'), 'Apple touch icon link must exist in initial HTML');
assert(html.includes('viewport-fit=cover'), 'viewport-fit=cover must exist in initial HTML');

const manifestResponse = await fetch(`${BASE}/manifest.webmanifest`);
assert(manifestResponse.ok, 'manifest.webmanifest must be served');
const manifest = await manifestResponse.json();
assert(manifest.display === 'standalone', 'manifest display must be standalone');
assert(manifest.orientation === 'landscape', 'manifest orientation must be landscape');
assert(Array.isArray(manifest.icons) && manifest.icons.some((icon) => icon.sizes === '192x192'), '192px PWA icon missing');
assert(manifest.icons.some((icon) => icon.sizes === '512x512'), '512px PWA icon missing');

for (const asset of ['/pwa-icon-192.png', '/pwa-icon-512.png', '/apple-touch-icon.png', '/gone-cache-sw.js']) {
  const response = await fetch(`${BASE}${asset}`);
  assert(response.ok, `${asset} must be served`);
}

const browser = await chromium.launch({ headless: true });
try {
  const context = await browser.newContext({
    viewport: { width: 844, height: 390 },
    screen: { width: 844, height: 390 },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: 2,
    userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8 Build/UP1A.231105.003) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') failures.push(`console error: ${message.text()}`);
  });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(window.goneMobileControls?.enabled)), 'mobile runtime');
  await waitFor(page, () => page.evaluate(() => Boolean(window.gonePubgTouchControls?.snapshot?.().attached)), 'PUBG fire-drag controls');

  const boot = await page.evaluate(async () => {
    const registration = await navigator.serviceWorker.ready;
    const viewport = document.querySelector('meta[name="viewport"]')?.getAttribute('content') || '';
    return {
      mobile: window.goneMobileControls?.snapshot?.(),
      pwa: Boolean(window.gonePwa),
      worker: registration.active?.scriptURL || '',
      viewport,
      touchControlsPresent: Boolean(document.getElementById('gone-mobile-controls')),
      smartphoneProfile: document.documentElement.classList.contains('gone-smartphone'),
      deviceProfile: document.documentElement.dataset.goneDevice,
      inputMode: document.documentElement.dataset.goneInputMode,
      touchPreferences: Boolean(window.goneTouchPreferences?.snapshot),
      pubgFireDrag: window.gonePubgTouchControls?.snapshot?.(),
    };
  });
  assert(boot.pwa, 'PWA runtime not initialized');
  assert(boot.touchControlsPresent, 'touch controls not created');
  assert(boot.worker.includes('/gone-cache-sw.js'), 'service worker not active');
  assert(boot.viewport.includes('viewport-fit=cover'), 'safe-area viewport missing');
  assert(boot.mobile?.shimInstalled, 'virtual pointer lock shim missing');
  assert(boot.smartphoneProfile && boot.deviceProfile === 'smartphone', 'smartphone presentation profile must activate on phone context');
  assert(boot.inputMode === 'screen', 'smartphone default input mode must be on-screen controls');
  assert(boot.touchPreferences, 'touch preference API must initialize');
  assert(boot.pubgFireDrag?.enabled && boot.pubgFireDrag?.attached, 'PUBG-style fire-drag layer must attach to the fire button');

  await page.locator('#btn-settings').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('settings-menu').classList.contains('hidden')), 'settings open');
  assert(await page.locator('#input-mode-setting').isVisible(), 'input mode setting must be visible');
  assert(await page.locator('#touch-control-settings').isVisible(), 'touch customization panel must be visible in screen-control mode');

  await page.locator('#touch-look-sensitivity').evaluate((el) => {
    el.value = '1.5';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#touch-ads-sensitivity').evaluate((el) => {
    el.value = '0.8';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#touch-button-scale').evaluate((el) => {
    el.value = '1.2';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#touch-button-opacity').evaluate((el) => {
    el.value = '0.7';
    el.dispatchEvent(new Event('input', { bubbles: true }));
  });
  await page.locator('#touch-handedness-left').click();

  const preferences = await page.evaluate(() => ({
    snapshot: window.goneTouchPreferences.snapshot(),
    leftClass: document.documentElement.classList.contains('gone-touch-left-handed'),
    scale: document.documentElement.style.getPropertyValue('--gone-touch-scale'),
    opacity: document.documentElement.style.getPropertyValue('--gone-touch-opacity'),
    stored: localStorage.getItem('gone-touch-preferences-v1') || '',
  }));
  assert(preferences.snapshot.lookSensitivity === 1.5, 'look sensitivity setting did not apply');
  assert(preferences.snapshot.adsSensitivity === 0.8, 'ADS sensitivity setting did not apply');
  assert(preferences.snapshot.buttonScale === 1.2, 'button scale setting did not apply');
  assert(preferences.snapshot.buttonOpacity === 0.7, 'button opacity setting did not apply');
  assert(preferences.snapshot.handedness === 'left' && preferences.leftClass, 'left-handed layout setting did not apply');
  assert(preferences.scale === '1.2' && preferences.opacity === '0.7', 'touch CSS variables did not update');
  assert(preferences.stored.includes('"handedness":"left"'), 'touch preferences were not persisted');

  await page.locator('#btn-back').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu').classList.contains('hidden')), 'settings close');
  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => {
    const ui = document.getElementById('game-ui');
    return Boolean(ui && !ui.classList.contains('hidden') && window.goneGame && window.goneMobileControls?.snapshot?.().gameplayActive);
  }), 'mobile gameplay start', 90_000);

  const active = await page.evaluate(() => window.goneMobileControls.snapshot());
  assert(active.virtualPointerLock, 'mobile gameplay must satisfy pointer-lock compatibility guard');
  assert(active.dpr === null || active.dpr <= 1.001, `mobile DPR should be <= 1, got ${active.dpr}`);

  const hud = await page.evaluate(() => ['gone-p2p-quality-hud', 'gone-local-telemetry', 'gone-kill-feed'].map((id) => {
    const el = document.getElementById(id);
    return { id, exists: Boolean(el), display: el ? getComputedStyle(el).display : null };
  }));
  for (const item of hud) {
    assert(item.exists, `${item.id} must exist so smartphone hiding is browser-verified`);
    assert(item.display === 'none', `${item.id} must be hidden on smartphone, got ${item.display}`);
  }

  const layout = await page.evaluate(() => {
    const stick = document.getElementById('mobile-stick').getBoundingClientRect();
    const fire = document.getElementById('mc-fire').getBoundingClientRect();
    const look = document.getElementById('mobile-look-pad').getBoundingClientRect();
    return {
      width: window.innerWidth,
      stickCenter: stick.left + stick.width / 2,
      fireCenter: fire.left + fire.width / 2,
      fireWidth: fire.width,
      lookLeft: look.left,
      lookRight: look.right,
    };
  });
  assert(layout.stickCenter > layout.width / 2, 'left-handed layout must move joystick to right half');
  assert(layout.fireCenter < layout.width / 2, 'left-handed layout must move fire control to left half');
  assert(layout.fireWidth >= 76, `PUBG-style primary fire target should be enlarged, got ${layout.fireWidth}`);
  assert(layout.lookLeft <= 1 && layout.lookRight < layout.width * 0.75, 'left-handed look pad must occupy the left interaction zone');

  const sizes = await page.evaluate(() => ['mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-map'].map((id) => {
    const rect = document.getElementById(id).getBoundingClientRect();
    return { id, width: rect.width, height: rect.height };
  }));
  for (const size of sizes) assert(size.width >= 48 && size.height >= 48, `${size.id} touch target is too small`);

  const beforeMove = await page.evaluate(() => window.goneMobileControls.snapshot());
  await page.evaluate(() => {
    const base = document.getElementById('mobile-stick');
    const r = base.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    base.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: x, clientY: y }));
    base.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: x, clientY: y - r.height * 0.35 }));
  });
  await page.waitForTimeout(80);
  assert((await page.evaluate(() => window.goneMobileControls.snapshot())).forward, 'virtual joystick did not set forward movement');
  await page.evaluate(() => {
    const base = document.getElementById('mobile-stick');
    const r = base.getBoundingClientRect();
    base.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 11, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await page.waitForTimeout(30);
  assert(!(await page.evaluate(() => window.goneMobileControls.snapshot())).forward, 'virtual joystick did not release forward movement');
  assert(!beforeMove.forward, 'forward state should start released');

  const yawBefore = await page.evaluate(() => window.goneMobileControls.snapshot().yaw);
  await page.evaluate(() => {
    const pad = document.getElementById('mobile-look-pad');
    const r = pad.getBoundingClientRect();
    const x = r.left + r.width * 0.45;
    const y = r.top + r.height * 0.5;
    pad.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 12, pointerType: 'touch', clientX: x, clientY: y }));
    pad.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 12, pointerType: 'touch', clientX: x + 60, clientY: y + 8 }));
    pad.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 12, pointerType: 'touch', clientX: x + 60, clientY: y + 8 }));
  });
  await page.waitForTimeout(50);
  const yawAfter = await page.evaluate(() => window.goneMobileControls.snapshot().yaw);
  assert(Math.abs(yawAfter - yawBefore) > 0.05, 'touch look did not change yaw');

  await page.waitForTimeout(350);
  const ammoBefore = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return { key, magazine: window.goneWeapons.ammo[key].magazine };
  });
  const fireDragYawBefore = await page.evaluate(() => window.goneMobileControls.snapshot().yaw);
  await page.evaluate(() => {
    const button = document.getElementById('mc-fire');
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: x, clientY: y }));
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: x + 72, clientY: y - 12 }));
  });
  await page.waitForTimeout(90);
  const fireDuringDrag = await page.evaluate(() => ({
    mobile: window.goneMobileControls.snapshot(),
    pubg: window.gonePubgTouchControls.snapshot(),
  }));
  const fireDragYawDuring = fireDuringDrag.mobile.yaw;
  assert(fireDuringDrag.mobile.fire, 'touch fire-drag must keep firing while the same finger rotates the view');
  assert(fireDuringDrag.pubg.pointerActive, 'PUBG fire-drag pointer must remain active while held');
  assert(Math.abs(fireDragYawDuring - fireDragYawBefore) > 0.05, 'touch fire-drag did not rotate yaw while firing');
  await page.evaluate(() => {
    const button = document.getElementById('mc-fire');
    const r = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: r.left + r.width / 2 + 72, clientY: r.top + r.height / 2 - 12 }));
  });
  await page.waitForTimeout(120);
  const afterFireDrag = await page.evaluate(() => ({
    key: window.goneGame.getActiveWeapon(),
    magazine: window.goneWeapons.ammo[window.goneGame.getActiveWeapon()].magazine,
    mobile: window.goneMobileControls.snapshot(),
    pubg: window.gonePubgTouchControls.snapshot(),
  }));
  assert(afterFireDrag.magazine < ammoBefore.magazine, `touch fire did not consume ammo (${ammoBefore.magazine} -> ${afterFireDrag.magazine})`);
  assert(!afterFireDrag.mobile.fire && !afterFireDrag.pubg.pointerActive, 'touch fire-drag must release fire and pointer state');

  await page.locator('#mc-map').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('map-ui').classList.contains('hidden')), 'mobile map open');
  assert((await page.evaluate(() => window.goneMobileControls.snapshot())).mapOpen, 'mobile map state not detected');
  await page.locator('#mc-map').click();
  await waitFor(page, () => page.evaluate(() => document.getElementById('map-ui').classList.contains('hidden')), 'mobile map close');

  await page.locator('#mc-menu').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu').classList.contains('hidden')), 'mobile pause menu');
  const paused = await page.evaluate(() => window.goneMobileControls.snapshot());
  assert(!paused.gameplayActive, 'mobile pause should deactivate gameplay controls');

  if (failures.length) throw new Error(failures.join('\n'));
  console.log('[mobile-pwa] PASS: smartphone profile/HUD, configurable PUBG-like controls, fire-drag aim, left-handed layout, movement/look/fire/map/pause, safe areas and DPR verified.');
  await context.close();
} finally {
  await browser.close();
}

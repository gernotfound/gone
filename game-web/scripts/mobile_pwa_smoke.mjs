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

for (const asset of ['/pwa-icon-192.png', '/pwa-icon-512.png', '/apple-touch-icon.png', '/gone-cache-sw.js', '/Colossus%20March.mp3']) {
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
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
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
      touchLayout: Boolean(window.goneTouchLayout?.snapshot),
      diagnostics: window.goneDiagnostics?.snapshot?.(),
      pubgFireDrag: window.gonePubgTouchControls?.snapshot?.(),
      secondaryFirePresent: Boolean(document.getElementById('mc-fire-left')),
      music: {
        src: document.getElementById('bg-music')?.getAttribute('src') || '',
        inline: document.getElementById('bg-music')?.hasAttribute('playsinline') || false,
      },
    };
  });
  assert(boot.pwa, 'PWA runtime not initialized');
  assert(boot.touchControlsPresent, 'touch controls not created');
  assert(boot.worker.includes('/gone-cache-sw.js'), 'service worker not active');
  assert(boot.viewport.includes('viewport-fit=cover'), 'safe-area viewport missing');
  assert(boot.mobile?.shimInstalled, 'virtual pointer lock shim missing');
  assert(boot.smartphoneProfile && boot.deviceProfile === 'smartphone', 'smartphone presentation profile must activate on iPhone context');
  assert(boot.inputMode === 'screen', 'smartphone default input mode must be on-screen controls');
  assert(boot.touchPreferences, 'touch preference API must initialize');
  assert(boot.touchLayout, 'draggable touch layout API must initialize');
  assert(boot.diagnostics?.buildId, 'privacy-safe client diagnostics must initialize with a build id');
  assert(boot.pubgFireDrag?.enabled && boot.pubgFireDrag?.attached, 'PUBG-style fire-drag layer must attach to the fire button');
  assert(boot.secondaryFirePresent, 'secondary claw FIRE control must be created');
  assert(boot.music.src.includes('Colossus March.mp3') && boot.music.inline, 'iOS music element must keep the BGM and playsinline lifecycle');

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
  await page.locator('#touch-fire-deadzone').evaluate((el) => {
    el.value = '10';
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
    secondaryClass: document.documentElement.classList.contains('gone-touch-secondary-fire'),
    scale: document.documentElement.style.getPropertyValue('--gone-touch-scale'),
    opacity: document.documentElement.style.getPropertyValue('--gone-touch-opacity'),
    stored: localStorage.getItem('gone-touch-preferences-v1') || '',
  }));
  assert(preferences.snapshot.lookSensitivity === 1.5, 'look sensitivity setting did not apply');
  assert(preferences.snapshot.adsSensitivity === 0.8, 'ADS sensitivity setting did not apply');
  assert(preferences.snapshot.fireDragDeadZone === 10, 'FIRE drag dead-zone setting did not apply');
  assert(preferences.snapshot.buttonScale === 1.2, 'button scale setting did not apply');
  assert(preferences.snapshot.buttonOpacity === 0.7, 'button opacity setting did not apply');
  assert(preferences.snapshot.handedness === 'left' && preferences.leftClass, 'left-handed layout setting did not apply');
  assert(preferences.snapshot.secondaryFire && preferences.secondaryClass, 'secondary claw FIRE preference did not apply');
  assert(preferences.scale === '1.2' && preferences.opacity === '0.7', 'touch CSS variables did not update');
  assert(preferences.stored.includes('"handedness":"left"'), 'touch preferences were not persisted');
  assert(await page.locator('#touch-layout-edit').isVisible(), 'draggable layout editor entry point must be visible');

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
    const secondary = document.getElementById('mc-fire-left').getBoundingClientRect();
    const look = document.getElementById('mobile-look-pad').getBoundingClientRect();
    return {
      width: window.innerWidth,
      stickCenter: stick.left + stick.width / 2,
      fireCenter: fire.left + fire.width / 2,
      fireWidth: fire.width,
      secondaryWidth: secondary.width,
      lookLeft: look.left,
      lookRight: look.right,
    };
  });
  assert(layout.stickCenter > layout.width / 2, 'left-handed layout must move joystick to right half');
  assert(layout.fireCenter < layout.width / 2, 'left-handed layout must move primary fire control to left half');
  assert(layout.fireWidth >= 76, `PUBG-style primary fire target should be enlarged, got ${layout.fireWidth}`);
  assert(layout.secondaryWidth >= 48, `secondary claw FIRE target should be >=48px, got ${layout.secondaryWidth}`);
  assert(layout.lookLeft <= 1 && layout.lookRight < layout.width * 0.75, 'left-handed look pad must occupy the left interaction zone');

  const sizes = await page.evaluate(() => ['mc-fire', 'mc-fire-left', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-map'].map((id) => {
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

  // Capture-phase pointer actions are used instead of relying on delayed iOS click synthesis.
  await page.evaluate(async () => { await window.goneGame.switchWeapon(0); });
  await page.waitForTimeout(120);
  const weaponIndexBefore = await page.evaluate(() => window.goneGame.getActiveWeaponIndex());
  await page.evaluate(() => {
    const button = document.getElementById('mc-next');
    const r = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 31, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  await waitFor(page, () => page.evaluate((before) => window.goneGame.getActiveWeaponIndex() !== before, weaponIndexBefore), 'mobile weapon switch');

  await page.evaluate(async () => { await window.goneGame.switchWeapon(0); });
  await page.waitForTimeout(120);
  await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    const cfg = window.goneWeapons.config[key];
    window.goneWeapons.ammo[key].magazine = Math.max(1, cfg.magazineSize - 5);
    window.goneWeapons.ammo[key].reserve = 20;
  });
  await page.evaluate(() => {
    const button = document.getElementById('mc-reload');
    const r = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 32, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 32, pointerType: 'touch', clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  });
  assert(await page.evaluate(() => window.goneWeapons.isReloading()), 'mobile reload pointer action must start reload immediately');
  await waitFor(page, () => page.evaluate(() => !window.goneWeapons.isReloading()), 'mobile reload completion', 8_000);
  const reloaded = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return { state: window.goneWeapons.ammo[key], cfg: window.goneWeapons.config[key] };
  });
  assert(reloaded.state.magazine === reloaded.cfg.magazineSize, 'reload must restore the magazine to its configured size');
  assert(reloaded.state.reserve < 20, 'reload must consume reserve ammunition');

  // Regression: sustained touch FIRE must not bypass advancedWeaponController ammo accounting.
  await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    window.goneWeapons.ammo[key].magazine = 2;
    window.goneWeapons.ammo[key].reserve = 0;
  });
  const fireDragYawBefore = await page.evaluate(() => window.goneMobileControls.snapshot().yaw);
  await page.evaluate(() => {
    const button = document.getElementById('mc-fire');
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: x, clientY: y }));
    // First movement stays inside the configured 10px dead-zone.
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: x + 4, clientY: y + 2 }));
  });
  await page.waitForTimeout(30);
  const yawInsideDeadZone = await page.evaluate(() => window.goneMobileControls.snapshot().yaw);
  assert(Math.abs(yawInsideDeadZone - fireDragYawBefore) < 0.02, 'small FIRE movement inside dead-zone must not rotate the camera');
  await page.evaluate(() => {
    const button = document.getElementById('mc-fire');
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    button.dispatchEvent(new PointerEvent('pointermove', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: x + 72, clientY: y - 12 }));
  });
  await page.waitForTimeout(850);
  const fireDuringDrag = await page.evaluate(() => ({
    magazine: window.goneWeapons.ammo[window.goneGame.getActiveWeapon()].magazine,
    inputFire: window.goneMobileControls.snapshot().fire,
    pubg: window.gonePubgTouchControls.snapshot(),
    yaw: window.goneMobileControls.snapshot().yaw,
  }));
  assert(fireDuringDrag.pubg.fireActive, 'PUBG touch layer must keep trigger ownership while FIRE is held');
  assert(!fireDuringDrag.inputFire, 'legacy continuous inputState.fire path must stay disabled so it cannot bypass magazines');
  assert(fireDuringDrag.magazine === 0, `limited magazine must stop exactly at zero, got ${fireDuringDrag.magazine}`);
  assert(Math.abs(fireDuringDrag.yaw - fireDragYawBefore) > 0.05, 'touch fire-drag did not rotate yaw while firing');
  await page.waitForTimeout(400);
  assert(await page.evaluate(() => window.goneWeapons.ammo[window.goneGame.getActiveWeapon()].magazine === 0), 'holding FIRE on an empty magazine must not create infinite ammo');
  await page.evaluate(() => {
    const button = document.getElementById('mc-fire');
    const r = button.getBoundingClientRect();
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 13, pointerType: 'touch', clientX: r.left + r.width / 2 + 72, clientY: r.top + r.height / 2 - 12 }));
  });
  await page.waitForTimeout(80);
  const afterFireDrag = await page.evaluate(() => window.gonePubgTouchControls.snapshot());
  assert(!afterFireDrag.fireActive && !afterFireDrag.pointerActive, 'touch fire-drag must release trigger and pointer state');

  await page.locator('#mc-map').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('map-ui').classList.contains('hidden')), 'mobile map open');
  assert((await page.evaluate(() => window.goneMobileControls.snapshot())).mapOpen, 'mobile map state not detected');
  await page.locator('#mc-map').click();
  await waitFor(page, () => page.evaluate(() => document.getElementById('map-ui').classList.contains('hidden')), 'mobile map close');

  // Network churn smoke: browser offline must clear touch input; online must schedule resume.
  const resumesBefore = await page.evaluate(() => window.goneMobileResume?.snapshot?.().resumes ?? 0);
  await context.setOffline(true);
  await waitFor(page, () => page.evaluate(() => window.goneMobileResume?.snapshot?.().lastReason === 'offline'), 'mobile offline suspension');
  assert(!(await page.evaluate(() => window.gonePubgTouchControls.snapshot().fireActive)), 'offline transition must release FIRE');
  await context.setOffline(false);
  await waitFor(page, () => page.evaluate((before) => {
    const state = window.goneMobileResume?.snapshot?.();
    return navigator.onLine && state && state.resumes > before;
  }, resumesBefore), 'mobile online resume', 8_000);

  await page.locator('#mc-menu').click();
  await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu').classList.contains('hidden')), 'mobile pause menu');
  const paused = await page.evaluate(() => window.goneMobileControls.snapshot());
  assert(!paused.gameplayActive, 'mobile pause should deactivate gameplay controls');

  if (failures.length) throw new Error(failures.join('\n'));
  console.log('[mobile-pwa] PASS: iPhone profile/audio lifecycle, PUBG v2 controls, reliable reload/weapon switch, finite magazines, network resume, HUD/safe areas and DPR verified.');
  await context.close();
} finally {
  await browser.close();
}
import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const LOCAL_UI_TIMEOUT = 8_000;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

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

function scaleFrom(transform) {
  const match = String(transform || '').match(/scaleX\(([\d.]+)\)/);
  return match ? Number(match[1]) : Number.NaN;
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
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console error: ${message.text()}`); });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(
    window.goneMobileControls?.enabled
    && window.goneWeapons?.getReloadProgress
    && document.getElementById('mc-reload')
  )), 'mobile weapon runtime');

  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => {
    const ui = document.getElementById('game-ui');
    return Boolean(ui && !ui.classList.contains('hidden') && window.goneMobileControls?.snapshot?.().gameplayActive);
  }), 'mobile gameplay start', 90_000);

  await page.evaluate(async () => { await window.goneGame.switchWeapon(0); });
  await waitFor(page, () => page.evaluate(() => window.goneGame.getActiveWeaponIndex() === 0), 'assault weapon selection', LOCAL_UI_TIMEOUT);
  await page.waitForTimeout(120);

  const prepared = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    const cfg = window.goneWeapons.config[key];
    const state = window.goneWeapons.ammo[key];
    state.magazine = Math.max(1, cfg.magazineSize - 5);
    state.reserve = 20;

    const hud = document.getElementById('advanced-weapon-hud');
    const track = document.getElementById('advanced-weapon-reload-track');
    const fill = document.getElementById('advanced-weapon-reload-fill');
    if (!hud || !track || !fill) throw new Error('Reload progress DOM missing');
    return {
      key,
      magazineSize: cfg.magazineSize,
      reloadStyle: cfg.reloadStyle,
      reloadSeconds: cfg.reloadSeconds,
      hudHeight: hud.getBoundingClientRect().height,
      trackOpacity: track.style.opacity,
      trackPosition: getComputedStyle(track).position,
      trackHeight: track.getBoundingClientRect().height,
      fillTransform: fill.style.transform,
      secondaryStillLast: hud.lastElementChild !== track,
    };
  });

  assert(prepared.reloadStyle !== 'none', 'smoke weapon must support reload');
  assert(prepared.trackOpacity === '0', `idle reload track must be hidden, got ${prepared.trackOpacity}`);
  assert(prepared.trackPosition === 'absolute', `reload track must be absolute, got ${prepared.trackPosition}`);
  assert(prepared.trackHeight <= 4, `reload track must stay compact, got ${prepared.trackHeight}px`);
  assert(prepared.secondaryStillLast, 'reload track must not steal the mobile HUD last-child text slot');
  assert(scaleFrom(prepared.fillTransform) === 0, `idle reload fill must start at zero, got ${prepared.fillTransform}`);

  await page.evaluate(() => {
    const button = document.getElementById('mc-reload');
    const r = button.getBoundingClientRect();
    const x = r.left + r.width / 2;
    const y = r.top + r.height / 2;
    button.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, cancelable: true, pointerId: 72, pointerType: 'touch', clientX: x, clientY: y }));
    button.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, cancelable: true, pointerId: 72, pointerType: 'touch', clientX: x, clientY: y }));
  });
  await waitFor(page, () => page.evaluate(() => window.goneWeapons.isReloading()), 'touch reload start', LOCAL_UI_TIMEOUT);

  const started = await page.evaluate(() => {
    const hud = document.getElementById('advanced-weapon-hud');
    const track = document.getElementById('advanced-weapon-reload-track');
    const fill = document.getElementById('advanced-weapon-reload-fill');
    return {
      progress: window.goneWeapons.getReloadProgress(),
      trackOpacity: track.style.opacity,
      fillTransform: fill.style.transform,
      hudHeight: hud.getBoundingClientRect().height,
    };
  });
  assert(started.trackOpacity === '1', `active reload track must be visible, got ${started.trackOpacity}`);
  assert(started.progress >= 0 && started.progress < 1, `reload progress must begin in [0,1), got ${started.progress}`);
  assert(Math.abs(started.hudHeight - prepared.hudHeight) <= 1.5,
    `reload bar must not grow HUD height (${prepared.hudHeight} -> ${started.hudHeight})`);

  await waitFor(page, () => page.evaluate((initial) => {
    const progress = window.goneWeapons.getReloadProgress();
    return progress > Math.max(0.08, initial + 0.05) && progress < 0.98;
  }, started.progress), 'reload progress advance', LOCAL_UI_TIMEOUT);

  const mid = await page.evaluate(() => {
    const hud = document.getElementById('advanced-weapon-hud');
    const track = document.getElementById('advanced-weapon-reload-track');
    const fill = document.getElementById('advanced-weapon-reload-fill');
    return {
      progress: window.goneWeapons.getReloadProgress(),
      fillTransform: fill.style.transform,
      trackOpacity: track.style.opacity,
      hudHeight: hud.getBoundingClientRect().height,
    };
  });
  const fillScale = scaleFrom(mid.fillTransform);
  assert(mid.trackOpacity === '1', 'reload track must stay visible while reloading');
  assert(mid.progress > started.progress, `reload progress must advance (${started.progress} -> ${mid.progress})`);
  assert(Number.isFinite(fillScale) && Math.abs(fillScale - mid.progress) <= 0.08,
    `reload fill must mirror canonical progress (${fillScale} vs ${mid.progress})`);
  assert(Math.abs(mid.hudHeight - prepared.hudHeight) <= 1.5,
    `mid-reload HUD height must remain stable (${prepared.hudHeight} -> ${mid.hudHeight})`);

  await waitFor(page, () => page.evaluate(() => !window.goneWeapons.isReloading()), 'reload completion', 8_000);
  const finished = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    const state = window.goneWeapons.ammo[key];
    const track = document.getElementById('advanced-weapon-reload-track');
    const fill = document.getElementById('advanced-weapon-reload-fill');
    const hud = document.getElementById('advanced-weapon-hud');
    return {
      magazine: state.magazine,
      reserve: state.reserve,
      progress: window.goneWeapons.getReloadProgress(),
      trackOpacity: track.style.opacity,
      fillTransform: fill.style.transform,
      hudHeight: hud.getBoundingClientRect().height,
    };
  });

  assert(finished.magazine === prepared.magazineSize, `reload must fill magazine, got ${finished.magazine}/${prepared.magazineSize}`);
  assert(finished.reserve < 20, `reload must consume reserve ammo, got ${finished.reserve}`);
  assert(finished.progress === 0, `idle progress must reset to zero, got ${finished.progress}`);
  assert(finished.trackOpacity === '0', `reload track must hide after completion, got ${finished.trackOpacity}`);
  assert(scaleFrom(finished.fillTransform) === 0, `reload fill must reset after completion, got ${finished.fillTransform}`);
  assert(Math.abs(finished.hudHeight - prepared.hudHeight) <= 1.5,
    `completed reload must preserve HUD height (${prepared.hudHeight} -> ${finished.hudHeight})`);
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-reload-progress] PASS', JSON.stringify({
    weapon: prepared.key,
    reloadStyle: prepared.reloadStyle,
    reloadSeconds: prepared.reloadSeconds,
    startProgress: started.progress,
    midProgress: mid.progress,
    hudHeight: prepared.hudHeight,
  }));
  await context.close();
} finally {
  await browser.close();
}

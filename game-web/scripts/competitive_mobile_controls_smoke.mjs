import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const CASES = [
  { name: 'compact', width: 740, height: 360, dpr: 2 },
  { name: 'iphone', width: 844, height: 390, dpr: 2 },
  { name: 'large', width: 932, height: 430, dpr: 2 },
];

async function waitFor(page, predicate, label, timeout = 60_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) { last = error; }
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
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: rect.left + rect.width * fx,
      clientY: rect.top + rect.height * fy,
    }));
  }, { id, type, pointerId, fx, fy });
}

function overlaps(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

async function startPhoneGame(browser, spec) {
  const context = await browser.newContext({
    viewport: { width: spec.width, height: spec.height },
    screen: { width: spec.width, height: spec.height },
    hasTouch: true,
    isMobile: true,
    deviceScaleFactor: spec.dpr,
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_6 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.6 Mobile/15E148 Safari/604.1',
  });
  const page = await context.newPage();
  page.on('pageerror', (error) => failures.push(`${spec.name} pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`${spec.name} console error: ${message.text()}`); });
  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(window.goneCompetitiveTouchControls?.snapshot)), `${spec.name} competitive touch runtime`);
  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => {
    const ui = document.getElementById('game-ui');
    const compass = document.getElementById('gone-combat-compass');
    return Boolean(ui && !ui.classList.contains('hidden') && compass?.dataset.bearing && window.goneGame && window.goneMobileControls?.snapshot?.().gameplayActive);
  }), `${spec.name} gameplay start`, 90_000);
  return { context, page };
}

async function assertResponsiveLayout(page, spec) {
  const layout = await page.evaluate(() => {
    const ids = [
      'mobile-stick', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch',
      'mc-menu', 'mc-map', 'mc-weapon-switcher', 'health-hud', 'advanced-weapon-hud',
      'gone-combat-compass', 'mobile-look-pad',
    ];
    const rects = {};
    for (const id of ids) {
      const element = document.getElementById(id);
      if (!element) { rects[id] = null; continue; }
      const rect = element.getBoundingClientRect();
      rects[id] = { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height };
    }
    return { width: innerWidth, height: innerHeight, rects };
  });

  const r = layout.rects;
  for (const id of ['mobile-stick', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch', 'mc-menu', 'mc-map', 'mc-weapon-switcher', 'health-hud', 'advanced-weapon-hud', 'gone-combat-compass']) {
    const rect = r[id];
    assert(rect, `${spec.name}: ${id} must exist`);
    assert(rect.left >= -2 && rect.top >= -2 && rect.right <= layout.width + 2 && rect.bottom <= layout.height + 2, `${spec.name}: ${id} escaped viewport ${JSON.stringify(rect)}`);
  }

  for (const id of ['mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch', 'mc-menu', 'mc-map']) {
    const rect = r[id];
    assert(rect.width >= 47.5 && rect.height >= 47.5, `${spec.name}: ${id} target below 48px (${rect.width}x${rect.height})`);
  }

  const center = layout.width / 2;
  const centerOf = (rect) => rect.left + rect.width / 2;
  assert(centerOf(r['mobile-stick']) < layout.width * 0.28, `${spec.name}: movement stick must stay in left thumb zone`);
  assert(centerOf(r['mc-fire']) > layout.width * 0.72, `${spec.name}: FIRE must stay in right thumb zone`);
  assert(Math.abs(centerOf(r['health-hud']) - center) <= 3, `${spec.name}: health must stay centered`);
  assert(Math.abs(centerOf(r['advanced-weapon-hud']) - center) <= 3, `${spec.name}: ammo HUD must stay centered`);
  assert(Math.abs(centerOf(r['mc-weapon-switcher']) - center) <= 3, `${spec.name}: weapon switcher must stay centered`);
  assert(Math.abs(centerOf(r['gone-combat-compass']) - center) <= 3, `${spec.name}: compass must stay centered`);
  assert(r['gone-combat-compass'].top < 40, `${spec.name}: compass must stay in upper navigation band`);
  assert(r['mobile-look-pad'].width >= layout.width * 0.64, `${spec.name}: swipe-look region must remain broad`);

  for (const thumb of ['mobile-stick', 'mc-fire']) {
    assert(!overlaps(r[thumb], r['health-hud']), `${spec.name}: ${thumb} overlaps health HUD`);
    assert(!overlaps(r[thumb], r['advanced-weapon-hud']), `${spec.name}: ${thumb} overlaps ammo HUD`);
    assert(!overlaps(r[thumb], r['mc-weapon-switcher']), `${spec.name}: ${thumb} overlaps weapon switcher`);
  }

  const stackPairs = [
    ['mc-weapon-switcher', 'advanced-weapon-hud'],
    ['advanced-weapon-hud', 'health-hud'],
    ['mc-weapon-switcher', 'health-hud'],
  ];
  for (const [upper, lower] of stackPairs) {
    assert(!overlaps(r[upper], r[lower]), `${spec.name}: lower-center stack overlap between ${upper} and ${lower}`);
  }
  assert(r['mc-weapon-switcher'].bottom <= r['advanced-weapon-hud'].top + 0.5, `${spec.name}: weapon switcher must sit above ammo HUD`);
  assert(r['advanced-weapon-hud'].bottom <= r['health-hud'].top + 0.5, `${spec.name}: ammo HUD must sit above health HUD`);
  assert(r['advanced-weapon-hud'].height <= 46, `${spec.name}: ammo HUD wrapped into desktop-height content (${r['advanced-weapon-hud'].height}px)`);

  assert(!overlaps(r['gone-combat-compass'], r['mc-menu']), `${spec.name}: compass overlaps menu`);
  assert(!overlaps(r['gone-combat-compass'], r['mc-map']), `${spec.name}: compass overlaps map button`);
  assert(r['gone-combat-compass'].bottom < r['mc-weapon-switcher'].top, `${spec.name}: navigation and weapon bands must remain separated`);
  return layout;
}

async function assertCompassTracksLook(page, label) {
  const before = await page.evaluate(() => Number(document.getElementById('gone-combat-compass')?.dataset.bearing ?? NaN));
  await pointer(page, 'mobile-look-pad', 'pointerdown', 151, 0.62, 0.45);
  await pointer(page, 'mobile-look-pad', 'pointermove', 151, 0.78, 0.45);
  await pointer(page, 'mobile-look-pad', 'pointerup', 151, 0.78, 0.45);
  await waitFor(page, () => page.evaluate((previous) => {
    const next = Number(document.getElementById('gone-combat-compass')?.dataset.bearing ?? NaN);
    return Number.isFinite(next) && Math.abs(next - previous) > 0.25;
  }, before), `${label} compass heading response`);
}

async function assertLiveMapCombat(page) {
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
  const movingOnMap = await page.evaluate(() => ({ mobile: window.goneMobileControls.snapshot(), competitive: window.goneCompetitiveTouchControls.snapshot() }));
  assert(movingOnMap.mobile.forward, 'joystick must keep forward movement active with map open');
  assert(movingOnMap.competitive.autoSprint, 'forward joystick edge must engage auto sprint');

  const ammoBefore = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine;
  });
  await pointer(page, 'mc-fire', 'pointerdown', 203);
  await page.waitForTimeout(260);
  await pointer(page, 'mc-fire', 'pointerup', 203);
  await waitFor(page, () => page.evaluate((before) => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine < before;
  }, ammoBefore), 'map-open fire consumes magazine');
  const ammoAfter = await page.evaluate(() => {
    const key = window.goneGame.getActiveWeapon();
    return window.goneWeapons.ammo[key].magazine;
  });
  assert(ammoAfter >= 0 && ammoAfter < ammoBefore, `map-open fire must use limited magazine ammo (${ammoBefore} -> ${ammoAfter})`);

  await pointer(page, 'mobile-stick', 'pointerup', 202);
  await page.waitForTimeout(40);
  assert(!(await page.evaluate(() => window.goneMobileControls.snapshot().forward)), 'map-open joystick must release cleanly');
  await pointer(page, 'mc-map', 'pointerdown', 204);
  await pointer(page, 'mc-map', 'pointerup', 204);
  await waitFor(page, () => page.evaluate(() => document.getElementById('map-ui').classList.contains('hidden')), 'live map close');
  return { ammoBefore, ammoAfter, mapBackground: mapState.mapBackground };
}

const browser = await chromium.launch({ headless: true });
const summaries = [];
try {
  for (const spec of CASES) {
    const { context, page } = await startPhoneGame(browser, spec);
    try {
      const layout = await assertResponsiveLayout(page, spec);
      await assertCompassTracksLook(page, spec.name);
      const combat = spec.name === 'iphone' ? await assertLiveMapCombat(page) : null;
      summaries.push({ name: spec.name, viewport: `${spec.width}x${spec.height}`, layout, combat });
    } finally {
      await context.close();
    }
  }
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);
  console.log('[competitive-mobile] PASS', JSON.stringify(summaries));
} finally {
  await browser.close();
}

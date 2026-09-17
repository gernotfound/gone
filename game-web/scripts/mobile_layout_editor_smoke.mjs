import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const LEGACY_KEY = 'gone-touch-layout-v1';
const STORAGE_KEY = 'gone-touch-layout-v2';
const LEGACY_RELOAD = { x: -84, y: -18 };
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const LOCAL_UI_TIMEOUT = 5_000;

async function waitFor(page, predicate, label, timeout = 60_000) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) { last = error; }
    await page.waitForTimeout(120);
  }
  throw new Error(`Timeout waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

async function applyDeviceMetrics(page, cdp, width, height, label) {
  const landscape = width > height;
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: {
      type: landscape ? 'landscapePrimary' : 'portraitPrimary',
      angle: landscape ? 90 : 0,
    },
  });
  await waitFor(page, () => page.evaluate(({ width: w, height: h }) => innerWidth === w && innerHeight === h, { width, height }), `${label} viewport`, LOCAL_UI_TIMEOUT);
  await page.waitForTimeout(160);
}

async function layoutState(page, id) {
  return page.evaluate((targetId) => {
    const snapshot = window.goneTouchLayout?.snapshot?.();
    const element = document.getElementById(targetId);
    const rect = element?.getBoundingClientRect();
    const stored = snapshot?.offsets?.[targetId] ?? null;
    const applied = snapshot?.appliedOffsets?.[targetId] ?? null;
    return {
      width: innerWidth,
      height: innerHeight,
      stored,
      applied,
      expected: stored ? { x: stored.x * innerWidth, y: stored.y * innerHeight } : null,
      rect: rect ? { left: rect.left, right: rect.right, top: rect.top, bottom: rect.bottom, width: rect.width, height: rect.height } : null,
      editing: snapshot?.editing ?? false,
    };
  }, id);
}

function assertBounded(state, label) {
  assert(state.rect, `${label}: element rect missing`);
  assert(state.rect.width > 0 && state.rect.height > 0, `${label}: control must be visible while geometry is inspected ${JSON.stringify(state.rect)}`);
  assert(state.rect.left >= 7 && state.rect.top >= 7 && state.rect.right <= state.width - 7 && state.rect.bottom <= state.height - 7,
    `${label}: custom control escaped safe viewport bounds ${JSON.stringify(state.rect)}`);
}

function assertScaled(state, label, tolerance = 3) {
  assert(state.stored && state.applied && state.expected, `${label}: normalized and applied offsets must exist`);
  assert(Math.abs(state.applied.x - state.expected.x) <= tolerance,
    `${label}: horizontal offset did not scale with viewport (${state.applied.x} vs ${state.expected.x})`);
  assert(Math.abs(state.applied.y - state.expected.y) <= tolerance,
    `${label}: vertical offset did not scale with viewport (${state.applied.y} vs ${state.expected.y})`);
  assertBounded(state, label);
}

async function reopenEditorForGeometry(page) {
  await page.evaluate(() => window.goneTouchLayout.edit());
  await waitFor(page, () => page.evaluate(() => (
    window.goneTouchLayout.snapshot().editing
    && document.documentElement.classList.contains('gone-touch-layout-edit')
    && document.getElementById('mc-reload')?.getBoundingClientRect().width > 0
  )), 'reopened touch layout editor', LOCAL_UI_TIMEOUT);
}

async function dragSwitcherThroughSlot(page, dx, dy) {
  return page.evaluate(({ dx, dy }) => {
    const api = window.goneTouchLayout;
    api.edit();
    const slot = document.getElementById('mc-weapon-slot-2');
    const switcher = document.getElementById('mc-weapon-switcher');
    if (!slot || !switcher) throw new Error('Missing quick-slot editor targets');
    const members = [switcher, ...document.querySelectorAll('#mc-weapon-slots .mc-weapon-slot')];
    const before = members.map((element) => {
      const rect = element.getBoundingClientRect();
      return { id: element.id, left: rect.left, top: rect.top };
    });
    const rect = slot.getBoundingClientRect();
    const startX = rect.left + rect.width / 2;
    const startY = rect.top + rect.height / 2;
    const dispatch = (type, x, y, buttons) => slot.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId: 601,
      pointerType: 'touch',
      button: 0,
      buttons,
      clientX: x,
      clientY: y,
    }));
    dispatch('pointerdown', startX, startY, 1);
    dispatch('pointermove', startX + dx, startY + dy, 1);
    dispatch('pointerup', startX + dx, startY + dy, 0);
    const after = members.map((element) => {
      const next = element.getBoundingClientRect();
      return { id: element.id, left: next.left, top: next.top };
    });
    api.done();
    return { before, after, snapshot: api.snapshot() };
  }, { dx, dy });
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
  await context.addInitScript(({ key, value }) => {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* opaque initial document */ }
  }, { key: LEGACY_KEY, value: { 'mc-reload': LEGACY_RELOAD } });

  const page = await context.newPage();
  const cdp = await context.newCDPSession(page);
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console error: ${message.text()}`); });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(window.goneTouchLayout?.snapshot && window.goneTouchPreferences?.set)), 'touch layout editor');
  const migration = await page.evaluate(({ storageKey }) => ({
    snapshot: window.goneTouchLayout.snapshot(),
    persisted: JSON.parse(localStorage.getItem(storageKey) || 'null'),
    width: innerWidth,
    height: innerHeight,
  }), { storageKey: STORAGE_KEY });
  assert(migration.snapshot.normalized === true && migration.snapshot.storageKey === STORAGE_KEY,
    'layout editor must advertise normalized v2 persistence');
  assert(migration.persisted?.['mc-reload'], 'legacy pixel layout must be migrated and persisted as v2');
  assert(Math.abs(migration.persisted['mc-reload'].x - LEGACY_RELOAD.x / migration.width) < 0.01,
    'legacy horizontal pixels must migrate to viewport-normalized offset');
  assert(Math.abs(migration.persisted['mc-reload'].y - LEGACY_RELOAD.y / migration.height) < 0.01,
    'legacy vertical pixels must migrate to viewport-normalized offset');

  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => Boolean(
    window.goneMobileControls?.snapshot?.().gameplayActive
    && document.getElementById('mc-reload')
    && document.getElementById('mc-weapon-slot-4')
  )), 'gameplay touch controls', 90_000);
  await page.waitForTimeout(160);

  const initialReload = await layoutState(page, 'mc-reload');
  assertScaled(initialReload, 'migrated reload at 844x390');
  const normalizedReload = { ...initialReload.stored };

  const drag = await dragSwitcherThroughSlot(page, 54, -12);
  assert(drag.snapshot.offsets['mc-weapon-switcher'], 'dragging a quick slot must persist the switcher as one group');
  assert(!drag.snapshot.offsets['mc-weapon-slot-2'], 'quick slots must not acquire independent layout offsets');
  const beforeById = Object.fromEntries(drag.before.map((item) => [item.id, item]));
  for (const item of drag.after) {
    const before = beforeById[item.id];
    assert(before, `missing pre-drag geometry for ${item.id}`);
    assert(Math.abs((item.left - before.left) - 54) <= 2, `${item.id}: quick-slot group horizontal drag diverged`);
    assert(Math.abs((item.top - before.top) + 12) <= 2, `${item.id}: quick-slot group vertical drag diverged`);
  }
  const normalizedSwitcher = { ...drag.snapshot.offsets['mc-weapon-switcher'] };

  // done() intentionally returns to Settings and hides gameplay controls. Reopen the
  // editor before geometry assertions so the smoke validates persisted layout data,
  // not zero-sized controls hidden behind the settings menu.
  await reopenEditorForGeometry(page);

  for (const spec of [
    { name: 'compact', width: 740, height: 360 },
    { name: 'large', width: 932, height: 430 },
    { name: 'restore', width: 844, height: 390 },
  ]) {
    await applyDeviceMetrics(page, cdp, spec.width, spec.height, spec.name);
    assertScaled(await layoutState(page, 'mc-reload'), `${spec.name} reload`);
    assertScaled(await layoutState(page, 'mc-weapon-switcher'), `${spec.name} switcher`);
  }

  await page.evaluate(() => window.goneTouchPreferences.set({ handedness: 'left' }));
  await waitFor(page, () => page.evaluate(() => document.documentElement.dataset.goneTouchHandedness === 'left'), 'left-handed custom layout', LOCAL_UI_TIMEOUT);
  await page.waitForTimeout(160);
  const leftReload = await layoutState(page, 'mc-reload');
  assertBounded(leftReload, 'left-handed migrated reload clamp');
  assert(Math.abs(leftReload.stored.x - normalizedReload.x) < 0.0001 && Math.abs(leftReload.stored.y - normalizedReload.y) < 0.0001,
    'temporary left-edge clamp must not destroy normalized reload intent');
  assert(Math.abs(leftReload.applied.x - leftReload.expected.x) > 20,
    'left-handed edge case must exercise a non-destructive viewport clamp');

  await page.evaluate(() => window.goneTouchPreferences.set({ handedness: 'right' }));
  await waitFor(page, () => page.evaluate(() => document.documentElement.dataset.goneTouchHandedness === 'right'), 'right-handed custom layout restore', LOCAL_UI_TIMEOUT);
  await page.waitForTimeout(160);
  const restoredReload = await layoutState(page, 'mc-reload');
  assertScaled(restoredReload, 'right-handed reload after clamped mirror');
  assert(Math.abs(restoredReload.stored.x - normalizedReload.x) < 0.0001 && Math.abs(restoredReload.stored.y - normalizedReload.y) < 0.0001,
    'right-handed restore must preserve original normalized reload intent');

  await applyDeviceMetrics(page, cdp, 390, 844, 'portrait custom layout');
  const portraitReload = await layoutState(page, 'mc-reload');
  assertBounded(portraitReload, 'portrait custom reload');
  assert(Math.abs(portraitReload.stored.x - normalizedReload.x) < 0.0001,
    'portrait clamp/reflow must not rewrite stored normalized layout');

  await applyDeviceMetrics(page, cdp, 844, 390, 'final landscape restore');
  assertScaled(await layoutState(page, 'mc-reload'), 'final landscape reload');
  const finalSwitcher = await layoutState(page, 'mc-weapon-switcher');
  assert(Math.abs(finalSwitcher.stored.x - normalizedSwitcher.x) < 0.0001 && Math.abs(finalSwitcher.stored.y - normalizedSwitcher.y) < 0.0001,
    'switcher normalized drag intent must survive resize/orientation cycles');

  const reset = await page.evaluate(({ storageKey }) => {
    window.goneTouchLayout.reset();
    const result = {
      snapshot: window.goneTouchLayout.snapshot(),
      persisted: JSON.parse(localStorage.getItem(storageKey) || 'null'),
    };
    window.goneTouchLayout.done();
    return result;
  }, { storageKey: STORAGE_KEY });
  assert(Object.keys(reset.snapshot.offsets).length === 0, 'layout reset must clear normalized offsets');
  assert(reset.persisted && Object.keys(reset.persisted).length === 0, 'layout reset must persist an empty v2 layout so legacy data cannot remigrate');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-layout-editor] PASS', JSON.stringify({
    migration: migration.persisted,
    normalizedReload,
    normalizedSwitcher,
    leftApplied: leftReload.applied,
    restoredApplied: restoredReload.applied,
  }));
  await context.close();
} finally {
  await browser.close();
}

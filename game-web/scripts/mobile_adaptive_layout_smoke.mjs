import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const QUICK_SLOT_IDS = ['mc-weapon-slot-0', 'mc-weapon-slot-1', 'mc-weapon-slot-2', 'mc-weapon-slot-3', 'mc-weapon-slot-4'];
const ACTION_IDS = ['mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch', 'mc-sprint', 'mc-fire-left', 'mc-menu', 'mc-map', ...QUICK_SLOT_IDS];
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

function overlaps(a, b) {
  return !(a.right <= b.left || a.left >= b.right || a.bottom <= b.top || a.top >= b.bottom);
}

function centerX(rect) {
  return rect.left + rect.width / 2;
}

async function measure(page) {
  return page.evaluate((quickIds) => {
    const ids = [
      'gone-mobile-controls', 'mobile-stick', 'mobile-look-pad', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch',
      'mc-sprint', 'mc-fire-left', 'mc-menu', 'mc-map', 'mc-weapon-switcher', ...quickIds,
      'health-hud', 'advanced-weapon-hud', 'gone-combat-compass', 'gone-rotate-phone', 'gone-kill-feed',
    ];
    const rects = {};
    const styles = {};
    for (const id of ids) {
      const element = document.getElementById(id);
      if (!element) {
        rects[id] = null;
        styles[id] = null;
        continue;
      }
      const rect = element.getBoundingClientRect();
      const style = getComputedStyle(element);
      rects[id] = {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
      styles[id] = {
        display: style.display,
        pointerEvents: style.pointerEvents,
        opacity: Number(style.opacity),
      };
    }
    return {
      width: innerWidth,
      height: innerHeight,
      handedness: document.documentElement.dataset.goneTouchHandedness,
      smartphone: document.documentElement.classList.contains('gone-smartphone'),
      runtimeHealthy: window.goneRuntimeHealth?.snapshot?.().status,
      gameplayActive: window.goneMobileControls?.snapshot?.().gameplayActive,
      adaptive: window.goneMobileAdaptivePresentation?.snapshot?.(),
      rects,
      styles,
    };
  }, QUICK_SLOT_IDS);
}

function assertLandscape(layout, label, handedness) {
  const r = layout.rects;
  assert(layout.width > layout.height, `${label}: expected landscape viewport`);
  assert(layout.smartphone, `${label}: smartphone profile must survive viewport changes`);
  assert(layout.runtimeHealthy === 'healthy', `${label}: runtime health must stay healthy`);
  assert(layout.gameplayActive, `${label}: gameplay must stay active`);
  assert(layout.handedness === handedness, `${label}: expected ${handedness} handedness, got ${layout.handedness}`);

  const bounded = [
    'mobile-stick', 'mc-fire', 'mc-aim', 'mc-jump', 'mc-reload', 'mc-crouch', 'mc-sprint',
    'mc-fire-left', 'mc-menu', 'mc-map', 'mc-weapon-switcher', ...QUICK_SLOT_IDS,
    'health-hud', 'advanced-weapon-hud', 'gone-combat-compass',
  ];
  for (const id of bounded) {
    const rect = r[id];
    assert(rect, `${label}: ${id} must exist`);
    assert(rect.left >= -2 && rect.top >= -2 && rect.right <= layout.width + 2 && rect.bottom <= layout.height + 2,
      `${label}: ${id} escaped viewport ${JSON.stringify(rect)}`);
  }

  for (const id of ACTION_IDS) {
    const rect = r[id];
    assert(rect.width >= 47.5 && rect.height >= 47.5, `${label}: ${id} target below 48px (${rect.width}x${rect.height})`);
  }

  const center = layout.width / 2;
  for (const id of ['health-hud', 'advanced-weapon-hud', 'mc-weapon-switcher', 'gone-combat-compass']) {
    assert(Math.abs(centerX(r[id]) - center) <= 3, `${label}: ${id} must remain centered`);
  }
  assert(r['mobile-look-pad'].width >= layout.width * 0.64, `${label}: free-look region must remain broad`);

  if (handedness === 'right') {
    assert(centerX(r['mobile-stick']) < layout.width * 0.28, `${label}: right-handed movement must stay in left thumb zone`);
    assert(centerX(r['mc-fire']) > layout.width * 0.72, `${label}: right-handed FIRE must stay in right thumb zone`);
    assert(centerX(r['mc-aim']) > layout.width * 0.60, `${label}: right-handed ADS must stay on action side`);
    assert(centerX(r['mc-sprint']) < layout.width * 0.42, `${label}: right-handed RUN must stay near movement thumb`);
    assert(centerX(r['mc-fire-left']) < layout.width * 0.35, `${label}: right-handed claw FIRE must stay on left shoulder`);
    assert(r['mobile-look-pad'].left > layout.width * 0.25 && r['mobile-look-pad'].right >= layout.width - 2,
      `${label}: right-handed free-look pad must favor the right side`);
  } else {
    assert(centerX(r['mobile-stick']) > layout.width * 0.72, `${label}: left-handed movement must stay in right thumb zone`);
    assert(centerX(r['mc-fire']) < layout.width * 0.28, `${label}: left-handed FIRE must stay in left thumb zone`);
    assert(centerX(r['mc-aim']) < layout.width * 0.40, `${label}: left-handed ADS must stay on action side`);
    assert(centerX(r['mc-sprint']) > layout.width * 0.58, `${label}: left-handed RUN must stay near movement thumb`);
    assert(centerX(r['mc-fire-left']) > layout.width * 0.65, `${label}: left-handed claw FIRE must mirror to the right shoulder`);
    assert(r['mobile-look-pad'].left <= 2 && r['mobile-look-pad'].right < layout.width * 0.75,
      `${label}: left-handed free-look pad must favor the left side`);
  }

  for (const thumb of ['mobile-stick', 'mc-fire']) {
    assert(!overlaps(r[thumb], r['health-hud']), `${label}: ${thumb} overlaps health HUD`);
    assert(!overlaps(r[thumb], r['advanced-weapon-hud']), `${label}: ${thumb} overlaps ammo HUD`);
    assert(!overlaps(r[thumb], r['mc-weapon-switcher']), `${label}: ${thumb} overlaps weapon switcher`);
  }

  assert(!overlaps(r['mc-weapon-switcher'], r['advanced-weapon-hud']), `${label}: weapon switcher overlaps ammo HUD`);
  assert(!overlaps(r['advanced-weapon-hud'], r['health-hud']), `${label}: ammo HUD overlaps health HUD`);
  assert(r['mc-weapon-switcher'].bottom <= r['advanced-weapon-hud'].top + 0.5, `${label}: switcher must stay above ammo`);
  assert(r['advanced-weapon-hud'].bottom <= r['health-hud'].top + 0.5, `${label}: ammo must stay above health`);
  assert(!overlaps(r['gone-combat-compass'], r['mc-menu']), `${label}: compass overlaps menu`);
  assert(!overlaps(r['gone-combat-compass'], r['mc-map']), `${label}: compass overlaps map`);
}

async function setHandedness(page, handedness) {
  const state = await page.evaluate((value) => {
    const buttonId = value === 'left' ? 'touch-handedness-left' : 'touch-handedness-right';
    const button = document.getElementById(buttonId);
    if (!(button instanceof HTMLButtonElement)) {
      return { button: false, snapshot: null, dataset: null, leftClass: null };
    }
    button.click();
    return {
      button: true,
      snapshot: window.goneTouchPreferences?.snapshot?.().handedness ?? null,
      dataset: document.documentElement.dataset.goneTouchHandedness ?? null,
      leftClass: document.documentElement.classList.contains('gone-touch-left-handed'),
    };
  }, handedness);

  assert(state.button, `${handedness} handedness: settings button must exist`);
  assert(state.snapshot === handedness, `${handedness} handedness: preference snapshot stayed ${state.snapshot}`);
  assert(state.dataset === handedness, `${handedness} handedness: DOM dataset stayed ${state.dataset}`);
  assert(state.leftClass === (handedness === 'left'), `${handedness} handedness: mirror CSS class mismatch`);
  await page.waitForTimeout(100);
}

async function assertHandednessMirror(page) {
  await setHandedness(page, 'right');
  const right = await measure(page);
  assertLandscape(right, 'right-handed live layout', 'right');

  await setHandedness(page, 'left');
  const left = await measure(page);
  assertLandscape(left, 'left-handed live layout', 'left');

  for (const id of ['health-hud', 'advanced-weapon-hud', 'mc-weapon-switcher', 'gone-combat-compass']) {
    assert(Math.abs(centerX(right.rects[id]) - centerX(left.rects[id])) <= 1,
      `handedness: centered information ${id} must not move`);
  }

  assert(centerX(right.rects['mobile-stick']) < right.width / 2 && centerX(left.rects['mobile-stick']) > left.width / 2,
    'handedness: movement stick must cross sides');
  assert(centerX(right.rects['mc-fire']) > right.width / 2 && centerX(left.rects['mc-fire']) < left.width / 2,
    'handedness: FIRE must cross sides');

  await setHandedness(page, 'right');
  return { right, left };
}

async function assertDynamicReflow(page) {
  const cases = [
    { name: 'dynamic-compact', width: 740, height: 360 },
    { name: 'dynamic-large', width: 932, height: 430 },
    { name: 'dynamic-restore', width: 844, height: 390 },
  ];
  const results = [];
  for (const spec of cases) {
    await page.setViewportSize({ width: spec.width, height: spec.height });
    await waitFor(page, () => page.evaluate(({ width, height }) => innerWidth === width && innerHeight === height), `${spec.name} viewport apply`, LOCAL_UI_TIMEOUT);
    await page.waitForTimeout(100);
    const layout = await measure(page);
    assertLandscape(layout, spec.name, 'right');
    results.push({ ...spec, layout });
  }

  const compact = results[0].layout.rects;
  const large = results[1].layout.rects;
  assert(large['mobile-stick'].width > compact['mobile-stick'].width + 8,
    `dynamic reflow: stick must scale with viewport (${compact['mobile-stick'].width} -> ${large['mobile-stick'].width})`);
  assert(large['mc-fire'].width > compact['mc-fire'].width + 4,
    `dynamic reflow: FIRE must scale with viewport (${compact['mc-fire'].width} -> ${large['mc-fire'].width})`);
  return results;
}

async function assertPortraitSafety(page) {
  await page.setViewportSize({ width: 390, height: 844 });
  await waitFor(page, () => page.evaluate(() => innerHeight > innerWidth && window.matchMedia('(orientation: portrait)').matches), 'portrait viewport apply', LOCAL_UI_TIMEOUT);
  await waitFor(page, () => page.evaluate(() => {
    const rotate = document.getElementById('gone-rotate-phone');
    const fire = document.getElementById('mc-fire');
    return Boolean(rotate && fire && getComputedStyle(rotate).display !== 'none' && getComputedStyle(fire).pointerEvents === 'none');
  }), 'portrait safety blocker', LOCAL_UI_TIMEOUT);

  const portrait = await measure(page);
  const rotate = portrait.rects['gone-rotate-phone'];
  assert(portrait.adaptive?.portrait && portrait.adaptive?.rotateVisible, 'portrait: adaptive runtime must expose rotate blocker');
  assert(portrait.styles['mc-fire'].pointerEvents === 'none', 'portrait: FIRE must not remain interactive behind rotate overlay');
  assert(portrait.styles['gone-rotate-phone'].pointerEvents === 'auto', 'portrait: rotate overlay must intercept accidental touches');
  assert(portrait.styles['gone-mobile-controls'].opacity <= 0.2, 'portrait: gameplay controls must visually recede behind the rotate guard');
  assert(rotate.width >= portrait.width - 2 && rotate.height >= portrait.height - 2, 'portrait: rotate overlay must cover the viewport');

  await page.setViewportSize({ width: 844, height: 390 });
  await waitFor(page, () => page.evaluate(() => innerWidth > innerHeight && window.matchMedia('(orientation: landscape)').matches), 'landscape restore', LOCAL_UI_TIMEOUT);
  await waitFor(page, () => page.evaluate(() => {
    const rotate = document.getElementById('gone-rotate-phone');
    const fire = document.getElementById('mc-fire');
    return Boolean(rotate && fire && getComputedStyle(rotate).display === 'none' && getComputedStyle(fire).pointerEvents !== 'none');
  }), 'landscape controls restore', LOCAL_UI_TIMEOUT);
  const restored = await measure(page);
  assertLandscape(restored, 'post-portrait landscape restore', 'right');
  return { portrait, restored };
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
  await waitFor(page, () => page.evaluate(() => Boolean(window.goneMobileAdaptivePresentation?.snapshot && window.goneCompetitiveTouchControls?.snapshot && window.goneTouchPreferences?.set)), 'adaptive mobile runtime');
  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => {
    const ui = document.getElementById('game-ui');
    return Boolean(ui && !ui.classList.contains('hidden') && window.goneMobileControls?.snapshot?.().gameplayActive && document.getElementById('mc-weapon-slot-4'));
  }), 'gameplay start', 90_000);

  const handedness = await assertHandednessMirror(page);
  const reflow = await assertDynamicReflow(page);
  const portraitSafety = await assertPortraitSafety(page);

  const finalState = await page.evaluate(() => ({
    adaptive: window.goneMobileAdaptivePresentation.snapshot(),
    health: window.goneRuntimeHealth.snapshot(),
    preferences: window.goneTouchPreferences.snapshot(),
  }));
  assert(finalState.health.status === 'healthy', 'adaptive layout transitions must not degrade runtime health');
  assert(finalState.preferences.handedness === 'right', 'smoke must restore default handedness');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-adaptive-layout] PASS', JSON.stringify({ handedness, reflow, portraitSafety, finalState }));
  await context.close();
} finally {
  await browser.close();
}

import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const LOCAL_UI_TIMEOUT = 5_000;
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };

async function waitFor(page, predicate, label, timeout = LOCAL_UI_TIMEOUT) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeout) {
    try {
      last = await predicate();
      if (last) return last;
    } catch (error) { last = error; }
    await page.waitForTimeout(80);
  }
  throw new Error(`Timeout waiting for ${label}${last ? ` (${String(last)})` : ''}`);
}

async function stickPointer(page, type, pointerId, nx, ny) {
  await page.evaluate(({ type, pointerId, nx, ny }) => {
    const stick = document.getElementById('mobile-stick');
    if (!stick) throw new Error('Missing mobile-stick');
    const rect = stick.getBoundingClientRect();
    const radius = Math.max(1, rect.width * 0.36);
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    stick.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      pointerId,
      pointerType: 'touch',
      button: 0,
      buttons: type === 'pointerup' || type === 'pointercancel' ? 0 : 1,
      clientX: centerX + nx * radius,
      clientY: centerY + ny * radius,
    }));
  }, { type, pointerId, nx, ny });
}

async function buttonPointer(page, id, type, pointerId) {
  await page.evaluate(({ id, type, pointerId }) => {
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
      clientX: rect.left + rect.width / 2,
      clientY: rect.top + rect.height / 2,
    }));
  }, { id, type, pointerId });
}

async function snapshot(page) {
  return page.evaluate(() => ({
    competitive: window.goneCompetitiveTouchControls?.snapshot?.(),
    mobile: window.goneMobileControls?.snapshot?.(),
    sprintPressed: document.getElementById('mc-sprint')?.getAttribute('aria-pressed'),
    sprintHeldClass: document.getElementById('mc-sprint')?.classList.contains('is-held') ?? false,
    stickAutoSprint: document.getElementById('mobile-stick')?.dataset.goneAutoSprint,
  }));
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
    document.documentElement.classList.contains('gone-smartphone')
      && window.goneCompetitiveTouchControls?.snapshot
      && window.goneMobileControls?.snapshot
  )), 'smartphone touch runtime', 15_000);
  await page.locator('#btn-enter').click();
  await waitFor(page, () => page.evaluate(() => Boolean(
    !document.getElementById('game-ui')?.classList.contains('hidden')
      && window.goneMobileControls?.snapshot?.().gameplayActive
  )), 'gameplay start', 90_000);

  const pointerId = 701;
  await stickPointer(page, 'pointerdown', pointerId, 0, 0);
  await stickPointer(page, 'pointermove', pointerId, 0, -0.64);
  await page.waitForTimeout(60);
  const walking = await snapshot(page);
  assert(walking.mobile?.forward, 'moderate forward joystick displacement must move forward');
  assert(!walking.competitive?.autoSprint && !walking.competitive?.sprintActive,
    'moderate joystick displacement must remain walking');

  // Radial edge + forward intent: this diagonal deliberately keeps ny above the
  // old -0.82-only threshold, so the test distinguishes smart radial sprint.
  await stickPointer(page, 'pointermove', pointerId, 0.60, -0.80);
  await waitFor(page, () => page.evaluate(() => window.goneCompetitiveTouchControls?.snapshot?.().autoSprint === true),
    'diagonal smart sprint engage');
  const diagonalSprint = await snapshot(page);
  assert(diagonalSprint.competitive?.sprintActive, 'smart sprint must drive canonical sprint input');
  assert(diagonalSprint.competitive?.moveMagnitude >= 0.98, 'smart sprint must engage from radial edge distance');
  assert(diagonalSprint.competitive?.forwardIntent > 0.6, 'smart sprint must require forward intent');
  assert(diagonalSprint.sprintPressed === 'true' && diagonalSprint.sprintHeldClass,
    'RUN control must expose smart sprint feedback');
  assert(diagonalSprint.stickAutoSprint === 'true', 'movement stick must expose smart sprint state');

  // Hysteresis: remain sprinting while the thumb eases inward but stays outside
  // the release threshold, avoiding rapid walk/sprint flicker around the edge.
  await stickPointer(page, 'pointermove', pointerId, 0.45, -0.55);
  await page.waitForTimeout(60);
  const hysteresisHold = await snapshot(page);
  assert(hysteresisHold.competitive?.autoSprint,
    `smart sprint should remain latched above exit distance (${hysteresisHold.competitive?.moveMagnitude})`);

  await stickPointer(page, 'pointermove', pointerId, 0.36, -0.48);
  await waitFor(page, () => page.evaluate(() => window.goneCompetitiveTouchControls?.snapshot?.().autoSprint === false),
    'smart sprint release below hysteresis threshold');
  const easedWalk = await snapshot(page);
  assert(easedWalk.mobile?.forward, 'easing inward should return to walking without dropping movement');
  assert(!easedWalk.competitive?.sprintActive, 'smart sprint release must clear canonical sprint input');

  await stickPointer(page, 'pointermove', pointerId, 0.98, 0);
  await page.waitForTimeout(60);
  const strafe = await snapshot(page);
  assert(!strafe.competitive?.autoSprint, 'pure side strafe must not trigger smart sprint');

  await stickPointer(page, 'pointermove', pointerId, 0.15, 0.95);
  await page.waitForTimeout(60);
  const backward = await snapshot(page);
  assert(!backward.competitive?.autoSprint, 'backward joystick edge must not trigger smart sprint');

  await stickPointer(page, 'pointermove', pointerId, 0, -0.95);
  await waitFor(page, () => page.evaluate(() => window.goneCompetitiveTouchControls?.snapshot?.().autoSprint === true),
    'full forward smart sprint engage');
  await stickPointer(page, 'pointerup', pointerId, 0, -0.95);
  await waitFor(page, () => page.evaluate(() => {
    const snap = window.goneCompetitiveTouchControls?.snapshot?.();
    return snap && !snap.autoSprint && !snap.sprintActive && snap.movePointer === null;
  }), 'smart sprint release on pointer up');

  // Manual sprint remains an independent override while the joystick is only in
  // the walking band.
  await stickPointer(page, 'pointerdown', 702, 0, 0);
  await stickPointer(page, 'pointermove', 702, 0, -0.58);
  await page.waitForTimeout(40);
  await buttonPointer(page, 'mc-sprint', 'pointerdown', 703);
  await waitFor(page, () => page.evaluate(() => {
    const snap = window.goneCompetitiveTouchControls?.snapshot?.();
    return snap && snap.sprintActive && !snap.autoSprint;
  }), 'manual sprint override');
  await buttonPointer(page, 'mc-sprint', 'pointerup', 703);
  await waitFor(page, () => page.evaluate(() => {
    const snap = window.goneCompetitiveTouchControls?.snapshot?.();
    return snap && !snap.sprintActive && !snap.autoSprint;
  }), 'manual sprint release');
  await stickPointer(page, 'pointerup', 702, 0, -0.58);

  const final = await snapshot(page);
  assert(final.sprintPressed === 'false' && !final.sprintHeldClass, 'RUN feedback must clear after release');
  assert(final.stickAutoSprint === 'false', 'movement stick smart sprint state must clear after release');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-smart-sprint] PASS', JSON.stringify({
    walking,
    diagonalSprint,
    hysteresisHold,
    easedWalk,
    strafe,
    backward,
    final,
  }));
  await context.close();
} finally {
  await browser.close();
}

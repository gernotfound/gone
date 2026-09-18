import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const LOCAL_UI_TIMEOUT = 5_000;
const VIEWPORTS = [
  { label: 'compact-landscape', width: 740, height: 360 },
  { label: 'iphone-landscape', width: 844, height: 390 },
  { label: 'large-phone-landscape', width: 932, height: 430 },
];

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
  await cdp.send('Emulation.setDeviceMetricsOverride', {
    width,
    height,
    deviceScaleFactor: 2,
    mobile: true,
    screenWidth: width,
    screenHeight: height,
    screenOrientation: { type: 'landscapePrimary', angle: 90 },
  });
  await waitFor(
    page,
    () => page.evaluate(({ expectedWidth, expectedHeight }) => innerWidth === expectedWidth && innerHeight === expectedHeight,
      { expectedWidth: width, expectedHeight: height }),
    `${label} viewport apply`,
    LOCAL_UI_TIMEOUT,
  );
  await page.waitForTimeout(100);
}

function withinViewport(rect, width, height) {
  return rect && rect.left >= -2 && rect.top >= -2 && rect.right <= width + 2 && rect.bottom <= height + 2;
}

async function measureControls(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return {
        left: box.left,
        right: box.right,
        top: box.top,
        bottom: box.bottom,
        width: box.width,
        height: box.height,
      };
    };
    const byId = (id) => document.getElementById(id);
    const panel = byId('controls-menu');
    const body = byId('controls-legend-body');
    const list = byId('controls-legend-grid');
    const touch = byId('controls-legend-touch');
    const rows = [...document.querySelectorAll('#controls-legend-grid .gone-controls-row')].map(rectOf);
    const bodyStyle = body ? getComputedStyle(body) : null;
    const listStyle = list ? getComputedStyle(list) : null;
    return {
      width: innerWidth,
      height: innerHeight,
      smartphone: document.documentElement.classList.contains('gone-smartphone'),
      runtimeHealth: window.goneRuntimeHealth?.snapshot?.().status ?? null,
      panel: rectOf(panel),
      title: rectOf(byId('controls-menu-title')),
      body: rectOf(body),
      list: rectOf(list),
      touch: rectOf(touch),
      back: rectOf(byId('btn-back-controls')),
      bodyDisplay: bodyStyle?.display ?? null,
      bodyColumns: bodyStyle?.gridTemplateColumns ?? '',
      listDisplay: listStyle?.display ?? null,
      listColumns: listStyle?.gridTemplateColumns ?? '',
      rows,
      panelClientHeight: panel?.clientHeight ?? 0,
      panelScrollHeight: panel?.scrollHeight ?? 0,
      listClientHeight: list?.clientHeight ?? 0,
      listScrollHeight: list?.scrollHeight ?? 0,
      touchText: touch?.textContent ?? '',
      introDisplay: (() => {
        const intro = byId('controls-menu-intro');
        return intro ? getComputedStyle(intro).display : null;
      })(),
    };
  });
}

function assertControls(layout, label) {
  assert(layout.smartphone, `${label}: smartphone profile missing`);
  assert(layout.runtimeHealth === 'healthy', `${label}: runtime must remain healthy`);
  assert(layout.panel, `${label}: controls panel missing`);
  assert(withinViewport(layout.panel, layout.width, layout.height), `${label}: controls panel escaped viewport`);
  assert(layout.panel.width >= layout.width * 0.82,
    `${label}: controls panel still looks like a narrow desktop card (${layout.panel.width}/${layout.width})`);
  assert(layout.panelScrollHeight <= layout.panelClientHeight + 2,
    `${label}: outer controls card must not scroll (${layout.panelScrollHeight}/${layout.panelClientHeight})`);
  assert(layout.introDisplay === 'none', `${label}: desktop intro should yield space to touch guidance on phone`);

  assert(layout.bodyDisplay === 'grid', `${label}: controls body must use landscape grid`);
  assert(layout.bodyColumns && layout.bodyColumns !== 'none', `${label}: controls body columns unresolved`);
  assert(layout.listDisplay === 'grid', `${label}: command list must use a grid`);
  assert(layout.listColumns.split(' ').filter(Boolean).length === 2,
    `${label}: command grid must resolve to two columns (${layout.listColumns})`);
  assert(layout.listScrollHeight <= layout.listClientHeight + 2,
    `${label}: command grid should not own vertical scrolling`);
  assert(layout.rows.length === 12, `${label}: expected 12 documented command rows, got ${layout.rows.length}`);

  assert(layout.list && layout.touch, `${label}: controls columns missing`);
  assert(layout.touch.left >= layout.list.right + 6,
    `${label}: touch guidance must remain in a dedicated right column`);
  assert(withinViewport(layout.touch, layout.width, layout.height), `${label}: touch guidance escaped viewport`);
  assert(layout.touchText.toUpperCase().includes('SMART SPRINT'), `${label}: smart sprint guidance missing`);
  assert(layout.touchText.includes('FIRE') && layout.touchText.includes('ADS'), `${label}: FIRE/ADS touch guidance missing`);

  for (const [index, rect] of layout.rows.entries()) {
    assert(rect, `${label}: command row ${index} missing`);
    assert(withinViewport(rect, layout.width, layout.height), `${label}: command row ${index} escaped viewport`);
    assert(rect.height >= 31.5, `${label}: command row ${index} became unreadably compressed (${rect.height})`);
  }

  assert(layout.back, `${label}: controls back action missing`);
  assert(withinViewport(layout.back, layout.width, layout.height), `${label}: controls back action escaped viewport`);
  assert(layout.back.height >= 47.5, `${label}: controls back target below 48px (${layout.back.height})`);
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
  const cdp = await context.newCDPSession(page);
  page.on('pageerror', (error) => failures.push(`pageerror: ${error.message}`));
  page.on('console', (message) => { if (message.type() === 'error') failures.push(`console error: ${message.text()}`); });

  await page.goto(`${BASE}/`, { waitUntil: 'networkidle' });
  await waitFor(page, () => page.evaluate(() => Boolean(
    document.documentElement.classList.contains('gone-smartphone')
    && window.goneRuntimeHealth?.snapshot
    && document.getElementById('btn-controls')
    && document.getElementById('controls-menu')
  )), 'smartphone controls legend runtime');

  const results = [];
  for (const spec of VIEWPORTS) {
    await applyDeviceMetrics(page, cdp, spec.width, spec.height, spec.label);
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} main menu visible`, LOCAL_UI_TIMEOUT);

    await page.locator('#btn-controls').click();
    await waitFor(page, () => page.evaluate(() => {
      const panel = document.getElementById('controls-menu');
      return Boolean(panel && !panel.classList.contains('hidden'));
    }), `${spec.label} controls visible`, LOCAL_UI_TIMEOUT);
    await page.waitForTimeout(80);

    const controls = await measureControls(page);
    assertControls(controls, spec.label);

    await page.locator('#btn-back-controls').click();
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} return to main`, LOCAL_UI_TIMEOUT);
    results.push({ spec, controls });
  }

  const finalState = await page.evaluate(() => ({
    health: window.goneRuntimeHealth?.snapshot?.(),
    mainVisible: !document.getElementById('main-menu')?.classList.contains('hidden'),
    controlsHidden: document.getElementById('controls-menu')?.classList.contains('hidden') ?? false,
  }));
  assert(finalState.health?.status === 'healthy', 'controls transitions must not degrade runtime health');
  assert(finalState.mainVisible, 'smoke must finish on the main menu');
  assert(finalState.controlsHidden, 'controls panel must be closed at the end');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-controls-legend] PASS', JSON.stringify({ results, finalState }));
  await context.close();
} finally {
  await browser.close();
}

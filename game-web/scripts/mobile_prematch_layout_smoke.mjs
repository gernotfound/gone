import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const LOCAL_UI_TIMEOUT = 5_000;
const VIEWPORTS = [
  { label: 'iphone-landscape', width: 844, height: 390 },
  { label: 'compact-landscape', width: 740, height: 360 },
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

function sameRow(a, b, tolerance = 4) {
  return Math.abs(a.top - b.top) <= tolerance && Math.abs(a.bottom - b.bottom) <= tolerance;
}

async function measureMain(page) {
  return page.evaluate(() => {
    const rect = (id) => {
      const element = document.getElementById(id);
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const main = document.getElementById('main-menu');
    const grid = main?.querySelector(':scope > div');
    return {
      width: innerWidth,
      height: innerHeight,
      smartphone: document.documentElement.classList.contains('gone-smartphone'),
      runtimeHealth: window.goneRuntimeHealth?.snapshot?.().status ?? null,
      main: rect('main-menu'),
      title: main?.querySelector('h1')?.getBoundingClientRect().toJSON?.() ?? null,
      enter: rect('btn-enter'),
      multiplayer: rect('btn-multiplayer'),
      controls: rect('btn-controls'),
      music: rect('btn-music-toggle'),
      settings: rect('btn-settings'),
      preload: rect('btn-performance-pack'),
      gridDisplay: grid ? getComputedStyle(grid).display : null,
      clientHeight: main?.clientHeight ?? 0,
      scrollHeight: main?.scrollHeight ?? 0,
    };
  });
}

function assertMain(layout, label) {
  assert(layout.smartphone, `${label}: smartphone profile missing`);
  assert(layout.runtimeHealth === 'healthy', `${label}: runtime must stay healthy before match`);
  assert(withinViewport(layout.main, layout.width, layout.height), `${label}: main menu escaped viewport`);
  assert(layout.main.width >= layout.width * 0.82, `${label}: main menu still looks like a narrow desktop card (${layout.main.width}/${layout.width})`);
  assert(layout.scrollHeight <= layout.clientHeight + 2, `${label}: main menu should not require vertical scrolling`);
  assert(layout.gridDisplay === 'grid', `${label}: main actions must use the landscape grid`);

  for (const [name, rect] of Object.entries({
    enter: layout.enter,
    multiplayer: layout.multiplayer,
    controls: layout.controls,
    music: layout.music,
    settings: layout.settings,
    preload: layout.preload,
  })) {
    assert(rect, `${label}: missing ${name}`);
    assert(withinViewport(rect, layout.width, layout.height), `${label}: ${name} escaped viewport`);
    assert(rect.height >= 47.5, `${label}: ${name} target below 48px (${rect.height})`);
  }

  assert(sameRow(layout.enter, layout.multiplayer), `${label}: primary CTAs must share the top row`);
  assert(Math.abs(layout.enter.width - layout.multiplayer.width) <= 4, `${label}: primary CTAs must have equal visual weight`);
  assert(layout.enter.width >= layout.controls.width * 1.75, `${label}: ENTRA must remain visually dominant over utilities`);
  assert(layout.multiplayer.width >= layout.settings.width * 1.75, `${label}: MULTIPLAYER must remain visually dominant over utilities`);
  assert(sameRow(layout.controls, layout.music), `${label}: COMANDI/VOLUME must share utility row`);
  assert(sameRow(layout.music, layout.settings), `${label}: VOLUME/IMPOSTAZIONI must share utility row`);
  assert(Math.abs(layout.settings.top - layout.preload.top) <= 4, `${label}: PRECARICA must stay in the utility band`);
}

async function measureLobby(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const byId = (id) => document.getElementById(id);
    const lobby = byId('multiplayer-lobby');
    const content = lobby?.querySelector(':scope > h2 + div');
    const playerList = byId('lobby-player-list');
    const playerPanel = playerList?.parentElement ?? null;
    const colorButtons = [...document.querySelectorAll('#color-picker-container button')].map(rectOf);
    return {
      width: innerWidth,
      height: innerHeight,
      lobby: rectOf(lobby),
      username: rectOf(byId('player-username')),
      invite: rectOf(byId('invite-link-container')),
      playerPanel: rectOf(playerPanel),
      playerList: rectOf(playerList),
      back: rectOf(byId('btn-back-lobby')),
      play: rectOf(byId('btn-play-multiplayer')),
      content: rectOf(content),
      contentDisplay: content ? getComputedStyle(content).display : null,
      playerPanelPosition: playerPanel ? getComputedStyle(playerPanel).position : null,
      clientHeight: lobby?.clientHeight ?? 0,
      scrollHeight: lobby?.scrollHeight ?? 0,
      contentClientHeight: content?.clientHeight ?? 0,
      contentScrollHeight: content?.scrollHeight ?? 0,
      colorButtons,
    };
  });
}

function assertLobby(layout, label) {
  assert(withinViewport(layout.lobby, layout.width, layout.height), `${label}: lobby escaped viewport`);
  assert(layout.lobby.width >= layout.width * 0.82, `${label}: lobby did not use landscape width (${layout.lobby.width}/${layout.width})`);
  assert(layout.scrollHeight <= layout.clientHeight + 2, `${label}: outer lobby card should not scroll`);
  assert(layout.contentDisplay === 'grid', `${label}: lobby content must use a two-column grid`);
  assert(layout.playerPanelPosition === 'sticky', `${label}: roster panel must stay persistent while configuration scrolls`);
  assert(layout.username && layout.playerPanel, `${label}: lobby columns missing`);
  assert(layout.playerPanel.left >= layout.username.right + 8, `${label}: roster must remain in the right column`);
  assert(layout.playerList.height >= 72, `${label}: roster is too compressed (${layout.playerList.height})`);
  assert(withinViewport(layout.back, layout.width, layout.height), `${label}: back CTA escaped viewport`);
  assert(withinViewport(layout.play, layout.width, layout.height), `${label}: play CTA escaped viewport`);
  assert(layout.back.height >= 47.5 && layout.play.height >= 47.5, `${label}: lobby CTAs must stay >=48px`);
  assert(sameRow(layout.back, layout.play), `${label}: lobby CTAs must share one bottom action row`);
  assert(layout.play.width >= layout.back.width * 2, `${label}: GIOCA must remain the dominant CTA`);
  assert(layout.colorButtons.length > 0, `${label}: color choices missing`);
  for (const [index, rect] of layout.colorButtons.entries()) {
    assert(rect.width >= 47.5 && rect.height >= 47.5, `${label}: color target ${index} below 48px (${rect.width}x${rect.height})`);
  }
}

async function assertStickyRosterWhenScrollable(page, before, label) {
  if (before.contentScrollHeight <= before.contentClientHeight + 2) return;
  const topBefore = before.playerPanel.top;
  await page.evaluate(() => {
    const lobby = document.getElementById('multiplayer-lobby');
    const content = lobby?.querySelector(':scope > h2 + div');
    if (content) content.scrollTop = content.scrollHeight;
  });
  await page.waitForTimeout(60);
  const after = await measureLobby(page);
  assert(Math.abs(after.playerPanel.top - topBefore) <= 3, `${label}: roster moved while configuration scrolled`);
  await page.evaluate(() => {
    const lobby = document.getElementById('multiplayer-lobby');
    const content = lobby?.querySelector(':scope > h2 + div');
    if (content) content.scrollTop = 0;
  });
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
    && document.getElementById('btn-performance-pack')
  )), 'smartphone pre-match runtime');

  const results = [];
  for (const spec of VIEWPORTS) {
    await applyDeviceMetrics(page, cdp, spec.width, spec.height, spec.label);
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} main menu visible`, LOCAL_UI_TIMEOUT);

    const main = await measureMain(page);
    assertMain(main, spec.label);

    await page.locator('#btn-multiplayer').click();
    await waitFor(page, () => page.evaluate(() => {
      const lobby = document.getElementById('multiplayer-lobby');
      return Boolean(lobby && !lobby.classList.contains('hidden') && document.querySelector('#lobby-player-list li'));
    }), `${spec.label} multiplayer lobby`, 15_000);
    await page.waitForTimeout(120);

    const lobby = await measureLobby(page);
    assertLobby(lobby, spec.label);
    await assertStickyRosterWhenScrollable(page, lobby, spec.label);

    await page.locator('#btn-back-lobby').click();
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} return to main`, LOCAL_UI_TIMEOUT);
    results.push({ spec, main, lobby });
  }

  const finalState = await page.evaluate(() => ({
    health: window.goneRuntimeHealth?.snapshot?.(),
    mainVisible: !document.getElementById('main-menu')?.classList.contains('hidden'),
  }));
  assert(finalState.health?.status === 'healthy', 'pre-match transitions must not degrade runtime health');
  assert(finalState.mainVisible, 'smoke must finish on the main menu');
  assert(failures.length === 0, `Browser exceptions detected:\n${failures.join('\n')}`);

  console.log('[mobile-prematch-layout] PASS', JSON.stringify({ results, finalState }));
  await context.close();
} finally {
  await browser.close();
}

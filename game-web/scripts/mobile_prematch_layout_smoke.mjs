import { chromium } from 'playwright';

const BASE = process.env.GONE_PREVIEW_URL || 'http://127.0.0.1:4173';
const failures = [];
const assert = (condition, message) => { if (!condition) throw new Error(message); };
const LOCAL_UI_TIMEOUT = 5_000;
const VIEWPORTS = [
  { label: 'iphone-landscape', width: 844, height: 390 },
  { label: 'compact-landscape', width: 740, height: 360 },
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
      preloadWrapper: rect('performance-pack-controls'),
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

  assert(layout.preloadWrapper, `${label}: missing PRECARICA grid wrapper`);
  assert(withinViewport(layout.preloadWrapper, layout.width, layout.height), `${label}: PRECARICA wrapper escaped viewport`);
  assert(sameRow(layout.enter, layout.multiplayer), `${label}: primary CTAs must share the top row`);
  assert(Math.abs(layout.enter.width - layout.multiplayer.width) <= 4, `${label}: primary CTAs must have equal visual weight`);
  assert(layout.enter.width >= layout.controls.width * 1.75, `${label}: ENTRA must remain visually dominant over utilities`);
  assert(layout.multiplayer.width >= layout.settings.width * 1.75, `${label}: MULTIPLAYER must remain visually dominant over utilities`);
  assert(sameRow(layout.controls, layout.music), `${label}: COMANDI/VOLUME must share utility row`);
  assert(sameRow(layout.music, layout.settings), `${label}: VOLUME/IMPOSTAZIONI must share utility row`);
  assert(Math.abs(layout.settings.top - layout.preloadWrapper.top) <= 4,
    `${label}: PRECARICA wrapper must stay in the utility band (${layout.settings.top} vs ${layout.preloadWrapper.top})`);
}

async function measureSettings(page) {
  return page.evaluate(() => {
    const rectOf = (element) => {
      if (!element) return null;
      const box = element.getBoundingClientRect();
      return { left: box.left, right: box.right, top: box.top, bottom: box.bottom, width: box.width, height: box.height };
    };
    const byId = (id) => document.getElementById(id);
    const settings = byId('settings-menu');
    const stack = settings?.querySelector(':scope > .w-full.flex.flex-col');
    const touch = byId('touch-control-settings');
    const inputMode = byId('input-mode-setting');
    const globalTargets = ['input-mode-keyboard', 'input-mode-screen', 'btn-back']
      .map((id) => ({ id, rect: rectOf(byId(id)) }));
    const touchTargets = [
      'touch-ads-mode-hold',
      'touch-ads-mode-toggle',
      'touch-handedness-right',
      'touch-handedness-left',
      'touch-secondary-fire',
      'touch-gyro-toggle',
      'touch-layout-edit',
      'touch-controls-reset',
    ].map((id) => ({ id, rect: rectOf(byId(id)) }));
    const audioRanges = ['vol-master', 'vol-music', 'vol-sfx']
      .map((id) => ({ id, rect: rectOf(byId(id)) }));
    return {
      width: innerWidth,
      height: innerHeight,
      settings: rectOf(settings),
      stack: rectOf(stack),
      inputMode: rectOf(inputMode),
      touchPanel: rectOf(touch),
      touchReset: rectOf(byId('touch-controls-reset')),
      back: rectOf(byId('btn-back')),
      stackDisplay: stack ? getComputedStyle(stack).display : null,
      stackColumns: stack ? getComputedStyle(stack).gridTemplateColumns : '',
      touchOverflowY: touch ? getComputedStyle(touch).overflowY : null,
      clientHeight: settings?.clientHeight ?? 0,
      scrollHeight: settings?.scrollHeight ?? 0,
      scrollTop: settings?.scrollTop ?? 0,
      touchClientHeight: touch?.clientHeight ?? 0,
      touchScrollHeight: touch?.scrollHeight ?? 0,
      touchScrollTop: touch?.scrollTop ?? 0,
      globalTargets,
      touchTargets,
      audioRanges,
    };
  });
}

function assertSettings(layout, label) {
  assert(withinViewport(layout.settings, layout.width, layout.height), `${label}: settings card escaped viewport`);
  assert(layout.settings.width >= layout.width * 0.82,
    `${label}: settings still looks like a narrow desktop card (${layout.settings.width}/${layout.width})`);
  assert(layout.scrollHeight <= layout.clientHeight + 2, `${label}: outer settings card should not scroll`);
  assert(layout.stackDisplay === 'grid', `${label}: settings content must use the landscape split grid`);
  assert(layout.stackColumns && layout.stackColumns !== 'none', `${label}: settings grid columns were not resolved`);
  assert(layout.inputMode && layout.touchPanel, `${label}: settings columns missing`);
  assert(layout.touchPanel.left >= layout.inputMode.right + 8, `${label}: touch customization must stay in the right column`);
  assert(withinViewport(layout.back, layout.width, layout.height), `${label}: settings back action escaped viewport`);
  assert(layout.touchOverflowY === 'auto' || layout.touchOverflowY === 'scroll', `${label}: touch settings must own vertical scroll`);
  assert(layout.touchScrollHeight > layout.touchClientHeight + 2,
    `${label}: touch settings should scroll internally (${layout.touchScrollHeight}/${layout.touchClientHeight})`);

  for (const { id, rect } of layout.globalTargets) {
    assert(rect, `${label}: missing settings target ${id}`);
    assert(rect.width >= 47.5 && rect.height >= 47.5, `${label}: settings target ${id} below 48px (${rect.width}x${rect.height})`);
  }
  for (const { id, rect } of layout.touchTargets) {
    assert(rect, `${label}: missing touch settings target ${id}`);
    assert(rect.width >= 47.5 && rect.height >= 47.5, `${label}: touch settings target ${id} below 48px (${rect.width}x${rect.height})`);
  }
  for (const { id, rect } of layout.audioRanges) {
    assert(rect, `${label}: missing audio range ${id}`);
    assert(rect.width >= 160, `${label}: audio range ${id} is too compressed (${rect.width})`);
  }
}

async function assertSettingsScrollOwnership(page, before, label) {
  const backTopBefore = before.back.top;
  await page.evaluate(() => {
    const touch = document.getElementById('touch-control-settings');
    if (touch) touch.scrollTop = touch.scrollHeight;
  });
  await page.waitForTimeout(60);
  const after = await measureSettings(page);
  assert(after.touchScrollTop > 0, `${label}: touch settings did not scroll internally`);
  assert(after.scrollTop === 0, `${label}: outer settings card moved while touch settings scrolled`);
  assert(Math.abs(after.back.top - backTopBefore) <= 2, `${label}: fixed settings back action moved during inner scroll`);
  assert(after.touchReset.top >= after.touchPanel.top - 2 && after.touchReset.bottom <= after.touchPanel.bottom + 2,
    `${label}: reset action is not reachable at the end of touch settings scroll`);
  await page.evaluate(() => {
    const touch = document.getElementById('touch-control-settings');
    if (touch) touch.scrollTop = 0;
  });
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
    && document.getElementById('input-mode-setting')
    && document.getElementById('touch-control-settings')
  )), 'smartphone pre-match runtime');

  const results = [];
  for (const spec of VIEWPORTS) {
    await applyDeviceMetrics(page, cdp, spec.width, spec.height, spec.label);
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} main menu visible`, LOCAL_UI_TIMEOUT);

    const main = await measureMain(page);
    assertMain(main, spec.label);

    await page.locator('#btn-settings').click();
    await waitFor(page, () => page.evaluate(() => !document.getElementById('settings-menu')?.classList.contains('hidden')),
      `${spec.label} settings visible`, LOCAL_UI_TIMEOUT);
    await page.waitForTimeout(80);
    const settings = await measureSettings(page);
    assertSettings(settings, spec.label);
    await assertSettingsScrollOwnership(page, settings, spec.label);

    await page.locator('#btn-back').click();
    await waitFor(page, () => page.evaluate(() => !document.getElementById('main-menu')?.classList.contains('hidden')),
      `${spec.label} return from settings`, LOCAL_UI_TIMEOUT);

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
    results.push({ spec, main, settings, lobby });
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

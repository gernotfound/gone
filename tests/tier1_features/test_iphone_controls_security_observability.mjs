import assert from 'node:assert/strict';
import fs from 'node:fs/promises';

async function source(path) {
  return fs.readFile(new URL(`../../${path}`, import.meta.url), 'utf8');
}

export async function run(suite) {
  suite.test('iOS music is unlocked from persistent user gestures and resumes after foreground', async () => {
    const menu = await source('game-web/src/ui/menu.ts');
    assert.match(menu, /document\.addEventListener\('pointerdown', resumeAudioFromGesture/);
    assert.match(menu, /soundSynth\.unlock\(\)/);
    assert.match(menu, /DOM\.bgMusic\.play\(\)/);
    assert.match(menu, /setAttribute\('playsinline'/);
    assert.match(menu, /document\.addEventListener\('visibilitychange'/);
  });

  suite.test('PUBG v2 touch layer owns FIRE, reliable reload and weapon switching on iOS', async () => {
    const pubg = await source('game-web/src/mobile/pubgTouchControls.ts');
    assert.match(pubg, /addEventListener\('pointerdown'.*true\)/s, 'mobile actions must use capture-phase pointer events');
    assert.match(pubg, /stopImmediatePropagation\(\)/, 'FIRE must suppress the legacy touch handler');
    assert.match(pubg, /goneWeapons\?\.reload\?\.\(\)/, 'reload must call the authoritative weapon controller directly');
    assert.match(pubg, /game\?\.switchWeapon\?\.\(next\)/, 'weapon switch must call the game API directly');
    assert.match(pubg, /fireDragDeadZone/, 'FIRE drag must have an adjustable dead-zone');
    assert.match(pubg, /mc-fire-left/, 'secondary claw FIRE must exist');
    assert.match(pubg, /bindAdsDrag/, 'ADS must double as a drag-look surface');
    assert.match(pubg, /DeviceOrientationEvent/, 'optional gyro aiming must be implemented');
  });

  suite.test('touch customization includes PUBG tuning and persistent draggable layout', async () => {
    const preferences = await source('game-web/src/mobile/touchPreferences.ts');
    const layout = await source('game-web/src/mobile/touchLayoutEditor.ts');
    for (const token of ['fireDragDeadZone', 'secondaryFire', 'gyroEnabled', 'gyroSensitivity', 'touch-layout-edit']) {
      assert.ok(preferences.includes(token), `touch preferences missing ${token}`);
    }
    assert.match(layout, /gone-touch-layout-v1/);
    assert.match(layout, /localStorage\.setItem/);
    assert.match(layout, /gone-touch-layout-edit/);
    assert.match(layout, /pointermove/);
    assert.match(layout, /style\.translate/);
  });

  suite.test('touch sustained fire cannot depend on the legacy continuous fire flag', async () => {
    const pubg = await source('game-web/src/mobile/pubgTouchControls.ts');
    const weaponController = await source('game-web/src/gameplay/advancedWeaponController.ts');
    assert.match(pubg, /beginFire\(event\.pointerId\)/);
    assert.match(pubg, /dispatchMouse\(0, true\)/);
    assert.ok(!/inputState\.fire\s*=\s*true/.test(pubg), 'PUBG layer must not enable the engine direct-fire bypass');
    assert.match(weaponController, /state\.magazine\s*=\s*Math\.max\(0, state\.magazine - 1\)/);
    assert.match(weaponController, /state\.magazine <= 0/);
    assert.match(weaponController, /state\.reserve <= 0/);
  });

  suite.test('Vercel config applies global browser security policy without breaking gyro/WebRTC', async () => {
    const config = JSON.parse(await source('game-web/vercel.json'));
    const globalRule = config.headers.find((rule) => rule.source === '/(.*)');
    assert.ok(globalRule, 'global header rule missing');
    const headers = Object.fromEntries(globalRule.headers.map((item) => [item.key, item.value]));
    assert.equal(headers['X-Content-Type-Options'], 'nosniff');
    assert.equal(headers['X-Frame-Options'], 'DENY');
    assert.equal(headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
    assert.match(headers['Permissions-Policy'], /gyroscope=\(self\)/);
    assert.match(headers['Permissions-Policy'], /accelerometer=\(self\)/);
    assert.match(headers['Content-Security-Policy'], /default-src 'self'/);
    assert.match(headers['Content-Security-Policy'], /connect-src 'self' https: wss:/);
    assert.match(headers['Content-Security-Policy'], /worker-src 'self' blob:/);
  });

  suite.test('client crash diagnostics are bounded, privacy-safe and Vercel-loggable', async () => {
    const client = await source('game-web/src/observability/clientDiagnostics.ts');
    const endpoint = await source('game-web/api/client-telemetry.js');
    assert.match(client, /MAX_REPORTS = 24/);
    assert.match(client, /DUPLICATE_WINDOW_MS = 20_000/);
    assert.match(client, /BUILD_ID/);
    assert.match(client, /navigator\.sendBeacon/);
    assert.ok(!client.includes('navigator.userAgent,'), 'raw user agent must not be sent');
    assert.match(endpoint, /ALLOWED_KINDS/);
    assert.match(endpoint, /16_384/);
    assert.match(endpoint, /x-vercel-id/);
    assert.match(endpoint, /console\.error\(output\)/);
  });

  suite.test('network churn stress coverage protects transient direct WebRTC disconnects', async () => {
    const rtc = await source('game-web/src/net/directWebRtc.ts');
    const stress = await source('tests/tier4_workloads/test_mobile_network_churn.mjs');
    assert.match(rtc, /DISCONNECTED_GRACE_MS = 6000/);
    assert.match(rtc, /HEARTBEAT_INTERVAL_MS = 3000/);
    assert.match(rtc, /HEARTBEAT_TIMEOUT_MS = 15000/);
    assert.match(stress, /for \(let i = 0; i < 100; i \+= 1\)/);
    assert.match(stress, /sendCurrentState/);
    assert.match(stress, /gone-reconnect-requested/);
  });
}

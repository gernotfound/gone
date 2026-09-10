import { chromium } from 'playwright';

const BASE_URL = process.env.GONE_SMOKE_URL || 'http://127.0.0.1:4173';
const TIMEOUT = 25_000;

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(fn, description, timeout = TIMEOUT, interval = 100) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (err) {
      lastError = err;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (err) => errors.push(`[${label}] pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`[${label}] console.error: ${msg.text()}`);
  });
}

async function main() {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  const errors = [];
  const host = await context.newPage();
  const guest = await context.newPage();
  attachDiagnostics(host, 'host', errors);
  attachDiagnostics(guest, 'guest', errors);

  try {
    console.log('[combat] Creating direct host-owned room');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

    const invite = await waitFor(async () => {
      const value = await host.locator('#invite-link-input').inputValue();
      return value.includes('#direct=') ? value : null;
    }, 'host invite');

    await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: TIMEOUT });
    await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: TIMEOUT });

    const answer = await waitFor(async () => {
      const label = await guest.locator('#invite-link-container label').textContent().catch(() => '');
      const value = await guest.locator('#invite-link-input').inputValue().catch(() => '');
      return label?.includes('RISPOSTA') && value.length > 100 ? value : null;
    }, 'guest answer');

    await host.locator('#direct-host-answer-input').fill(answer);
    await host.locator('#btn-direct-apply-answer').click();

    await waitFor(
      async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'),
      'guest connected',
      15_000,
    );

    const guestId = await guest.evaluate(() => window.goneGame.getP2PClient().playerId);
    invariant(typeof guestId === 'string' && guestId.length > 0, 'Guest player id missing');

    console.log('[combat] Positioning authoritative shooter and victim');
    await guest.evaluate(() => {
      window.goneGame.player.position.set(0, 17.5, 0);
    });

    await host.evaluate(() => {
      const session = window.goneGame.getP2PHost();
      session.updateHostPlayerState({
        position: { x: 0, y: 17.5, z: 10 },
        yaw: Math.PI,
        pitch: 0,
        activeWeapon: 0,
      });
      const hostRecord = session.playerRecords.get(session.hostPlayer.id);
      if (!hostRecord) throw new Error('Host combat record missing');
      hostRecord.shieldExpiresAt = 0;
    });

    await waitFor(async () => host.evaluate((id) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(id);
      return !!record && Math.abs(record.position.x) < 0.5 && Math.abs(record.position.z) < 0.5 && record.lastClientSeq > 0;
    }, guestId), 'guest state history on authoritative host', 8_000);

    console.log('[combat] Firing guest shot over WebRTC with intentionally offset muzzle origin');
    const beforeHp = await host.evaluate(() => window.goneGame.getP2PHost().playerRecords.get('host').hp);
    invariant(beforeHp === 100, `Host HP should start at 100, got ${beforeHp}`);

    await guest.evaluate(() => {
      // X=3 deliberately represents the old viewmodel-muzzle mismatch. The
      // authoritative lag compensator must anchor X/Z to the shooter state so
      // the server validates the same ray the crosshair represents.
      window.goneGame.getP2PClient().fireHitscan(0, [3, 17.3, 0], [0, 0, 1]);
    });

    const hitHp = await waitFor(async () => host.evaluate(() => {
      const hp = window.goneGame.getP2PHost().playerRecords.get('host')?.hp;
      return typeof hp === 'number' && hp < 100 ? hp : null;
    }), 'authoritative WebRTC hitscan damage', 5_000);

    invariant(hitHp > 0 && hitHp < 100, `Expected non-fatal authoritative damage, got ${hitHp}`);

    await waitFor(
      async () => host.evaluate((expectedHp) => window.goneGame.player.hp === expectedHp, hitHp),
      'host local HUD/player HP to match authoritative record',
      5_000,
    );

    console.log('[combat] Verifying an opposite-direction shot cannot damage through the server');
    await guest.evaluate(() => {
      window.goneGame.getP2PClient().fireHitscan(0, [3, 17.3, 0], [0, 0, -1]);
    });
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterMissHp = await host.evaluate(() => window.goneGame.getP2PHost().playerRecords.get('host')?.hp);
    invariant(afterMissHp === hitHp, `Miss changed authoritative HP from ${hitHp} to ${afterMissHp}`);

    if (errors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${errors.join('\n')}`);
    }

    console.log('[combat] PASS', JSON.stringify({ guestId, hostHpAfterHit: hitHp, hostHpAfterMiss: afterMissHp }));
  } finally {
    await context.close();
    await browser.close();
  }
}

main().catch((err) => {
  console.error('[combat] FAIL');
  console.error(err?.stack || err);
  process.exit(1);
});

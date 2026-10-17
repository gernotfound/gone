import { chromium } from 'playwright';
import { useUnavailableRoomRendezvous } from './helpers/manual_room_fallback.mjs';

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
  await useUnavailableRoomRendezvous(context);
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

    console.log('[combat] Seeding shooter from authoritative spawn and positioning victim relative to it');
    const shooterState = await host.evaluate((id) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(id);
      if (!record) throw new Error('Guest combat record missing');
      return { x: record.position.x, y: record.position.y, z: record.position.z };
    }, guestId);

    await guest.evaluate((position) => {
      const client = window.goneGame.getP2PClient();
      client.setStateProvider(() => ({
        position,
        yaw: 0,
        pitch: 0,
        activeWeapon: 0,
        flags: 1,
      }));
      client.sendCurrentState();
    }, shooterState);

    await waitFor(async () => host.evaluate((id) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(id);
      return !!record && record.lastClientTimestamp > 0 && session.__gonePvpHardeningState.acceptedClientStates > 0;
    }, guestId), 'guest state history on authoritative host', 8_000);

    await host.evaluate((shooter) => {
      const session = window.goneGame.getP2PHost();
      session.updateHostPlayerState({
        position: { x: shooter.x, y: shooter.y, z: shooter.z + 10 },
        yaw: Math.PI,
        pitch: 0,
        activeWeapon: 0,
      });
      const hostRecord = session.playerRecords.get(session.hostPlayer.id);
      if (!hostRecord) throw new Error('Host combat record missing');
      hostRecord.shieldExpiresAt = 0;
    }, shooterState);

    console.log('[combat] Firing guest shot over WebRTC with intentionally offset muzzle origin');
    const beforeHp = await host.evaluate(() => window.goneGame.getP2PHost().playerRecords.get('host').hp);
    invariant(beforeHp === 100, `Host HP should start at 100, got ${beforeHp}`);

    await guest.evaluate((shooter) => {
      // X+3 deliberately represents the old viewmodel-muzzle mismatch. The
      // authoritative host must anchor X/Z to the accepted shooter transform.
      window.goneGame.getP2PClient().fireHitscan(
        0,
        [shooter.x + 3, shooter.y - 0.2, shooter.z],
        [0, 0, 1],
      );
    }, shooterState);

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
    await new Promise((resolve) => setTimeout(resolve, 300));
    await guest.evaluate((shooter) => {
      window.goneGame.getP2PClient().fireHitscan(
        0,
        [shooter.x + 3, shooter.y - 0.2, shooter.z],
        [0, 0, -1],
      );
    }, shooterState);
    await new Promise((resolve) => setTimeout(resolve, 300));
    const afterMissHp = await host.evaluate(() => window.goneGame.getP2PHost().playerRecords.get('host')?.hp);
    invariant(afterMissHp === hitHp, `Miss changed authoritative HP from ${hitHp} to ${afterMissHp}`);


    console.log('[combat] Checking the host renderer after starting a real game');
    await host.locator('#btn-play-multiplayer').click();
    await waitFor(
      () => host.evaluate(() =>
        window.goneGame?.vfxManager?.isReady()
        && !document.getElementById('game-canvas')?.classList.contains('hidden')),
      'host canvas/VFX initialized', 90_000, 100,
    );
    // Losing pointer lock hides the HUD, not the still-visible 3D scene.
    await host.evaluate(() => document.getElementById('game-ui').classList.add('hidden'));
    const priorAccepted = await host.evaluate(() =>
      window.goneGame.getP2PHost().__gonePvpHardeningState.accepted,
    );

    await guest.evaluate((shooter) => {
      window.goneGame.getP2PClient().fireHitscan(
        0, [shooter.x, shooter.y - 0.2, shooter.z], [0, 0, 1],
      );
    }, shooterState);

    const hostShotDiagnostics = () => host.evaluate(() => {
      const session = window.goneGame.getP2PHost();
      const pool = window.goneGame.vfxManager.getTracerPool();
      return {
        accepted: session.__gonePvpHardeningState.accepted,
        rejectedWeapon: session.__gonePvpHardeningState.rejectedWeapon,
        rejectedCadence: session.__gonePvpHardeningState.rejectedCadence,
        rejectedDirection: session.__gonePvpHardeningState.rejectedDirection,
        roundLocked: session.isRoundLocked(),
        guestWeapon: session.playerRecords.get("guest")?.activeWeapon,
        guestAlive: [...session.playerRecords.values()].filter(r => r.id !== session.hostPlayer.id).map(r => r.isAlive),
        canvasVisible: !document.getElementById('game-canvas')?.classList.contains('hidden'),
        hudVisible: !document.getElementById('game-ui')?.classList.contains('hidden'),
        vfxReady: window.goneGame.vfxManager.isReady(),
        tracersEverSpawned: pool.getTracers().filter(t => t.length > 0).length,
        tracersActive: pool.getActiveCount(),
      };
    });
    try {
      await waitFor(() => hostShotDiagnostics().then((d) =>
        d.accepted > priorAccepted ? d : null), 'host accepts the guest shot', 6000, 30);
      const visualResult = await waitFor(
        () => host.evaluate(() => {
          const tracers = window.goneGame.vfxManager.getTracerPool().getTracers();
          // Persistent beam endpoints remain after the short visible lifetime.
          return tracers.some(t => t.length > 0 && t.weaponType === 'assalto'
            && t.start.lengthSq() > 0 && t.end.lengthSq() > 0);
        }),
        'host spawns a real guest bullet tracer', 3000, 20,
      );
      invariant(visualResult, 'host did not construct the guest beam');
    } catch (error) {
      console.log('[combat] HOST_SHOT_DIAGNOSTICS', JSON.stringify(await hostShotDiagnostics()));
      throw error;
    }

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

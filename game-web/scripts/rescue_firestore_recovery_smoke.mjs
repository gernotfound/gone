import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { chromium } from 'playwright';

const PORT = 4174;
const BASE_URL = `http://127.0.0.1:${PORT}`;
const FIREBASE_PROJECT_ID = 'gone-recovery-smoke';
const TIMEOUT = 55_000;
const COLLECTION = 'gone_signaling_rooms_v1';

function invariant(condition, message) {
  if (!condition) throw new Error(message);
}

async function waitFor(fn, description, timeout = TIMEOUT, interval = 120) {
  const started = Date.now();
  let lastError;
  while (Date.now() - started < timeout) {
    try {
      const value = await fn();
      if (value) return value;
    } catch (error) {
      lastError = error;
    }
    await new Promise((resolve) => setTimeout(resolve, interval));
  }
  const suffix = lastError ? ` Last error: ${lastError.message}` : '';
  throw new Error(`Timed out waiting for ${description}.${suffix}`);
}

async function waitForServer(child) {
  let output = '';
  child.stdout?.on('data', (chunk) => { output += String(chunk); });
  child.stderr?.on('data', (chunk) => { output += String(chunk); });
  child.once('exit', (code) => {
    if (code && code !== 0) console.warn(`[rtc-recovery] dev server exited ${code}: ${output.slice(-1200)}`);
  });

  await waitFor(async () => {
    try {
      const response = await fetch(BASE_URL, { cache: 'no-store' });
      return response.ok;
    } catch {
      return false;
    }
  }, 'isolated Vite dev server', 20_000, 150);
}

function recoveryRoomId(anchorRoomId, generation) {
  return createHash('sha256')
    .update(`gone-recovery-v1:${anchorRoomId}:${generation}`)
    .digest('hex')
    .slice(0, 32);
}

function createFirestoreMock() {
  const documents = new Map();
  const operations = [];
  const injected = {
    recoveryPost503: 0,
    recoveryMissing403: 0,
    recoveryPatchCommitted503: 0,
  };
  let recoveryFaultRoomId = null;

  const configureRecoveryFaults = (roomId) => {
    recoveryFaultRoomId = roomId;
  };

  const attach = async (page) => {
    await page.route('https://firestore.googleapis.com/**', async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      const method = request.method();
      const segments = url.pathname.split('/').filter(Boolean);
      const collectionIndex = segments.lastIndexOf(COLLECTION);
      if (collectionIndex < 0) {
        await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'collection not mocked' } }) });
        return;
      }

      const explicitRoomId = segments[collectionIndex + 1] || null;
      const roomId = (method === 'POST' ? url.searchParams.get('documentId') : explicitRoomId)?.toLowerCase() || null;
      operations.push({ method, roomId });

      if (!roomId || !/^[a-f0-9]{32}$/.test(roomId)) {
        await route.fulfill({ status: 400, contentType: 'application/json', body: JSON.stringify({ error: { message: 'invalid room id' } }) });
        return;
      }

      const faultingRecoveryRoom = roomId === recoveryFaultRoomId;

      if (method === 'POST') {
        if (faultingRecoveryRoom && injected.recoveryPost503 === 0) {
          injected.recoveryPost503 += 1;
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'injected transient create outage' } }) });
          return;
        }
        if (documents.has(roomId)) {
          await route.fulfill({ status: 409, contentType: 'application/json', body: JSON.stringify({ error: { message: 'already exists' } }) });
          return;
        }
        const body = request.postDataJSON();
        const document = { fields: { ...(body?.fields || {}) } };
        documents.set(roomId, document);
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
        return;
      }

      if (method === 'GET') {
        const document = documents.get(roomId);
        if (!document) {
          if (faultingRecoveryRoom && injected.recoveryMissing403 === 0) {
            injected.recoveryMissing403 += 1;
            await route.fulfill({ status: 403, contentType: 'application/json', body: JSON.stringify({ error: { message: 'injected rules-style missing document denial' } }) });
            return;
          }
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'not found' } }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
        return;
      }

      if (method === 'PATCH') {
        const document = documents.get(roomId);
        if (!document) {
          await route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ error: { message: 'not found' } }) });
          return;
        }
        const body = request.postDataJSON();
        document.fields = { ...document.fields, ...(body?.fields || {}) };
        documents.set(roomId, document);
        if (faultingRecoveryRoom && injected.recoveryPatchCommitted503 === 0) {
          injected.recoveryPatchCommitted503 += 1;
          await route.fulfill({ status: 503, contentType: 'application/json', body: JSON.stringify({ error: { message: 'injected lost PATCH response after commit' } }) });
          return;
        }
        await route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify(document) });
        return;
      }

      if (method === 'DELETE') {
        documents.delete(roomId);
        await route.fulfill({ status: 200, contentType: 'application/json', body: '{}' });
        return;
      }

      await route.fulfill({ status: 405, contentType: 'application/json', body: JSON.stringify({ error: { message: 'method not mocked' } }) });
    });
  };

  return { attach, configureRecoveryFaults, documents, operations, injected };
}

async function installRtcTracking(context) {
  await context.addInitScript(() => {
    const NativeRtc = window.RTCPeerConnection;
    const tracked = [];
    Object.defineProperty(window, '__goneTrackedPeerConnections', {
      configurable: true,
      value: tracked,
    });
    Object.defineProperty(window, '__goneRtcRecoveryEvents', {
      configurable: true,
      value: [],
    });
    window.addEventListener('gone-rtc-recovery-state', (event) => {
      window.__goneRtcRecoveryEvents.push({ ...(event.detail || {}) });
    });
    const TrackedRtc = new Proxy(NativeRtc, {
      construct(Target, args) {
        const pc = Reflect.construct(Target, args, Target);
        tracked.push(pc);
        return pc;
      },
    });
    Object.defineProperty(window, 'RTCPeerConnection', {
      configurable: true,
      writable: true,
      value: TrackedRtc,
    });
  });
}

function attachDiagnostics(page, label, errors) {
  page.on('pageerror', (error) => errors.push(`[${label}] pageerror: ${error.message}`));
  page.on('console', (message) => {
    if (message.type() === 'error') console.warn(`[${label}] console.error: ${message.text()}`);
  });
}

async function main() {
  const server = spawn('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(PORT), '--strictPort'], {
    cwd: process.cwd(),
    env: { ...process.env, VITE_FIREBASE_PROJECT_ID: FIREBASE_PROJECT_ID },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForServer(server);

  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 1000, height: 700 } });
  await installRtcTracking(context);
  const firestore = createFirestoreMock();
  const browserErrors = [];
  const host = await context.newPage();
  const guest = await context.newPage();
  await firestore.attach(host);
  await firestore.attach(guest);
  attachDiagnostics(host, 'host', browserErrors);
  attachDiagnostics(guest, 'guest', browserErrors);

  try {
    console.log('[rtc-recovery] Creating Firestore-backed host invite');
    await host.goto(BASE_URL, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await host.locator('#btn-multiplayer').click();
    await host.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: 20_000 });
    await host.locator('#player-username').fill('RecoveryHost');

    const invite = await waitFor(async () => {
      const value = await host.locator('#invite-link-input').inputValue().catch(() => '');
      return value.includes('#room=') ? value : null;
    }, 'Firestore room invite', 25_000);
    const anchorRoomId = new URLSearchParams(new URL(invite).hash.replace(/^#/, '')).get('room');
    invariant(anchorRoomId && /^[a-f0-9]{32}$/.test(anchorRoomId), `Invalid anchor room id: ${anchorRoomId}`);
    const expectedRecoveryRoomId = recoveryRoomId(anchorRoomId, 2);
    firestore.configureRecoveryFaults(expectedRecoveryRoomId);

    console.log('[rtc-recovery] Guest opens automatic room link');
    await guest.goto(invite, { waitUntil: 'domcontentloaded', timeout: 20_000 });
    await guest.locator('#multiplayer-lobby').waitFor({ state: 'visible', timeout: 20_000 });

    await waitFor(async () => guest.evaluate(() => window.goneGame?.getP2PClient?.()?.status === 'connected'), 'initial guest connection');
    await waitFor(async () => host.evaluate(() => window.goneGame?.getP2PHost?.()?.getClientCount?.() === 1), 'initial authoritative host peer');

    const before = await guest.evaluate(() => {
      const client = window.goneGame.getP2PClient();
      window.__goneRecoveryClientBefore = client;
      return {
        playerId: client.playerId,
        slot: client.playerSlot,
        status: client.status,
        pcCount: window.__goneTrackedPeerConnections.length,
      };
    });
    invariant(before.status === 'connected' && Number.isInteger(before.slot), `Initial client state invalid: ${JSON.stringify(before)}`);
    invariant(before.pcCount >= 1, `Guest RTCPeerConnection was not tracked: ${JSON.stringify(before)}`);

    await host.evaluate((playerId) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(playerId);
      if (!record) throw new Error('Guest authoritative record missing before recovery');
      record.shieldExpiresAt = 0;
      session.dealDamage(playerId, 27);
      session.tickSnapshot();
    }, before.playerId);
    await waitFor(async () => guest.evaluate(() => window.goneGame.getP2PClient()?.clientHp === 73), 'pre-recovery authoritative HP');

    console.log('[rtc-recovery] Forcing terminal close with injected Firestore 503/403 ambiguity');
    await guest.evaluate(() => {
      const pc = window.__goneTrackedPeerConnections[0];
      if (!pc) throw new Error('Initial guest PeerConnection missing');
      pc.close();
    });

    await waitFor(async () => guest.evaluate(() =>
      window.__goneRtcRecoveryEvents.some((event) => event.state === 'recovered' && event.role === 'guest' && event.generation === 2)
    ), 'guest generation-2 recovery', TIMEOUT);
    await waitFor(async () => host.evaluate(() =>
      window.__goneRtcRecoveryEvents.some((event) => event.state === 'recovered' && event.role === 'host' && event.generation === 2)
    ), 'host generation-2 recovery', TIMEOUT);

    const after = await guest.evaluate(() => {
      const client = window.goneGame.getP2PClient();
      return {
        sameClient: client === window.__goneRecoveryClientBefore,
        playerId: client?.playerId,
        slot: client?.playerSlot,
        status: client?.status,
        hp: client?.clientHp,
        pcCount: window.__goneTrackedPeerConnections.length,
        events: [...window.__goneRtcRecoveryEvents],
      };
    });
    const hostAfter = await host.evaluate((playerId) => {
      const session = window.goneGame.getP2PHost();
      const record = session.playerRecords.get(playerId);
      return {
        clients: session.getClientCount(),
        slot: record?.slot,
        hp: record?.hp,
        events: [...window.__goneRtcRecoveryEvents],
      };
    }, before.playerId);

    invariant(after.sameClient, `Recovery replaced P2PClient instead of transport: ${JSON.stringify(after)}`);
    invariant(after.status === 'connected', `Guest status changed across transport recovery: ${JSON.stringify(after)}`);
    invariant(after.playerId === before.playerId && after.slot === before.slot, `Guest identity/slot changed: before=${JSON.stringify(before)} after=${JSON.stringify(after)}`);
    invariant(after.hp === 73, `Guest authoritative HP was lost across recovery: ${JSON.stringify(after)}`);
    invariant(hostAfter.clients === 1 && hostAfter.slot === before.slot && hostAfter.hp === 73, `Host authoritative record changed across recovery: ${JSON.stringify(hostAfter)}`);
    invariant(after.pcCount >= 2, `Guest replacement PeerConnection was not created: ${JSON.stringify(after)}`);

    console.log('[rtc-recovery] Verifying state traffic resumes on replacement transport');
    const positionBefore = await host.evaluate((playerId) => window.goneGame.getP2PHost().playerRecords.get(playerId)?.position.x, before.playerId);
    await guest.evaluate(() => { window.goneGame.player.position.x += 6; });
    await waitFor(async () => host.evaluate(([playerId, x]) => {
      const record = window.goneGame.getP2PHost().playerRecords.get(playerId);
      return !!record && Math.abs(record.position.x - x) > 3;
    }, [before.playerId, positionBefore]), 'post-recovery client state traffic', 12_000);

    invariant(
      firestore.operations.some((entry) => entry.method === 'POST' && entry.roomId === expectedRecoveryRoomId),
      `Host never created deterministic generation-2 recovery room ${expectedRecoveryRoomId}`,
    );
    invariant(
      firestore.operations.some((entry) => entry.method === 'PATCH' && entry.roomId === expectedRecoveryRoomId),
      `Guest never answered generation-2 recovery room ${expectedRecoveryRoomId}`,
    );
    await waitFor(
      async () => firestore.operations.some((entry) => entry.method === 'DELETE' && entry.roomId === expectedRecoveryRoomId),
      'generation-2 recovery room cleanup',
      5_000,
    );
    invariant(!firestore.documents.has(expectedRecoveryRoomId), 'Recovery mailbox should be deleted after transport replacement');
    invariant(firestore.injected.recoveryPost503 === 1, `Transient recovery POST failure was not exercised: ${JSON.stringify(firestore.injected)}`);
    invariant(firestore.injected.recoveryMissing403 === 1, `Missing-document 403 path was not exercised: ${JSON.stringify(firestore.injected)}`);
    invariant(firestore.injected.recoveryPatchCommitted503 === 1, `Ambiguous committed PATCH path was not exercised: ${JSON.stringify(firestore.injected)}`);

    if (browserErrors.length > 0) {
      throw new Error(`Browser exceptions detected:\n${browserErrors.join('\n')}`);
    }

    console.log('[rtc-recovery] PASS', JSON.stringify({
      anchorRoomId,
      recoveryRoomId: expectedRecoveryRoomId,
      playerId: before.playerId,
      slot: before.slot,
      hpPreserved: after.hp,
      sameClient: after.sameClient,
      hostClients: hostAfter.clients,
      guestPeerConnections: after.pcCount,
      injected: firestore.injected,
    }));
  } finally {
    await context.close();
    await browser.close();
    server.kill('SIGTERM');
    await new Promise((resolve) => {
      const timer = setTimeout(resolve, 1500);
      server.once('exit', () => {
        clearTimeout(timer);
        resolve();
      });
    });
    if (!server.killed) server.kill('SIGKILL');
  }
}

main().catch((error) => {
  console.error('[rtc-recovery] FAIL');
  console.error(error?.stack || error);
  process.exit(1);
});

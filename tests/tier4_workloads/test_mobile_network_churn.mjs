import assert from 'node:assert/strict';

export async function run(suite) {
  suite.test('mobile direct WebRTC tolerates repeated transient disconnect churn', async () => {
    const originalWindow = globalThis.window;
    const timeoutEntries = new Map();
    const intervalEntries = new Map();
    let nextTimerId = 1;
    const windowListeners = new Map();

    const fakeWindow = {
      setTimeout(fn, ms) {
        const id = nextTimerId++;
        timeoutEntries.set(id, { fn, ms, cleared: false });
        return id;
      },
      clearTimeout(id) {
        const entry = timeoutEntries.get(id);
        if (entry) entry.cleared = true;
      },
      setInterval(fn, ms) {
        const id = nextTimerId++;
        intervalEntries.set(id, { fn, ms, cleared: false });
        return id;
      },
      clearInterval(id) {
        const entry = intervalEntries.get(id);
        if (entry) entry.cleared = true;
      },
      addEventListener(type, fn) {
        const items = windowListeners.get(type) ?? [];
        items.push(fn);
        windowListeners.set(type, items);
      },
      removeEventListener(type, fn) {
        windowListeners.set(type, (windowListeners.get(type) ?? []).filter((item) => item !== fn));
      },
    };
    globalThis.window = fakeWindow;

    class EventHub {
      constructor() { this.listeners = new Map(); }
      addEventListener(type, fn) {
        const items = this.listeners.get(type) ?? [];
        items.push(fn);
        this.listeners.set(type, items);
      }
      removeEventListener(type, fn) {
        this.listeners.set(type, (this.listeners.get(type) ?? []).filter((item) => item !== fn));
      }
      emit(type, event = {}) {
        for (const fn of this.listeners.get(type) ?? []) fn(event);
      }
    }

    class FakeChannel extends EventHub {
      constructor() {
        super();
        this.readyState = 'open';
        this.binaryType = 'arraybuffer';
        this.bufferedAmount = 0;
        this.sent = [];
      }
      send(data) { this.sent.push(data); }
      close() {
        if (this.readyState === 'closed') return;
        this.readyState = 'closed';
        this.emit('close');
      }
    }

    class FakePeerConnection extends EventHub {
      constructor() {
        super();
        this.connectionState = 'connected';
        this.iceConnectionState = 'connected';
      }
      close() { this.connectionState = 'closed'; }
    }

    try {
      const { NativeRtcDataChannel } = await import('../../game-web/src/net/directWebRtc.ts');
      const raw = new FakeChannel();
      const pc = new FakePeerConnection();
      const channel = new NativeRtcDataChannel(raw, pc);
      let closeCount = 0;
      let errorCount = 0;
      channel.onclose = () => { closeCount += 1; };
      channel.onerror = () => { errorCount += 1; };

      // 100 short radio/network transitions must arm a grace timer and recover
      // without closing the reliable DataChannel.
      for (let i = 0; i < 100; i += 1) {
        pc.connectionState = 'disconnected';
        pc.iceConnectionState = 'disconnected';
        pc.emit('connectionstatechange');
        const armed = [...timeoutEntries.values()].find((entry) => !entry.cleared && entry.ms === 6000);
        assert.ok(armed, `disconnect cycle ${i} must arm the 6s grace timer`);

        pc.connectionState = 'connected';
        pc.iceConnectionState = 'connected';
        pc.emit('iceconnectionstatechange');
        assert.equal(closeCount, 0, `disconnect cycle ${i} must recover without closing`);
      }

      // A disconnect that outlives the grace window must fail deterministically.
      pc.connectionState = 'disconnected';
      pc.iceConnectionState = 'disconnected';
      pc.emit('connectionstatechange');
      const fatalTimer = [...timeoutEntries.values()].find((entry) => !entry.cleared && entry.ms === 6000);
      assert.ok(fatalTimer, 'fatal disconnect must arm a grace timer');
      fatalTimer.fn();
      assert.equal(raw.readyState, 'closed', 'expired grace period must close the DataChannel');
      assert.equal(closeCount, 1, 'close callback must fire exactly once');
      assert.equal(errorCount, 1, 'fatal disconnect must surface exactly one error');

      const heartbeat = [...intervalEntries.values()].find((entry) => entry.ms === 3000);
      assert.ok(heartbeat, 'open channels must install the 3s heartbeat cadence');
      
      // Simulate a blocked game-loading event loop. The peer must not be
      // declared dead before queued WebRTC messages can be processed.
      const originalPerformance = Object.getOwnPropertyDescriptor(globalThis, 'performance');
      let fakeTime = 0;
      Object.defineProperty(globalThis, 'performance', {
        configurable: true,
        value: { now: () => fakeTime },
      });
      try {
        const healthyRaw = new FakeChannel();
        const healthy = new NativeRtcDataChannel(healthyRaw, new FakePeerConnection());
        const healthyTick = [...intervalEntries.values()].at(-1).fn;
        fakeTime = 3000;
        healthyTick();
        assert.equal(healthyRaw.readyState, 'open');
        fakeTime = 70000;
        healthyTick();
        assert.equal(healthyRaw.readyState, 'open', 'suspended local timers cannot prove a remote timeout');
        assert.ok(healthyRaw.sent.includes('__gone_ping__'), 'recovery must probe the existing peer');

        fakeTime = 70010;
        healthyRaw.emit('message', { data: '__gone_pong__' });
        fakeTime = 73000;
        healthyTick();
        assert.equal(healthyRaw.readyState, 'open', 'live peer must recover without SDP renegotiation');
        healthy.close();

        fakeTime = 0;
        const staleRaw = new FakeChannel();
        const stale = new NativeRtcDataChannel(staleRaw, new FakePeerConnection());
        const staleTick = [...intervalEntries.values()].at(-1).fn;
        let staleErrors = 0;
        stale.onerror = () => { staleErrors += 1; };
        for (let elapsed = 3000; elapsed <= 18000; elapsed += 3000) {
          fakeTime = elapsed;
          staleTick();
        }
        assert.equal(staleRaw.readyState, 'closed', 'nonresponsive peer with regular timer cadence still times out');
        assert.equal(staleErrors, 1, 'real expiry must report exactly one terminal error');
      } finally {
        if (originalPerformance) Object.defineProperty(globalThis, 'performance', originalPerformance);
      }
    } finally {
      globalThis.window = originalWindow;
    }
  });

  suite.test('mobile resume source clears inputs and resyncs through the shared lifecycle broker', async () => {
    const fs = await import('node:fs/promises');
    const resume = await fs.readFile(new URL('../../game-web/src/mobile/mobileSessionResume.ts', import.meta.url), 'utf8');
    assert.match(resume, /resetInputState\(\)/, 'background/offline handling must clear transient input');
    assert.match(resume, /browserLifecycle\.subscribe\('offline', 'mobileSessionResume'/, 'offline transitions must use the lifecycle owner');
    assert.match(resume, /browserLifecycle\.subscribe\('online', 'mobileSessionResume'/, 'online transitions must use the lifecycle owner');
    assert.ok(!resume.includes("window.addEventListener('offline'"), 'mobile resume must not install a second native offline listener');
    assert.ok(!resume.includes("window.addEventListener('online'"), 'mobile resume must not install a second native online listener');
    assert.match(resume, /sendCurrentState\?\.\(\)/, 'online recovery must send an immediate state frame');
    assert.match(resume, /startSnapshotTick/, 'host snapshot cadence must resume after foreground/network recovery');
    assert.match(resume, /gone-reconnect-requested/, 'terminal disconnects must publish a reconnect request');
  });
}

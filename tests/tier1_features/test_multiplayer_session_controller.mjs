import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  const controller = source('game-web', 'src', 'net', 'multiplayerSessionController.ts');
  const lobby = source('game-web', 'src', 'ui', 'lobby.ts');
  const selfHost = source('game-web', 'src', 'net', 'selfHostSession.ts');
  const bindings = source('game-web', 'src', 'gameplay', 'networkBindings.ts');
  const engine = source('game-web', 'src', 'gameplay', 'engine.ts');
  const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');
  const legacyLifecycle = path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'sessionLifecycleHardening.ts');

  suite.test('Multiplayer session state has one typed owner outside UI', () => {
    assert(controller.includes('class MultiplayerSessionController'), 'session controller must own multiplayer lifecycle');
    assert(controller.includes('export let activeP2PClient') && controller.includes('export let activeP2PHost'), 'active transports must live in the session owner');
    assert(controller.includes('type SessionRuntimeBridge'), 'gameplay attachment must use a typed bridge rather than window.goneGame lookups');
    assert(controller.includes("new CustomEvent('gone-session-changed'"), 'session role transitions must remain observable');
    assert(controller.includes('hostPeerChannels'), 'host peer channels must be tracked for deterministic teardown');
  });

  suite.test('Lobby is presentation and intent only', () => {
    for (const forbidden of ['new P2PClient', 'new P2PHost', 'createDirectHostOffer', 'createDirectGuestAnswer', 'SimpleLagCompensator']) {
      assert(!lobby.includes(forbidden), `lobby UI must not own ${forbidden}`);
    }
    assert(lobby.includes('multiplayerSessionController.subscribe(renderSession)'), 'lobby must render controller snapshots');
    assert(lobby.includes('multiplayerSessionController.requestLocalColor'), 'color UI must emit intent to the session owner');
    assert(lobby.includes('multiplayerSessionController.startHost'), 'host UI must delegate session creation');
    assert(lobby.includes('multiplayerSessionController.startDirectGuest'), 'guest UI must delegate direct negotiation');
  });

  suite.test('Self-host transport reuses the same session controller', () => {
    assert(!selfHost.includes('new P2PClient'), 'self-host must not create a parallel client implementation');
    assert(!selfHost.includes('guardClientRenderingUntilGameplay'), 'render gating must live behind the shared session runtime bridge');
    assert(selfHost.includes('multiplayerSessionController.registerHostPeer'), 'relay host peers must enter through shared session ownership');
    assert(selfHost.includes('multiplayerSessionController.startGuestOnChannel'), 'relay guests must reuse shared client callbacks/state');
    assert(selfHost.includes('{ prepareDirectInvite: false }'), 'self-host host mode must not create an unused direct-WebRTC offer');
  });

  suite.test('Gameplay binds through controller instead of importing session state from UI', () => {
    assert(bindings.includes("from '../net/multiplayerSessionController.ts'"), 'network bindings must update session state at the network owner');
    assert(!bindings.includes("from '../ui/lobby.ts'"), 'gameplay networking must not depend on lobby UI');
    assert(engine.includes('configureSessionRuntimeBridge({'), 'engine must register typed gameplay attachment once');
    assert(engine.includes('multiplayerSessionController.broadcastGameStart()'), 'game start broadcast must not iterate private host peers');
  });

  suite.test('Polling session patch layer is removed', () => {
    assert(!fs.existsSync(legacyLifecycle), 'sessionLifecycleHardening patch layer must stay deleted');
    assert(!runtime.includes('sessionLifecycleHardening'), 'runtime composition must not re-register the deleted patch layer');
    assert(!controller.includes('setInterval('), 'session correctness must be transition-driven rather than polling-driven');
    assert(!lobby.includes('processColorChangeRequest ='), 'lobby must never monkey-patch host color processing');
  });
}

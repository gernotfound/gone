import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('Terminal mobile WebRTC failure requires explicit renegotiation and offers a safe recovery action', () => {
    const resume = source('game-web', 'src', 'mobile', 'mobileSessionResume.ts');
    const recovery = source('game-web', 'src', 'ui', 'terminalSessionRecovery.ts');
    const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');

    assert(resume.includes('SESSIONE TERMINATA · SERVE UN NUOVO INVITO'), 'terminal disconnect copy must not promise transparent reconnection');
    assert(resume.includes('terminal: true') && resume.includes('requiresRenegotiation: true'), 'reconnect intent must describe terminal RTC semantics');
    assert(resume.includes("new CustomEvent('gone-reconnect-requested'"), 'existing reconnect intent event must remain compatible');

    assert(recovery.includes("from '../net/multiplayerSessionController.ts'"), 'recovery UI must use the canonical session owner');
    assert(recovery.includes("window.addEventListener('gone-reconnect-requested', showRecoveryOverlay)"), 'recovery must be event-driven');
    assert(recovery.includes("snapshot.role !== 'client'"), 'terminal guest recovery UI must not interfere with host sessions');
    assert(recovery.includes("setAttribute('role', 'alertdialog')") && recovery.includes("setAttribute('aria-modal', 'true')"), 'terminal recovery must be an accessible blocking decision');
    assert(recovery.includes('non può essere riaperta automaticamente') && recovery.includes('serve un nuovo invito'), 'recovery UI must explain that new SDP negotiation is required');
    assert(recovery.includes("params.has('direct')") && recovery.includes("params.delete('direct')"), 'returning to menu must remove the stale direct invite before reload');
    assert(recovery.includes('multiplayerSessionController.reset();') && recovery.includes('window.location.reload();'), 'recovery action must tear down stale session state before a clean reload');
    assert(!recovery.includes('setInterval(') && !recovery.includes('setTimeout('), 'terminal recovery must not poll or fake automatic reconnect');

    assert(runtime.includes("import { startTerminalSessionRecovery } from '../ui/terminalSessionRecovery.ts'"), 'recovery presentation must be registered by the composition root');
    assert(runtime.includes("name: 'terminalSessionRecovery'") && runtime.includes("phase: 'presentation'"), 'recovery must live in the presentation lifecycle phase');
  });
}

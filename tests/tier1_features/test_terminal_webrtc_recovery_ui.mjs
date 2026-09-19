import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('Manual recovery UI remains the safe fallback after automatic RTC recovery is unavailable or exhausted', () => {
    const direct = source('game-web', 'src', 'net', 'directWebRtc.ts');
    const resume = source('game-web', 'src', 'mobile', 'mobileSessionResume.ts');
    const recovery = source('game-web', 'src', 'ui', 'terminalSessionRecovery.ts');
    const runtime = source('game-web', 'src', 'runtime', 'startClientRuntime.ts');

    assert(direct.includes('setRecoveryHandler'), 'Firestore-backed direct transports must have an automatic recovery path before terminal close');
    assert(direct.includes('this.terminate('), 'failed/unavailable automatic recovery must still converge on deterministic terminal teardown');
    assert(resume.includes('SESSIONE TERMINATA · SERVE UN NUOVO INVITO'), 'terminal fallback copy must remain truthful after automatic recovery is exhausted');
    assert(resume.includes('terminal: true') && resume.includes('requiresRenegotiation: true'), 'terminal fallback intent must describe the remaining manual renegotiation requirement');
    assert(resume.includes("new CustomEvent('gone-reconnect-requested'"), 'existing terminal fallback event must remain compatible');

    assert(recovery.includes("from '../net/multiplayerSessionController.ts'"), 'recovery UI must use the canonical session owner');
    assert(recovery.includes("window.addEventListener('gone-reconnect-requested', showRecoveryOverlay)"), 'manual fallback must remain event-driven');
    assert(recovery.includes("snapshot.role !== 'client'"), 'terminal guest recovery UI must not interfere with host sessions');
    assert(recovery.includes("setAttribute('role', 'alertdialog')") && recovery.includes("setAttribute('aria-modal', 'true')"), 'terminal fallback must be an accessible blocking decision');
    assert(recovery.includes('non può essere riaperta automaticamente') && recovery.includes('serve un nuovo invito'), 'once auto recovery has failed, the UI must explain that a new invite is required');
    assert(recovery.includes("params.has('direct')") && recovery.includes("params.delete('direct')"), 'returning to menu must remove a stale manual direct invite before reload');
    assert(recovery.includes('multiplayerSessionController.reset();') && recovery.includes('window.location.reload();'), 'fallback action must tear down stale session state before a clean reload');
    assert(!recovery.includes('setInterval(') && !recovery.includes('setTimeout('), 'terminal UI itself must not duplicate transport recovery or poll');

    assert(runtime.includes("import { startTerminalSessionRecovery } from '../ui/terminalSessionRecovery.ts'"), 'fallback presentation must be registered by the composition root');
    assert(runtime.includes("name: 'terminalSessionRecovery'") && runtime.includes("phase: 'presentation'"), 'fallback must live in the presentation lifecycle phase');
  });
}

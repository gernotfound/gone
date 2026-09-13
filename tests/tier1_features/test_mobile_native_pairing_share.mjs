import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Direct WebRTC pairing offers native device sharing without changing session ownership', () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'lobby.ts'), 'utf8');

    assert(source.includes("typeof navigator.share === 'function'"), 'native share control must be feature-detected');
    assert(source.includes("snapshot.inviteKind !== 'host-link' && snapshot.inviteKind !== 'guest-answer'"), 'sharing must be limited to controller-owned invite/answer states');
    assert(source.includes("url: snapshot.inviteValue"), 'host flow must share the canonical direct invite URL');
    assert(source.includes("text: snapshot.inviteValue"), 'guest flow must share the canonical answer code verbatim');
    assert(source.includes("error.name === 'AbortError'"), 'canceling the operating-system share sheet must remain a no-op');
    assert(source.includes('await copyInviteValue(nativeShareButton)'), 'failed native sharing must fall back to the existing copy path');
    assert(source.includes("button.id = 'btn-direct-native-share'"), 'native share must be a lobby presentation control, not session-controller behavior');
    assert(source.includes("button.textContent = hostInvite ? 'CONDIVIDI INVITO' : 'INVIA RISPOSTA'"), 'share action must explain whether it carries the offer or answer');
    assert(source.includes('multiplayerSessionController.snapshot()'), 'UI share action must read the current controller snapshot rather than owning connection state');
    assert(source.includes('multiplayerSessionController.applyHostAnswer(answer.value)'), 'existing host answer application path must remain intact');
    assert(source.includes('multiplayerSessionController.startDirectGuest(directOfferCode'), 'existing guest negotiation path must remain intact');
  });
}

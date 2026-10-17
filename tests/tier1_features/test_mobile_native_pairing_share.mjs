import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('Direct WebRTC pairing offers native device sharing without changing session ownership', () => {
    const source = fs.readFileSync(path.join(PROJECT_ROOT, 'game-web', 'src', 'ui', 'lobby.ts'), 'utf8');

    assert(source.includes("typeof navigator.share === 'function'"), 'native share control must be feature-detected');
    assert(source.includes("snapshot.inviteKind !== 'host-link' && snapshot.inviteKind !== 'guest-answer' && snapshot.inviteKind !== 'room-code'"), 'sharing must be limited to controller-owned short-room/manual invite and answer states');
    assert(source.includes("snapshot.inviteKind === 'room-code'"), 'short code must have a native share path');
    assert(source.includes('url: buildRoomInviteUrl(snapshot.inviteValue)'), 'native short code sharing must use short deep links');
    assert(source.includes("url: snapshot.inviteValue"), 'host flow must share the canonical direct invite URL');
    assert(source.includes("text: snapshot.inviteValue"), 'guest flow must share the canonical answer code verbatim');
    assert(source.includes("error.name === 'AbortError'"), 'canceling the operating-system share sheet must remain a no-op');
    assert(source.includes('await copyInviteValue(nativeShareButton)'), 'failed native sharing must fall back to the existing copy path');
    assert(source.includes("button.id = 'btn-direct-native-share'"), 'native share must be a lobby presentation control, not session-controller behavior');
    assert(source.includes("snapshot.inviteKind === 'room-code' ? 'CONDIVIDI CODICE' : hostInvite ? 'CONDIVIDI INVITO' : 'INVIA RISPOSTA'"), 'share action must distinguish room code, manual invite and guest answer');
    assert(source.includes('multiplayerSessionController.snapshot()'), 'UI share action must read the current controller snapshot rather than owning connection state');
    assert(source.includes('multiplayerSessionController.applyHostAnswer(answer.value)'), 'existing host answer application path must remain intact');
    assert(source.includes('multiplayerSessionController.startRoomGuest.bind(multiplayerSessionController)'), 'five-character guest path must delegate to canonical session owner');
    assert(source.includes('multiplayerSessionController.startDirectGuest.bind(multiplayerSessionController)'), 'legacy manual guest negotiation path must remain intact');
  });
}

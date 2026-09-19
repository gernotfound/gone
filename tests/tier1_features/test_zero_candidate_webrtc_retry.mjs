import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

export async function run(suite) {
  suite.test('WebRTC retries only transient zero-candidate negotiation with a fresh transport', () => {
    const direct = fs.readFileSync(
      path.join(PROJECT_ROOT, 'game-web', 'src', 'net', 'directWebRtc.ts'),
      'utf8',
    );

    assert(direct.includes('const ICE_CANDIDATE_ATTEMPTS = 2;'), 'zero-candidate negotiation retry must stay bounded');
    assert(direct.includes("this.name = 'ZeroIceCandidatesError';"), 'zero-candidate failures must have a structured error class');
    assert(direct.includes('isZeroIceCandidatesError(error) && retryAttempt < ICE_CANDIDATE_ATTEMPTS'), 'retry must be limited to the zero-candidate error');
    assert(direct.includes('return createDirectHostOffer(retryAttempt + 1);'), 'host invite generation must retry with a fresh PeerConnection');
    assert(direct.includes('return createDirectGuestAnswer(offerCode, peerId, retryAttempt + 1);'), 'guest answer generation must retry with a fresh PeerConnection while preserving identity');
    assert(direct.includes('try { channel.close(); } catch { /* no-op */ }'), 'failed native channels must be retired before retrying');
    assert(direct.includes('const pc = createPeerConnection();'), 'each retry path must create a new PeerConnection rather than reusing a poisoned transport');
  });
}

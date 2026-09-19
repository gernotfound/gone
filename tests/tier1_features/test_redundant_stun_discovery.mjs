import fs from 'fs';
import path from 'path';
import { assert } from '../helpers/assertions.mjs';
import { PROJECT_ROOT } from '../helpers/asset_inspector.mjs';

function source(...parts) {
  return fs.readFileSync(path.join(PROJECT_ROOT, ...parts), 'utf8');
}

export async function run(suite) {
  suite.test('Direct WebRTC uses redundant public STUN discovery without TURN', () => {
    const direct = source('game-web', 'src', 'net', 'directWebRtc.ts');
    const peerConfig = direct.slice(
      direct.indexOf('function createPeerConnection'),
      direct.indexOf('function getOpcode'),
    );

    assert(direct.includes("stun:stun.cloudflare.com:3478"), 'Cloudflare must remain the primary public STUN endpoint');
    assert(direct.includes("stun:stun.l.google.com:19302"), 'a second public STUN endpoint must prevent single-endpoint discovery dependency');
    assert(direct.includes('PUBLIC_STUN_URLS'), 'STUN endpoints must have one canonical runtime list');
    assert(peerConfig.includes('iceServers: [{ urls: [...PUBLIC_STUN_URLS] }]'), 'every PeerConnection, including recovery transports, must use the redundant STUN list');
    assert(!/turns?:/i.test(peerConfig), 'TURN must remain absent from the peer connection configuration');
  });
}

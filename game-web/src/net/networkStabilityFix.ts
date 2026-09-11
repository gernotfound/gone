import { P2PHost } from './p2pHost.ts';
import type { IDataChannel } from './protocol.ts';

const PATCH_MARKER = '__goneStableBroadcastPatched';

type RuntimePeer = { channel: IDataChannel };

/**
 * Prevents snapshot spam against WebRTC channels that are not open yet or are
 * already closing. Realtime packets are disposable; closed peers are cleaned
 * deterministically instead of logging the same send error every snapshot.
 */
export function startNetworkStabilityFix(): void {
  const proto = P2PHost.prototype as any;
  if (proto[PATCH_MARKER]) return;
  proto[PATCH_MARKER] = true;

  const originalBroadcast = proto.broadcastBinary;

  proto.broadcastBinary = function(buffer: ArrayBuffer, excludePlayerId?: string): void {
    const peers = this.peers as Map<string, RuntimePeer> | undefined;
    if (!(peers instanceof Map)) {
      originalBroadcast.call(this, buffer, excludePlayerId);
      return;
    }

    const stalePeers: string[] = [];

    for (const [id, peer] of peers) {
      if (excludePlayerId && id === excludePlayerId) continue;

      const state = peer.channel?.readyState;
      if (state && state !== 'open') {
        if (state === 'closing' || state === 'closed') stalePeers.push(id);
        continue;
      }

      try {
        peer.channel.send(buffer);
      } catch (error) {
        const currentState = peer.channel?.readyState;
        const message = error instanceof Error ? error.message : String(error);
        const expectedClosedChannel =
          currentState === 'closing' ||
          currentState === 'closed' ||
          /datachannel.*non aperto|datachannel.*not open|closing|closed/i.test(message);

        if (expectedClosedChannel) {
          if (currentState === 'closing' || currentState === 'closed') stalePeers.push(id);
          continue;
        }

        console.error(`[P2PHost] Failed binary broadcast to ${id}:`, error);
      }
    }

    for (const id of stalePeers) {
      this.handlePeerDisconnect?.(id);
    }
  };
}

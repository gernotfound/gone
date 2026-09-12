import { P2PClient } from './p2pClient.ts';
import { P2PHost } from './p2pHost.ts';
import { PACKET_TYPE, unpackHitConfirmed, type HitConfirmedData } from './binaryProtocol.ts';
import { isBinaryMessage, toArrayBuffer } from './protocol.ts';

export type CombatHitEventDetail = {
  source: 'host' | 'client';
  hit: HitConfirmedData;
  sequence: number;
  at: number;
};

const HOST_MARKER = '__goneCombatEventBridgeHost';
const CLIENT_MARKER = '__goneCombatEventBridgeClient';
let sequence = 0;
let hostEvents = 0;
let clientEvents = 0;

function emit(source: 'host' | 'client', buffer: ArrayBuffer): void {
  if (buffer.byteLength < 1 || new DataView(buffer).getUint8(0) !== PACKET_TYPE.HIT_CONFIRMED) return;
  const hit = unpackHitConfirmed(buffer);
  if (!hit) return;

  if (source === 'host') hostEvents += 1;
  else clientEvents += 1;

  window.dispatchEvent(new CustomEvent<CombatHitEventDetail>('gone-hit-confirmed', {
    detail: {
      source,
      hit,
      sequence: ++sequence,
      at: performance.now(),
    },
  }));
}

/**
 * Protocol-level combat event bridge. Consumers such as hitmarkers and score
 * listen to one stable DOM event rather than stacking more mutable client/host
 * callbacks. This remains active even when lobby/reconnect code replaces UI
 * callbacks later in the session.
 */
export function startCombatEventBridge(): void {
  const hostProto = P2PHost.prototype as any;
  if (!hostProto[HOST_MARKER]) {
    hostProto[HOST_MARKER] = true;
    const originalBroadcast = hostProto.broadcastBinary;
    if (typeof originalBroadcast === 'function') {
      hostProto.broadcastBinary = function(buffer: ArrayBuffer, excludePlayerId?: string) {
        emit('host', buffer);
        return originalBroadcast.call(this, buffer, excludePlayerId);
      };
    }
  }

  const clientProto = P2PClient.prototype as any;
  if (!clientProto[CLIENT_MARKER]) {
    clientProto[CLIENT_MARKER] = true;
    const originalHandleMessage = clientProto.handleMessage;
    if (typeof originalHandleMessage === 'function') {
      clientProto.handleMessage = function(rawData: unknown) {
        if (isBinaryMessage(rawData)) {
          try {
            emit('client', toArrayBuffer(rawData));
          } catch {
            // Invalid packets are still left to the normal client decoder.
          }
        }
        return originalHandleMessage.call(this, rawData);
      };
    }
  }

  (window as any).goneCombatEvents = {
    snapshot: () => ({ sequence, hostEvents, clientEvents }),
  };
}

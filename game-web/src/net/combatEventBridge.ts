import { activeP2PClient, activeP2PHost, multiplayerSessionController } from './multiplayerSessionController.ts';
import type { P2PClient } from './p2pClient.ts';
import type { P2PHost } from './p2pHost.ts';
import type { HitConfirmedData } from './binaryProtocol.ts';

export type CombatHitEventDetail = {
  source: 'host' | 'client';
  hit: HitConfirmedData;
  sequence: number;
  at: number;
};

let sequence = 0;
let hostEvents = 0;
let clientEvents = 0;

function emit(source: 'host' | 'client', hit: HitConfirmedData): void {
  if (source === 'host') hostEvents += 1;
  else clientEvents += 1;
  window.dispatchEvent(new CustomEvent<CombatHitEventDetail>('gone-hit-confirmed', {
    detail: { source, hit, sequence: ++sequence, at: performance.now() },
  }));
}

/** Pure presentation adapter: protocol ownership remains with P2PHost/P2PClient. */
export function startCombatEventBridge(): void {
  let attachedHost: P2PHost | null = null;
  let attachedClient: P2PClient | null = null;
  let detachHost: (() => void) | null = null;
  let detachClient: (() => void) | null = null;

  multiplayerSessionController.subscribe(() => {
    if (attachedHost !== activeP2PHost) {
      detachHost?.();
      attachedHost = activeP2PHost;
      detachHost = attachedHost?.subscribeConfirmedHit((hit) => emit('host', hit)) ?? null;
    }
    if (attachedClient !== activeP2PClient) {
      detachClient?.();
      attachedClient = activeP2PClient;
      detachClient = attachedClient?.subscribeConfirmedHit((hit) => emit('client', hit)) ?? null;
    }
  });

  (window as any).goneCombatEvents = {
    snapshot: () => ({ sequence, hostEvents, clientEvents }),
  };
}

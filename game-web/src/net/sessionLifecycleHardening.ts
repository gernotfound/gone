type LifecycleState = {
  generation: number;
  sessionChanges: number;
  staleRemoteClears: number;
  callbackMutations: number;
  repairs: number;
  role: 'host' | 'client' | 'none';
  clientStatus: string;
};

const MARKER = '__goneSessionLifecycleHardeningInstalled';
let generation = 0;
let sessionChanges = 0;
let staleRemoteClears = 0;
let callbackMutations = 0;
let repairs = 0;
let role: LifecycleState['role'] = 'none';
let lastClient: any = null;
let lastHost: any = null;
let lastCallbackRefs: unknown[] = [];

function api(): any {
  return (window as any).goneGame;
}

function clearRemoteVisuals(game: any): void {
  const remotes = game?.remotePlayers;
  if (!(remotes instanceof Map) || remotes.size === 0) return;
  for (const id of Array.from(remotes.keys()) as string[]) game.removeRemotePlayer?.(id);
  staleRemoteClears += 1;
}

function callbackRefs(client: any): unknown[] {
  const cfg = client?.config;
  if (!cfg) return [];
  return [cfg.onWorldSnapshot, cfg.onHitConfirmed, cfg.onBinaryHitscanFired, cfg.onStatusChange];
}

function sameRefs(a: unknown[], b: unknown[]): boolean {
  return a.length === b.length && a.every((value, index) => value === b[index]);
}

function dispatchChange(nextRole: LifecycleState['role']): void {
  generation += 1;
  sessionChanges += 1;
  role = nextRole;
  window.dispatchEvent(new CustomEvent('gone-session-changed', {
    detail: { generation, role },
  }));
}

function snapshot(): LifecycleState {
  const game = api();
  const client = game?.getP2PClient?.();
  return {
    generation,
    sessionChanges,
    staleRemoteClears,
    callbackMutations,
    repairs,
    role,
    clientStatus: String(client?.status ?? 'none'),
  };
}

function monitor(): void {
  const game = api();
  if (!game) return;
  const host = game.getP2PHost?.();
  const client = game.getP2PClient?.();

  if (host !== lastHost || client !== lastClient) {
    lastHost = host;
    lastClient = client;
    lastCallbackRefs = callbackRefs(client);
    const nextRole: LifecycleState['role'] = host ? 'host' : client ? 'client' : 'none';
    if (nextRole !== role) {
      generation += 1;
      role = nextRole;
    }
  }

  if (!host && !client) clearRemoteVisuals(game);

  if (client) {
    const refs = callbackRefs(client);
    if (lastCallbackRefs.length > 0 && !sameRefs(lastCallbackRefs, refs)) callbackMutations += 1;
    lastCallbackRefs = refs;

    // Repair only a genuinely missing critical renderer callback. Re-wrapping a
    // valid callback would risk duplicate event chains, so this is deliberately
    // narrower than a generic periodic rebind.
    if (client.status === 'connected' && typeof client.config?.onWorldSnapshot !== 'function') {
      if (typeof game.bindP2PClientNetworking === 'function') {
        game.bindP2PClientNetworking(client);
        repairs += 1;
        lastCallbackRefs = callbackRefs(client);
      }
    }
  }
}

/**
 * Session lifecycle guard: when a session object is replaced, stop the old
 * high-frequency timer before binding the new one and clear stale remote
 * visuals. It does not close channels itself, leaving signaling/room teardown
 * to the existing lobby code.
 */
export function startSessionLifecycleHardening(): void {
  const game = api();
  if (!game || game[MARKER]) return;
  game[MARKER] = true;

  const originalSetClient = game.setP2PClient?.bind(game);
  if (originalSetClient) {
    game.setP2PClient = (next: any) => {
      const previous = game.getP2PClient?.();
      if (previous && previous !== next) previous.stopStateTick?.();
      if (previous !== next) {
        clearRemoteVisuals(game);
        dispatchChange(next ? 'client' : game.getP2PHost?.() ? 'host' : 'none');
      }
      return originalSetClient(next);
    };
  }

  const originalSetHost = game.setP2PHost?.bind(game);
  if (originalSetHost) {
    game.setP2PHost = (next: any) => {
      const previous = game.getP2PHost?.();
      if (previous && previous !== next) previous.stopSnapshotTick?.();
      if (previous !== next) {
        clearRemoteVisuals(game);
        dispatchChange(next ? 'host' : game.getP2PClient?.() ? 'client' : 'none');
      }
      return originalSetHost(next);
    };
  }

  lastHost = game.getP2PHost?.();
  lastClient = game.getP2PClient?.();
  role = lastHost ? 'host' : lastClient ? 'client' : 'none';
  lastCallbackRefs = callbackRefs(lastClient);
  window.setInterval(monitor, 750);

  (window as any).goneLifecycle = { snapshot };
}

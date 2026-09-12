import { getTerrainHeightAt } from '../world/chunkManager.ts';

export type SpawnPoint = {
  id: string;
  label: string;
  x: number;
  z: number;
};

/** Eight deterministic slots across the 4.8 km gameplay window. */
export const SPAWN_POINTS: readonly SpawnPoint[] = [
  { id: 'S1', label: 'CRATERE SE', x: 1200, z: 1200 },
  { id: 'S2', label: 'CORRIDOIO NE', x: 1200, z: -1200 },
  { id: 'S3', label: 'PIANORO SW', x: -1200, z: 1200 },
  { id: 'S4', label: 'MASSICCIO NW', x: -1200, z: -1200 },
  { id: 'S5', label: 'ANELLO EST', x: 1650, z: 250 },
  { id: 'S6', label: 'ANELLO SUD', x: 250, z: 1650 },
  { id: 'S7', label: 'ANELLO OVEST', x: -1650, z: -250 },
  { id: 'S8', label: 'ANELLO NORD', x: -250, z: -1650 },
] as const;

export const PLAYER_SPAWN_X = SPAWN_POINTS[0].x;
export const PLAYER_SPAWN_Z = SPAWN_POINTS[0].z;

const HOST_WRAP_MARKER = '__goneSpawnRespawnWrapped';
let localSpawnCount = 0;
let authoritativeRespawns = 0;
let currentSpawn: SpawnPoint = SPAWN_POINTS[0];

function gameApi(): any {
  return (window as any).goneGame;
}

export function getSpawnPointForSlot(slot: number | null | undefined): SpawnPoint {
  const safeSlot = Number.isInteger(slot) ? Math.abs(Number(slot)) : 0;
  return SPAWN_POINTS[safeSlot % SPAWN_POINTS.length];
}

export function getPlayerSpawnY(
  player?: { height?: number; floatHeight?: number },
  point: SpawnPoint = SPAWN_POINTS[0],
): number {
  const height = Number(player?.height ?? 2.0);
  const floatHeight = Number(player?.floatHeight ?? 0.5);
  return getTerrainHeightAt(point.x, point.z) + height + floatHeight;
}

function localSlot(api: any): number {
  if (api?.getP2PHost?.()) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : 0;
}

function teleportLocalPlayer(point?: SpawnPoint): SpawnPoint | null {
  const api = gameApi();
  const player = api?.player;
  if (!player?.position) return null;
  const selected = point ?? getSpawnPointForSlot(localSlot(api));

  player.position.set(selected.x, getPlayerSpawnY(player, selected), selected.z);
  player.velocity?.set?.(0, 0, 0);
  currentSpawn = selected;
  localSpawnCount += 1;
  return selected;
}

function attachAuthoritativeRespawn(host: any): void {
  if (!host?.options || host[HOST_WRAP_MARKER]) return;
  host[HOST_WRAP_MARKER] = true;

  const previous = host.options.onPlayerRespawned;
  host.options.onPlayerRespawned = (playerId: string) => {
    const record = host.playerRecords?.get?.(playerId);
    if (record) {
      const point = getSpawnPointForSlot(record.slot);
      record.position = {
        x: point.x,
        y: getPlayerSpawnY(undefined, point),
        z: point.z,
      };
      authoritativeRespawns += 1;
    }
    previous?.(playerId);
  };
}

/**
 * Multiplayer spawn policy: host slot 0 keeps the requested SE crater spawn;
 * slots 1..7 are distributed across seven additional sectors. Respawns are
 * deterministic by slot, so host and guest independently resolve the same
 * location without adding a network packet.
 */
export function startSpawnController(): void {
  if ((window as any).__goneSpawnControllerStarted) return;
  (window as any).__goneSpawnControllerStarted = true;

  let firstGameplaySpawnApplied = false;
  let wasAlive = true;

  const frame = () => {
    const api = gameApi();
    const player = api?.player;
    const gameUi = document.getElementById('game-ui');
    const gameplayVisible = !!gameUi && !gameUi.classList.contains('hidden');

    const host = api?.getP2PHost?.();
    if (host) attachAuthoritativeRespawn(host);

    if (player) {
      const alive = player.isAlive !== false;
      if (gameplayVisible && !firstGameplaySpawnApplied) {
        teleportLocalPlayer();
        firstGameplaySpawnApplied = true;
      } else if (!wasAlive && alive) {
        teleportLocalPlayer();
      }
      wasAlive = alive;
    }

    window.requestAnimationFrame(frame);
  };

  (window as any).goneSpawnPolicy = {
    points: SPAWN_POINTS,
    respawnNow: () => {
      const selected = teleportLocalPlayer();
      return selected ? { ...selected } : null;
    },
    snapshot: () => ({
      slot: localSlot(gameApi()),
      current: { ...currentSpawn },
      localSpawnCount,
      authoritativeRespawns,
    }),
  };

  window.requestAnimationFrame(frame);
}

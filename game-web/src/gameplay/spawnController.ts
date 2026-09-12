import {
  SPAWN_POINTS,
  getPlayerSpawnY,
  getSpawnPointForSlot,
  type SpawnPoint,
} from './spawnPolicy.ts';

export {
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  SPAWN_POINTS,
  getPlayerSpawnY,
  getSpawnPointForSlot,
  type SpawnPoint,
} from './spawnPolicy.ts';

const HOST_WRAP_MARKER = '__goneSpawnRespawnWrapped';
let localSpawnCount = 0;
let authoritativeRespawns = 0;
let currentSpawn: SpawnPoint = SPAWN_POINTS[0];

function gameApi(): any {
  return (window as any).goneGame;
}

function localSlot(api: any): number {
  if (api?.getP2PHost?.()) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : 0;
}

/** Manual/debug teleport. Normal initial spawn and respawn are owned by engine.ts. */
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
 * Installs only the host-authoritative respawn adapter. Local placement now
 * happens directly inside the engine, so no per-frame corrective teleport is
 * required and there is a single source of truth for normal local spawning.
 */
export function startSpawnController(): void {
  if ((window as any).__goneSpawnControllerStarted) return;
  (window as any).__goneSpawnControllerStarted = true;

  const attach = () => attachAuthoritativeRespawn(gameApi()?.getP2PHost?.());
  attach();
  window.setInterval(attach, 250);

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
}

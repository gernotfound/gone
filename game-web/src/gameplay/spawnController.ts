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

let localSpawnCount = 0;
let currentSpawn: SpawnPoint = SPAWN_POINTS[0];

function gameApi(): any {
  return (window as any).goneGame;
}

function localSlot(api: any): number {
  if (api?.getP2PHost?.()) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : 0;
}

/** Manual/debug teleport. Normal initial spawn and respawn are owned by engine/network authority. */
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

/** Compatibility diagnostics/manual spawn API. Authoritative respawns are configured directly by networkBindings.ts. */
export function startSpawnController(): void {
  if ((window as any).__goneSpawnControllerStarted) return;
  (window as any).__goneSpawnControllerStarted = true;

  (window as any).goneSpawnPolicy = {
    points: SPAWN_POINTS,
    respawnNow: () => {
      const selected = teleportLocalPlayer();
      return selected ? { ...selected } : null;
    },
    snapshot: () => {
      const api = gameApi();
      return {
        slot: localSlot(api),
        current: { ...currentSpawn },
        localSpawnCount,
        authoritativeRespawns: Number(api?.getP2PHost?.()?.getAuthoritativeRespawnCount?.() ?? 0),
      };
    },
  };
}

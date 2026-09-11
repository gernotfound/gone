import { getTerrainHeightAt } from '../world/chunkManager.ts';

export const PLAYER_SPAWN_X = 1200;
export const PLAYER_SPAWN_Z = 1200;

const HOST_WRAP_MARKER = '__goneSpawnRespawnWrapped';

function gameApi(): any {
  return (window as any).goneGame;
}

export function getPlayerSpawnY(player?: { height?: number; floatHeight?: number }): number {
  const height = Number(player?.height ?? 2.0);
  const floatHeight = Number(player?.floatHeight ?? 0.5);
  return getTerrainHeightAt(PLAYER_SPAWN_X, PLAYER_SPAWN_Z) + height + floatHeight;
}

function teleportLocalPlayer(): void {
  const api = gameApi();
  const player = api?.player;
  if (!player?.position) return;

  player.position.set(PLAYER_SPAWN_X, getPlayerSpawnY(player), PLAYER_SPAWN_Z);
  player.velocity?.set?.(0, 0, 0);
}

function attachAuthoritativeRespawn(host: any): void {
  if (!host?.options || host[HOST_WRAP_MARKER]) return;
  host[HOST_WRAP_MARKER] = true;

  const previous = host.options.onPlayerRespawned;
  host.options.onPlayerRespawned = (playerId: string) => {
    const record = host.playerRecords?.get?.(playerId);
    if (record) {
      record.position = {
        x: PLAYER_SPAWN_X,
        y: getPlayerSpawnY(),
        z: PLAYER_SPAWN_Z,
      };
    }
    previous?.(playerId);
  };
}

/**
 * Runtime spawn policy: center of the south-east map quadrant (+1200,+1200).
 * Height always follows the procedural terrain so crater spawn never floats.
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

  window.requestAnimationFrame(frame);
}

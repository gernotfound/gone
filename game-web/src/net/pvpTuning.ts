import type { WorldSnapshotData } from './binaryProtocol.ts';
import { WEAPON_KEYS, type WeaponKey } from '../weapons/weaponConfig.ts';
import { attachWeaponToRobot, createThirdPersonWeapon } from '../models/index.ts';

function syncRemoteWeapons(client: any, snapshot: WorldSnapshotData): void {
  const game = (window as any).goneGame;
  if (!game?.remotePlayers) return;
  for (const playerState of snapshot.players) {
    if (client.playerSlot !== null && playerState.slot === client.playerSlot) continue;
    const id = client.slotToPlayerId?.get(playerState.slot);
    if (!id) continue;
    const remote = game.remotePlayers.get(id);
    if (!remote?.group) continue;
    const desired = (WEAPON_KEYS[playerState.activeWeapon] ?? 'assalto') as WeaponKey;
    if (remote.weaponType !== desired) {
      remote.weaponType = desired;
      attachWeaponToRobot(remote.group, createThirdPersonWeapon(desired));
    }
  }
}

/**
 * Normalizes host performance.now() timestamps into the receiving page's local
 * monotonic clock. Browser performance clocks do not share an epoch, so using
 * hostTimestamp directly for interpolation can cause stutter or permanent
 * extrapolation when Chrome and Brave have different time origins.
 */
export function startPvpTimingTuning(): void {
  if ((window as any).__gonePvpTimingStarted) return;
  (window as any).__gonePvpTimingStarted = true;

  let patchedClient: any = null;
  let offsetEma = 0;
  let hasOffset = false;
  let lastMappedTimestamp = 0;

  window.setInterval(() => {
    const client = (window as any).goneGame?.getP2PClient?.();
    if (!client || client === patchedClient || !client.config?.onWorldSnapshot) return;

    patchedClient = client;
    offsetEma = 0;
    hasOffset = false;
    lastMappedTimestamp = 0;
    const original = client.config.onWorldSnapshot;

    client.config.onWorldSnapshot = (snapshot: WorldSnapshotData) => {
      const arrival = performance.now();
      const rawHostTime = snapshot.hostTimestamp;
      if (Number.isFinite(rawHostTime)) {
        const measuredOffset = arrival - rawHostTime;
        if (!hasOffset || !Number.isFinite(offsetEma)) {
          offsetEma = measuredOffset;
          hasOffset = true;
        } else {
          offsetEma += (measuredOffset - offsetEma) * 0.08;
        }

        let mapped = rawHostTime + offsetEma;
        mapped = Math.min(arrival, Math.max(arrival - 1000, mapped));
        if (lastMappedTimestamp > 0) mapped = Math.max(lastMappedTimestamp + 0.01, mapped);
        lastMappedTimestamp = mapped;
        snapshot.hostTimestamp = mapped;
      }

      original(snapshot);
      syncRemoteWeapons(client, snapshot);
    };
  }, 200);
}

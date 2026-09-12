import { WEAPON_KEYS, WEAPON_RUNTIME } from '../weapons/weaponConfig.ts';
import type { DeathmatchSyncEventDetail } from '../net/deathmatchAuthority.ts';

const WRAP_MARKER = '__goneDeathmatchRoundFireWrapped';
let lastRound = 0;
let locked = false;
let localRoundResets = 0;
let blockedLocalShots = 0;

function api(): any {
  return (window as any).goneGame;
}

function resetAmmoInventory(): void {
  const ammo = (window as any).goneWeapons?.ammo;
  if (!ammo) return;
  for (const key of WEAPON_KEYS) {
    const state = ammo[key];
    const cfg = WEAPON_RUNTIME[key];
    if (!state || !cfg) continue;
    state.magazine = cfg.magazineSize;
    state.reserve = cfg.reserveAmmo;
  }
}

function resetLocalPlayerForRound(): void {
  const game = api();
  game?.handleLocalPlayerRespawn?.();
  (window as any).goneSpawnPolicy?.respawnNow?.();
  resetAmmoInventory();
  if (game?.keys) game.keys.fire = false;
  localRoundResets += 1;
}

function applySync(detail: DeathmatchSyncEventDetail): void {
  const snapshot = detail.snapshot;
  const previousRound = lastRound;
  const nextRound = Number(snapshot.round) || 1;
  const roundAdvanced = previousRound > 0 && (
    nextRound > previousRound || (previousRound === 0xffff && nextRound === 1)
  );

  lastRound = nextRound;
  locked = snapshot.winnerSlot !== null;
  (window as any).__goneDeathmatchRoundLocked = locked;

  if (roundAdvanced) resetLocalPlayerForRound();
  if (locked && api()?.keys) api().keys.fire = false;
}

function wrapLocalFire(): void {
  const game = api();
  if (!game || game[WRAP_MARKER] || typeof game.fireWeapon !== 'function') return;
  game[WRAP_MARKER] = true;
  const original = game.fireWeapon;
  game.fireWeapon = (...args: any[]) => {
    if (locked || (window as any).__goneDeathmatchRoundLocked === true) {
      blockedLocalShots += 1;
      if (game.keys) game.keys.fire = false;
      return;
    }
    return original(...args);
  };
}

/**
 * Keeps the visible round countdown and the actual combat lifecycle aligned.
 * Once a winner is declared local fire is blocked immediately. When the host
 * advances the round, the local player is fully respawned, moved to its slot
 * spawn and receives a fresh weapon inventory.
 */
export function startDeathmatchRoundLifecycle(): void {
  if ((window as any).__goneDeathmatchRoundLifecycleStarted) return;
  (window as any).__goneDeathmatchRoundLifecycleStarted = true;
  wrapLocalFire();

  window.addEventListener('gone-deathmatch-sync', ((event: CustomEvent<DeathmatchSyncEventDetail>) => {
    applySync(event.detail);
  }) as EventListener);

  window.addEventListener('gone-session-changed', () => {
    lastRound = 0;
    locked = false;
    (window as any).__goneDeathmatchRoundLocked = false;
  });

  window.setInterval(wrapLocalFire, 500);

  (window as any).goneRoundLifecycle = {
    snapshot: () => ({
      round: lastRound,
      locked,
      localRoundResets,
      blockedLocalShots,
    }),
  };
}

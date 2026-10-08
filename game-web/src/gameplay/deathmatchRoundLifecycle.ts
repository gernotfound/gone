import { inputState } from '../controls/playerInput.ts';
import { resetAllWeaponAmmoForRound } from './advancedWeaponController.ts';
import type { DeathmatchSyncEventDetail } from '../net/deathmatchAuthority.ts';

let lastRound = 0;
let locked = false;
let localRoundResets = 0;
let blockedLocalShots = 0;
let respawnLocalPlayer: (() => void) | null = null;

/** Engine supplies its local player lifecycle transition once at composition. */
export function configureRoundLocalRespawn(callback: () => void): void {
  respawnLocalPlayer = callback;
}

/**
 * The engine calls this before committing any local shot. This is the actual
 * gate for both its private trigger path and compatibility facade callers.
 */
export function canFireLocalRoundShot(): boolean {
  if (!locked && (window as any).__goneDeathmatchRoundLocked !== true) return true;
  blockedLocalShots += 1;
  inputState.fire = false;
  return false;
}

function resetLocalPlayerForRound(): void {
  // Position reconciliation remains host-authoritative via the next snapshot.
  respawnLocalPlayer?.();
  resetAllWeaponAmmoForRound();
  inputState.fire = false;
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
  if (locked) inputState.fire = false;
}

/**
 * Observes host-authoritative round transitions. It never overwrites the
 * engine's fireWeapon method and needs no recurring patch/retry timer.
 */
export function startDeathmatchRoundLifecycle(): void {
  if ((window as any).__goneDeathmatchRoundLifecycleStarted) return;
  (window as any).__goneDeathmatchRoundLifecycleStarted = true;

  window.addEventListener('gone-deathmatch-sync', ((event: CustomEvent<DeathmatchSyncEventDetail>) => {
    applySync(event.detail);
  }) as EventListener);

  window.addEventListener('gone-session-changed', () => {
    lastRound = 0;
    locked = false;
    inputState.fire = false;
    (window as any).__goneDeathmatchRoundLocked = false;
  });

  (window as any).goneRoundLifecycle = {
    snapshot: () => ({
      round: lastRound,
      locked,
      localRoundResets,
      blockedLocalShots,
    }),
  };
}

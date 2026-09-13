import * as THREE from 'three';
import type { P2PClient } from '../net/p2pClient.ts';
import type { P2PHost, HitConfirmationEvent } from '../net/p2pHost.ts';
import type { FireHitscanMessage } from '../net/protocol.ts';
import {
  STATE_FLAGS,
  type FireHitscanData,
  type HitConfirmedData,
  type PlayerSnapshotEntry,
  type WorldSnapshotData,
} from '../net/binaryProtocol.ts';
import { CLIENT_STATE_EXT_FLAGS } from '../net/clientStateExtensions.ts';
import { setActiveP2PClient, setActiveP2PHost } from '../net/multiplayerSessionController.ts';
import { inputState } from '../controls/playerInput.ts';
import { healthHud } from '../ui/healthHud.ts';
import { shieldVfxController } from '../vfx/shieldVfx.ts';
import { addOrUpdateRemotePlayer, remotePlayers } from './remotePlayerRegistry.ts';
import { presentLegacyRemoteHitscan } from '../net/legacyRemoteShotPresentation.ts';
import { getSafestRespawnPoint } from './spawnSelection.ts';
import { getPlayerSpawnY } from './spawnPolicy.ts';

const LOCAL_AUTHORITY_SNAP_DISTANCE = 8;
const LOCAL_AUTHORITY_SNAP_DISTANCE_SQ = LOCAL_AUTHORITY_SNAP_DISTANCE * LOCAL_AUTHORITY_SNAP_DISTANCE;

type LocalPlayerNetworkState = {
  position: THREE.Vector3;
  velocity?: THREE.Vector3;
  isGrounded: boolean;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  isInvulnerable: boolean;
  shieldExpiresAt: number;
  healthPickupRequestUntil?: number;
};

export type GameplayNetworkContext = {
  player: LocalPlayerNetworkState;
  localShieldAnchor: THREE.Group;
  getActiveWeaponIndex: () => number;
  handleLocalPlayerDeath: () => void;
  handleLocalPlayerRespawn: () => void;
  handleLocalPlayerDamage: (newHp: number) => void;
  localEyeHeight: number;
};

/**
 * Local movement stays predicted during normal play. Large divergence means the
 * host rejected/overrode our state (or selected an authoritative respawn), so
 * the client must converge instead of resending the invalid position forever.
 */
export function applyAuthoritativeLocalPosition(
  player: LocalPlayerNetworkState,
  state: Pick<PlayerSnapshotEntry, 'x' | 'y' | 'z'>,
  force = false,
): boolean {
  if (![state.x, state.y, state.z].every(Number.isFinite)) return false;
  const dx = state.x - player.position.x;
  const dy = state.y - player.position.y;
  const dz = state.z - player.position.z;
  if (!force && dx * dx + dy * dy + dz * dz <= LOCAL_AUTHORITY_SNAP_DISTANCE_SQ) return false;

  player.position.set(state.x, state.y, state.z);
  player.velocity?.set(0, 0, 0);
  return true;
}

export function bindClientGameplayNetworking(client: P2PClient, context: GameplayNetworkContext): void {
  const { player } = context;
  let stateTickStarted = false;
  setActiveP2PClient(client);

  client.setStateProvider(() => ({
    position: {
      x: player.position.x,
      y: player.position.y,
      z: player.position.z,
    },
    yaw: inputState.yaw,
    pitch: inputState.pitch,
    activeWeapon: context.getActiveWeaponIndex(),
    flags:
      (player.isGrounded ? 0x01 : 0) |
      (inputState.ctrl ? 0x02 : 0) |
      (inputState.shift ? 0x04 : 0) |
      (inputState.fire ? 0x08 : 0) |
      ((player.healthPickupRequestUntil ?? 0) >= performance.now()
        ? CLIENT_STATE_EXT_FLAGS.HEALTH_PICKUP_REQUEST
        : 0),
  }));

  const previousSnapshot = client.config.onWorldSnapshot;
  client.config.onWorldSnapshot = (snapshot: WorldSnapshotData) => {
    previousSnapshot?.(snapshot);
    const mySlot = client.playerSlot;

    for (const state of snapshot.players) {
      const isAlive = (state.flags & STATE_FLAGS.ALIVE) !== 0;
      const isShielded = (state.flags & STATE_FLAGS.SHIELD_ACTIVE) !== 0;

      if (mySlot !== null && state.slot === mySlot) {
        const respawnedByHost = isAlive && !player.isAlive;
        if (!isAlive && player.isAlive) {
          context.handleLocalPlayerDeath();
        } else if (respawnedByHost) {
          context.handleLocalPlayerRespawn();
        }

        if (isAlive) {
          applyAuthoritativeLocalPosition(player, state, respawnedByHost);
        }

        player.hp = state.hp;
        healthHud.updateHealth(player.hp, player.maxHp);
        if (isShielded) {
          player.isInvulnerable = true;
          player.shieldExpiresAt = performance.now() + state.timerRemainingMs;
          if (!shieldVfxController.hasShield(context.localShieldAnchor)) {
            shieldVfxController.attachShield(
              context.localShieldAnchor,
              Math.max(0.1, state.timerRemainingMs / 1000),
            );
          }
        } else {
          player.isInvulnerable = false;
          player.shieldExpiresAt = 0;
          if (shieldVfxController.hasShield(context.localShieldAnchor)) {
            shieldVfxController.detachShield(context.localShieldAnchor);
          }
        }

        // Lobby/signaling state is not physical gameplay state. Session startup
        // guards this callback until the game canvas is active, so the first
        // outbound CLIENT_STATE is seeded only after the host snapshot has
        // supplied the authoritative spawn/correction for this slot.
        if (!stateTickStarted) {
          stateTickStarted = true;
          client.startStateTick(30);
          client.sendCurrentState();
        }
        continue;
      }

      const playerId = client.slotToPlayerId.get(state.slot) || `peer_slot_${state.slot}`;
      let remote = remotePlayers.get(playerId);
      if (!remote) {
        const info = client.sessionPlayers.find((sessionPlayer) => sessionPlayer.id === playerId);
        remote = addOrUpdateRemotePlayer(
          playerId,
          state.x,
          state.y,
          state.z,
          state.yaw,
          info?.color || '#00F0FF',
          state.activeWeapon,
          state.slot,
        );
      }

      remote.interpolator.pushSnapshot({
        timestamp: snapshot.hostTimestamp,
        localArrival: performance.now(),
        x: state.x,
        y: state.y,
        z: state.z,
        yaw: state.yaw,
        pitch: state.pitch,
        activeWeapon: state.activeWeapon,
        stateFlags: state.flags,
        health: state.hp,
        timerRemainingMs: state.timerRemainingMs,
      });

      remote.group.visible = isAlive;
      if (isAlive && isShielded) {
        if (!shieldVfxController.hasShield(remote.group)) {
          shieldVfxController.attachShield(remote.group, Math.max(0.1, state.timerRemainingMs / 1000));
        }
      } else if (shieldVfxController.hasShield(remote.group)) {
        shieldVfxController.detachShield(remote.group);
      }
    }
  };

  const previousHit = client.config.onHitConfirmed;
  client.config.onHitConfirmed = (hit: HitConfirmedData) => {
    previousHit?.(hit);
    if (client.playerSlot !== null && hit.victimSlot === client.playerSlot) {
      context.handleLocalPlayerDamage(hit.newHp);
    }
  };

  const previousLegacyShot = client.config.onHitscanFired;
  client.config.onHitscanFired = (shot: FireHitscanMessage) => {
    previousLegacyShot?.(shot);
    presentLegacyRemoteHitscan(shot, context.localEyeHeight);
  };

  const previousBinaryShot = client.config.onBinaryHitscanFired;
  client.config.onBinaryHitscanFired = (shot: FireHitscanData) => {
    previousBinaryShot?.(shot);
    const shooterId = client.slotToPlayerId.get(shot.shooterSlot) || `peer_slot_${shot.shooterSlot}`;
    presentLegacyRemoteHitscan({
      type: 'FIRE_HITSCAN',
      shooterId,
      weaponType: shot.weaponType,
      origin: shot.origin,
      direction: shot.direction,
    }, context.localEyeHeight);
  };
}

export function bindHostGameplayNetworking(host: P2PHost, context: GameplayNetworkContext): void {
  setActiveP2PHost(host);
  host.setRespawnPositionResolver((slot) => {
    const point = getSafestRespawnPoint(slot, Array.from(host.playerRecords.values(), (record) => ({
      slot: record.slot,
      isAlive: record.isAlive,
      position: record.position,
    })));
    return {
      x: point.x,
      y: getPlayerSpawnY(undefined, point),
      z: point.z,
    };
  });
  host.startSnapshotTick(30);

  const previousHit = host.options.onHitConfirmed;
  host.options.onHitConfirmed = (hit: HitConfirmationEvent) => {
    previousHit?.(hit);
    if (hit.victimId === host.hostPlayer.id) context.handleLocalPlayerDamage(hit.newHp);
  };

  const previousRespawn = host.options.onPlayerRespawned;
  host.options.onPlayerRespawned = (playerId: string) => {
    previousRespawn?.(playerId);
    if (playerId === host.hostPlayer.id) context.handleLocalPlayerRespawn();
  };
}

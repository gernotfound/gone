import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import {
  type WeaponModelType,
  WEAPON_TYPES,
  createThirdPersonWeapon,
  createProceduralRobot,
  loadRobotModel,
  applyFluoColor,
  attachWeaponToRobot,
  ROBOT_SCALE,
} from '../models/index.ts';
import { InterpolationBuffer } from '../net/interpolationBuffer.ts';
import { STATE_FLAGS } from '../net/binaryProtocol.ts';
import { shieldVfxController } from '../vfx/shieldVfx.ts';

export interface RemotePlayerInstance {
  id: string;
  slot?: number;
  color: string;
  weaponType: WeaponModelType;
  group: THREE.Group;
  interpolator: InterpolationBuffer;
}

export interface RemotePlayerUpdateOptions {
  /** Keep false for network samples that should be presented by the interpolation buffer. */
  snapExistingTransform?: boolean;
  /** Timestamp in the local presentation clock. Defaults to the legacy delayed timestamp. */
  snapshotTimestamp?: number;
}

export const remotePlayers = new Map<string, RemotePlayerInstance>();

export function addOrUpdateRemotePlayer(
  id: string,
  x: number,
  y: number,
  z: number,
  yawAngle: number,
  fluoColor = '#00F0FF',
  weapon: WeaponModelType | number = 'assalto',
  slot?: number,
  options: RemotePlayerUpdateOptions = {},
): RemotePlayerInstance {
  const resolvedWeapon = typeof weapon === 'number' ? (WEAPON_TYPES[weapon] ?? 'assalto') : weapon;
  const snapshotTimestamp = options.snapshotTimestamp ?? performance.now() - 90;
  let entry = remotePlayers.get(id);

  if (!entry) {
    const robot = createProceduralRobot(fluoColor);
    robot.scale.set(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
    robot.position.set(x, y, z);
    robot.rotation.y = yawAngle;
    attachWeaponToRobot(robot, createThirdPersonWeapon(resolvedWeapon));
    sceneManager.scene.add(robot);

    const interpolator = new InterpolationBuffer({
      renderDelayMs: 90,
      maxExtrapolationMs: 150,
      teleportThresholdMeters: 10.0,
    });
    interpolator.pushSnapshot({
      timestamp: snapshotTimestamp,
      x,
      y,
      z,
      yaw: yawAngle,
      pitch: 0,
    });

    entry = {
      id,
      slot,
      color: fluoColor,
      weaponType: resolvedWeapon,
      group: robot,
      interpolator,
    };
    remotePlayers.set(id, entry);

    const createdEntry = entry;
    loadRobotModel('assets/modello.glb', fluoColor).then((glbRobot) => {
      if (remotePlayers.get(id) !== createdEntry) {
        sceneManager.disposeHierarchy(glbRobot);
        return;
      }

      const oldGroup = createdEntry.group;
      glbRobot.scale.set(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
      glbRobot.position.copy(oldGroup.position);
      glbRobot.rotation.copy(oldGroup.rotation);
      attachWeaponToRobot(glbRobot, createThirdPersonWeapon(createdEntry.weaponType));

      sceneManager.scene.remove(oldGroup);
      sceneManager.disposeHierarchy(oldGroup);
      sceneManager.scene.add(glbRobot);
      createdEntry.group = glbRobot;
    }).catch(() => {});
  } else {
    if (slot !== undefined) entry.slot = slot;
    if (options.snapExistingTransform !== false) {
      entry.group.position.set(x, y, z);
      entry.group.rotation.y = yawAngle;
    }
    entry.interpolator.pushSnapshot({
      timestamp: snapshotTimestamp,
      x,
      y,
      z,
      yaw: yawAngle,
      pitch: 0,
    });

    if (entry.color !== fluoColor) {
      entry.color = fluoColor;
      applyFluoColor(entry.group, fluoColor);
    }

    if (entry.weaponType !== resolvedWeapon) {
      entry.weaponType = resolvedWeapon;
      attachWeaponToRobot(entry.group, createThirdPersonWeapon(resolvedWeapon));
    }
  }

  return entry;
}

export function removeRemotePlayer(id: string): void {
  const entry = remotePlayers.get(id);
  if (!entry) return;
  shieldVfxController.detachShield(entry.group);
  sceneManager.scene.remove(entry.group);
  sceneManager.disposeHierarchy(entry.group);
  remotePlayers.delete(id);
}

/** Apply interpolated snapshot state and remote shield presentation for one frame. */
export function updateRemotePlayerPresentation(renderTime: number): void {
  for (const remote of remotePlayers.values()) {
    const state = remote.interpolator.sample(renderTime);
    if (!state) continue;

    remote.group.position.set(state.x, state.y, state.z);
    remote.group.rotation.y = state.yaw;
    if (state.stateFlags === undefined) continue;

    const isAlive = (state.stateFlags & STATE_FLAGS.ALIVE) !== 0;
    const isShielded = (state.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) !== 0;
    remote.group.visible = isAlive;

    if (isAlive && isShielded) {
      if (!shieldVfxController.hasShield(remote.group)) {
        const durationSec = (state.timerRemainingMs ?? 10000) / 1000;
        shieldVfxController.attachShield(remote.group, Math.max(0.1, durationSec));
      }
    } else if (shieldVfxController.hasShield(remote.group)) {
      shieldVfxController.detachShield(remote.group);
    }
  }
}

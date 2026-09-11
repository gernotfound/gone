import * as THREE from 'three';
import {
  createProceduralRobot as createBaseProceduralRobot,
  loadRobotModel as loadBaseRobotModel,
} from './robotBuilder.ts';

/**
 * The authored robot faces +Z (visor/chest/weapon are on +Z, backpack on -Z),
 * while the Three.js FPS camera/gameplay convention treats -Z as forward at yaw 0.
 * Keep the model anatomy untouched and adapt only the visual root by 180 degrees.
 */
export const ROBOT_GAMEPLAY_YAW_OFFSET = Math.PI;

function orientRobotForGameplay(robot: THREE.Group): THREE.Group {
  const wrapper = new THREE.Group();
  wrapper.name = 'CyberpunkRobot';
  wrapper.userData.gameplayFacing = '-Z';
  wrapper.userData.visualYawOffset = ROBOT_GAMEPLAY_YAW_OFFSET;

  robot.name = 'CyberpunkRobotVisual';
  robot.rotation.y += ROBOT_GAMEPLAY_YAW_OFFSET;
  wrapper.add(robot);
  return wrapper;
}

export function createProceduralRobot(fluoColor: string | number = 0x39ff14): THREE.Group {
  return orientRobotForGameplay(createBaseProceduralRobot(fluoColor));
}

export async function loadRobotModel(
  assetPath: string = 'assets/modello.glb',
  fluoColor: string | number = 0x39ff14
): Promise<THREE.Group> {
  const robot = await loadBaseRobotModel(assetPath, fluoColor);
  return orientRobotForGameplay(robot);
}

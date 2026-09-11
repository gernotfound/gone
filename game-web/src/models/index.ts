/**
 * G.O.N.E. 3D Models and Asset Builders
 *
 * Re-exports procedural builders, GLTF asset loaders, socket attachments,
 * and fluo recoloring utilities for player robots and weapons.
 */

export * from './robotBuilder.ts';
export * from './weaponBuilders.ts';

// Explicit exports override the raw authored-facing builders above for gameplay.
// This keeps the original robot anatomy reusable by asset tests/tools while all
// normal game imports receive a model whose visual front matches camera forward.
export {
  ROBOT_GAMEPLAY_YAW_OFFSET,
  createProceduralRobot,
  loadRobotModel,
} from './orientedRobotBuilder.ts';

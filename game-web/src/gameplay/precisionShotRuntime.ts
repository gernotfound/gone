import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import { isAdvancedWeaponAiming } from './advancedWeaponController.ts';
import { calculateWeaponSpreadAngle, getWeaponRuntime, type WeaponKey } from '../weapons/weaponConfig.ts';

type GoneGameApi = {
  getActiveWeapon?: () => string;
  getAimAccuracy?: () => number;
  getAimSpreadRadians?: () => number;
};

const FORWARD = new THREE.Vector3(0, 0, -1);
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const ALT_UP = new THREE.Vector3(1, 0, 0);
const baseDirection = new THREE.Vector3();
const spreadDirection = new THREE.Vector3();
const right = new THREE.Vector3();
const up = new THREE.Vector3();
const target = new THREE.Vector3();
const originalQuaternion = new THREE.Quaternion();

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function gameApi(): GoneGameApi | null {
  return (window as any).goneGame ?? null;
}

function readReticleAccuracy(weapon: WeaponKey): number {
  // Sniper scope intentionally hides the dynamic crosshair; scoped precision is
  // therefore explicit rather than depending on a hidden DOM dataset.
  if (weapon === 'cecchino' && isAdvancedWeaponAiming()) return 0.998;

  const root = document.getElementById('dynamic-precision-reticle');
  const parsed = Number(root?.dataset.accuracy);
  if (Number.isFinite(parsed)) return clamp01(parsed);

  // First frame / missing DOM fallback. ADS remains tighter than hip-fire.
  return isAdvancedWeaponAiming() ? 0.94 : 0.82;
}

function perturbDirection(direction: THREE.Vector3, spreadRad: number): THREE.Vector3 {
  spreadDirection.copy(direction).normalize();
  if (spreadRad <= 1e-7) return spreadDirection;

  const referenceUp = Math.abs(spreadDirection.y) < 0.99 ? WORLD_UP : ALT_UP;
  right.crossVectors(spreadDirection, referenceUp).normalize();
  up.crossVectors(right, spreadDirection).normalize();

  // Uniform disk sample projected onto the tangent plane of the aim direction.
  const radius = Math.tan(spreadRad) * Math.sqrt(Math.random());
  const phi = Math.random() * Math.PI * 2;
  spreadDirection
    .addScaledVector(right, radius * Math.cos(phi))
    .addScaledVector(up, radius * Math.sin(phi))
    .normalize();
  return spreadDirection;
}

/**
 * Called by the engine for every accepted local shot, whether it originated
 * from keyboard/mouse, touch controls, or the compatibility fireWeapon facade.
 * The raycast, tracer and outgoing hitscan read the same temporarily perturbed
 * camera. The camera is always restored, including if the shot throws.
 */
export function fireWithPrecision(weaponKey: WeaponKey, performShot: () => void): void {
  const camera = sceneManager.camera;
  if (weaponKey === 'coltello' || !camera?.isPerspectiveCamera) {
    performShot();
    return;
  }

  const spreadRad = calculateWeaponSpreadAngle(weaponKey, readReticleAccuracy(weaponKey));
  if (spreadRad <= 1e-7) {
    performShot();
    return;
  }

  camera.updateMatrixWorld(true);
  originalQuaternion.copy(camera.quaternion);
  baseDirection.copy(FORWARD).applyQuaternion(originalQuaternion).normalize();
  perturbDirection(baseDirection, spreadRad);

  target.copy(camera.position).add(spreadDirection);
  camera.lookAt(target);
  camera.updateMatrixWorld(true);
  try {
    performShot();
  } finally {
    camera.quaternion.copy(originalQuaternion);
    camera.updateMatrixWorld(true);
  }
}

/** Compatibility diagnostics only; game firing is composed directly in engine.ts. */
export function startPrecisionShotRuntime(): void {
  const api = gameApi();
  if (!api) return;
  api.getAimAccuracy = () => {
    const key = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto')).key;
    return readReticleAccuracy(key);
  };
  api.getAimSpreadRadians = () => {
    const key = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto')).key;
    return calculateWeaponSpreadAngle(key, readReticleAccuracy(key));
  };
}

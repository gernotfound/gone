import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import { calculateWeaponSpreadAngle, getWeaponRuntime, type WeaponKey } from '../weapons/weaponConfig.ts';

type GoneGameApi = {
  fireWeapon?: () => void;
  getActiveWeapon?: () => string;
};

type GoneWeaponsApi = {
  isAiming?: () => boolean;
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

function weaponsApi(): GoneWeaponsApi | null {
  return (window as any).goneWeapons ?? null;
}

function readReticleAccuracy(weapon: WeaponKey): number {
  // Sniper scope intentionally hides the dynamic crosshair; scoped precision is
  // therefore explicit rather than depending on a hidden DOM dataset.
  if (weapon === 'cecchino' && weaponsApi()?.isAiming?.() === true) return 0.998;

  const root = document.getElementById('dynamic-precision-reticle');
  const parsed = Number(root?.dataset.accuracy);
  if (Number.isFinite(parsed)) return clamp01(parsed);

  // First frame / missing DOM fallback. ADS remains tighter than hip-fire.
  return weaponsApi()?.isAiming?.() === true ? 0.94 : 0.82;
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
 * Couples the FPS precision reticle to the actual hitscan trajectory without
 * rewriting the legacy engine. The camera quaternion is perturbed only during
 * fireWeapon(), so the engine's local raycast, tracer and network direction all
 * use the same spread ray, then the view is restored before the next render.
 */
export function startPrecisionShotRuntime(): void {
  const api = gameApi() as any;
  if (!api || api.__precisionShotRuntimeInstalled || typeof api.fireWeapon !== 'function') return;
  api.__precisionShotRuntimeInstalled = true;

  const originalFireWeapon = api.fireWeapon as () => void;

  api.fireWeapon = () => {
    const weapon = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto'));
    const camera = sceneManager.camera;
    if (weapon.key === 'coltello' || !camera?.isPerspectiveCamera) {
      originalFireWeapon();
      return;
    }

    const accuracy = readReticleAccuracy(weapon.key);
    const spreadRad = calculateWeaponSpreadAngle(weapon.key, accuracy);
    if (spreadRad <= 1e-7) {
      originalFireWeapon();
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
      originalFireWeapon();
    } finally {
      camera.quaternion.copy(originalQuaternion);
      camera.updateMatrixWorld(true);
    }
  };

  api.getAimAccuracy = () => {
    const key = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto')).key;
    return readReticleAccuracy(key);
  };
  api.getAimSpreadRadians = () => {
    const key = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto')).key;
    return calculateWeaponSpreadAngle(key, readReticleAccuracy(key));
  };
}

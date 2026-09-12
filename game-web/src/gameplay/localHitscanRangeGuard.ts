import * as THREE from 'three';
import { getWeaponRuntime } from '../weapons/weaponConfig.ts';

const MARKER = '__goneLocalHitscanRangeGuardInstalled';
const tracerDelta = new THREE.Vector3();
const clampedTracerEnd = new THREE.Vector3();

let guardedShots = 0;
let clampedRaycasts = 0;
let clampedTracers = 0;

/**
 * Brings the remaining legacy local fire path under weaponConfig.ts without
 * rewriting engine.ts. During one local shot only, the engine's legacy 1000 m
 * raycaster is capped to the active weapon's authoritative max range and the
 * no-hit tracer fallback is capped to the same distance. The original methods
 * are restored synchronously before returning.
 */
export function startLocalHitscanRangeGuard(): void {
  const api = (window as any).goneGame as any;
  if (!api || api[MARKER] || typeof api.fireWeapon !== 'function') return;
  api[MARKER] = true;

  const originalFireWeapon = api.fireWeapon as (...args: any[]) => any;

  api.fireWeapon = (...args: any[]) => {
    const cfg = getWeaponRuntime(String(api.getActiveWeapon?.() ?? 'assalto'));
    const rayProto = THREE.Raycaster.prototype as any;
    const originalIntersectObjects = rayProto.intersectObjects;
    const vfx = api.vfxManager as any;
    const originalSpawnTracer = typeof vfx?.spawnTracer === 'function' ? vfx.spawnTracer : null;

    rayProto.intersectObjects = function(objects: any, recursive?: boolean, optionalTarget?: any) {
      const far = Number(this.far);
      if (Number.isFinite(far)) {
        // Legacy ballistic guns still enter fireWeapon() with far=1000 m.
        // The knife legacy path is 2.5 m while the shared contract is 2.6 m.
        if (far >= 999 || (cfg.key === 'coltello' && far <= 2.51)) {
          if (Math.abs(far - cfg.maxRange) > 1e-6) {
            this.far = cfg.maxRange;
            clampedRaycasts += 1;
          }
        }
      }
      return originalIntersectObjects.call(this, objects, recursive, optionalTarget);
    };

    if (originalSpawnTracer) {
      vfx.spawnTracer = function(start: THREE.Vector3, end: THREE.Vector3, weapon: string) {
        tracerDelta.subVectors(end, start);
        const distance = tracerDelta.length();
        if (distance > cfg.maxRange && distance > 1e-6) {
          clampedTracerEnd.copy(start).addScaledVector(tracerDelta, cfg.maxRange / distance);
          clampedTracers += 1;
          return originalSpawnTracer.call(this, start, clampedTracerEnd, weapon);
        }
        return originalSpawnTracer.call(this, start, end, weapon);
      };
    }

    guardedShots += 1;
    try {
      return originalFireWeapon(...args);
    } finally {
      rayProto.intersectObjects = originalIntersectObjects;
      if (originalSpawnTracer) vfx.spawnTracer = originalSpawnTracer;
    }
  };

  api.getLocalHitscanRangeStats = () => ({
    guardedShots,
    clampedRaycasts,
    clampedTracers,
  });
}

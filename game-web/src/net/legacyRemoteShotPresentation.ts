import * as THREE from 'three';
import type { FireHitscanMessage } from './protocol.ts';
import { getChunkMeshes } from '../world/chunkManager.ts';
import { remotePlayers } from '../gameplay/remotePlayerRegistry.ts';
import { getWeaponRuntimeById } from '../weapons/weaponConfig.ts';
import { vfxManager } from '../vfx/index.ts';
import { soundSynth } from '../audio/index.ts';
import type { WeaponModelType } from '../models/index.ts';

/** Compatibility presenter for the old JSON FIRE_HITSCAN callback. */
export function presentLegacyRemoteHitscan(msg: FireHitscanMessage, eyeHeight = 1.8): void {
  const cfg = getWeaponRuntimeById(msg.weaponType);
  const weapon = cfg.key as WeaponModelType;
  const origin = new THREE.Vector3(msg.origin[0], msg.origin[1], msg.origin[2]);
  const direction = new THREE.Vector3(msg.direction[0], msg.direction[1], msg.direction[2]);
  if (direction.lengthSq() < 1e-8) return;
  direction.normalize();

  const shooter = remotePlayers.get(msg.shooterId);
  const start = origin.lengthSq() < 0.001 && shooter
    ? shooter.group.position.clone().add(new THREE.Vector3(0, eyeHeight, 0))
    : origin;

  const raycaster = new THREE.Raycaster(start, direction, 0.01, cfg.maxRange);
  const targets: THREE.Object3D[] = [...getChunkMeshes()];
  for (const [playerId, remote] of remotePlayers.entries()) {
    if (playerId !== msg.shooterId) targets.push(remote.group);
  }

  const intersections = raycaster.intersectObjects(targets, true);
  const hitPoint = new THREE.Vector3();
  let hitNormal: THREE.Vector3 | null = null;
  if (intersections.length > 0) {
    const hit = intersections[0];
    hitPoint.copy(hit.point);
    hitNormal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : direction.clone().negate();
  } else {
    hitPoint.copy(start).addScaledVector(direction, Math.min(cfg.maxRange, 300));
  }

  vfxManager.spawnMuzzleFlash(start, weapon);
  vfxManager.spawnTracer(start, hitPoint, weapon);
  if (hitNormal) vfxManager.spawnImpact(hitPoint, hitNormal, weapon);
  soundSynth.playWeaponSound(weapon, 1);
}

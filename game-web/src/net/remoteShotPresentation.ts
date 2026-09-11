import * as THREE from 'three';
import { getChunkMeshes } from '../world/chunkManager.ts';
import { vfxManager } from '../vfx/vfxManager.ts';
import { soundSynth } from '../audio/index.ts';
import {
  WEAPON_MUZZLE_POSITIONS,
  WEAPON_SOCKET_NAME,
  type WeaponModelType,
} from '../models/index.ts';
import { getWeaponRuntimeById } from '../weapons/weaponConfig.ts';
import type { FireHitscanData } from './binaryProtocol.ts';

const HOST_MARKER = '__goneRemoteShotHostWrapped';
const CLIENT_MARKER = '__goneRemoteShotClientWrapped';
const fallbackMuzzle = new THREE.Vector3();
const localMuzzle = new THREE.Vector3();
const direction = new THREE.Vector3();
const hitPoint = new THREE.Vector3();
const raycaster = new THREE.Raycaster();

function gameplayVisible(): boolean {
  const gameUi = document.getElementById('game-ui');
  return !!gameUi && !gameUi.classList.contains('hidden');
}

function exactRemoteMuzzle(shooterId: string, weapon: WeaponModelType, fallback?: readonly number[]): THREE.Vector3 {
  const api = (window as any).goneGame;
  const remote = api?.remotePlayers?.get?.(shooterId);
  const group = remote?.group as THREE.Group | undefined;

  if (group) {
    group.updateMatrixWorld(true);
    const socket = group.getObjectByName(WEAPON_SOCKET_NAME);
    const weaponRoot = socket?.children?.[0];
    const weaponMesh = weaponRoot?.children?.[0] ?? weaponRoot;
    const authoredMuzzle = WEAPON_MUZZLE_POSITIONS[weapon];
    if (weaponMesh && authoredMuzzle) {
      weaponMesh.updateMatrixWorld(true);
      return localMuzzle.copy(authoredMuzzle).applyMatrix4(weaponMesh.matrixWorld);
    }

    // Safe visual fallback: robot center + a short forward/up offset.
    fallbackMuzzle.set(0, 0.45, -0.9).applyMatrix4(group.matrixWorld);
    return fallbackMuzzle;
  }

  if (fallback && fallback.length >= 3) {
    fallbackMuzzle.set(Number(fallback[0]), Number(fallback[1]), Number(fallback[2]));
    return fallbackMuzzle;
  }

  fallbackMuzzle.set(0, 0, 0);
  return fallbackMuzzle;
}

function presentRemoteShot(shooterId: string, shot: FireHitscanData): void {
  if (!gameplayVisible() || !vfxManager.isReady()) return;

  const cfg = getWeaponRuntimeById(shot.weaponType);
  const weapon = cfg.key as WeaponModelType;
  const start = exactRemoteMuzzle(shooterId, weapon, shot.origin);
  direction.set(shot.dirX, shot.dirY, shot.dirZ);
  if (direction.lengthSq() < 1e-8) return;
  direction.normalize();

  raycaster.set(start, direction);
  raycaster.near = 0.01;
  raycaster.far = cfg.maxRange;

  const api = (window as any).goneGame;
  const targets: THREE.Object3D[] = [...getChunkMeshes()];
  for (const [playerId, remote] of api?.remotePlayers?.entries?.() ?? []) {
    if (playerId !== shooterId && remote?.group) targets.push(remote.group);
  }

  const intersections = raycaster.intersectObjects(targets, true);
  let hitNormal: THREE.Vector3 | null = null;
  if (intersections.length > 0) {
    hitPoint.copy(intersections[0].point);
    if (intersections[0].face) {
      hitNormal = intersections[0].face!.normal.clone().transformDirection(intersections[0].object.matrixWorld);
    }
  } else {
    hitPoint.copy(start).addScaledVector(direction, cfg.maxRange);
  }

  // Flash is copied once at the physical muzzle and never follows the projectile.
  vfxManager.spawnMuzzleFlash(start, weapon);
  vfxManager.spawnTracer(start, hitPoint, weapon);
  if (hitNormal) vfxManager.spawnImpact(hitPoint, hitNormal, weapon);
  soundSynth.playWeaponSound(weapon, 0.45);
}

function attachHost(host: any): void {
  if (!host || host[HOST_MARKER]) return;
  const original = host.processFireHitscan;
  if (typeof original !== 'function') return;

  host[HOST_MARKER] = true;
  host.processFireHitscan = function(shooterId: string, shot: FireHitscanData) {
    if (shooterId !== this.hostPlayer?.id) presentRemoteShot(shooterId, shot);
    return original.call(this, shooterId, shot);
  };
}

function attachClient(client: any): void {
  if (!client?.config || client[CLIENT_MARKER]) return;
  client[CLIENT_MARKER] = true;

  // FIRE_HITSCAN is presentation-only on guests. Replace the legacy callback
  // rather than chaining it, otherwise one packet would draw two tracers.
  client.config.onBinaryHitscanFired = (shot: FireHitscanData) => {
    const shooterId = client.slotToPlayerId?.get?.(shot.shooterSlot) ?? `peer_slot_${shot.shooterSlot}`;
    if (shooterId === client.playerId) return;
    presentRemoteShot(shooterId, shot);
  };
}

/** Guarantees enemy muzzle flash + tracer presentation on host and guests. */
export function startRemoteShotPresentation(): void {
  if ((window as any).__goneRemoteShotPresentationStarted) return;
  (window as any).__goneRemoteShotPresentationStarted = true;

  const attach = () => {
    const api = (window as any).goneGame;
    attachHost(api?.getP2PHost?.());
    attachClient(api?.getP2PClient?.());
  };

  attach();
  window.setInterval(attach, 200);
}

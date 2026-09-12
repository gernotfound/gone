import * as THREE from 'three';
import {
  WEAPON_MUZZLE_POSITIONS,
  type WeaponModelType,
} from '../models/index.ts';
import {
  vfxManager,
  type LocalMuzzleAnchor,
} from '../vfx/vfxManager.ts';

type LocalGameViewmodelApi = {
  getActiveWeapon?: () => string;
  recoilContainer?: THREE.Group;
};

const resolvedMuzzle: LocalMuzzleAnchor = {
  anchor: null as unknown as THREE.Object3D,
  localPosition: new THREE.Vector3(),
};

function resolveLocalMuzzle(weaponType: string): LocalMuzzleAnchor | null {
  const game = (window as any).goneGame as LocalGameViewmodelApi | undefined;
  if (!game?.recoilContainer || game.getActiveWeapon?.() !== weaponType) return null;

  const activeViewmodel = game.recoilContainer.children[0];
  const anchor = activeViewmodel?.children.length
    ? activeViewmodel.children[0]
    : activeViewmodel;
  if (!anchor) return null;

  const localPosition = WEAPON_MUZZLE_POSITIONS[weaponType as WeaponModelType];
  if (!localPosition) return null;

  resolvedMuzzle.anchor = anchor;
  resolvedMuzzle.localPosition = localPosition;
  return resolvedMuzzle;
}

/**
 * Explicit composition binding between the local first-person viewmodel and VFX.
 * No prototype/runtime replacement: VFX owns the follow behavior, this module
 * only provides the current authored muzzle socket.
 */
export function startLocalMuzzleFlashBinding(): void {
  if ((window as any).__goneLocalMuzzleFlashBindingStarted) return;
  (window as any).__goneLocalMuzzleFlashBindingStarted = true;
  vfxManager.setLocalMuzzleAnchorResolver(resolveLocalMuzzle);
}

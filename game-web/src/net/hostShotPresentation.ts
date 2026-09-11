import * as THREE from 'three';
import type { FireHitscanData } from './binaryProtocol.ts';

const REMOTE_MUZZLE_LOCAL = new THREE.Vector3(0.77, 0.36, -1.15);
const WRAP_MARKER = '__goneHostShotPresentationWrapped';

/**
 * The authoritative host is not a peer of its own DataChannel fan-out, so
 * FIRE_HITSCAN packets from guests are broadcast to other guests but do not
 * naturally come back through the host browser's client handlers. This tiny
 * adapter mirrors guest shots into the host renderer only; damage validation
 * still happens once, inside P2PHost.
 */
export function startHostShotPresentation(): () => void {
  const attach = () => {
    const api = (window as any).goneGame;
    const host = api?.getP2PHost?.();
    if (!host || host[WRAP_MARKER]) return;

    const original = host.processFireHitscan;
    if (typeof original !== 'function') return;

    host[WRAP_MARKER] = true;
    host.processFireHitscan = function(shooterId: string, shot: FireHitscanData) {
      if (shooterId !== this.hostPlayer?.id && api?.handleRemoteHitscan) {
        let origin: [number, number, number] = [shot.originX, shot.originY, shot.originZ];
        const remote = api.remotePlayers?.get?.(shooterId);

        if (remote?.group) {
          remote.group.updateMatrixWorld?.(true);
          const muzzle = REMOTE_MUZZLE_LOCAL.clone().applyMatrix4(remote.group.matrixWorld);
          origin = [muzzle.x, muzzle.y, muzzle.z];
        }

        api.handleRemoteHitscan({
          type: 'FIRE_HITSCAN',
          shooterId,
          weaponType: shot.weaponType,
          origin,
          direction: [shot.dirX, shot.dirY, shot.dirZ],
        });
      }

      return original.call(this, shooterId, shot);
    };
  };

  attach();
  const timer = window.setInterval(attach, 250);
  return () => window.clearInterval(timer);
}

import * as THREE from 'three';
import { addWeaponPart } from './proceduralShared.ts';

/**
 * Procedural Cyberpunk Submachine Gun (SMG) builder.
 */
export function createSmgModel(): THREE.Group {
  const rifleGroup = new THREE.Group();
  rifleGroup.name = 'SMG';

  const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8, metalness: 0.6 });
  const matGunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2b36, roughness: 0.5, metalness: 0.8 });
  const matSilver = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.3, metalness: 0.9 });
  const matBlackDetail = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.4 });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.1 });
  const matBrass = new THREE.MeshStandardMaterial({ color: 0xaa8844, roughness: 0.4, metalness: 0.8 });

  const matNeonCyan = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 2, roughness: 0.2 });
  const matNeonPink = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1.5, roughness: 0.2 });
  const matEnergyOrange = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff4400, emissiveIntensity: 3, roughness: 0.1 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0, ry = 0, rx = 0) =>
    addWeaponPart(rifleGroup, geo, mat, x, y, z, rz, ry, rx);

  // Upper & Lower Receiver
  add(new THREE.BoxGeometry(2.2, 0.4, 0.35), matGunmetal, 0, 0.2, 0);
  add(new THREE.BoxGeometry(2.0, 0.45, 0.45), matDarkMetal, -0.1, 0.2, 0);
  add(new THREE.BoxGeometry(1.6, 0.35, 0.38), matGunmetal, 0.1, -0.15, 0);

  // Mag well
  add(new THREE.BoxGeometry(0.6, 0.3, 0.42), matDarkMetal, 0.3, -0.3, 0, -Math.PI / 32);

  // Sportello espulsione bossoli e otturatore
  add(new THREE.BoxGeometry(0.35, 0.12, 0.46), matBlackDetail, 0.3, 0.25, 0);
  add(new THREE.BoxGeometry(0.25, 0.08, 0.47), matBrass, 0.3, 0.25, 0);

  // Manetta d'armamento
  add(new THREE.BoxGeometry(0.3, 0.04, 0.15), matSilver, 0.3, 0.25, -0.25);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.15, 12), matRubber, 0.3, 0.25, -0.32, Math.PI / 2, 0, 0);

  // Selettore di fuoco
  add(new THREE.CylinderGeometry(0.04, 0.04, 0.48, 12), matSilver, -0.2, 0.05, 0, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.08, 0.15, 0.02), matRubber, -0.2, 0.05, 0.25, 0, 0, Math.PI / 4);
  add(new THREE.BoxGeometry(0.1, 0.1, 0.46), matSilver, 0.5, -0.15, 0);

  // Canna, paramano & silenziatore
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.9, 16), matEnergyOrange, 1.0, 0.2, 0, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(1.2, 0.45, 0.45), matGunmetal, 1.0, 0.2, 0);

  // Fessure di ventilazione
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.06, 0.46, 0.46), matBlackDetail, 0.6 + (i * 0.2), 0.2, 0);
  }

  // Silenziatore tattico esagonale
  add(new THREE.CylinderGeometry(0.22, 0.22, 1.2, 6), matDarkMetal, 2.1, 0.2, 0, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.2, 0.2, 1.25, 6), matGunmetal, 2.1, 0.2, 0, Math.PI / 2, 0, 0);
  for (let i = 0; i < 3; i++) {
    add(new THREE.CylinderGeometry(0.24, 0.24, 0.05, 6), matBlackDetail, 1.8 + (i * 0.3), 0.2, 0, Math.PI / 2, 0, 0);
  }
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16), matBlackDetail, 2.7, 0.2, 0, Math.PI / 2, 0, 0);

  // Modulo Laser/Torcia
  add(new THREE.BoxGeometry(0.4, 0.15, 0.15), matDarkMetal, 1.0, 0.1, 0.25);
  add(new THREE.BoxGeometry(0.3, 0.1, 0.18), matGunmetal, 1.0, 0.1, 0.25);
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.1, 12), matNeonPink, 1.2, 0.1, 0.28, Math.PI / 2, 0, 0);

  // Binari e impugnature
  add(new THREE.BoxGeometry(2.6, 0.05, 0.22), matSilver, 0.2, 0.45, 0);
  for (let i = 0; i < 18; i++) {
    add(new THREE.BoxGeometry(0.05, 0.06, 0.24), matDarkMetal, -1.0 + (i * 0.14), 0.45, 0);
  }

  // AFG
  add(new THREE.BoxGeometry(0.6, 0.08, 0.2), matGunmetal, 1.0, -0.05, 0);
  add(new THREE.BoxGeometry(0.2, 0.25, 0.18), matRubber, 0.8, -0.15, 0, Math.PI / 6, 0, 0);
  add(new THREE.BoxGeometry(0.4, 0.15, 0.18), matBlackDetail, 1.1, -0.1, 0, -Math.PI / 12, 0, 0);

  // Grip principale
  add(new THREE.BoxGeometry(0.32, 0.65, 0.28), matRubber, -0.6, -0.4, 0, Math.PI / 12, 0, 0);
  add(new THREE.BoxGeometry(0.12, 0.55, 0.32), matBlackDetail, -0.5, -0.4, 0, Math.PI / 12, 0, 0);
  add(new THREE.BoxGeometry(0.35, 0.1, 0.32), matGunmetal, -0.6, -0.7, 0, Math.PI / 12, 0, 0);

  // Guardia e grilletto
  add(new THREE.BoxGeometry(0.6, 0.05, 0.12), matDarkMetal, -0.2, -0.25, 0);
  add(new THREE.BoxGeometry(0.05, 0.25, 0.12), matDarkMetal, 0.1, -0.15, 0, -Math.PI / 6, 0, 0);
  add(new THREE.BoxGeometry(0.04, 0.12, 0.06), matSilver, -0.3, -0.15, 0, -Math.PI / 12, 0, 0);

  // Caricatore esteso SMG
  add(new THREE.BoxGeometry(0.38, 1.4, 0.3), matGunmetal, 0.35, -0.8, 0, -Math.PI / 32, 0, 0);
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.4, 0.06, 0.32), matRubber, 0.35, -0.5 - (i * 0.2), 0, -Math.PI / 32, 0, 0);
  }
  add(new THREE.BoxGeometry(0.45, 0.15, 0.35), matDarkMetal, 0.28, -1.45, 0, -Math.PI / 32, 0, 0);
  add(new THREE.BoxGeometry(0.1, 0.9, 0.32), matNeonCyan, 0.35, -0.8, 0, -Math.PI / 32, 0, 0);

  // Calcio retrattile PDW
  add(new THREE.BoxGeometry(0.4, 0.5, 0.48), matGunmetal, -1.2, 0.2, 0);
  add(new THREE.BoxGeometry(0.2, 0.3, 0.52), matBlackDetail, -1.2, 0.2, 0);
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 12), matSilver, -1.7, 0.2, 0.18, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 12), matSilver, -1.7, 0.2, -0.18, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.2, 0.7, 0.45), matDarkMetal, -2.3, 0.2, 0);
  add(new THREE.BoxGeometry(0.1, 0.65, 0.4), matRubber, -2.35, 0.2, 0);
  add(new THREE.BoxGeometry(0.3, 0.2, 0.35), matGunmetal, -2.3, 0.2, 0);

  // Cavi di alimentazione e viti
  add(new THREE.CylinderGeometry(0.02, 0.02, 1.6, 8), matNeonPink, 0.2, 0.12, 0.23, Math.PI / 2, 0, 0);
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 8), matBlackDetail, 0.2, 0.08, 0.23, Math.PI / 2, 0, 0);

  const pinGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 8);
  const pins: [number, number][] = [[-0.9, 0.3], [-0.5, 0.2], [-0.1, 0.3], [0.1, -0.2], [0.6, 0.3], [1.1, 0.35]];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return rifleGroup;
}

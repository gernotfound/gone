import * as THREE from 'three';
import { addWeaponPart } from './proceduralShared.ts';

/**
 * Procedural Cyberpunk Heavy Sniper Rifle builder.
 */
export function createSniperRifleModel(): THREE.Group {
  const rifleGroup = new THREE.Group();
  rifleGroup.name = 'SniperRifle';

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
  add(new THREE.BoxGeometry(3.0, 0.5, 0.4), matGunmetal, 0, 0.1, 0);
  add(new THREE.BoxGeometry(2.2, 0.3, 0.45), matDarkMetal, 0, 0.1, 0);
  add(new THREE.BoxGeometry(1.5, 0.3, 0.38), matGunmetal, 0.2, -0.2, 0);

  // Sportello espulsione e otturatore
  add(new THREE.BoxGeometry(0.4, 0.12, 0.46), matBlackDetail, 0.3, 0.1, 0);
  add(new THREE.BoxGeometry(0.35, 0.1, 0.47), matBrass, 0.3, 0.1, 0);
  add(new THREE.BoxGeometry(1.0, 0.05, 0.46), matDarkMetal, -0.4, 0.2, 0);

  // Viti e perni
  const pinGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.48, 8);
  const pins: [number, number][] = [[-1.0, 0.1], [-0.5, 0.2], [0.5, 0.2], [0.9, 0.1], [0.4, -0.1]];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  // Canna, acceleratore & freno di bocca
  add(new THREE.CylinderGeometry(0.1, 0.1, 1.0, 16), matDarkMetal, 1.8, 0.1, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.06, 0.06, 4.8, 16), matSilver, 3.5, 0.1, 0, Math.PI / 2);

  // Freno di bocca
  add(new THREE.CylinderGeometry(0.15, 0.12, 0.8, 16), matDarkMetal, 6.0, 0.1, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.6, 0.12, 0.35), matGunmetal, 6.0, 0.1, 0);
  for (let i = 0; i < 3; i++) {
    add(new THREE.BoxGeometry(0.12, 0.3, 0.1), matBlackDetail, 5.8 + (i * 0.2), 0.1, 0.15);
    add(new THREE.BoxGeometry(0.12, 0.3, 0.1), matBlackDetail, 5.8 + (i * 0.2), 0.1, -0.15);
  }

  // Copricanna (Shroud)
  add(new THREE.BoxGeometry(2.5, 0.35, 0.35), matGunmetal, 2.5, 0.15, 0);
  for (let i = 0; i < 8; i++) {
    add(new THREE.BoxGeometry(0.12, 0.25, 0.38), matBlackDetail, 1.5 + (i * 0.28), 0.18, 0, Math.PI / 8);
  }

  // Nucleo plasma e bobine di accelerazione
  add(new THREE.CylinderGeometry(0.12, 0.12, 2.0, 16), matNeonCyan, 2.5, -0.15, 0, Math.PI / 2);
  for (let i = 0; i < 9; i++) {
    add(new THREE.TorusGeometry(0.16, 0.02, 8, 16), matSilver, 1.4 + (i * 0.25), -0.15, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.36), matEnergyOrange, 1.4 + (i * 0.25), -0.15, 0);
  }

  // Rail superiore piatto
  add(new THREE.BoxGeometry(4.8, 0.05, 0.2), matSilver, 1.0, 0.4, 0);

  // Bipiede
  add(new THREE.BoxGeometry(0.3, 0.1, 0.2), matDarkMetal, 3.5, -0.2, 0);
  // Gambe angolate (with explicit rotation.x overwrite)
  add(new THREE.CylinderGeometry(0.03, 0.01, 1.0, 8), matSilver, 3.5, -0.6, 0.4, 0, 0, -Math.PI / 6).rotation.x = -Math.PI / 6;
  add(new THREE.CylinderGeometry(0.03, 0.01, 1.0, 8), matSilver, 3.5, -0.6, -0.4, 0, 0, -Math.PI / 6).rotation.x = Math.PI / 6;
  // Piedini
  add(new THREE.BoxGeometry(0.1, 0.05, 0.15), matRubber, 3.75, -1.0, 0.6, 0, 0, 0);
  add(new THREE.BoxGeometry(0.1, 0.05, 0.15), matRubber, 3.75, -1.0, -0.6, 0, 0, 0);

  // Grip, grilletto & caricatore
  add(new THREE.BoxGeometry(0.28, 0.7, 0.25), matRubber, -0.6, -0.5, 0, Math.PI / 10);
  add(new THREE.BoxGeometry(0.1, 0.6, 0.28), matBlackDetail, -0.5, -0.5, 0, Math.PI / 10);
  add(new THREE.BoxGeometry(0.5, 0.04, 0.1), matGunmetal, -0.2, -0.4, 0);
  add(new THREE.BoxGeometry(0.04, 0.3, 0.1), matGunmetal, 0.05, -0.3, 0, -Math.PI / 8);
  add(new THREE.BoxGeometry(0.05, 0.15, 0.05), matSilver, -0.3, -0.25, 0, -Math.PI / 12);

  // Caricatore corto (Sniper style)
  add(new THREE.BoxGeometry(0.65, 0.2, 0.4), matGunmetal, 0.4, -0.4, 0, -Math.PI / 16);
  add(new THREE.BoxGeometry(0.45, 0.3, 0.3), matDarkMetal, 0.42, -0.6, 0, -Math.PI / 16);
  add(new THREE.BoxGeometry(0.15, 0.15, 0.32), matEnergyOrange, 0.42, -0.6, 0, -Math.PI / 16);
  add(new THREE.BoxGeometry(0.5, 0.1, 0.35), matRubber, 0.45, -0.75, 0, -Math.PI / 16);

  // Calcio allungato (Stock)
  add(new THREE.BoxGeometry(0.8, 0.4, 0.32), matDarkMetal, -1.8, 0.05, 0);
  add(new THREE.CylinderGeometry(0.06, 0.06, 2.0, 16), matSilver, -2.5, 0.15, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 16), matSilver, -2.5, -0.15, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.6, 0.6, 0.3), matGunmetal, -3.6, 0.0, 0);

  // Poggiaguancia rialzato
  add(new THREE.BoxGeometry(0.9, 0.15, 0.25), matRubber, -2.8, 0.38, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), matSilver, -2.5, 0.25, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.25, 8), matSilver, -3.1, 0.25, 0);

  // Monopiede inferiore
  add(new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8), matSilver, -3.6, -0.4, 0);
  add(new THREE.BoxGeometry(0.15, 0.05, 0.15), matRubber, -3.6, -0.65, 0);

  // Pad spalla ammortizzante
  add(new THREE.BoxGeometry(0.2, 0.9, 0.35), matRubber, -3.95, 0.0, 0);

  // Cavi alimentazione
  add(new THREE.CylinderGeometry(0.03, 0.03, 2.4, 12), matDarkMetal, 0.7, 0.05, 0.24, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.015, 0.015, 2.42, 12), matNeonPink, 0.7, 0.05, 0.24, Math.PI / 2);

  return rifleGroup;
}

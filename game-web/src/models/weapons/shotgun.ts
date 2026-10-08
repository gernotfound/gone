import * as THREE from 'three';
import { addWeaponPart } from './proceduralShared.ts';

/**
 * Procedural Cyberpunk Combat Shotgun builder.
 */
export function createShotgunModel(): THREE.Group {
  const rifleGroup = new THREE.Group();
  rifleGroup.name = 'Shotgun';

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

  // Corpo centrale (Receiver pesante)
  add(new THREE.BoxGeometry(2.4, 0.6, 0.42), matGunmetal, 0, 0.2, 0);
  add(new THREE.BoxGeometry(2.2, 0.65, 0.48), matDarkMetal, -0.1, 0.2, 0);

  // Sportello espulsione bossoli
  add(new THREE.BoxGeometry(0.5, 0.2, 0.5), matBlackDetail, 0.4, 0.2, 0);
  // Cartuccia in camera
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.2, 12), matBrass, 0.35, 0.2, 0.18, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.06, 0.06, 0.05, 12), matNeonPink, 0.2, 0.2, 0.18, 0, 0, Math.PI / 2);

  // Portacartucce laterale (Side Saddle)
  add(new THREE.BoxGeometry(0.8, 0.25, 0.05), matDarkMetal, -0.2, 0.2, -0.25);
  for (let i = 0; i < 4; i++) {
    add(new THREE.CylinderGeometry(0.07, 0.07, 0.15, 12), matNeonCyan, -0.5 + (i * 0.2), 0.2, -0.25, Math.PI / 2, 0, 0);
    add(new THREE.CylinderGeometry(0.075, 0.075, 0.04, 12), matBrass, -0.5 + (i * 0.2), 0.27, -0.25, Math.PI / 2, 0, 0);
  }

  // Canna, serbatoio tubolare & astina
  add(new THREE.BoxGeometry(2.2, 0.25, 0.35), matDarkMetal, 1.8, 0.4, 0);
  add(new THREE.CylinderGeometry(0.1, 0.1, 2.22, 16), matBlackDetail, 1.8, 0.4, 0, 0, 0, Math.PI / 2);

  // Scudo termico
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.15, 0.28, 0.38), matBlackDetail, 0.9 + (i * 0.3), 0.4, 0);
  }

  // Serbatoio tubolare
  add(new THREE.CylinderGeometry(0.12, 0.12, 2.1, 16), matGunmetal, 1.7, 0.12, 0, 0, 0, Math.PI / 2);
  // Blocco di aggancio frontale
  add(new THREE.BoxGeometry(0.2, 0.5, 0.3), matDarkMetal, 2.6, 0.25, 0);

  // Astina scorrevole
  add(new THREE.BoxGeometry(1.2, 0.35, 0.45), matGunmetal, 1.2, 0.05, 0);
  add(new THREE.BoxGeometry(0.8, 0.1, 0.5), matEnergyOrange, 1.2, 0.05, 0);
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.12, 0.4, 0.48), matRubber, 0.75 + (i * 0.18), 0.05, 0);
  }
  add(new THREE.BoxGeometry(0.1, 0.25, 0.45), matBlackDetail, 1.8, -0.05, 0, 0, 0, -Math.PI / 6);

  // Impugnatura e grilletto
  add(new THREE.BoxGeometry(0.35, 0.6, 0.32), matRubber, -0.6, -0.3, 0, Math.PI / 8, 0, 0);
  add(new THREE.BoxGeometry(0.15, 0.5, 0.36), matBlackDetail, -0.5, -0.3, 0, Math.PI / 8, 0, 0);
  add(new THREE.BoxGeometry(0.4, 0.1, 0.34), matGunmetal, -0.6, -0.6, 0, Math.PI / 8, 0, 0);

  add(new THREE.BoxGeometry(0.7, 0.06, 0.14), matDarkMetal, -0.15, -0.15, 0);
  add(new THREE.BoxGeometry(0.06, 0.25, 0.14), matDarkMetal, 0.2, -0.05, 0, -Math.PI / 6, 0, 0);
  add(new THREE.BoxGeometry(0.05, 0.12, 0.08), matSilver, -0.25, -0.05, 0, -Math.PI / 12, 0, 0);

  // Calcio tattico pesante
  add(new THREE.BoxGeometry(0.6, 0.4, 0.4), matGunmetal, -1.3, 0.1, 0);
  add(new THREE.CylinderGeometry(0.12, 0.12, 1.2, 16), matDarkMetal, -1.8, 0.1, 0, 0, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(1.2, 0.35, 0.35), matGunmetal, -2.1, 0.1, 0);

  // Poggiaguancia
  add(new THREE.BoxGeometry(0.8, 0.15, 0.38), matBlackDetail, -2.1, 0.35, 0);
  add(new THREE.BoxGeometry(0.6, 0.05, 0.39), matRubber, -2.1, 0.42, 0);

  // Pad per la spalla
  add(new THREE.BoxGeometry(0.2, 0.8, 0.4), matDarkMetal, -2.7, 0.1, 0);
  add(new THREE.BoxGeometry(0.15, 0.75, 0.38), matRubber, -2.85, 0.1, 0);
  add(new THREE.BoxGeometry(0.15, 0.6, 0.38), matBlackDetail, -3.0, 0.1, 0);

  // Cavi esposti
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.0, 8), matNeonPink, -2.1, 0.1, 0.2, 0, 0, Math.PI / 2);

  // Top Rail & viti
  add(new THREE.BoxGeometry(3.6, 0.05, 0.22), matSilver, 0.5, 0.55, 0);
  for (let i = 0; i < 25; i++) {
    add(new THREE.BoxGeometry(0.05, 0.06, 0.24), matDarkMetal, -1.2 + (i * 0.14), 0.55, 0);
  }

  const pinGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.5, 8);
  const pins: [number, number][] = [[-0.9, 0.3], [-0.5, 0.1], [0.1, 0.3], [0.5, -0.1], [2.6, 0.25]];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return rifleGroup;
}

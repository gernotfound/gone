import * as THREE from 'three';
import { addWeaponPart } from './proceduralShared.ts';

/**
 * Procedural Cyberpunk Tanto Combat Knife builder.
 */
export function createKnifeModel(): THREE.Group {
  const weaponGroup = new THREE.Group();
  weaponGroup.name = 'CombatKnife';

  const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8, metalness: 0.6 });
  const matGunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2b36, roughness: 0.5, metalness: 0.8 });
  const matSilver = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.2, metalness: 0.9 });
  const matBlackDetail = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.4 });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.1 });

  const matNeonCyan = new THREE.MeshStandardMaterial({ color: 0x00ffff, emissive: 0x00ffff, emissiveIntensity: 2, roughness: 0.2 });
  const matNeonPink = new THREE.MeshStandardMaterial({ color: 0xff00ff, emissive: 0xff00ff, emissiveIntensity: 1.5, roughness: 0.2 });
  const matEnergyOrange = new THREE.MeshStandardMaterial({ color: 0xffaa00, emissive: 0xff4400, emissiveIntensity: 3, roughness: 0.1 });

  const add = (geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number, rz = 0, ry = 0, rx = 0) =>
    addWeaponPart(weaponGroup, geo, mat, x, y, z, rz, ry, rx);

  // Impugnatura e guardia (Handle & D-Guard)
  add(new THREE.BoxGeometry(1.4, 0.25, 0.15), matGunmetal, -0.9, 0, 0);
  for (let i = 0; i < 6; i++) {
    add(new THREE.BoxGeometry(0.18, 0.32, 0.2), matRubber, -0.4 - (i * 0.2), 0, 0);
    add(new THREE.BoxGeometry(0.15, 0.35, 0.22), matBlackDetail, -0.4 - (i * 0.2), 0, 0);
  }

  add(new THREE.BoxGeometry(0.2, 0.8, 0.3), matDarkMetal, -0.2, -0.05, 0);
  add(new THREE.BoxGeometry(0.3, 0.5, 0.35), matGunmetal, -0.2, 0, 0);
  add(new THREE.BoxGeometry(0.15, 0.4, 0.2), matDarkMetal, -0.2, -0.4, 0);
  add(new THREE.BoxGeometry(1.4, 0.15, 0.2), matDarkMetal, -0.85, -0.55, 0);
  add(new THREE.BoxGeometry(0.15, 0.4, 0.2), matDarkMetal, -1.5, -0.4, 0);

  // Pomolo
  add(new THREE.BoxGeometry(0.4, 0.45, 0.25), matGunmetal, -1.6, 0, 0);
  add(new THREE.CylinderGeometry(0, 0.1, 0.3, 4), matSilver, -1.9, 0, 0, 0, 0, Math.PI / 2);
  add(new THREE.TorusGeometry(0.08, 0.03, 8, 12), matSilver, -1.65, -0.25, 0);

  // Lama e ricasso
  add(new THREE.BoxGeometry(0.6, 0.45, 0.12), matDarkMetal, 0.2, 0, 0);
  add(new THREE.BoxGeometry(0.5, 0.5, 0.15), matBlackDetail, 0.2, 0, 0);

  add(new THREE.BoxGeometry(2.0, 0.15, 0.08), matGunmetal, 1.4, 0.1, 0);
  add(new THREE.BoxGeometry(2.0, 0.2, 0.04), matSilver, 1.4, -0.05, 0);

  // Sezione frontale obliqua (Tanto tip)
  add(new THREE.BoxGeometry(0.6, 0.25, 0.04), matSilver, 2.5, 0.0, 0, Math.PI / 4, 0, 0);
  add(new THREE.BoxGeometry(0.6, 0.15, 0.08), matGunmetal, 2.45, 0.12, 0, Math.PI / 4, 0, 0);

  // Filo al plasma
  add(new THREE.BoxGeometry(2.0, 0.05, 0.05), matEnergyOrange, 1.4, -0.17, 0);
  add(new THREE.BoxGeometry(2.0, 0.02, 0.07), matNeonCyan, 1.4, -0.17, 0);
  add(new THREE.BoxGeometry(0.7, 0.05, 0.05), matEnergyOrange, 2.62, -0.05, 0, Math.PI / 4, 0, 0);
  add(new THREE.BoxGeometry(0.7, 0.02, 0.07), matNeonCyan, 2.62, -0.05, 0, Math.PI / 4, 0, 0);

  // Dettagli cyberpunk
  add(new THREE.CylinderGeometry(0.12, 0.12, 0.18, 16), matNeonPink, 0.2, 0, 0, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.2, 16), matSilver, 0.2, 0, 0, 0, 0, Math.PI / 2);

  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.15, 0.2, 0.1), matBlackDetail, 0.8 + (i * 0.3), 0.15, 0, 0, 0, -Math.PI / 8);
    add(new THREE.BoxGeometry(0.05, 0.22, 0.12), matEnergyOrange, 0.8 + (i * 0.3), 0.15, 0, 0, 0, -Math.PI / 8);
  }

  add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), matNeonCyan, 0.1, -0.1, 0.08, 0, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.8, 8), matNeonCyan, 0.1, -0.1, -0.08, 0, 0, Math.PI / 2);

  const pinGeo = new THREE.CylinderGeometry(0.03, 0.03, 0.3, 8);
  const pins: [number, number][] = [
    [-1.6, 0.1], [-1.6, -0.1],
    [-0.2, 0.3], [-0.2, -0.2],
    [0.2, 0.15], [0.2, -0.15]
  ];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return weaponGroup;
}

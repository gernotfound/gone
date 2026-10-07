import * as THREE from 'three';
import { addWeaponPart } from './proceduralShared.ts';

/**
 * Procedural Cyberpunk Assault Rifle builder.
 */
export function createAssaultRifleModel(): THREE.Group {
  const rifleGroup = new THREE.Group();
  rifleGroup.name = 'AssaultRifle';

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

  // Upper Receiver principale
  add(new THREE.BoxGeometry(2.4, 0.45, 0.35), matGunmetal, -0.1, 0.1, 0);
  // Piastre laterali rinforzate (Upper)
  add(new THREE.BoxGeometry(1.8, 0.25, 0.4), matDarkMetal, -0.1, 0.1, 0);
  // Lower Receiver (Alloggia grilletto e caricatore)
  add(new THREE.BoxGeometry(1.4, 0.3, 0.38), matGunmetal, 0.1, -0.2, 0);

  // Ejection Port (Sportello d'espulsione)
  add(new THREE.BoxGeometry(0.3, 0.1, 0.42), matBlackDetail, 0.2, 0.1, 0);
  add(new THREE.BoxGeometry(0.25, 0.08, 0.43), matBrass, 0.2, 0.1, 0);

  // Dettagli geometrici sul lato
  add(new THREE.BoxGeometry(0.8, 0.05, 0.42), matDarkMetal, -0.3, 0.2, 0);
  add(new THREE.BoxGeometry(0.4, 0.15, 0.41), matBlackDetail, -0.6, -0.15, 0);

  // Perni di fissaggio (Viti)
  const pinGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.45, 8);
  const pins: [number, number][] = [
    [-0.8, 0.1], [-0.5, 0.2], [-0.2, 0.2], [0.5, 0.2], [0.8, 0.1],
    [-0.3, -0.1], [0.4, -0.1]
  ];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  // Selettore di fuoco
  add(new THREE.BoxGeometry(0.08, 0.02, 0.44), matSilver, -0.4, -0.1, 0, Math.PI / 4);

  // Canna base
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.6, 16), matDarkMetal, 1.4, 0.1, 0, Math.PI / 2);
  // Canna interna
  add(new THREE.CylinderGeometry(0.05, 0.05, 2.0, 16), matSilver, 2.0, 0.1, 0, Math.PI / 2);

  // Spegnifiamma (Muzzle Brake)
  add(new THREE.CylinderGeometry(0.1, 0.09, 0.4, 16), matDarkMetal, 3.2, 0.1, 0, Math.PI / 2);
  add(new THREE.BoxGeometry(0.3, 0.06, 0.25), matGunmetal, 3.2, 0.1, 0);
  add(new THREE.BoxGeometry(0.1, 0.22, 0.1), matBlackDetail, 3.2, 0.1, 0.08);
  add(new THREE.BoxGeometry(0.1, 0.22, 0.1), matBlackDetail, 3.2, 0.1, -0.08);

  // Shroud (Copricanna ventilato)
  add(new THREE.BoxGeometry(1.3, 0.3, 0.3), matGunmetal, 1.7, 0.15, 0);
  for (let i = 0; i < 5; i++) {
    add(new THREE.BoxGeometry(0.12, 0.2, 0.32), matBlackDetail, 1.2 + (i * 0.22), 0.18, 0, Math.PI / 8);
  }

  // Cilindro plasma
  add(new THREE.CylinderGeometry(0.11, 0.11, 1.2, 16), matNeonCyan, 1.7, -0.12, 0, Math.PI / 2);

  // Gabbia acceleratore e bobine
  for (let i = 0; i < 7; i++) {
    add(new THREE.TorusGeometry(0.14, 0.02, 8, 16), matSilver, 1.2 + (i * 0.18), -0.12, 0, 0, Math.PI / 2);
    add(new THREE.BoxGeometry(0.04, 0.04, 0.32), matEnergyOrange, 1.2 + (i * 0.18), -0.12, 0);
  }

  // Top Rail (Picatinny lungo)
  add(new THREE.BoxGeometry(2.8, 0.05, 0.2), matSilver, 0.4, 0.35, 0);
  // Tacche di mira fisse (Iron sights)
  add(new THREE.BoxGeometry(0.1, 0.08, 0.1), matDarkMetal, -0.9, 0.4, 0);
  add(new THREE.BoxGeometry(0.05, 0.06, 0.05), matNeonPink, -0.9, 0.42, 0);
  add(new THREE.BoxGeometry(0.05, 0.1, 0.05), matDarkMetal, 1.7, 0.4, 0);
  add(new THREE.BoxGeometry(0.02, 0.05, 0.02), matNeonPink, 1.7, 0.44, 0);

  // Bottom Rail
  add(new THREE.BoxGeometry(1.0, 0.05, 0.15), matSilver, 1.7, -0.28, 0);

  // Foregrip
  add(new THREE.BoxGeometry(0.15, 0.3, 0.15), matRubber, 1.5, -0.4, 0, -Math.PI / 6);
  add(new THREE.BoxGeometry(0.2, 0.05, 0.18), matDarkMetal, 1.5, -0.28, 0, -Math.PI / 6);

  // Impugnatura principale (Grip ergonomico)
  add(new THREE.BoxGeometry(0.28, 0.7, 0.25), matRubber, -0.6, -0.5, 0, Math.PI / 10);
  add(new THREE.BoxGeometry(0.1, 0.6, 0.28), matBlackDetail, -0.5, -0.5, 0, Math.PI / 10);

  // Guardia e grilletto
  add(new THREE.BoxGeometry(0.5, 0.04, 0.1), matGunmetal, -0.2, -0.4, 0);
  add(new THREE.BoxGeometry(0.04, 0.3, 0.1), matGunmetal, 0.05, -0.3, 0, -Math.PI / 8);
  add(new THREE.BoxGeometry(0.05, 0.15, 0.05), matSilver, -0.3, -0.25, 0, -Math.PI / 12);

  // Magwell
  add(new THREE.BoxGeometry(0.65, 0.4, 0.4), matGunmetal, 0.4, -0.4, 0, -Math.PI / 16);
  // Caricatore
  add(new THREE.BoxGeometry(0.45, 0.6, 0.3), matDarkMetal, 0.45, -0.7, 0, -Math.PI / 16);
  add(new THREE.BoxGeometry(0.15, 0.4, 0.32), matEnergyOrange, 0.45, -0.7, 0, -Math.PI / 16);
  add(new THREE.BoxGeometry(0.5, 0.1, 0.35), matRubber, 0.48, -0.95, 0, -Math.PI / 16);

  // Adattatore base calcio
  add(new THREE.BoxGeometry(0.5, 0.4, 0.32), matDarkMetal, -1.3, 0.05, 0);
  // Tubi del calcio regolabile
  add(new THREE.CylinderGeometry(0.05, 0.05, 1.2, 16), matSilver, -1.8, 0.15, 0, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.04, 0.04, 1.2, 16), matSilver, -1.8, -0.1, 0, Math.PI / 2);
  // Corpo posteriore del calcio
  add(new THREE.BoxGeometry(0.4, 0.5, 0.3), matGunmetal, -2.4, 0.05, 0);
  // Poggiaguancia
  add(new THREE.BoxGeometry(0.7, 0.15, 0.25), matRubber, -1.9, 0.28, 0);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.15, 8), matSilver, -1.7, 0.2, 0);
  // Pad ammortizzante
  add(new THREE.BoxGeometry(0.15, 0.6, 0.35), matRubber, -2.65, 0.05, 0);

  // Cavi di alimentazione
  add(new THREE.CylinderGeometry(0.03, 0.03, 1.6, 12), matDarkMetal, 0.4, 0.05, 0.22, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.015, 0.015, 1.62, 12), matNeonPink, 0.4, 0.05, 0.22, Math.PI / 2);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), matBlackDetail, 0.7, -0.3, 0.15, Math.PI / 2.5);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.6, 8), matBlackDetail, 0.7, -0.3, -0.15, -Math.PI / 2.5);

  return rifleGroup;
}

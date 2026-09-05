// game-web/scripts/export_assets.mjs
// Offline script converting procedural Three.js models from source HTML into binary .glb files

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

// Polyfill FileReader for Node.js environment where GLTFExporter writes binary ArrayBuffer
if (typeof globalThis.FileReader === 'undefined') {
  globalThis.FileReader = class FileReader {
    async readAsArrayBuffer(blob) {
      this.result = await blob.arrayBuffer();
      if (this.onloadend) {
        this.onloadend();
      }
    }
  };
}

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const outputDir = path.resolve(__dirname, '../public/assets');

if (!fs.existsSync(outputDir)) {
  fs.mkdirSync(outputDir, { recursive: true });
}

// Helper for weapon parts: rotation parameter order is (geo, mat, x, y, z, rotZ, rotY, rotX) -> set(rotX, rotY, rotZ)
function addWeaponPart(group, geo, mat, x, y, z, rotZ = 0, rotY = 0, rotX = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

// Helper for robot parts: rotation parameter order is (geo, mat, x, y, z, rotX, rotY, rotZ) -> set(rotX, rotY, rotZ)
function addRobotPart(group, geo, mat, x, y, z, rotX = 0, rotY = 0, rotZ = 0) {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

function buildAssaultRifle() {
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

  const add = (geo, mat, x, y, z, rz = 0, ry = 0, rx = 0) => addWeaponPart(rifleGroup, geo, mat, x, y, z, rz, ry, rx);

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
  const pins = [
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

  // Foregrip (Impugnatura anteriore angolata)
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

function buildSniperRifle() {
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

  const add = (geo, mat, x, y, z, rz = 0, ry = 0, rx = 0) => addWeaponPart(rifleGroup, geo, mat, x, y, z, rz, ry, rx);

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
  const pins = [[-1.0, 0.1], [-0.5, 0.2], [0.5, 0.2], [0.9, 0.1], [0.4, -0.1]];
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
  // Gambe angolate: note exact rotation override from cecchino.html lines 173-174
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

function buildShotgun() {
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

  const add = (geo, mat, x, y, z, rz = 0, ry = 0, rx = 0) => addWeaponPart(rifleGroup, geo, mat, x, y, z, rz, ry, rx);

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
  const pins = [[-0.9, 0.3], [-0.5, 0.1], [0.1, 0.3], [0.5, -0.1], [2.6, 0.25]];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return rifleGroup;
}

function buildSmg() {
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

  const add = (geo, mat, x, y, z, rz = 0, ry = 0, rx = 0) => addWeaponPart(rifleGroup, geo, mat, x, y, z, rz, ry, rx);

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
  const pins = [[-0.9, 0.3], [-0.5, 0.2], [-0.1, 0.3], [0.1, -0.2], [0.6, 0.3], [1.1, 0.35]];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return rifleGroup;
}

function buildKnife() {
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

  const add = (geo, mat, x, y, z, rz = 0, ry = 0, rx = 0) => addWeaponPart(weaponGroup, geo, mat, x, y, z, rz, ry, rx);

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
  const pins = [
    [-1.6, 0.1], [-1.6, -0.1],
    [-0.2, 0.3], [-0.2, -0.2],
    [0.2, 0.15], [0.2, -0.15]
  ];
  pins.forEach(p => add(pinGeo, matSilver, p[0], p[1], 0, 0, 0, Math.PI / 2));

  return weaponGroup;
}

function buildRobot() {
  const robotGroup = new THREE.Group();
  robotGroup.name = 'CyberpunkRobot';

  const matDarkMetal = new THREE.MeshStandardMaterial({ color: 0x151515, roughness: 0.8, metalness: 0.6 });
  const matGunmetal = new THREE.MeshStandardMaterial({ color: 0x2b2b36, roughness: 0.5, metalness: 0.8 });
  const matSilver = new THREE.MeshStandardMaterial({ color: 0x888899, roughness: 0.2, metalness: 0.9 });
  const matBlackDetail = new THREE.MeshStandardMaterial({ color: 0x050505, roughness: 0.9, metalness: 0.4 });
  const matRubber = new THREE.MeshStandardMaterial({ color: 0x111111, roughness: 0.95, metalness: 0.1 });

  // Fluo material applied to exactly 7 accent meshes
  const matNeonGreen = new THREE.MeshStandardMaterial({
    name: 'RobotFluoAccent',
    color: 0x39ff14,
    emissive: 0x39ff14,
    emissiveIntensity: 2.5,
    roughness: 0.2
  });

  const add = (geo, mat, x, y, z, rx = 0, ry = 0, rz = 0) => addRobotPart(robotGroup, geo, mat, x, y, z, rx, ry, rz);

  // 1. Torso e chassis principale
  add(new THREE.BoxGeometry(1.2, 1.4, 1.0), matGunmetal, 0, 0.7, 0);
  add(new THREE.BoxGeometry(1.0, 0.6, 1.1), matDarkMetal, 0, 0.9, 0.05, Math.PI / 16, 0, 0);

  for (let i = 0; i < 4; i++) {
    add(new THREE.BoxGeometry(0.8, 0.05, 1.15), matBlackDetail, 0, 0.7 + (i * 0.12), 0.05, Math.PI / 16, 0, 0);
  }
  // 1. Fluo Torso Core
  add(new THREE.CylinderGeometry(0.2, 0.2, 1.2, 16), matNeonGreen, 0, 0.3, 0.2, Math.PI / 2, 0, 0);

  // 2. Testa e sensori
  add(new THREE.BoxGeometry(0.7, 0.6, 0.8), matDarkMetal, 0, 1.7, 0.1);
  add(new THREE.BoxGeometry(0.5, 0.4, 0.85), matBlackDetail, 0, 1.7, 0.1);
  // 2. Fluo Optical Visor
  add(new THREE.BoxGeometry(0.6, 0.15, 0.1), matNeonGreen, 0, 1.75, 0.52);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.6), matSilver, 0.3, 2.0, -0.2);
  add(new THREE.CylinderGeometry(0.02, 0.02, 0.4), matSilver, -0.3, 1.9, -0.2);

  // 3. Sistema di propulsione
  add(new THREE.CylinderGeometry(0.4, 0.3, 0.8, 16), matGunmetal, 0, -0.2, 0);
  // 3. Fluo Main Thruster Flame
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.2, 16), matNeonGreen, 0, -0.65, 0);

  // Propulsori di manovra
  add(new THREE.BoxGeometry(0.4, 0.6, 0.5), matDarkMetal, -0.7, 0.2, 0, 0, 0, Math.PI / 8);
  add(new THREE.CylinderGeometry(0.15, 0.1, 0.3, 16), matSilver, -0.8, -0.15, 0, 0, 0, Math.PI / 8);
  // 4. Fluo Right Thruster Exhaust
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16), matNeonGreen, -0.85, -0.3, 0, 0, 0, Math.PI / 8);

  add(new THREE.BoxGeometry(0.4, 0.6, 0.5), matDarkMetal, 0.7, 0.2, 0, 0, 0, -Math.PI / 8);
  add(new THREE.CylinderGeometry(0.15, 0.1, 0.3, 16), matSilver, 0.8, -0.15, 0, 0, 0, -Math.PI / 8);
  // 5. Fluo Left Thruster Exhaust
  add(new THREE.CylinderGeometry(0.08, 0.08, 0.1, 16), matNeonGreen, 0.85, -0.3, 0, 0, 0, -Math.PI / 8);

  // 4. Braccia articolate
  // Braccio Destro (Puntamento)
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), matBlackDetail, -0.7, 1.2, 0, Math.PI / 2, 0, 0);
  add(new THREE.SphereGeometry(0.3, 16, 16), matSilver, -0.8, 1.2, 0);
  add(new THREE.BoxGeometry(0.3, 0.8, 0.3), matGunmetal, -1.0, 0.8, 0, 0, 0, -Math.PI / 8);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), matBlackDetail, -1.15, 0.4, 0, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.25, 0.7, 0.3), matDarkMetal, -1.15, 0.4, 0.4, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), matSilver, -1.15, 0.4, 0.8);
  add(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, -1.0, 0.4, 0.95);
  add(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, -1.3, 0.4, 0.95);

  // Braccio Sinistro (A riposo)
  add(new THREE.CylinderGeometry(0.25, 0.25, 0.6, 16), matBlackDetail, 0.7, 1.2, 0, Math.PI / 2, 0, 0);
  add(new THREE.SphereGeometry(0.3, 16, 16), matSilver, 0.8, 1.2, 0);
  add(new THREE.BoxGeometry(0.3, 0.8, 0.3), matGunmetal, 1.0, 0.8, 0, 0, 0, Math.PI / 8);
  add(new THREE.CylinderGeometry(0.2, 0.2, 0.4, 16), matBlackDetail, 1.15, 0.4, 0, Math.PI / 2, 0, 0);
  add(new THREE.BoxGeometry(0.25, 0.7, 0.3), matDarkMetal, 1.15, 0.0, 0.1, -Math.PI / 6, 0, 0);
  add(new THREE.BoxGeometry(0.3, 0.3, 0.3), matSilver, 1.15, -0.4, 0.2);
  add(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, 1.0, -0.5, 0.25);
  add(new THREE.BoxGeometry(0.05, 0.2, 0.2), matRubber, 1.3, -0.5, 0.25);

  // 5. Zaino generatore (Backpack)
  add(new THREE.BoxGeometry(0.8, 1.0, 0.4), matGunmetal, 0, 0.8, -0.6);
  // 6. Fluo Right Energy Conduit
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 16), matNeonGreen, 0.2, 0.8, -0.8);
  // 7. Fluo Left Energy Conduit
  add(new THREE.CylinderGeometry(0.15, 0.15, 0.8, 16), matNeonGreen, -0.2, 0.8, -0.8);

  add(new THREE.TorusGeometry(0.3, 0.05, 8, 16, Math.PI), matBlackDetail, 0.5, 0.5, -0.4, 0, Math.PI / 2, 0);
  add(new THREE.TorusGeometry(0.3, 0.05, 8, 16, Math.PI), matBlackDetail, -0.5, 0.5, -0.4, 0, Math.PI / 2, 0);

  // Right claw weapon socket anchor point
  const weaponSocket = new THREE.Object3D();
  weaponSocket.name = 'WeaponSocket';
  weaponSocket.position.set(-1.15, 0.4, 0.85);
  robotGroup.add(weaponSocket);

  return robotGroup;
}

async function exportModels() {
  const models = [
    { name: 'assalto', builder: buildAssaultRifle },
    { name: 'cecchino', builder: buildSniperRifle },
    { name: 'pompa', builder: buildShotgun },
    { name: 'mitraglietta', builder: buildSmg },
    { name: 'coltello', builder: buildKnife },
    { name: 'modello', builder: buildRobot }
  ];

  const exporter = new GLTFExporter();
  const loader = new GLTFLoader();

  console.log(`Starting export of 6 models to ${outputDir}...`);

  for (const item of models) {
    const group = item.builder();
    const destPath = path.join(outputDir, `${item.name}.glb`);

    const glbBuffer = await exporter.parseAsync(group, { binary: true });
    fs.writeFileSync(destPath, Buffer.from(glbBuffer));

    const stats = fs.statSync(destPath);
    console.log(`[EXPORTED] ${item.name}.glb — ${stats.size} bytes`);

    // Verify parser loadability
    await new Promise((resolve, reject) => {
      loader.parse(
        glbBuffer,
        '',
        (gltf) => {
          const meshCount = gltf.scene.children.length;
          console.log(`  -> Verified with GLTFLoader: ${meshCount} direct children parsed successfully.`);
          resolve();
        },
        (err) => {
          reject(new Error(`Failed to parse ${item.name}.glb: ${err}`));
        }
      );
    });
  }

  console.log('All 6 GLB models successfully exported and verified!');
}

exportModels().catch((err) => {
  console.error('Fatal export error:', err);
  process.exit(1);
});

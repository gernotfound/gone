import * as THREE from 'three';

/**
 * Helper for weapon parts:
 * Historical HTML signature was: (geo, mat, x, y, z, rotZ, rotY, rotX)
 * then called mesh.rotation.set(rotX, rotY, rotZ).
 */
export function addWeaponPart(
  group: THREE.Group,
  geo: THREE.BufferGeometry,
  mat: THREE.Material,
  x: number,
  y: number,
  z: number,
  rotZ = 0,
  rotY = 0,
  rotX = 0
): THREE.Mesh {
  const mesh = new THREE.Mesh(geo, mat);
  mesh.position.set(x, y, z);
  mesh.rotation.set(rotX, rotY, rotZ);
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  group.add(mesh);
  return mesh;
}

import * as THREE from 'three';
import { generate_chunk, get_height_at } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';

export const activeChunks = new Map<string, any>();
export const CHUNK_SIZE = 400;
export const CHUNK_RESOLUTION = 64;
export const CHUNK_RADIUS = 2;

let lastChunkX: number | null = null;
let lastChunkZ: number | null = null;

export function getChunkMeshes(): THREE.Object3D[] {
    const meshes: THREE.Object3D[] = [];
    for (const chunkObj of activeChunks.values()) {
        if (chunkObj.mesh) meshes.push(chunkObj.mesh);
    }
    return meshes;
}

export function getTerrainHeightAt(x: number, z: number): number {
    return get_height_at(x, z);
}

export function updateChunks(playerPosition: THREE.Vector3) {
    const px = Math.floor(playerPosition.x / CHUNK_SIZE);
    const pz = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Chunk membership only changes after crossing a 400 m boundary. The old
    // code rebuilt Sets and walked the whole neighborhood every render frame.
    if (activeChunks.size > 0 && px === lastChunkX && pz === lastChunkZ) return;
    lastChunkX = px;
    lastChunkZ = pz;

    const currentChunks = new Set<string>();

    for (let x = -CHUNK_RADIUS; x <= CHUNK_RADIUS; x++) {
        for (let z = -CHUNK_RADIUS; z <= CHUNK_RADIUS; z++) {
            if (x * x + z * z > CHUNK_RADIUS * CHUNK_RADIUS + 1) continue;

            const cx = px + x;
            const cz = pz + z;
            const id = `${cx},${cz}`;
            currentChunks.add(id);

            if (!activeChunks.has(id)) {
                activeChunks.set(id, { mesh: null, targetY: 0 });

                const offsetX = cx * CHUNK_SIZE;
                const offsetZ = cz * CHUNK_SIZE;

                // CALL RUST WASM MODULE SYNCHRONOUSLY!
                const chunkData = generate_chunk(cx, cz, offsetX, offsetZ, CHUNK_SIZE, CHUNK_RESOLUTION);

                const heights = chunkData.get_heights();
                const colors = chunkData.get_colors();
                const rocks = chunkData.get_rocks();

                const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RESOLUTION, CHUNK_RESOLUTION);
                geometry.rotateX(-Math.PI / 2);

                const positions = geometry.attributes.position;
                for (let i = 0; i < positions.count; i++) {
                    positions.setY(i, heights[i]);
                }
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                geometry.computeVertexNormals();

                const mesh = new THREE.Mesh(geometry, sceneManager.terrainMaterial);
                mesh.position.set(offsetX, 0, offsetZ);
                mesh.receiveShadow = false;
                mesh.castShadow = false;

                if (rocks.length > 0) {
                    const rockCount = rocks.length / 9;
                    const instancedRocks = new THREE.InstancedMesh(sceneManager.rockGeo, sceneManager.rockMat, rockCount);
                    instancedRocks.castShadow = false;
                    instancedRocks.receiveShadow = false;

                    const dummy = new THREE.Object3D();
                    for (let i = 0; i < rockCount; i++) {
                        const idx = i * 9;
                        // Abbassiamo la roccia di un bel po' rispetto alla sua scala Y per evitare che voli
                        dummy.position.set(rocks[idx], rocks[idx + 1] - rocks[idx + 4] * 0.8, rocks[idx + 2]);
                        dummy.scale.set(rocks[idx + 3], rocks[idx + 4], rocks[idx + 5]);
                        dummy.rotation.set(rocks[idx + 6], rocks[idx + 7], rocks[idx + 8]);
                        dummy.updateMatrix();
                        instancedRocks.setMatrixAt(i, dummy.matrix);
                    }
                    instancedRocks.instanceMatrix.needsUpdate = true;
                    mesh.add(instancedRocks);
                }

                // Volumetric rays are large transparent meshes and therefore
                // fill-rate heavy. Keep the ambience but make them sparse.
                const seededRandom = (s: number) => {
                    const r = Math.sin(s) * 43758.5453;
                    return r - Math.floor(r);
                };

                const chunkSeed = cx * 12.9898 + cz * 78.233;
                if (seededRandom(chunkSeed) > 0.82) {
                    const sunDir = new THREE.Vector3(200, 300, -100).normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, sunDir);
                    const ray = new THREE.Mesh(sceneManager.rayGeo, sceneManager.rayMat);
                    const rX = ((seededRandom(chunkSeed + 2.1) - 0.5) * CHUNK_SIZE);
                    const rZ = ((seededRandom(chunkSeed + 3.7) - 0.5) * CHUNK_SIZE);
                    ray.position.set(rX, -50, rZ);
                    ray.quaternion.copy(quaternion);
                    mesh.add(ray);
                }

                sceneManager.scene.add(mesh);
                const chunkObj = activeChunks.get(id);
                if (chunkObj) chunkObj.mesh = mesh;

                chunkData.free();
            }
        }
    }

    // Clean distant chunks
    for (const [id, chunkObj] of activeChunks.entries()) {
        if (!currentChunks.has(id)) {
            if (chunkObj.mesh) {
                sceneManager.scene.remove(chunkObj.mesh);
                chunkObj.mesh.geometry.dispose();
                chunkObj.mesh.children.forEach((child: any) => {
                    if (child.isInstancedMesh) child.dispose();
                });
            }
            activeChunks.delete(id);
        }
    }
}

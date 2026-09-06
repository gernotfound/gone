import * as THREE from 'three';
import { generate_chunk, get_height_at } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';

export const activeChunks = new Map<string, any>();
export const CHUNK_SIZE = 400;
export const CHUNK_RESOLUTION = 64;
export const CHUNK_RADIUS = 2;

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
    let px = Math.floor(playerPosition.x / CHUNK_SIZE);
    let pz = Math.floor(playerPosition.z / CHUNK_SIZE);
    
    const currentChunks = new Set<string>();
    
    for (let x = -CHUNK_RADIUS; x <= CHUNK_RADIUS; x++) {
        for (let z = -CHUNK_RADIUS; z <= CHUNK_RADIUS; z++) {
            if(x*x + z*z > CHUNK_RADIUS*CHUNK_RADIUS + 1) continue;
            
            let cx = px + x;
            let cz = pz + z;
            let id = `${cx},${cz}`;
            currentChunks.add(id);

            if (!activeChunks.has(id)) {
                activeChunks.set(id, { mesh: null, targetY: 0 });
                
                let offsetX = cx * CHUNK_SIZE;
                let offsetZ = cz * CHUNK_SIZE;
                
                // CALL RUST WASM MODULE SYNCHRONOUSLY!
                let chunkData = generate_chunk(cx, cz, offsetX, offsetZ, CHUNK_SIZE, CHUNK_RESOLUTION);
                
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
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                
                if (rocks.length > 0) {
                    const rockCount = rocks.length / 9; 
                    const instancedRocks = new THREE.InstancedMesh(sceneManager.rockGeo, sceneManager.rockMat, rockCount);
                    instancedRocks.castShadow = true;
                    instancedRocks.receiveShadow = true;
                    
                    const dummy = new THREE.Object3D();
                    for(let i = 0; i < rockCount; i++) {
                        let idx = i * 9;
                        // Abbassiamo la roccia di un bel po' rispetto alla sua scala Y per evitare che voli
                        dummy.position.set(rocks[idx], rocks[idx+1] - rocks[idx+4] * 0.8, rocks[idx+2]);
                        dummy.scale.set(rocks[idx+3], rocks[idx+4], rocks[idx+5]); 
                        dummy.rotation.set(rocks[idx+6], rocks[idx+7], rocks[idx+8]);
                        dummy.updateMatrix();
                        instancedRocks.setMatrixAt(i, dummy.matrix);
                    }
                    mesh.add(instancedRocks);
                }

                // Generazione procedurale dei raggi di luce volumentrici (God Rays)
                // Usiamo una funzione pseudo-random basata sulle coordinate per avere seed fissi
                const seededRandom = (s: number) => {
                    const r = Math.sin(s) * 43758.5453;
                    return r - Math.floor(r);
                };
                
                const chunkSeed = cx * 12.9898 + cz * 78.233;
                if (seededRandom(chunkSeed) > 0.6) { 
                    // 40% di possibilità per un gruppo di raggi nel chunk
                    const rayCount = 1 + Math.floor((seededRandom(chunkSeed + 1) * 10) % 3);
                    const sunDir = new THREE.Vector3(200, 300, -100).normalize();
                    const up = new THREE.Vector3(0, 1, 0);
                    const quaternion = new THREE.Quaternion().setFromUnitVectors(up, sunDir);

                    for (let r = 0; r < rayCount; r++) {
                        const ray = new THREE.Mesh(sceneManager.rayGeo, sceneManager.rayMat);
                        const rX = ((seededRandom(chunkSeed + r * 2.1) - 0.5) * CHUNK_SIZE);
                        const rZ = ((seededRandom(chunkSeed + r * 3.7) - 0.5) * CHUNK_SIZE);
                        ray.position.set(rX, -50, rZ); 
                        ray.quaternion.copy(quaternion);
                        mesh.add(ray);
                    }
                }

                sceneManager.scene.add(mesh);
                let chunkObj = activeChunks.get(id);
                if (chunkObj) chunkObj.mesh = mesh;
                
                // Free memory
                chunkData.free();
            }
        }
    }

    // Clean distant chunks
    for (let [id, chunkObj] of activeChunks.entries()) {
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

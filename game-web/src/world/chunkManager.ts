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

function sampleRockFootprint(worldX: number, worldZ: number, footprint: number): {
    min: number;
    max: number;
    center: number;
} {
    const center = get_height_at(worldX, worldZ);
    const heights = [
        center,
        get_height_at(worldX + footprint, worldZ),
        get_height_at(worldX - footprint, worldZ),
        get_height_at(worldX, worldZ + footprint),
        get_height_at(worldX, worldZ - footprint),
    ];
    return {
        min: Math.min(...heights),
        max: Math.max(...heights),
        center,
    };
}

function createGroundedRocks(
    rocks: Float32Array,
    offsetX: number,
    offsetZ: number,
): THREE.InstancedMesh | null {
    if (rocks.length < 9) return null;

    const accepted: Array<{
        x: number; y: number; z: number;
        sx: number; sy: number; sz: number;
        rx: number; ry: number; rz: number;
    }> = [];

    const rockCount = Math.floor(rocks.length / 9);
    for (let i = 0; i < rockCount; i += 1) {
        const idx = i * 9;
        const localX = rocks[idx];
        const localZ = rocks[idx + 2];
        const sx = Math.max(0.05, rocks[idx + 3]);
        const sy = Math.max(0.05, rocks[idx + 4]);
        const sz = Math.max(0.05, rocks[idx + 5]);
        const worldX = offsetX + localX;
        const worldZ = offsetZ + localZ;

        // A rock must be supportable by the terrain under its footprint, not
        // merely by one center height sample. On cliff/crater edges, remove it.
        const footprint = Math.max(0.35, Math.min(3.5, Math.max(sx, sz) * 0.55));
        const ground = sampleRockFootprint(worldX, worldZ, footprint);
        const heightSpan = ground.max - ground.min;
        const maxSupportableSpan = Math.max(1.15, sy * 0.95);
        if (!Number.isFinite(ground.max) || heightSpan > maxSupportableSpan) continue;

        // DodecahedronGeometry is centered at the origin with radius ~1. Embed
        // most of the lower half into the highest support point so no side can
        // visibly hover after the small allowed tilt.
        const embeddedCenterY = ground.max + sy * 0.38;
        const rx = Math.sin(rocks[idx + 6]) * 0.18;
        const ry = rocks[idx + 7];
        const rz = Math.sin(rocks[idx + 8]) * 0.18;

        accepted.push({
            x: localX,
            y: embeddedCenterY,
            z: localZ,
            sx,
            sy,
            sz,
            rx,
            ry,
            rz,
        });
    }

    if (accepted.length === 0) return null;
    const instanced = new THREE.InstancedMesh(sceneManager.rockGeo, sceneManager.rockMat, accepted.length);
    instanced.castShadow = false;
    instanced.receiveShadow = false;
    const dummy = new THREE.Object3D();

    accepted.forEach((rock, index) => {
        dummy.position.set(rock.x, rock.y, rock.z);
        dummy.scale.set(rock.sx, rock.sy, rock.sz);
        dummy.rotation.set(rock.rx, rock.ry, rock.rz);
        dummy.updateMatrix();
        instanced.setMatrixAt(index, dummy.matrix);
    });
    instanced.instanceMatrix.needsUpdate = true;
    return instanced;
}

export function updateChunks(playerPosition: THREE.Vector3) {
    const px = Math.floor(playerPosition.x / CHUNK_SIZE);
    const pz = Math.floor(playerPosition.z / CHUNK_SIZE);

    // Chunk membership only changes after crossing a 400 m boundary.
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
                const chunkData = generate_chunk(cx, cz, offsetX, offsetZ, CHUNK_SIZE, CHUNK_RESOLUTION);

                const heights = chunkData.get_heights();
                const colors = chunkData.get_colors();
                const rocks = chunkData.get_rocks();

                const geometry = new THREE.PlaneGeometry(CHUNK_SIZE, CHUNK_SIZE, CHUNK_RESOLUTION, CHUNK_RESOLUTION);
                geometry.rotateX(-Math.PI / 2);
                const positions = geometry.attributes.position;
                for (let i = 0; i < positions.count; i += 1) positions.setY(i, heights[i]);
                geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
                geometry.computeVertexNormals();

                const mesh = new THREE.Mesh(geometry, sceneManager.terrainMaterial);
                mesh.position.set(offsetX, 0, offsetZ);
                mesh.receiveShadow = false;
                mesh.castShadow = false;

                const groundedRocks = createGroundedRocks(rocks, offsetX, offsetZ);
                if (groundedRocks) mesh.add(groundedRocks);

                // Large transparent god rays are fill-rate heavy. Keep a sparse
                // deterministic ambience instead of multiple rays per chunk.
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
                    ray.position.set(
                        (seededRandom(chunkSeed + 2.1) - 0.5) * CHUNK_SIZE,
                        -50,
                        (seededRandom(chunkSeed + 3.7) - 0.5) * CHUNK_SIZE,
                    );
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

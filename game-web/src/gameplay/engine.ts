
import { sceneManager } from '../rendering/scene.ts';
import { inputState, initInput, resetInputState } from '../controls/playerInput.ts';

import * as THREE from 'three';
import init, { PhysicsInput, step_physics } from '../../pkg/game_core.js';
import { updateChunks, getChunkMeshes, getTerrainHeightAt } from '../world/chunkManager.ts';
import {
    type WeaponModelType,
    WEAPON_TYPES,
    WEAPON_MUZZLE_POSITIONS,
    createWeaponViewModel,
    loadWeaponViewModel,
    createThirdPersonWeapon,
    createProceduralRobot,
    loadRobotModel,
    applyFluoColor,
    attachWeaponToRobot,
    ROBOT_SCALE,
} from '../models/index.ts';
import { P2PClient } from '../net/p2pClient.ts';
import { P2PHost } from '../net/p2pHost.ts';
import { InterpolationBuffer } from '../net/interpolationBuffer.ts';
import { type FireHitscanMessage } from '../net/protocol.ts';
import { STATE_FLAGS, type WorldSnapshotData, type FireHitscanData, type HitConfirmedData } from '../net/binaryProtocol.ts';
import { soundSynth } from '../audio/index.ts';
import { vfxManager } from '../vfx/index.ts';
import { healthHud } from '../ui/healthHud.ts';
import { shieldVfxController } from '../vfx/shieldVfx.ts';
import type { HitConfirmationEvent } from '../net/p2pHost.ts';
import { setupMenu, isMusicPlaying, setIsMusicPlaying, volumes, DOM } from '../ui/menu.ts';
import { localPlayerColor, setLocalPlayerColor, activeP2PClient, setActiveP2PClient, activeP2PHost, setActiveP2PHost, localRobotPreview, setLocalRobotPreview } from '../ui/lobby.ts';

import { encodeLobbyGameStart } from '../net/binaryProtocol.ts';
import { updateWeaponHud } from '../ui/weaponHud.ts';
import { updateLoadingProgress, showLoadingScreen, hideLoadingScreen, showErrorLoading } from '../ui/loading.ts';
import { initMinimap, drawMinimap } from '../ui/minimap.ts';

// --- UI SETUP ---
export function bootstrap() {
    setupMenu({
        onPlayMultiplayer: async () => {
            if (activeP2PHost) {
                for (const peer of (activeP2PHost as any).peers.values()) {
                    peer.channel.send(encodeLobbyGameStart());
                }
            }
            DOM.multiplayerLobby.classList.remove('flex');
            DOM.multiplayerLobby.classList.add('hidden');
            if (typeof preLoadGame !== 'undefined' && !hasInitializedWasm) {
                preLoadGame();
            } else if (typeof startGameplay !== 'undefined') {
                startGameplay();
            }
        },
        onEnter: async (e: MouseEvent) => {
            e.stopPropagation(); // Evita il bubbling al document, che causerebbe un doppio requestPointerLock
            soundSynth.unlock().catch(() => {});
            
            if (!hasInitializedWasm) {
                // Primo avvio: mostra caricamento, carica, poi entra
                preLoadGame();
            } else {
                // Ripresa del gioco dalla pausa (esc)
                startGameplay();
            }
        },
        onExit: () => {
            location.reload();
        }
    });
    
}
// --- GAME LOGIC ---
let isGameRunning = false;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;

const clock = new THREE.Timer();

// Shared math constants to eliminate garbage collection allocations per-frame
const UP_VECTOR = new THREE.Vector3(0, 1, 0);
const RIGHT_VECTOR = new THREE.Vector3(1, 0, 0);
const FORWARD_VECTOR = new THREE.Vector3(0, 0, 1);
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0);

// Authoritative Weapon Configs & Combat Dynamics (synchronized with game-core/src/weapons.rs)
export interface WeaponStats {
    id: number;
    name: string;
    fireRateRps: number;
    recoilPitchDeg: number;
    recoilYawDeg: number;
    recoilRecoveryRate: number;
    kickZ: number;
    kickPitch: number;
}

export const WEAPON_COMBAT_STATS: Record<WeaponModelType, WeaponStats> = {
    assalto: {
        id: 0,
        name: 'AR-42 Viper',
        fireRateRps: 6.25,
        recoilPitchDeg: 1.10,
        recoilYawDeg: 0.35,
        recoilRecoveryRate: 8.0,
        kickZ: 0.05,
        kickPitch: 0.04,
    },
    cecchino: {
        id: 1,
        name: 'SR-99 Railphantom',
        fireRateRps: 1.00,
        recoilPitchDeg: 5.50,
        recoilYawDeg: 0.80,
        recoilRecoveryRate: 3.5,
        kickZ: 0.12,
        kickPitch: 0.08,
    },
    pompa: {
        id: 2,
        name: 'SG-12 Havoc',
        fireRateRps: 1.25,
        recoilPitchDeg: 4.00,
        recoilYawDeg: 1.20,
        recoilRecoveryRate: 4.0,
        kickZ: 0.10,
        kickPitch: 0.07,
    },
    mitraglietta: {
        id: 3,
        name: 'SMG-7 Neon Hornet',
        fireRateRps: 10.00,
        recoilPitchDeg: 0.55,
        recoilYawDeg: 0.65,
        recoilRecoveryRate: 10.0,
        kickZ: 0.03,
        kickPitch: 0.025,
    },
    coltello: {
        id: 4,
        name: 'CB-01 Shadowfang',
        fireRateRps: 1.25,
        recoilPitchDeg: 0.0,
        recoilYawDeg: 0.0,
        recoilRecoveryRate: 0.0,
        kickZ: 0.08,
        kickPitch: -0.05,
    },
};

export interface RecoilShakeState {
    baseYaw: number;
    basePitch: number;
    recoilCamPitch: number;
    recoilCamYaw: number;
    shakeTrauma: number;
    isShooting: boolean;
    shotCooldown: number;
}

// Aim, Recoil & Screen Shake State
let recoilCamPitch = 0;
let recoilCamYaw = 0;
let shakeTrauma = 0;
let shakeTime = 0;
let shotCooldown = 0;

// Effective composed camera angles (for backward compatibility & inspection)
let yaw = 0;
let pitch = 0;

export function getRecoilShakeState(): RecoilShakeState {
    return {
        baseYaw: inputState.yaw,
        basePitch: inputState.pitch,
        recoilCamPitch,
        recoilCamYaw,
        shakeTrauma,
        isShooting: inputState.fire,
        shotCooldown,
    };
}

const moveDirection = new THREE.Vector3();

// Float character mechanics (as requested: "fluttua a qualche decina di cm in aria")
const player = {
    height: 2.0, 
    eyeHeight: 1.8, 
    floatHeight: 0.5, // 50cm floating
    speed: 12.0, // Velocità base (camminata)
    sprintMultiplier: 2.0, // Sprint è 2x
    crouchMultiplier: 0.6, // Accovacciamento è 0.6x
    crouchEyeHeight: 1.0,
    jumpForce: 25.0, // Salto altissimo
    gravity: 9.8,    // Gravità reale terrestre
    gravityScale: 5.0, // Moltiplicatore da videogioco per evitare l'effetto "luna"
    mass: 80.0,      // Peso in kg
    velocity: new THREE.Vector3(), 
    position: new THREE.Vector3(0, 17.5, 0),
    isGrounded: false,
    color: localPlayerColor,
    hp: 100,
    maxHp: 100,
    isAlive: true,
    isInvulnerable: true,
    shieldExpiresAt: performance.now() + 10000,
    deathTimer: 0,
};

// --- COMBAT LIFECYCLE & SHIELD ANCHOR ---
let localShieldAnchor: THREE.Group = new THREE.Group();
localShieldAnchor.name = 'LocalShieldAnchor';
let deathCameraPos = new THREE.Vector3(0, 20.0, 0);
let deathCameraYaw = 0;
let deathCameraPitch = -0.35;

export function handleLocalPlayerDeath(): void {
    if (!player.isAlive && player.deathTimer > 0) return;
    player.isAlive = false;
    player.hp = 0;
    player.deathTimer = 5.0;
    player.isInvulnerable = false;
    player.shieldExpiresAt = 0;

    // Detach local shield if any
    shieldVfxController.detachShield(localShieldAnchor);
    healthHud.updateShield(0);

    // Freeze inputs
    resetInputState();

    // Hide viewmodel
    viewmodelRoot.visible = false;

    // Static spectator camera positioned at death elevation with subtle downward angle
    deathCameraPos.set(player.position.x, player.position.y + 2.5, player.position.z);
    deathCameraYaw = inputState.yaw;
    deathCameraPitch = -0.35;

    // Show 5-second death overlay with countdown
    healthHud.showDeathOverlay(5.0);
}

export function handleLocalPlayerRespawn(): void {
    player.isAlive = true;
    player.hp = 100;
    player.deathTimer = 0;
    player.isInvulnerable = true;
    const now = performance.now();
    player.shieldExpiresAt = now + 10000;

    // Teleport to central platform [0.0, 17.5, 0.0]
    player.position.set(0.0, 17.5, 0.0);
    player.velocity.set(0, 0, 0);

    // Restore viewmodel and inputs
    viewmodelRoot.visible = true;

    // Reset camera orientation
    inputState.pitch = 0;
    recoilCamPitch = 0;
    recoilCamYaw = 0;

    // Hide death overlay and reset health bar
    healthHud.hideDeathOverlay();
    healthHud.updateHealth(100, 100);

    // Activate 10-second invulnerability shield
    shieldVfxController.attachShield(localShieldAnchor, 10.0, new THREE.Vector3(0, 0, 0));
    healthHud.updateShield(10.0);
}

export function handleLocalPlayerDamage(newHp: number): void {
    if (!player.isAlive) return;

    player.hp = Math.max(0, newHp);
    healthHud.updateHealth(player.hp, player.maxHp);

    if (player.hp <= 0) {
        handleLocalPlayerDeath();
    }
}

// --- WEAPON VIEWMODEL & REMOTE PLAYERS ---
let currentWeaponIndex = 0;
let currentWeaponType: WeaponModelType = 'assalto';
const viewmodelRoot = new THREE.Group();
viewmodelRoot.name = 'ViewmodelRoot';
const recoilContainer = new THREE.Group();
recoilContainer.name = 'RecoilContainer';
viewmodelRoot.add(recoilContainer);

const viewmodelCache = new Map<WeaponModelType, THREE.Group>();
const recoilOffset = new THREE.Vector3(0, 0, 0);
const recoilRotation = new THREE.Euler(0, 0, 0);
let walkBobTimer = 0;
let switchAnimationTimer = 0;


async function switchWeapon(index: number): Promise<void> {
    if (index < 0 || index >= WEAPON_TYPES.length) return;
    if (index === currentWeaponIndex && recoilContainer.children.length > 0) return;

    currentWeaponIndex = index;
    currentWeaponType = WEAPON_TYPES[index];

    // Clear current viewmodel mesh
    while (recoilContainer.children.length > 0) {
        recoilContainer.remove(recoilContainer.children[0]);
    }

    // Switch animation kick
    switchAnimationTimer = 0.15;
    shotCooldown = Math.max(shotCooldown, 0.15);
    if (currentWeaponType === 'coltello') {
        recoilCamPitch = 0;
        recoilCamYaw = 0;
    }
    recoilContainer.position.y = -0.12;

    if (!viewmodelCache.has(currentWeaponType)) {
        const proceduralVm = createWeaponViewModel(currentWeaponType);
        viewmodelCache.set(currentWeaponType, proceduralVm);
        // Attempt async upgrade to GLB asset
        loadWeaponViewModel(currentWeaponType).then((glbVm) => {
            const oldVm = viewmodelCache.get(currentWeaponType);
            viewmodelCache.set(currentWeaponType, glbVm);
            if (currentWeaponType === WEAPON_TYPES[currentWeaponIndex]) {
                while (recoilContainer.children.length > 0) {
                    recoilContainer.remove(recoilContainer.children[0]);
                }
                recoilContainer.add(glbVm);
            }
            if (oldVm && oldVm !== glbVm) {
                sceneManager.disposeHierarchy(oldVm);
            }
        }).catch(() => {});
    }

    const activeVm = viewmodelCache.get(currentWeaponType)!;
    recoilContainer.add(activeVm);

    updateWeaponHud(WEAPON_COMBAT_STATS[currentWeaponType]?.name ?? currentWeaponType, currentWeaponIndex);
}

function fireWeapon(): void {
    if (!isGameRunning || !player.isAlive || document.pointerLockElement !== document.body || !DOM.mainMenu.classList.contains('hidden') || isMapOpen) {
        return;
    }
    if (shotCooldown > 1e-4) {
        return;
    }

    const stats = WEAPON_COMBAT_STATS[currentWeaponType] || WEAPON_COMBAT_STATS.assalto;
    shotCooldown = 1.0 / stats.fireRateRps;

    // Viewmodel punch
    recoilOffset.z += stats.kickZ;
    recoilRotation.x += stats.kickPitch;
    recoilRotation.y += (Math.random() - 0.5) * 0.01;

    // Recoil kick in radians (authoritative conversion from degrees)
    const kickPitchRad = (stats.recoilPitchDeg * Math.PI) / 180;
    const kickYawRad = (stats.recoilYawDeg * Math.PI) / 180;

    recoilCamPitch += kickPitchRad;
    recoilCamYaw += (Math.random() - 0.5) * 2.0 * kickYawRad;

    // Trauma screen shake (proportional to recoil kick, capped at 1.0)
    const traumaAdd = (stats.recoilPitchDeg / 5.50) * 0.35;
    shakeTrauma = Math.min(1.0, shakeTrauma + traumaAdd);

    // Audio Playback
    soundSynth.playWeaponSound(currentWeaponType, 1.0);

    // World Muzzle Position Calculation
    const muzzleWorldPos = new THREE.Vector3();
    const activeVm = recoilContainer.children[0] as THREE.Group | undefined;
    const innerVm = activeVm && activeVm.children.length > 0 ? (activeVm.children[0] as THREE.Object3D) : activeVm;
    if (innerVm) {
        camera.updateMatrixWorld(true);
        viewmodelRoot.updateMatrixWorld(true);
        innerVm.updateMatrixWorld(true);
        const localMuzzle = WEAPON_MUZZLE_POSITIONS[currentWeaponType] ?? new THREE.Vector3(3.2, 0.1, 0);
        muzzleWorldPos.copy(localMuzzle).applyMatrix4(innerVm.matrixWorld);
    } else {
        muzzleWorldPos.copy(camera.position).add(new THREE.Vector3(0.3, -0.25, -0.8).applyQuaternion(camera.quaternion));
    }

    // Dynamic Muzzle Flash
    vfxManager.spawnMuzzleFlash(muzzleWorldPos, currentWeaponType);

    // Hitscan Raycasting from Camera Center
    const raycaster = new THREE.Raycaster();
    const rayOrigin = camera.position.clone();
    const rayDir = new THREE.Vector3();
    camera.getWorldDirection(rayDir);
    raycaster.set(rayOrigin, rayDir);

    const maxDist = currentWeaponType === 'coltello' ? 2.5 : 1000.0;
    raycaster.far = maxDist;

    const targetObjects: THREE.Object3D[] = [];
    targetObjects.push(...getChunkMeshes());
    for (const remotePlayer of remotePlayers.values()) {
        if (remotePlayer.group) {
            targetObjects.push(remotePlayer.group);
        }
    }

    const intersects = raycaster.intersectObjects(targetObjects, true);
    const hitPoint = new THREE.Vector3();
    let hitNormal: THREE.Vector3 | null = null;

    if (intersects.length > 0) {
        const hit = intersects[0];
        hitPoint.copy(hit.point);
        if (hit.face) {
            hitNormal = hit.face.normal.clone().transformDirection(hit.object.matrixWorld);
        } else {
            hitNormal = rayDir.clone().negate();
        }
    } else {
        hitPoint.copy(rayOrigin).addScaledVector(rayDir, currentWeaponType === 'coltello' ? 2.5 : 300.0);
    }

    // Visual Tracers (Pompa auto-spreads 8 pellets; single beam for others)
    vfxManager.spawnTracer(muzzleWorldPos, hitPoint, currentWeaponType);

    // Impact Particles
    if (hitNormal) {
        vfxManager.spawnImpact(hitPoint, hitNormal, currentWeaponType);
    }

    // P2P Network Synchronization (Host authoritative check or Client transmission)
    if (activeP2PHost) {
        activeP2PHost.fireHitscan(
            activeP2PHost.hostPlayer.id,
            stats.id,
            [muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z],
            [rayDir.x, rayDir.y, rayDir.z]
        );
    } else if (activeP2PClient && activeP2PClient.status === 'connected') {
        activeP2PClient.fireHitscan(
            stats.id,
            [muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z],
            [rayDir.x, rayDir.y, rayDir.z]
        );
    }
}

function updateViewmodel(delta: number): void {
    // Smooth recoil recovery spring
    recoilOffset.lerp(ZERO_VECTOR, Math.min(1.0, 18.0 * delta));
    recoilRotation.x = THREE.MathUtils.lerp(recoilRotation.x, 0, Math.min(1.0, 15.0 * delta));
    recoilRotation.y = THREE.MathUtils.lerp(recoilRotation.y, 0, Math.min(1.0, 15.0 * delta));
    recoilRotation.z = THREE.MathUtils.lerp(recoilRotation.z, 0, Math.min(1.0, 15.0 * delta));

    if (switchAnimationTimer > 0) {
        switchAnimationTimer -= delta;
        recoilContainer.position.y = THREE.MathUtils.lerp(recoilContainer.position.y, 0, Math.min(1.0, 16.0 * delta));
    } else {
        recoilContainer.position.y = recoilOffset.y;
    }
    recoilContainer.position.x = recoilOffset.x;
    recoilContainer.position.z = recoilOffset.z;
    recoilContainer.rotation.set(recoilRotation.x, recoilRotation.y, recoilRotation.z);

    // Natural walk bobbing
    if (moveDirection.lengthSq() > 0.01 && player.isGrounded) {
        const bobSpeed = inputState.shift ? 14.0 : 9.0;
        walkBobTimer += delta * bobSpeed;
        const bobX = Math.cos(walkBobTimer) * 0.005;
        const bobY = Math.sin(walkBobTimer * 2) * 0.005;
        viewmodelRoot.position.set(bobX, bobY, 0);
    } else {
        viewmodelRoot.position.lerp(ZERO_VECTOR, Math.min(1.0, 8.0 * delta));
    }
}

// --- REMOTE PLAYERS REGISTRY ---
export interface RemotePlayerInstance {
    id: string;
    slot?: number;
    color: string;
    weaponType: WeaponModelType;
    group: THREE.Group;
    interpolator: InterpolationBuffer;
}

export const remotePlayers = new Map<string, RemotePlayerInstance>();

export function addOrUpdateRemotePlayer(
    id: string,
    x: number,
    y: number,
    z: number,
    yawAngle: number,
    fluoColor: string = '#00F0FF',
    weapon: WeaponModelType | number = 'assalto',
    slot?: number
): RemotePlayerInstance {
    const resolvedWeapon = typeof weapon === 'number' ? (WEAPON_TYPES[weapon] ?? 'assalto') : weapon;
    let entry = remotePlayers.get(id);

    if (!entry) {
        const robot = createProceduralRobot(fluoColor);
        robot.scale.set(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
        robot.position.set(x, y, z);
        robot.rotation.y = yawAngle;

        const tpWeapon = createThirdPersonWeapon(resolvedWeapon);
        attachWeaponToRobot(robot, tpWeapon);

        scene.add(robot);

        const interpolator = new InterpolationBuffer({
            renderDelayMs: 90,
            maxExtrapolationMs: 150,
            teleportThresholdMeters: 10.0,
        });
        interpolator.pushSnapshot({
            timestamp: performance.now() - 90,
            x,
            y,
            z,
            yaw: yawAngle,
            pitch: 0,
        });

        entry = {
            id,
            slot,
            color: fluoColor,
            weaponType: resolvedWeapon,
            group: robot,
            interpolator,
        };
        remotePlayers.set(id, entry);

        // Async upgrade to GLTF robot
        loadRobotModel('assets/modello.glb', fluoColor).then((glbRobot) => {
            if (remotePlayers.has(id)) {
                sceneManager.disposeHierarchy(entry!.group);
                scene.remove(entry!.group);
                glbRobot.scale.set(ROBOT_SCALE, ROBOT_SCALE, ROBOT_SCALE);
                glbRobot.position.copy(entry!.group.position);
                glbRobot.rotation.copy(entry!.group.rotation);
                attachWeaponToRobot(glbRobot, createThirdPersonWeapon(entry!.weaponType));
                scene.add(glbRobot);
                entry!.group = glbRobot;
            }
        }).catch(() => {});
    } else {
        if (slot !== undefined) entry.slot = slot;
        entry.group.position.set(x, y, z);
        entry.group.rotation.y = yawAngle;

        entry.interpolator.pushSnapshot({
            timestamp: performance.now() - 90,
            x,
            y,
            z,
            yaw: yawAngle,
            pitch: 0,
        });

        if (entry.color !== fluoColor) {
            entry.color = fluoColor;
            applyFluoColor(entry.group, fluoColor);
        }

        if (entry.weaponType !== resolvedWeapon) {
            entry.weaponType = resolvedWeapon;
            attachWeaponToRobot(entry.group, createThirdPersonWeapon(resolvedWeapon));
        }
    }

    return entry;
}

export function removeRemotePlayer(id: string): void {
    const entry = remotePlayers.get(id);
    if (entry) {
        sceneManager.disposeHierarchy(entry.group);
        scene.remove(entry.group);
        remotePlayers.delete(id);
    }
}

export function handleRemoteHitscan(msg: FireHitscanMessage): void {
    if (!scene) return;
    const weaponKey = typeof msg.weaponType === 'number'
        ? (WEAPON_TYPES[msg.weaponType] ?? 'assalto')
        : (msg.weaponType || 'assalto');
    const origin = new THREE.Vector3(msg.origin[0], msg.origin[1], msg.origin[2]);
    const dir = new THREE.Vector3(msg.direction[0], msg.direction[1], msg.direction[2]).normalize();

    // If origin is zero/unset and shooter exists, use shooter position
    const shooter = remotePlayers.get(msg.shooterId);
    let startPos = origin;
    if (origin.lengthSq() < 0.001 && shooter) {
        startPos = shooter.group.position.clone().add(new THREE.Vector3(0, player.eyeHeight, 0));
    }

    const maxRange = weaponKey === 'coltello' ? 2.5 : 1000.0;
    const remoteRaycaster = new THREE.Raycaster(startPos, dir, 0.01, maxRange);
    const targetObjects: THREE.Object3D[] = [];
    targetObjects.push(...getChunkMeshes());
    for (const [pid, rp] of remotePlayers.entries()) {
        if (pid !== msg.shooterId && rp.group) {
            targetObjects.push(rp.group);
        }
    }

    const intersects = remoteRaycaster.intersectObjects(targetObjects, true);
    const hitPoint = new THREE.Vector3();
    let hitNormal: THREE.Vector3 | null = null;
    if (intersects.length > 0) {
        hitPoint.copy(intersects[0].point);
        if (intersects[0].face) {
            hitNormal = intersects[0].face.normal.clone().transformDirection(intersects[0].object.matrixWorld);
        } else {
            hitNormal = dir.clone().negate();
        }
    } else {
        hitPoint.copy(startPos).addScaledVector(dir, weaponKey === 'coltello' ? 2.5 : 300.0);
    }

    vfxManager.spawnMuzzleFlash(startPos, weaponKey);
    vfxManager.spawnTracer(startPos, hitPoint, weaponKey);
    if (hitNormal) {
        vfxManager.spawnImpact(hitPoint, hitNormal, weaponKey);
    }
    soundSynth.playWeaponSound(weaponKey, 1.0);
}

let hasInitializedWasm = false;


async function preLoadGame() {
    showLoadingScreen();
    
    try {
        updateLoadingProgress(10, 'DOWNLOAD MOTORE WASM...');
        await new Promise(r => setTimeout(r, 200)); 
        
        await init();
        hasInitializedWasm = true;
        updateLoadingProgress(50, 'INIZIALIZZAZIONE SHADER THREE.JS...');
        await new Promise(r => setTimeout(r, 200));

        isGameRunning = true;
        initGame(); 
        
        updateLoadingProgress(80, 'GENERAZIONE CHUNK PROCEDURALI...');
        await new Promise(r => setTimeout(r, 200));
        
        renderer.compile(scene, camera);
        
        updateLoadingProgress(100, 'MONDO PRONTO!');
        await new Promise(r => setTimeout(r, 300));
        
        hideLoadingScreen(() => {
            startGameplay();
        });

    } catch(e) {
        showErrorLoading(e);
    }
}

function startGameplay() {
    soundSynth.unlock().catch(() => {});
    DOM.mainMenu.classList.add('hidden');
    DOM.gameUi.classList.remove('hidden');
    DOM.gameCanvas.classList.remove('hidden');
    
    if (!isMusicPlaying && DOM.musicStatus.textContent !== 'OFF') {
        DOM.bgMusic.play().catch(() => {});
        setIsMusicPlaying(true);
        DOM.musicStatus.textContent = 'ON';
        DOM.musicStatus.className = 'text-emerald-400';
    }
    
    try {
        const promise = document.body.requestPointerLock();
        if (promise) promise.catch(() => {});
    } catch(e) {}
}



function initGame() {
    clock.connect(document);
    sceneManager.init();
    initMinimap();
    scene = sceneManager.scene;
    camera = sceneManager.camera;
    renderer = sceneManager.renderer;

    DOM.bgMusic.volume = (volumes.master * volumes.music) * 0.5;

    camera.userData.currentY = getTerrainHeightAt(0, 0) + player.eyeHeight + player.floatHeight;

    player.position.set(0, getTerrainHeightAt(0, 0) + player.height + player.floatHeight, 0);

    // Attach camera to scene and viewmodel to camera
    scene.add(camera);
    camera.add(viewmodelRoot);
    switchWeapon(0);

    // Initialize VFX Coordinator
    vfxManager.init(scene, camera);

    // Initialize Cyberpunk Health HUD
    healthHud.init();

    // Attach local player shield anchor to scene and grant 10s initial spawn immunity
    localShieldAnchor.position.set(player.position.x, player.position.y - player.height + 0.9, player.position.z);
    scene.add(localShieldAnchor);
    player.isInvulnerable = true;
    player.shieldExpiresAt = performance.now() + 10000;
    shieldVfxController.attachShield(localShieldAnchor, 10.0, new THREE.Vector3(0, 0, 0));
    healthHud.updateShield(10.0);
    healthHud.updateHealth(player.hp, player.maxHp);

    initInput({
        onWeaponSwitch: (index) => switchWeapon(index),
        onFire: () => {
            if (isGameRunning && player.isAlive && document.pointerLockElement === document.body && DOM.mainMenu.classList.contains('hidden') && !isMapOpen) {
                if (shotCooldown <= 1e-4) {
                    fireWeapon();
                }
            }
        },
        onToggleMap: () => {
            if (isGameRunning && DOM.mainMenu.classList.contains('hidden')) {
                isMapOpen = !isMapOpen;
                if (isMapOpen) {
                    DOM.mapUi.classList.remove('hidden');
                    if (document.pointerLockElement === document.body) {
                        document.exitPointerLock();
                    }
                    drawMinimap(player.position.x, player.position.z, inputState.yaw, getTerrainHeightAt);
                } else {
                    DOM.mapUi.classList.add('hidden');
                    document.body.requestPointerLock();
                }
            }
        },
        onInteract: () => {
            soundSynth.unlock().catch(() => {});
            if(isGameRunning && document.pointerLockElement !== document.body && DOM.mainMenu.classList.contains('hidden') && DOM.settingsMenu.classList.contains('hidden') && !isMapOpen) {
                document.body.requestPointerLock();
            }
        },
        onPointerLockLost: () => {
            if (isGameRunning && !isMapOpen) {
                DOM.mainMenu.classList.remove('hidden');
                DOM.gameUi.classList.add('hidden');
                DOM.btnEnter.textContent = "RIPRENDI";
                DOM.btnEnter.disabled = false;
                DOM.btnExit.classList.remove('hidden');
            }
        },
        onPointerLockAcquired: () => {
            soundSynth.unlock().catch(() => {});
        }
    });

    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}




let isMapOpen = false;




function updatePhysics(delta: number) {
    if (!player.isAlive) {
        return;
    }
    
    // For viewmodel bobbing and general direction tracking
    moveDirection.set(0, 0, 0);
    if (inputState.forward) moveDirection.z -= 1;
    if (inputState.backward) moveDirection.z += 1;
    if (inputState.left) moveDirection.x -= 1;
    if (inputState.right) moveDirection.x += 1;
    if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        moveDirection.applyAxisAngle(UP_VECTOR, inputState.yaw);
    }

    const canJump = DOM.mainMenu.classList.contains('hidden') && !isMapOpen;

    const input = new PhysicsInput(
        player.position.x,
        player.position.y,
        player.position.z,
        player.velocity.y,
        player.isGrounded,
        inputState.forward,
        inputState.backward,
        inputState.left,
        inputState.right,
        inputState.yaw,
        inputState.jump && canJump,
        inputState.shift,
        inputState.ctrl,
        delta
    );

    const state = step_physics(input);

    player.position.set(state.x, state.y, state.z);
    player.velocity.y = state.vel_y;
    player.isGrounded = state.is_grounded;

    input.free();
    state.free();

    const eyeH = inputState.ctrl ? player.crouchEyeHeight : player.eyeHeight;
    const targetCamY = player.position.y + eyeH - player.height;
    if (camera.userData.currentY === undefined) {
        camera.userData.currentY = targetCamY;
    }
    
    const lerpSpeed = player.isGrounded ? 15.0 : 30.0;
    camera.userData.currentY += (targetCamY - camera.userData.currentY) * Math.min(1.0, lerpSpeed * delta);

    camera.position.set(player.position.x, camera.userData.currentY, player.position.z);

    // Recoil recovery: authoritative exponential decay back to zero
    const stats = WEAPON_COMBAT_STATS[currentWeaponType] || WEAPON_COMBAT_STATS.assalto;
    if (stats.recoilRecoveryRate > 0) {
        const decay = Math.exp(-stats.recoilRecoveryRate * delta);
        recoilCamPitch *= decay;
        recoilCamYaw *= decay;
        if (Math.abs(recoilCamPitch) < 1e-6) recoilCamPitch = 0;
        if (Math.abs(recoilCamYaw) < 1e-6) recoilCamYaw = 0;
    } else {
        recoilCamPitch = 0;
        recoilCamYaw = 0;
    }

    // Screen shake decay and sinusoidal perturbation
    shakeTrauma = Math.max(0, shakeTrauma - 3.0 * delta);
    shakeTime += delta;

    const shakeIntensity = shakeTrauma * shakeTrauma;
    const shakePitch = shakeIntensity * 0.018 * Math.sin(45.0 * shakeTime + 1.2);
    const shakeYaw = shakeIntensity * 0.014 * Math.sin(52.0 * shakeTime + 3.7);
    const shakeRoll = shakeIntensity * 0.020 * Math.sin(38.0 * shakeTime + 5.1);

    // Compose camera orientation
    yaw = inputState.yaw + recoilCamYaw + shakeYaw;
    pitch = inputState.pitch + recoilCamPitch + shakePitch;

    const clampedPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
    const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_VECTOR, yaw);
    const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_VECTOR, clampedPitch);
    camera.quaternion.multiplyQuaternions(qYaw, qPitch);
    if (shakeIntensity > 1e-5) {
        const qRoll = new THREE.Quaternion().setFromAxisAngle(FORWARD_VECTOR, shakeRoll);
        camera.quaternion.multiply(qRoll);
    }
}

let frames = 0;
let lastFpsTime = performance.now();

function animate(timestamp?: number) {
    requestAnimationFrame(animate);
    clock.update(timestamp);
    const delta = Math.min(clock.getDelta(), 0.1);

    if (isGameRunning) {
        // Continuous firing cadence limiter
        if (shotCooldown > 0) {
            shotCooldown -= delta;
            if (shotCooldown < 0) shotCooldown = 0;
        }

        // Update 3D Shield VFX lifecycle (pulse and deterministic 10s disposal)
        shieldVfxController.update(delta);

        if (player.isAlive) {
            // Keep local shield anchor centered on player
            localShieldAnchor.position.set(
                player.position.x,
                player.position.y - player.height + 0.9,
                player.position.z
            );

            // Update invulnerability shield countdown
            const now = performance.now();
            if (player.shieldExpiresAt > now) {
                player.isInvulnerable = true;
                const remainingSec = (player.shieldExpiresAt - now) / 1000.0;
                healthHud.updateShield(remainingSec);
            } else if (player.isInvulnerable) {
                player.isInvulnerable = false;
                healthHud.updateShield(0);
                shieldVfxController.detachShield(localShieldAnchor);
            }

            if (inputState.fire && shotCooldown <= 1e-4 && document.pointerLockElement === document.body && DOM.mainMenu.classList.contains('hidden') && !isMapOpen) {
                fireWeapon();
            }

            updatePhysics(delta);
            updateViewmodel(delta);
        } else {
            // Player is dead: manage 5s death phase and static spectator camera
            player.deathTimer = Math.max(0, player.deathTimer - delta);
            healthHud.updateDeathCountdown(player.deathTimer);

            if (camera) {
                camera.position.copy(deathCameraPos);
                camera.rotation.set(deathCameraPitch, deathCameraYaw, 0, 'YXZ');
            }

            if (player.deathTimer <= 0) {
                handleLocalPlayerRespawn();
            }
        }

        updateChunks(player.position); 
        vfxManager.update(delta);

        // Smoothly interpolate remote player transforms using snapshot buffer
        const renderTime = performance.now() - 90;
        for (const remote of remotePlayers.values()) {
            if (remote.interpolator) {
                const state = remote.interpolator.sample(renderTime);
                if (state) {
                    remote.group.position.set(state.x, state.y, state.z);
                    remote.group.rotation.y = state.yaw;

                    if (state.stateFlags !== undefined) {
                        const isAlive = (state.stateFlags & STATE_FLAGS.ALIVE) !== 0;
                        const isShielded = (state.stateFlags & STATE_FLAGS.SHIELD_ACTIVE) !== 0;
                        remote.group.visible = isAlive;

                        if (isAlive && isShielded) {
                            if (!shieldVfxController.hasShield(remote.group)) {
                                const durationSec = (state.timerRemainingMs ?? 10000) / 1000.0;
                                shieldVfxController.attachShield(remote.group, Math.max(0.1, durationSec));
                            }
                        } else {
                            if (shieldVfxController.hasShield(remote.group)) {
                                shieldVfxController.detachShield(remote.group);
                            }
                        }
                    }
                }
            }
        }

        // Keep local host player state synchronized if host is running locally
        if (activeP2PHost) {
            activeP2PHost.updateHostPlayerState({
                position: { x: player.position.x, y: player.position.y, z: player.position.z },
                yaw: inputState.yaw,
                pitch: inputState.pitch,
                activeWeapon: currentWeaponIndex,
            });
        }
    }

    renderer.render(scene, camera);
    
    frames++;
    if (performance.now() - lastFpsTime >= 1000) {
        DOM.fpsCounter.textContent = frames.toString();
        frames = 0;
        lastFpsTime = performance.now();
    }
}



export function bindP2PClientNetworking(client: P2PClient): void {
    setActiveP2PClient(client);

    // Connect local player state to 30 Hz binary transmission
    client.setStateProvider(() => ({
        position: {
            x: player.position.x,
            y: player.position.y,
            z: player.position.z,
        },
        yaw: inputState.yaw,
        pitch: inputState.pitch,
        activeWeapon: currentWeaponIndex,
        flags:
            (player.isGrounded ? 0x01 : 0) |
            (inputState.ctrl ? 0x02 : 0) |
            (inputState.shift ? 0x04 : 0) |
            (inputState.fire ? 0x08 : 0),
    }));
    client.startStateTick(30);

    // Ingest authoritative World Snapshots from Host
    const prevOnSnapshot = client.config.onWorldSnapshot;
    client.config.onWorldSnapshot = (snapshot: WorldSnapshotData) => {
        prevOnSnapshot?.(snapshot);
        const mySlot = client.playerSlot;

        for (const p of snapshot.players) {
            const isAlive = (p.flags & STATE_FLAGS.ALIVE) !== 0;
            const isShielded = (p.flags & STATE_FLAGS.SHIELD_ACTIVE) !== 0;

            if (mySlot !== null && p.slot === mySlot) {
                // Authoritative state for local player from Host
                if (!isAlive && player.isAlive) {
                    handleLocalPlayerDeath();
                } else if (isAlive && !player.isAlive) {
                    handleLocalPlayerRespawn();
                }

                player.hp = p.hp;
                healthHud.updateHealth(player.hp, player.maxHp);

                if (isShielded) {
                    player.isInvulnerable = true;
                    player.shieldExpiresAt = performance.now() + p.timerRemainingMs;
                    if (!shieldVfxController.hasShield(localShieldAnchor)) {
                        shieldVfxController.attachShield(localShieldAnchor, Math.max(0.1, p.timerRemainingMs / 1000.0));
                    }
                }
                continue;
            }

            const playerId = client.slotToPlayerId.get(p.slot) || `peer_slot_${p.slot}`;
            let remote = remotePlayers.get(playerId);
            if (!remote) {
                const info = client.sessionPlayers.find((sp) => sp.id === playerId);
                const color = info?.color || '#00F0FF';
                remote = addOrUpdateRemotePlayer(
                    playerId,
                    p.x,
                    p.y,
                    p.z,
                    p.yaw,
                    color,
                    p.activeWeapon,
                    p.slot
                );
            }

            remote.interpolator.pushSnapshot({
                timestamp: snapshot.hostTimestamp,
                localArrival: performance.now(),
                x: p.x,
                y: p.y,
                z: p.z,
                yaw: p.yaw,
                pitch: p.pitch,
                activeWeapon: p.activeWeapon,
                stateFlags: p.flags,
                health: p.hp,
                timerRemainingMs: p.timerRemainingMs,
            });

            remote.group.visible = isAlive;
            if (isAlive && isShielded) {
                if (!shieldVfxController.hasShield(remote.group)) {
                    shieldVfxController.attachShield(remote.group, Math.max(0.1, p.timerRemainingMs / 1000.0));
                }
            } else {
                if (shieldVfxController.hasShield(remote.group)) {
                    shieldVfxController.detachShield(remote.group);
                }
            }
        }
    };

    const prevOnHitConfirmed = client.config.onHitConfirmed;
    client.config.onHitConfirmed = (hit: HitConfirmedData) => {
        prevOnHitConfirmed?.(hit);
        const mySlot = client.playerSlot;
        if (mySlot !== null && hit.victimSlot === mySlot) {
            handleLocalPlayerDamage(hit.newHp);
        }
    };

    const prevOnHitscan = client.config.onHitscanFired;
    client.config.onHitscanFired = (msg: FireHitscanMessage) => {
        prevOnHitscan?.(msg);
        handleRemoteHitscan(msg);
    };

    const prevOnBinaryHitscan = client.config.onBinaryHitscanFired;
    client.config.onBinaryHitscanFired = (shot: FireHitscanData) => {
        prevOnBinaryHitscan?.(shot);
        const shooterId = client.slotToPlayerId.get(shot.shooterSlot) || `peer_slot_${shot.shooterSlot}`;
        handleRemoteHitscan({
            type: 'FIRE_HITSCAN',
            shooterId,
            weaponType: shot.weaponType,
            origin: shot.origin,
            direction: shot.direction,
        });
    };
}

export function bindP2PHostNetworking(host: P2PHost): void {
    setActiveP2PHost(host);
    host.startSnapshotTick(30);

    const prevHostHitConfirmed = host.options.onHitConfirmed;
    host.options.onHitConfirmed = (hit: HitConfirmationEvent) => {
        prevHostHitConfirmed?.(hit);
        if (hit.victimId === host.hostPlayer.id) {
            handleLocalPlayerDamage(hit.newHp);
        }
    };

    const prevHostRespawn = host.options.onPlayerRespawned;
    host.options.onPlayerRespawned = (playerId: string) => {
        prevHostRespawn?.(playerId);
        if (playerId === host.hostPlayer.id) {
            handleLocalPlayerRespawn();
        }
    };
}

// Global API exposure for testing, UI, and networking integration
(window as any).goneGame = {
    switchWeapon,
    fireWeapon,
    getActiveWeapon: () => currentWeaponType,
    getActiveWeaponIndex: () => currentWeaponIndex,
    addOrUpdateRemotePlayer,
    removeRemotePlayer,
    remotePlayers,
    viewmodelRoot,
    recoilContainer,
    player,
    healthHud,
    shieldVfxController,
    localShieldAnchor,
    handleLocalPlayerDeath,
    handleLocalPlayerRespawn,
    handleLocalPlayerDamage,
    getLocalPlayerColor: () => localPlayerColor,
    setLocalPlayerColor: (hex: string) => {
        setLocalPlayerColor(hex);
        player.color = hex;
        if (localRobotPreview && localRobotPreview.visible) {
            applyFluoColor(localRobotPreview, hex);
        }
        if (activeP2PClient) {
            activeP2PClient.proposedColor = hex;
        }
    },
    getLocalRobotPreview: () => localRobotPreview,
    setLocalRobotPreview: (preview: THREE.Group | null) => {
        setLocalRobotPreview(preview);
    },
    getP2PClient: () => activeP2PClient,
    setP2PClient: (client: P2PClient | null) => {
        setActiveP2PClient(client);
        if (client) {
            bindP2PClientNetworking(client);
        }
    },
    getP2PHost: () => activeP2PHost,
    setP2PHost: (host: P2PHost | null) => {
        setActiveP2PHost(host);
        if (host) {
            bindP2PHostNetworking(host);
        }
    },
    bindP2PClientNetworking,
    bindP2PHostNetworking,
    handleRemoteHitscan,
    vfxManager,
    soundSynth,
    getBaseAim: () => ({ yaw: inputState.yaw, pitch: inputState.pitch }),
    setBaseAim: (y: number, p: number) => { inputState.yaw = y; inputState.pitch = p; },
    getRecoilCam: () => ({ pitch: recoilCamPitch, yaw: recoilCamYaw }),
    getShakeTrauma: () => shakeTrauma,
    getShotCooldown: () => shotCooldown,
    isShooting: () => inputState.fire,
    getRecoilShakeState,
    keys: inputState,
    clock,
};








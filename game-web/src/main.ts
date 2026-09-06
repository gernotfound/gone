import './style.css'
import * as THREE from 'three';
import init, { generate_chunk, get_height_at } from '../pkg/game_core.js';
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
} from './models/index.ts';
import { P2PClient } from './net/p2pClient.ts';
import { type FireHitscanMessage } from './net/protocol.ts';
import { soundSynth } from './audio/index.ts';
import { vfxManager } from './vfx/index.ts';

// --- MENU LOGIC ---
const bgMusic = document.getElementById('bg-music') as HTMLAudioElement;
const mainMenu = document.getElementById('main-menu') as HTMLElement;
const settingsMenu = document.getElementById('settings-menu') as HTMLElement;
const gameUi = document.getElementById('game-ui') as HTMLElement;
const gameCanvas = document.getElementById('game-canvas') as HTMLCanvasElement;
const btnEnter = document.getElementById('btn-enter') as HTMLButtonElement;
const btnMusicToggle = document.getElementById('btn-music-toggle') as HTMLButtonElement;
const musicStatus = document.getElementById('music-status') as HTMLElement;
const btnSettings = document.getElementById('btn-settings') as HTMLButtonElement;
const btnExit = document.getElementById('btn-exit') as HTMLButtonElement;
const btnBack = document.getElementById('btn-back') as HTMLButtonElement;
const volMaster = document.getElementById('vol-master') as HTMLInputElement;
const volMusic = document.getElementById('vol-music') as HTMLInputElement;
const volSfx = document.getElementById('vol-sfx') as HTMLInputElement;
const valMaster = document.getElementById('val-master') as HTMLElement;
const valMusic = document.getElementById('val-music') as HTMLElement;
const valSfx = document.getElementById('val-sfx') as HTMLElement;
const fpsCounter = document.getElementById('fps-counter')!;
const netDot = document.getElementById('net-dot') as HTMLElement;
const netText = document.getElementById('net-text') as HTMLElement;

function updateNetworkStatus() {
    if (!navigator.onLine) {
        netDot.className = 'w-2 h-2 rounded-full bg-red-500 shadow-[0_0_5px_rgba(239,68,68,0.8)]';
        netText.textContent = 'OFFLINE';
        netText.className = 'text-xs font-bold text-red-400 uppercase tracking-wider';
        return;
    }

    // Se l'API Connection è disponibile, verifichiamo la latenza/banda
    const conn = (navigator as any).connection;
    if (conn) {
        if (conn.saveData || conn.effectiveType === '2g' || conn.rtt > 300) {
            netDot.className = 'w-2 h-2 rounded-full bg-yellow-500 shadow-[0_0_5px_rgba(234,179,8,0.8)]';
            netText.textContent = 'LENTA';
            netText.className = 'text-xs font-bold text-yellow-400 uppercase tracking-wider';
            return;
        }
    }

    netDot.className = 'w-2 h-2 rounded-full bg-emerald-500 shadow-[0_0_5px_rgba(16,185,129,0.8)]';
    netText.textContent = 'ONLINE';
    netText.className = 'text-xs font-bold text-emerald-400 uppercase tracking-wider';
}

window.addEventListener('online', updateNetworkStatus);
window.addEventListener('offline', updateNetworkStatus);
if ((navigator as any).connection) {
    (navigator as any).connection.addEventListener('change', updateNetworkStatus);
}
// Init subito
updateNetworkStatus();

let isMusicPlaying = false;
let volumes = { master: 1.0, music: 1.0, sfx: 1.0 };
bgMusic.volume = (volumes.master * volumes.music) * 0.5;
soundSynth.setMasterVolume(volumes.master);
soundSynth.setSfxVolume(volumes.sfx);

btnMusicToggle.addEventListener('click', () => {
    if (musicStatus.textContent === 'ON') {
        bgMusic.pause();
        isMusicPlaying = false;
        musicStatus.textContent = 'OFF';
        musicStatus.className = 'text-red-400';
        soundSynth.setMasterVolume(0);
    } else {
        bgMusic.play().catch(e => console.error(e));
        isMusicPlaying = true;
        musicStatus.textContent = 'ON';
        musicStatus.className = 'text-emerald-400';
        soundSynth.setMasterVolume(volumes.master);
    }
});

btnSettings.addEventListener('click', () => {
    mainMenu.classList.add('hidden');
    settingsMenu.classList.remove('hidden');
    settingsMenu.classList.add('flex');
});

btnBack.addEventListener('click', () => {
    settingsMenu.classList.remove('flex');
    settingsMenu.classList.add('hidden');
    mainMenu.classList.remove('hidden');
});

function updateVolumes() {
    valMaster.textContent = `${volMaster.value}%`;
    valMusic.textContent = `${volMusic.value}%`;
    valSfx.textContent = `${volSfx.value}%`;
    volumes.master = parseInt(volMaster.value) / 100;
    volumes.music = parseInt(volMusic.value) / 100;
    volumes.sfx = parseInt(volSfx.value) / 100;
    bgMusic.volume = (volumes.master * volumes.music) * 0.5;
    if (musicStatus.textContent === 'OFF') {
        soundSynth.setMasterVolume(0);
    } else {
        soundSynth.setMasterVolume(volumes.master);
    }
    soundSynth.setSfxVolume(volumes.sfx);
}
volMaster.addEventListener('input', updateVolumes);
volMusic.addEventListener('input', updateVolumes);
volSfx.addEventListener('input', updateVolumes);

// --- CYBERPUNK COLOR PICKER & PLAYER CUSTOMIZATION ---
let localPlayerColor = '#00F0FF';
let localRobotPreview: THREE.Group | null = null;
let activeP2PClient: P2PClient | null = null;

// --- GAME LOGIC ---
let isGameRunning = false;
let scene: THREE.Scene, camera: THREE.PerspectiveCamera, renderer: THREE.WebGLRenderer;
let terrainMaterial: THREE.MeshStandardMaterial, rockGeo: THREE.DodecahedronGeometry, rockMat: THREE.MeshStandardMaterial;
const clock = new THREE.Timer();
const activeChunks = new Map<string, any>();
const CHUNK_SIZE = 400;
const CHUNK_RESOLUTION = 64;
const CHUNK_RADIUS = 2;

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
let baseYaw = 0;
let basePitch = 0;
let recoilCamPitch = 0;
let recoilCamYaw = 0;
let shakeTrauma = 0;
let shakeTime = 0;
let isShooting = false;
let shotCooldown = 0;

// Effective composed camera angles (for backward compatibility & inspection)
let yaw = 0;
let pitch = 0;

export function getRecoilShakeState(): RecoilShakeState {
    return {
        baseYaw,
        basePitch,
        recoilCamPitch,
        recoilCamYaw,
        shakeTrauma,
        isShooting,
        shotCooldown,
    };
}

const keys = { forward: false, backward: false, left: false, right: false, shift: false, ctrl: false };
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
    position: new THREE.Vector3(0, 30, 0),
    isGrounded: false,
    color: localPlayerColor
};

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

function updateWeaponHud(name: string, index: number) {
    let el = document.getElementById('weapon-hud');
    if (!el && gameUi) {
        el = document.createElement('div');
        el.id = 'weapon-hud';
        el.className = 'absolute bottom-6 right-8 flex flex-col items-end pointer-events-none font-mono';
        gameUi.appendChild(el);
    }
    if (el) {
        el.innerHTML = `
            <div class="text-xs text-slate-400 uppercase tracking-widest">[1-5] ARMA SELEZIONATA</div>
            <div class="text-2xl font-black text-cyan-400 tracking-wider uppercase drop-shadow-[0_0_8px_rgba(0,240,255,0.6)]">
                ${index + 1}. ${name}
            </div>
        `;
    }
}

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
            viewmodelCache.set(currentWeaponType, glbVm);
            if (currentWeaponType === WEAPON_TYPES[currentWeaponIndex]) {
                while (recoilContainer.children.length > 0) {
                    recoilContainer.remove(recoilContainer.children[0]);
                }
                recoilContainer.add(glbVm);
            }
        }).catch(() => {});
    }

    const activeVm = viewmodelCache.get(currentWeaponType)!;
    recoilContainer.add(activeVm);

    updateWeaponHud(WEAPON_COMBAT_STATS[currentWeaponType]?.name ?? currentWeaponType, currentWeaponIndex);
}

function fireWeapon(): void {
    if (!isGameRunning || document.pointerLockElement !== document.body || !mainMenu.classList.contains('hidden') || isMapOpen) {
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
    for (const chunkObj of activeChunks.values()) {
        if (chunkObj.mesh) {
            targetObjects.push(chunkObj.mesh);
        }
    }
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

    // P2P Network Synchronization
    if (activeP2PClient && activeP2PClient.status === 'connected') {
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
        const bobSpeed = keys.shift ? 14.0 : 9.0;
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
    color: string;
    weaponType: WeaponModelType;
    group: THREE.Group;
}

export const remotePlayers = new Map<string, RemotePlayerInstance>();

export function addOrUpdateRemotePlayer(
    id: string,
    x: number,
    y: number,
    z: number,
    yawAngle: number,
    fluoColor: string = '#00F0FF',
    weapon: WeaponModelType | number = 'assalto'
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

        entry = {
            id,
            color: fluoColor,
            weaponType: resolvedWeapon,
            group: robot
        };
        remotePlayers.set(id, entry);

        // Async upgrade to GLTF robot
        loadRobotModel('assets/modello.glb', fluoColor).then((glbRobot) => {
            if (remotePlayers.has(id)) {
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
        entry.group.position.set(x, y, z);
        entry.group.rotation.y = yawAngle;

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
    for (const chunkObj of activeChunks.values()) {
        if (chunkObj.mesh) targetObjects.push(chunkObj.mesh);
    }
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

const loadingScreen = document.getElementById('loading-screen') as HTMLDivElement;
const loadingBar = document.getElementById('loading-bar') as HTMLDivElement;
const loadingText = document.getElementById('loading-text') as HTMLDivElement;

async function preLoadGame() {
    loadingScreen.classList.remove('hidden');
    loadingScreen.style.opacity = '1';
    
    const updateProgress = (pct: number, msg: string) => {
        loadingBar.style.width = `${pct}%`;
        loadingText.textContent = `${msg} ${pct}%`;
    };

    try {
        updateProgress(10, 'DOWNLOAD MOTORE WASM...');
        await new Promise(r => setTimeout(r, 200)); 
        
        await init();
        hasInitializedWasm = true;
        updateProgress(50, 'INIZIALIZZAZIONE SHADER THREE.JS...');
        await new Promise(r => setTimeout(r, 200));

        isGameRunning = true;
        initGame(); 
        
        updateProgress(80, 'GENERAZIONE CHUNK PROCEDURALI...');
        await new Promise(r => setTimeout(r, 200));
        
        renderer.compile(scene, camera);
        
        updateProgress(100, 'MONDO PRONTO!');
        await new Promise(r => setTimeout(r, 300));
        
        loadingScreen.style.opacity = '0';
        setTimeout(() => {
            loadingScreen.classList.add('hidden');
            startGameplay();
        }, 500);

    } catch(e) {
        loadingText.textContent = "ERRORE CRITICO CARICAMENTO";
        loadingText.className = "mt-4 text-red-500 font-mono text-sm tracking-widest font-bold";
        console.error(e);
    }
}

function startGameplay() {
    soundSynth.unlock().catch(() => {});
    mainMenu.classList.add('hidden');
    gameUi.classList.remove('hidden');
    gameCanvas.classList.remove('hidden');
    
    if (!isMusicPlaying && musicStatus.textContent !== 'OFF') {
        bgMusic.play().catch(() => {});
        isMusicPlaying = true;
        musicStatus.textContent = 'ON';
        musicStatus.className = 'text-emerald-400';
    }
    
    try {
        const promise = document.body.requestPointerLock();
        if (promise) promise.catch(() => {});
    } catch(e) {}
}

btnEnter.addEventListener('click', async (e) => {
    e.stopPropagation(); // Evita il bubbling al document, che causerebbe un doppio requestPointerLock
    soundSynth.unlock().catch(() => {});
    
    if (!hasInitializedWasm) {
        // Primo avvio: mostra caricamento, carica, poi entra
        preLoadGame();
    } else {
        // Ripresa del gioco dalla pausa (esc)
        startGameplay();
    }
});

let rayGeo: THREE.CylinderGeometry;
let rayMat: THREE.MeshBasicMaterial;

function initGame() {
    clock.connect(document);
    scene = new THREE.Scene();
    
    // Cielo e nebbia perfettamente raccordati alla distanza di rendering.
    // Usiamo uno "slate" medio-scuro per far sì che la nebbia sia visibile (se è nera non si vede!).
    const fogColor = 0x1e293b; // slate-800 (Cielo notturno nebbioso, molto visibile)
    scene.background = new THREE.Color(fogColor);
    
    // Usiamo Fog (lineare) per nascondere precisamente il limite del chunk (molto prima che carichino)
    const fogNear = CHUNK_SIZE * (CHUNK_RADIUS - 1.6); // Es. inizia a sfocare a 160m
    const fogFar = CHUNK_SIZE * (CHUNK_RADIUS - 0.7);  // Es. totalmente opaco a 520m, mentre i chunk sono a 800m
    scene.fog = new THREE.Fog(fogColor, fogNear, fogFar);

    // Setup per i raggi di sole volumetrici (God Rays fake)
    // Usiamo radiusTop = 0 in modo che sia un cono che punta verso la sorgente,
    // eliminando il fastidioso "cerchio piatto" nel cielo.
    rayGeo = new THREE.CylinderGeometry(0, 45, 800, 16, 1, true); // aperte sopra e sotto
    rayGeo.translate(0, 400, 0); // Spostiamo l'origine alla base del raggio
    rayMat = new THREE.MeshBasicMaterial({
        color: 0xfef08a,
        transparent: true,
        opacity: 0.04,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
        fog: true
    });
    
    rayMat.onBeforeCompile = (shader) => {
        shader.fragmentShader = shader.fragmentShader.replace(
            `#include <fog_fragment>`,
            `
            #ifdef USE_FOG
                #ifdef FOG_EXP2
                    float fogFactor = 1.0 - exp( - fogDensity * fogDensity * vFogDepth * vFogDepth );
                #else
                    float fogFactor = smoothstep( fogNear, fogFar, vFogDepth );
                #endif
                gl_FragColor.rgb = mix( gl_FragColor.rgb, vec3(0.0), fogFactor );
            #endif
            `
        );
    };
    
    bgMusic.volume = (volumes.master * volumes.music) * 0.5;

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.01, 3000);
    camera.userData.currentY = get_height_at(0, 0) + player.eyeHeight + player.floatHeight;

    renderer = new THREE.WebGLRenderer({ canvas: gameCanvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    
    // Luci più dark/cyberpunk per il nuovo cielo scuro
    const hemiLight = new THREE.HemisphereLight(0x0f172a, 0x020617, 1.5);
    scene.add(hemiLight);

    const sunLight = new THREE.DirectionalLight(0x38bdf8, 1.2); // Raggio azzurro neon
    sunLight.position.set(200, 300, -100);
    sunLight.castShadow = true;
    sunLight.shadow.mapSize.width = 2048;
    sunLight.shadow.mapSize.height = 2048;
    sunLight.shadow.camera.near = 10;
    sunLight.shadow.camera.far = 1000;
    const d = 500;
    sunLight.shadow.camera.left = -d;
    sunLight.shadow.camera.right = d;
    sunLight.shadow.camera.top = d;
    sunLight.shadow.camera.bottom = -d;
    scene.add(sunLight);

    terrainMaterial = new THREE.MeshStandardMaterial({
        color: 0xffffff,
        roughness: 0.9,
        metalness: 0.1,
        vertexColors: true
    });

    rockGeo = new THREE.DodecahedronGeometry(1, 0);
    rockMat = new THREE.MeshStandardMaterial({
        color: 0x1e293b, 
        roughness: 0.9,
        metalness: 0.1
    });

    player.position.set(0, get_height_at(0, 0) + player.height + player.floatHeight + 2.0, 0);

    // Attach camera to scene and viewmodel to camera
    scene.add(camera);
    camera.add(viewmodelRoot);
    switchWeapon(0);

    // Initialize VFX Coordinator
    vfxManager.init(scene, camera);

    setupInput();
    window.addEventListener('resize', () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    });

    animate();
}

function updateChunks() {
    let px = Math.floor(player.position.x / CHUNK_SIZE);
    let pz = Math.floor(player.position.z / CHUNK_SIZE);
    
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

                const mesh = new THREE.Mesh(geometry, terrainMaterial);
                mesh.position.set(offsetX, 0, offsetZ);
                mesh.receiveShadow = true;
                mesh.castShadow = true;
                
                if (rocks.length > 0) {
                    const rockCount = rocks.length / 9; 
                    const instancedRocks = new THREE.InstancedMesh(rockGeo, rockMat, rockCount);
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
                        const ray = new THREE.Mesh(rayGeo, rayMat);
                        const rX = ((seededRandom(chunkSeed + r * 2.1) - 0.5) * CHUNK_SIZE);
                        const rZ = ((seededRandom(chunkSeed + r * 3.7) - 0.5) * CHUNK_SIZE);
                        ray.position.set(rX, -50, rZ); 
                        ray.quaternion.copy(quaternion);
                        mesh.add(ray);
                    }
                }

                scene.add(mesh);
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
                scene.remove(chunkObj.mesh);
                chunkObj.mesh.geometry.dispose();
                chunkObj.mesh.children.forEach((child: any) => {
                    if (child.isInstancedMesh) child.dispose();
                });
            }
            activeChunks.delete(id);
        }
    }
}

const mapUi = document.getElementById('map-ui') as HTMLDivElement;
const minimapCanvas = document.getElementById('minimap-canvas') as HTMLCanvasElement;
const minimapCtx = minimapCanvas.getContext('2d')!;
let isMapOpen = false;

function resetInputState(): void {
    keys.forward = false;
    keys.backward = false;
    keys.left = false;
    keys.right = false;
    keys.shift = false;
    keys.ctrl = false;
    isShooting = false;
}

function setupInput() {
    document.addEventListener('mousemove', (e) => {
        if (document.pointerLockElement !== document.body) return;
        const sensitivity = 0.002;
        baseYaw -= e.movementX * sensitivity;
        basePitch -= e.movementY * sensitivity;
        basePitch = Math.max(-Math.PI / 2 + 0.05, Math.min(Math.PI / 2 - 0.05, basePitch));
    });

    window.addEventListener('keydown', (e) => handleKey(e, true));
    window.addEventListener('keyup', (e) => handleKey(e, false));
    
    // Fire weapon on left click when in pointer lock
    window.addEventListener('mousedown', (e) => {
        soundSynth.unlock().catch(() => {});
        if (e.button === 0 && document.pointerLockElement === document.body && mainMenu.classList.contains('hidden') && !isMapOpen) {
            isShooting = true;
            if (shotCooldown <= 1e-4) {
                fireWeapon();
            }
        }
    });

    window.addEventListener('mouseup', (e) => {
        if (e.button === 0) {
            isShooting = false;
        }
    });

    // Reset input state when window loses focus to prevent stuck keys
    window.addEventListener('blur', resetInputState);

    // Unpause on click
    document.addEventListener('click', () => {
        soundSynth.unlock().catch(() => {});
        if(isGameRunning && document.pointerLockElement !== document.body && mainMenu.classList.contains('hidden') && settingsMenu.classList.contains('hidden') && !isMapOpen) {
            document.body.requestPointerLock();
        }
    });

    // Ritorna al menu quando si preme ESC (esce dal pointer lock), ma non se la mappa è aperta
    document.addEventListener('pointerlockchange', () => {
        if (document.pointerLockElement === document.body) {
            soundSynth.unlock().catch(() => {});
        }
        if (document.pointerLockElement === null) {
            resetInputState();
            if (isGameRunning && !isMapOpen) {
                mainMenu.classList.remove('hidden');
                gameUi.classList.add('hidden');
                btnEnter.textContent = "RIPRENDI";
                btnEnter.disabled = false;
                btnExit.classList.remove('hidden');
            }
        }
    });

    btnExit.addEventListener('click', () => {
        location.reload();
    });
}

function handleKey(e: KeyboardEvent, isDown: boolean) {
    switch (e.code) {
        case 'KeyW':
        case 'ArrowUp':
            keys.forward = isDown;
            break;
        case 'KeyS':
        case 'ArrowDown':
            keys.backward = isDown;
            break;
        case 'KeyA':
        case 'ArrowLeft':
            keys.left = isDown;
            break;
        case 'KeyD':
        case 'ArrowRight':
            keys.right = isDown;
            break;
        case 'ShiftLeft':
        case 'ShiftRight':
            keys.shift = isDown;
            break;
        case 'ControlLeft':
        case 'ControlRight':
        case 'KeyC':
            keys.ctrl = isDown;
            break;
        case 'KeyM':
            if (isDown && isGameRunning && mainMenu.classList.contains('hidden')) {
                isMapOpen = !isMapOpen;
                if (isMapOpen) {
                    mapUi.classList.remove('hidden');
                    if (document.pointerLockElement === document.body) {
                        document.exitPointerLock();
                    }
                    drawMinimap();
                } else {
                    mapUi.classList.add('hidden');
                    document.body.requestPointerLock();
                }
            }
            break;
        case 'Space':
            if (isDown && player.isGrounded && mainMenu.classList.contains('hidden') && !isMapOpen) {
                player.velocity.y = player.jumpForce;
                player.isGrounded = false;
            }
            break;
        case 'Digit1': if (isDown) switchWeapon(0); break;
        case 'Digit2': if (isDown) switchWeapon(1); break;
        case 'Digit3': if (isDown) switchWeapon(2); break;
        case 'Digit4': if (isDown) switchWeapon(3); break;
        case 'Digit5': if (isDown) switchWeapon(4); break;
    }
}

function updatePhysics(delta: number) {
    moveDirection.set(0, 0, 0);
    if (keys.forward) moveDirection.z -= 1;
    if (keys.backward) moveDirection.z += 1;
    if (keys.left) moveDirection.x -= 1;
    if (keys.right) moveDirection.x += 1;
    if (moveDirection.lengthSq() > 0) {
        moveDirection.normalize();
        moveDirection.applyAxisAngle(UP_VECTOR, baseYaw);
    }

    let currentSpeed = player.speed;
    if (keys.shift && !keys.ctrl) {
        currentSpeed = player.speed * player.sprintMultiplier;
    } else if (keys.ctrl) {
        currentSpeed = player.speed * player.crouchMultiplier;
    }

    player.position.x += moveDirection.x * currentSpeed * delta;
    player.position.z += moveDirection.z * currentSpeed * delta;

    // Applichiamo la gravità reale scalata, con limite di velocità terminale per un uomo di 80kg (circa 54 m/s)
    if (!player.isGrounded) {
        player.velocity.y -= (player.gravity * player.gravityScale) * delta;
        // Terminal velocity per 80kg in caduta libera pancia a terra
        if (player.velocity.y < -54.0) player.velocity.y = -54.0; 
    }
    player.position.y += player.velocity.y * delta;

    // Use WASM for terrain height - pseudo capsule collision
    // Campioniamo 5 punti per creare un cilindro di collisione di raggio 1.5
    // Questo impedisce alla visuale di penetrare in muri verticali o forme a "V"
    const r = 1.5;
    const px = player.position.x;
    const pz = player.position.z;
    const hCenter = get_height_at(px, pz);
    const h1 = get_height_at(px + r, pz);
    const h2 = get_height_at(px - r, pz);
    const h3 = get_height_at(px, pz + r);
    const h4 = get_height_at(px, pz - r);
    const maxTerrainHeight = Math.max(hCenter, h1, h2, h3, h4);

    const groundHeight = maxTerrainHeight + player.height + player.floatHeight;

    // Aggiungiamo un margine per lo "snap to ground" per evitare che 
    // scendendo da una rampa il giocatore risulti "in aria" e non possa saltare.
    const groundSnapMargin = 0.5; 
    if (player.position.y <= groundHeight || (player.velocity.y <= 0 && player.position.y - groundHeight < groundSnapMargin)) {
        player.position.y = groundHeight;
        player.velocity.y = 0;
        player.isGrounded = true;
    } else {
        player.isGrounded = false;
    }

    const eyeH = keys.ctrl ? player.crouchEyeHeight : player.eyeHeight;
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
    yaw = baseYaw + recoilCamYaw + shakeYaw;
    pitch = basePitch + recoilCamPitch + shakePitch;

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

        if (isShooting && shotCooldown <= 1e-4 && document.pointerLockElement === document.body && mainMenu.classList.contains('hidden') && !isMapOpen) {
            fireWeapon();
        }

        // In un gioco online, la fisica e la rete non si fermano mai, 
        // nemmeno quando sei nel menu o hai la mappa aperta!
        updatePhysics(delta);
        updateChunks(); 
        updateViewmodel(delta);
        vfxManager.update(delta);
    }

    renderer.render(scene, camera);
    
    frames++;
    if (performance.now() - lastFpsTime >= 1000) {
        fpsCounter.textContent = frames.toString();
        frames = 0;
        lastFpsTime = performance.now();
    }
}

// Disegna la minimappa topografica centrata sul giocatore
function drawMinimap() {
    const width = minimapCanvas.width;
    const height = minimapCanvas.height;
    const imgData = minimapCtx.createImageData(width, height);
    
    // Mappa "globale" estesa (1 pixel = 4 metri, tot 2400x2400 metri)
    const scale = 4;
    
    // Campioniamo a step di 2 per non bloccare troppo a lungo il thread
    for (let py = 0; py < height; py += 2) {
        for (let px = 0; px < width; px += 2) {
            const worldX = player.position.x + (px - width/2) * scale;
            const worldZ = player.position.z + (py - height/2) * scale;
            
            const h = get_height_at(worldX, worldZ);
            
            let r, g, b;
            if (h < -5) {
                r = 15; g = 23; b = 42; 
            } else if (h < 5) {
                r = 30; g = 41; b = 59; 
            } else if (h < 25) {
                r = 51; g = 65; b = 85; 
            } else {
                r = 71; g = 85; b = 105;
            }
            
            for(let dy=0; dy<2; dy++) {
                for(let dx=0; dx<2; dx++) {
                    if (py+dy >= height || px+dx >= width) continue;
                    const idx = ((py+dy) * width + (px+dx)) * 4;
                    imgData.data[idx] = r;
                    imgData.data[idx+1] = g;
                    imgData.data[idx+2] = b;
                    imgData.data[idx+3] = 255;
                }
            }
        }
    }
    minimapCtx.putImageData(imgData, 0, 0);
    
    // Aggiorniamo la rotazione del giocatore (YAW in Three.js è invertito/sfalsato rispetto CSS)
    const playerDot = document.getElementById('player-dot');
    if (playerDot) {
        playerDot.style.transform = `rotate(${-baseYaw}rad)`;
    }
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
    getLocalPlayerColor: () => localPlayerColor,
    setLocalPlayerColor: (hex: string) => {
        localPlayerColor = hex;
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
        localRobotPreview = preview;
    },
    getP2PClient: () => activeP2PClient,
    setP2PClient: (client: P2PClient | null) => {
        activeP2PClient = client;
        if (client) {
            const existingHandler = (client as any).config?.onHitscanFired;
            (client as any).config = {
                ...(client as any).config,
                onHitscanFired: (msg: FireHitscanMessage) => {
                    if (existingHandler) existingHandler(msg);
                    handleRemoteHitscan(msg);
                }
            };
        }
    },
    handleRemoteHitscan,
    vfxManager,
    soundSynth,
    getBaseAim: () => ({ yaw: baseYaw, pitch: basePitch }),
    setBaseAim: (y: number, p: number) => { baseYaw = y; basePitch = p; },
    getRecoilCam: () => ({ pitch: recoilCamPitch, yaw: recoilCamYaw }),
    getShakeTrauma: () => shakeTrauma,
    getShotCooldown: () => shotCooldown,
    isShooting: () => isShooting,
    getRecoilShakeState,
    keys,
    clock,
};


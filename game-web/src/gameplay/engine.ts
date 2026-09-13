import * as THREE from 'three';
import init, { PhysicsInput, step_physics } from '../../pkg/game_core.js';
import { sceneManager } from '../rendering/scene.ts';
import { inputState, initInput, resetInputState } from '../controls/playerInput.ts';
import { updateChunks, getChunkMeshes, getTerrainHeightAt } from '../world/chunkManager.ts';
import {
  type WeaponModelType,
  WEAPON_TYPES,
  WEAPON_MUZZLE_POSITIONS,
  createWeaponViewModel,
  loadWeaponViewModel,
  applyFluoColor,
} from '../models/index.ts';
import type { P2PClient } from '../net/p2pClient.ts';
import type { P2PHost } from '../net/p2pHost.ts';
import type { FireHitscanMessage } from '../net/protocol.ts';
import {
  activeP2PClient,
  activeP2PHost,
  configureSessionRuntimeBridge,
  localPlayerColor,
  multiplayerSessionController,
  setActiveP2PClient,
  setActiveP2PHost,
  setLocalPlayerColor,
} from '../net/multiplayerSessionController.ts';
import { soundSynth } from '../audio/index.ts';
import { vfxManager } from '../vfx/index.ts';
import { healthHud } from '../ui/healthHud.ts';
import { shieldVfxController } from '../vfx/shieldVfx.ts';
import { setupMenu, isMusicPlaying, setIsMusicPlaying, volumes, DOM } from '../ui/menu.ts';
import { localRobotPreview, setLocalRobotPreview } from '../ui/lobby.ts';
import { updateWeaponHud } from '../ui/weaponHud.ts';
import { updateLoadingProgress, showLoadingScreen, hideLoadingScreen, showErrorLoading } from '../ui/loading.ts';
import { initMinimap, drawMinimap } from '../ui/minimap.ts';
import { getWeaponRuntime } from '../weapons/weaponConfig.ts';
import { WEAPON_COMBAT_STATS } from '../weapons/weaponCombatStats.ts';
import { getPlayerSpawnY, getSpawnPointForSlot } from './spawnPolicy.ts';
import { bionicSpiderEnemies } from './bionicSpiderEnemies.ts';
import {
  addOrUpdateRemotePlayer,
  remotePlayers,
  removeRemotePlayer,
  updateRemotePlayerPresentation,
} from './remotePlayerRegistry.ts';
import {
  bindClientGameplayNetworking,
  bindHostGameplayNetworking,
  type GameplayNetworkContext,
} from './networkBindings.ts';
import { presentLegacyRemoteHitscan } from '../net/legacyRemoteShotPresentation.ts';

export { WEAPON_COMBAT_STATS };
export type { WeaponStats } from '../weapons/weaponCombatStats.ts';
export { addOrUpdateRemotePlayer, remotePlayers, removeRemotePlayer };
export type { RemotePlayerInstance } from './remotePlayerRegistry.ts';

// --- APPLICATION / MENU BOOTSTRAP ---
export function bootstrap(): void {
  setupMenu({
    onPlayMultiplayer: async () => {
      multiplayerSessionController.broadcastGameStart();
      DOM.multiplayerLobby.classList.remove('flex');
      DOM.multiplayerLobby.classList.add('hidden');
      if (!hasInitializedGame) void preLoadGame();
      else startGameplay();
    },
    onEnter: async (event: MouseEvent) => {
      event.stopPropagation();
      soundSynth.unlock().catch(() => {});
      if (!hasInitializedGame) void preLoadGame();
      else startGameplay();
    },
    onExit: () => {
      location.reload();
    },
  });
}

let isGameRunning = false;
let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
const clock = new THREE.Timer();

const UP_VECTOR = new THREE.Vector3(0, 1, 0);
const RIGHT_VECTOR = new THREE.Vector3(1, 0, 0);
const FORWARD_VECTOR = new THREE.Vector3(0, 0, 1);
const ZERO_VECTOR = new THREE.Vector3(0, 0, 0);
const moveDirection = new THREE.Vector3();

export interface RecoilShakeState {
  baseYaw: number;
  basePitch: number;
  recoilCamPitch: number;
  recoilCamYaw: number;
  shakeTrauma: number;
  isShooting: boolean;
  shotCooldown: number;
}

let recoilCamPitch = 0;
let recoilCamYaw = 0;
let shakeTrauma = 0;
let shakeTime = 0;
let shotCooldown = 0;
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

const player = {
  height: 2.0,
  eyeHeight: 1.8,
  floatHeight: 0.5,
  speed: 12.0,
  sprintMultiplier: 2.0,
  crouchMultiplier: 0.6,
  crouchEyeHeight: 1.0,
  jumpForce: 25.0,
  gravity: 9.8,
  gravityScale: 5.0,
  mass: 80.0,
  velocity: new THREE.Vector3(),
  position: new THREE.Vector3(1200, 0, 1200),
  isGrounded: false,
  color: localPlayerColor,
  hp: 100,
  maxHp: 100,
  isAlive: true,
  isInvulnerable: true,
  shieldExpiresAt: performance.now() + 10000,
  deathTimer: 0,
};

const localShieldAnchor = new THREE.Group();
localShieldAnchor.name = 'LocalShieldAnchor';
const deathCameraPos = new THREE.Vector3(0, 20, 0);
let deathCameraYaw = 0;
let deathCameraPitch = -0.35;

function localSpawnPoint() {
  if (activeP2PHost) return getSpawnPointForSlot(0);
  const slot = activeP2PClient?.playerSlot;
  return getSpawnPointForSlot(Number.isInteger(slot) ? Number(slot) : 0);
}

function placeLocalPlayerAtSpawn(): void {
  const spawn = localSpawnPoint();
  player.position.set(spawn.x, getPlayerSpawnY(player, spawn), spawn.z);
  player.velocity.set(0, 0, 0);
}

export function handleLocalPlayerDeath(): void {
  if (!player.isAlive && player.deathTimer > 0) return;
  player.isAlive = false;
  player.hp = 0;
  player.deathTimer = 5.0;
  player.isInvulnerable = false;
  player.shieldExpiresAt = 0;

  shieldVfxController.detachShield(localShieldAnchor);
  healthHud.updateShield(0);
  resetInputState();
  viewmodelRoot.visible = false;

  deathCameraPos.set(player.position.x, player.position.y + 2.5, player.position.z);
  deathCameraYaw = inputState.yaw;
  deathCameraPitch = -0.35;
  healthHud.showDeathOverlay(5.0);
}

export function handleLocalPlayerRespawn(): void {
  player.isAlive = true;
  player.hp = 100;
  player.deathTimer = 0;
  player.isInvulnerable = true;
  player.shieldExpiresAt = performance.now() + 10000;
  placeLocalPlayerAtSpawn();

  viewmodelRoot.visible = true;
  inputState.pitch = 0;
  recoilCamPitch = 0;
  recoilCamYaw = 0;

  healthHud.hideDeathOverlay();
  healthHud.updateHealth(100, 100);
  shieldVfxController.attachShield(localShieldAnchor, 10.0, ZERO_VECTOR);
  healthHud.updateShield(10.0);
}

export function handleLocalPlayerDamage(newHp: number): void {
  if (!player.isAlive) return;
  player.hp = Math.max(0, newHp);
  healthHud.updateHealth(player.hp, player.maxHp);
  if (player.hp <= 0) handleLocalPlayerDeath();
}

// --- LOCAL WEAPON / VIEWMODEL ---
let currentWeaponIndex = 0;
let currentWeaponType: WeaponModelType = 'assalto';
const viewmodelRoot = new THREE.Group();
viewmodelRoot.name = 'ViewmodelRoot';
const recoilContainer = new THREE.Group();
recoilContainer.name = 'RecoilContainer';
viewmodelRoot.add(recoilContainer);

const viewmodelCache = new Map<WeaponModelType, THREE.Group>();
const recoilOffset = new THREE.Vector3();
const recoilRotation = new THREE.Euler();
let walkBobTimer = 0;
let switchAnimationTimer = 0;

async function switchWeapon(index: number): Promise<void> {
  if (index < 0 || index >= WEAPON_TYPES.length) return;
  if (index === currentWeaponIndex && recoilContainer.children.length > 0) return;

  currentWeaponIndex = index;
  currentWeaponType = WEAPON_TYPES[index];
  while (recoilContainer.children.length > 0) recoilContainer.remove(recoilContainer.children[0]);

  switchAnimationTimer = 0.15;
  shotCooldown = Math.max(shotCooldown, 0.15);
  if (currentWeaponType === 'coltello') {
    recoilCamPitch = 0;
    recoilCamYaw = 0;
  }
  recoilContainer.position.y = -0.12;

  if (!viewmodelCache.has(currentWeaponType)) {
    const requestedWeapon = currentWeaponType;
    const procedural = createWeaponViewModel(requestedWeapon);
    viewmodelCache.set(requestedWeapon, procedural);

    loadWeaponViewModel(requestedWeapon).then((loaded) => {
      const previous = viewmodelCache.get(requestedWeapon);
      viewmodelCache.set(requestedWeapon, loaded);
      if (currentWeaponType === requestedWeapon) {
        while (recoilContainer.children.length > 0) recoilContainer.remove(recoilContainer.children[0]);
        recoilContainer.add(loaded);
      }
      if (previous && previous !== loaded) sceneManager.disposeHierarchy(previous);
    }).catch(() => {});
  }

  recoilContainer.add(viewmodelCache.get(currentWeaponType)!);
  updateWeaponHud(WEAPON_COMBAT_STATS[currentWeaponType].name, currentWeaponIndex);
}

function fireWeapon(): void {
  if (
    !isGameRunning ||
    !player.isAlive ||
    document.pointerLockElement !== document.body ||
    !DOM.mainMenu.classList.contains('hidden') ||
    isMapOpen ||
    shotCooldown > 1e-4
  ) return;

  const stats = WEAPON_COMBAT_STATS[currentWeaponType];
  const runtime = getWeaponRuntime(currentWeaponType);
  shotCooldown = 1 / stats.fireRateRps;

  recoilOffset.z += stats.kickZ;
  recoilRotation.x += stats.kickPitch;
  recoilRotation.y += (Math.random() - 0.5) * 0.01;
  recoilCamPitch += (stats.recoilPitchDeg * Math.PI) / 180;
  recoilCamYaw += (Math.random() - 0.5) * 2 * ((stats.recoilYawDeg * Math.PI) / 180);
  shakeTrauma = Math.min(1, shakeTrauma + (stats.recoilPitchDeg / 5.5) * 0.35);
  soundSynth.playWeaponSound(currentWeaponType, 1.0);

  const muzzleWorldPos = new THREE.Vector3();
  const activeViewmodel = recoilContainer.children[0] as THREE.Group | undefined;
  const innerViewmodel = activeViewmodel?.children.length
    ? activeViewmodel.children[0] as THREE.Object3D
    : activeViewmodel;

  if (innerViewmodel) {
    camera.updateMatrixWorld(true);
    viewmodelRoot.updateMatrixWorld(true);
    innerViewmodel.updateMatrixWorld(true);
    const localMuzzle = WEAPON_MUZZLE_POSITIONS[currentWeaponType] ?? new THREE.Vector3(3.2, 0.1, 0);
    muzzleWorldPos.copy(localMuzzle).applyMatrix4(innerViewmodel.matrixWorld);
  } else {
    muzzleWorldPos.copy(camera.position).add(
      new THREE.Vector3(0.3, -0.25, -0.8).applyQuaternion(camera.quaternion),
    );
  }

  if (!vfxManager.spawnLocalMuzzleFlash(currentWeaponType)) {
    vfxManager.spawnMuzzleFlash(muzzleWorldPos, currentWeaponType);
  }

  const rayOrigin = camera.position.clone();
  const rayDirection = new THREE.Vector3();
  camera.getWorldDirection(rayDirection);
  const raycaster = new THREE.Raycaster(rayOrigin, rayDirection, 0, runtime.maxRange);

  const targets: THREE.Object3D[] = [...getChunkMeshes()];
  for (const remote of remotePlayers.values()) targets.push(remote.group);
  for (const enemyTarget of bionicSpiderEnemies.getRaycastTargets()) targets.push(enemyTarget);

  const intersections = raycaster.intersectObjects(targets, true);
  const hitPoint = new THREE.Vector3();
  let hitNormal: THREE.Vector3 | null = null;
  if (intersections.length > 0) {
    const hit = intersections[0];
    hitPoint.copy(hit.point);
    hitNormal = hit.face
      ? hit.face.normal.clone().transformDirection(hit.object.matrixWorld)
      : rayDirection.clone().negate();
    bionicSpiderEnemies.applyRaycastHit(hit, stats.id, rayDirection);
  } else {
    hitPoint.copy(rayOrigin).addScaledVector(rayDirection, Math.min(runtime.maxRange, 300));
  }

  vfxManager.spawnTracer(muzzleWorldPos, hitPoint, currentWeaponType);
  if (hitNormal) vfxManager.spawnImpact(hitPoint, hitNormal, currentWeaponType);

  if (activeP2PHost) {
    activeP2PHost.fireHitscan(
      activeP2PHost.hostPlayer.id,
      stats.id,
      [rayOrigin.x, rayOrigin.y, rayOrigin.z],
      [rayDirection.x, rayDirection.y, rayDirection.z],
    );
  } else if (activeP2PClient?.status === 'connected') {
    activeP2PClient.fireHitscan(
      stats.id,
      [rayOrigin.x, rayOrigin.y, rayOrigin.z],
      [rayDirection.x, rayDirection.y, rayDirection.z],
    );
  }
}

function updateViewmodel(delta: number): void {
  recoilOffset.lerp(ZERO_VECTOR, Math.min(1, 18 * delta));
  recoilRotation.x = THREE.MathUtils.lerp(recoilRotation.x, 0, Math.min(1, 15 * delta));
  recoilRotation.y = THREE.MathUtils.lerp(recoilRotation.y, 0, Math.min(1, 15 * delta));
  recoilRotation.z = THREE.MathUtils.lerp(recoilRotation.z, 0, Math.min(1, 15 * delta));

  if (switchAnimationTimer > 0) {
    switchAnimationTimer -= delta;
    recoilContainer.position.y = THREE.MathUtils.lerp(recoilContainer.position.y, 0, Math.min(1, 16 * delta));
  } else {
    recoilContainer.position.y = recoilOffset.y;
  }
  recoilContainer.position.x = recoilOffset.x;
  recoilContainer.position.z = recoilOffset.z;
  recoilContainer.rotation.set(recoilRotation.x, recoilRotation.y, recoilRotation.z);

  if (moveDirection.lengthSq() > 0.01 && player.isGrounded) {
    walkBobTimer += delta * (inputState.shift ? 14 : 9);
    viewmodelRoot.position.set(
      Math.cos(walkBobTimer) * 0.005,
      Math.sin(walkBobTimer * 2) * 0.005,
      0,
    );
  } else {
    viewmodelRoot.position.lerp(ZERO_VECTOR, Math.min(1, 8 * delta));
  }
}

/** Backward-compatible JSON shot presentation. Binary shots use remoteShotPresentation.ts. */
export function handleRemoteHitscan(message: FireHitscanMessage): void {
  presentLegacyRemoteHitscan(message, player.eyeHeight);
}

// --- GAME INITIALIZATION / LOOP ---
let hasInitializedWasm = false;
let hasInitializedGame = false;
let preloadPromise: Promise<void> | null = null;
let renderLoopStarted = false;
let isMapOpen = false;

async function performPreload(): Promise<void> {
  showLoadingScreen();
  try {
    if (!hasInitializedWasm) {
      updateLoadingProgress(10, 'DOWNLOAD MOTORE WASM...');
      await new Promise((resolve) => setTimeout(resolve, 200));
      await init();
      hasInitializedWasm = true;
    }

    updateLoadingProgress(50, 'INIZIALIZZAZIONE SHADER THREE.JS...');
    await new Promise((resolve) => setTimeout(resolve, 200));
    if (!hasInitializedGame) {
      isGameRunning = true;
      initGame();
      hasInitializedGame = true;
    }

    updateLoadingProgress(80, 'GENERAZIONE CHUNK PROCEDURALI...');
    await new Promise((resolve) => setTimeout(resolve, 200));
    renderer.compile(scene, camera);

    updateLoadingProgress(100, 'MONDO PRONTO!');
    await new Promise((resolve) => setTimeout(resolve, 300));
    hideLoadingScreen(startGameplay);
  } catch (error) {
    isGameRunning = hasInitializedGame;
    showErrorLoading(error);
  }
}

function preLoadGame(): Promise<void> {
  if (hasInitializedGame) {
    startGameplay();
    return Promise.resolve();
  }
  if (preloadPromise) return preloadPromise;

  preloadPromise = performPreload().finally(() => {
    preloadPromise = null;
  });
  return preloadPromise;
}

function requestPointerLockSafely(): void {
  try {
    const promise = document.body.requestPointerLock();
    if (promise) promise.catch(() => {});
  } catch {
    // Pointer lock may be denied when the browser has no matching user gesture.
  }
}

function startGameplay(): void {
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

  requestPointerLockSafely();
}

function initGame(): void {
  clock.connect(document);
  sceneManager.init();
  initMinimap();
  scene = sceneManager.scene;
  camera = sceneManager.camera;
  renderer = sceneManager.renderer;

  DOM.bgMusic.volume = volumes.master * volumes.music * 0.5;
  placeLocalPlayerAtSpawn();
  camera.userData.currentY = player.position.y + player.eyeHeight - player.height;

  scene.add(camera);
  camera.add(viewmodelRoot);
  switchWeapon(0);
  vfxManager.init(scene, camera);
  bionicSpiderEnemies.init(scene, getTerrainHeightAt, (damage) => {
    if (!player.isAlive || player.isInvulnerable) return;
    handleLocalPlayerDamage(player.hp - damage);
  });
  healthHud.init();

  localShieldAnchor.position.set(player.position.x, player.position.y - player.height + 0.9, player.position.z);
  scene.add(localShieldAnchor);
  player.isInvulnerable = true;
  player.shieldExpiresAt = performance.now() + 10000;
  shieldVfxController.attachShield(localShieldAnchor, 10.0, ZERO_VECTOR);
  healthHud.updateShield(10.0);
  healthHud.updateHealth(player.hp, player.maxHp);

  initInput({
    onWeaponSwitch: (index) => switchWeapon(index),
    onFire: () => {
      if (
        isGameRunning &&
        player.isAlive &&
        document.pointerLockElement === document.body &&
        DOM.mainMenu.classList.contains('hidden') &&
        !isMapOpen &&
        shotCooldown <= 1e-4
      ) fireWeapon();
    },
    onToggleMap: () => {
      if (!isGameRunning || !DOM.mainMenu.classList.contains('hidden')) return;
      isMapOpen = !isMapOpen;
      if (isMapOpen) {
        DOM.mapUi.classList.remove('hidden');
        if (document.pointerLockElement === document.body) document.exitPointerLock();
        drawMinimap(player.position.x, player.position.z, inputState.yaw, getTerrainHeightAt);
      } else {
        DOM.mapUi.classList.add('hidden');
        requestPointerLockSafely();
      }
    },
    onInteract: () => {
      soundSynth.unlock().catch(() => {});
      if (
        isGameRunning &&
        document.pointerLockElement !== document.body &&
        DOM.mainMenu.classList.contains('hidden') &&
        DOM.settingsMenu.classList.contains('hidden') &&
        !isMapOpen
      ) requestPointerLockSafely();
    },
    onPointerLockLost: () => {
      if (!isGameRunning || isMapOpen) return;
      DOM.mainMenu.classList.remove('hidden');
      DOM.gameUi.classList.add('hidden');
      DOM.btnEnter.textContent = 'RIPRENDI';
      DOM.btnEnter.disabled = false;
      DOM.btnExit.classList.remove('hidden');
      DOM.btnMultiplayer.classList.add('hidden');
    },
    onPointerLockAcquired: () => {
      soundSynth.unlock().catch(() => {});
    },
  });

  window.addEventListener('resize', () => sceneManager.resize(window.innerWidth, window.innerHeight));
  if (!renderLoopStarted) {
    renderLoopStarted = true;
    requestAnimationFrame(animate);
  }
}

function updatePhysics(delta: number): void {
  if (!player.isAlive) return;

  moveDirection.set(0, 0, 0);
  if (inputState.forward) moveDirection.z -= 1;
  if (inputState.backward) moveDirection.z += 1;
  if (inputState.left) moveDirection.x -= 1;
  if (inputState.right) moveDirection.x += 1;
  if (moveDirection.lengthSq() > 0) {
    moveDirection.normalize();
    moveDirection.applyAxisAngle(UP_VECTOR, inputState.yaw);
  }

  const previousX = player.position.x;
  const previousZ = player.position.z;
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
    inputState.jump && DOM.mainMenu.classList.contains('hidden') && !isMapOpen,
    inputState.shift,
    inputState.ctrl,
    delta,
  );
  const state = step_physics(input);
  player.position.set(state.x, state.y, state.z);
  const invDelta = delta > 1e-6 ? 1 / delta : 0;
  player.velocity.x = (state.x - previousX) * invDelta;
  player.velocity.y = state.vel_y;
  player.velocity.z = (state.z - previousZ) * invDelta;
  player.isGrounded = state.is_grounded;
  input.free();
  state.free();

  const eyeHeight = inputState.ctrl ? player.crouchEyeHeight : player.eyeHeight;
  const targetCameraY = player.position.y + eyeHeight - player.height;
  if (camera.userData.currentY === undefined) camera.userData.currentY = targetCameraY;
  const lerpSpeed = player.isGrounded ? 15 : 30;
  camera.userData.currentY += (targetCameraY - camera.userData.currentY) * Math.min(1, lerpSpeed * delta);
  camera.position.set(player.position.x, camera.userData.currentY, player.position.z);

  const stats = WEAPON_COMBAT_STATS[currentWeaponType];
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

  shakeTrauma = Math.max(0, shakeTrauma - 3 * delta);
  shakeTime += delta;
  const shakeIntensity = shakeTrauma * shakeTrauma;
  const shakePitch = shakeIntensity * 0.018 * Math.sin(45 * shakeTime + 1.2);
  const shakeYaw = shakeIntensity * 0.014 * Math.sin(52 * shakeTime + 3.7);
  const shakeRoll = shakeIntensity * 0.020 * Math.sin(38 * shakeTime + 5.1);

  yaw = inputState.yaw + recoilCamYaw + shakeYaw;
  pitch = inputState.pitch + recoilCamPitch + shakePitch;
  const clampedPitch = Math.max(-Math.PI / 2 + 0.01, Math.min(Math.PI / 2 - 0.01, pitch));
  const qYaw = new THREE.Quaternion().setFromAxisAngle(UP_VECTOR, yaw);
  const qPitch = new THREE.Quaternion().setFromAxisAngle(RIGHT_VECTOR, clampedPitch);
  camera.quaternion.multiplyQuaternions(qYaw, qPitch);
  if (shakeIntensity > 1e-5) {
    camera.quaternion.multiply(new THREE.Quaternion().setFromAxisAngle(FORWARD_VECTOR, shakeRoll));
  }
}

let frames = 0;
let lastFpsTime = performance.now();

function animate(timestamp?: number): void {
  requestAnimationFrame(animate);
  clock.update(timestamp);
  const delta = Math.min(clock.getDelta(), 0.1);

  if (isGameRunning) {
    if (shotCooldown > 0) shotCooldown = Math.max(0, shotCooldown - delta);
    shieldVfxController.update(delta);

    if (player.isAlive) {
      localShieldAnchor.position.set(
        player.position.x,
        player.position.y - player.height + 0.9,
        player.position.z,
      );

      const now = performance.now();
      if (player.shieldExpiresAt > now) {
        player.isInvulnerable = true;
        healthHud.updateShield((player.shieldExpiresAt - now) / 1000);
      } else if (player.isInvulnerable) {
        player.isInvulnerable = false;
        healthHud.updateShield(0);
        shieldVfxController.detachShield(localShieldAnchor);
      }

      if (
        inputState.fire &&
        shotCooldown <= 1e-4 &&
        document.pointerLockElement === document.body &&
        DOM.mainMenu.classList.contains('hidden') &&
        !isMapOpen
      ) fireWeapon();

      updatePhysics(delta);
      updateViewmodel(delta);
    } else {
      player.deathTimer = Math.max(0, player.deathTimer - delta);
      healthHud.updateDeathCountdown(player.deathTimer);
      camera.position.copy(deathCameraPos);
      camera.rotation.set(deathCameraPitch, deathCameraYaw, 0, 'YXZ');
      if (player.deathTimer <= 0 && !activeP2PHost && !activeP2PClient) {
        handleLocalPlayerRespawn();
      }
    }

    const enemiesEnabled = !activeP2PHost && !activeP2PClient;
    const enemiesPaused = !DOM.mainMenu.classList.contains('hidden') || isMapOpen;
    bionicSpiderEnemies.update(delta, player.position, player.isAlive, enemiesEnabled, enemiesPaused);

    updateChunks(player.position);
    vfxManager.update(delta);
    updateRemotePlayerPresentation(performance.now() - 90);

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
  frames += 1;
  if (performance.now() - lastFpsTime >= 1000) {
    DOM.fpsCounter.textContent = frames.toString();
    frames = 0;
    lastFpsTime = performance.now();
  }
}

// --- NETWORK BINDINGS ---
function networkContext(): GameplayNetworkContext {
  return {
    player,
    localShieldAnchor,
    getActiveWeaponIndex: () => currentWeaponIndex,
    handleLocalPlayerDeath,
    handleLocalPlayerRespawn,
    handleLocalPlayerDamage,
    localEyeHeight: player.eyeHeight,
  };
}

export function bindP2PClientNetworking(client: P2PClient): void {
  bindClientGameplayNetworking(client, networkContext());
}

export function bindP2PHostNetworking(host: P2PHost): void {
  bindHostGameplayNetworking(host, networkContext());
}

configureSessionRuntimeBridge({
  attachClient: (client) => {
    if (client) bindP2PClientNetworking(client);
    else setActiveP2PClient(null);
  },
  attachHost: (host) => {
    if (host) bindP2PHostNetworking(host);
    else setActiveP2PHost(null);
  },
  clearRemotePlayers: () => {
    for (const playerId of [...remotePlayers.keys()]) removeRemotePlayer(playerId);
  },
  removeRemotePlayer,
  applyLocalColor: (hex) => {
    player.color = hex;
    if (localRobotPreview?.visible) applyFluoColor(localRobotPreview, hex);
    if (activeP2PClient) activeP2PClient.proposedColor = hex;
  },
  gameplayReady: () => !DOM.gameCanvas.classList.contains('hidden'),
});

// Compatibility facade used by focused controllers, networking adapters and smoke tests.
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
  bionicSpiderEnemies,
  healthHud,
  shieldVfxController,
  localShieldAnchor,
  handleLocalPlayerDeath,
  handleLocalPlayerRespawn,
  handleLocalPlayerDamage,
  getLocalPlayerColor: () => localPlayerColor,
  setLocalPlayerColor: (hex: string) => setLocalPlayerColor(hex),
  getLocalRobotPreview: () => localRobotPreview,
  setLocalRobotPreview: (preview: THREE.Group | null) => setLocalRobotPreview(preview),
  getP2PClient: () => activeP2PClient,
  setP2PClient: (client: P2PClient | null) => {
    if (client) bindP2PClientNetworking(client);
    else setActiveP2PClient(null);
  },
  getP2PHost: () => activeP2PHost,
  setP2PHost: (host: P2PHost | null) => {
    if (host) bindP2PHostNetworking(host);
    else setActiveP2PHost(null);
  },
  bindP2PClientNetworking,
  bindP2PHostNetworking,
  handleRemoteHitscan,
  vfxManager,
  soundSynth,
  getBaseAim: () => ({ yaw: inputState.yaw, pitch: inputState.pitch }),
  setBaseAim: (nextYaw: number, nextPitch: number) => {
    inputState.yaw = nextYaw;
    inputState.pitch = nextPitch;
  },
  getRecoilCam: () => ({ pitch: recoilCamPitch, yaw: recoilCamYaw }),
  getShakeTrauma: () => shakeTrauma,
  getShotCooldown: () => shotCooldown,
  isShooting: () => inputState.fire,
  getRecoilShakeState,
  runtimeSnapshot: () => ({
    hasInitializedWasm,
    hasInitializedGame,
    preloadInFlight: Boolean(preloadPromise),
    renderLoopStarted,
    isGameRunning,
  }),
  keys: inputState,
  clock,
};

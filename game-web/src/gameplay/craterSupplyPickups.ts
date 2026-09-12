import * as THREE from 'three';
import { sceneManager } from '../rendering/scene.ts';
import { getTerrainHeightAt } from '../world/chunkManager.ts';
import { TRACER_STYLES } from '../vfx/tracerPool.ts';
import { refillWeaponAmmo } from './advancedWeaponController.ts';
import {
  CRATER_SUPPLY_RADIUS,
  GIANT_CRATER_CENTER_X,
  GIANT_CRATER_CENTER_Z,
} from './spawnPolicy.ts';
import type { WeaponKey } from '../weapons/weaponConfig.ts';
import { HEALTH_PICKUP_AUTHORITY } from '../net/clientStateExtensions.ts';

type AmmoWeapon = Exclude<WeaponKey, 'coltello'>;
type SupplyKind = AmmoWeapon | 'health';

type LocalPlayer = {
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  isAlive: boolean;
  healthPickupRequestUntil?: number;
};

type GoneGameApi = {
  player?: LocalPlayer;
  handleLocalPlayerDamage?: (newHp: number) => void;
  getP2PHost?: () => any;
  getP2PClient?: () => any;
};

type SupplyPickup = {
  kind: SupplyKind;
  group: THREE.Group;
  baseY: number;
  phase: number;
  active: boolean;
  respawnAt: number;
};

const AMMO_KINDS: readonly AmmoWeapon[] = ['assalto', 'cecchino', 'pompa', 'mitraglietta'];
const SUPPLY_KINDS: readonly SupplyKind[] = [...AMMO_KINDS, 'health'];
const MAX_PER_KIND = 3;
const PICKUP_RADIUS = 3.25;
const MIN_RANDOM_RADIUS = 28;
const RESPAWN_MIN_MS = 20_000;
const RESPAWN_MAX_MS = 32_000;
const MIN_PICKUP_SEPARATION = 9;
const HEALTH_COLOR = 0x22c55e;

const crateGeometry = new THREE.BoxGeometry(1.7, 1.18, 1.7);
const stripeGeometry = new THREE.BoxGeometry(1.78, 0.08, 0.24);
const healthBarGeometry = new THREE.BoxGeometry(0.88, 0.10, 0.22);
const materials = new Map<SupplyKind, THREE.MeshStandardMaterial>();
const pickups: SupplyPickup[] = [];
let lastFrameAt = 0;
let lastHealthRequestAt = -Infinity;

function api(): GoneGameApi | null {
  return (window as any).goneGame ?? null;
}

function supplyColor(kind: SupplyKind): number {
  return kind === 'health' ? HEALTH_COLOR : (TRACER_STYLES[kind]?.color ?? 0xffffff);
}

function materialFor(kind: SupplyKind): THREE.MeshStandardMaterial {
  let material = materials.get(kind);
  if (material) return material;
  const color = supplyColor(kind);
  material = new THREE.MeshStandardMaterial({
    color,
    emissive: color,
    emissiveIntensity: 0.85,
    metalness: 0.62,
    roughness: 0.28,
  });
  materials.set(kind, material);
  return material;
}

function createPickup(kind: SupplyKind, index: number): SupplyPickup {
  const group = new THREE.Group();
  group.name = `CraterSupply-${kind}-${index}`;

  const body = new THREE.Mesh(crateGeometry, materialFor(kind));
  body.castShadow = false;
  body.receiveShadow = false;
  group.add(body);

  const stripeMaterial = new THREE.MeshBasicMaterial({ color: 0xf8fafc, toneMapped: false });
  const stripe = new THREE.Mesh(stripeGeometry, stripeMaterial);
  stripe.position.y = 0.63;
  stripe.castShadow = false;
  group.add(stripe);

  if (kind === 'health') {
    const vertical = new THREE.Mesh(healthBarGeometry, stripeMaterial);
    const horizontal = new THREE.Mesh(healthBarGeometry, stripeMaterial);
    vertical.position.set(0, 0.69, 0);
    horizontal.position.set(0, 0.70, 0);
    vertical.rotation.y = Math.PI * 0.5;
    horizontal.scale.x = 0.52;
    vertical.scale.x = 0.52;
    group.add(vertical, horizontal);
  }

  group.userData.supplyKind = kind;
  sceneManager.scene.add(group);
  return {
    kind,
    group,
    baseY: 0,
    phase: Math.random() * Math.PI * 2,
    active: true,
    respawnAt: 0,
  };
}

function randomCraterPoint(): { x: number; z: number } {
  const angle = Math.random() * Math.PI * 2;
  // sqrt gives a spatially uniform distribution over the crater floor.
  const radius = Math.sqrt(Math.random()) * (CRATER_SUPPLY_RADIUS - MIN_RANDOM_RADIUS) + MIN_RANDOM_RADIUS;
  return {
    x: GIANT_CRATER_CENTER_X + Math.cos(angle) * radius,
    z: GIANT_CRATER_CENTER_Z + Math.sin(angle) * radius,
  };
}

function placePickup(pickup: SupplyPickup): void {
  let selected = randomCraterPoint();
  for (let attempt = 0; attempt < 12; attempt += 1) {
    const candidate = randomCraterPoint();
    const crowded = pickups.some((other) => {
      if (other === pickup || !other.active) return false;
      return Math.hypot(candidate.x - other.group.position.x, candidate.z - other.group.position.z) < MIN_PICKUP_SEPARATION;
    });
    selected = candidate;
    if (!crowded) break;
  }

  pickup.baseY = getTerrainHeightAt(selected.x, selected.z) + 0.72;
  pickup.group.position.set(selected.x, pickup.baseY, selected.z);
  pickup.group.rotation.set(0, Math.random() * Math.PI * 2, 0);
  pickup.group.visible = true;
  pickup.active = true;
  pickup.respawnAt = 0;
}

function scheduleRespawn(pickup: SupplyPickup, now: number): void {
  pickup.active = false;
  pickup.group.visible = false;
  pickup.respawnAt = now + RESPAWN_MIN_MS + Math.random() * (RESPAWN_MAX_MS - RESPAWN_MIN_MS);
}

function collectHealth(player: LocalPlayer, now: number): boolean {
  if (!player.isAlive || player.hp >= player.maxHp) return false;
  const game = api();
  if (!game) return false;

  const host = game.getP2PHost?.();
  if (host) {
    const record = host.playerRecords?.get?.(host.hostPlayer?.id);
    if (!record || !record.isAlive || record.hp >= player.maxHp) return false;
    record.hp = player.maxHp;
    game.handleLocalPlayerDamage?.(player.maxHp);
    return true;
  }

  const client = game.getP2PClient?.();
  if (client) {
    if (now - lastHealthRequestAt < HEALTH_PICKUP_AUTHORITY.cooldownMs) return false;
    lastHealthRequestAt = now;
    player.healthPickupRequestUntil = now + 500;
    return true;
  }

  game.handleLocalPlayerDamage?.(player.maxHp);
  return true;
}

function tryCollect(pickup: SupplyPickup, player: LocalPlayer, now: number): boolean {
  if (pickup.kind === 'health') return collectHealth(player, now);
  return refillWeaponAmmo(pickup.kind);
}

function gameplayVisible(): boolean {
  const gameUi = document.getElementById('game-ui');
  return !!gameUi && !gameUi.classList.contains('hidden');
}

function frame(now: number): void {
  const delta = Math.min(0.05, lastFrameAt > 0 ? (now - lastFrameAt) / 1000 : 1 / 60);
  lastFrameAt = now;
  const player = api()?.player;
  const canCollect = !!player?.isAlive && gameplayVisible();

  for (const pickup of pickups) {
    if (!pickup.active) {
      if (now >= pickup.respawnAt) placePickup(pickup);
      continue;
    }

    pickup.phase += delta * 1.45;
    pickup.group.rotation.y += delta * 0.36;
    pickup.group.position.y = pickup.baseY + Math.sin(pickup.phase) * 0.16;

    if (!canCollect || !player) continue;
    const dx = player.position.x - pickup.group.position.x;
    const dy = player.position.y - pickup.group.position.y;
    const dz = player.position.z - pickup.group.position.z;
    if (dx * dx + dz * dz > PICKUP_RADIUS * PICKUP_RADIUS || Math.abs(dy) > 4.5) continue;
    if (tryCollect(pickup, player, now)) scheduleRespawn(pickup, now);
  }

  window.requestAnimationFrame(frame);
}

function attachPoolsWhenSceneReady(): void {
  if (!sceneManager.scene) {
    window.requestAnimationFrame(attachPoolsWhenSceneReady);
    return;
  }

  for (const kind of SUPPLY_KINDS) {
    for (let index = 0; index < MAX_PER_KIND; index += 1) {
      const pickup = createPickup(kind, index);
      pickups.push(pickup);
      placePickup(pickup);
    }
  }
  window.requestAnimationFrame(frame);
}

/** Fixed-size pickup pools guarantee at most three crates per category. */
export function startCraterSupplyPickups(): void {
  if ((window as any).__goneCraterSupplyPickupsStarted) return;
  (window as any).__goneCraterSupplyPickupsStarted = true;
  window.requestAnimationFrame(attachPoolsWhenSceneReady);
}

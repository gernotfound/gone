from pathlib import Path


def read(path: str) -> str:
    return Path(path).read_text(encoding='utf-8')


def write(path: str, text: str) -> None:
    Path(path).write_text(text, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# -----------------------------------------------------------------------------
# P2PHost: nearest-hit authority + native spawn resolver (no repair polling)
# -----------------------------------------------------------------------------
p = 'game-web/src/net/p2pHost.ts'
text = read(p)

text = replace_once(
    text,
    "interface PeerConnectionRecord {\n  channel: IDataChannel;\n  info: SessionPlayerInfo;\n}\n\nexport interface CombatValidationStats",
    "interface PeerConnectionRecord {\n  channel: IDataChannel;\n  info: SessionPlayerInfo;\n}\n\nexport type RespawnPositionResolver = (slot: number) => { x: number; y: number; z: number };\n\nexport interface CombatValidationStats",
    'respawn resolver type',
)

text = replace_once(
    text,
    "  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;\n  private snapshotSeq: number = 0;\n  public readonly __gonePvpHardeningState: CombatValidationStats = createCombatValidationStats();",
    "  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;\n  private snapshotSeq: number = 0;\n  private respawnPositionResolver: RespawnPositionResolver | null = null;\n  private authoritativeRespawnCount = 0;\n  public readonly __gonePvpHardeningState: CombatValidationStats = createCombatValidationStats();",
    'host resolver fields',
)

text = replace_once(
    text,
    "  public allocateSlot(playerId: string): number {",
    "  public setRespawnPositionResolver(resolver: RespawnPositionResolver | null): void {\n    this.respawnPositionResolver = resolver;\n  }\n\n  public getAuthoritativeRespawnCount(): number {\n    return this.authoritativeRespawnCount;\n  }\n\n  private resolveRespawnPosition(slot: number): { x: number; y: number; z: number } {\n    const resolved = this.respawnPositionResolver?.(slot);\n    if (resolved && [resolved.x, resolved.y, resolved.z].every(Number.isFinite)) {\n      return { x: resolved.x, y: resolved.y, z: resolved.z };\n    }\n    // Compatibility fallback for isolated tests/callers that do not install the gameplay resolver.\n    return { x: 0, y: 17.5, z: 0 };\n  }\n\n  public allocateSlot(playerId: string): number {",
    'host resolver methods',
)

old_assignment = "    record.position = { x: 0, y: 17.5, z: 0 };"
assignment_count = text.count(old_assignment)
if assignment_count != 2:
    raise RuntimeError(f'respawn assignments: expected 2, found {assignment_count}')
text = text.replace(old_assignment, "    record.position = this.resolveRespawnPosition(record.slot);")

old_clear_callback = "    this.lagCompensator?.clear_player(record.slot);\n    this.options.onPlayerRespawned?.(record.id);"
clear_count = text.count(old_clear_callback)
if clear_count != 2:
    raise RuntimeError(f'respawn callbacks: expected 2, found {clear_count}')
text = text.replace(
    old_clear_callback,
    "    this.lagCompensator?.clear_player(record.slot);\n    this.authoritativeRespawnCount += 1;\n    this.options.onPlayerRespawned?.(record.id);",
)

method_start = text.index("  private processFireHitscan(shooterId: string, shot: FireHitscanData): void {")
block_start = text.index("    const now = performance.now();", method_start)
block_end = text.index("\n  public fireHitscan(", block_start)

nearest_block = '''    const now = performance.now();
    type CandidateHit = {
      victim: PlayerCombatRecord;
      damage: number;
      isHeadshot: boolean;
      distance: number;
      hitX: number;
      hitY: number;
      hitZ: number;
    };
    let nearestHit: CandidateHit | null = null;

    for (const victim of this.playerRecords.values()) {
      if (victim.id === shooterId || !victim.isAlive) continue;

      let hitConfirmed = false;
      let damage = 0;
      let isHeadshot = false;
      let hitDistance = Number.POSITIVE_INFINITY;
      let hitX = 0, hitY = 0, hitZ = 0;

      if (this.lagCompensator) {
        try {
          const resultJson = this.lagCompensator.validate_rewind_hitscan(
            shooter.slot,
            victim.slot,
            shot.weaponType,
            shot.clientTimestamp,
            1000.0,
            shot.originX,
            shot.originY,
            shot.originZ,
            shot.dirX,
            shot.dirY,
            shot.dirZ,
            getWeaponRuntimeById(shot.weaponType).maxRange
          );
          const res = JSON.parse(resultJson);
          const parsedDistance = Number(res.distance);
          if (res.hit && Number.isFinite(parsedDistance) && parsedDistance >= 0) {
            isHeadshot = !!res.is_headshot;
            hitDistance = parsedDistance;
            const parsedDamage = Number(res.damage);
            damage = Number.isFinite(parsedDamage)
              ? parsedDamage
              : calculateWeaponDamageAtDistance(shot.weaponType, hitDistance, isHeadshot);
            hitConfirmed = damage > 0;
            hitX = shot.originX + shot.dirX * hitDistance;
            hitY = shot.originY + shot.dirY * hitDistance;
            hitZ = shot.originZ + shot.dirZ * hitDistance;
          }
        } catch {
          const fallback = this.checkRayCylinderHit(shot, victim.position);
          if (fallback.hit) {
            hitConfirmed = true;
            damage = fallback.damage;
            isHeadshot = fallback.isHeadshot;
            hitX = fallback.hitX;
            hitY = fallback.hitY;
            hitZ = fallback.hitZ;
            hitDistance = Math.hypot(
              hitX - shot.originX,
              hitY - shot.originY,
              hitZ - shot.originZ,
            );
          }
        }
      } else {
        const fallback = this.checkRayCylinderHit(shot, victim.position);
        if (fallback.hit) {
          hitConfirmed = true;
          damage = fallback.damage;
          isHeadshot = fallback.isHeadshot;
          hitX = fallback.hitX;
          hitY = fallback.hitY;
          hitZ = fallback.hitZ;
          hitDistance = Math.hypot(
            hitX - shot.originX,
            hitY - shot.originY,
            hitZ - shot.originZ,
          );
        }
      }

      if (
        hitConfirmed
        && Number.isFinite(hitDistance)
        && hitDistance >= 0
        && (nearestHit === null || hitDistance < nearestHit.distance)
      ) {
        nearestHit = { victim, damage, isHeadshot, distance: hitDistance, hitX, hitY, hitZ };
      }
    }

    if (!nearestHit) return;

    const { victim, isHeadshot, hitX, hitY, hitZ } = nearestHit;
    let damage = nearestHit.damage;
    let hitFlags = 0;
    if (isHeadshot) hitFlags |= HIT_FLAGS.HEADSHOT;

    if (victim.shieldExpiresAt > now) {
      damage = 0;
      hitFlags |= HIT_FLAGS.SHIELD_BLOCKED;
    } else {
      victim.hp = Math.max(0, victim.hp - damage);
      if (victim.hp === 0) {
        victim.isAlive = false;
        victim.deathTime = now;
        hitFlags |= HIT_FLAGS.FATAL_KILL;
      }
    }

    const hitBuffer = encodeHitConfirmed(
      victim.slot,
      shooter.slot,
      hitFlags,
      Math.round(damage),
      Math.round(victim.hp),
      hitX,
      hitY,
      hitZ
    );
    this.broadcastBinary(hitBuffer);

    const eventData: HitConfirmationEvent = {
      victimId: victim.id,
      shooterId,
      victimSlot: victim.slot,
      shooterSlot: shooter.slot,
      damage,
      newHp: victim.hp,
      isHeadshot,
      isShieldBlocked: (hitFlags & HIT_FLAGS.SHIELD_BLOCKED) !== 0,
      isFatal: (hitFlags & HIT_FLAGS.FATAL_KILL) !== 0,
      hitX,
      hitY,
      hitZ,
    };

    this.options.onHitConfirmed?.(eventData);
  }
'''
text = text[:block_start] + nearest_block + text[block_end:]
write(p, text)

# -----------------------------------------------------------------------------
# Network binding installs the deterministic per-slot spawn resolver explicitly.
# -----------------------------------------------------------------------------
p = 'game-web/src/gameplay/networkBindings.ts'
text = read(p)
text = replace_once(
    text,
    "import { presentLegacyRemoteHitscan } from '../net/legacyRemoteShotPresentation.ts';",
    "import { presentLegacyRemoteHitscan } from '../net/legacyRemoteShotPresentation.ts';\nimport { getPlayerSpawnY, getSpawnPointForSlot } from './spawnPolicy.ts';",
    'network spawn import',
)
text = replace_once(
    text,
    "export function bindHostGameplayNetworking(host: P2PHost, context: GameplayNetworkContext): void {\n  setActiveP2PHost(host);\n  host.startSnapshotTick(30);",
    "export function bindHostGameplayNetworking(host: P2PHost, context: GameplayNetworkContext): void {\n  setActiveP2PHost(host);\n  host.setRespawnPositionResolver((slot) => {\n    const point = getSpawnPointForSlot(slot);\n    return {\n      x: point.x,\n      y: getPlayerSpawnY(undefined, point),\n      z: point.z,\n    };\n  });\n  host.startSnapshotTick(30);",
    'install host spawn resolver',
)
write(p, text)

# -----------------------------------------------------------------------------
# Spawn controller becomes diagnostics/manual teleport only; no host polling.
# -----------------------------------------------------------------------------
p = 'game-web/src/gameplay/spawnController.ts'
write(p, '''import {
  SPAWN_POINTS,
  getPlayerSpawnY,
  getSpawnPointForSlot,
  type SpawnPoint,
} from './spawnPolicy.ts';

export {
  PLAYER_SPAWN_X,
  PLAYER_SPAWN_Z,
  SPAWN_POINTS,
  getPlayerSpawnY,
  getSpawnPointForSlot,
  type SpawnPoint,
} from './spawnPolicy.ts';

let localSpawnCount = 0;
let currentSpawn: SpawnPoint = SPAWN_POINTS[0];

function gameApi(): any {
  return (window as any).goneGame;
}

function localSlot(api: any): number {
  if (api?.getP2PHost?.()) return 0;
  const slot = api?.getP2PClient?.()?.playerSlot;
  return Number.isInteger(slot) ? Number(slot) : 0;
}

/** Manual/debug teleport. Normal initial spawn and respawn are owned by engine/network authority. */
function teleportLocalPlayer(point?: SpawnPoint): SpawnPoint | null {
  const api = gameApi();
  const player = api?.player;
  if (!player?.position) return null;

  const selected = point ?? getSpawnPointForSlot(localSlot(api));
  player.position.set(selected.x, getPlayerSpawnY(player, selected), selected.z);
  player.velocity?.set?.(0, 0, 0);
  currentSpawn = selected;
  localSpawnCount += 1;
  return selected;
}

/** Compatibility diagnostics/manual spawn API. Authoritative respawns are configured directly by networkBindings.ts. */
export function startSpawnController(): void {
  if ((window as any).__goneSpawnControllerStarted) return;
  (window as any).__goneSpawnControllerStarted = true;

  (window as any).goneSpawnPolicy = {
    points: SPAWN_POINTS,
    respawnNow: () => {
      const selected = teleportLocalPlayer();
      return selected ? { ...selected } : null;
    },
    snapshot: () => {
      const api = gameApi();
      return {
        slot: localSlot(api),
        current: { ...currentSpawn },
        localSpawnCount,
        authoritativeRespawns: Number(api?.getP2PHost?.()?.getAuthoritativeRespawnCount?.() ?? 0),
      };
    },
  };
}
''')

# -----------------------------------------------------------------------------
# Docs: ownership must match the now-executed code.
# -----------------------------------------------------------------------------
p = 'AGENTS.md'
text = read(p)
text = text.replace(
    '- `gameplay/spawnController.ts` adapts host authoritative respawn records and exposes diagnostics; it must not reintroduce per-frame corrective teleports.',
    '- `gameplay/networkBindings.ts` installs the host authoritative per-slot respawn resolver; `spawnController.ts` is diagnostics/manual teleport compatibility only and must not poll to repair host state.',
)
text = text.replace(
    '- `net/networkStabilityFix.ts`, `net/pvpTuning.ts`, `net/hostRemoteSync.ts`, and `net/pvpHardening.ts` own stability, clock mapping, host presentation, and shot validation respectively.',
    '- `net/networkStabilityFix.ts`, `net/pvpTuning.ts`, and `net/hostRemoteSync.ts` own stability, clock mapping, and host presentation. Authoritative shot validation belongs directly to `net/p2pHost.ts`; do not reintroduce `pvpHardening.ts` as a runtime patch.',
)
write(p, text)

p = 'ARCHITECTURE.md'
text = read(p)
text = text.replace(
    '- `spawnController.ts`: host-authoritative respawn adapter plus manual diagnostics, not a per-frame corrective teleport;',
    '- `networkBindings.ts`: bridge between P2P callbacks and gameplay state, including installation of the host per-slot respawn resolver;\n- `spawnController.ts`: manual/debug spawn diagnostics compatibility only, with no polling or host-state repair;',
)
write(p, text)

# -----------------------------------------------------------------------------
# Regression coverage: map insertion order must never decide who gets hit.
# -----------------------------------------------------------------------------
test_path = Path('tests/tier1_features/test_pvp_nearest_hit_and_spawn.mjs')
test_path.write_text('''import { assertEqual, assertGreaterThan } from '../helpers/assertions.mjs';
import { P2PHost } from '../../game-web/src/net/p2pHost.ts';

function combatRecord(id, slot, z) {
  return {
    id,
    slot,
    name: id,
    color: '#00F0FF',
    hp: 100,
    isAlive: true,
    deathTime: 0,
    shieldExpiresAt: 0,
    position: { x: 0, y: 17.5, z },
    yaw: 0,
    pitch: 0,
    activeWeapon: 0,
    stateFlags: 1,
    lastClientSeq: 0,
    lastClientTimestamp: 0,
  };
}

export async function run(suite) {
  suite.test('PvP authority damages nearest intersected player, not Map insertion order', () => {
    let confirmed = null;
    const host = new P2PHost({
      hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' },
      onHitConfirmed: (hit) => { confirmed = hit; },
    });
    const shooter = host.playerRecords.get('host');
    shooter.position = { x: 0, y: 17.5, z: 0 };
    shooter.shieldExpiresAt = 0;

    // Intentionally insert the farther target first to catch insertion-order bugs.
    const far = combatRecord('far', 1, 20);
    const near = combatRecord('near', 2, 10);
    host.playerRecords.set('far', far);
    host.playerRecords.set('near', near);

    host.fireHitscan('host', 0, [0, 17.3, 0], [0, 0, 1]);

    assertEqual(confirmed?.victimId, 'near', 'nearest visible hit must win');
    assertEqual(far.hp, 100, 'farther aligned target must remain untouched');
    assertGreaterThan(100, near.hp, 'near target must receive damage');
    host.destroy();
  });

  suite.test('P2PHost respawn uses installed deterministic slot resolver for manual and timed respawn', () => {
    const host = new P2PHost({ hostPlayer: { id: 'host', name: 'HOST', color: '#00F0FF' } });
    host.setRespawnPositionResolver((slot) => ({ x: slot * 100, y: 50 + slot, z: slot * -100 }));

    const manual = combatRecord('manual', 3, 0);
    manual.isAlive = false;
    manual.hp = 0;
    manual.deathTime = performance.now();
    host.playerRecords.set('manual', manual);
    host.respawnPlayer('manual');
    assertEqual(manual.position.x, 300);
    assertEqual(manual.position.y, 53);
    assertEqual(manual.position.z, -300);

    const timed = combatRecord('timed', 4, 0);
    timed.isAlive = false;
    timed.hp = 0;
    timed.deathTime = performance.now() - 5001;
    host.playerRecords.set('timed', timed);
    host.tickSnapshot();
    assertEqual(timed.position.x, 400);
    assertEqual(timed.position.y, 54);
    assertEqual(timed.position.z, -400);
    assertEqual(host.getAuthoritativeRespawnCount(), 2);
    host.destroy();
  });
}
''', encoding='utf-8')

print('Final gameplay consistency patch applied.')

from pathlib import Path
import re

ROOT = Path(__file__).resolve().parents[1]


def read(path: str) -> str:
    return (ROOT / path).read_text(encoding='utf-8')


def write(path: str, content: str) -> None:
    (ROOT / path).write_text(content, encoding='utf-8')


def replace_once(text: str, old: str, new: str, label: str) -> str:
    count = text.count(old)
    if count != 1:
        raise RuntimeError(f'{label}: expected exactly one match, found {count}')
    return text.replace(old, new, 1)


# 1) Local gameplay: network authority validates the same camera/crosshair ray as local hitscan,
# horizontal velocity reflects real physics displacement, and multiplayer respawn waits for host authority.
path = 'game-web/src/gameplay/engine.ts'
text = read(path)
text = replace_once(
    text,
    """      [muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z],\n      [rayDirection.x, rayDirection.y, rayDirection.z],\n    );\n  } else if (activeP2PClient?.status === 'connected') {\n    activeP2PClient.fireHitscan(\n      stats.id,\n      [muzzleWorldPos.x, muzzleWorldPos.y, muzzleWorldPos.z],\n      [rayDirection.x, rayDirection.y, rayDirection.z],\n""",
    """      [rayOrigin.x, rayOrigin.y, rayOrigin.z],\n      [rayDirection.x, rayDirection.y, rayDirection.z],\n    );\n  } else if (activeP2PClient?.status === 'connected') {\n    activeP2PClient.fireHitscan(\n      stats.id,\n      [rayOrigin.x, rayOrigin.y, rayOrigin.z],\n      [rayDirection.x, rayDirection.y, rayDirection.z],\n""",
    'engine network shot origin',
)
text = replace_once(
    text,
    """  const input = new PhysicsInput(\n    player.position.x,\n""",
    """  const previousX = player.position.x;\n  const previousZ = player.position.z;\n  const input = new PhysicsInput(\n    player.position.x,\n""",
    'engine previous horizontal position',
)
text = replace_once(
    text,
    """  player.position.set(state.x, state.y, state.z);\n  player.velocity.y = state.vel_y;\n""",
    """  player.position.set(state.x, state.y, state.z);\n  const invDelta = delta > 1e-6 ? 1 / delta : 0;\n  player.velocity.x = (state.x - previousX) * invDelta;\n  player.velocity.y = state.vel_y;\n  player.velocity.z = (state.z - previousZ) * invDelta;\n""",
    'engine horizontal velocity',
)
text = replace_once(
    text,
    """      if (player.deathTimer <= 0) handleLocalPlayerRespawn();\n""",
    """      if (player.deathTimer <= 0 && !activeP2PHost && !activeP2PClient) {\n        handleLocalPlayerRespawn();\n      }\n""",
    'engine authoritative multiplayer respawn',
)
write(path, text)


# 2) Client lifecycle: a host snapshot that no longer carries shield state must clear local immunity/VFX immediately.
path = 'game-web/src/gameplay/networkBindings.ts'
text = read(path)
text = replace_once(
    text,
    """        if (isShielded) {\n          player.isInvulnerable = true;\n          player.shieldExpiresAt = performance.now() + state.timerRemainingMs;\n          if (!shieldVfxController.hasShield(context.localShieldAnchor)) {\n            shieldVfxController.attachShield(\n              context.localShieldAnchor,\n              Math.max(0.1, state.timerRemainingMs / 1000),\n            );\n          }\n        }\n        continue;\n""",
    """        if (isShielded) {\n          player.isInvulnerable = true;\n          player.shieldExpiresAt = performance.now() + state.timerRemainingMs;\n          if (!shieldVfxController.hasShield(context.localShieldAnchor)) {\n            shieldVfxController.attachShield(\n              context.localShieldAnchor,\n              Math.max(0.1, state.timerRemainingMs / 1000),\n            );\n          }\n        } else {\n          player.isInvulnerable = false;\n          player.shieldExpiresAt = 0;\n          if (shieldVfxController.hasShield(context.localShieldAnchor)) {\n            shieldVfxController.detachShield(context.localShieldAnchor);\n          }\n        }\n        continue;\n""",
    'network shield clear',
)
write(path, text)


# 3) Move PvP hardening into P2PHost ownership instead of runtime monkey-patching.
path = 'game-web/src/net/p2pHost.ts'
text = read(path)
text = replace_once(
    text,
    "import type { WasmLagCompensator } from '../../pkg/game_core.js';\n",
    "import type { WasmLagCompensator } from '../../pkg/game_core.js';\nimport { calculateWeaponDamageAtDistance, getWeaponRuntimeById, WEAPON_KEYS } from '../weapons/weaponConfig.ts';\nimport { intersectRobotHitbox } from './robotHitbox.ts';\n",
    'p2pHost imports',
)
text = replace_once(
    text,
    """// Browser fallback balance mirrors game-core/src/weapons.rs. Keeping this table\n// here makes the emergency geometric path obey the same TTK as the normal lag\n// compensated path instead of reverting to the old 3-hit AR / 5-hit SMG tuning.\nconst FALLBACK_WEAPON_DAMAGE: Record<number, { body: number; head: number }> = {\n  0: { body: 18, head: 27 },\n  1: { body: 70, head: 140 },\n  2: { body: 64, head: 96 },\n  3: { body: 12, head: 18 },\n  4: { body: 50, head: 50 },\n};\n\n""",
    '',
    'remove stale fallback damage table',
)
text = replace_once(
    text,
    """interface PeerConnectionRecord {\n  channel: IDataChannel;\n  info: SessionPlayerInfo;\n}\n\nexport class P2PHost {\n""",
    """interface PeerConnectionRecord {\n  channel: IDataChannel;\n  info: SessionPlayerInfo;\n}\n\nexport interface CombatValidationStats {\n  lastClientShotTime: Map<string, number>;\n  lastShotSeq: Map<string, number>;\n  accepted: number;\n  rejected: number;\n  rejectedCadence: number;\n  rejectedWeapon: number;\n  rejectedDirection: number;\n}\n\nfunction createCombatValidationStats(): CombatValidationStats {\n  return {\n    lastClientShotTime: new Map(),\n    lastShotSeq: new Map(),\n    accepted: 0,\n    rejected: 0,\n    rejectedCadence: 0,\n    rejectedWeapon: 0,\n    rejectedDirection: 0,\n  };\n}\n\nexport class P2PHost {\n""",
    'p2pHost validation stats type',
)
text = replace_once(
    text,
    """  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;\n  private snapshotSeq: number = 0;\n\n  constructor(options: P2PHostOptions) {\n""",
    """  private snapshotTickTimer: ReturnType<typeof setInterval> | null = null;\n  private snapshotSeq: number = 0;\n  public readonly __gonePvpHardeningState: CombatValidationStats = createCombatValidationStats();\n\n  constructor(options: P2PHostOptions) {\n""",
    'p2pHost validation stats owner',
)
helper = """  private rejectShot(reason: 'cadence' | 'weapon' | 'direction'): void {\n    const state = this.__gonePvpHardeningState;\n    state.rejected += 1;\n    if (reason === 'cadence') state.rejectedCadence += 1;\n    else if (reason === 'weapon') state.rejectedWeapon += 1;\n    else state.rejectedDirection += 1;\n  }\n\n  private validateAndAnchorShot(\n    shooterId: string,\n    shooter: PlayerCombatRecord,\n    shot: FireHitscanData,\n  ): boolean {\n    const weaponType = Number(shot.weaponType);\n    if (!Number.isInteger(weaponType) || weaponType < 0 || weaponType >= WEAPON_KEYS.length) {\n      this.rejectShot('weapon');\n      return false;\n    }\n\n    const dx = Number(shot.dirX);\n    const dy = Number(shot.dirY);\n    const dz = Number(shot.dirZ);\n    if (![dx, dy, dz].every(Number.isFinite)) {\n      this.rejectShot('direction');\n      return false;\n    }\n    const directionLength = Math.hypot(dx, dy, dz);\n    if (!Number.isFinite(directionLength) || directionLength < 1e-5) {\n      this.rejectShot('direction');\n      return false;\n    }\n    const nx = dx / directionLength;\n    const ny = dy / directionLength;\n    const nz = dz / directionLength;\n    shot.dirX = nx;\n    shot.dirY = ny;\n    shot.dirZ = nz;\n    shot.direction = [nx, ny, nz];\n\n    if (shooterId !== this.hostPlayer.id) {\n      if (Number(shooter.activeWeapon) !== weaponType) {\n        this.rejectShot('weapon');\n        return false;\n      }\n\n      const state = this.__gonePvpHardeningState;\n      const cfg = getWeaponRuntimeById(weaponType);\n      const clientTime = Number(shot.clientTimestamp);\n      const effectiveTime = Number.isFinite(clientTime) ? clientTime : performance.now();\n      const previousTime = state.lastClientShotTime.get(shooterId);\n      if (previousTime !== undefined) {\n        const elapsed = effectiveTime - previousTime;\n        const minimumCadenceMs = (1000 / Math.max(0.1, cfg.fireRateRps)) * 0.68;\n        if (elapsed < 0 || elapsed < minimumCadenceMs) {\n          this.rejectShot('cadence');\n          return false;\n        }\n      }\n\n      const seq = Number(shot.shotSeq) & 0xff;\n      const previousSeq = state.lastShotSeq.get(shooterId);\n      if (previousSeq !== undefined && seq === previousSeq) {\n        this.rejectShot('cadence');\n        return false;\n      }\n      state.lastShotSeq.set(shooterId, seq);\n      state.lastClientShotTime.set(shooterId, effectiveTime);\n    }\n\n    // The client sends the camera/crosshair origin. Horizontal coordinates are\n    // host-authoritative; vertical origin is accepted only inside the eye band.\n    const playerY = Number(shooter.position.y);\n    const suppliedY = Number(shot.originY);\n    const minEyeY = playerY - 1.35;\n    const maxEyeY = playerY + 0.25;\n    const originY = Number.isFinite(suppliedY) && suppliedY >= minEyeY && suppliedY <= maxEyeY\n      ? suppliedY\n      : playerY - 0.2;\n    const originX = Number(shooter.position.x);\n    const originZ = Number(shooter.position.z);\n    shot.originX = originX;\n    shot.originY = originY;\n    shot.originZ = originZ;\n    shot.origin = [originX, originY, originZ];\n\n    this.__gonePvpHardeningState.accepted += 1;\n    return true;\n  }\n\n"""
text = replace_once(
    text,
    """  private processFireHitscan(shooterId: string, shot: FireHitscanData): void {\n    const shooter = this.playerRecords.get(shooterId);\n    if (!shooter || !shooter.isAlive) return;\n\n""",
    helper + """  private processFireHitscan(shooterId: string, shot: FireHitscanData): void {\n    const shooter = this.playerRecords.get(shooterId);\n    if (!shooter || !shooter.isAlive) return;\n    if (!this.validateAndAnchorShot(shooterId, shooter, shot)) return;\n\n""",
    'p2pHost integrate validation',
)
text = replace_once(
    text,
    """            1000.0\n          );\n          const res = JSON.parse(resultJson);\n          if (res.hit) {\n            hitConfirmed = true;\n            damage = res.damage ?? (FALLBACK_WEAPON_DAMAGE[shot.weaponType]?.body ?? 18);\n            isHeadshot = !!res.is_headshot;\n            const dist = res.distance ?? 10.0;\n            hitX = shot.originX + shot.dirX * dist;\n            hitY = shot.originY + shot.dirY * dist;\n            hitZ = shot.originZ + shot.dirZ * dist;\n          }\n""",
    """            getWeaponRuntimeById(shot.weaponType).maxRange\n          );\n          const res = JSON.parse(resultJson);\n          if (res.hit) {\n            isHeadshot = !!res.is_headshot;\n            const parsedDistance = Number(res.distance);\n            const dist = Number.isFinite(parsedDistance) ? parsedDistance : 0;\n            const parsedDamage = Number(res.damage);\n            damage = Number.isFinite(parsedDamage)\n              ? parsedDamage\n              : calculateWeaponDamageAtDistance(shot.weaponType, dist, isHeadshot);\n            hitConfirmed = damage > 0;\n            hitX = shot.originX + shot.dirX * dist;\n            hitY = shot.originY + shot.dirY * dist;\n            hitZ = shot.originZ + shot.dirZ * dist;\n          }\n""",
    'p2pHost canonical validator result',
)
old_fallback_pattern = re.compile(
    r"  private checkRayCylinderHit\(\n    shot: FireHitscanData,\n    targetPos: \{ x: number; y: number; z: number \}\n  \): \{ hit: boolean; damage: number; isHeadshot: boolean; hitX: number; hitY: number; hitZ: number \} \{.*?\n  \}\n\n  public startSnapshotTick",
    re.S,
)
new_fallback = """  private checkRayCylinderHit(\n    shot: FireHitscanData,\n    targetPos: { x: number; y: number; z: number }\n  ): { hit: boolean; damage: number; isHeadshot: boolean; hitX: number; hitY: number; hitZ: number } {\n    // Method name is retained for compatibility with older tests/callers, but\n    // authoritative geometry now matches the visible robot AABBs.\n    const cfg = getWeaponRuntimeById(shot.weaponType);\n    const hit = intersectRobotHitbox(\n      [shot.originX, shot.originY, shot.originZ],\n      [shot.dirX, shot.dirY, shot.dirZ],\n      targetPos,\n      cfg.maxRange,\n    );\n    if (!hit) {\n      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };\n    }\n\n    const damage = calculateWeaponDamageAtDistance(shot.weaponType, hit.distance, hit.isHeadshot);\n    if (damage <= 0) {\n      return { hit: false, damage: 0, isHeadshot: false, hitX: 0, hitY: 0, hitZ: 0 };\n    }\n\n    return {\n      hit: true,\n      damage,\n      isHeadshot: hit.isHeadshot,\n      hitX: shot.originX + shot.dirX * hit.distance,\n      hitY: shot.originY + shot.dirY * hit.distance,\n      hitZ: shot.originZ + shot.dirZ * hit.distance,\n    };\n  }\n\n  public startSnapshotTick"""
text, count = old_fallback_pattern.subn(new_fallback, text, count=1)
if count != 1:
    raise RuntimeError(f'p2pHost fallback geometry: expected 1 match, found {count}')
text = replace_once(
    text,
    """    record.stateFlags = STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE;\n    this.options.onPlayerRespawned?.(record.id);\n    return true;\n""",
    """    record.stateFlags = STATE_FLAGS.ALIVE | STATE_FLAGS.SHIELD_ACTIVE;\n    this.lagCompensator?.clear_player(record.slot);\n    this.options.onPlayerRespawned?.(record.id);\n    return true;\n""",
    'p2pHost manual respawn history reset',
)
text = replace_once(
    text,
    """        record.position = { x: 0, y: 17.5, z: 0 };\n        record.shieldExpiresAt = now + 10000;\n        this.options.onPlayerRespawned?.(record.id);\n""",
    """        record.position = { x: 0, y: 17.5, z: 0 };\n        record.shieldExpiresAt = now + 10000;\n        this.lagCompensator?.clear_player(record.slot);\n        this.options.onPlayerRespawned?.(record.id);\n""",
    'p2pHost automatic respawn history reset',
)
text = replace_once(
    text,
    """    this.peers.delete(peerId);\n    this.releaseSlot(peerId);\n    this.playerRecords.delete(peerId);\n\n""",
    """    this.peers.delete(peerId);\n    this.releaseSlot(peerId);\n    this.playerRecords.delete(peerId);\n    this.__gonePvpHardeningState.lastClientShotTime.delete(peerId);\n    this.__gonePvpHardeningState.lastShotSeq.delete(peerId);\n\n""",
    'p2pHost disconnect validation cleanup',
)
text = replace_once(
    text,
    """    this.slotToPlayerId.clear();\n    this.playerIdToSlot.clear();\n  }\n}\n""",
    """    this.slotToPlayerId.clear();\n    this.playerIdToSlot.clear();\n    this.__gonePvpHardeningState.lastClientShotTime.clear();\n    this.__gonePvpHardeningState.lastShotSeq.clear();\n  }\n}\n""",
    'p2pHost destroy validation cleanup',
)
write(path, text)


# 4) No runtime monkey patch: P2PHost is the authoritative owner now.
path = 'game-web/src/runtime/startClientRuntime.ts'
text = read(path)
text = replace_once(text, "import { startPvpHardening } from '../net/pvpHardening.ts';\n", '', 'remove pvpHardening import')
text = replace_once(text, "  startPvpHardening();\n", '', 'remove pvpHardening startup')
write(path, text)

p = ROOT / 'game-web/src/net/pvpHardening.ts'
if p.exists():
    p.unlink()


# 5) Release hardening test must pass without installing a patch.
path = 'tests/release_hardening_1_host_7_guests.mjs'
text = read(path)
text = replace_once(text, "import { startPvpHardening } from '../game-web/src/net/pvpHardening.ts';\n", '', 'release hardening import')
text = replace_once(text, "startPvpHardening();\n\n", '', 'release hardening startup')
write(path, text)


# 6) Rust/WASM compatibility: keep the historical cylinder API, but add the same visible robot AABB
# validator and use it from the WASM lag-compensation export.
path = 'game-core/src/weapons.rs'
text = read(path)
robot_hitbox_code = r'''
#[derive(Clone, Copy)]
struct RobotAabb {
    min_x: f64,
    max_x: f64,
    min_y: f64,
    max_y: f64,
    min_z: f64,
    max_z: f64,
}

const ROBOT_BODY_HITBOX: RobotAabb = RobotAabb {
    min_x: -0.58,
    max_x: 0.58,
    min_y: -0.48,
    max_y: 1.08,
    min_z: -0.50,
    max_z: 0.50,
};

const ROBOT_HEAD_HITBOX: RobotAabb = RobotAabb {
    min_x: -0.31,
    max_x: 0.31,
    min_y: 1.05,
    max_y: 1.52,
    min_z: -0.34,
    max_z: 0.34,
};

fn intersect_ray_aabb(
    origin: [f64; 3],
    direction: [f64; 3],
    anchor: [f64; 3],
    bounds: RobotAabb,
    max_range: f64,
) -> Option<f64> {
    let magnitude = (direction[0] * direction[0]
        + direction[1] * direction[1]
        + direction[2] * direction[2])
        .sqrt();
    if magnitude < 1e-9 || max_range <= 0.0 {
        return None;
    }
    let dir = [
        direction[0] / magnitude,
        direction[1] / magnitude,
        direction[2] / magnitude,
    ];
    let mins = [
        anchor[0] + bounds.min_x,
        anchor[1] + bounds.min_y,
        anchor[2] + bounds.min_z,
    ];
    let maxs = [
        anchor[0] + bounds.max_x,
        anchor[1] + bounds.max_y,
        anchor[2] + bounds.max_z,
    ];

    let mut t_min: f64 = 0.0;
    let mut t_max = max_range;
    for axis in 0..3 {
        if dir[axis].abs() < 1e-9 {
            if origin[axis] < mins[axis] || origin[axis] > maxs[axis] {
                return None;
            }
            continue;
        }
        let inv = 1.0 / dir[axis];
        let mut near = (mins[axis] - origin[axis]) * inv;
        let mut far = (maxs[axis] - origin[axis]) * inv;
        if near > far {
            std::mem::swap(&mut near, &mut far);
        }
        t_min = t_min.max(near);
        t_max = t_max.min(far);
        if t_min > t_max {
            return None;
        }
    }

    if t_max < 0.0 || t_min > max_range {
        None
    } else {
        Some(t_min.max(0.0))
    }
}

/// Authoritative visible-player hitbox shared semantically with
/// game-web/src/net/robotHitbox.ts. The legacy cylinder API remains available
/// for compatibility tests and non-player callers.
pub fn intersect_ray_robot_hitbox(
    origin: [f64; 3],
    direction: [f64; 3],
    anchor: [f64; 3],
    max_range: f64,
) -> Option<(f64, bool)> {
    let body = intersect_ray_aabb(origin, direction, anchor, ROBOT_BODY_HITBOX, max_range);
    let head = intersect_ray_aabb(origin, direction, anchor, ROBOT_HEAD_HITBOX, max_range);
    match (body, head) {
        (None, None) => None,
        (Some(distance), None) => Some((distance, false)),
        (None, Some(distance)) => Some((distance, true)),
        (Some(body_distance), Some(head_distance)) if head_distance <= body_distance => {
            Some((head_distance, true))
        }
        (Some(body_distance), Some(_)) => Some((body_distance, false)),
    }
}

'''
text = replace_once(text, 'pub fn validate_hitscan_shot_internal(\n', robot_hitbox_code + 'pub fn validate_hitscan_shot_internal(\n', 'Rust robot hitbox insert')
write(path, text)

path = 'game-core/src/lag_compensation.rs'
text = read(path)
text = replace_once(
    text,
    '    calculate_damage, get_weapon_config, intersect_ray_cylinder, HitscanResult, WeaponType,\n',
    '    calculate_damage, get_weapon_config, intersect_ray_cylinder, intersect_ray_robot_hitbox, HitscanResult, WeaponType,\n',
    'lag compensation robot hitbox import',
)
marker = '    /// Authoritatively validate a rewound hitscan ray against a victim\'s historical bounding cylinder.\n'
start = text.find(marker)
end_marker = '\n}\n\nimpl Default for LagCompensationEngine'
end = text.find(end_marker, start)
if start < 0 or end < 0:
    raise RuntimeError('lag compensation validator block not found')
block = text[start:end]
clone = block.replace(
    "    /// Authoritatively validate a rewound hitscan ray against a victim's historical bounding cylinder.\n",
    "    /// Validate rewind against the visible floating-robot torso/head hitboxes.\n",
    1,
).replace('validate_rewind_hitscan_full', 'validate_rewind_robot_hitscan_full', 1)
old_intersection = """        if let Some((distance, is_headshot)) = intersect_ray_cylinder(\n            origin,\n            direction,\n            target_base,\n            snapshot.radius,\n            snapshot.height,\n            effective_range,\n        ) {\n"""
new_intersection = """        if let Some((distance, is_headshot)) = intersect_ray_robot_hitbox(\n            origin,\n            direction,\n            target_base,\n            effective_range,\n        ) {\n"""
clone = replace_once(clone, old_intersection, new_intersection, 'lag compensation cloned robot intersection')
text = text[:end] + '\n\n' + clone + text[end:]
wasm_marker = '/// WebAssembly exported lag compensation engine.'
wasm_at = text.find(wasm_marker)
if wasm_at < 0:
    raise RuntimeError('WASM marker not found')
head, tail = text[:wasm_at], text[wasm_at:]
tail = replace_once(tail, 'self.engine.validate_rewind_hitscan_full(\n', 'self.engine.validate_rewind_robot_hitscan_full(\n', 'WASM robot rewind validator')
tail = tail.replace('historical cylinder.', 'historical visible robot hitboxes.', 1)
text = head + tail
write(path, text)

# Focused Rust regression test for the visible hitbox rewind path.
write('game-core/tests/robot_hitbox_rewind_consistency.rs', r'''use game_core::lag_compensation::LagCompensationEngine;

#[test]
fn rewound_robot_hitbox_matches_visible_browser_geometry() {
    let mut engine = LagCompensationEngine::new(500.0);
    engine.record_position(2, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    let body = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 0.5, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(body.hit);
    assert!(!body.is_headshot);
    assert!((body.distance - 9.5).abs() < 1e-9);
    assert!((body.damage - 18.0).abs() < 1e-9);

    let head = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 1.2, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(head.hit);
    assert!(head.is_headshot);
    assert!((head.distance - 9.66).abs() < 1e-9);
    assert!((head.damage - 27.0).abs() < 1e-9);

    let old_cylinder_only_zone = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 1.75, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(!old_cylinder_only_zone.hit);

    let lower_visible_body = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, -0.3, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(lower_visible_body.hit);
    assert!(!lower_visible_body.is_headshot);
}
''')

# 7) Architecture note: combat hardening is owned by P2PHost; no prototype repair layer.
path = 'AGENTS.md'
text = read(path)
needle = '- Browser authoritative hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts` using two cheap AABBs (torso/propulsor + head/visor).\n'
if needle in text:
    text = text.replace(needle, needle + '- `net/p2pHost.ts` owns shot sanity/cadence/origin validation and fallback damage/hitbox logic directly; do not reintroduce prototype monkey-patches for combat authority.\n', 1)
write(path, text)

print('one-shot gameplay consistency patch applied')

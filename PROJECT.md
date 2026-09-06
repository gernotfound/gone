# Project: G.O.N.E. Advanced P2P Multiplayer Systems

## Architecture
- **Monorepo Structure**:
  - /game-core: Rust library compiled to WebAssembly via wasm-pack. Exposes procedural generation, weapon ray-cylinder hitscan intersection, and temporal rewind lag compensation buffer.
  - /game-web: TypeScript / Vite / Three.js client with Tailwind CSS HUD overlay.
- **P2P WebRTC Model**:
  - One peer is Host (authoritative server for hit validation, player health, death timers, spawn shields, and world snapshots).
  - Other peers are Clients, connected via WebRTC Data Channels.
- **Network Data Flow**:
  - Clients send binary CLIENT_STATE (30Hz) and FIRE_HITSCAN (event-driven) to Host over WebRTC DataChannel using ArrayBuffer.
  - Host runs tick loop, stores target positions in Rust LagCompensationEngine, validates hitscan shots using shooter client timestamp, updates authoritative player records (HP, shield, death timers), and broadcasts binary WORLD_SNAPSHOT and HIT_CONFIRMED.
  - Clients receive snapshots, feed into interpolation buffer, and smoothly interpolate remote player positions and rotations.
- **Combat & Lifecycle Flow**:
  - Base HP: 100.
  - Fatal damage (HP <= 0) triggers 5s death phase (spectator/static camera, inputs disabled, viewmodel hidden).
  - Respawn at central platform [0.0, 17.5, 0.0].
  - On initial spawn and respawn, 10s invulnerability shield (0 damage received, cyan semi-transparent sphere VFX, HUD shield icon).

## Code Layout
- game-core/src/lag_compensation.rs: Rust temporal rewind circular buffer and hit validation.
- game-core/src/lib.rs: WASM exports for lag compensator.
- game-core/tests/: Rust unit and lag compensation integration tests.
- game-web/src/net/binaryProtocol.ts: Binary ArrayBuffer packet definitions, serializers, and parsers.
- game-web/src/net/interpolationBuffer.ts: Snapshot buffering, vector lerp, shortest-path angle lerp.
- game-web/src/net/p2pHost.ts: Host authoritative combat record, lag compensation, snapshot broadcasts.
- game-web/src/net/p2pClient.ts: Client binary transmission, snapshot receipt, and interpolation feeds.
- game-web/src/ui/healthHud.ts: Cyberpunk bottom-left HUD (health bar, shield icon, death spectator overlay).
- game-web/src/vfx/shieldVfx.ts: 3D cyan semi-transparent sphere VFX lifecycle.
- game-web/src/main.ts: Integration with player state, camera, inputs, and render loop.
- game-web/pkg/game_core.d.ts & src/vite-env.d.ts: TypeScript declarations for WASM exports.
- tests/: Automated programmatic test suites runnable via node tests/e2e_runner.mjs.

## Feature Inventory
| # | Feature | Description | Milestone | Source |
|---|---------|-------------|-----------|--------|
| 1 | Binary Netcode Serialization | Convert WebRTC movement & firing messages to binary ArrayBuffer / DataView | M1 | ORIGINAL_REQUEST Â§R3 |
| 2 | Remote Player Interpolation | Buffer network snapshots and smoothly interpolate remote positions and yaw | M1 | ORIGINAL_REQUEST Â§R3 |
| 3 | Rust Lag Compensation Core | Circular snapshot buffer in Rust (game-core) rewinding target positions by client ping | M2 | ORIGINAL_REQUEST Â§R3 |
| 4 | Rust Rewind Hit Validation | WASM export for Host hit validation against rewound target cylinders | M2 | ORIGINAL_REQUEST Â§R3 |
| 5 | Host-Authoritative Health | Host maintains 100 base HP per player, validates hits, deducts damage | M3 | ORIGINAL_REQUEST Â§R1 |
| 6 | Death Phase & Camera | 5s death phase on fatal damage, static/spectator camera, input lock, mesh hidden | M3 | ORIGINAL_REQUEST Â§R1 |
| 7 | Central Platform Respawn | Respawn player at [0.0, 17.5, 0.0] after 5s death timer | M3 | ORIGINAL_REQUEST Â§R1 |
| 8 | Bottom-Left Cyberpunk HUD | Health bar (100 HP) and death overlay in bottom-left HUD | M3 | ORIGINAL_REQUEST Â§R1 |
| 9 | Invulnerability Shield Logic | 10s immunity on spawn/respawn (0 damage registered on hits) | M4 | ORIGINAL_REQUEST Â§R2 |
| 10 | Invulnerability Shield 3D VFX | Cyan semi-transparent sphere VFX (0x00F0FF, AdditiveBlending) visible local & remote | M4 | ORIGINAL_REQUEST Â§R2 |
| 11 | Shield HUD Indicator | Shield icon/badge above health bar active during immunity | M4 | ORIGINAL_REQUEST Â§R2 |
| 12 | Automated E2E Test Suite | Programmatic tests for death/respawn/shield, VFX lifecycle, interpolation, Rust lag rewind, binary packing | M5 | ORIGINAL_REQUEST Acceptance Criteria |

## Milestones
| # | Name | Scope | Dependencies | Status |
|---|------|-------|-------------|--------|
| M1 | Binary Netcode Protocol & Interpolation | Binary packet serialization (ArrayBuffer), network tick loop, remote player snapshot interpolation buffer | none | DONE |
| M2 | Rust Lag Compensation Engine | game-core/src/lag_compensation.rs, 100ms temporal rewind, ray-cylinder hit validation, WASM bindings, Rust tests | none | DONE |
| M3 | Health, Death & Respawn System | Host authoritative HP (100 base), fatal damage trigger, 5s death phase & camera, respawn at [0, 17.5, 0], bottom-left HUD | M1, M2 | DONE |
| M4 | Invulnerability Shield (VFX + Logic) | 10s spawn/respawn immunity, 0 damage check, 3D cyan sphere mesh lifecycle, HUD shield icon | M3 | DONE |
| M5 | E2E Testing Suite Verification | Full verification across all 4 tiers + Tier 5 adversarial tests, ensuring 100% test pass and zero regressions | M1, M2, M3, M4 | DONE |

## Interface Contracts

### Binary Protocol Contract (game-web/src/net/binaryProtocol.ts)
- PacketType:
  - 0x01: CLIENT_STATE (32 bytes) -> [type: u8, slot: u8, seq: u16, timestamp: f32, x: f32, y: f32, z: f32, yaw: f32, pitch: f32, flags: u8]
  - 0x02: WORLD_SNAPSHOT (8 + 28*N bytes) -> [type: u8, count: u8, seq: u16, hostTimestamp: f32] + N * [slot: u8, x: f32, y: f32, z: f32, yaw: f32, hp: u8, flags: u8]
  - 0x03: FIRE_HITSCAN (32 bytes) -> [type: u8, shooterSlot: u8, weaponType: u8, shotSeq: u8, clientTimestamp: f32, originX: f32, originY: f32, originZ: f32, dirX: f32, dirY: f32, dirZ: f32]
  - 0x04: HIT_CONFIRMED (16 bytes) -> [type: u8, victimSlot: u8, shooterSlot: u8, flags: u8, damage: u8, newHp: u8, hitX: f32, hitY: f32, hitZ: f32]

### Rust Lag Compensation Contract (game-core/src/lag_compensation.rs)
- WasmLagCompensator:
  - new(max_history_ms: f64) -> WasmLagCompensator
  - record_player_position(player_id: u32, timestamp_ms: f64, x: f64, y: f64, z: f64, radius: f64, height: f64)
  - validate_rewind_hitscan(shooter_id: u32, victim_id: u32, shot_time_ms: f64, max_unlag_ms: f64, origin_x: f64, origin_y: f64, origin_z: f64, dir_x: f64, dir_y: f64, dir_z: f64, max_range: f64) -> String (JSON HitscanResult)
  - clear_player(player_id: u32)

### Combat & Health State Contract (game-web/src/net/p2pHost.ts)
- PlayerRecord:
  - id: string
  - slot: number
  - hp: number (0 to 100)
  - isAlive: boolean
  - deathTime: number
  - shieldExpiresAt: number
  - position: { x: number, y: number, z: number }
  - yaw: number

## Combat & TTK Balance
- Assalto (Assault Rifle): 18 base damage, 27 headshot (1.5x), 600 RPM, TTK ~0.50s within 30m.
- Cecchino (Sniper Rifle): 70 base damage, 140 headshot (2.0x, 1-shot kill), 50 RPM, TTK 0.0s on headshot.
- Pompa (Shotgun): 64 base damage point-blank, high spread, TTK ~0.8s within 8m.
- Mitraglietta (SMG): 12 base damage, 18 headshot, 900 RPM, TTK ~0.45s close range.
- Coltello (Melee Knife): 50 base damage, strict 2.5m range cutoff, TTK ~0.60s melee.

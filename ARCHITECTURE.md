# G.O.N.E. browser architecture

This document defines current ownership boundaries. The objective is one obvious owner per behavior, explicit composition, deterministic lifecycle and no hidden repair layers.

## Core rule: one behavior, one owner

Fix the canonical owner. Do not add a second module that monkey-patches or periodically repairs the first one.

Avoid new code that:

- patches `THREE.*.prototype` or another module's methods after startup;
- polls to repair state that should change through explicit transitions;
- duplicates weapon/spawn/protocol/session/lifecycle constants;
- resets private `__gone*Started` flags to force restarts;
- routes new internal dependencies through `window.gone*` when a typed import, event or context is practical.

Compatibility adapters are allowed only at a real boundary and must be explicit/tested.

## Composition and runtime health

`game-web/src/main.ts` is the browser composition root. `runtime/runtimeKernel.ts` is the canonical startup/reconciliation owner. Modules declare name, phase, dependencies, criticality, start and optional reconcile operations.

States are `registered`, `starting`, `ready`, `failed`, `blocked`. Health is `booting`, `healthy`, `degraded`, `failed`. Dependency failure blocks dependants instead of allowing partial activation.

Critical invariants include:

- browser lifecycle infrastructure;
- bootstrap/menu/game shell;
- `advancedWeaponController`, because finite-ammo authority must not silently degrade into the legacy direct-fire path.

`runtime/startClientRuntime.ts` owns the game/client module graph. Device controls start only when the combat-safe core (`bootstrap` + `advancedWeaponController`) is ready. Core failure emits `gone-runtime-unavailable`; `ui/runtimeAvailabilityUi.ts` provides a fail-closed recovery surface.

## Browser lifecycle ownership

`runtime/browserLifecycle.ts` owns shared native lifecycle delivery:

- visible / hidden;
- focus / blur;
- online / offline;
- pageshow / pagehide;
- beforeunload.

It installs one native listener per family and invokes named subscribers in deterministic priority order. Subscriber exceptions are isolated and reported as `gone-runtime-lifecycle-error`.

Input release runs before network/session recovery. PWA checks, menu audio/network UI, cache integrity, mobile session resume and adaptive timer cleanup consume this broker. Pointer/touch/orientation/device-sensor events stay with their device controller.

## Browser layers and ownership

### 1. UI (`game-web/src/ui/`)

UI renders state and emits user intent. It does not own transports or network authority.

- `menu.ts`: menu behavior and HTML media lifecycle; Safari/iOS media unlock remains gesture-driven.
- `lobby.ts`: **presentation only** for multiplayer roster, color picker, invite/answer controls and lobby buttons. It subscribes to `MultiplayerSessionSnapshot` and forwards intent to the session controller. It must not construct `P2PClient`, `P2PHost`, SDP offers/answers or lag compensators.
- `runtimeAvailabilityUi.ts`: actionable fail-closed startup surface.
- HUD/minimap modules: presentation only.

`lobby.ts` still exports the local robot preview compatibility state because that is visual/UI state; multiplayer session state no longer lives there.

### 2. Multiplayer session (`game-web/src/net/multiplayerSessionController.ts`)

This is the canonical owner of browser multiplayer session lifecycle:

- active `P2PHost` / `P2PClient` references;
- local session id and color;
- lobby roster snapshot;
- direct-WebRTC host offer / guest answer orchestration;
- accepted host peer-channel tracking and deterministic teardown;
- guest callbacks (join/color/roster/status/game-start);
- host/client role transitions and `gone-session-changed`;
- presentation snapshots through `gone-session-state`;
- compatibility facade `window.goneSession`.

It owns transitions, not rendering. It does not import DOM or `engine.ts`.

Gameplay attachment is inverted through the typed `SessionRuntimeBridge`, registered once by `gameplay/engine.ts`. The bridge can attach host/client networking, clear/remove remote players, apply local color presentation and answer whether gameplay rendering is ready. New session code must not call `window.goneGame` for these operations.

Direct host color presentation uses the explicit `SessionP2PHost` compatibility adapter to observe existing lobby `COLOR_CHANGED` packets. It does not overwrite host methods at runtime.

`sessionLifecycleHardening.ts` was removed. Session correctness is transition-driven; do not reintroduce setter monkey-patches or periodic callback-repair polling.

### 3. Input and mobile controls (`game-web/src/controls/`, `game-web/src/mobile/`)

Low-level keyboard/mouse state belongs in `controls/`. Device gestures belong in focused mobile controllers.

- `mobileRuntime.ts`: generic movement/look/actions, virtual pointer-lock compatibility, wake/orientation/fullscreen best effort and mobile DPR guard.
- `smartphoneControlsGuard.ts`: idempotent fallback owner; input-mode changes reconcile rather than restart.
- `inputMode.ts`: persistent explicit `keyboard` vs `screen` choice.
- `smartphoneProfile.ts` + `smartphone.css`: phone presentation/HUD compaction.
- `touchPreferences.ts`: sensitivity, FIRE dead-zone, gyro, scale/opacity, handedness, secondary FIRE.
- `pubgTouchControls.ts`: ammo-safe FIRE/drag, claw FIRE, ADS drag, gyro and iOS-safe actions.
- `competitiveTouchControls.ts`: simultaneous movement/look/ADS/map-open combat composition.
- `touchLayoutEditor.ts`: persistent draggable offsets.
- `mobileSessionResume.ts`: hidden/offline suspension and foreground/online cadence repair through browser lifecycle.

Touch sustained FIRE must route to `advancedWeaponController`; it must not leave the legacy continuous `inputState.fire` path active.

### 4. Gameplay (`game-web/src/gameplay/`)

`engine.ts` coordinates local loop/physics/camera/viewmodel and retains the compatibility facade, but new feature ownership should remain focused.

- `localPlayerLifecycle.ts`: sole browser owner of local HP/death/respawn/spawn-shield transitions plus their HUD/VFX/death-camera side effects. `engine.ts` composes it and `networkBindings.ts` forwards authoritative lifecycle snapshots through it.
- `networkBindings.ts`: typed P2P callback ↔ gameplay bridge; imports session setters from `net/multiplayerSessionController.ts`, never from UI. It synchronizes local lifecycle through `localPlayerLifecycle.ts` rather than mutating HP/shield state directly.
- `remotePlayerRegistry.ts`: remote model lifecycle/interpolation/shield presentation.
- `advancedWeaponController.ts`: finite magazine/reserve/reload authority, trigger interception, ADS/FOV and ammo UX.
- `spawnPolicy.ts`: deterministic terrain-correct spawn policy.
- `precisionShotRuntime.ts`: accuracy/spread adaptation.

`engine.ts` registers `SessionRuntimeBridge` and asks the session controller to broadcast game start instead of iterating host peer internals.

### Ammo authority invariant

`advancedWeaponController.ts` is the sole authoritative browser owner of local magazine/reserve/reload state. Each successful ranged shot decrements magazine exactly once; zero magazine produces no shot until reload succeeds. This contract is global across desktop/mobile.

### 5. Weapons (`game-web/src/weapons/`)

`weaponConfig.ts` is canonical browser balance/config. `game-core/src/weapons.rs` is the Rust counterpart for shared calculations. `weaponCombatStats.ts` derives identity/cadence and owns camera/viewmodel recoil tuning.

### 6. Networking (`game-web/src/net/`)

`net/colorRegistry.ts` owns neon color allocation and uniqueness for the host, including the local implementation and WASM adapter. `p2pHost.ts` re-exports its public types/classes for existing imports but does not implement the registry. Combat and peer/session state stay authoritative in `P2PHost`.


The browser host remains authoritative for PvP. Visual rays/tracers never own damage. Canonical generated maze walls also participate in host-side hitscan occlusion; client raycasts only mirror that authority for presentation.

#### Movement authority

Guest movement is **client-predicted but host-validated**. `P2PClient` still sends 30 Hz `CLIENT_STATE` transforms so local controls keep their current responsiveness, but only the transform accepted by `P2PHost` is authoritative for world snapshots, combat origins, health-pickup proximity and lag-compensation history.

`net/movementAuthority.ts` derives its envelope from the canonical Rust physics contract: 12 m/s base speed, sprint ×2, movement-scale maximum 1.25 (30 m/s horizontal ceiling), 25 m/s jump impulse and 54 m/s terminal fall speed. Movement credit is replenished from the **host monotonic receipt clock**, never from the client timestamp. Two 30 Hz ticks of jitter credit absorb scheduling variance; cumulative credit is capped at the existing 1000 ms stale/rewind horizon. A separate single-packet ceiling covers eight missing ordered states plus jitter, so idle time or a long stall cannot be spent as one large teleport.

The host rejects duplicate/backward sequence numbers, non-increasing client timestamps, NaN/Infinity, invalid pitch/weapon state, impossible horizontal speed, arbitrary teleports, plainly impossible vertical deltas and movement through canonical maze walls without advancing the accepted transform or lag history. Host-owned spawn/respawn transitions replace the authoritative position and reset movement validation credit explicitly; there is no reusable client teleport exemption.

`gameplay/networkBindings.ts` reconciles the local predicted player to host coordinates on the first authoritative self snapshot, on host-owned respawn, or after large divergence. Normal sub-threshold prediction remains untouched. CLIENT_STATE ticking starts only after the first self snapshot reaches gameplay, preventing a pre-authority local spawn from being interpreted as movement. Manual/debug local teleports remain presentation-only: multiplayer authority will reject them unless the host itself performed the transition.

Direct WebRTC (`directWebRtc.ts`) uses `iceServers: []` by project policy. `NativeRtcDataChannel` owns heartbeat/transport resilience: ~3 s heartbeat, ~15 s expiry, ~6 s grace for transient `disconnected`, deterministic terminal teardown.

`P2PHost.broadcastBinary` owns send-time channel readiness and stale-peer cleanup. Expected closing/closed-channel sends are discarded, terminal peers are disconnected through the normal host lifecycle, and unexpected send failures remain observable. There is no prototype patch or runtime `networkStabilityFix` repair layer.

`selfHostSession.ts` owns only local relay transport/status presentation. It **reuses `multiplayerSessionController`** for host registration and guest client/session callbacks; it must not create a parallel `P2PClient` lifecycle or roster implementation.

`mobileSessionResume.ts` can restart cadence when the same RTC survives background/network transitions. A terminally closed direct RTC still requires new SDP negotiation.

`adaptiveSnapshotRate.ts` owns host cadence adaptation. `p2pQualityHud.ts` is presentation only. `remoteShotPresentation.ts` is current binary remote-shot presentation; `legacyRemoteShotPresentation.ts` is compatibility-only.

### 7. PWA (`game-web/src/pwa/`, `game-web/public/`)

`pwaRuntime.ts` owns install guidance, build-version polling and safe update application. Version checks are single-flight/time-bounded and lifecycle-owned. Service-worker caches are build-aware; update reloads are deferred during live gameplay.

### 8. World / rendering / models / VFX

- `world/worldTopology.ts`: shared immutable world-center/crater/supply geometry constants.
- Streamed terrain colors come directly from Rust/WASM; there is no runtime biome-palette layer.
- Tactical-map presentation intentionally excludes named landmarks and extra loot/spawn marker layers.
- Decorative natural sun-ray meshes/resources are removed; `rendering/scene.ts` retains normal hemisphere/directional lighting.
- `world/mazeLayout.ts`: canonical deterministic 18x18 coarse-grid maze around a 6x6 central void. A seeded DFS spanning tree plus sparse deterministic loop carving targets difficulty 9/10 with many dead ends, selective ~96 m choke sections inside otherwise ~184 m corridors, and exactly one east-side outer exit. Every retained logical wall expands into a paired/double wall. It also owns the large central clearing/four cardinal entrances, landmark clearings, spatial wall index and pure collision/ray queries used by client prediction and host authority.
- `world/mazeNavigation.ts`: bounded 72 m-grid A* over `mazeLayout`; it consumes canonical collision rather than defining a second nav authority.
- `world/mazePrototype.ts`: instanced Three.js presentation of the canonical maze layout. Walls are extruded from Y=-600 to Y=+1200 and never derive authority from terrain sampling.
- `world/`: chunk lifecycle and terrain sampling.
- `rendering/`: scene/renderer resources.
- `models/`: model construction/loading/socket attachment.
- `vfx/`: pooled runtime effects.

Terrain streaming prioritizes stable frame time: distance-prioritized chunk work, bounded per-frame creation, pooled geometry, instanced rocks, static transforms and seam-safe normals. Do not introduce mismatched-edge LOD without stitching/skirts/clipmap/quadtree design.

### 9. Performance

- `adaptiveRenderScale.ts`: sole adaptive render-scale owner.
- `localTelemetry.ts`: local-only diagnostics; no continuous upload.
- `performancePack.ts`: explicit asset/model/audio/WASM warming/cache.
- `cacheIntegrity.ts`: coalesced cached-pack integrity checking.

Vite/Rolldown isolates Three.js into stable `three-vendor` with strict execution ordering. Do not broadly manual-split side-effect-heavy app modules without measurement.

### 10. Observability

`observability/clientDiagnostics.ts` owns bounded privacy-safe failure reporting. Runtime-kernel and browser-lifecycle failures feed `/api/client-telemetry`. Never upload continuous FPS, gameplay coordinates, lobby/session codes, identity, full query URLs or raw UA.

### 11. Deployment / security

`game-web/vercel.json` owns main-only deployment plus CSP, frame denial, nosniff, referrer and permissions policies. Production verification after merge is separate from GitHub CI: deployment SHA, `/version.json`, headers and runtime logs must be checked on real Vercel when the connector is available.

### 12. Rust/WASM

`game-core/` owns pure/performance-sensitive terrain, physics and shared authoritative calculations. DOM/Three/browser ownership does not belong in Rust.

## Compatibility facades

`window.goneGame`, `goneWeapons`, `goneMobileControls`, `gonePubgTouchControls`, `gonePwa`, `goneDiagnostics`, `goneRuntimeHealth`, `goneBrowserLifecycle` and `goneSession` are stable compatibility/diagnostics surfaces. They are not alternate state authorities.

Prefer typed imports/events/context objects for new internal code.

The first migration from the browser debug facade is complete for remote motion, remote shot VFX, host rendering sync, PvP timing and kill-ammo reset: each reads the canonical `remotePlayerRegistry.ts` and/or `multiplayerSessionController.ts` directly. The global `window.goneGame` object stays for legacy browser integrations. Further migrations must preserve runtime callbacks and host authority, and should eliminate callback/prototype patching at its owner rather than adding repair polling.

## Structural targets

The lobby/session split, local-player lifecycle split and procedural weapon-builder split are complete. Recommended next refactor order:

1. **Host internals** — separate peer bookkeeping from authoritative combat while retaining one host authority boundary.
2. **Global facade migration** — move remaining internal `window.gone*` consumers to typed services/events where practical.

Do not split modules merely for line-count goals.

## Data flow

```text
UI intent
  -> multiplayerSessionController
     -> direct WebRTC OR self-host relay transport
     -> SessionRuntimeBridge
        -> gameplay/networkBindings
           -> host-authoritative gameplay
  -> UI subscribes to session snapshot

Browser / touch / sensor
  -> controls/mobile controller
  -> gameplay controllers
     -> WASM physics / terrain
     -> finite-ammo weapon authority
     -> session/network bindings
     -> scene/VFX/UI presentation

Failures
  -> runtimeKernel / browserLifecycle / WebGL / window errors
  -> clientDiagnostics
  -> bounded /api/client-telemetry
```

## Refactor / release checklist

Before merging a structural/runtime change:

- identify one canonical owner for each behavior/state;
- encode startup dependencies in `runtimeKernel`, not incidental call order;
- use `browserLifecycle` for shared page/network lifecycle;
- use explicit session transitions, never setter monkey-patches/polling repairs;
- preserve host authority and finite-ammo semantics;
- preserve public compatibility members used by tests/adapters;
- keep expensive work out of per-frame paths;
- update this document and `AGENTS.md` when ownership changes;
- add deterministic Tier tests plus real browser smoke for affected interaction/network paths;
- run full CI on the branch;
- squash exactly once to `main`;
- verify production Vercel SHA/build ID/headers/runtime state separately.

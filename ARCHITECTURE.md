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
- `lobby.ts`: **presentation only** for multiplayer roster, color picker, invite/answer controls and lobby buttons. It subscribes to `MultiplayerSessionSnapshot` and forwards intent to the session controller. It must not construct `P2PClient`, `P2PHost`, SDP offers/answers, Firestore rooms or lag compensators.
- `runtimeAvailabilityUi.ts`: actionable fail-closed startup surface.
- HUD/minimap modules: presentation only.

`lobby.ts` still exports the local robot preview compatibility state because that is visual/UI state; multiplayer session state no longer lives there.

### 2. Multiplayer session (`game-web/src/net/multiplayerSessionController.ts`)

This is the canonical owner of browser multiplayer session lifecycle:

- active `P2PHost` / `P2PClient` references;
- local session id and color;
- lobby roster snapshot;
- direct-WebRTC host offer / guest answer orchestration;
- ephemeral Firestore offer/answer signaling lifecycle and fallback to manual SDP exchange;
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
- `mobileSessionResume.ts`: hidden/offline suspension, foreground/online cadence repair and presentation of transport-recovery state through the shared browser lifecycle/events.

Touch sustained FIRE must route to `advancedWeaponController`; it must not leave the legacy continuous `inputState.fire` path active.

### 4. Gameplay (`game-web/src/gameplay/`)

`engine.ts` coordinates local loop/physics/camera/viewmodel and retains the compatibility facade, but new feature ownership should remain focused.

- `networkBindings.ts`: typed P2P callback ↔ gameplay bridge; imports session setters from `net/multiplayerSessionController.ts`, never from UI.
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

The browser host remains authoritative for PvP. Visual rays/tracers never own damage.

Direct WebRTC (`directWebRtc.ts`) uses the public `stun:stun.cloudflare.com:3478` endpoint for ICE/STUN candidate discovery and configures **no TURN relay**. STUN never carries gameplay packets; after signaling, match traffic remains browser-to-browser. `NativeRtcDataChannel` owns heartbeat and transport resilience: ~3 s heartbeat, ~15 s expiry and ~6 s grace for transient `disconnected`. For Firestore-backed sessions, a terminal native RTC/SCTP failure can replace the underlying PeerConnection plus control/realtime DataChannels while keeping the same logical `IDataChannel`; `P2PHost`/`P2PClient`, authoritative slot/HP/roster and gameplay bindings therefore survive successful recovery. Its `bufferedAmount` getter exposes the live native RTC send queue to the adaptive network governor. Explicit close/reset still terminates immediately.

`firestoreSignaling.ts` is an ephemeral signaling boundary only. Initial connections exchange gathered WebRTC offer/answer payloads through the isolated `gone_signaling_rooms_v1` collection using Firestore REST, random 128-bit room IDs and a two-minute logical TTL. Terminal transport recovery derives a generation-specific 128-bit mailbox ID from the original room secret with SHA-256 and reuses the exact same one-shot `waiting -> answered -> delete` document schema. It never lists the collection and performs no reads/writes during healthy gameplay. It must never carry `CLIENT_STATE`, snapshots, combat, health, player coordinates or persistent match state. If Firestore is unavailable or not configured, the session controller falls back to the existing manual direct offer/answer path. Firestore configuration and recovery semantics are documented in `docs/firestore_multiplayer_signaling.md`.

Transport recovery is not a second session lifecycle owner. `multiplayerSessionController` still owns host/client role and session teardown; `directWebRtc.ts` only swaps the native transport behind an already-owned logical channel. Outbound packets produced during the recovery gap are discarded rather than queued against a dead SCTP stream, and normal state snapshots resynchronize after the replacement control channel opens. If automatic recovery is unavailable or fails, the logical channel closes and the existing terminal/manual-invite fallback executes.

`selfHostSession.ts` owns only local relay transport/status presentation. It **reuses `multiplayerSessionController`** for host registration and guest client/session callbacks; it must not create a parallel `P2PClient` lifecycle or roster implementation.

`mobileSessionResume.ts` can restart cadence when the same logical session survives background/network transitions and presents `gone-rtc-recovery-state` feedback on mobile. It does not negotiate SDP or own reconnect state. Manual direct sessions have no Firestore recovery anchor; they still require a new invite after terminal RTC failure. Firestore-backed direct sessions attempt generation-based automatic renegotiation first and fall back to the same manual recovery surface only if that attempt fails.

`adaptiveSnapshotRate.ts` owns host cadence adaptation. `p2pQualityHud.ts` is presentation only. `remoteShotPresentation.ts` is current binary remote-shot presentation; `legacyRemoteShotPresentation.ts` is compatibility-only.

### 7. PWA (`game-web/src/pwa/`, `game-web/public/`)

`pwaRuntime.ts` owns install guidance, build-version polling and safe update application. Version checks are single-flight/time-bounded and lifecycle-owned. Service-worker caches are build-aware; update reloads are deferred during live gameplay.

### 8. World / rendering / models / VFX

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

The only Firebase browser configuration needed for signaling is the public Vite value `VITE_FIREBASE_PROJECT_ID`. Firestore Security Rules must scope unauthenticated signaling access to `gone_signaling_rooms_v1/{roomId}`, forbid collection listing and preserve unrelated project rules. Initial invite and derived recovery mailboxes intentionally share the same 32-hex ID shape and one-shot schema, so recovery does not require broader Firestore permissions. No service-account credential or private Firebase secret belongs in the browser bundle.

### 12. Rust/WASM

`game-core/` owns pure/performance-sensitive terrain, physics and shared authoritative calculations. DOM/Three/browser ownership does not belong in Rust.

## Compatibility facades

`window.goneGame`, `goneWeapons`, `goneMobileControls`, `gonePubgTouchControls`, `gonePwa`, `goneDiagnostics`, `goneRuntimeHealth`, `goneBrowserLifecycle` and `goneSession` are stable compatibility/diagnostics surfaces. They are not alternate state authorities.

Prefer typed imports/events/context objects for new internal code.

## Structural targets

The lobby/session split is complete. Recommended next refactor order:

1. **Engine lifecycle split** — move local death/respawn/shield lifecycle into a focused controller/service and reduce `engine.ts` state ownership.
2. **Weapon model builders** — split per-weapon construction behind stable exports.
3. **Host internals** — if `p2pHost.ts` grows further, separate peer bookkeeping from authoritative combat while retaining one host authority boundary.
4. **Global facade migration** — move remaining internal `window.gone*` consumers to typed services/events where practical.

Do not split modules merely for line-count goals.

## Data flow

```text
UI intent
  -> multiplayerSessionController
     -> direct WebRTC negotiation
        -> Firestore signaling OR manual SDP fallback
        -> STUN candidate discovery (no TURN)
        -> browser-to-browser WebRTC gameplay
        -> terminal native transport failure (Firestore-backed only)
           -> deterministic generation mailbox in Firestore
           -> replacement PeerConnection + control/realtime DataChannels
           -> same logical IDataChannel / same session authority
     -> OR self-host relay transport
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
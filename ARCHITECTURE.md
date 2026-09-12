# G.O.N.E. browser architecture

This document describes current ownership boundaries and the direction future refactors should follow. The objective is not to maximize file count: it is to give each behavior one obvious owner, keep composition explicit, and avoid hidden patch layers.

## Core rule: one behavior, one owner

When a bug belongs to a module, fix that module. Do not add a second startup module that monkey-patches the first one unless a real compatibility boundary requires it.

Avoid new code that:

- patches `THREE.*.prototype` at runtime;
- replaces another module's methods after startup;
- polls every animation frame only to repair state written incorrectly elsewhere;
- duplicates canonical weapon/spawn/protocol/lifecycle constants;
- adds a new global facade dependency when a typed import/event/context is practical.

Compatibility adapters are allowed, but their filename/comments must make that role explicit.

## Composition roots

`game-web/src/main.ts` is intentionally small. It owns device/PWA composition that must surround the game runtime:

- smartphone profile;
- explicit input mode;
- touch preferences;
- PWA runtime;
- client runtime;
- smartphone fallback controls;
- PUBG-like touch actions;
- draggable touch layout;
- mobile session resume.

The game/browser runtime itself is owned by `game-web/src/runtime/startClientRuntime.ts`. It defines explicit phases: diagnostics/guards, bootstrap, gameplay systems, mobile runtime, networking, presentation/diagnostics. Ordering belongs there instead of import side effects.

## Browser layers and ownership

### 1. UI (`game-web/src/ui/`)

Owns menus, HUD, lobby DOM, minimap UI and user-facing overlays. UI translates state into DOM/canvas output and emits intent; it should not own terrain math, hit validation or network authority.

`ui/menu.ts` also owns HTML media lifecycle because the BGM element is a menu-level DOM resource. Its iOS gesture-unlock path must keep `HTMLAudioElement.play()` and Web Audio unlock close to a real user gesture. Source gain itself remains in `audio/musicSourceGain.ts`.

The lobby is still a secondary refactor target: `ui/lobby.ts` mixes DOM rendering and direct-WebRTC orchestration. Future work can extract session orchestration into a typed session controller while leaving rendering in UI.

### 2. Input and mobile controls (`game-web/src/controls/`, `game-web/src/mobile/`)

Low-level keyboard/mouse state belongs in `controls/`. Device-specific gesture translation belongs in focused mobile controllers.

Ownership:

- `mobile/mobileRuntime.ts`: generic touch movement/look/actions, virtual pointer-lock compatibility, wake/orientation/fullscreen best effort, mobile render-DPR guard;
- `mobile/smartphoneControlsGuard.ts`: fallback control tree if the primary touch runtime is unavailable or heuristics fail;
- `mobile/inputMode.ts`: persistent explicit `keyboard` vs `screen` choice; explicit screen mode is authoritative over detection;
- `mobile/smartphoneProfile.ts` + `smartphone.css`: phone-specific presentation/HUD compaction;
- `mobile/touchPreferences.ts`: persistent user tuning (look/ADS sensitivity, FIRE dead-zone, gyro, scale/opacity, handedness, secondary FIRE);
- `mobile/pubgTouchControls.ts`: PUBG-like combat gestures and iOS-safe capture-phase action buttons;
- `mobile/touchLayoutEditor.ts`: persistent draggable control offsets;
- `mobile/mobileSessionResume.ts`: background/offline input release and foreground/online session cadence repair.

The PUBG touch layer intentionally intercepts the primary FIRE button before the legacy mobile handler. This is not a general monkey-patch: it is the device-input boundary required to route sustained touch fire into `advancedWeaponController` without setting the legacy continuous `inputState.fire` path that can bypass finite ammo accounting.

### 3. Gameplay (`game-web/src/gameplay/`)

Owns local player flow and feature controllers. `engine.ts` remains the compatibility/game-loop facade, but is no longer the intended home for every new feature.

Focused ownership includes:

- `spawnPolicy.ts`: deterministic spawns and terrain-correct height;
- `networkBindings.ts`: P2P callback ↔ gameplay bridge and host per-slot respawn resolver;
- `spawnController.ts`: manual/debug spawn compatibility only;
- `remotePlayerRegistry.ts`: remote model lifecycle/interpolation/shield presentation;
- `advancedWeaponController.ts`: trigger interception, finite ammo/reload, ADS/FOV, ammo HUD/action UX;
- `precisionShotRuntime.ts`: accuracy/spread adaptation around local shot path.

### Ammo authority invariant

`advancedWeaponController.ts` is the authoritative browser owner of local magazine/reserve/reload state. `engine.ts` still contains a legacy direct-fire compatibility path keyed from `inputState.fire`; new touch code must not use that path for sustained FIRE. Successful ranged shots must decrement magazine exactly once and no shot may be produced after magazine reaches zero until reload succeeds.

This invariant applies regardless of desktop/mobile presentation. Desktop mouse interception already routes through the advanced weapon controller; mobile controls must preserve the same contract.

### 4. Weapons (`game-web/src/weapons/`)

`weaponConfig.ts` is the canonical browser gameplay contract for identity, cadence, damage/range, ammunition, reload, ADS and spread. `game-core/src/weapons.rs` is the Rust counterpart for shared authoritative calculations.

`weaponCombatStats.ts` derives shared identity/cadence from canonical config and owns camera/viewmodel recoil tuning. Do not duplicate those values in the engine.

### 5. Networking (`game-web/src/net/`)

Owns binary protocol, transport, WebRTC session behavior, host authority, lag compensation and network presentation adapters.

The browser host remains authoritative for PvP. Visual rays/tracers never become damage authority.

Direct WebRTC (`directWebRtc.ts`) intentionally uses no external ICE servers. `NativeRtcDataChannel` owns transport resilience:

- 3 s heartbeat cadence;
- 15 s heartbeat expiry;
- 6 s grace for transient `disconnected` state;
- deterministic teardown on failed/expired connection.

`mobileSessionResume.ts` can restart state/snapshot cadence after the same RTC connection survives a background/network transition. It cannot recreate a terminally closed direct RTC session without a new SDP negotiation; `gone-reconnect-requested` is an intent/event boundary for that situation.

`legacyRemoteShotPresentation.ts` exists only for older JSON FIRE_HITSCAN callbacks. Current binary enemy-shot presentation is `remoteShotPresentation.ts`.

### 6. PWA (`game-web/src/pwa/`, `game-web/public/`)

`pwa/pwaRuntime.ts` owns install guidance, build-version polling and safe update application. Build identity is generated before build into both the client module and `/version.json`.

Service-worker caches are build-aware. Updates may be prepared during a live match, but forced page reload belongs at a safe menu/lobby boundary, not mid-PvP.

### 7. World / rendering / models / VFX

- `world/`: chunk lifecycle, terrain sampling, world ambience;
- `rendering/`: renderer/scene resources;
- `models/`: model construction/loading/socket attachment;
- `vfx/`: pooled runtime effects.

Visual behavior should live in the object that executes it. Tracer travel/fade is directly in `vfx/tracerPool.ts`; there is no separate update patch.

### 8. Performance (`game-web/src/performance/`)

World/runtime performance favors frame-time stability over synchronous throughput.

- `adaptiveRenderScale.ts` owns render-scale adaptation. Do not create a competing mobile-only quality governor without first extending this owner.
- `localTelemetry.ts` is local F3 diagnostics only and must remain non-uploading.
- `performancePack.ts` owns explicit asset/model/audio/WASM warming/cache.
- `cacheIntegrity.ts` owns cached-pack integrity checks.

### 9. Observability (`game-web/src/observability/`, `game-web/api/`)

`observability/clientDiagnostics.ts` is the owner of bounded privacy-safe client failure reporting. It is intentionally separate from local performance telemetry.

The client may report coarse failure context only: event kind, build ID, error message/stack, pathname, coarse device class, input mode, standalone/online/visibility. It must not upload continuous FPS, coordinates, lobby/session codes, identity, raw UA or URL query strings.

`api/client-telemetry.js` is the Vercel function boundary that validates/sanitizes payload size and event kind, then emits structured runtime logs. Reporting must be capped, deduplicated and fail-open so observability can never break gameplay.

### 10. Deployment / browser security (`game-web/vercel.json`)

`vercel.json` owns both main-only Git deployment and response security headers. Current policy includes CSP, frame denial, nosniff, referrer policy and permissions policy. Gyroscope/accelerometer remain self-only because touch gyro is an optional first-party feature.

Header changes require two levels of validation:

1. local/build/browser tests for application compatibility;
2. actual Vercel production response verification after the single merge to `main`, because Vite preview does not reproduce Vercel response headers.

### 11. Rust/WASM (`game-core/`)

Owns performance-sensitive/pure mathematical systems such as procedural terrain, physics and shared authoritative calculations. Browser/DOM/Three dependencies do not belong in Rust core logic.

## World streaming performance model

World streaming is designed for stable frame times:

- terrain height is evaluated once per vertex in Rust/WASM; slope colors reuse cached-grid finite differences;
- missing chunks are distance-prioritized and expensive work is bounded per frame;
- stale chunks remain while replacements stream, with a hard radius bounding memory;
- terrain geometry is pooled/re-written rather than repeatedly allocated;
- rocks use instancing and near-detail lazy creation;
- shared sun-ray GPU resources are allocated once and rays are grounded/configured at chunk creation;
- terrain bounds are recomputed after height injection for correct frustum culling.

Do not introduce naive mismatched-edge terrain LOD; use stitched edges/skirts or a clipmap/quadtree if LOD is later justified by measurement.

## Compatibility facades

Globals such as `window.goneGame`, `window.goneWeapons`, `window.goneMobileControls`, `window.gonePubgTouchControls`, `window.goneTouchPreferences`, `window.goneTouchLayout`, `window.gonePwa` and `window.goneDiagnostics` exist because UI/device adapters and browser smokes need stable inspection/action surfaces.

Rules:

1. Keep existing public members stable unless all consumers/tests migrate together.
2. Prefer typed imports/events/context objects for new internal dependencies.
3. Do not use a facade merely to repair another owner's incorrect state per frame.

## Structural targets

Recommended future refactor order remains:

1. **Lobby/session split** — extract direct-WebRTC/session orchestration from `ui/lobby.ts`.
2. **Engine lifecycle split** — move local death/respawn/shield lifecycle into a focused controller.
3. **Weapon model builders** — split model construction per weapon behind stable exports.
4. **Host internals** — if `p2pHost.ts` grows further, separate peer bookkeeping from authoritative combat while preserving one host authority boundary.
5. **Global facade migration** — gradually replace new global lookups with typed services/events.

Do not perform these splits only for line-count goals.

## Data flow

```text
Browser / touch / sensor events
   -> controls + focused mobile input controller
   -> gameplay controllers
      -> WASM physics / terrain math
      -> weapon runtime + finite ammo controller
      -> P2P gameplay bindings
         -> host-authoritative networking
      -> scene/world/VFX presentation
      -> UI state presentation

Client failures
   -> observability/clientDiagnostics
   -> bounded POST /api/client-telemetry
   -> Vercel structured runtime logs
```

Startup is separate:

```text
main.ts
  -> device/input/PWA setup
  -> runtime/startClientRuntime.ts
       -> diagnostics + guards
       -> bootstrap engine/menu
       -> gameplay + mobile runtime
       -> network runtime
       -> presentation/diagnostics
  -> fallback/PUBG/layout/resume device layers
```

## Refactor / release checklist

Before merging a structural or browser-runtime change:

- identify the canonical owner of every behavior/constant touched;
- decide whether a physical-iPhone report is device-specific or a global contract bug;
- preserve host authority and finite-ammo semantics;
- search for redundant patches/wrappers and dynamic/global consumers;
- preserve compatibility facade members used by browser smokes;
- keep expensive work out of per-frame paths;
- update this document and `AGENTS.md` when ownership changes;
- add deterministic Tier tests plus browser interaction smoke where applicable;
- run full CI on the branch;
- squash once to `main`;
- then verify the real Vercel deployment SHA/build ID/security headers/runtime state independently.
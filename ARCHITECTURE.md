# G.O.N.E. browser architecture

This document describes both the current ownership boundaries and the direction future refactors should follow. The objective is not to maximize the number of files: it is to make each behavior have one obvious owner, keep runtime composition explicit, and avoid hidden patch layers that make the executed code differ from the code an engineer or AI reads.

## Core rule: one behavior, one owner

When a bug belongs to a module, fix that module. Do not add a second startup module that monkey-patches the first one unless backward compatibility makes that unavoidable.

Avoid new code that:

- patches `THREE.*.prototype` at runtime;
- replaces another module's methods after startup;
- polls every animation frame only to repair state written incorrectly elsewhere;
- duplicates canonical weapon, spawn, protocol or lifecycle constants;
- adds another `window.goneGame` consumer when a typed import/callback is practical.

Compatibility adapters are allowed, but their filename and comments must identify them as compatibility code and they should sit at the boundary they adapt.

## Composition root

`game-web/src/main.ts` is intentionally tiny. Browser startup is owned by:

- `game-web/src/runtime/startClientRuntime.ts`

That module defines explicit startup phases: pre-bootstrap guards, network runtime, gameplay runtime, presentation/diagnostics. If a feature must run before another feature, encode the ordering there rather than relying on import side effects.

`startClientRuntime.ts` may compose modules; it should not contain gameplay algorithms.

## Browser layers and ownership

### 1. UI (`game-web/src/ui/`)

Owns menus, HUD, lobby DOM, minimap UI and user-facing overlays. UI should translate state into DOM/canvas output and emit user intent. It should not own terrain math, hit validation or network authority.

The lobby is still a secondary refactor target: `ui/lobby.ts` contains both UI rendering and direct-WebRTC session orchestration. Future work should extract session orchestration into a typed session controller while keeping DOM rendering in `ui/`.

### 2. Input (`game-web/src/controls/`)

Owns keyboard/mouse capture and normalized input state. Raw browser events should be converted to intent here or in a focused controller. Gameplay rules do not belong in the low-level input collector.

### 3. Gameplay (`game-web/src/gameplay/`)

Owns local player flow and feature controllers. `engine.ts` remains the compatibility/game-loop facade, but it is no longer the intended home for every new feature.

Focused ownership introduced by the refactor:

- `spawnPolicy.ts`: deterministic spawn points and terrain-correct spawn height;
- `spawnController.ts`: host-authoritative respawn adapter plus manual diagnostics, not a per-frame corrective teleport;
- `remotePlayerRegistry.ts`: remote model lifecycle, interpolation presentation and remote shield presentation;
- `networkBindings.ts`: bridge between P2P callbacks and gameplay state;
- `advancedWeaponController.ts`: ammo/reload/ADS/action UX;
- `precisionShotRuntime.ts`: accuracy/spread adaptation around the local shot path.

`engine.ts` should trend toward a coordinator that owns the local game loop, local physics/camera and the compatibility facade. New remote-player, network, UI or world systems should not be added directly to it.

### 4. Weapons (`game-web/src/weapons/`)

`weaponConfig.ts` is the canonical browser gameplay contract for weapon identity, cadence, damage/range, ammunition, reload, ADS and spread.

`weaponCombatStats.ts` derives weapon id/name/fire cadence from that canonical config and owns only camera/viewmodel recoil tuning. Do not duplicate id, display name or fire rate in the engine.

If a new weapon property changes gameplay semantics, add it to `weaponConfig.ts` and keep the Rust counterpart aligned where applicable.

### 5. Networking (`game-web/src/net/`)

Owns binary protocol, transport, WebRTC session behavior, host authority, lag compensation and network-specific presentation adapters.

The host remains authoritative for PvP. Browser presentation code must never turn a visual ray/tracer into damage authority.

`legacyRemoteShotPresentation.ts` exists only for the older JSON `FIRE_HITSCAN` callback. Current binary enemy-shot presentation is owned by `remoteShotPresentation.ts`. Compatibility code should not grow new gameplay behavior.

### 6. World / rendering / models / VFX

- `world/`: chunk lifecycle, terrain sampling and world ambience. `worldConfig.ts` owns the centered chunk grid; `chunkManager.ts` owns priority streaming; terrain pooling and rock construction live in focused helpers so the manager remains a coordinator;
- `rendering/`: renderer/scene resources. Shared sun-ray geometry/material is created directly by `naturalSunRayResources.ts`, not installed later through a runtime patch;
- `models/`: model construction/loading/socket attachment;
- `vfx/`: pooled runtime visual effects.

Visual behavior should live in the object that executes it. For example, tracer travel/fade is implemented directly in `vfx/tracerPool.ts`; there is no separate startup patch replacing `TracerPool.update()`.

### 7. Rust/WASM (`game-core/`)

Owns performance-sensitive/pure mathematical systems such as procedural terrain and physics plus shared authoritative calculations. Keep browser/DOM/Three.js dependencies out of Rust core logic.

## World streaming performance model

World streaming is designed for frame-time stability rather than maximum synchronous throughput:

- procedural terrain height is evaluated once per vertex in Rust/WASM; slope colors use cached-grid finite differences instead of two additional full terrain evaluations;
- missing chunks are priority-sorted by distance and at most one expensive terrain/detail task is executed per animation frame;
- stale chunks stay resident only while replacement chunks stream in, preventing holes; a hard radius bounds transient memory;
- terrain `PlaneGeometry` objects are pooled and rewritten instead of allocated/disposed at every cell crossing;
- rocks remain one instanced draw per detailed chunk and are created lazily only inside the near-detail radius;
- shared sun-ray resources are created once, while each ray is grounded/configured exactly once when its chunk is built;
- terrain bounds are recomputed after height injection so GPU frustum culling remains correct on high relief.

Do not add naive per-chunk LOD with mismatched edge tessellation: it creates T-junction cracks. If terrain LOD becomes necessary, use stitched edges/skirts or a clipmap/quadtree design and measure it against the existing fog-limited draw distance.

## Compatibility facade: `window.goneGame`

`window.goneGame` is retained because UI/network adapters and browser smoke tests use it. Treat it as a compatibility facade, not the default dependency-injection mechanism.

Rules for future work:

1. Existing public members should remain stable unless all consumers/tests are migrated in the same change.
2. New internal modules should prefer typed imports and explicit callbacks/context objects.
3. If the facade becomes large again, move its construction to a dedicated adapter module rather than distributing global writes around the repository.

## Files that are large but not automatically wrong

File size alone is not a refactor criterion. Some large files are dense, cohesive definitions:

- `net/binaryProtocol.ts` is a protocol contract and benefits from keeping wire layout close together;
- procedural weapon model builders are data/geometry-heavy and can be split per weapon later, but they are less dangerous than a cross-domain god object;
- sound synthesis may be large while still having one clear responsibility.

Split a large file when it owns multiple lifecycles, has unrelated reasons to change, or requires readers to understand distant subsystems to make a local edit.

## Next structural targets

The recommended order for future refactoring is:

1. **Lobby/session split** — extract direct-WebRTC/session orchestration from `ui/lobby.ts` into `net/sessionController.ts` (or equivalent), leaving DOM rendering in UI.
2. **Engine lifecycle split** — move local death/respawn/shield state into a focused local-player lifecycle controller with explicit dependencies.
3. **Weapon model builders** — split `models/weaponBuilders.ts` into per-weapon builders behind the existing barrel export, without changing call sites.
4. **Host internals** — if `p2pHost.ts` keeps growing, separate peer/session bookkeeping from authoritative combat processing while preserving one host authority boundary.
5. **Global facade migration** — progressively replace new `window.goneGame` lookups with typed services/events; keep the facade as a thin compatibility layer.

Do not perform these splits purely for line-count targets. Preserve stable APIs and do them when a change can be verified end-to-end.

## Data flow

```text
Browser events
   -> controls / focused input controller
   -> gameplay coordinator
      -> WASM physics / terrain math
      -> weapon runtime contract
      -> P2P gameplay bindings
         -> host-authoritative networking
      -> scene/world/VFX presentation
      -> UI state presentation
```

Startup is separate from this data flow:

```text
main.ts
  -> runtime/startClientRuntime.ts
       -> install guards
       -> bootstrap engine/menu
       -> network features
       -> gameplay features
       -> presentation + diagnostics
```

## Refactor checklist

Before merging a structural change:

- identify the single canonical owner of each constant and behavior touched;
- search for runtime patches/wrappers that become redundant after the owner is fixed;
- search for files with zero import/reference consumers before deleting them;
- preserve `window.goneGame` compatibility where browser scripts depend on it;
- keep host authority and binary protocol behavior unchanged unless the task explicitly changes networking semantics;
- keep expensive work out of per-frame paths;
- update this document and `AGENTS.md` when high-value file ownership changes;
- create Git objects off-ref, inspect the diff, and move `main` once because Vercel free-tier builds are push-sensitive.

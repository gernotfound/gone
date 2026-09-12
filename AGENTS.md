# G.O.N.E. — AI engineering context

Read this first. Dense project index intended to minimize repo search/tool spend.

## Owner constraints

- Repo: `gernotfound/gone`.
- Never write directly to `main`. Every change must live on a dedicated branch and reach `main` only through an explicit merge/PR.
- Vercel is intentionally configured so only `main` deploys. Non-main branches are for development and must not be manually deployed.
- Prefer keeping one logical change per branch/PR. Multiple commits on a branch are fine because non-main branches do not trigger Vercel builds.
- The owner tests deployed Chrome/Brave gameplay; do not ask them to edit code or run commands.
- No paid/external multiplayer runtime infrastructure: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase.
- Direct `iceServers: []` connectivity still depends on LAN/NAT/IPv6. Never claim universal Internet P2P.

## Architecture discipline

- `ARCHITECTURE.md` is the current ownership map and future refactor direction.
- `game-web/src/main.ts` must remain a tiny entry point. Browser composition/order belongs in `game-web/src/runtime/startClientRuntime.ts`.
- One behavior should have one obvious owner. Fix owner modules directly instead of adding runtime monkey-patches.
- Do not add new `THREE.*.prototype` patches or startup modules that replace another module's implementation after boot unless an explicit compatibility constraint requires it.
- Avoid per-frame polling whose only purpose is to repair state written incorrectly by another owner.
- `window.goneGame` is a compatibility facade used by focused runtime modules and smoke tests. Preserve existing members, but prefer typed imports/callbacks/context objects for new internal code.

## Stack / build

- Browser FPS: TypeScript + Vite + Three.js under `game-web/`.
- Core: Rust/WASM under `game-core/`; `game-web/pkg/game_core.js` is a functional fallback but `game-web/build.sh` rebuilds Rust WASM before Vite for production.
- Browser compile gate: `game-web/package.json` runs `tsc && vite build`; TS has `noUnusedLocals` and `noUnusedParameters` enabled.
- `game-web/vercel.json` owns Git deployment policy: all branches disabled by default, `main` enabled.
- Production validation happens after merge to `main`; branch work should be reviewed/tested without relying on a Vercel deployment.

## Runtime composition

- `game-web/src/main.ts` imports CSS and calls `startClientRuntime()`.
- `runtime/startClientRuntime.ts` owns startup phases and ordering: protocol/authority guards, bootstrap, network features, gameplay features, presentation/diagnostics.
- `gameplay/engine.ts` is the local loop/physics/camera/viewmodel coordinator plus compatibility facade. Do not grow it back into a god object.

## Local player / spawn

- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy lives in `gameplay/spawnPolicy.ts`.
- Slot 0 spawn is X=+1200, Z=+1200 (SE giant crater). Other multiplayer slots are deterministic across the map.
- `engine.ts` performs normal initial spawn and local respawn directly with terrain-correct Y.
- `gameplay/networkBindings.ts` installs the host authoritative per-slot respawn resolver; `spawnController.ts` is diagnostics/manual teleport compatibility only and must not poll to repair host state.
- Never reintroduce `(0,17.5,0)` as intended gameplay spawn.
- Solo PvE bionic spiders are owned by `gameplay/bionicSpiderEnemies.ts`; their procedural rig lives in `models/bionicSpider.ts`. They spawn from deterministic crater centers, use terrain-aware eight-leg gait/IK, and are intentionally disabled in P2P until enemy state/combat is host-authoritatively represented in the binary protocol. Do not enable divergent per-client enemy simulation in multiplayer.

## Weapons / local shots

Canonical browser gameplay balance is `game-web/src/weapons/weaponConfig.ts`; Rust counterpart is `game-core/src/weapons.rs`. Shared balance values must stay aligned.

- AR: 30/120, 18 dmg, 180 m, falloff 35→140 to 10, head ×1.5, 6.25 rps.
- Sniper: 5/25, 70 dmg, 550 m, falloff 180→450 to 50, head ×2, 1 rps.
- Shotgun: 6/30, 64 dmg, 42 m, falloff 8→30 to 20, head ×1.25, 1.25 rps.
- SMG: 36/180, 12 dmg, 90 m, falloff 15→65 to 7, head ×1.5, 10 rps.
- Knife: 50 dmg, 2.6 m hard range, head ×1, no ammo.

`weapons/weaponCombatStats.ts` owns recoil/viewmodel tuning and derives id/name/fire cadence from `weaponConfig.ts`; do not duplicate those values in `engine.ts`.

`gameplay/advancedWeaponController.ts` owns semi/auto LMB, ADS/FOV/sensitivity, reload/ammo HUD and action animations. Local hitscan range comes directly from `weaponConfig.ts`; do not recreate global Raycaster guards.

## Tracer / shot presentation

- `vfx/tracerPool.ts` directly owns tracer travel/fade behavior.
- Do not add separate `TracerPool.prototype.update` patch modules.
- `net/remoteShotPresentation.ts` is the current binary enemy-shot presenter.
- `net/legacyRemoteShotPresentation.ts` is compatibility-only for old JSON FIRE_HITSCAN callbacks.
- Tracers are visual only; damage remains host-authoritative hitscan.

## Remote players

- `gameplay/remotePlayerRegistry.ts` owns remote model lifecycle, GLTF upgrade, interpolation presentation and remote shield presentation.
- `gameplay/networkBindings.ts` owns P2P callback ↔ gameplay-state wiring.
- `engine.ts` re-exports the legacy/public remote-player API for `window.goneGame`, but remote registry implementation does not belong in the engine.
- Browser authoritative hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts` using two cheap AABBs (torso/propulsor + head/visor).
- `net/p2pHost.ts` owns shot sanity/cadence/origin validation and fallback damage/hitbox logic directly; do not reintroduce prototype monkey-patches for combat authority.

## Multiplayer / PvP

- Native WebRTC direct mode: `net/directWebRtc.ts`, manual offer/answer, star host↔guests.
- Browser host is authoritative. Core binary opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED.
- State/snapshots ~30 Hz.
- `net/networkStabilityFix.ts`, `net/pvpTuning.ts`, and `net/hostRemoteSync.ts` own stability, clock mapping, and host presentation. Authoritative shot validation belongs directly to `net/p2pHost.ts`; do not reintroduce `pvpHardening.ts` as a runtime patch.

## Self-host mode

- `gone-host/` is ACTIVE runtime infrastructure, not dead code.
- `gone-host/server.mjs` is the local authoritative HTTP/WebSocket bridge. It serves `game-web/dist`, exposes `/__gone_host/status` and `/__gone_host/ws`, and relays guest traffic to the browser host.
- `gone-host/package.json` and root launchers `start-gone-host.cmd`, `.ps1`, `.sh` are required by the local self-host workflow.
- Browser counterparts are `game-web/src/net/selfHostSession.ts` and `game-web/src/net/relayWebSocket.ts`.
- Do not delete the self-host server or launchers unless the feature is intentionally replaced.
- The old `gone-host/public` Vercel landing and `gone-host/vercel.json` were legacy-only and are intentionally removed.

## Lobby / session

- `ui/lobby.ts` still mixes DOM and session orchestration and is a future refactor target.
- Live identity reconciliation: `net/lobbyPresenceSync.ts`.
- Colors remain host-authoritative through the normal color protocol.
- `net/selfHostSession.ts` is active; do not classify it as dead code.

## World / rendering / performance

- Terrain: `game-core/src/lib.rs`; JS fallback: `game-web/pkg/game_core.js`.
- Global gameplay map window is ±2400 m (4.8×4.8 km); procedural terrain itself is unbounded.
- `world/worldConfig.ts` owns chunk-grid geometry and streaming constants.
- `world/chunkManager.ts` owns progressive chunk lifecycle/priority streaming; it must keep expensive world work to one task per frame.
- `world/terrainGeometryPool.ts` reuses terrain GPU geometry; `world/rockInstances.ts` owns grounded instanced rock construction.
- `world/naturalSunRays.ts` creates terrain-anchored rays at chunk creation; `rendering/naturalSunRayResources.ts` owns their shared GPU resources. No polling/monkey-patch layer is required.
- Chunk coordinates are centered on `cx * CHUNK_SIZE`; use `worldToChunkCoord()` instead of `floor(world / size)`.
- `rendering/scene.ts`: antialias off, DPR ≤1.25, shadows off, high-performance GPU preference.
- `performance/localTelemetry.ts`: F3 local-only diagnostics. No telemetry leaves the browser.
- `performance/performancePack.ts`: home PRECARICA DATI warms/caches models, assets, audio and WASM before realtime play.

## High-value files

- Browser composition: `game-web/src/runtime/startClientRuntime.ts`
- Main loop/facade: `game-web/src/gameplay/engine.ts`
- Spawn: `game-web/src/gameplay/spawnPolicy.ts`, `spawnController.ts`
- Remote players: `game-web/src/gameplay/remotePlayerRegistry.ts`
- Gameplay↔network bridge: `game-web/src/gameplay/networkBindings.ts`
- Weapon UX/balance: `game-web/src/gameplay/advancedWeaponController.ts`, `game-web/src/weapons/weaponConfig.ts`
- Host/client: `game-web/src/net/p2pHost.ts`, `p2pClient.ts`
- Direct RTC: `game-web/src/net/directWebRtc.ts`
- Self-host: `gone-host/server.mjs`, `game-web/src/net/selfHostSession.ts`, `game-web/src/net/relayWebSocket.ts`
- VFX tracer owner: `game-web/src/vfx/tracerPool.ts`
- World chunks/rays: `game-web/src/world/chunkManager.ts`, `naturalSunRays.ts`

## Change discipline

1. Read this file and `ARCHITECTURE.md`, then only relevant high-value files.
2. Create/use a dedicated branch before writing anything. Never update `main` directly.
3. Preserve host authority and zero-external-service networking.
4. Prefer fixing the owner module over layering a runtime patch.
5. Prefer focused modules over growing `engine.ts`; do not split cohesive data/protocol files merely to reduce line count.
6. Keep expensive work out of per-frame paths; reuse/pool Three resources.
7. Search imports/references before deleting suspected ghost code. Dynamic/global consumers must be considered.
8. Prefer Git Data API (blob/tree/commit) for grouped changes; contents API is acceptable on non-main branches when convenient.
9. Review/compare the branch before merging. Only the merge into `main` should trigger Vercel.
10. Build green does not equal visually verified on owner hardware; report that distinction precisely.

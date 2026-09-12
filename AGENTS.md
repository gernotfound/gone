# G.O.N.E. — AI engineering context

Read this first. Dense project index intended to minimize repo search/tool spend.

## Owner constraints

- Repo: `gernotfound/gone`.
- Work directly on `main`; do not create branches unless the owner explicitly changes this.
- Vercel free tier deploys per push. Prefer unreferenced Git blobs/tree/commit, inspect the diff, then move `main` once.
- The owner tests deployed Chrome/Brave gameplay; do not ask them to edit code or run commands.
- No paid/external multiplayer runtime infrastructure: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase.
- Direct `iceServers: []` connectivity still depends on LAN/NAT/IPv6. Never claim universal Internet P2P.

## Architecture discipline

- `ARCHITECTURE.md` is the current ownership map and future refactor direction.
- `game-web/src/main.ts` must remain a tiny entry point. Browser composition/order belongs in `runtime/startClientRuntime.ts`.
- One behavior should have one obvious owner. Fix owner modules directly instead of adding runtime monkey-patches.
- Do not add new `THREE.*.prototype` patches or startup modules that replace another module's implementation after boot unless an explicit compatibility constraint requires it.
- Avoid per-frame polling whose only purpose is to repair state written incorrectly by another owner.
- `window.goneGame` is a compatibility facade used by focused runtime modules and smoke tests. Preserve existing members, but prefer typed imports/callbacks/context objects for new internal code.

## Stack / build

- Browser FPS: TypeScript + Vite + Three.js under `game-web/`.
- Core: Rust/WASM under `game-core/`; `game-web/pkg/game_core.js` is a functional fallback but Vercel `game-web/build.sh` rebuilds Rust WASM before Vite.
- Browser compile gate: `game-web/package.json` runs `tsc && vite build`; TS has `noUnusedLocals` and `noUnusedParameters` enabled.
- Main direct-push compile gate is normally Vercel status. Historical rescue CI does not necessarily run on every `main` push.

## Runtime composition

- `game-web/src/main.ts` imports CSS and calls `startClientRuntime()`.
- `runtime/startClientRuntime.ts` owns startup phases and ordering: protocol/authority guards, bootstrap, network features, gameplay features, presentation/diagnostics.
- `gameplay/engine.ts` is now the local loop/physics/camera/viewmodel coordinator plus compatibility facade. Do not grow it back into the home for every subsystem.

## Local player / spawn

- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy lives in `gameplay/spawnPolicy.ts`.
- Slot 0 spawn is X=+1200, Z=+1200 (SE giant crater). Other multiplayer slots are deterministic across the map.
- `engine.ts` performs normal initial spawn and local respawn directly with terrain-correct Y.
- `gameplay/spawnController.ts` only adapts host authoritative respawn records and exposes manual diagnostics; it must not reintroduce a per-frame corrective local teleport.
- Never reintroduce `(0,17.5,0)` as intended gameplay spawn.

## Weapons / local shots

Canonical browser gameplay balance is `game-web/src/weapons/weaponConfig.ts`; Rust counterpart is `game-core/src/weapons.rs`. Shared balance values must stay aligned.

- AR: 30/120, 18 dmg, 180 m, falloff 35→140 to 10, head ×1.5, 6.25 rps.
- Sniper: 5/25, 70 dmg, 550 m, falloff 180→450 to 50, head ×2, 1 rps.
- Shotgun: 6/30, 64 dmg, 42 m, falloff 8→30 to 20, head ×1.25, 1.25 rps.
- SMG: 36/180, 12 dmg, 90 m, falloff 15→65 to 7, head ×1.5, 10 rps.
- Knife: 50 dmg, 2.6 m hard range, head ×1, no ammo.
- Browser and Rust damage return 0 past hard range.

`weapons/weaponCombatStats.ts` owns only recoil/viewmodel tuning and derives id/name/fire cadence from `weaponConfig.ts`; do not duplicate those values in `engine.ts`.

`gameplay/advancedWeaponController.ts` owns semi/auto LMB, RMB ADS/FOV/sensitivity, reload/ammo HUD and action animations. It no longer patches tracer range globally.

`gameplay/dynamicPrecisionReticle.ts` computes live FPS-style accuracy. `gameplay/precisionShotRuntime.ts` perturbs the local camera aim ray during `goneGame.fireWeapon()` so local raycast, tracer and transmitted authoritative direction use the same spread trajectory. Sniper scoped ADS is near-perfect; knife has no ballistic spread.

Local hitscan range is read directly from `weaponConfig.ts`. Do not recreate a `Raycaster.prototype` range guard.

## Tracer / shot presentation

- `vfx/tracerPool.ts` directly owns tracer travel/fade behavior. The beam grows from the muzzle toward the projectile head and fades after reaching the terminal point.
- Do not add a separate `TracerPool.prototype.update` patch module.
- `net/remoteShotPresentation.ts` is the current binary enemy-shot presenter for host/guests and derives actual third-person weapon muzzle transform.
- `net/legacyRemoteShotPresentation.ts` is compatibility-only for the old JSON FIRE_HITSCAN callback. Do not add new gameplay semantics there.
- Tracers are visual only; damage remains host-authoritative hitscan.

## Remote players

- `gameplay/remotePlayerRegistry.ts` owns remote model lifecycle, GLTF upgrade, interpolation presentation and remote shield presentation.
- `gameplay/networkBindings.ts` owns P2P callback ↔ gameplay-state wiring.
- `engine.ts` re-exports the legacy/public remote-player API for `window.goneGame`, but remote registry implementation does not belong in the engine.

Robot orientation/hitbox:

- Authored robot faces +Z while gameplay yaw-0 faces -Z. `models/orientedRobotBuilder.ts` applies the visual 180° adapter; do not compensate again in physics.
- Browser authoritative hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts`.
- Exactly two cheap AABBs: torso/propulsor + head/visor. No invisible volume below the floating mannequin; arms/outside empty space miss.
- Rust `intersect_ray_cylinder` remains a legacy compatibility API for historical WASM/tests; live browser PvP hitbox is the two-box model.

## Multiplayer / PvP

- Native WebRTC only: `net/directWebRtc.ts`, `RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })`, manual offer/answer, star host↔guests.
- Browser host is authoritative. Core binary opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED.
- State/snapshots ~30 Hz. `directWebRtc.ts` drops disposable state under backpressure.
- `net/networkStabilityFix.ts`: skip DataChannels not `open`; clean closing/closed peers instead of logging send failures every tick.
- `net/pvpTuning.ts`: maps host `performance.now()` timestamps to receiver-local clock; browser monotonic clocks do not share epochs.
- `net/hostRemoteSync.ts`: host renders guest state ~30 Hz and skips duplicate sequence transforms.
- `net/pvpHardening.ts`: pre-validates FIRE_HITSCAN; guest weapon must match authoritative replicated weapon, too-fast/duplicate shots are dropped, direction must be finite/normalized, and shot origin X/Z is anchored to authoritative shooter state. Hardening cadence is anti-spam validation, not cryptographic anti-cheat.

## Lobby / session

- `ui/lobby.ts` still mixes DOM and session orchestration and is a future refactor target.
- Live identity reconciliation: `net/lobbyPresenceSync.ts`.
- Colors remain host-authoritative through the normal color protocol; never trust color from presence packets.
- Player nickname is not credentials. `ui/dom.ts` uses `setAttribute('autocomplete','nickname')` because TS DOM typings reject direct assignment of `nickname`.
- `net/selfHostSession.ts` is active and imported by `ui/menu.ts`; do not classify it as dead code.

## World / rendering / performance

- Terrain: `game-core/src/lib.rs`; JS fallback: `game-web/pkg/game_core.js`.
- Global gameplay map window is ±2400 m (4.8×4.8 km); procedural terrain itself is unbounded.
- Landmark regions: NW massif ~(-1500,-1500), origin, SE crater/spawn ~(+1200,+1200).
- `world/chunkManager.ts`: chunk set changes only after crossing a 400 m boundary; rocks sample footprint terrain and unsupported rocks are culled.
- `world/naturalSunRays.ts`: cheap irregular crepuscular beams anchored across their footprint to terrain.
- `rendering/scene.ts`: antialias off, DPR ≤1.25, shadows off, high-performance GPU preference.
- `performance/localTelemetry.ts`: F3 local-only diagnostics. No telemetry leaves the browser.
- `performance/performancePack.ts`: home PRECARICA DATI warms/caches models, assets, audio and WASM before realtime play.

## Audio

- `audio/musicSourceGain.ts` applies source multiplier 0.25 after master×music sliders.

## High-value files

- Browser composition: `game-web/src/runtime/startClientRuntime.ts`
- Main loop/facade: `game-web/src/gameplay/engine.ts`
- Spawn policy/adapter: `game-web/src/gameplay/spawnPolicy.ts`, `spawnController.ts`
- Remote players: `game-web/src/gameplay/remotePlayerRegistry.ts`
- Gameplay↔network bridge: `game-web/src/gameplay/networkBindings.ts`
- Weapon UX: `game-web/src/gameplay/advancedWeaponController.ts`
- Weapon balance/recoil: `game-web/src/weapons/weaponConfig.ts`, `weaponCombatStats.ts`, `game-core/src/weapons.rs`
- Host/client: `game-web/src/net/p2pHost.ts`, `p2pClient.ts`
- PvP hardening/timing: `game-web/src/net/pvpHardening.ts`, `pvpTuning.ts`
- Direct RTC: `game-web/src/net/directWebRtc.ts`
- Hitbox/lag: `game-web/src/net/simpleLagCompensator.ts`, `robotHitbox.ts`, `game-core/src/lag_compensation.rs`
- Remote shots: `game-web/src/net/remoteShotPresentation.ts`
- VFX tracer owner: `game-web/src/vfx/tracerPool.ts`
- World chunks/rays: `game-web/src/world/chunkManager.ts`, `naturalSunRays.ts`
- Performance: `game-web/src/performance/localTelemetry.ts`, `performancePack.ts`

## Change discipline

1. Read this file and `ARCHITECTURE.md`, then only relevant high-value files.
2. Preserve host authority and zero-external-service networking.
3. Prefer fixing the owner module over layering a runtime patch.
4. Prefer focused modules over growing `engine.ts`; do not split cohesive data/protocol files merely to reduce line count.
5. Keep expensive work out of per-frame paths; reuse/pool Three resources.
6. Search imports/references before deleting suspected ghost code. Dynamic/global consumers must be considered.
7. When only GitHub API is available: create blobs → tree → off-ref commit → compare → one `main` ref update → monitor Vercel.
8. Never use contents API for intermediate file creation when deploy count matters; it commits immediately.
9. Build green does not equal visually verified on owner hardware; report that distinction precisely.

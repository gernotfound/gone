# G.O.N.E. — AI engineering context

Read this first. Dense project index intended to minimize repo search/tool spend.

## Owner constraints
- Repo: `gernotfound/gone`.
- Work directly on `main`; do not create branches unless owner explicitly changes this.
- Vercel free tier deploys per push. Use unreferenced Git blobs/tree/commit, inspect diff, then move `main` once.
- Owner is nontechnical: do not ask them to edit code or run commands. They test deployed Chrome/Brave gameplay.
- No paid/external multiplayer runtime infrastructure: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase.
- Direct `iceServers: []` connectivity still depends on LAN/NAT/IPv6. Never claim universal Internet P2P.

## Stack / build
- Browser FPS: TypeScript + Vite + Three.js under `game-web/`.
- Core: Rust/WASM under `game-core/`; `game-web/pkg/game_core.js` is a functional fallback but Vercel `game-web/build.sh` rebuilds Rust WASM before Vite.
- Main direct-push compile gate is Vercel status. Historical rescue CI does not necessarily run on every `main` push.

## Runtime entry
- `game-web/src/main.ts` boots focused controllers around legacy `gameplay/engine.ts`.
- `engine.ts` owns physics/camera, scene loop, viewmodel, base hitscan, remote registry and P2P bindings. Prefer focused runtime modules over rewriting it.
- `window.goneGame` exposes player, remotePlayers, VFX, weapon/fire helpers and active P2P host/client.

## Multiplayer / PvP
- Native WebRTC only: `net/directWebRtc.ts`, `RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })`, manual offer/answer, star host↔guests.
- Browser host is authoritative. Core binary opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED.
- State/snapshots ~30 Hz. `directWebRtc.ts` drops disposable state under backpressure.
- `net/networkStabilityFix.ts`: skip DataChannels not `open`; clean closing/closed peers instead of logging send failures every tick.
- `net/pvpTuning.ts`: maps host `performance.now()` timestamps to receiver-local clock; browser monotonic clocks do not share epochs.
- `net/hostRemoteSync.ts`: host renders guest state ~30 Hz and skips duplicate sequence transforms.
- `net/pvpHardening.ts`: pre-validation for FIRE_HITSCAN. Guest weapon must match authoritative replicated weapon, duplicate/too-fast guest shots are dropped, direction must be finite/normalized, and shot origin X/Z is anchored to authoritative shooter state. It also replaces the emergency browser cylinder fallback with the same robot AABB hitbox used by SimpleLagCompensator.
- Hardening cadence uses client monotonic deltas to reject obvious spam, not as cryptographic anti-cheat. Host itself remains trusted authority.

## Precision / hitscan
- `gameplay/dynamicPrecisionReticle.ts` computes live FPS-style accuracy from movement, crouch, sprint, airborne state, ADS and firing bloom. It publishes normalized accuracy in `#dynamic-precision-reticle.dataset.accuracy`.
- `gameplay/precisionShotRuntime.ts` makes that accuracy gameplay-real: immediately around `goneGame.fireWeapon()` it perturbs the camera aim ray inside the weapon spread cone, so local raycast, tracer and transmitted authoritative direction use one identical trajectory; camera orientation is restored before render.
- Sniper scoped ADS uses near-perfect spread; knife has no ballistic spread.
- Tracers remain visual only; damage remains host-authoritative hitscan.

## Robot / hitbox
- Authored robot faces +Z while gameplay yaw-0 faces -Z. `models/orientedRobotBuilder.ts` applies the visual 180° adapter; do not compensate again in physics.
- Browser authoritative hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts`.
- Exactly two cheap AABBs: torso/propulsor + head/visor. No invisible volume below the floating mannequin; arms/outside empty space miss.
- Rust `intersect_ray_cylinder` remains a legacy compatibility API for historical WASM/tests; live browser PvP hitbox is the two-box model.

## Weapons
Canonical browser balance: `game-web/src/weapons/weaponConfig.ts`; Rust/WASM counterpart: `game-core/src/weapons.rs`. Shared balance values must stay aligned.
- AR: 30/120, 18 dmg, 180 m, falloff 35→140 to 10, head ×1.5, 6.25 rps.
- Sniper: 5/25, 70 dmg, 550 m, falloff 180→450 to 50, head ×2, 1 rps.
- Shotgun: 6/30, 64 dmg, 42 m, falloff 8→30 to 20, head ×1.25, 1.25 rps.
- SMG: 36/180, 12 dmg, 90 m, falloff 15→65 to 7, head ×1.5, 10 rps.
- Knife: 50 dmg, 2.6 m hard range, head ×1, no ammo.
- Browser and Rust damage return 0 past hard range.
- `gameplay/advancedWeaponController.ts`: semi/auto LMB, RMB ADS/FOV/sensitivity, R reload, ammo HUD, scope/reticle base UX and action animations.
- `gameplay/killAmmoReset.ts`: locally earned fatal kill restores magazine + reserve for all weapons.

## Shot presentation
- `gameplay/tracerPresentationFix.ts`: visual beam grows from muzzle to projectile head, then fades at terminal point.
- `net/remoteShotPresentation.ts`: enemy shot presentation on host/guests; derives actual third-person weapon muzzle transform.
- Muzzle flash is copied once at weapon tip. Tracer movement and impact VFX are separate.

## Lobby
- UI: `ui/lobby.ts`; live identity reconciliation: `net/lobbyPresenceSync.ts`.
- Colors remain host-authoritative through normal color protocol; never trust color from presence packet.
- Player nickname is not credentials. `ui/dom.ts` uses `setAttribute('autocomplete','nickname')` because TS DOM typings reject direct assignment of `nickname`.

## Spawn / lifecycle
- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy: X=+1200, Z=+1200 (center of south-east gameplay-map quadrant / giant crater).
- `gameplay/spawnController.ts` computes terrain-correct Y at initial game entry and respawn and corrects host authoritative respawn records.
- Do not reintroduce `(0,17.5,0)` as intended gameplay spawn.

## World / map
- Terrain: `game-core/src/lib.rs`; JS fallback: `game-web/pkg/game_core.js`.
- Global gameplay map window is ±2400 m (4.8×4.8 km); procedural terrain itself is unbounded.
- `ui/minimap.ts`: cached topographic raster. `gameplay/liveMapOverlay.ts`: M overlay does not stop movement/fire; ESC closes map first; marker/coordinates/altitude/heading update live.
- Landmark regions: NW massif ~(-1500,-1500), origin, SE crater/spawn ~(+1200,+1200).
- `world/chunkManager.ts`: chunk set changes only after crossing a 400 m boundary; rocks sample footprint terrain and unsupported rocks are culled.
- `world/naturalSunRays.ts`: cheap irregular terrain-anchored crepuscular beams.

## Rendering / local diagnostics
- `rendering/scene.ts`: antialias off, DPR ≤1.25, shadows off, high-performance GPU preference.
- `performance/localTelemetry.ts`: F3 toggles local-only diagnostics: FPS/frame avg+p95+max, long tasks, draw calls/triangles/resources, chunk-boundary hitch, DataChannel buffered bytes/peer count, rejected guest shots and heap when browser exposes it. No telemetry leaves the browser.
- `performance/performancePack.ts`: home “PRECARICA DATI” button warms/caches models, current build assets, audio and WASM before realtime play; service worker is same-origin and cache HTML/navigation must not pin stale app versions.
- Treat network latency and render FPS as separate bottlenecks.

## Audio
- `audio/musicSourceGain.ts` applies source multiplier 0.25 after master×music sliders: 50% quieter than previous 0.50 source level without falsifying displayed slider percentages.

## High-value files
- Boot: `game-web/src/main.ts`
- Engine: `gameplay/engine.ts`
- Weapon UX: `gameplay/advancedWeaponController.ts`
- Precision UI/shot: `gameplay/dynamicPrecisionReticle.ts`, `gameplay/precisionShotRuntime.ts`
- Balance: `weapons/weaponConfig.ts`, `game-core/src/weapons.rs`
- Host/client: `net/p2pHost.ts`, `net/p2pClient.ts`
- PvP hardening/timing: `net/pvpHardening.ts`, `net/pvpTuning.ts`
- Direct RTC: `net/directWebRtc.ts`
- Hitbox/lag: `net/simpleLagCompensator.ts`, `net/robotHitbox.ts`, `game-core/src/lag_compensation.rs`
- Remote shots: `net/remoteShotPresentation.ts`
- Network stability: `net/networkStabilityFix.ts`
- Performance: `performance/localTelemetry.ts`, `performance/performancePack.ts`
- Spawn/map/world: `gameplay/spawnController.ts`, `gameplay/liveMapOverlay.ts`, `ui/minimap.ts`, `world/chunkManager.ts`

## Change discipline
1. Read this file, then only relevant high-value files.
2. Preserve host authority and zero-external-service networking.
3. Prefer focused modules over large `engine.ts` rewrites.
4. Keep expensive work out of per-frame paths; reuse/pool Three resources.
5. When only GitHub API is available: create blobs → tree → off-ref commit → compare → one `main` ref update → monitor Vercel.
6. Never use contents API for intermediate file creation when deploy count matters; it commits immediately.
7. Build green ≠ visually verified on owner hardware. Report that distinction precisely.

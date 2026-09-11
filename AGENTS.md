# G.O.N.E. — AI engineering context

Read this first. It is intentionally dense so an AI can work with minimal repo search/tool spend.

## Owner constraints
- Repo: `gernotfound/gone`.
- Work directly on `main` unless owner explicitly changes this. Do not create branches by default.
- Vercel free tier deploys per push: batch into one atomic commit/ref update. Prefer unreferenced Git blobs/tree/commit, inspect diff, then move `main` once.
- Owner is nontechnical; do not ask them to edit/run code. They test in browsers (commonly Chrome host + Brave guest).
- No paid/external multiplayer runtime services: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase. Direct reachability still depends on LAN/NAT/IPv6; never claim universal Internet P2P.

## Stack / build
- Browser FPS: TypeScript + Vite + Three.js in `game-web/`.
- Core: Rust/WASM in `game-core/`; `game-web/pkg/game_core.js` is a functional JS fallback and must remain API-compatible.
- Vercel web build: `game-web/build.sh` (wasm-pack + Vite). wasm-pack “newer version available” is only a warning unless build actually fails.
- Main compile gate for direct-main work is Vercel status; historical rescue CI may not run on every direct `main` push.

## Runtime entry
- `game-web/src/main.ts` should stay small; it boots focused controllers around legacy `gameplay/engine.ts`.
- `engine.ts` owns scene/game loop, physics/camera, local viewmodel, base hitscan, remote registry and P2P bindings. Avoid rewriting it if a focused module can use `window.goneGame`.
- `window.goneGame` exposes player, remotePlayers, VFX, weapon/fire helpers and active P2P host/client.

## Multiplayer / PvP
- Native direct WebRTC: `net/directWebRtc.ts`; `RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })`.
- Manual offer/answer signaling; star topology host↔guests. Browser host is authoritative.
- Host/client/protocol: `net/p2pHost.ts`, `p2pClient.ts`, `binaryProtocol.ts`.
- High-frequency packets are binary. Core opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED. Do not introduce JSON in high-frequency traffic.
- State/snapshots ~30 Hz. `directWebRtc.ts` drops disposable state under backpressure.
- `net/networkStabilityFix.ts`: broadcast must skip channels not `open`; `closing/closed` peers are cleaned instead of throwing/logging every snapshot tick.
- `net/pvpTuning.ts`: normalize host timestamps to receiver-local `performance.now()` domain. Browser monotonic clocks do not share epochs.
- `net/hostRemoteSync.ts`: host renders guest motion ~30 Hz and does not push duplicate unchanged sequence states.
- Hitscan remains host-authoritative with lag compensation. Tracers are presentation only.

## Lobby
- UI: `ui/lobby.ts`.
- Live name/color sync: `net/lobbyPresenceSync.ts`. Color remains host-validated by regular color protocol; never trust guest color from presence packets.
- Required: Chrome↔Brave name/color changes appear without reconnect.
- Player-name field is a public display name, not credentials. `ui/dom.ts` uses `setAttribute('autocomplete','nickname')` because TS DOM typings reject assigning `nickname` directly to `.autocomplete`.

## Robot / hitbox
- Authored robot front is +Z; gameplay/camera yaw-0 forward is -Z. `models/orientedRobotBuilder.ts` applies a 180° visual adapter. Do not compensate again in physics.
- Raw anatomy/socket: `models/robotBuilder.ts`; weapon geometry/viewmodels: `models/weaponBuilders.ts`.
- Authoritative browser hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts`.
- Hitbox intentionally uses two cheap boxes only: torso/propulsor + head/visor. No invisible cylinder below the floating mannequin; arms/outside empty space should miss.

## Weapons
Canonical browser config: `weapons/weaponConfig.ts`.
- AR: 30/120, 180 m.
- Sniper: 5/25, 550 m.
- Shotgun: 6/30, 42 m, shell reload.
- SMG: 36/180, 90 m.
- Knife: 2.6 m, no ammo.
- Damage falloff/ranges are enforced by browser host lag validator; keep Rust weapon semantics aligned when shared balance changes.
- `gameplay/advancedWeaponController.ts`: LMB semi/auto, RMB per-weapon ADS/FOV/sensitivity, R reload, ammo HUD, reticles/scope and reload/pump/bolt/slash viewmodel motion.
- `gameplay/killAmmoReset.ts`: a locally earned fatal kill fully restores magazine + reserve for all weapons.
- `gameplay/tracerPresentationFix.ts`: visual projectile beam grows from physical muzzle to projectile head, then fades at impact. It must not appear only in the final segment.
- `net/remoteShotPresentation.ts`: enemy FIRE_HITSCAN presentation on host and guests; derives muzzle from actual third-person weapon socket/muzzle transform. Muzzle flash is copied once at the weapon tip; tracer moves separately; impact VFX stays at the terminal point.
- Do not convert visual tracers into authoritative simulated projectiles unless networking is intentionally redesigned.

## Spawn / lifecycle
- 100 HP; host authoritative. ~10 s spawn shield; ~5 s death phase.
- Current spawn policy: center of south-east map quadrant: X=+1200, Z=+1200. This is also the giant SE crater center by design/request.
- `gameplay/spawnController.ts` computes Y from procedural terrain + player height/float and applies it at first gameplay entry + every respawn. It also corrects authoritative host respawn records immediately.
- Do not reintroduce old `(0,17.5,0)` as intended gameplay spawn.

## World / global map
- Terrain: `game-core/src/lib.rs`; JS fallback mirror: `game-web/pkg/game_core.js`.
- Global gameplay map window: ±2400 m (4.8×4.8 km), while procedural terrain itself is mathematically unbounded.
- Authored landmarks: NW massif around (-1500,-1500); giant SE crater + spawn around (+1200,+1200); origin (0,0).
- `ui/minimap.ts`: cached topographic raster, low elevation dark / high elevation light, relief + contours.
- `gameplay/liveMapOverlay.ts`: M is a non-blocking overlay; pointer lock/movement/aim/fire continue. ESC closes map before pause. Player marker updates live without reopening. HUD shows X/Z, terrain altitude, flight height, heading/cardinal, quadrant, distance to spawn, map size, scale and landmark markers.
- Keep map background static/cached; only marker/telemetry should update frequently.

## Chunks / rocks / sun rays
- `world/chunkManager.ts`: nearby chunks only; chunk set changes only after crossing 400 m chunk boundary.
- Rocks sample multiple terrain points under footprint, use limited tilt and are culled when unsupported; never return to one center sample + arbitrary 3-axis rotation.
- `world/naturalSunRays.ts`: keeps god rays cheap (shared low-poly geometry) but deforms the cone silhouette into irregular crepuscular beams. Each ray is terrain-anchored and extends from actual ground toward cloud altitude; no fixed zero-level truncation.

## Rendering / performance
- `rendering/scene.ts`: antialias off, DPR capped ~1.25, dynamic shadow map off, high-performance GPU preference.
- Do not re-enable 2× DPR + 2048² dynamic shadows without measurement.
- VFX pooling: `vfx/tracerPool.ts`, impacts etc. Damage vignette is DOM/CSS.
- Separate GPU FPS problems from network latency. Avoid per-RAF expensive terrain/chunk/map regeneration.

## Audio
- Sliders remain normal UI percentages.
- `audio/musicSourceGain.ts` applies source gain 0.25 (50% quieter than previous 0.50 source multiplier) after master×music sliders; do not “fix” this by changing displayed slider percentages.

## Key file map
- Boot: `game-web/src/main.ts`
- Engine: `game-web/src/gameplay/engine.ts`
- Weapon UX: `gameplay/advancedWeaponController.ts`
- Spawn: `gameplay/spawnController.ts`
- Ammo kill reward: `gameplay/killAmmoReset.ts`
- Live map: `gameplay/liveMapOverlay.ts`, `ui/minimap.ts`
- Weapon balance: `weapons/weaponConfig.ts`
- Host/client: `net/p2pHost.ts`, `p2pClient.ts`
- Direct RTC: `net/directWebRtc.ts`
- Lag/hitbox: `net/simpleLagCompensator.ts`, `net/robotHitbox.ts`
- Remote shots: `net/remoteShotPresentation.ts`
- Network send stability: `net/networkStabilityFix.ts`
- PvP timing: `net/pvpTuning.ts`
- Host remote rendering: `net/hostRemoteSync.ts`
- Lobby sync: `net/lobbyPresenceSync.ts`
- Map terrain/chunks: `world/chunkManager.ts`, `game-core/src/lib.rs`
- Sun rays: `world/naturalSunRays.ts`
- Scene/perf: `rendering/scene.ts`
- Audio source gain: `audio/musicSourceGain.ts`

## Change discipline
1. Read this file, then only relevant high-value files.
2. Preserve host authority and no-external-service networking.
3. Prefer focused modules over large `engine.ts` rewrites.
4. Keep per-frame allocations/work low; reuse pooled Three.js resources.
5. When only GitHub API is available: blobs → tree → off-ref commit → compare → one `main` ref update → monitor Vercel.
6. Do not spend deploys on experiments. Build green ≠ visually verified on owner hardware.
7. Update this file only when an architectural invariant changes; keep it compact.

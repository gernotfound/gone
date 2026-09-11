# G.O.N.E. — AI engineering context

Read this file first. It is intentionally dense: use it as the project index before searching the repo.

## Owner constraints
- Repository: `gernotfound/gone`.
- Work directly on `main` unless the owner explicitly says otherwise. Do **not** create rescue/refactor branches by default.
- Vercel free tier deploys on pushes: batch work into one atomic push; use unreferenced Git blobs/trees/commits for review before moving `main`.
- The owner is nontechnical: do not ask them to edit code or run commands. They test the deployed game in browsers.
- No paid/external multiplayer infrastructure. Do not add hosted signaling, relay, database, STUN, TURN, PeerJS cloud, Firebase, Supabase, etc.
- Never claim universal Internet P2P: with `iceServers: []`, direct connectivity depends on network/NAT/IPv6 conditions.

## Product
G.O.N.E. is a browser arena FPS: TypeScript/Vite/Three.js frontend + Rust/WASM core. The room creator's browser is the authoritative game server; guests connect directly over native WebRTC DataChannels.

## Build/deploy
- Web: `game-web/`.
- Core: `game-core/`.
- Vercel build entry: `game-web/build.sh`.
- `build.sh` installs wasm target/wasm-pack, builds `game-core` into `game-web/pkg`, then runs Vite build.
- `game-web/pkg/game_core.js` is also a functional JS fallback for environments that run Vite without wasm-pack. Keep its public API compatible with Rust output.
- GitHub Actions workflow `.github/workflows/rescue-ci.yml` historically targets rescue branches/PRs, not necessarily direct `main` pushes. Vercel status is therefore the direct-main compile gate unless the workflow is changed intentionally.

## Runtime entry points
- `game-web/src/main.ts`: bootstraps UI/game plus compatibility/controllers. Keep it small.
- `game-web/src/gameplay/engine.ts`: legacy central loop; physics, camera, viewmodel, hitscan, remote rendering and networking bindings. Large/risky file: prefer focused modules around its public `window.goneGame` API when possible.
- `window.goneGame` exposes player, viewmodel, fire/switch weapon, remote player registry, VFX, P2P host/client and test helpers.

## Multiplayer: current truth
- Native WebRTC only: `game-web/src/net/directWebRtc.ts`.
- `RTCPeerConnection({ iceServers: [], bundlePolicy: 'max-bundle' })`.
- Manual signaling: host creates offer encoded in URL fragment `#direct=...`; guest returns an answer code; host pastes it.
- No runtime signaling service. `mockChannel.ts`, `relayWebSocket.ts` and PeerJS-related remnants are legacy/dead paths unless explicitly reactivated.
- Topology: star, host ↔ each guest. One RTCPeerConnection per guest.
- Host authority: `p2pHost.ts`; guest: `p2pClient.ts`; binary protocol: `binaryProtocol.ts`.
- Realtime state is 30 Hz. `directWebRtc.ts` already drops disposable CLIENT_STATE/WORLD_SNAPSHOT when channel backpressure exceeds its threshold; do not blindly add queues.
- `pvpTuning.ts` maps host `performance.now()` timestamps into the receiver's local clock before interpolation. This is mandatory because browser monotonic clocks have unrelated epochs.
- `hostRemoteSync.ts` mirrors guest records into the host renderer at ~30 Hz and only pushes a transform when `lastClientSeq` changes.
- Interpolation math: `interpolationBuffer.ts`, ~90 ms render delay + bounded extrapolation.
- Hitscan remains host-authoritative. Tracers are visual only.

## Lobby presence
- Main UI: `ui/lobby.ts`.
- Color uniqueness remains host-authoritative through `LocalColorRegistry` / color protocol.
- `net/lobbyPresenceSync.ts` adds a small binary identity packet for live name propagation and reconciles lobby DOM from authoritative session data.
- Never trust guest-provided color in presence sync; the regular COLOR_REQUEST path owns color validation.
- Required behavior: name and color changes on Chrome host must appear on Brave guest and vice versa without reconnecting.

## Weapons
Five weapons: `assalto`, `cecchino`, `pompa`, `mitraglietta`, `coltello`.

Primary browser runtime contract: `game-web/src/weapons/weaponConfig.ts`.
- AR-42 Viper: automatic, 30/120, 180 m hard range, 35→140 m falloff, 2.15 s reload.
- SR-99 Railphantom: semi, 5/25, 550 m, 180→450 m falloff, 2.85 s reload, high-magnification ADS.
- SG-12 Havoc: semi, 6/30, 42 m, 8→30 m falloff, shell-by-shell reload (~0.68 s/shell).
- SMG-7 Neon Hornet: automatic, 36/180, 90 m, 15→65 m falloff, 1.85 s reload.
- CB-01 Shadowfang: melee, 2.6 m, no ammo/reload.

`gameplay/advancedWeaponController.ts` owns browser weapon UX without moving damage authority out of the host:
- LMB firing cadence + semi/auto distinction.
- RMB ADS with per-weapon FOV and mouse sensitivity.
- `R` reload; magazine vs shell reload behavior.
- Ammo/reserve HUD, per-weapon reticles/scope.
- Outer viewmodel rig for reload, pump/bolt/slash/action animation.
- Visual tracer length clamped to weapon hard range.

`net/simpleLagCompensator.ts` is the live browser host validator used by lobby setup. It reads browser weapon range/falloff config and calculates authoritative damage. Keep Rust `game-core/src/weapons.rs` semantically aligned when changing shared combat balance; Rust remains important for tests/WASM paths even when the browser lobby uses the TS lag compensator.

Do not turn visible tracers into authoritative physical projectiles unless the networking model is intentionally redesigned.

## Robot/model orientation
- Authored robot anatomy faces **+Z**: visor/chest/weapon are front; backpack is -Z.
- Gameplay/camera yaw-0 forward is **-Z**.
- `models/orientedRobotBuilder.ts` applies the 180° visual adaptation. Do not “fix” physics yaw to compensate again.
- Raw procedural anatomy: `models/robotBuilder.ts`; weapons/socket/viewmodels: `models/weaponBuilders.ts`.

## World / map
- Procedural terrain source: `game-core/src/lib.rs`; JS fallback mirrors it in `game-web/pkg/game_core.js`.
- Notable authored procedural landmarks: NW high mountain massif around (-1500,-1500), giant SE crater around (+1200,+1200), central safe spawn.
- Terrain is mathematically unbounded. The **global gameplay map window** shown by M is fixed to ±2400 m (4.8 km square), not “all infinite terrain”.
- `ui/minimap.ts` caches a global topographic raster: low altitude dark, high altitude light, slope relief + contour lines; player marker moves in absolute world coordinates.
- `world/chunkManager.ts`: renders nearby chunks only. Chunk neighborhood is recalculated only on a 400 m chunk boundary.
- Rock placement must sample terrain under the footprint. Rocks on unsupported steep spans are culled; X/Z tilt is deliberately limited. Never return to arbitrary full 3-axis rock rotations with a single center-height sample.

## Rendering/performance
- `rendering/scene.ts`: pixel ratio capped ~1.25, antialias disabled, dynamic shadow map disabled, high-performance GPU preference, sparse god rays.
- Do not re-enable 2× DPR + 2048² dynamic shadows without measured budget.
- Expensive work must not run each RAF if it depends only on chunk/map/state changes.
- VFX are pooled where practical (`vfx/tracerPool.ts`, `impactParticles.ts`). Damage vignette is DOM/CSS to avoid post-processing cost.
- Performance must be judged separately from network latency. Browser FPS and WebRTC jitter are different bottlenecks.

## Combat/player lifecycle
- 100 HP; host authoritative.
- Initial/respawn invulnerability shield ~10 s.
- Death → ~5 s phase → respawn center `[0, 17.5, 0]`.
- `healthHud.ts` owns health/shield/death UI and damage vignette.
- `shieldVfx.ts` owns shield mesh lifecycle/disposal.

## Input
- Legacy movement/input: `controls/playerInput.ts`.
- Advanced weapon controller intercepts combat mouse input only while pointer-locked, then updates the legacy input yaw/pitch so movement/camera remain compatible.
- `M`: global map overlay.
- `1..5`: weapons.
- LMB: fire, RMB: ADS/focus, `R`: reload.

## Protocol invariants
- High-frequency traffic is binary ArrayBuffer/DataView little-endian.
- Core opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED; lobby opcodes live in `binaryProtocol.ts`.
- Presence sync reserves 0x1e locally in `lobbyPresenceSync.ts`.
- Do not add JSON to high-frequency DataChannel traffic.
- Host health, death, respawn, colors and hit validation are authoritative.

## Resource/memory rules
- Dispose non-shared Three.js geometry/material resources when removed.
- GLTF/cache assets may be tagged `userData.sharedAsset`; do not dispose shared cached resources accidentally.
- Prefer pooling/reuse for per-shot/per-frame objects.

## High-value file map
- Boot: `game-web/src/main.ts`
- Game loop: `game-web/src/gameplay/engine.ts`
- Weapon UX: `game-web/src/gameplay/advancedWeaponController.ts`
- Weapon balance: `game-web/src/weapons/weaponConfig.ts`
- Host/client: `game-web/src/net/p2pHost.ts`, `p2pClient.ts`
- Direct RTC: `game-web/src/net/directWebRtc.ts`
- PvP timing: `game-web/src/net/pvpTuning.ts`
- Host visual sync: `game-web/src/net/hostRemoteSync.ts`
- Lobby sync: `game-web/src/net/lobbyPresenceSync.ts`
- Binary codecs: `game-web/src/net/binaryProtocol.ts`
- Lag validation: `game-web/src/net/simpleLagCompensator.ts`, `game-core/src/lag_compensation.rs`
- Map: `game-web/src/ui/minimap.ts`
- Chunks/rocks: `game-web/src/world/chunkManager.ts`
- Terrain: `game-core/src/lib.rs`
- Rendering: `game-web/src/rendering/scene.ts`
- Robot/weapons models: `game-web/src/models/`
- Real browser smoke scripts: `game-web/scripts/rescue_*_smoke.mjs`

## Change discipline for future AI
1. Read this file and only the relevant high-value files above; avoid repo-wide searching unless needed.
2. Preserve host authority and zero-external-service networking.
3. Prefer focused new modules/small-file changes over risky rewrites of `engine.ts` or P2P core.
4. Build/test before moving `main` when an execution environment is available. Useful gates: `npm run build --prefix game-web`, existing Node E2E runner, browser smoke, Rust tests.
5. When only GitHub API is available, create blobs/tree/commit off-ref, inspect the commit diff, then move `main` once. Monitor Vercel status.
6. Do not spend Vercel deploys on intermediate experiments.
7. Record any new architectural invariant here in compact form.
8. Report limitations precisely; “build green” is not the same as “gameplay visually verified on the owner's hardware”.

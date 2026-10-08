# G.O.N.E. — AI engineering context

Read this first. This is the dense working context for `gernotfound/gone`; use it to minimize repo search and avoid regressions across desktop, iPhone/PWA, direct WebRTC and self-host.

## Owner / release constraints

- Never write directly to `main`. Work on a dedicated branch and PR.
- Vercel production builds are push-sensitive. Fully validate the branch, then land **exactly one squash commit** on `main`.
- Vercel is configured for `main` deployment only. Never manually deploy a feature branch.
- Recheck current `main` before branching/merging; do not rely on a remembered SHA.
- The owner tests physical iPhone/PWA. Treat those reports as hardware QA; browser emulation is necessary but not equivalent.
- No paid/external multiplayer runtime infrastructure: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase.
- Direct `iceServers: []` connectivity still depends on LAN/NAT/IPv6. A terminal RTC close requires renegotiation; never claim magic reconnect.
- There are currently no production users requiring data migrations/backfills. Prefer current-state cleanup and canonical contracts over retroactive compatibility migrations unless explicitly requested.

## Production / Vercel

- Team: `gnfcreator` (`team_1ZCv2fwzf1KEgunz53M5xtbo`).
- Project: `gone` (`prj_wUtFswu415AIVQSlkks5BzlEtSUV`), Vite, linked to `gernotfound/gone`.
- Primary alias: `https://gone-gnf.vercel.app`.
- `game-web/vercel.json` owns main-only deployment and response security headers.
- `/version.json`, `/gone-cache-sw.js`, `/api/client-telemetry` are intentionally `no-store`.
- After the single merge verify independently: deployment `READY`, Git SHA == new main, `/version.json` build ID == new main, security headers and relevant runtime logs. GitHub CI alone is not production verification.

## Architecture discipline

`ARCHITECTURE.md` is canonical ownership documentation.

Rules:

- one behavior/state → one obvious owner;
- fix owner modules, do not layer repair modules over them;
- no runtime method monkey-patches for internal correctness;
- no polling to repair state that should transition explicitly;
- never reset another module's private `__gone*Started` flag;
- no `THREE.*.prototype` patches;
- compatibility `window.gone*` facades must remain stable for current consumers/tests, but new internal code should use typed imports/events/context/bridges.

## Stack / build / CI

- Browser FPS: TypeScript + Vite 8 + Three.js under `game-web/`.
- Core: Rust/WASM under `game-core/`; `game-web/pkg/game_core.js` remains the functional browser fallback.
- Browser compile gate: `tsc && vite build` with unused-code checks and `erasableSyntaxOnly`; do not use TypeScript syntax that requires runtime erasure transforms such as parameter properties.
- Full PR and post-merge `main` gate: `.github/workflows/rescue-ci.yml` — the PR head or push SHA is explicitly checked out and verified before testing; the synthetic PR merge ref is forbidden. `scripts/check_ci_contract.mjs` enforces stable check and browser-smoke coverage. Tier completion thresholds now affect exit status. TypeScript/Vite, all E2E tiers, Chromium runtime/direct multiplayer/scale/combat/session/self-host/full-match/mobile smokes, Rust and the final quality gate are mandatory. The PWA version prefers the Vercel deployment SHA, an explicit local override or the checked-out git HEAD before falling back to the event SHA. A green PR run does not stand in for independent CI on `main`.
- Vite/Rolldown keeps Three.js in the stable `three-vendor` chunk with strict execution order. Do not broadly split side-effect-heavy application modules without measurement.

## Runtime kernel / lifecycle

`game-web/src/main.ts` is declarative composition only.

`runtime/runtimeKernel.ts` owns startup, dependencies, criticality, reconciliation and health. Module states: `registered`, `starting`, `ready`, `failed`, `blocked`. Health: `booting`, `healthy`, `degraded`, `failed`.

Critical invariants:

- `browserLifecycle`;
- `bootstrap`;
- `advancedWeaponController` — finite ammo is semantic authority, not optional UI.

`runtime/startClientRuntime.ts` owns the client module graph. A critical failure emits `gone-runtime-unavailable`; `ui/runtimeAvailabilityUi.ts` presents fail-closed recovery. Device combat controls only start when both bootstrap and ammo authority are ready.

`runtime/browserLifecycle.ts` owns shared visible/hidden, focus/blur, online/offline, pageshow/pagehide and beforeunload delivery. Subscribers have names/priorities and failures are isolated as `gone-runtime-lifecycle-error`. Input release must precede session/network resume. Device-local pointer/touch/resize/orientation/sensor events stay local.

## Multiplayer session ownership — critical

`game-web/src/net/multiplayerSessionController.ts` is the **single browser owner** of multiplayer session lifecycle.

It owns:

- `activeP2PHost` / `activeP2PClient`;
- local session id and local player color;
- lobby roster snapshot;
- direct WebRTC host offer / guest answer orchestration;
- accepted host peer channels and deterministic teardown;
- P2P guest callbacks: join/color/roster/status/game-start;
- role transition generation and `gone-session-changed`;
- presentation snapshots (`gone-session-state` / `window.goneSession`).

It must **not** import DOM or `engine.ts`.

`ui/lobby.ts` is presentation + intent only. It may render roster/color/invite/answer controls and forward actions to `multiplayerSessionController`; it must not construct `P2PClient`, `P2PHost`, direct SDP sessions or lag compensators.

`gameplay/engine.ts` registers a typed `SessionRuntimeBridge` once. The bridge attaches host/client gameplay networking, clears/removes remote players, applies local color presentation and exposes gameplay readiness. Do not replace this with `window.goneGame` lookups from session code.

`gameplay/networkBindings.ts` imports session setters from `net/multiplayerSessionController.ts`, never from UI.

`net/selfHostSession.ts` owns only relay transport/status UI. Host peers enter through `multiplayerSessionController.registerHostPeer`; relay guests use `startGuestOnChannel`. Do not reintroduce a separate self-host `P2PClient`, roster, color callback graph or rendering guard.

`net/sessionLifecycleHardening.ts` was intentionally removed. Do not reintroduce setter monkey-patches or periodic (`setInterval`) repair polling. Replacement/teardown/remote cleanup/session events are explicit controller transitions.

`SessionP2PHost` inside the controller is an explicit compatibility adapter that observes existing lobby `COLOR_CHANGED` broadcast packets; it does not overwrite host methods at runtime.

## Color ownership

`net/colorRegistry.ts` is the canonical host-side neon color allocator (local and WASM adapter). `P2PHost` owns peer/session lifecycle and consumes this allocator; legacy `p2pHost.ts` registry exports are compatibility re-exports only. Do not maintain competing color ownership state inside the host or UI.

## Direct WebRTC / network authority

- `net/directWebRtc.ts`: manual offer/answer, `iceServers: []`, star host↔guests.
- Browser host is authoritative.
- Guest movement is client-predicted but host-validated. `net/movementAuthority.ts` owns the movement envelope; `p2pHost.ts` owns accepted transform state.
- Movement limits come from Rust physics (30 m/s max horizontal, 25 m/s jump, 54 m/s terminal fall), use host receipt time, bounded jitter/cumulative credit and a separate per-packet teleport ceiling.
- Rejected movement must not advance position, sequence/timestamp authority, health-pickup proximity or lag-compensation history.
- Movement through canonical maze walls is a host-side rejection reason. Local prediction resolves the same geometry with wall sliding.
- Host hitscan must stop at canonical maze walls before applying player damage; local/remote raycasts include the rendered maze only for matching presentation.
- Spawn/respawn are explicit host-authorized transitions that reset movement validation; clients reconcile from authoritative self snapshots rather than inventing a second multiplayer respawn coordinate.
- `gameplay/networkBindings.ts` may snap the local predicted player only for first authority seed, host respawn or large authority divergence; normal prediction remains local.
- Binary core opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED.
- `NativeRtcDataChannel`: ~3 s heartbeat, ~15 s timeout, ~6 s grace for transient `disconnected`.
- `adaptiveSnapshotRate.ts`: host cadence adaptation; normal target ~30 Hz.
- `mobileSessionResume.ts`: release input on hidden/offline and restore safe cadence on surviving RTC after foreground/online.
- Terminal direct RTC failure still needs new SDP negotiation; `gone-reconnect-requested` is intent, not transparent reconnection.

## Self-host

- `gone-host/` is active infrastructure, not dead tooling.
- `gone-host/server.mjs` serves `game-web/dist`, `/__gone_host/status`, `/__gone_host/ws` and relay traffic to the browser host.
- Root launchers `.cmd`, `.ps1`, `.sh` are required.
- Browser transport: `net/selfHostSession.ts` + `net/relayWebSocket.ts`.
- Session state/callbacks still belong to `multiplayerSessionController`.

## Main menu / controls legend

- `ui/menu.ts` owns main/settings/lobby visibility and media UX.
- `ui/controlsLegend.ts` owns the `COMANDI` button and keyboard/mouse legend. It is inserted immediately above `VOLUME`.
- The legend must document movement, mouse look, FIRE, ADS, R reload, **E pickup**, Shift sprint, Space jump, C/Ctrl crouch, 1–5 weapons, M map and Esc pause.
- `PRECARICA DATI` belongs below `IMPOSTAZIONI`; do not move it back above volume/settings.

## Mobile / iPhone controls

Owners:

1. `mobile/mobileRuntime.ts` — generic touch movement/look/actions, virtual pointer lock, wake/orientation/fullscreen best effort, mobile DPR cap.
2. `mobile/smartphoneControlsGuard.ts` — idempotent fallback; explicit reconcile, no startup-flag reset.
3. `mobile/pubgTouchControls.ts` — ammo-safe FIRE drag, secondary claw FIRE, ADS drag, gyro, iOS-safe actions.
4. `mobile/competitiveTouchControls.ts` — simultaneous joystick/look/actions and live-map combat composition.
5. `mobile/touchPreferences.ts` — sensitivity, FIRE dead-zone, gyro, size/opacity, handedness, secondary FIRE.
6. `mobile/touchLayoutEditor.ts` — draggable persistent HUD offsets.
7. `mobile/mobileSessionResume.ts` — mobile background/network cadence repair.

Explicit `Comandi a schermo` overrides device heuristics; `Mouse + tastiera` hides touch UI. Input mode changes reconcile device modules through the runtime kernel; start attempts must remain one.

Competitive contract:

- left thumb movement + forward auto-sprint zone;
- right free-look;
- FIRE/ADS can drag camera;
- optional claw FIRE;
- jump/crouch/reload separate and combinable;
- weapon switching must work via pointer input on iOS;
- do not add prone/slide/lean UI until gameplay exists;
- map is non-modal on phone: movement/look/FIRE/ADS/reload/weapon switch remain usable; map stays partially transparent below touch controls; MAP must close itself while open.

## Local shot pipeline authority

`gameplay/engine.ts` is the only local shot entrypoint: it checks the explicit deathmatch permission from `deathmatchRoundLifecycle.ts` before executing `precisionShotRuntime.fireWithPrecision` around the shot commit. This covers engine-private, desktop/mobile controller and public compatibility `fireWeapon` callers. The round owner resets ammo through `advancedWeaponController.resetAllWeaponAmmoForRound`, which cancels reload, held trigger and ADS; engine registers the lifecycle respawn callback. Never monkey-patch `goneGame.fireWeapon` or poll for wrappers. `precisionShotRuntime` registers only legacy accuracy diagnostics.

## Ammo authority

`gameplay/advancedWeaponController.ts` is the only authoritative local owner of magazine/reserve/reload UX.

Touch sustained FIRE must **not** leave `inputState.fire = true`; the legacy engine continuous-fire path can bypass magazine accounting. Successful ranged shots decrement magazine exactly once. Zero magazine produces no shot until reload succeeds.

Canonical ammo:

- AR 30/120;
- Sniper 5/25;
- Shotgun 6/30 shell reload;
- SMG 36/180;
- Knife no ammo, damage 999, 2.6 m hard range.

Browser smoke mobile changes with pointerdown/pointermove; specifically verify reload, weapon switch, finite ammo and map-open fire.

## Supply pickup interaction

- `gameplay/craterSupplyPickups.ts` is the current compatibility filename for the central ammo/health crate owner; placement is no longer crater-based.
- Supplies spawn in the annulus defined by `CENTRAL_SUPPLY_MIN_RADIUS` / `CENTRAL_SUPPLY_MAX_RADIUS` around world origin and must stay outside the protected central spawn clearing.
- Proximity only selects the nearest useful crate and shows a prompt; it must **never auto-collect** in the animation loop.
- `controls/playerInput.ts` translates `KeyE` into `gone-pickup-requested`.
- Desktop collection requires `E`. Smartphone collection uses the contextual `TAKE` button created by the pickup owner and emits the same intent.
- `gameplay/craterSupplyPickups.css` owns contextual TAKE placement/handedness. The button must remain hidden when there is no useful nearby supply.
- Guest health pickup requests are host-guarded by the shared central supply annulus in `world/worldTopology.ts`; placement and authority must remain spatially aligned.
- Supply placement must reject points overlapping canonical maze walls.

## Audio / iOS

- BGM: `/Colossus March.mp3`, `<audio id="bg-music">`.
- `ui/menu.ts` owns media lifecycle/volume UI.
- `audio/musicSourceGain.ts` owns reduced source gain.
- `audio/soundSynth.ts` remains the verified procedural weapon signature and compatibility surface.
- `audio/enhancedWeaponAudio.ts` is the application weapon-audio layer. It reuses the canonical `soundSynth` singleton / AudioContext and adds HEAD, BODY, LFE, MECHANICAL and TAIL layers with bounded pitch/filter variation.
- Runtime weapon output carries a deliberate 1.20 gain multiplier before both the canonical signature and enhancement layers; preserve that contract unless balancing is explicitly changed.
- AR/SMG tails stay deliberately short so automatic fire remains articulate; sniper/shotgun may use longer decay/body. Do not add external weapon audio assets unless explicitly requested/licensed.
- iOS requires `play()` / Web Audio unlock from a real gesture. Keep persistent gesture recovery; foreground recovery is best-effort and may still require the next gesture.

## Performance preload / cache integrity

- `performance/performancePackManifest.ts` is the canonical preload identity/manifest owner.
- Pack identity is generated from the same `BUILD_ID` as the PWA service worker plus the current pack schema. Do not fingerprint Resource Timing entries to create a second worker/cache build identity.
- Required pack assets are deterministic: current Vite JS/CSS discovered from DOM plus explicit game models/icons and `/Colossus March.mp3`.
- Including the menu music is intentional: it is first-party, used immediately, and improves PWA/offline/first-play consistency.
- `performance/performancePack.ts` owns the user transaction and is single-flight. Any failed asset means the transaction is incomplete and retryable; never write a ready marker for partial success.
- `performance/cacheIntegrity.ts` validates the exact canonical manifest and reacts to `gone-performance-pack-complete`; do not race a running preload with arbitrary delayed timers.
- `public/gone-cache-sw.js` may cache a requested safe `gone-performance-pack-*` cache name, while its own registration version remains the PWA `BUILD_ID`.
- No legacy user migration/backfill is required; stale local performance-pack markers/caches can be discarded in favor of the current canonical pack.

## World direction / presentation

- `docs/world_vision.md` is the current world direction.
- Streamed terrain uses canonical Rust/WASM vertex colors directly. The former `world/biomeRegistry.ts` tint/identity layer is intentionally removed; do not reintroduce quadrant biome recoloring without an explicit product decision.
- Decorative chunk-level natural sun-ray meshes and their shared render resources are intentionally removed. Standard hemisphere/directional scene lighting remains.
- The tactical map renders terrain relief plus canonical maze walls, player position and scale only; do not reintroduce loot/spawn ping layers or named place/landmark labels without an explicit product decision.
- `world/mazeLayout.ts` owns canonical deterministic maze geometry: an 18x18 coarse corridor grid with a 6x6 central void, ~420 m wall-free central clearing, four cardinal ~184 m entrances, seeded DFS passage carving, deterministic extra loops, paired/double walls, landmark clearings, spatial indexing and pure collision/occlusion queries. Client prediction, PvE movement and host authority must use this same layout.
- The maze must remain a **real branching topology**, not concentric control rings. Current target difficulty is 9/10: preserve many dead ends/junctions, only a small controlled set of alternate-route loops, and exactly one outer-world exit.
- Most corridors remain based on ~184 m cells, but a deterministic minority contain ~96 m choke sections. Chokes must remain traversable by player/spider authority and must never replace the broad-corridor identity across the whole maze.
- The only authored outer-world exit is on the east perimeter. The four cardinal openings around the center are entrances into the maze, not exits from the world perimeter.
- `world/mazeNavigation.ts` owns bounded A* routing over canonical maze collision. Do not add a divergent navmesh for the same walls.
- `world/mazePrototype.ts` owns only instanced wall presentation. Walls are deliberately extruded from Y=-600 to Y=+1200 so terrain cannot leave gaps below them and normal traversal cannot pass above them.
- The authored maze footprint ends near +/-1660 m, approximately 50% of the square playable area.

## Local gameplay / spawn

- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy: `gameplay/spawnPolicy.ts`.
- World/narrative center and slot 0 spawn are X=0, Z=0. Remaining multiplayer spawn slots stay inside the central origin clearing so players do not overlap.
- The southeast giant crater at X=+1200, Z=+1200 remains a landmark, not the spawn or supply center.
- `gameplay/networkBindings.ts` owns P2P↔gameplay state wiring and host per-slot respawn.
- `remotePlayerRegistry.ts` owns remote model lifecycle/interpolation/shield presentation.
- Solo spiders: `bionicSpiderEnemies.ts` + `models/bionicSpider.ts`; disabled in P2P until represented host-authoritatively. Spawn/movement respect canonical maze walls; blocked chases use bounded `mazeNavigation.ts` waypoint routing with throttled replans.

## Weapons

Canonical browser balance: `game-web/src/weapons/weaponConfig.ts`; Rust counterpart `game-core/src/weapons.rs`.

Current baseline:

- AR 18 dmg, 180 m, 6.25 rps;
- Sniper 70 dmg, 550 m, 1 rps;
- Shotgun 64 dmg, 42 m, 1.25 rps;
- SMG 12 dmg, 90 m, 10 rps;
- Knife 999 dmg, 2.6 m.

`weaponCombatStats.ts` owns recoil/viewmodel tuning derived from canonical config. Tracers/VFX never become damage authority.

## World / terrain / rendering

- Terrain math: `game-core/src/lib.rs`; JS fallback `game-web/pkg/game_core.js`.
- Gameplay map ±2400 m; procedural terrain itself unbounded.
- `world/worldConfig.ts`: chunk constants.
- `world/chunkManager.ts`: distance-prioritized progressive streaming, bounded expensive work.
- `terrainGeometryPool.ts`: geometry reuse.
- `rockInstances.ts`: instanced rocks.
- Terrain chunk edge normals are seam-safe; do not change terrain colors/palette without explicit request.
- Do not introduce naive mixed-resolution terrain LOD; use stitched edges/skirts/clipmap/quadtree if measurement justifies LOD.
- `rendering/scene.ts`: bounded DPR/high-performance profile.
- `performance/adaptiveRenderScale.ts`: sole render-quality governor.
- Vite/Rolldown isolates Three.js in `three-vendor` with `strictExecutionOrder: true`.

## PWA / safe update

- `pwa/pwaRuntime.ts` compares embedded `BUILD_ID` with `/version.json` using no-store, single-flight, 8 s timeout checks on startup/lifecycle/polling.
- `scripts/generate_build_version.mjs` writes both client build module and public beacon.
- Service-worker caches are build-aware; do not force reload during gameplay.
- PWA runtime and performance preload must register `/gone-cache-sw.js?v=<BUILD_ID>` consistently; performance-pack schema belongs in its cache name, not a competing worker version.

## Security / observability

- `vercel.json`: CSP, frame denial, nosniff, referrer/permissions policies and deployment rules.
- Gyroscope/accelerometer self-only; camera/mic/geolocation/payment/USB/magnetometer denied.
- `observability/clientDiagnostics.ts`: bounded privacy-safe failure diagnostics, not continuous analytics.
- Allowed context is coarse: build, event kind/message/stack, pathname, device bucket, input mode, standalone/online/visibility.
- Do not upload raw UA, full query URLs, identities, positions, chat/session codes or continuous FPS.
- `/api/client-telemetry` sanitizes, caps, deduplicates and must fail-open.

## High-value files

- Composition/health: `src/main.ts`, `runtime/runtimeKernel.ts`, `runtime/browserLifecycle.ts`, `runtime/startClientRuntime.ts`.
- Session: `net/multiplayerSessionController.ts`, `ui/lobby.ts`, `net/directWebRtc.ts`, `net/selfHostSession.ts`, `net/relayWebSocket.ts`.
- Gameplay/network bridge: `gameplay/engine.ts`, `gameplay/networkBindings.ts`, `gameplay/remotePlayerRegistry.ts`.
- Ammo/weapons: `gameplay/advancedWeaponController.ts`, `weapons/weaponConfig.ts`, `weapons/weaponCombatStats.ts`.
- Interaction/menu: `gameplay/craterSupplyPickups.ts`, `controls/playerInput.ts`, `ui/controlsLegend.ts`, `ui/menu.ts`.
- Audio: `audio/soundSynth.ts`, `audio/enhancedWeaponAudio.ts`, `audio/musicSourceGain.ts`.
- Preload: `performance/performancePackManifest.ts`, `performance/performancePack.ts`, `performance/cacheIntegrity.ts`, `public/gone-cache-sw.js`.
- Touch: `mobile/mobileRuntime.ts`, `smartphoneControlsGuard.ts`, `pubgTouchControls.ts`, `competitiveTouchControls.ts`, `touchPreferences.ts`, `touchLayoutEditor.ts`.
- PWA/mobile lifecycle: `pwa/pwaRuntime.ts`, `mobile/mobileSessionResume.ts`.
- Diagnostics: `observability/clientDiagnostics.ts`, `api/client-telemetry.js`.
- World: `world/chunkManager.ts`, `world/worldConfig.ts`, `world/worldTopology.ts`, `world/biomeRegistry.ts`, `world/mazeLayout.ts`, `world/mazeNavigation.ts`, `world/mazePrototype.ts`.

## Current structural direction

The runtime-kernel/browser-lifecycle foundation, lobby/session split, local player lifecycle split and procedural weapon-builder split are complete architecture directions. Next high-value structural work:

1. separate `p2pHost.ts` peer bookkeeping from authoritative combat without creating multiple authorities;
2. gradually migrate remaining internal `window.gone*` consumers to typed services/events.

`models/weaponBuilders.ts` is the stable weapon-model facade. Per-weapon procedural construction belongs in `models/weapons/*.ts`; shared mesh primitives belong in `models/weapons/proceduralShared.ts`. Keep viewmodel/third-person transforms, sockets, GLTF loading and public exports in the facade unless ownership genuinely changes.

`gameplay/localPlayerLifecycle.ts` is the sole browser owner of local HP/death/respawn/spawn-shield transitions and their HUD/VFX/death-camera side effects. `engine.ts` composes it; `networkBindings.ts` synchronizes authoritative snapshots through it rather than mutating lifecycle state directly.

Transport readiness and stale-peer cleanup belong directly to `P2PHost.broadcastBinary`. Do not reintroduce `networkStabilityFix.ts`, prototype replacement, or another runtime repair layer.

Remote presentation and session observers (`remoteRobotMotion.ts`, `hostRemoteSync.ts`, `pvpTuning.ts`, `remoteShotPresentation.ts`, `killAmmoReset.ts`) use the existing typed `remotePlayerRegistry` and `multiplayerSessionController` owners. `window.goneGame` remains a compatibility/debug facade, never the internal source of truth for these modules.

Do not refactor for line count alone.

## Change discipline

1. Read this file + `ARCHITECTURE.md`; inspect only relevant owners.
2. Recheck `main`; dedicated branch only.
3. Preserve host authority, finite ammo and zero-external-service networking unless task explicitly changes them.
4. Fix the canonical owner; do not add a patch layer.
5. Preserve compatibility facade members used by browser smokes/adapters.
6. Add deterministic Tier tests for architecture/contracts and real Chromium smoke for affected interaction/network behavior.
7. Full Rescue CI must be green on the final head: TypeScript/Vite, all E2E, browser multiplayer/direct/self-host/full-match/mobile, Rust, quality gate.
8. Mark PR ready only after full green.
9. Squash exactly once to `main`.
10. Verify resulting main has previous main as sole parent and valid signature when available.
11. Verify real Vercel deployment separately; do not claim physical-iPhone verification until owner retests that deployment.

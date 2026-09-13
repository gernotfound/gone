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

## Direct WebRTC / network authority

- `net/directWebRtc.ts`: manual offer/answer, `iceServers: []`, star host↔guests.
- Browser host is authoritative.
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

## Audio / iOS

- BGM: `/Colossus March.mp3`, `<audio id="bg-music">`.
- `ui/menu.ts` owns media lifecycle/volume UI.
- `audio/musicSourceGain.ts` owns reduced source gain.
- iOS requires `play()` / Web Audio unlock from a real gesture. Keep persistent gesture recovery; foreground recovery is best-effort and may still require the next gesture.

## Local gameplay / spawn

- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy: `gameplay/spawnPolicy.ts`.
- Slot 0 intended spawn: X=+1200, Z=+1200; never restore `(0,17.5,0)` as gameplay spawn.
- `gameplay/networkBindings.ts` owns P2P↔gameplay state wiring and host per-slot respawn.
- `remotePlayerRegistry.ts` owns remote model lifecycle/interpolation/shield presentation.
- Solo spiders: `bionicSpiderEnemies.ts` + `models/bionicSpider.ts`; disabled in P2P until represented host-authoritatively.

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
- `performance/cacheIntegrity.ts` is single-flight and lifecycle-owned.

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
- Touch: `mobile/mobileRuntime.ts`, `smartphoneControlsGuard.ts`, `pubgTouchControls.ts`, `competitiveTouchControls.ts`, `touchPreferences.ts`, `touchLayoutEditor.ts`.
- PWA/mobile lifecycle: `pwa/pwaRuntime.ts`, `mobile/mobileSessionResume.ts`.
- Diagnostics: `observability/clientDiagnostics.ts`, `api/client-telemetry.js`.
- World: `world/chunkManager.ts`, `world/worldConfig.ts`.

## Current structural direction

The runtime-kernel/browser-lifecycle foundation and lobby/session split are complete architecture directions. Next high-value structural work:

1. split local death/respawn/shield lifecycle out of `engine.ts` into a focused service/controller;
2. split per-weapon model builders behind stable exports;
3. if `p2pHost.ts` grows further, separate peer bookkeeping from authoritative combat without creating multiple authorities;
4. gradually migrate remaining internal `window.gone*` consumers to typed services/events.

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

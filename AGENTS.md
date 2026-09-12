# G.O.N.E. — AI engineering context

Read this first. Dense project index intended to minimize repo search/tool spend and prevent regressions across desktop, iPhone/PWA and multiplayer.

## Owner constraints

- Repo: `gernotfound/gone`.
- Never write directly to `main`. Every change must live on a dedicated branch and reach `main` only through an explicit PR.
- Vercel production builds are push-sensitive. Fully validate the branch first, then land **exactly one squash commit** on `main`.
- Vercel is intentionally configured so only `main` deploys. Do not manually deploy feature branches.
- The owner actively tests the deployed game on desktop browsers and physical iPhone/PWA. Treat reported iPhone behavior as hardware QA, not merely emulation feedback.
- Do not ask the owner to edit code or run commands when connected tooling can perform the work.
- No paid/external multiplayer runtime infrastructure: no hosted signaling/relay/database/STUN/TURN/PeerJS cloud/Firebase/Supabase.
- Direct `iceServers: []` connectivity still depends on LAN/NAT/IPv6. Never claim universal Internet P2P or transparent reconnection after a terminal RTC close without renegotiation.

## Production / Vercel

- Team: `gnfcreator` (`team_1ZCv2fwzf1KEgunz53M5xtbo`).
- Project: `gone` (`prj_wUtFswu415AIVQSlkks5BzlEtSUV`), framework Vite, linked to `gernotfound/gone`.
- Primary production alias: `https://gone-gnf.vercel.app`.
- Other aliases can include `gone-gnfcreator.vercel.app` and the main-branch alias.
- `game-web/vercel.json` owns deployment policy and HTTP security headers.
- After a merge, verify the actual Vercel production deployment is `READY`, its `githubCommitSha` equals the new `main` SHA, and `/version.json` reports the same build ID. Do not infer deploy success from GitHub alone.
- `/version.json`, `/gone-cache-sw.js` and `/api/client-telemetry` are intentionally `no-store`.

## Architecture discipline

- `ARCHITECTURE.md` is the ownership map and future refactor direction.
- `game-web/src/main.ts` must stay a small composition entry point. Main browser/game composition belongs in `game-web/src/runtime/startClientRuntime.ts`; device/PWA bootstrap modules may run around it when they must precede or follow engine bootstrap.
- One behavior should have one obvious owner. Fix owner modules directly instead of adding runtime monkey-patches.
- Do not add `THREE.*.prototype` patches or per-frame state-repair polling.
- `window.goneGame`, `window.goneWeapons`, `window.goneMobileControls` and related globals are compatibility/test facades. Preserve existing public members, but prefer typed imports/events/context objects for new internal code.

## Stack / build / CI

- Browser FPS: TypeScript + Vite + Three.js under `game-web/`.
- Core: Rust/WASM under `game-core/`; `game-web/pkg/game_core.js` remains a functional fallback while production build tooling can rebuild WASM.
- Browser compile gate: `game-web/package.json` runs `tsc && vite build`; TS enables unused-code checks.
- Full PR gate is `.github/workflows/rescue-ci.yml`: TypeScript/Vite, all E2E tiers, Chromium browser multiplayer/mobile smokes, Rust, final quality gate.
- Browser emulation is necessary but does not replace physical iPhone QA. Report that distinction precisely.

## Runtime composition

- `game-web/src/main.ts` currently initializes smartphone profile, explicit input mode, touch preferences, PWA runtime, client runtime, smartphone controls guard, PUBG touch controls, competitive mobile FPS controls, draggable touch layout, and mobile session resume.
- `runtime/startClientRuntime.ts` owns explicit startup phases: diagnostics/guards, engine bootstrap, gameplay controllers, mobile runtime, network runtime, presentation/diagnostics.
- `gameplay/engine.ts` is the local game loop/physics/camera/viewmodel coordinator plus compatibility facade. Do not grow it back into a god object.

## PWA / safe update

- PWA manifest and icons live under `game-web/public/`.
- `pwa/pwaRuntime.ts` compares the embedded generated `BUILD_ID` with `/version.json` using `no-store` checks on startup, foreground, online/focus and periodic polling.
- `scripts/generate_build_version.mjs` generates both `src/generated/buildVersion.ts` and public `version.json` from the deployment/Git SHA.
- Service-worker caches are build-aware. New versions may be prepared during live play, but page reload must not be forced mid-match; menu/lobby is the safe apply point.
- Installed PWAs older than the first safe-update release may need one final manual restart; current releases should self-detect later deployments.

## iPhone / mobile controls

There are layered mobile owners by design:

1. `mobile/mobileRuntime.ts` — generic touch runtime for movement/look/actions, virtual pointer-lock compatibility, wake lock, orientation/fullscreen best effort and mobile DPR cap.
2. `mobile/smartphoneControlsGuard.ts` — safety fallback if the primary runtime is unavailable or device heuristics are wrong.
3. `mobile/pubgTouchControls.ts` — ammo-safe FIRE/drag, secondary claw FIRE, ADS drag, gyro and iOS-safe action taps.
4. `mobile/competitiveTouchControls.ts` — competitive PUBG/CODM-style input composition: joystick sprint zone, independent left-move/right-look contacts, dedicated ADS/action ownership, live-map input continuity and map-open combat bridge.

Explicit `Comandi a schermo` in `mobile/inputMode.ts` is authoritative and must work even when UA/touch detection is wrong. `Mouse + tastiera` hides the touch overlay.

Presentation/customization:

- `mobile/smartphoneProfile.ts` owns smartphone presentation detection/classes.
- `mobile/smartphone.css` owns compact phone HUD/menu layout.
- `mobile/competitiveTouchControls.css` owns the competitive phone control geometry and non-modal map presentation. Keep the map below the touch HUD and preserve safe-area spacing.
- `mobile/touchPreferences.ts` owns persistent touch tuning: look sensitivity, ADS sensitivity, FIRE drag dead-zone, gyro sensitivity/on-off, button scale/opacity, handedness, and secondary claw FIRE preference.
- `mobile/touchLayoutEditor.ts` owns persistent draggable positions (`gone-touch-layout-v1`) and edit/reset UI. Do not encode user offsets back into base CSS.

### Competitive control contract

For current G.O.N.E. actions, follow modern PUBG Mobile / COD Mobile interaction principles rather than inventing unsupported buttons:

- left thumb owns joystick movement; pushing near the forward edge may engage auto-sprint while the explicit RUN control remains available;
- right thumb owns free-look; FIRE and ADS may be dragged for camera correction;
- optional secondary FIRE supports claw/index-finger play;
- jump, crouch and reload remain separate actions so they can be combined with movement/fire;
- weapon switching stays immediately reachable and must work through direct pointer input on iOS;
- do **not** add prone/slide/lean/peek UI until the corresponding gameplay mechanics actually exist;
- the live map is informational, not modal: while open on phone, movement, look, FIRE, ADS, reload and weapon controls remain usable; the map must remain partially transparent and below the touch-control z-layer;
- MAP itself must always be able to close the overlay even while the overlay is already open.

### Critical ammo/input rule

`gameplay/advancedWeaponController.ts` is the **only authoritative local owner** of magazine depletion/reload UX. Touch sustained FIRE must route through its synthetic mouse/controller path and must **not** leave `inputState.fire = true`, because `engine.ts` has a legacy direct-fire compatibility path that would otherwise bypass magazine accounting when cooldown reaches zero.

When changing touch FIRE:

- keep finite magazine/reserve state in `window.goneWeapons.ammo`;
- ensure each successful shot decrements magazine exactly once;
- never allow sustained touch hold to fire after magazine reaches zero;
- preserve normal desktop mouse behavior;
- browser-smoke reload and weapon switching via pointer events, because iOS click synthesis can be delayed/cancelled by pointer capture;
- browser-smoke map-open firing separately, because mobile virtual pointer-lock and legacy map gating can otherwise silently block the magazine-aware controller.

Canonical ammo:

- AR: 30 magazine / 120 reserve.
- Sniper: 5 / 25.
- Shotgun: 6 / 30, shell reload.
- SMG: 36 / 180.
- Knife: no ammo/reload.

## Audio / iOS lifecycle

- Menu BGM is `/Colossus March.mp3` through `<audio id="bg-music">`.
- `ui/menu.ts` owns media playback lifecycle and volume UI.
- `audio/musicSourceGain.ts` owns the reduced source gain without changing displayed volume percentages.
- iOS/Safari requires `HTMLAudioElement.play()` and Web Audio resume/unlock to originate from a real user gesture. Keep the persistent pointer/keyboard gesture recovery path; do not rely only on gameplay start or a delayed promise.
- After iOS background/foreground, audio may be suspended again; foreground recovery is best-effort and the next real gesture must remain able to resume it.

## Local player / spawn

- 100 HP, ~10 s spawn shield, ~5 s death phase; host authoritative.
- Spawn policy lives in `gameplay/spawnPolicy.ts`.
- Slot 0 spawn is X=+1200, Z=+1200 (SE giant crater). Other multiplayer slots are deterministic across the map.
- `engine.ts` handles initial local spawn/respawn with terrain-correct Y.
- `gameplay/networkBindings.ts` installs host-authoritative per-slot respawn; `spawnController.ts` is diagnostics/manual compatibility only.
- Never reintroduce `(0,17.5,0)` as intended gameplay spawn.
- Solo PvE spiders are owned by `gameplay/bionicSpiderEnemies.ts` + `models/bionicSpider.ts`; they are disabled in P2P until enemy state/combat is host-authoritatively represented.

## Weapons / local shots

Canonical browser gameplay balance is `game-web/src/weapons/weaponConfig.ts`; Rust counterpart is `game-core/src/weapons.rs`. Shared gameplay values must stay aligned.

Current runtime contract:

- AR: 30/120, 18 dmg, 180 m, falloff 35→140 to 10, head ×1.5, 6.25 rps.
- Sniper: 5/25, 70 dmg, 550 m, falloff 180→450 to 50, head ×2, 1 rps.
- Shotgun: 6/30, 64 dmg, 42 m, falloff 8→30 to 20, head ×1.25, 1.25 rps.
- SMG: 36/180, 12 dmg, 90 m, falloff 15→65 to 7, head ×1.5, 10 rps.
- Knife: **999 dmg**, 2.6 m hard range, no ammo.

`gameplay/advancedWeaponController.ts` owns semi/auto trigger interception, ADS/FOV/sensitivity, finite magazine/reserve state, reload, ammo HUD and action animations. `weapons/weaponCombatStats.ts` owns recoil/viewmodel tuning and derives shared identity/cadence from `weaponConfig.ts`.

## Tracer / shot presentation

- `vfx/tracerPool.ts` owns tracer travel/fade behavior.
- `net/remoteShotPresentation.ts` is current binary enemy-shot presentation.
- `net/legacyRemoteShotPresentation.ts` is compatibility-only for old JSON FIRE_HITSCAN callbacks.
- Tracers are visual only; host-authoritative hitscan owns damage.

## Remote players

- `gameplay/remotePlayerRegistry.ts` owns remote model lifecycle/interpolation/shield presentation.
- `gameplay/networkBindings.ts` owns P2P callback ↔ gameplay-state wiring.
- Hitbox: `net/robotHitbox.ts` + `simpleLagCompensator.ts` using cheap torso/head AABBs.
- `net/p2pHost.ts` owns shot sanity/cadence/origin validation and authoritative fallback damage logic.

## Multiplayer / WebRTC resilience

- Native direct mode: `net/directWebRtc.ts`, manual offer/answer, star host↔guests, `iceServers: []` by policy.
- Browser host is authoritative. Binary core opcodes: 0x01 CLIENT_STATE, 0x02 WORLD_SNAPSHOT, 0x03 FIRE_HITSCAN, 0x04 HIT_CONFIRMED.
- State/snapshots target ~30 Hz with adaptive snapshot-rate logic.
- `NativeRtcDataChannel` uses ~3 s heartbeat, ~15 s heartbeat timeout and ~6 s transient `disconnected` grace before terminal teardown.
- `mobile/mobileSessionResume.ts` clears held input when hidden/offline and restarts guest state tick / immediate state + host snapshot cadence on foreground/online recovery.
- Once direct RTC is truly closed/failed, a new SDP negotiation is required; `gone-reconnect-requested` is a recovery signal, not magic renegotiation.
- Tier-4 network churn tests must keep verifying repeated transient disconnect→connected cycles do not close the channel, while a grace-period expiry does.

## Self-host mode

- `gone-host/` is ACTIVE runtime infrastructure.
- `gone-host/server.mjs` serves `game-web/dist`, exposes `/__gone_host/status` and `/__gone_host/ws`, and relays guest traffic to the browser host.
- Root launchers `start-gone-host.cmd`, `.ps1`, `.sh` are required.
- Browser counterparts: `net/selfHostSession.ts` and `net/relayWebSocket.ts`.
- Do not delete self-host server/launchers unless intentionally replaced.

## World / rendering / performance

- Terrain: `game-core/src/lib.rs`; JS fallback: `game-web/pkg/game_core.js`.
- Gameplay map window ±2400 m; procedural terrain itself is unbounded.
- `world/worldConfig.ts` owns chunk-grid constants; `world/chunkManager.ts` owns progressive lifecycle/priority streaming and keeps expensive world work bounded per frame.
- `world/terrainGeometryPool.ts` reuses geometry; `world/rockInstances.ts` owns instanced rocks.
- `rendering/scene.ts`: antialias off, bounded DPR, shadows off, high-performance GPU preference.
- `performance/adaptiveRenderScale.ts` owns adaptive render scaling; do not build a competing phone-only quality loop.
- `performance/localTelemetry.ts` remains **local-only performance diagnostics**. It does not upload FPS/device telemetry.
- `performance/performancePack.ts` precaches models/assets/audio/WASM.

## Security / observability

- `game-web/vercel.json` owns global CSP, frame denial, nosniff, referrer and permissions policies. Any header change must be browser-smoked and then verified on the actual Vercel production response.
- Gyroscope/accelerometer are allowed only for `self` because optional touch gyro uses them; camera/microphone/geolocation/payment/USB/magnetometer remain denied.
- `observability/clientDiagnostics.ts` owns **bounded privacy-safe failure diagnostics**, distinct from local performance telemetry.
- It may send only coarse device class, build ID, error kind/message/stack, path, input mode, standalone/online/visibility state. Do not add raw IP, account identity, full URL query strings, raw UA, gameplay position/chat/session codes, or continuous FPS telemetry.
- `/api/client-telemetry` sanitizes/limits payloads and emits structured Vercel runtime logs. Client reporting is capped/deduplicated and must never become a gameplay failure source.
- For production failures: first inspect Vercel runtime errors/logs by project/deployment, then correlate with build ID.

## High-value files

- Composition: `game-web/src/runtime/startClientRuntime.ts`, `game-web/src/main.ts`
- Main loop/facade: `game-web/src/gameplay/engine.ts`
- Weapon UX/ammo: `game-web/src/gameplay/advancedWeaponController.ts`, `game-web/src/weapons/weaponConfig.ts`
- Touch: `game-web/src/mobile/mobileRuntime.ts`, `smartphoneControlsGuard.ts`, `pubgTouchControls.ts`, `competitiveTouchControls.ts`, `touchPreferences.ts`, `touchLayoutEditor.ts`
- Mobile/PWA lifecycle: `mobile/mobileSessionResume.ts`, `pwa/pwaRuntime.ts`
- Audio: `game-web/src/ui/menu.ts`, `game-web/src/audio/musicSourceGain.ts`
- Diagnostics: `game-web/src/observability/clientDiagnostics.ts`, `game-web/api/client-telemetry.js`
- Spawn: `game-web/src/gameplay/spawnPolicy.ts`, `spawnController.ts`
- Remote players: `game-web/src/gameplay/remotePlayerRegistry.ts`
- Gameplay↔network: `game-web/src/gameplay/networkBindings.ts`
- Host/client: `game-web/src/net/p2pHost.ts`, `p2pClient.ts`
- Direct RTC: `game-web/src/net/directWebRtc.ts`
- Self-host: `gone-host/server.mjs`, `net/selfHostSession.ts`, `net/relayWebSocket.ts`
- World: `game-web/src/world/chunkManager.ts`, `worldConfig.ts`
- Deployment/security: `game-web/vercel.json`

## Change discipline

1. Read this file and `ARCHITECTURE.md`, then only relevant owner files.
2. Recheck current `main` SHA before branching.
3. Dedicated branch only; never update `main` directly.
4. Preserve host authority, finite ammo contracts and zero-external-service networking unless the task explicitly changes them.
5. Decide whether a reported iPhone issue is mobile-specific or a global contract regression; fix at the narrowest correct owner without degrading desktop.
6. Prefer owner fixes over patch layers; preserve compatibility facades where tests/UI depend on them.
7. Keep expensive work out of per-frame paths and reuse/pool Three resources.
8. Add deterministic Tier tests plus real Chromium smoke for browser interaction changes. Mobile controls must test pointerdown/pointermove behavior, not only DOM presence. Map changes must test simultaneous movement/FIRE while open.
9. Full CI must be green before merge. Multiple branch commits are fine.
10. Squash merge exactly once to `main`.
11. Verify the resulting `main` commit has the previous main as its sole parent and a valid signature when available.
12. Verify Vercel production separately: READY deployment, matching Git SHA/build ID, security headers and relevant runtime logs. Do not claim physical-iPhone verification for behavior the owner has not retested after deployment.
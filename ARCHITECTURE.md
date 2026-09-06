# G.O.N.E. Layered Architecture Contracts

The G.O.N.E. project uses a strict 5-layer architecture to ensure clean separation of concerns, optimal performance (WASM integration), and maintainable network synchronization. The five layers and their contracts are defined below.

## 1. UI Layer (`/game-web/src/ui/`)
**Responsibilities**: Manage menus, HUD, lobby system, and 2D overlay rendering (Minimap, Health, Crosshair).
**Contracts**:
- Exposes `setupMenu()`, `healthHud`, and lobby state functions.
- The UI layer runs purely on the DOM and 2D Canvas contexts. It must NEVER directly mutate 3D scene properties or physics states.
- It receives updates exclusively via exposed Gameplay callbacks (e.g., `updateHealth`, `updateShield`) and reads state without mutating it.

## 2. Input Layer (`/game-web/src/controls/playerInput.ts`)
**Responsibilities**: Capture and normalize keyboard and mouse inputs, manage PointerLock lifecycle.
**Contracts**:
- Maintains the `inputState` singleton, which holds normalized movement flags (forward, backward, yaw, pitch, etc.).
- Exposes `initInput(callbacks)` which allows the Gameplay layer to subscribe to specific input events (e.g., `onFire`, `onWeaponSwitch`, `onToggleMap`).
- Does not contain any game logic; simply translates physical inputs into the `inputState` structure.

## 3. Gameplay Layer (`/game-web/src/gameplay/engine.ts` & Network Bindings)
**Responsibilities**: Glue layer. Manages game loop (`animate`), player health lifecycle (damage, death, respawn), weapon firing, hitscan raycasting logic, and P2P synchronization.
**Contracts**:
- Imports `inputState` to decide logic, and drives the Physics layer by passing sanitized variables to it.
- Acts as the mediator between local events and the Network (`P2PClient` / `P2PHost`).
- Triggers VFX and Sounds based on gameplay events.
- Exposes the initialization entry point (`bootstrap`, `startEngine`) to `main.ts`.

## 4. Physics Layer (`/game-core/` WASM & Physics logic)
**Responsibilities**: Execute authoritative mathematical operations for collisions, gravity, jump trajectories, procedural chunk heightmap sampling, and temporal lag compensation.
**Contracts**:
- Written mostly in Rust (`game-core`), exposed via WASM (`pkg/game_core.js`).
- The `step_physics(PhysicsInput)` function acts as a pure function: it takes the current state and delta-time as input, and returns the strictly evaluated next state (e.g., `x, y, z, vel_y, is_grounded`).
- The physics logic avoids DOM access or Three.js dependencies (pure mathematics).

## 5. Rendering Layer (`/game-web/src/rendering/`, `/game-web/src/world/`, `/game-web/src/models/`, `/game-web/src/vfx/`)
**Responsibilities**: 3D Scene management, WebGL rendering, Procedural Chunk Mesh generation, Shaders (Nebbia, VFX, Godrays), and Asset loading.
**Contracts**:
- Provides `sceneManager` exposing `scene`, `camera`, and `renderer`.
- Driven entirely by the Gameplay layer (which updates `camera.position` or `robot.position`).
- Responsible for instancing, chunk culling, and VFX pooling (`vfxManager`).
- Exposes `updateChunks(playerPosition)` to dynamically generate and discard terrain without coupling to the player's internal state.

---
## Summary of Data Flow
```text
[Input] (Keyboard/Mouse) -> `inputState` 
   -> [Gameplay] (reads Input, runs weapons, checks network) 
        -> [Physics] (evaluates final player pos/collisions via WASM) 
             -> [Gameplay] (applies returned physics pos to player)
                  -> [Rendering] (updates camera and meshes based on player pos)
                  -> [UI] (updates HUD/Minimap based on current status)
```

# G.O.N.E. world direction — central maze

This document records the current world-building direction. The previous biome presentation layer has been removed: streamed terrain now uses the canonical Rust/WASM terrain colors without quadrant-specific biome tinting.

## Core fantasy

Players awaken at the exact center of the world inside a large controlled clearing surrounded by an artificial labyrinth. The maze is the main navigation structure: it creates dangerous routes, readable chokepoints, dead ends, loops and a single outer-world escape.

## Current topology contract

- World/gameplay center: **(0, 0)**.
- Multiplayer slots remain inside the central clearing so players do not stack on one transform.
- Ammo and health supplies stay in the central annulus and remain real in-world pickups; they are not exposed as tactical-map pings.
- The giant southeast crater remains world geometry and a destination, but the tactical map does not print place names or landmark labels.
- Streamed terrain geometry, heights and base vertex colors remain owned by Rust/WASM.
- There is no runtime biome registry or biome recoloring pass.
- Decorative natural sun-ray meshes are removed; normal scene lighting remains.

## Maze design

The maze is a deterministic 18x18 coarse-grid topology with a 6x6 central void. A fixed seeded depth-first carve creates the main connected passage network, with sparse deterministic loops and a difficulty target of 9/10.

The central clearing stays wall-free for roughly 420 m in every direction. Four broad cardinal openings connect the clearing to the maze. Outside the clearing, retained logical walls are rendered as paired slabs and are shared by presentation, player movement, host movement validation, PvE routing and hitscan occlusion.

Most corridors remain broad at roughly 184 m spacing, while a deterministic minority compress locally to roughly 96 m choke sections. The authored wall envelope ends near +/-1660 m, keeping the maze footprint near 50% of the square playable world.

There is exactly one outer-world exit, on the eastern perimeter. The four cardinal openings around the center are entrances into the maze, not extra outer exits.

## Presentation rules

- The tactical map renders terrain relief and the canonical maze walls.
- It does not render loot/spawn ping layers or named place/landmark labels.
- The player-position indicator and map scale remain useful navigation aids.
- Terrain is visually continuous rather than split into authored biome palettes.
- The sky keeps standard scene illumination without decorative volumetric/sun-ray columns.

## Authority and performance

Maze collision and occlusion must continue to come from the canonical maze geometry. Removing visual biome/ray layers must not create a second terrain, collision, navigation or lighting authority. Terrain streaming remains distance-prioritized and bounded per frame.

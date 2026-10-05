# G.O.N.E. world direction — central maze and biome foundation

This document defines the first world-building direction for the map. It is intentionally a foundation, not a frozen final story.

## Core fantasy

Players awaken at **Nucleo Zero**, the exact center of the world, inside a controlled clearing surrounded by a much larger artificial labyrinth. The maze is not only architecture: it is the containment structure that separates engineered environmental sectors, abandoned facilities and damaged infrastructure.

The useful inspiration from maze-survival fiction is structural: a recognizable central refuge, dangerous routes radiating outward, partial information, landmarks that matter, and a world whose layout itself tells the story. G.O.N.E. should keep its own terminology, factions, technology and narrative explanation rather than copying another setting.

## Current topology contract

- World/narrative center: **(0, 0)**.
- The existing flat origin terrain becomes the spawn hub rather than unused terrain.
- Multiplayer slots remain inside the central clearing so players do not stack on one transform.
- Ammo and health supplies are removed from the southeast giant crater and distributed in an annulus around the hub.
- The giant crater at approximately **(1200, 1200)** becomes a landmark/late-route destination instead of the default starting area.
- Terrain streaming stays procedural and physics-safe; biome work initially changes presentation and world semantics without forking collision/height authority.

## First biome layout

The initial registry divides the world into a central biome plus four large sectors. Boundaries are deliberately simple now so future maze corridors, gates and POIs can become the meaningful transitions.

| Sector | Working name | Direction | First landmark | Gameplay/story role |
| --- | --- | --- | --- | --- |
| Center | Nucleo Zero | origin | Obelisco Zero | Spawn, orientation, tutorial signals, first mystery |
| NW | Faglie Alpine | northwest | Osservatorio Fratturato | Vertical routes, long sightlines, surveillance lore |
| NE | Bassopiani Allagati | northeast | Stazione di Pompaggio 04 | Restricted movement, submerged infrastructure, maintenance logs |
| SE | Bacino delle Ceneri | southeast | Cratere del Segnale | Existing giant crater, rare resources, evidence of a destructive event |
| SW | Rovine Verdi | southwest | Serre Sommerse | Dense cover, abandoned research, biological/environmental clues |

Names are working labels and can change once the narrative bible is written.

## POI rule

Every biome should eventually have at least:

1. one unmistakable macro-landmark visible or inferable from a distance;
2. one gameplay POI with a reason to enter it;
3. one lore payload that answers a question while creating another;
4. one shortcut, gate or traversal rule tied to the maze;
5. one biome-specific risk/reward loop.

A POI should not exist only as decoration. It should change route choice, resource access, information, combat geometry or progression.

## Story seed

Working premise: Nucleo Zero is part of a sealed experimental complex built to test autonomous survival systems under multiple artificial environments. Something interrupted the experiment, damaged the southeast sector and left the control network fragmented. Players do not initially know whether they are test subjects, recovery personnel, copies, prisoners, or something else.

The first narrative question is simple: **why does the maze keep the center alive while everything outside it is failing differently?**

The world can answer this gradually through environmental evidence rather than exposition dumps:

- Nucleo Zero establishes that the facility still recognizes the players.
- The pumping station suggests the biomes are actively maintained, not natural.
- The observatory reveals that someone was watching the maze from inside the maze.
- The green ruins show an earlier attempt to make the sectors self-sustaining.
- The crater provides evidence that the system was breached, struck, or deliberately sabotaged.

No single explanation should become canon until the POI sequence and intended game loop are clearer.

## Maze design principles

The maze should be generated or authored as a **navigation system**, not a carpet of random walls. The center must always be legible. Main routes should create loops, not only dead ends. Sector gates should make biome transitions readable. High-value POIs should have multiple approaches with different exposure and traversal cost.

A useful long-term topology is concentric: central hub, inner maze, biome sectors, outer control ring. This supports progressively more dangerous expeditions while keeping the player's mental model stable.

## Implementation stages

### Stage 1 — foundation (this change)

- central spawn contract;
- central supply annulus;
- +20% weapon output volume;
- deterministic biome registry;
- biome terrain palette;
- POI/lore names and world-direction document.

### Stage 2 — maze prototype

The first reusable maze cell system now surrounds Nucleo Zero with three concentric, staggered wall rings and four outer sector gates. The prototype uses 36 m cells, 4 m-thick walls and 24 m wall height. The layout is deterministic and shared between local collision, host movement validation, host hitscan occlusion and supply placement.

The prototype is intentionally bounded rather than full-world. It exists to validate corridor width, combat readability, mobile performance, line of sight, jumping/crouching constraints, networking and navigation before scaling the pattern across biome sectors.

### Stage 3 — first complete sector

Finish one biome end-to-end, preferably the Bacino delle Ceneri because the giant crater already exists. Add its maze language, landmark, gameplay POI, environmental storytelling and reward loop.

### Stage 4 — progression and narrative graph

Define which information or mechanisms found in one sector unlock routes or understanding in another. The player should have reasons to revisit the center and earlier sectors.

### Stage 5 — full biome expansion

Only after the first sector proves the pattern, extend the system to the remaining regions with distinct traversal, assets, soundscape, enemies/resources and POIs.

## Non-goals for the first pass

This foundation does not yet add physical maze walls, procedural POI placement, quest scripting, biome-specific enemies, final lore, or progression locks. Those systems need separate design and performance validation rather than being hidden inside terrain generation.

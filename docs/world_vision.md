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

The stable mental model is now: central hub, four cardinal entrances, a genuinely branching maze field, biome landmarks and then the open outer world. The maze should feel learnable through repeated expeditions, but never reducible to following one concentric band.

## Implementation stages

### Stage 1 — foundation (this change)

- central spawn contract;
- central supply annulus;
- +20% weapon output volume;
- deterministic biome registry;
- biome terrain palette;
- POI/lore names and world-direction document.

### Stage 2 — maze prototype

Nucleo Zero is a **large open central clearing**, intentionally free of maze walls for roughly 420 m in every direction. The first maze boundary sits beyond 500 m. Exactly four broad cardinal entrances — north, south, east and west — connect the clearing to the maze; each opening is about 184 m wide.

Outside that clearing, the maze is no longer built from concentric bands. It uses an 18x18 coarse grid of roughly 184 m cells with the central 6x6 block removed. A fixed seeded depth-first carve creates the primary connected route network. The difficulty target is now **9/10**: loop carving is deliberately sparse, so wrong turns and dead ends matter more, while a small number of alternate routes prevents the topology from becoming a trivial perfect-maze tree. The seed is fixed so every player and the host see the same world.

Every retained logical wall is rendered as two massive parallel slabs. The gap between the pair is deliberately narrower than the player collision envelope, so it reads visually as a double wall without becoming a hidden traversal lane. Landmark clearings remove nearby internal walls around the Cratere del Segnale, Osservatorio Fratturato, Stazione di Pompaggio 04 and Serre Sommerse.

Most navigation remains broad: neighboring logical wall lines are about 184 m apart. A deterministic minority of passages now compress locally to about **96 m** for short choke sections, creating tension and reduced sightlines without making the whole maze claustrophobic.

The outer wall envelope stops near +/-1660 m, keeping the maze footprint at approximately 50% of the square playable map. There is now **one and only one exit to the outer world**, on the eastern perimeter toward the Cratere del Segnale sector. The four cardinal openings around Nucleo Zero remain the four ways to enter the maze from the central clearing; they are not additional world exits.

Maze walls are intentionally extreme vertical structures: presentation runs from Y=-600 to Y=+1200. This guarantees they begin below plausible terrain cavities and extend far above the traversal envelope rather than trying to follow every local terrain height.

Solo spider AI uses bounded A* waypoint routing when canonical maze walls block a direct chase. This is deliberately obstacle routing, not a second navigation authority: the pathfinder consumes the same wall collision queries used by the player and host.

### Stage 3 — first complete sector

Finish one biome end-to-end, preferably the Bacino delle Ceneri because the giant crater already exists. Add its maze language, landmark, gameplay POI, environmental storytelling and reward loop.

### Stage 4 — progression and narrative graph

Define which information or mechanisms found in one sector unlock routes or understanding in another. The player should have reasons to revisit the center and earlier sectors.

### Stage 5 — full biome expansion

The structural maze now occupies about half of the playable map and reaches every quadrant through the four-gate central structure and branching generated corridor network. This stage therefore means **biome differentiation**, not basic wall coverage: distinct traversal language, assets, soundscape, enemies/resources, POIs and progression logic for each sector.

## Non-goals for the first pass

The current world still does not add procedural POI structures, quest scripting, biome-specific enemies, progression locks, final lore or hierarchical/navmesh AI beyond the bounded maze A*. Those systems need separate design and performance validation rather than being hidden inside terrain generation.

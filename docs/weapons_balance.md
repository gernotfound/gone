# G.O.N.E. — Weapons Balance & Precision Contract

This document mirrors the active browser contract in `game-web/src/weapons/weaponConfig.ts` and the Rust/WASM contract in `game-core/src/weapons.rs`. Keep them semantically aligned.

## Canonical balance

| ID | Weapon | Fire rate | Base dmg | Hard range | Falloff | Min dmg | Head | Ammo |
|---:|---|---:|---:|---:|---|---:|---:|---|
| 0 | AR-42 Viper | 6.25 rps | 18 | 180 m | 35→140 m | 10 | ×1.5 | 30 / 120 |
| 1 | SR-99 Railphantom | 1.00 rps | 70 | 550 m | 180→450 m | 50 | ×2.0 | 5 / 25 |
| 2 | SG-12 Havoc | 1.25 rps | 64 | 42 m | 8→30 m | 20 | ×1.25 | 6 / 30 |
| 3 | SMG-7 Neon Hornet | 10.00 rps | 12 | 90 m | 15→65 m | 7 | ×1.5 | 36 / 180 |
| 4 | CB-01 Shadowfang | 1.25 rps | 50 | 2.6 m | melee cutoff | 0 | ×1.0 | none |

Damage is linear between falloff start/end and **zero past hard range for every weapon**.

## Reference body TTK at 100 HP

The first hit lands at `t=0`, therefore:

`hits = ceil(100 / damage)`

`TTK = (hits - 1) / fireRateRps`

At the 20 m benchmark (2 m for knife):

| Weapon | Damage | Hits | TTK |
|---|---:|---:|---:|
| AR | 18.0 | 6 | 0.80 s |
| Sniper | 70.0 | 2 | 1.00 s |
| Shotgun | 40.0 | 3 | 1.60 s |
| SMG | 11.5 | 9 | 0.80 s |
| Knife @ 2 m | 50.0 | 2 | 0.80 s |

The shotgun is deliberately slower at the 20 m benchmark because it is now a close-range weapon with a stronger range identity rather than a universal two-shot option.

## Real precision / spread

The FPS crosshair is not presentation-only. `gameplay/dynamicPrecisionReticle.ts` computes a normalized live accuracy value from movement, crouching, sprinting, airborne state, ADS and recent shots. `gameplay/precisionShotRuntime.ts` maps that value into the weapon cone below and perturbs the same ray used by local hitscan, tracer and the FIRE_HITSCAN packet.

| Weapon | Base cone | Max cone | Rust bloom / shot |
|---|---:|---:|---:|
| AR | 0.0035 rad (~0.20°) | 0.045 rad (~2.58°) | 0.0045 rad |
| Sniper | 0.00035 rad (~0.02°) | 0.075 rad (~4.30°) | 0.020 rad |
| Shotgun | 0.045 rad (~2.58°) | 0.110 rad (~6.30°) | 0.008 rad |
| SMG | 0.008 rad (~0.46°) | 0.075 rad (~4.30°) | 0.006 rad |
| Knife | 0 | 0 | 0 |

Scoped sniper ADS uses near-perfect live accuracy. The knife is melee and does not use ballistic spread.

## Authority and validation

Browser matches use the room creator as authoritative host. The host validates lag-compensated hits with the visible robot hitbox (two cheap AABBs: torso/propulsor + head/visor). `net/pvpHardening.ts` additionally rejects malformed directions, impossible guest weapon mismatches, duplicate guest sequences and obvious over-cadence guest fire before authoritative damage resolution.

The Rust `intersect_ray_cylinder` function remains as a compatibility API for historical WASM callers/tests; it is **not** the intended live browser mannequin hitbox.

## Invariants

- No ranged damage past configured hard range.
- Browser and Rust range/falloff/headshot semantics must stay aligned.
- Reticle expansion must correspond to real shot spread.
- Tracer and authoritative packet direction must represent the same perturbed ray.
- Visible tracers are still presentation; the host remains the damage authority.

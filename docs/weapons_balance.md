# G.O.N.E. Weapons Balance & Combat Mathematics

## 1. Executive Summary & Design Rationale

**G.O.N.E.** is engineered as a fast-paced multiplayer arena first-person shooter inspired by classic high-mobility arena shooters (Quake, Unreal Tournament, Halo, Apex Legends) infused with a dystopian Cyberpunk visual identity.

### Arena FPS High-TTK Philosophy (0.70s – 1.50s)
In tactical shooters (e.g. Counter-Strike, Valorant, Rainbow Six Siege), Time-To-Kill (TTK) is near-instantaneous (0.10s – 0.30s), prioritizing crosshair placement, holding angles, and reaction twitch over extended gunfights. In G.O.N.E., combat math is tuned strictly to maintain a **high theoretical TTK between 0.70s and 1.50s** for body shots against standard 100 HP combatants at medium combat range (~20m).

#### Core Gameplay Pillars:
1. **Sustained Tracking Over Ambush Supremacy**: High TTK requires the shooter to maintain smooth, continuous target tracking across evasive dodges, sprint strafes, and vertical leaps, rather than rewarding whoever camped or saw the other player first.
2. **Dynamic Movement & Counterplay**: Players who take initial damage retain a realistic time window (~0.7s - 1.0s) to react, execute slide/sprint maneuvers, reposition behind terrain features (craters, ridges, boulders), and out-duel the aggressor.
3. **Synergy with Physics & Coyote Time**: The high-gravity dynamic physics model (`gravityScale: 5.0`, 50cm floating hover, 5-point pseudo-capsule terrain collision) allows aggressive verticality. A higher TTK ensures mid-air duels are skill contests rather than instantaneous deletions.
4. **Distinct Weapon Identities**: Every weapon occupies a distinct combat engagement profile with deliberate tradeoffs across damage falloff, dispersion bloom, and recoil impulse recovery.
5. **Precision Headshot Reward**: While body TTK is high (0.70s - 1.50s), precision headshots apply generous multipliers (1.5x on automatic/spread weapons, 2.0x on the sniper rifle). Landing headshots allows skilled marksmen to cut TTK significantly (e.g. SR-99 Railphantom achieves a lethal 140.0 dmg single-shot headshot kill against 100 HP).

---

## 2. Master Weapon Configuration Parameters

All values are authoritatively codified in Rust within `game-core/src/weapons.rs` and compiled to WebAssembly.

| Weapon ID | In-Game Name | Weapon Type | Pellets | Base Damage (close) | Fire Rate (RPS) | Fire Rate (RPM) | Effective Range (m) | Falloff Start (m) | Falloff End (m) | Min Damage (long) | Headshot Multiplier | Max Headshot Dmg |
|:---------:|:-------------|:-----------:|:-------:|:-------------------:|:---------------:|:---------------:|:-------------------:|:-----------------:|:---------------:|:-----------------:|:-------------------:|:----------------:|
| `0` | **AR-42 Viper** | Assault Rifle | 1 | **18.0** | 6.25 | 375 | 150.0m | 10.0m | 70.0m | **12.0** | 1.5x | 27.0 |
| `1` | **SR-99 Railphantom** | Sniper Rifle | 1 | **70.0** | 1.00 | 60 | 500.0m | 100.0m | 300.0m | **55.0** | 2.0x | 140.0 |
| `2` | **SG-12 Havoc** | Shotgun | 8 | **64.0** *(8x8.0)* | 1.25 | 75 | 40.0m | 10.0m | 30.0m | **41.0** *(8x5.125)* | 1.5x | 96.0 *(8x12.0)* |
| `3` | **SMG-7 Neon Hornet** | Submachine Gun | 1 | **12.0** | 10.00 | 600 | 80.0m | 10.0m | 40.0m | **6.0** | 1.5x | 18.0 |
| `4` | **CB-01 Shadowfang** | Combat Knife | 1 | **50.0** | 1.25 | 75 | 2.5m | 2.5m | 2.5m | **0.0** *(cutoff)* | 1.5x | 75.0 |

---

## 3. Angular Spread & Dynamic Recoil Dynamics

G.O.N.E. employs a mathematical recoil recovery and angular spread bloom model calculated on each frame.

$$\theta_{\text{spread}} = \min\Big(\big(\theta_{\text{base}} + N_{\text{burst}} \cdot \theta_{\text{bloom}}\big) \cdot M_{\text{stance}}, \ \theta_{\text{max}}\Big)$$

$$\vec{\Delta}_{\text{recoil}}(t) = \vec{\Delta}_0 \cdot e^{-R_{\text{recovery}} \cdot \Delta t}$$

| Weapon | Spread Base ($\text{rad} / ^\circ$) | Spread Bloom ($\text{rad} / \text{shot}$) | Spread Max ($\text{rad} / ^\circ$) | Recoil Pitch Kick ($^\circ$) | Recoil Yaw Kick ($^\circ$) | Recoil Recovery Rate ($s^{-1}$) |
|:-------|:-----------------------------------:|:-----------------------------------------:|:----------------------------------:|:----------------------------:|:--------------------------:|:-------------------------------:|
| **AR-42 Viper** | 0.012 rad (~0.69°) | +0.005 rad | 0.060 rad (~3.44°) | +1.10° | ±0.35° | 8.0 / s |
| **SR-99 Railphantom** | 0.0005 rad (~0.03°) | +0.070 rad | 0.100 rad (~5.73°) | +5.50° | ±0.80° | 3.5 / s |
| **SG-12 Havoc** | 0.075 rad (~4.30°) | +0.010 rad | 0.120 rad (~6.88°) | +4.00° | ±1.20° | 4.0 / s |
| **SMG-7 Neon Hornet** | 0.025 rad (~1.43°) | +0.008 rad | 0.095 rad (~5.44°) | +0.55° | ±0.65° | 10.0 / s |
| **CB-01 Shadowfang** | 0.000 rad (0.00°) | 0.000 rad | 0.000 rad (0.00°) | 0.00° | 0.00° | 0.0 / s |

### Stance Multipliers ($M_{\text{stance}}$)
- **Crouching (`C`)**: $0.75\times$ (Tightens spread cone by 25%)
- **Standing / Walking (`W A S D`)**: $1.00\times$ (Standard nominal spread)
- **Sprinting (`Shift`)**: $1.40\times$ (Spread expands during run)
- **Airborne / Jumping (`Space`)**: $2.00\times$ (Penalty for mid-air shots without ADS)

---

## 4. Distance Falloff Damage Progression

Damage attenuation uses a continuous piecewise linear interpolation:
- For $d \le d_{\text{start}}$: $D(d) = D_{\text{base}}$
- For $d_{\text{start}} < d < d_{\text{end}}$: $D(d) = D_{\text{base}} - (D_{\text{base}} - D_{\text{min}}) \cdot \frac{d - d_{\text{start}}}{d_{\text{end}} - d_{\text{start}}}$
- For $d \ge d_{\text{end}}$: $D(d) = D_{\text{min}}$
- For melee (CB-01 Shadowfang): Strict boundary cutoff $D(d) = 0.0$ for $d > 2.5\text{m}$.

### Calculated Damage by Distance (Body Hit, No Headshot):

| Distance | AR-42 Viper | SR-99 Railphantom | SG-12 Havoc | SMG-7 Neon Hornet | CB-01 Shadowfang |
|:--------:|:-----------:|:-----------------:|:-----------:|:-----------------:|:----------------:|
| **0.0m - 2.5m** | 18.0 | 70.0 | 64.0 | 12.0 | **50.0** |
| **5.0m** | 18.0 | 70.0 | 64.0 | 12.0 | 0.0 |
| **10.0m** | 18.0 | 70.0 | 64.0 | 12.0 | 0.0 |
| **15.0m** | 17.5 | 70.0 | 58.25 | 11.0 | 0.0 |
| **20.0m** *(standard)* | **17.0** | **70.0** | **52.5** | **10.0** | **0.0** |
| **30.0m** | 16.0 | 70.0 | 41.0 | 8.0 | 0.0 |
| **40.0m** | 15.0 | 70.0 | 0.0 *(out of range)* | 6.0 | 0.0 |
| **70.0m** | 12.0 | 70.0 | 0.0 | 6.0 | 0.0 |
| **100.0m** | 12.0 | 70.0 | 0.0 | 0.0 *(out of range)* | 0.0 |
| **200.0m** | 12.0 | 62.5 | 0.0 | 0.0 | 0.0 |
| **300.0m+** | 12.0 | 55.0 | 0.0 | 0.0 | 0.0 |

---

## 5. Theoretical Time-To-Kill (TTK) Analysis

### TTK Mathematical Formulation
In G.O.N.E., Time-To-Kill is evaluated using the standard authoritative formula where the first shot impacts instantly at $t = 0.0\text{s}$:

$$N_{\text{hits}} = \left\lceil \frac{\text{Target HP}}{D_{\text{per\_shot}}} \right\rceil$$

$$\text{TTK} = \frac{N_{\text{hits}} - 1}{R_{\text{fire\_rps}}}$$

### Benchmark TTK Against 100 HP Target (Body Hits Only, No Headshot):

| Weapon | Range | Damage / Shot | Hits to Kill | Fire Rate | Theoretical TTK | Target Envelope [0.70s, 1.50s] | Status |
|:-------|:-----:|:-------------:|:------------:|:---------:|:---------------:|:------------------------------:|:------:|
| **AR-42 Viper** | 20m | 17.0 dmg | 6 hits | 6.25 RPS | **0.800s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |
| **SR-99 Railphantom** | 20m | 70.0 dmg | 2 hits | 1.00 RPS | **1.000s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |
| **SG-12 Havoc** | 20m | 52.5 dmg | 2 bursts | 1.25 RPS | **0.800s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |
| **SMG-7 Neon Hornet** | 20m | 10.0 dmg | 10 hits | 10.00 RPS | **0.900s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |
| **SMG-7 Neon Hornet** | 0-10m | 12.0 dmg | 9 hits | 10.00 RPS | **0.800s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |
| **CB-01 Shadowfang** | 2.0m | 50.0 dmg | 2 hits | 1.25 RPS | **0.800s** | $[0.70\text{s}, 1.50\text{s}]$ | **PERFECT PASS** |

### Key Combat Balance Takeaways:
- **No 1-Shot Body Kills**: No weapon in G.O.N.E. can kill a 100 HP target with a single body shot at any distance.
- **Strict Compliance**: Every weapon's theoretical TTK falls cleanly within the range of **0.800s to 1.000s**, squarely inside the global requirement of $[0.70\text{s}, 1.50\text{s}]$.
- **Sniper Railphantom Reward**: The SR-99 Railphantom inflicts 70.0 body damage (TTK 1.000s), but with a $2.0\times$ headshot multiplier, headshots deal **140.0 damage**, rewarding precision aiming with an instant kill while keeping body TTK deliberate and punishable if missed.
- **Shotgun Spread Falloff**: The SG-12 Havoc fires 8 pellets. Close up, all pellets land for 64.0 damage (2 bursts $\rightarrow 0.800\text{s}$). At 20m, each pellet suffers falloff to 6.56 dmg (total 52.5 dmg), still requiring 2 clean bursts. Beyond 30m, pellet spread and damage cutoff make it ineffective, preserving the SMG and AR niches.
- **Knife Close Quarters**: The CB-01 Shadowfang hits for 50.0 damage at 1.25 RPS ($\text{TTK} = 0.800\text{s}$), making a double-slash lethal in melee while strictly preventing any damage past 2.5m.

---

## 6. Authoritative Rust Implementation Reference

All game mathematics are validated and verified by unit tests in `game-core`:
- `test_all_weapon_configs_loaded`: Verifies all 5 weapons possess valid nonzero configurations.
- `test_damage_and_falloff`: Validates exact piecewise damage curves across 0m to 300m and headshot multipliers.
- `test_theoretical_ttk_within_bounds`: Confirms all weapon TTKs lie within $[0.70\text{s}, 1.50\text{s}]$ with zero 1-shot body kills.
- `test_spread_cone_bounds`: Verifies stance multipliers, bloom accumulation, and directional perturbation vectors.
- `test_recoil_dynamics`: Verifies instantaneous angular kick and exponential recovery toward zero.
- `test_hitscan_ray_cylinder_intersection`: Tests 3D ray-cylinder intersection with body vs headshot (height $\ge 1.55\text{m}$).
- `test_wasm_combat_engine`: Tests WASM JSON exports and serialization.

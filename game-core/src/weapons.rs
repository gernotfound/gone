use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Enumeration of the 5 available weapon types in G.O.N.E.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash, Serialize, Deserialize)]
#[repr(u32)]
pub enum WeaponType {
    Assalto = 0,
    Cecchino = 1,
    Pompa = 2,
    Mitraglietta = 3,
    Coltello = 4,
}

impl WeaponType {
    /// Convert an integer ID (from JS/WASM) into a WeaponType
    pub fn from_u32(val: u32) -> Option<Self> {
        match val {
            0 => Some(WeaponType::Assalto),
            1 => Some(WeaponType::Cecchino),
            2 => Some(WeaponType::Pompa),
            3 => Some(WeaponType::Mitraglietta),
            4 => Some(WeaponType::Coltello),
            _ => None,
        }
    }

    /// Return standard numeric identifier
    pub fn as_u32(&self) -> u32 {
        *self as u32
    }

    /// Canonical weapon display name
    pub fn name(&self) -> &'static str {
        match self {
            WeaponType::Assalto => "AR-42 Viper",
            WeaponType::Cecchino => "SR-99 Railphantom",
            WeaponType::Pompa => "SG-12 Havoc",
            WeaponType::Mitraglietta => "SMG-7 Neon Hornet",
            WeaponType::Coltello => "CB-01 Shadowfang",
        }
    }
}

/// Full configuration parameters for a weapon in G.O.N.E.
/// Strictly tuned for high TTK (0.70s - 1.50s) arena FPS gameplay.
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct WeaponConfig {
    pub base_damage: f64,
    pub fire_rate_rps: f64,
    pub pellets: u32,
    pub effective_range_m: f64,
    pub falloff_start_m: f64,
    pub falloff_end_m: f64,
    pub min_damage: f64,
    pub headshot_multiplier: f64,
    pub spread_base_rad: f64,
    pub spread_bloom_rad: f64,
    pub spread_max_rad: f64,
    pub recoil_pitch_deg: f64,
    pub recoil_yaw_deg: f64,
    pub recoil_recovery_rate: f64,
}

/// Retrieve the authoritative WeaponConfig for a given WeaponType
pub fn get_weapon_config(weapon_type: WeaponType) -> WeaponConfig {
    match weapon_type {
        // AR-42 "Viper": Balanced all-rounder
        // Base: 18 dmg, 20m: 17 dmg, 6.25 rps (375 RPM) -> 6 hits -> TTK = 0.800s
        WeaponType::Assalto => WeaponConfig {
            base_damage: 18.0,
            fire_rate_rps: 6.25,
            pellets: 1,
            effective_range_m: 150.0,
            falloff_start_m: 10.0,
            falloff_end_m: 70.0,
            min_damage: 12.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.012,
            spread_bloom_rad: 0.005,
            spread_max_rad: 0.060,
            recoil_pitch_deg: 1.10,
            recoil_yaw_deg: 0.35,
            recoil_recovery_rate: 8.0,
        },

        // SR-99 "Railphantom": Precision long-range rifle
        // Base/20m: 70 dmg, 1.00 rps (60 RPM) -> 2 hits -> TTK = 1.000s
        // 2.0x headshot multiplier yields 140.0 dmg (1-shot precision reward)
        WeaponType::Cecchino => WeaponConfig {
            base_damage: 70.0,
            fire_rate_rps: 1.00,
            pellets: 1,
            effective_range_m: 500.0,
            falloff_start_m: 100.0,
            falloff_end_m: 300.0,
            min_damage: 55.0,
            headshot_multiplier: 2.0,
            spread_base_rad: 0.0005,
            spread_bloom_rad: 0.070,
            spread_max_rad: 0.100,
            recoil_pitch_deg: 5.50,
            recoil_yaw_deg: 0.80,
            recoil_recovery_rate: 3.5,
        },

        // SG-12 "Havoc": CQB 8-pellet shotgun
        // Base: 64 dmg (8x8), 20m: 52.5 dmg (7x7.5), 1.25 rps (75 RPM) -> 2 hits -> TTK = 0.800s
        WeaponType::Pompa => WeaponConfig {
            base_damage: 64.0,
            fire_rate_rps: 1.25,
            pellets: 8,
            effective_range_m: 40.0,
            falloff_start_m: 10.0,
            falloff_end_m: 30.0,
            min_damage: 41.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.075,
            spread_bloom_rad: 0.010,
            spread_max_rad: 0.120,
            recoil_pitch_deg: 4.00,
            recoil_yaw_deg: 1.20,
            recoil_recovery_rate: 4.0,
        },

        // SMG-7 "Neon Hornet": Rapid-fire CQB/Medium submachine gun
        // Base: 12 dmg, 20m: 10 dmg, 10.00 rps (600 RPM) -> 10 hits -> TTK = 0.900s (0.800s close)
        WeaponType::Mitraglietta => WeaponConfig {
            base_damage: 12.0,
            fire_rate_rps: 10.00,
            pellets: 1,
            effective_range_m: 80.0,
            falloff_start_m: 10.0,
            falloff_end_m: 40.0,
            min_damage: 6.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.025,
            spread_bloom_rad: 0.008,
            spread_max_rad: 0.095,
            recoil_pitch_deg: 0.55,
            recoil_yaw_deg: 0.65,
            recoil_recovery_rate: 10.0,
        },

        // CB-01 "Shadowfang": Melee blade
        // <=2.5m: 50 dmg, 1.25 rps (75 RPM) -> 2 hits -> TTK = 0.800s
        // >2.5m: 0 dmg (strict melee envelope)
        WeaponType::Coltello => WeaponConfig {
            base_damage: 50.0,
            fire_rate_rps: 1.25,
            pellets: 1,
            effective_range_m: 2.5,
            falloff_start_m: 2.5,
            falloff_end_m: 2.5,
            min_damage: 0.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.0,
            spread_bloom_rad: 0.0,
            spread_max_rad: 0.0,
            recoil_pitch_deg: 0.0,
            recoil_yaw_deg: 0.0,
            recoil_recovery_rate: 0.0,
        },
    }
}

/// Calculate distance-based piecewise linear damage with optional headshot multiplier.
///
/// Formulation:
/// - d <= falloff_start: D = base_damage
/// - falloff_start < d < falloff_end: D = base - (base - min) * ((d - start) / (end - start))
/// - d >= falloff_end: D = min_damage
/// - Knife hard cutoff: D = 0 for distance > 2.5m
pub fn calculate_damage(weapon_type: WeaponType, distance_m: f64, is_headshot: bool) -> f64 {
    let config = get_weapon_config(weapon_type);

    if distance_m < 0.0 {
        return 0.0;
    }

    // Strict melee range cutoff for knife
    if weapon_type == WeaponType::Coltello && distance_m > config.effective_range_m {
        return 0.0;
    }

    let raw_damage = if distance_m <= config.falloff_start_m {
        config.base_damage
    } else if distance_m >= config.falloff_end_m {
        config.min_damage
    } else {
        let span = config.falloff_end_m - config.falloff_start_m;
        if span <= 1e-9 {
            config.min_damage
        } else {
            let t = (distance_m - config.falloff_start_m) / span;
            config.base_damage - (config.base_damage - config.min_damage) * t
        }
    };

    if is_headshot {
        raw_damage * config.headshot_multiplier
    } else {
        raw_damage
    }
}

/// Calculate theoretical Time-To-Kill (TTK) in seconds against a target with specified HP.
/// Assumes all body hits (no headshots) landed at firing cadence.
///
/// Formula:
/// hits = ceil(target_hp / damage)
/// TTK = (hits - 1) / fire_rate_rps   (first hit lands at t = 0.0s)
pub fn calculate_theoretical_ttk(weapon_type: WeaponType, target_hp: f64, distance_m: f64) -> f64 {
    let config = get_weapon_config(weapon_type);
    let dmg = calculate_damage(weapon_type, distance_m, false);

    if dmg <= 1e-9 || target_hp <= 0.0 || config.fire_rate_rps <= 1e-9 {
        return f64::INFINITY;
    }

    let hits = (target_hp / dmg).ceil();
    if hits <= 1.0 {
        0.0
    } else {
        (hits - 1.0) / config.fire_rate_rps
    }
}

/// Calculate current spread cone half-angle in radians given continuous firing burst and stance.
///
/// Stance multipliers typically:
/// - Standing: 1.0
/// - Crouching: 0.75
/// - Walking: 1.4
/// - Sprinting: 2.0
/// - Airborne: 2.5
pub fn calculate_spread_angle(config: &WeaponConfig, burst_count: u32, stance_multiplier: f64) -> f64 {
    let raw = config.spread_base_rad + (burst_count as f64) * config.spread_bloom_rad;
    let clamped = raw.min(config.spread_max_rad);
    let effective = (clamped * stance_multiplier).min(config.spread_max_rad);
    effective.max(0.0)
}

/// Linear spread recovery over delta time when firing ceases.
pub fn recover_spread(current_spread_rad: f64, base_spread_rad: f64, recovery_rate_rad_s: f64, dt_s: f64) -> f64 {
    if dt_s <= 0.0 {
        return current_spread_rad;
    }
    (current_spread_rad - recovery_rate_rad_s * dt_s).max(base_spread_rad)
}

/// Perturb a normalized direction vector by an angular spread cone half-angle using
/// two uniform random samples u1, u2 in [0.0, 1.0).
pub fn perturb_direction(dir: [f64; 3], spread_angle_rad: f64, u1: f64, u2: f64) -> [f64; 3] {
    let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
    if len < 1e-9 {
        return [0.0, 0.0, 1.0];
    }
    let f = [dir[0] / len, dir[1] / len, dir[2] / len];

    if spread_angle_rad <= 1e-9 {
        return f;
    }

    // Build orthonormal basis (R, U, F)
    let up = if f[1].abs() < 0.99 {
        [0.0, 1.0, 0.0]
    } else {
        [1.0, 0.0, 0.0]
    };

    // Cross product: R = F x up
    let rx = f[1] * up[2] - f[2] * up[1];
    let ry = f[2] * up[0] - f[0] * up[2];
    let rz = f[0] * up[1] - f[1] * up[0];
    let r_len = (rx * rx + ry * ry + rz * rz).sqrt();
    let r = [rx / r_len, ry / r_len, rz / r_len];

    // Cross product: U = R x F
    let ux = r[1] * f[2] - r[2] * f[1];
    let uy = r[2] * f[0] - r[0] * f[2];
    let uz = r[0] * f[1] - r[1] * f[0];
    let u = [ux, uy, uz];

    // Sample uniform disk on tangent plane at distance 1.0
    let radius = spread_angle_rad.tan() * u1.clamp(0.0, 1.0).sqrt();
    let phi = 2.0 * std::f64::consts::PI * u2.clamp(0.0, 1.0);

    let cos_phi = phi.cos();
    let sin_phi = phi.sin();

    let vx = f[0] + radius * (cos_phi * r[0] + sin_phi * u[0]);
    let vy = f[1] + radius * (cos_phi * r[1] + sin_phi * u[1]);
    let vz = f[2] + radius * (cos_phi * r[2] + sin_phi * u[2]);

    let v_len = (vx * vx + vy * vy + vz * vz).sqrt();
    if v_len < 1e-9 {
        f
    } else {
        [vx / v_len, vy / v_len, vz / v_len]
    }
}

/// Apply instant recoil kick (pitch climb and horizontal yaw kick with variance factor in [-1.0, 1.0]).
pub fn apply_recoil_kick(
    pitch_deg: f64,
    yaw_deg: f64,
    config: &WeaponConfig,
    yaw_variance_factor: f64,
) -> (f64, f64) {
    let y_factor = yaw_variance_factor.clamp(-1.0, 1.0);
    let new_pitch = pitch_deg + config.recoil_pitch_deg;
    let new_yaw = yaw_deg + config.recoil_yaw_deg * y_factor;
    (new_pitch, new_yaw)
}

/// Exponential continuous recoil recovery toward reticle center (0.0, 0.0).
pub fn recover_recoil(pitch_deg: f64, yaw_deg: f64, recovery_rate: f64, dt_s: f64) -> (f64, f64) {
    if dt_s <= 0.0 || recovery_rate <= 0.0 {
        return (pitch_deg, yaw_deg);
    }
    let decay = (-recovery_rate * dt_s).exp();
    (pitch_deg * decay, yaw_deg * decay)
}

/// Result of an authoritative hitscan validation query
#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HitscanResult {
    pub hit: bool,
    pub damage: f64,
    pub is_headshot: bool,
    pub distance: f64,
}

/// Exact 3D ray-cylinder intersection with vertical player cylinder.
///
/// Parameters:
/// - `origin`: Ray start point [x, y, z]
/// - `direction`: Ray direction vector [x, y, z]
/// - `target_base`: Cylinder base center [x, y, z] (feet position)
/// - `radius`: Cylinder radius in meters (e.g. 0.45m)
/// - `height`: Cylinder height in meters (e.g. 2.0m)
/// - `max_range`: Maximum ray travel distance in meters
///
/// Returns Option<(hit_distance, is_headshot)> where headshot is defined as
/// intersection height relative to base >= 1.55m.
pub fn intersect_ray_cylinder(
    origin: [f64; 3],
    direction: [f64; 3],
    target_base: [f64; 3],
    radius: f64,
    height: f64,
    max_range: f64,
) -> Option<(f64, bool)> {
    let dir_len = (direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]).sqrt();
    if dir_len < 1e-9 {
        return None;
    }

    let ndx = direction[0] / dir_len;
    let ndy = direction[1] / dir_len;
    let ndz = direction[2] / dir_len;

    let rel_ox = origin[0] - target_base[0];
    let rel_oy = origin[1] - target_base[1];
    let rel_oz = origin[2] - target_base[2];

    // Check if origin is already inside cylinder
    let r_sq = radius * radius;
    let origin_xz_sq = rel_ox * rel_ox + rel_oz * rel_oz;
    if origin_xz_sq <= r_sq && rel_oy >= 0.0 && rel_oy <= height {
        let is_headshot = rel_oy >= 1.55;
        return Some((0.0, is_headshot));
    }

    let mut min_t = f64::INFINITY;
    let mut hit_y = 0.0;

    // 1. Infinite cylinder side: (ndx*t + rel_ox)^2 + (ndz*t + rel_oz)^2 = R^2
    // A*t^2 + B*t + C = 0
    let a = ndx * ndx + ndz * ndz;
    let b = 2.0 * (rel_ox * ndx + rel_oz * ndz);
    let c = origin_xz_sq - r_sq;

    if a > 1e-9 {
        let discr = b * b - 4.0 * a * c;
        if discr >= 0.0 {
            let sqrt_discr = discr.sqrt();
            let t1 = (-b - sqrt_discr) / (2.0 * a);
            let t2 = (-b + sqrt_discr) / (2.0 * a);

            for t in [t1, t2] {
                if t > 1e-4 && t < min_t {
                    let y = origin[1] + t * ndy;
                    if y >= target_base[1] && y <= target_base[1] + height {
                        min_t = t;
                        hit_y = y;
                    }
                }
            }
        }
    }

    // 2. Top cap (y = target_base[1] + height) and bottom cap (y = target_base[1])
    if ndy.abs() > 1e-9 {
        // Top cap
        let t_top = (target_base[1] + height - origin[1]) / ndy;
        if t_top > 1e-4 && t_top < min_t {
            let x_top = origin[0] + t_top * ndx - target_base[0];
            let z_top = origin[2] + t_top * ndz - target_base[2];
            if x_top * x_top + z_top * z_top <= r_sq {
                min_t = t_top;
                hit_y = target_base[1] + height;
            }
        }

        // Bottom cap
        let t_bot = (target_base[1] - origin[1]) / ndy;
        if t_bot > 1e-4 && t_bot < min_t {
            let x_bot = origin[0] + t_bot * ndx - target_base[0];
            let z_bot = origin[2] + t_bot * ndz - target_base[2];
            if x_bot * x_bot + z_bot * z_bot <= r_sq {
                min_t = t_bot;
                hit_y = target_base[1];
            }
        }
    }

    if min_t.is_finite() && min_t <= max_range {
        let rel_hit_y = hit_y - target_base[1];
        let is_headshot = rel_hit_y >= 1.55;
        Some((min_t, is_headshot))
    } else {
        None
    }
}

/// Validate hitscan shot and return full HitscanResult
pub fn validate_hitscan_shot_internal(
    weapon_type: WeaponType,
    origin: [f64; 3],
    direction: [f64; 3],
    target_base: [f64; 3],
    target_radius: f64,
    target_height: f64,
) -> HitscanResult {
    let config = get_weapon_config(weapon_type);
    let radius = if target_radius > 0.0 { target_radius } else { 0.45 };
    let height = if target_height > 0.0 { target_height } else { 2.0 };

    if let Some((distance, is_headshot)) =
        intersect_ray_cylinder(origin, direction, target_base, radius, height, config.effective_range_m)
    {
        let damage = calculate_damage(weapon_type, distance, is_headshot);
        HitscanResult {
            hit: true,
            damage,
            is_headshot,
            distance,
        }
    } else {
        HitscanResult {
            hit: false,
            damage: 0.0,
            is_headshot: false,
            distance: 0.0,
        }
    }
}

/// WASM exported combat engine for weapon config queries, damage calculation,
/// theoretical TTK computation, and authoritative hitscan verification.
#[wasm_bindgen]
pub struct WasmCombatEngine;

impl Default for WasmCombatEngine {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl WasmCombatEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        WasmCombatEngine
    }

    /// Retrieve weapon configuration as a JSON string.
    pub fn get_weapon_config(weapon_type: u32) -> String {
        match WeaponType::from_u32(weapon_type) {
            Some(wt) => {
                let config = get_weapon_config(wt);
                serde_json::to_string(&config).unwrap_or_else(|_| "{}".to_string())
            }
            None => "{}".to_string(),
        }
    }

    /// Calculate distance-based falloff damage with optional headshot multiplier.
    pub fn calculate_damage(weapon_type: u32, distance_m: f64, is_headshot: bool) -> f64 {
        match WeaponType::from_u32(weapon_type) {
            Some(wt) => calculate_damage(wt, distance_m, is_headshot),
            None => 0.0,
        }
    }

    /// Calculate theoretical Time-To-Kill (TTK) in seconds against a target with specified HP.
    pub fn calculate_theoretical_ttk(weapon_type: u32, target_hp: f64, distance_m: f64) -> f64 {
        match WeaponType::from_u32(weapon_type) {
            Some(wt) => calculate_theoretical_ttk(wt, target_hp, distance_m),
            None => f64::INFINITY,
        }
    }

    /// Perform authoritative 3D ray-cylinder intersection and damage computation.
    /// Returns a JSON string of HitscanResult: { hit: bool, damage: f64, is_headshot: bool, distance: f64 }
    #[allow(clippy::too_many_arguments)]
    pub fn validate_hitscan_shot(
        weapon_type: u32,
        origin_x: f64,
        origin_y: f64,
        origin_z: f64,
        dir_x: f64,
        dir_y: f64,
        dir_z: f64,
        target_x: f64,
        target_y: f64,
        target_z: f64,
        target_radius: f64,
        target_height: f64,
    ) -> String {
        let wt = match WeaponType::from_u32(weapon_type) {
            Some(wt) => wt,
            None => {
                let empty_res = HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
                return serde_json::to_string(&empty_res).unwrap_or_else(|_| "{}".to_string());
            }
        };

        let result = validate_hitscan_shot_internal(
            wt,
            [origin_x, origin_y, origin_z],
            [dir_x, dir_y, dir_z],
            [target_x, target_y, target_z],
            target_radius,
            target_height,
        );

        serde_json::to_string(&result).unwrap_or_else(|_| "{}".to_string())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_all_weapon_configs_loaded() {
        let types = [
            WeaponType::Assalto,
            WeaponType::Cecchino,
            WeaponType::Pompa,
            WeaponType::Mitraglietta,
            WeaponType::Coltello,
        ];
        for wt in types {
            let cfg = get_weapon_config(wt);
            assert!(cfg.base_damage > 0.0);
            assert!(cfg.fire_rate_rps > 0.0);
            assert!(cfg.effective_range_m > 0.0);
            assert!(cfg.headshot_multiplier >= 1.0);
        }
    }

    #[test]
    fn test_damage_and_falloff() {
        // 1. Assalto: 18 base, 17 @ 20m, 12 @ 70m+
        let d_ar_0 = calculate_damage(WeaponType::Assalto, 0.0, false);
        assert_eq!(d_ar_0, 18.0);
        let d_ar_10 = calculate_damage(WeaponType::Assalto, 10.0, false);
        assert_eq!(d_ar_10, 18.0);
        let d_ar_20 = calculate_damage(WeaponType::Assalto, 20.0, false);
        assert!((d_ar_20 - 17.0).abs() < 1e-6);
        let d_ar_70 = calculate_damage(WeaponType::Assalto, 70.0, false);
        assert_eq!(d_ar_70, 12.0);
        let d_ar_100 = calculate_damage(WeaponType::Assalto, 100.0, false);
        assert_eq!(d_ar_100, 12.0);

        // 2. Cecchino: 70 base, 70 @ 20m, 70 @ 100m, falloff to 55 @ 300m
        let d_sr_0 = calculate_damage(WeaponType::Cecchino, 0.0, false);
        assert_eq!(d_sr_0, 70.0);
        let d_sr_20 = calculate_damage(WeaponType::Cecchino, 20.0, false);
        assert_eq!(d_sr_20, 70.0);
        let d_sr_100 = calculate_damage(WeaponType::Cecchino, 100.0, false);
        assert_eq!(d_sr_100, 70.0);
        let d_sr_300 = calculate_damage(WeaponType::Cecchino, 300.0, false);
        assert_eq!(d_sr_300, 55.0);

        // 3. Pompa: 64 base, 52.5 @ 20m, 41 @ 30m+
        let d_sg_0 = calculate_damage(WeaponType::Pompa, 0.0, false);
        assert_eq!(d_sg_0, 64.0);
        let d_sg_20 = calculate_damage(WeaponType::Pompa, 20.0, false);
        assert!((d_sg_20 - 52.5).abs() < 1e-6);
        let d_sg_30 = calculate_damage(WeaponType::Pompa, 30.0, false);
        assert_eq!(d_sg_30, 41.0);

        // 4. Mitraglietta: 12 base, 10 @ 20m, 6 @ 40m+
        let d_smg_0 = calculate_damage(WeaponType::Mitraglietta, 0.0, false);
        assert_eq!(d_smg_0, 12.0);
        let d_smg_20 = calculate_damage(WeaponType::Mitraglietta, 20.0, false);
        assert!((d_smg_20 - 10.0).abs() < 1e-6);
        let d_smg_40 = calculate_damage(WeaponType::Mitraglietta, 40.0, false);
        assert_eq!(d_smg_40, 6.0);

        // 5. Coltello: 50 base, 50 @ 2.5m, 0 @ >2.5m
        let d_kn_0 = calculate_damage(WeaponType::Coltello, 0.0, false);
        assert_eq!(d_kn_0, 50.0);
        let d_kn_2 = calculate_damage(WeaponType::Coltello, 2.0, false);
        assert_eq!(d_kn_2, 50.0);
        let d_kn_25 = calculate_damage(WeaponType::Coltello, 2.5, false);
        assert_eq!(d_kn_25, 50.0);
        let d_kn_26 = calculate_damage(WeaponType::Coltello, 2.6, false);
        assert_eq!(d_kn_26, 0.0);
        let d_kn_20 = calculate_damage(WeaponType::Coltello, 20.0, false);
        assert_eq!(d_kn_20, 0.0);

        // Headshots
        let hs_ar = calculate_damage(WeaponType::Assalto, 0.0, true);
        assert_eq!(hs_ar, 27.0); // 18 * 1.5
        let hs_sr = calculate_damage(WeaponType::Cecchino, 0.0, true);
        assert_eq!(hs_sr, 140.0); // 70 * 2.0 (precision 1-shot reward)
        let hs_sg = calculate_damage(WeaponType::Pompa, 0.0, true);
        assert_eq!(hs_sg, 96.0); // 64 * 1.5
        let hs_smg = calculate_damage(WeaponType::Mitraglietta, 0.0, true);
        assert_eq!(hs_smg, 18.0); // 12 * 1.5
        let hs_kn = calculate_damage(WeaponType::Coltello, 1.0, true);
        assert_eq!(hs_kn, 75.0); // 50 * 1.5
    }

    #[test]
    fn test_theoretical_ttk_within_bounds() {
        let hp = 100.0;
        let medium_distance = 20.0;

        // Assalto @ 20m: 17.0 dmg -> 6 hits -> (6-1)/6.25 = 0.800s
        let ttk_ar = calculate_theoretical_ttk(WeaponType::Assalto, hp, medium_distance);
        assert!((ttk_ar - 0.800).abs() < 1e-4, "AR TTK {} != 0.800s", ttk_ar);
        assert!(ttk_ar >= 0.70 && ttk_ar <= 1.50);

        // Cecchino @ 20m: 70.0 dmg -> 2 hits -> (2-1)/1.00 = 1.000s
        let ttk_sr = calculate_theoretical_ttk(WeaponType::Cecchino, hp, medium_distance);
        assert!((ttk_sr - 1.000).abs() < 1e-4, "SR TTK {} != 1.000s", ttk_sr);
        assert!(ttk_sr >= 0.70 && ttk_sr <= 1.50);

        // Pompa @ 20m: 52.5 dmg -> 2 hits -> (2-1)/1.25 = 0.800s
        let ttk_sg = calculate_theoretical_ttk(WeaponType::Pompa, hp, medium_distance);
        assert!((ttk_sg - 0.800).abs() < 1e-4, "SG TTK {} != 0.800s", ttk_sg);
        assert!(ttk_sg >= 0.70 && ttk_sg <= 1.50);

        // Mitraglietta @ 20m: 10.0 dmg -> 10 hits -> (10-1)/10.00 = 0.900s
        let ttk_smg = calculate_theoretical_ttk(WeaponType::Mitraglietta, hp, medium_distance);
        assert!((ttk_smg - 0.900).abs() < 1e-4, "SMG TTK {} != 0.900s", ttk_smg);
        assert!(ttk_smg >= 0.70 && ttk_smg <= 1.50);

        // Coltello @ 2.0m (melee): 50.0 dmg -> 2 hits -> (2-1)/1.25 = 0.800s
        let ttk_kn = calculate_theoretical_ttk(WeaponType::Coltello, hp, 2.0);
        assert!((ttk_kn - 0.800).abs() < 1e-4, "Knife TTK {} != 0.800s", ttk_kn);
        assert!(ttk_kn >= 0.70 && ttk_kn <= 1.50);

        // Knife out of range must have infinite TTK
        let ttk_kn_out = calculate_theoretical_ttk(WeaponType::Coltello, hp, 5.0);
        assert!(ttk_kn_out.is_infinite());

        // Verify NO weapon has a 1-shot body kill at medium range
        for wt in [
            WeaponType::Assalto,
            WeaponType::Cecchino,
            WeaponType::Pompa,
            WeaponType::Mitraglietta,
        ] {
            let dmg = calculate_damage(wt, medium_distance, false);
            assert!(dmg < 100.0, "{:?} deals 1-shot body damage: {}", wt, dmg);
        }
    }

    #[test]
    fn test_spread_cone_bounds() {
        let ar_cfg = get_weapon_config(WeaponType::Assalto);

        // Base spread without bloom
        let base_angle = calculate_spread_angle(&ar_cfg, 0, 1.0);
        assert_eq!(base_angle, ar_cfg.spread_base_rad);

        // Crouch modifier reduces spread
        let crouch_angle = calculate_spread_angle(&ar_cfg, 0, 0.75);
        assert_eq!(crouch_angle, ar_cfg.spread_base_rad * 0.75);
        assert!(crouch_angle < base_angle);

        // Sprint modifier increases spread
        let sprint_angle = calculate_spread_angle(&ar_cfg, 0, 2.0);
        assert_eq!(sprint_angle, ar_cfg.spread_base_rad * 2.0);
        assert!(sprint_angle > base_angle);

        // Max spread clamp
        let max_bloom_angle = calculate_spread_angle(&ar_cfg, 100, 1.0);
        assert_eq!(max_bloom_angle, ar_cfg.spread_max_rad);

        // Recovery
        let recovered = recover_spread(0.05, ar_cfg.spread_base_rad, ar_cfg.recoil_recovery_rate, 0.1);
        assert!(recovered < 0.05);
        let fully_recovered = recover_spread(0.05, ar_cfg.spread_base_rad, ar_cfg.recoil_recovery_rate, 10.0);
        assert_eq!(fully_recovered, ar_cfg.spread_base_rad);

        // Perturbation vector within spread cone
        let forward = [0.0, 0.0, 1.0];
        let spread = 0.05; // ~2.86 deg
        for i in 0..100 {
            let u1 = (i as f64) / 100.0;
            let u2 = ((i * 7) % 100) as f64 / 100.0;
            let perturbed = perturb_direction(forward, spread, u1, u2);
            let dot = perturbed[0] * forward[0] + perturbed[1] * forward[1] + perturbed[2] * forward[2];
            let angle = dot.clamp(-1.0, 1.0).acos();
            assert!(angle <= spread + 1e-4, "Perturbed angle {} exceeds cone {}", angle, spread);
        }
    }

    #[test]
    fn test_recoil_dynamics() {
        let ar_cfg = get_weapon_config(WeaponType::Assalto);

        // Kick increases pitch
        let (p1, y1) = apply_recoil_kick(0.0, 0.0, &ar_cfg, 0.5);
        assert_eq!(p1, ar_cfg.recoil_pitch_deg);
        assert_eq!(y1, ar_cfg.recoil_yaw_deg * 0.5);

        // Recovery decays toward zero
        let (p2, y2) = recover_recoil(p1, y1, ar_cfg.recoil_recovery_rate, 0.1);
        assert!(p2 < p1);
        assert!(y2 < y1);

        // Long time recovery reaches zero
        let (p_zero, y_zero) = recover_recoil(p1, y1, ar_cfg.recoil_recovery_rate, 5.0);
        assert!(p_zero < 1e-6);
        assert!(y_zero < 1e-6);
    }

    #[test]
    fn test_hitscan_ray_cylinder_intersection() {
        let origin = [0.0, 1.0, -10.0];
        let dir = [0.0, 0.0, 1.0];
        let target_base = [0.0, 0.0, 0.0];
        let radius = 0.45;
        let height = 2.0;

        // Body shot test: hit at y = 1.0 (< 1.55)
        let body_hit = intersect_ray_cylinder(origin, dir, target_base, radius, height, 100.0);
        assert!(body_hit.is_some());
        let (dist, is_hs) = body_hit.unwrap();
        assert!((dist - 9.55).abs() < 1e-2);
        assert!(!is_hs);

        // Headshot test: ray at y = 1.7 (>= 1.55)
        let head_origin = [0.0, 1.7, -10.0];
        let head_hit = intersect_ray_cylinder(head_origin, dir, target_base, radius, height, 100.0);
        assert!(head_hit.is_some());
        let (_, is_hs_2) = head_hit.unwrap();
        assert!(is_hs_2);

        // Miss test: ray aimed perpendicular
        let miss_dir = [1.0, 0.0, 0.0];
        let miss = intersect_ray_cylinder(origin, miss_dir, target_base, radius, height, 100.0);
        assert!(miss.is_none());

        // Full hitscan validation check
        let res_body = validate_hitscan_shot_internal(WeaponType::Assalto, origin, dir, target_base, radius, height);
        assert!(res_body.hit);
        assert!(!res_body.is_headshot);
        assert!(res_body.damage > 0.0);

        let res_head = validate_hitscan_shot_internal(WeaponType::Cecchino, head_origin, dir, target_base, radius, height);
        assert!(res_head.hit);
        assert!(res_head.is_headshot);
        assert_eq!(res_head.damage, 140.0); // 70 * 2.0

        // Knife range boundary: 2.0m hits, 3.0m misses
        let knife_close_orig = [0.0, 1.0, -2.0];
        let knife_hit = validate_hitscan_shot_internal(WeaponType::Coltello, knife_close_orig, dir, target_base, radius, height);
        assert!(knife_hit.hit);
        assert_eq!(knife_hit.damage, 50.0);

        let knife_far_orig = [0.0, 1.0, -5.0];
        let knife_miss = validate_hitscan_shot_internal(WeaponType::Coltello, knife_far_orig, dir, target_base, radius, height);
        assert!(!knife_miss.hit);
        assert_eq!(knife_miss.damage, 0.0);

        // Point blank: shooter inside target cylinder
        let inside_orig = [0.0, 1.0, 0.0];
        let pb_hit = intersect_ray_cylinder(inside_orig, dir, target_base, radius, height, 100.0);
        assert!(pb_hit.is_some());
        let (pb_dist, _) = pb_hit.unwrap();
        assert_eq!(pb_dist, 0.0);
    }

    #[test]
    fn test_wasm_combat_engine() {
        let _engine = WasmCombatEngine::new();

        // 1. Config JSON query
        let cfg_json = WasmCombatEngine::get_weapon_config(0); // Assalto
        let parsed_cfg: serde_json::Value = serde_json::from_str(&cfg_json).unwrap();
        assert_eq!(parsed_cfg["base_damage"], 18.0);
        assert_eq!(parsed_cfg["fire_rate_rps"], 6.25);

        // Invalid weapon type returns empty json
        let invalid_cfg = WasmCombatEngine::get_weapon_config(99);
        assert_eq!(invalid_cfg, "{}");

        // 2. Damage calculation
        let dmg_body = WasmCombatEngine::calculate_damage(0, 20.0, false);
        assert!((dmg_body - 17.0).abs() < 1e-4);
        let dmg_head = WasmCombatEngine::calculate_damage(1, 20.0, true);
        assert_eq!(dmg_head, 140.0);

        // 3. Theoretical TTK calculation
        let ttk_ar = WasmCombatEngine::calculate_theoretical_ttk(0, 100.0, 20.0);
        assert!((ttk_ar - 0.800).abs() < 1e-4);
        assert!(ttk_ar >= 0.70 && ttk_ar <= 1.50);

        // 4. Hitscan validation JSON
        let hit_json = WasmCombatEngine::validate_hitscan_shot(
            0, // Assalto
            0.0, 1.0, -10.0, // origin
            0.0, 0.0, 1.0,  // dir
            0.0, 0.0, 0.0,  // target base
            0.45, 2.0,      // radius, height
        );
        let parsed_hit: serde_json::Value = serde_json::from_str(&hit_json).unwrap();
        assert_eq!(parsed_hit["hit"], true);
        assert_eq!(parsed_hit["is_headshot"], false);
        assert!(parsed_hit["damage"].as_f64().unwrap() > 0.0);

        // Miss query
        let miss_json = WasmCombatEngine::validate_hitscan_shot(
            0,
            0.0, 1.0, -10.0,
            1.0, 0.0, 0.0, // perpendicular dir
            0.0, 0.0, 0.0,
            0.45, 2.0,
        );
        let parsed_miss: serde_json::Value = serde_json::from_str(&miss_json).unwrap();
        assert_eq!(parsed_miss["hit"], false);
    }
}

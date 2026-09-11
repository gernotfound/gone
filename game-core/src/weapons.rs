use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

/// Stable numeric weapon IDs shared with the browser protocol.
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
    pub fn from_u32(val: u32) -> Option<Self> {
        match val {
            0 => Some(Self::Assalto),
            1 => Some(Self::Cecchino),
            2 => Some(Self::Pompa),
            3 => Some(Self::Mitraglietta),
            4 => Some(Self::Coltello),
            _ => None,
        }
    }

    pub fn as_u32(&self) -> u32 {
        *self as u32
    }

    pub fn name(&self) -> &'static str {
        match self {
            Self::Assalto => "AR-42 Viper",
            Self::Cecchino => "SR-99 Railphantom",
            Self::Pompa => "SG-12 Havoc",
            Self::Mitraglietta => "SMG-7 Neon Hornet",
            Self::Coltello => "CB-01 Shadowfang",
        }
    }
}

/// Canonical Rust/WASM combat balance. Keep semantically aligned with
/// game-web/src/weapons/weaponConfig.ts.
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

pub fn get_weapon_config(weapon_type: WeaponType) -> WeaponConfig {
    match weapon_type {
        WeaponType::Assalto => WeaponConfig {
            base_damage: 18.0,
            fire_rate_rps: 6.25,
            pellets: 1,
            effective_range_m: 180.0,
            falloff_start_m: 35.0,
            falloff_end_m: 140.0,
            min_damage: 10.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.0035,
            spread_bloom_rad: 0.0045,
            spread_max_rad: 0.045,
            recoil_pitch_deg: 1.10,
            recoil_yaw_deg: 0.35,
            recoil_recovery_rate: 8.0,
        },
        WeaponType::Cecchino => WeaponConfig {
            base_damage: 70.0,
            fire_rate_rps: 1.0,
            pellets: 1,
            effective_range_m: 550.0,
            falloff_start_m: 180.0,
            falloff_end_m: 450.0,
            min_damage: 50.0,
            headshot_multiplier: 2.0,
            spread_base_rad: 0.00035,
            spread_bloom_rad: 0.020,
            spread_max_rad: 0.075,
            recoil_pitch_deg: 5.50,
            recoil_yaw_deg: 0.80,
            recoil_recovery_rate: 3.5,
        },
        WeaponType::Pompa => WeaponConfig {
            base_damage: 64.0,
            fire_rate_rps: 1.25,
            pellets: 8,
            effective_range_m: 42.0,
            falloff_start_m: 8.0,
            falloff_end_m: 30.0,
            min_damage: 20.0,
            headshot_multiplier: 1.25,
            spread_base_rad: 0.045,
            spread_bloom_rad: 0.008,
            spread_max_rad: 0.110,
            recoil_pitch_deg: 4.00,
            recoil_yaw_deg: 1.20,
            recoil_recovery_rate: 4.0,
        },
        WeaponType::Mitraglietta => WeaponConfig {
            base_damage: 12.0,
            fire_rate_rps: 10.0,
            pellets: 1,
            effective_range_m: 90.0,
            falloff_start_m: 15.0,
            falloff_end_m: 65.0,
            min_damage: 7.0,
            headshot_multiplier: 1.5,
            spread_base_rad: 0.008,
            spread_bloom_rad: 0.006,
            spread_max_rad: 0.075,
            recoil_pitch_deg: 0.55,
            recoil_yaw_deg: 0.65,
            recoil_recovery_rate: 10.0,
        },
        WeaponType::Coltello => WeaponConfig {
            base_damage: 50.0,
            fire_rate_rps: 1.25,
            pellets: 1,
            effective_range_m: 2.6,
            falloff_start_m: 2.6,
            falloff_end_m: 2.6,
            min_damage: 0.0,
            headshot_multiplier: 1.0,
            spread_base_rad: 0.0,
            spread_bloom_rad: 0.0,
            spread_max_rad: 0.0,
            recoil_pitch_deg: 0.0,
            recoil_yaw_deg: 0.0,
            recoil_recovery_rate: 0.0,
        },
    }
}

/// Piecewise linear damage with a strict hard range for every weapon.
pub fn calculate_damage(weapon_type: WeaponType, distance_m: f64, is_headshot: bool) -> f64 {
    let config = get_weapon_config(weapon_type);
    if !distance_m.is_finite() || distance_m < 0.0 || distance_m > config.effective_range_m {
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
            config.base_damage + (config.min_damage - config.base_damage) * t
        }
    };

    raw_damage * if is_headshot { config.headshot_multiplier } else { 1.0 }
}

pub fn calculate_theoretical_ttk(weapon_type: WeaponType, target_hp: f64, distance_m: f64) -> f64 {
    let config = get_weapon_config(weapon_type);
    let damage = calculate_damage(weapon_type, distance_m, false);
    if damage <= 1e-9 || target_hp <= 0.0 || config.fire_rate_rps <= 1e-9 {
        return f64::INFINITY;
    }
    let hits = (target_hp / damage).ceil();
    if hits <= 1.0 { 0.0 } else { (hits - 1.0) / config.fire_rate_rps }
}

pub fn calculate_spread_angle(config: &WeaponConfig, burst_count: u32, stance_multiplier: f64) -> f64 {
    let raw = config.spread_base_rad + burst_count as f64 * config.spread_bloom_rad;
    let clamped = raw.min(config.spread_max_rad);
    (clamped * stance_multiplier.max(0.0)).min(config.spread_max_rad)
}

pub fn recover_spread(current_spread_rad: f64, base_spread_rad: f64, recovery_rate_rad_s: f64, dt_s: f64) -> f64 {
    if dt_s <= 0.0 {
        return current_spread_rad;
    }
    (current_spread_rad - recovery_rate_rad_s.max(0.0) * dt_s).max(base_spread_rad)
}

/// Perturb a normalized direction inside a cone using two uniform samples.
pub fn perturb_direction(dir: [f64; 3], spread_angle_rad: f64, u1: f64, u2: f64) -> [f64; 3] {
    let len = (dir[0] * dir[0] + dir[1] * dir[1] + dir[2] * dir[2]).sqrt();
    if len < 1e-9 {
        return [0.0, 0.0, 1.0];
    }
    let f = [dir[0] / len, dir[1] / len, dir[2] / len];
    if spread_angle_rad <= 1e-9 {
        return f;
    }

    let reference_up = if f[1].abs() < 0.99 { [0.0, 1.0, 0.0] } else { [1.0, 0.0, 0.0] };
    let rx = f[1] * reference_up[2] - f[2] * reference_up[1];
    let ry = f[2] * reference_up[0] - f[0] * reference_up[2];
    let rz = f[0] * reference_up[1] - f[1] * reference_up[0];
    let r_len = (rx * rx + ry * ry + rz * rz).sqrt();
    if r_len < 1e-9 {
        return f;
    }
    let r = [rx / r_len, ry / r_len, rz / r_len];
    let u = [
        r[1] * f[2] - r[2] * f[1],
        r[2] * f[0] - r[0] * f[2],
        r[0] * f[1] - r[1] * f[0],
    ];

    let radius = spread_angle_rad.tan() * u1.clamp(0.0, 1.0).sqrt();
    let phi = 2.0 * std::f64::consts::PI * u2.clamp(0.0, 1.0);
    let vx = f[0] + radius * (phi.cos() * r[0] + phi.sin() * u[0]);
    let vy = f[1] + radius * (phi.cos() * r[1] + phi.sin() * u[1]);
    let vz = f[2] + radius * (phi.cos() * r[2] + phi.sin() * u[2]);
    let v_len = (vx * vx + vy * vy + vz * vz).sqrt();
    if v_len < 1e-9 { f } else { [vx / v_len, vy / v_len, vz / v_len] }
}

pub fn apply_recoil_kick(
    pitch_deg: f64,
    yaw_deg: f64,
    config: &WeaponConfig,
    yaw_variance_factor: f64,
) -> (f64, f64) {
    (
        pitch_deg + config.recoil_pitch_deg,
        yaw_deg + config.recoil_yaw_deg * yaw_variance_factor.clamp(-1.0, 1.0),
    )
}

pub fn recover_recoil(pitch_deg: f64, yaw_deg: f64, recovery_rate: f64, dt_s: f64) -> (f64, f64) {
    if dt_s <= 0.0 || recovery_rate <= 0.0 {
        return (pitch_deg, yaw_deg);
    }
    let decay = (-recovery_rate * dt_s).exp();
    (pitch_deg * decay, yaw_deg * decay)
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize)]
pub struct HitscanResult {
    pub hit: bool,
    pub damage: f64,
    pub is_headshot: bool,
    pub distance: f64,
}

/// Legacy Rust compatibility collider. Browser live PvP uses the cheaper robot
/// torso/head AABBs in net/robotHitbox.ts; this cylinder API remains stable for
/// WASM callers and historical geometry tests.
pub fn intersect_ray_cylinder(
    origin: [f64; 3],
    direction: [f64; 3],
    target_base: [f64; 3],
    radius: f64,
    height: f64,
    max_range: f64,
) -> Option<(f64, bool)> {
    let dir_len = (direction[0] * direction[0] + direction[1] * direction[1] + direction[2] * direction[2]).sqrt();
    if dir_len < 1e-9 || max_range < 0.0 {
        return None;
    }
    let ndx = direction[0] / dir_len;
    let ndy = direction[1] / dir_len;
    let ndz = direction[2] / dir_len;

    let rel_ox = origin[0] - target_base[0];
    let rel_oy = origin[1] - target_base[1];
    let rel_oz = origin[2] - target_base[2];
    let r_sq = radius * radius;
    let origin_xz_sq = rel_ox * rel_ox + rel_oz * rel_oz;
    if origin_xz_sq <= r_sq && rel_oy >= 0.0 && rel_oy <= height {
        return Some((0.0, rel_oy >= 1.55));
    }

    let mut min_t = f64::INFINITY;
    let mut hit_y = 0.0;
    let a = ndx * ndx + ndz * ndz;
    let b = 2.0 * (rel_ox * ndx + rel_oz * ndz);
    let c = origin_xz_sq - r_sq;

    if a > 1e-9 {
        let discr = b * b - 4.0 * a * c;
        if discr >= 0.0 {
            let root = discr.sqrt();
            for t in [(-b - root) / (2.0 * a), (-b + root) / (2.0 * a)] {
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

    if ndy.abs() > 1e-9 {
        for y_plane in [target_base[1] + height, target_base[1]] {
            let t = (y_plane - origin[1]) / ndy;
            if t > 1e-4 && t < min_t {
                let x = origin[0] + t * ndx - target_base[0];
                let z = origin[2] + t * ndz - target_base[2];
                if x * x + z * z <= r_sq {
                    min_t = t;
                    hit_y = y_plane;
                }
            }
        }
    }

    if min_t.is_finite() && min_t <= max_range {
        Some((min_t, hit_y - target_base[1] >= 1.55))
    } else {
        None
    }
}

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
    if let Some((distance, is_headshot)) = intersect_ray_cylinder(
        origin,
        direction,
        target_base,
        radius,
        height,
        config.effective_range_m,
    ) {
        let damage = calculate_damage(weapon_type, distance, is_headshot);
        HitscanResult { hit: damage > 0.0, damage, is_headshot, distance }
    } else {
        HitscanResult { hit: false, damage: 0.0, is_headshot: false, distance: 0.0 }
    }
}

#[wasm_bindgen]
pub struct WasmCombatEngine;

impl Default for WasmCombatEngine {
    fn default() -> Self { Self::new() }
}

#[wasm_bindgen]
impl WasmCombatEngine {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self { Self }

    pub fn get_weapon_config(weapon_type: u32) -> String {
        WeaponType::from_u32(weapon_type)
            .and_then(|wt| serde_json::to_string(&get_weapon_config(wt)).ok())
            .unwrap_or_else(|| "{}".to_string())
    }

    pub fn calculate_damage(weapon_type: u32, distance_m: f64, is_headshot: bool) -> f64 {
        WeaponType::from_u32(weapon_type)
            .map(|wt| calculate_damage(wt, distance_m, is_headshot))
            .unwrap_or(0.0)
    }

    pub fn calculate_theoretical_ttk(weapon_type: u32, target_hp: f64, distance_m: f64) -> f64 {
        WeaponType::from_u32(weapon_type)
            .map(|wt| calculate_theoretical_ttk(wt, target_hp, distance_m))
            .unwrap_or(f64::INFINITY)
    }

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
        let Some(wt) = WeaponType::from_u32(weapon_type) else {
            return "{\"hit\":false,\"damage\":0.0,\"is_headshot\":false,\"distance\":0.0}".to_string();
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
    fn configs_match_browser_balance() {
        let ar = get_weapon_config(WeaponType::Assalto);
        assert_eq!((ar.effective_range_m, ar.falloff_start_m, ar.falloff_end_m, ar.min_damage), (180.0, 35.0, 140.0, 10.0));
        let sr = get_weapon_config(WeaponType::Cecchino);
        assert_eq!((sr.effective_range_m, sr.falloff_start_m, sr.falloff_end_m, sr.min_damage), (550.0, 180.0, 450.0, 50.0));
        let sg = get_weapon_config(WeaponType::Pompa);
        assert_eq!((sg.effective_range_m, sg.falloff_start_m, sg.falloff_end_m, sg.min_damage, sg.headshot_multiplier), (42.0, 8.0, 30.0, 20.0, 1.25));
        let smg = get_weapon_config(WeaponType::Mitraglietta);
        assert_eq!((smg.effective_range_m, smg.falloff_start_m, smg.falloff_end_m, smg.min_damage), (90.0, 15.0, 65.0, 7.0));
        let knife = get_weapon_config(WeaponType::Coltello);
        assert_eq!((knife.effective_range_m, knife.headshot_multiplier), (2.6, 1.0));
    }

    #[test]
    fn falloff_and_hard_ranges() {
        assert_eq!(calculate_damage(WeaponType::Assalto, 35.0, false), 18.0);
        assert_eq!(calculate_damage(WeaponType::Assalto, 140.0, false), 10.0);
        assert_eq!(calculate_damage(WeaponType::Assalto, 180.1, false), 0.0);
        assert_eq!(calculate_damage(WeaponType::Cecchino, 450.0, false), 50.0);
        assert_eq!(calculate_damage(WeaponType::Cecchino, 550.1, false), 0.0);
        assert!((calculate_damage(WeaponType::Pompa, 19.0, false) - 42.0).abs() < 1e-9);
        assert_eq!(calculate_damage(WeaponType::Pompa, 42.1, false), 0.0);
        assert!((calculate_damage(WeaponType::Mitraglietta, 40.0, false) - 9.5).abs() < 1e-9);
        assert_eq!(calculate_damage(WeaponType::Mitraglietta, 90.1, false), 0.0);
        assert_eq!(calculate_damage(WeaponType::Coltello, 2.6, true), 50.0);
        assert_eq!(calculate_damage(WeaponType::Coltello, 2.61, false), 0.0);
    }

    #[test]
    fn expected_ttk_profile() {
        assert!((calculate_theoretical_ttk(WeaponType::Assalto, 100.0, 20.0) - 0.8).abs() < 1e-6);
        assert!((calculate_theoretical_ttk(WeaponType::Cecchino, 100.0, 20.0) - 1.0).abs() < 1e-6);
        assert!((calculate_theoretical_ttk(WeaponType::Pompa, 100.0, 20.0) - 1.6).abs() < 1e-6);
        assert!((calculate_theoretical_ttk(WeaponType::Mitraglietta, 100.0, 20.0) - 0.8).abs() < 1e-6);
        assert!((calculate_theoretical_ttk(WeaponType::Coltello, 100.0, 2.0) - 0.8).abs() < 1e-6);
    }

    #[test]
    fn spread_stays_inside_cone() {
        let cfg = get_weapon_config(WeaponType::Assalto);
        assert_eq!(calculate_spread_angle(&cfg, 0, 1.0), cfg.spread_base_rad);
        assert!(calculate_spread_angle(&cfg, 3, 1.0) > cfg.spread_base_rad);
        assert_eq!(calculate_spread_angle(&cfg, 100, 2.0), cfg.spread_max_rad);
        for i in 0..100 {
            let spread = 0.04;
            let out = perturb_direction([0.0, 0.0, 1.0], spread, i as f64 / 100.0, ((i * 7) % 100) as f64 / 100.0);
            let angle = out[2].clamp(-1.0, 1.0).acos();
            assert!(angle <= spread + 1e-4);
        }
    }

    #[test]
    fn recoil_recovers() {
        let cfg = get_weapon_config(WeaponType::Assalto);
        let (pitch, yaw) = apply_recoil_kick(0.0, 0.0, &cfg, 0.5);
        assert_eq!(pitch, cfg.recoil_pitch_deg);
        assert_eq!(yaw, cfg.recoil_yaw_deg * 0.5);
        let (next_pitch, next_yaw) = recover_recoil(pitch, yaw, cfg.recoil_recovery_rate, 0.1);
        assert!(next_pitch < pitch);
        assert!(next_yaw < yaw);
    }

    #[test]
    fn cylinder_compatibility_and_wasm_json() {
        let hit = validate_hitscan_shot_internal(
            WeaponType::Assalto,
            [0.0, 1.0, -10.0],
            [0.0, 0.0, 1.0],
            [0.0, 0.0, 0.0],
            0.45,
            2.0,
        );
        assert!(hit.hit);
        assert!(!hit.is_headshot);
        let cfg_json = WasmCombatEngine::get_weapon_config(0);
        let parsed: serde_json::Value = serde_json::from_str(&cfg_json).unwrap();
        assert_eq!(parsed["effective_range_m"], 180.0);
        assert_eq!(parsed["falloff_start_m"], 35.0);
    }
}

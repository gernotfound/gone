//! Empirical adversarial verification for color rules and canonical combat balance.

use game_core::colors::{
    is_fluorescent, normalize_hex, rgb_to_hsv, SessionColorRegistry,
    MIN_FLUORESCENCE_SATURATION, MIN_FLUORESCENCE_VALUE, PRESET_NEON_PALETTE,
};
use game_core::weapons::{
    calculate_damage, calculate_theoretical_ttk, get_weapon_config,
    intersect_ray_cylinder, validate_hitscan_shot_internal, WeaponType,
};

#[test]
fn challenger_color_case_insensitivity_and_hex_prefix() {
    let mut registry = SessionColorRegistry::new();
    let res1 = registry.request_color_internal("player_alpha", "#00f0ff");
    assert!(res1.success);
    assert_eq!(res1.color.unwrap(), "#00F0FF");

    let res2 = registry.request_color_internal("player_beta", "00F0FF");
    assert!(!res2.success);
    assert_eq!(res2.error.unwrap(), "COLOR_ALREADY_TAKEN");

    let res3 = registry.request_color_internal("player_gamma", "00f0Ff");
    assert!(!res3.success);
    assert_eq!(res3.error.unwrap(), "COLOR_ALREADY_TAKEN");

    let res1_re = registry.request_color_internal("player_alpha", "00f0ff");
    assert!(res1_re.success);
    assert_eq!(res1_re.color.unwrap(), "#00F0FF");
}

#[test]
fn challenger_color_whitespace_handling() {
    let mut registry = SessionColorRegistry::new();
    let res = registry.request_color_internal("p1", "  #39FF14 \t\n");
    assert!(res.success);
    assert_eq!(res.color.unwrap(), "#39FF14");

    let bad1 = registry.request_color_internal("p2", "#39 FF14");
    assert!(!bad1.success);
    assert_eq!(bad1.error.unwrap(), "INVALID_HEX_FORMAT");

    let bad2 = registry.request_color_internal("p3", "# 39FF14");
    assert!(!bad2.success);
    assert_eq!(bad2.error.unwrap(), "INVALID_HEX_FORMAT");
}

#[test]
fn challenger_color_exact_hsv_boundary_verification() {
    assert!((MIN_FLUORESCENCE_SATURATION - 0.70).abs() < 1e-6);
    assert!((MIN_FLUORESCENCE_VALUE - 0.70).abs() < 1e-6);

    let (_, s_black, v_black) = rgb_to_hsv(0, 0, 0);
    assert_eq!((s_black, v_black), (0.0, 0.0));
    assert!(!is_fluorescent(0, 0, 0));

    let (_, s_white, v_white) = rgb_to_hsv(255, 255, 255);
    assert_eq!(s_white, 0.0);
    assert_eq!(v_white, 1.0);
    assert!(!is_fluorescent(255, 255, 255));

    let (_, s_low, v_high) = rgb_to_hsv(255, 79, 79);
    assert!(s_low < 0.70 && (v_high - 1.0).abs() < 1e-6);
    assert!(!is_fluorescent(255, 79, 79));

    let (_, s_pass, _) = rgb_to_hsv(255, 76, 76);
    assert!(s_pass >= 0.70);
    assert!(is_fluorescent(255, 76, 76));

    let (_, s_pure, v_low) = rgb_to_hsv(176, 0, 0);
    assert!((s_pure - 1.0).abs() < 1e-6 && v_low < 0.70);
    assert!(!is_fluorescent(176, 0, 0));

    let (_, _, v_pass) = rgb_to_hsv(181, 0, 0);
    assert!(v_pass >= 0.70);
    assert!(is_fluorescent(181, 0, 0));
}

#[test]
fn challenger_all_preset_neon_palette_strictly_pass() {
    for &hex in PRESET_NEON_PALETTE.iter() {
        let norm = normalize_hex(hex).expect("valid preset");
        let r = u8::from_str_radix(&norm[1..3], 16).unwrap();
        let g = u8::from_str_radix(&norm[3..5], 16).unwrap();
        let b = u8::from_str_radix(&norm[5..7], 16).unwrap();
        let (_, s, v) = rgb_to_hsv(r, g, b);
        assert!(s >= 0.70 - 1e-6 && v >= 0.70 - 1e-6);
        assert!(is_fluorescent(r, g, b));
    }
}

#[test]
fn challenger_weapon_ttk_matches_browser_balance() {
    let cases = [
        (WeaponType::Assalto, 20.0, 0.8),
        (WeaponType::Cecchino, 20.0, 1.0),
        (WeaponType::Pompa, 20.0, 1.6),
        (WeaponType::Mitraglietta, 20.0, 0.8),
        (WeaponType::Coltello, 2.0, 0.8),
    ];
    for (weapon, distance, expected) in cases {
        let ttk = calculate_theoretical_ttk(weapon, 100.0, distance);
        assert!((ttk - expected).abs() < 1e-4, "{:?}: {} != {}", weapon, ttk, expected);
        assert!(calculate_damage(weapon, distance, false) < 100.0);
    }
}

#[test]
fn challenger_weapon_damage_falloff_and_hard_ranges() {
    assert_eq!(calculate_damage(WeaponType::Assalto, 0.0, false), 18.0);
    assert_eq!(calculate_damage(WeaponType::Assalto, 35.0, false), 18.0);
    assert_eq!(calculate_damage(WeaponType::Assalto, 140.0, false), 10.0);
    assert_eq!(calculate_damage(WeaponType::Assalto, 180.0, false), 10.0);
    assert_eq!(calculate_damage(WeaponType::Assalto, 180.01, false), 0.0);

    assert_eq!(calculate_damage(WeaponType::Cecchino, 180.0, false), 70.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 450.0, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 550.0, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 550.01, false), 0.0);

    assert_eq!(calculate_damage(WeaponType::Pompa, 8.0, false), 64.0);
    assert!((calculate_damage(WeaponType::Pompa, 19.0, false) - 42.0).abs() < 1e-6);
    assert_eq!(calculate_damage(WeaponType::Pompa, 30.0, false), 20.0);
    assert_eq!(calculate_damage(WeaponType::Pompa, 42.0, false), 20.0);
    assert_eq!(calculate_damage(WeaponType::Pompa, 42.01, false), 0.0);

    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 15.0, false), 12.0);
    assert!((calculate_damage(WeaponType::Mitraglietta, 40.0, false) - 9.5).abs() < 1e-6);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 65.0, false), 7.0);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 90.0, false), 7.0);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 90.01, false), 0.0);

    let ranges = [0.0, 5.0, 15.0, 20.0, 30.0, 50.0, 90.0, 140.0, 180.0, 300.0, 450.0, 550.0, 600.0];
    for &weapon in &[WeaponType::Assalto, WeaponType::Cecchino, WeaponType::Pompa, WeaponType::Mitraglietta] {
        for pair in ranges.windows(2) {
            let first = calculate_damage(weapon, pair[0], false);
            let second = calculate_damage(weapon, pair[1], false);
            assert!(first >= second, "{:?} non-monotonic at {:?}: {} < {}", weapon, pair, first, second);
        }
    }
}

#[test]
fn challenger_knife_strict_2_6m_cutoff() {
    let cfg = get_weapon_config(WeaponType::Coltello);
    assert_eq!(cfg.effective_range_m, 2.6);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.6, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.6001, false), 0.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.0, true), 50.0);

    // Cylinder surface distance exactly inside/outside the canonical melee range.
    let hit = validate_hitscan_shot_internal(
        WeaponType::Coltello,
        [0.0, 1.0, -(2.59 + 0.45)],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0],
        0.45,
        2.0,
    );
    assert!(hit.hit);
    assert!((hit.distance - 2.59).abs() < 1e-4);

    let miss = validate_hitscan_shot_internal(
        WeaponType::Coltello,
        [0.0, 1.0, -(2.61 + 0.45)],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0],
        0.45,
        2.0,
    );
    assert!(!miss.hit);
}

#[test]
fn challenger_headshot_multipliers_and_cylinder_boundaries() {
    assert_eq!(calculate_damage(WeaponType::Assalto, 0.0, true), 27.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 0.0, true), 140.0);
    assert_eq!(calculate_damage(WeaponType::Pompa, 0.0, true), 80.0);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 0.0, true), 18.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.0, true), 50.0);

    let target = [0.0, 0.0, 0.0];
    let dir = [0.0, 0.0, 1.0];
    let body = intersect_ray_cylinder([0.0, 1.54, -10.0], dir, target, 0.45, 2.0, 100.0).unwrap();
    assert!(!body.1);
    let head = intersect_ray_cylinder([0.0, 1.56, -10.0], dir, target, 0.45, 2.0, 100.0).unwrap();
    assert!(head.1);
    assert!(intersect_ray_cylinder([0.44, 1.0, -10.0], dir, target, 0.45, 2.0, 100.0).is_some());
    assert!(intersect_ray_cylinder([0.46, 1.0, -10.0], dir, target, 0.45, 2.0, 100.0).is_none());
    assert!(intersect_ray_cylinder([0.0, -0.1, -10.0], dir, target, 0.45, 2.0, 100.0).is_none());
    assert!(intersect_ray_cylinder([0.0, 2.1, -10.0], dir, target, 0.45, 2.0, 100.0).is_none());
}

#[test]
fn challenger_ray_cylinder_edges_backward_and_internal_origin() {
    let target = [0.0, 0.0, 20.0];
    assert!(intersect_ray_cylinder([0.44999, 1.0, 0.0], [0.0, 0.0, 1.0], target, 0.45, 2.0, 100.0).is_some());
    assert!(intersect_ray_cylinder([0.45001, 1.0, 0.0], [0.0, 0.0, 1.0], target, 0.45, 2.0, 100.0).is_none());
    assert!(intersect_ray_cylinder([0.0, 1.0, 0.0], [0.0, 0.0, -1.0], target, 0.45, 2.0, 100.0).is_none());
    assert!(intersect_ray_cylinder([0.0, 1.0, 30.0], [0.0, 0.0, 1.0], target, 0.45, 2.0, 100.0).is_none());

    let internal = intersect_ray_cylinder([0.0, 1.0, 20.0], [0.0, 0.0, 1.0], target, 0.45, 2.0, 100.0).unwrap();
    assert_eq!(internal.0, 0.0);
    assert!(!internal.1);
    let internal_head = intersect_ray_cylinder([0.1, 1.75, 20.0], [0.0, 1.0, 0.0], target, 0.45, 2.0, 100.0).unwrap();
    assert_eq!(internal_head.0, 0.0);
    assert!(internal_head.1);

    let hit = validate_hitscan_shot_internal(
        WeaponType::Assalto,
        [0.0, 1.0, 20.0],
        [0.0, 0.0, 1.0],
        target,
        0.45,
        2.0,
    );
    assert!(hit.hit);
    assert_eq!(hit.distance, 0.0);
    assert_eq!(hit.damage, 18.0);
}

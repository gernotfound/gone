//! Challenger 1 - Empirical Adversarial Verification Suite
//! Tests color uniqueness, HSV boundaries, weapon TTK math [0.70s, 1.50s],
//! piecewise falloff at extreme ranges, knife 2.5m strict cutoff, and 3D hitscan geometry.

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

    // 1. Lowercase with hash
    let res1 = registry.request_color_internal("player_alpha", "#00f0ff");
    assert!(res1.success, "Should accept lowercase #00f0ff");
    assert_eq!(res1.color.unwrap(), "#00F0FF");

    // 2. Exact duplicate in uppercase without hash
    let res2 = registry.request_color_internal("player_beta", "00F0FF");
    assert!(!res2.success, "Should reject uppercase 00F0FF when #00F0FF is taken");
    assert_eq!(res2.error.unwrap(), "COLOR_ALREADY_TAKEN");

    // 3. Mixed case duplicate without hash
    let res3 = registry.request_color_internal("player_gamma", "00f0Ff");
    assert!(!res3.success, "Should reject mixed case duplicate");
    assert_eq!(res3.error.unwrap(), "COLOR_ALREADY_TAKEN");

    // 4. Same player re-requesting without hash should succeed idempotently
    let res1_re = registry.request_color_internal("player_alpha", "00f0ff");
    assert!(res1_re.success, "Idempotent re-request from same player must succeed");
    assert_eq!(res1_re.color.unwrap(), "#00F0FF");
}

#[test]
fn challenger_color_whitespace_handling() {
    let mut registry = SessionColorRegistry::new();

    // Leading and trailing spaces and tabs should be trimmed and normalized
    let res = registry.request_color_internal("p1", "  #39FF14 \t\n");
    assert!(res.success, "Whitespace around valid hex should be trimmed");
    assert_eq!(res.color.unwrap(), "#39FF14");

    // Internal spaces should be rejected as invalid hex format
    let res_bad1 = registry.request_color_internal("p2", "#39 FF14");
    assert!(!res_bad1.success, "Internal space should be rejected");
    assert_eq!(res_bad1.error.unwrap(), "INVALID_HEX_FORMAT");

    let res_bad2 = registry.request_color_internal("p3", "# 39FF14");
    assert!(!res_bad2.success, "Space after hash should be rejected");
    assert_eq!(res_bad2.error.unwrap(), "INVALID_HEX_FORMAT");
}

#[test]
fn challenger_color_exact_hsv_boundary_verification() {
    // Assert defined constants
    assert!((MIN_FLUORESCENCE_SATURATION - 0.70).abs() < 1e-6);
    assert!((MIN_FLUORESCENCE_VALUE - 0.70).abs() < 1e-6);

    // 1. Pure black (0, 0, 0)
    let (_, s_black, v_black) = rgb_to_hsv(0, 0, 0);
    assert_eq!(s_black, 0.0);
    assert_eq!(v_black, 0.0);
    assert!(!is_fluorescent(0, 0, 0), "Black must be non-fluorescent");

    // 2. Pure white (255, 255, 255)
    let (_, s_white, v_white) = rgb_to_hsv(255, 255, 255);
    assert_eq!(s_white, 0.0);
    assert_eq!(v_white, 1.0);
    assert!(!is_fluorescent(255, 255, 255), "White must be non-fluorescent");

    // 3. Saturation boundary: R=255, V=1.0. Vary G and B equally to modulate Saturation: S = 1.0 - (G/255)
    // For S = 0.6902 < 0.70: G = B = 79 => S = 1 - 79/255 = 0.690196
    let (_, s_low, v_high) = rgb_to_hsv(255, 79, 79);
    assert!(s_low < 0.70, "s_low ({}) must be < 0.70", s_low);
    assert!((v_high - 1.0).abs() < 1e-6);
    assert!(!is_fluorescent(255, 79, 79), "S < 0.70 must be rejected");

    // For S = 0.7020 > 0.70: G = B = 76 => S = 1 - 76/255 = 0.70196
    let (_, s_pass, _) = rgb_to_hsv(255, 76, 76);
    assert!(s_pass >= 0.70, "s_pass ({}) must be >= 0.70", s_pass);
    assert!(is_fluorescent(255, 76, 76), "S >= 0.70 and V >= 0.70 must be accepted");

    // 4. Value / Brightness boundary: S = 1.0 (G=B=0). Vary R: V = R / 255
    // For V = 0.6902 < 0.70: R = 176 => V = 176 / 255 = 0.690196
    let (_, s_pure, v_low) = rgb_to_hsv(176, 0, 0);
    assert!((s_pure - 1.0).abs() < 1e-6);
    assert!(v_low < 0.70, "v_low ({}) must be < 0.70", v_low);
    assert!(!is_fluorescent(176, 0, 0), "V < 0.70 must be rejected");

    // For V = 0.7098 > 0.70: R = 181 => V = 181 / 255 = 0.7098
    let (_, _, v_pass) = rgb_to_hsv(181, 0, 0);
    assert!(v_pass >= 0.70, "v_pass ({}) must be >= 0.70", v_pass);
    assert!(is_fluorescent(181, 0, 0), "V >= 0.70 and S = 1.0 must be accepted");
}

#[test]
fn challenger_all_preset_neon_palette_strictly_pass() {
    for &hex in PRESET_NEON_PALETTE.iter() {
        let norm = normalize_hex(hex).expect("Preset must have valid hex");
        let r = u8::from_str_radix(&norm[1..3], 16).unwrap();
        let g = u8::from_str_radix(&norm[3..5], 16).unwrap();
        let b = u8::from_str_radix(&norm[5..7], 16).unwrap();
        let (_h, s, v) = rgb_to_hsv(r, g, b);
        assert!(s >= 0.70 - 1e-6, "Preset {} has S = {} < 0.70", hex, s);
        assert!(v >= 0.70 - 1e-6, "Preset {} has V = {} < 0.70", hex, v);
        assert!(is_fluorescent(r, g, b), "Preset {} must be fluorescent", hex);
    }
}

#[test]
fn challenger_weapon_ttk_math_within_range() {
    // Requirements: High TTK [0.70s, 1.50s] against 100 HP target at typical medium engagement distance (20m; 2m for knife)
    let test_cases = [
        (WeaponType::Assalto, 20.0, "Assalto at 20m"),
        (WeaponType::Cecchino, 20.0, "Cecchino at 20m"),
        (WeaponType::Pompa, 20.0, "Pompa at 20m"),
        (WeaponType::Mitraglietta, 20.0, "Mitraglietta at 20m"),
        (WeaponType::Coltello, 2.0, "Coltello at 2m"),
    ];

    for (wt, dist, label) in test_cases {
        let ttk = calculate_theoretical_ttk(wt, 100.0, dist);
        assert!(
            ttk >= 0.70 && ttk <= 1.50,
            "{}: TTK {}s outside mandatory range [0.70s, 1.50s]",
            label,
            ttk
        );
        // Assert no one-shot body kill
        let dmg = calculate_damage(wt, dist, false);
        assert!(
            dmg < 100.0,
            "{}: Body damage {} must not be one-shot kill against 100 HP",
            label,
            dmg
        );
    }

    // Verify exact TTK numbers from documentation:
    // AR-42 at 20m: 17 dmg -> 6 hits -> TTK = (6-1)/6.25 = 0.800s
    assert!((calculate_theoretical_ttk(WeaponType::Assalto, 100.0, 20.0) - 0.800).abs() < 1e-4);
    // SR-99 at 20m: 70 dmg -> 2 hits -> TTK = (2-1)/1.00 = 1.000s
    assert!((calculate_theoretical_ttk(WeaponType::Cecchino, 100.0, 20.0) - 1.000).abs() < 1e-4);
    // SG-12 at 20m: 52.5 dmg -> 2 hits -> TTK = (2-1)/1.25 = 0.800s
    assert!((calculate_theoretical_ttk(WeaponType::Pompa, 100.0, 20.0) - 0.800).abs() < 1e-4);
    // SMG-7 at 20m: 10 dmg -> 10 hits -> TTK = (10-1)/10.0 = 0.900s
    assert!((calculate_theoretical_ttk(WeaponType::Mitraglietta, 100.0, 20.0) - 0.900).abs() < 1e-4);
    // CB-01 at 2m: 50 dmg -> 2 hits -> TTK = (2-1)/1.25 = 0.800s
    assert!((calculate_theoretical_ttk(WeaponType::Coltello, 100.0, 2.0) - 0.800).abs() < 1e-4);
}

#[test]
fn challenger_weapon_damage_falloff_extreme_ranges() {
    // Test points: 0m, 10m, 70m, 150m, 500m
    
    // 0m (Point-blank):
    assert_eq!(calculate_damage(WeaponType::Assalto, 0.0, false), 18.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 0.0, false), 70.0);
    assert_eq!(calculate_damage(WeaponType::Pompa, 0.0, false), 64.0);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 0.0, false), 12.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 0.0, false), 50.0);

    // 10m (Falloff start for AR, Shotgun, SMG):
    assert_eq!(calculate_damage(WeaponType::Assalto, 10.0, false), 18.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 10.0, false), 70.0);
    assert_eq!(calculate_damage(WeaponType::Pompa, 10.0, false), 64.0);
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 10.0, false), 12.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 10.0, false), 0.0); // knife out of range

    // 70m (Falloff end for AR):
    assert_eq!(calculate_damage(WeaponType::Assalto, 70.0, false), 12.0);
    assert_eq!(calculate_damage(WeaponType::Cecchino, 70.0, false), 70.0); // Sniper falloff starts at 100m
    assert_eq!(calculate_damage(WeaponType::Pompa, 70.0, false), 41.0); // Min damage
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 70.0, false), 6.0); // Min damage
    assert_eq!(calculate_damage(WeaponType::Coltello, 70.0, false), 0.0);

    // 150m (AR effective range limit):
    assert_eq!(calculate_damage(WeaponType::Assalto, 150.0, false), 12.0);
    // Sniper at 150m: (150-100)/(300-100) = 50/200 = 0.25 -> 70 - (70-55)*0.25 = 66.25
    assert_eq!(calculate_damage(WeaponType::Cecchino, 150.0, false), 66.25);

    // 500m (Sniper effective range limit):
    assert_eq!(calculate_damage(WeaponType::Cecchino, 500.0, false), 55.0); // Min damage clamp

    // Monotonicity verification: Damage at d1 >= Damage at d2 for all d1 <= d2
    let ranges = [0.0, 5.0, 10.0, 20.0, 30.0, 50.0, 70.0, 100.0, 150.0, 200.0, 300.0, 500.0];
    for &wt in &[WeaponType::Assalto, WeaponType::Cecchino, WeaponType::Pompa, WeaponType::Mitraglietta] {
        for i in 0..ranges.len() - 1 {
            let d1 = ranges[i];
            let d2 = ranges[i + 1];
            let dmg1 = calculate_damage(wt, d1, false);
            let dmg2 = calculate_damage(wt, d2, false);
            assert!(
                dmg1 >= dmg2,
                "Weapon {:?} non-monotonic falloff: dmg({}) = {} < dmg({}) = {}",
                wt, d1, dmg1, d2, dmg2
            );
        }
    }
}

#[test]
fn challenger_knife_strict_2_5m_cutoff() {
    let cfg = get_weapon_config(WeaponType::Coltello);
    assert_eq!(cfg.effective_range_m, 2.5);

    // Within melee range
    assert_eq!(calculate_damage(WeaponType::Coltello, 0.0, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 1.0, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.49, false), 50.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.500, false), 50.0);

    // Past melee range - MUST be strictly 0.0
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.5001, false), 0.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.51, false), 0.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 3.0, false), 0.0);
    assert_eq!(calculate_damage(WeaponType::Coltello, 10.0, false), 0.0);

    // Knife Hitscan Validation:
    // Cylinder at origin [0, 0, 0], radius 0.45.
    // Front surface is at distance: (origin_z - 0.45).
    // Test 1: surface distance = 2.49m -> origin at z = - (2.49 + 0.45) = -2.94m
    let ray_hit = validate_hitscan_shot_internal(
        WeaponType::Coltello,
        [0.0, 1.0, -2.94],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0],
        0.45,
        2.0,
    );
    assert!(ray_hit.hit, "Knife should hit within 2.49m surface distance");
    assert_eq!(ray_hit.damage, 50.0);
    assert!((ray_hit.distance - 2.49).abs() < 1e-4);

    // Test 2: surface distance = 2.51m -> origin at z = - (2.51 + 0.45) = -2.96m
    let ray_miss = validate_hitscan_shot_internal(
        WeaponType::Coltello,
        [0.0, 1.0, -2.96],
        [0.0, 0.0, 1.0],
        [0.0, 0.0, 0.0],
        0.45,
        2.0,
    );
    assert!(!ray_miss.hit, "Knife must NOT hit beyond 2.50m (at 2.51m)");
    assert_eq!(ray_miss.damage, 0.0);
}

#[test]
fn challenger_headshot_multiplier_and_boundary_intersections() {
    // 1. Headshot multipliers
    assert_eq!(calculate_damage(WeaponType::Assalto, 0.0, true), 27.0); // 18 * 1.5
    assert_eq!(calculate_damage(WeaponType::Cecchino, 0.0, true), 140.0); // 70 * 2.0 -> 1-shot kill!
    assert_eq!(calculate_damage(WeaponType::Pompa, 0.0, true), 96.0); // 64 * 1.5
    assert_eq!(calculate_damage(WeaponType::Mitraglietta, 0.0, true), 18.0); // 12 * 1.5
    assert_eq!(calculate_damage(WeaponType::Coltello, 2.0, true), 75.0); // 50 * 1.5

    // 2. 3D Ray-Cylinder Headshot Height Boundary (relative hit height >= 1.55m):
    let target_base = [0.0, 0.0, 0.0];
    let radius = 0.45;
    let height = 2.0;
    let dir = [0.0, 0.0, 1.0];

    // Just below headshot boundary (y = 1.54m):
    let hit_body = intersect_ray_cylinder([0.0, 1.54, -10.0], dir, target_base, radius, height, 100.0);
    assert!(hit_body.is_some());
    let (_, is_hs_body) = hit_body.unwrap();
    assert!(!is_hs_body, "y=1.54m must NOT be classified as headshot");

    // At or just above headshot boundary (y = 1.56m):
    let hit_head = intersect_ray_cylinder([0.0, 1.56, -10.0], dir, target_base, radius, height, 100.0);
    assert!(hit_head.is_some());
    let (_, is_hs_head) = hit_head.unwrap();
    assert!(is_hs_head, "y=1.56m MUST be classified as headshot");

    // 3. Cylinder Grazing Lateral Boundary (radius = 0.45m):
    // Grazing hit at x = 0.44m:
    let graze_hit = intersect_ray_cylinder([0.44, 1.0, -10.0], dir, target_base, radius, height, 100.0);
    assert!(graze_hit.is_some(), "x=0.44m (within radius 0.45m) must hit");

    // Grazing miss at x = 0.46m:
    let graze_miss = intersect_ray_cylinder([0.46, 1.0, -10.0], dir, target_base, radius, height, 100.0);
    assert!(graze_miss.is_none(), "x=0.46m (outside radius 0.45m) must miss");

    // 4. Vertical Bounds (y < 0.0 or y > 2.0):
    let under_miss = intersect_ray_cylinder([0.0, -0.1, -10.0], dir, target_base, radius, height, 100.0);
    assert!(under_miss.is_none(), "Ray under cylinder base must miss");

    let over_miss = intersect_ray_cylinder([0.0, 2.1, -10.0], dir, target_base, radius, height, 100.0);
    assert!(over_miss.is_none(), "Ray above cylinder top must miss");
}

#[test]
fn challenger2_ray_cylinder_knife_edge_and_internal_origin() {
    let target_base = [0.0, 0.0, 20.0];
    let radius = 0.45;
    let height = 2.0;

    // 1. Extreme Knife-Edge Grazing: r = 0.44999 (HIT) vs r = 0.45001 (MISS)
    // Ray parallel to Z-axis
    let hit_44999 = intersect_ray_cylinder([0.44999, 1.0, 0.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(hit_44999.is_some(), "r=0.44999 must hit cylinder side");
    let (d_hit, is_hs) = hit_44999.unwrap();
    assert!(!is_hs);
    assert!((d_hit - 19.997).abs() < 1e-2);

    let miss_45001 = intersect_ray_cylinder([0.45001, 1.0, 0.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(miss_45001.is_none(), "r=0.45001 must miss cylinder side");

    // Negative X side knife edge
    let hit_neg_44999 = intersect_ray_cylinder([-0.44999, 1.0, 0.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(hit_neg_44999.is_some(), "-r=-0.44999 must hit cylinder side");

    let miss_neg_45001 = intersect_ray_cylinder([-0.45001, 1.0, 0.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(miss_neg_45001.is_none(), "-r=-0.45001 must miss cylinder side");

    // 2. Backward Rays
    // Ray fired in opposite direction (-Z) while target is at +Z
    let backward_ray = intersect_ray_cylinder([0.0, 1.0, 0.0], [0.0, 0.0, -1.0], target_base, radius, height, 100.0);
    assert!(backward_ray.is_none(), "Backward ray [0, 0, -1] must never hit target at +Z");

    let backward_oblique = intersect_ray_cylinder([0.0, 1.0, 10.0], [-1.0, 0.0, -1.0], target_base, radius, height, 100.0);
    assert!(backward_oblique.is_none(), "Backward oblique ray must never hit target at +Z");

    let target_behind_shooter = intersect_ray_cylinder([0.0, 1.0, 30.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(target_behind_shooter.is_none(), "Ray fired forward when target is behind shooter must never hit");

    // 3. Internal Shooter Origin (Point Blank Inside Cylinder)
    // Center inside: [0.0, 1.0, 20.0]
    let internal_center = intersect_ray_cylinder([0.0, 1.0, 20.0], [0.0, 0.0, 1.0], target_base, radius, height, 100.0);
    assert!(internal_center.is_some(), "Shooter inside cylinder center must register hit");
    let (d_int, is_hs_int) = internal_center.unwrap();
    assert_eq!(d_int, 0.0, "Distance for internal origin must be 0.0");
    assert!(!is_hs_int);

    // Head level inside: [0.1, 1.75, 20.0]
    let internal_head = intersect_ray_cylinder([0.1, 1.75, 20.0], [0.0, 1.0, 0.0], target_base, radius, height, 100.0);
    assert!(internal_head.is_some(), "Shooter inside cylinder at head height must hit");
    let (d_head, is_hs_head) = internal_head.unwrap();
    assert_eq!(d_head, 0.0);
    assert!(is_hs_head, "Internal origin at y=1.75m must register as headshot");

    // Full combat engine validation
    let hitscan_res = validate_hitscan_shot_internal(WeaponType::Assalto, [0.0, 1.0, 20.0], [0.0, 0.0, 1.0], target_base, radius, height);
    assert!(hitscan_res.hit);
    assert_eq!(hitscan_res.distance, 0.0);
    assert_eq!(hitscan_res.damage, 18.0); // Full base damage at 0m
}


//! Challenger 2 - Empirical Adversarial Stress Test Suite for Milestone 2
//!
//! Adversarially challenges:
//! 1. Backtracking exploit prevention: clamping at max_unlag_ms and server max_history_ms.
//! 2. Self-damage prevention: shooter_id == victim_id across all weapon types, boundary IDs, and WASM bindings.
//! 3. Melee weapon range cutoff: strict 2.6m knife cutoff during temporal rewind, even with spoofed max_range.
//! 4. Headshot vertical boundaries, elevated targets, and top cap intersections during rewind.
//! 5. Ring buffer robustness: extreme timestamps (NaN, Inf), non-monotonic packet rejections, saturation.

use game_core::lag_compensation::{
    LagCompensationEngine, PlayerSnapshot, SnapshotRingBuffer, WasmLagCompensator,
};
use game_core::weapons::{HitscanResult, WeaponType};

const EPSILON: f64 = 1e-3;

// =========================================================================
// 1. BACKTRACKING EXPLOIT PREVENTION
// =========================================================================

#[test]
fn challenger2_backtracking_arbitrary_past_rewind_strictly_clamped() {
    let mut engine = LagCompensationEngine::new(1000.0); // 1000ms max history
    let victim_id = 10;

    // Target moves 10m/s along X axis from t=0 to t=10000ms (10 seconds)
    // t = 0ms: X = 0.0m
    // t = 5000ms: X = 50.0m
    // t = 9000ms: X = 90.0m
    // t = 10000ms: X = 100.0m (Current host time)
    engine.record_position(victim_id, 0.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 5000.0, 50.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 9000.0, 90.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 10000.0, 100.0, 0.0, 10.0, 0.45, 2.0);

    let shooter_id = 99;

    // Attack 1: Rewind 10 seconds into the past (shot_time = 0.0ms) aiming at X = 0.0m
    // Max unlag is 1000ms -> Target is clamped to 10000 - 1000 = 9000ms
    // At t=9000ms, victim is at X = 90.0m. Shot aimed at X = 0.0m MUST MISS.
    let exploit_10s = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        0.0,    // 10 seconds ago
        1000.0, // max unlag requested
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !exploit_10s.hit,
        "CRITICAL SECURITY FAILURE: 10s past backtracking exploit was NOT prevented! Target was hit at X=0."
    );
    assert_eq!(exploit_10s.damage, 0.0);

    // Attack 2: Rewind 5 seconds into the past (shot_time = 5000.0ms) aiming at X = 50.0m
    // Clamped to 9000ms (X = 90.0m). Shot aimed at X = 50.0m MUST MISS.
    let exploit_5s = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        5000.0, // 5 seconds ago
        1000.0,
        50.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !exploit_5s.hit,
        "CRITICAL SECURITY FAILURE: 5s past backtracking exploit was NOT prevented!"
    );

    // Attack 3: Malicious client attempts to bypass server max_history_ms by sending huge max_unlag_ms = 999999.0
    let exploit_huge_unlag = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        0.0,
        999999.0, // Spoofed client unlag window
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !exploit_huge_unlag.hit,
        "CRITICAL SECURITY FAILURE: Client spoofed max_unlag_ms bypassed server max_history_ms clamp!"
    );

    // Attack 4: Malicious client sends negative or zero max_unlag_ms = -500.0
    let exploit_neg_unlag = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        0.0,
        -500.0, // Negative unlag parameter
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !exploit_neg_unlag.hit,
        "Negative max_unlag_ms must default to server limit and reject arbitrary past shot"
    );

    // Legitimate rewind: Shot at t = 9500ms (500ms ago <= 1000ms window)
    // Interpolated X at 9500ms: 90.0 + 0.5 * (100.0 - 90.0) = 95.0m
    let legit_rewind = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        9500.0,
        1000.0,
        95.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        legit_rewind.hit,
        "Legitimate rewind within 1000ms window at t=9500ms must HIT interpolated target at X=95.0m"
    );
    assert_eq!(legit_rewind.damage, 18.0);
}

#[test]
fn challenger2_backtracking_with_buffer_saturation_and_overflow() {
    let mut engine = LagCompensationEngine::new(2000.0);
    let victim_id = 77;

    // Fill buffer with 300 snapshots, spacing 20ms (total time span 6000ms)
    // Snapshot buffer capacity is 128 -> only the newest 128 snapshots survive (last 2540ms)
    for i in 0..300 {
        let t = (i * 20) as f64; // t = 0 to 5980ms
        let x = (i as f64) * 0.1; // x = 0.0 to 29.9m
        engine.record_position(victim_id, t, x, 0.0, 10.0, 0.45, 2.0);
    }

    // Newest is at t = 5980.0ms, X = 29.9m.
    // Oldest surviving snapshot in 128-element buffer is index 300 - 128 = 172:
    // t = 172 * 20 = 3440.0ms, X = 17.2m.
    // Attacker tries to rewind to t = 1000.0ms (which was overwritten 128 cycles ago)
    let shooter_id = 1;
    let old_shot = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        1000.0,
        2000.0,
        1.0, 1.0, 0.0, // X=1.0 was position at t=1000ms
        0.0, 0.0, 1.0,
        0.0,
    );

    assert!(
        !old_shot.hit,
        "Shot querying evicted history MUST NOT hit old position X=1.0m"
    );

    // Clamping will clamp to min_allowed = 5980 - 2000 = 3980ms
    // Position at 3980ms: index 199 -> X = 19.9m
    let clamped_valid_shot = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        1000.0,
        2000.0,
        19.9, 1.0, 0.0, // Aimed at clamped position
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        clamped_valid_shot.hit,
        "Shot clamped to 3980ms should hit target at X=19.9m"
    );
}

// =========================================================================
// 2. SELF-DAMAGE EXPLOIT PREVENTION
// =========================================================================

#[test]
fn challenger2_self_damage_strictly_prevented_all_weapons_and_ids() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let player_id = 42;

    // Player records position at feet [0.0, 0.0, 5.0], cylinder height 2.0
    engine.record_position(player_id, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);

    // Test all 5 weapons aiming directly at own feet and chest from inside or adjacent
    let weapon_types = [
        WeaponType::Assalto,
        WeaponType::Cecchino,
        WeaponType::Pompa,
        WeaponType::Mitraglietta,
        WeaponType::Coltello,
    ];

    for wt in weapon_types {
        // 1. Shooter ID == Victim ID (Chest shot)
        let res_chest = engine.validate_rewind_hitscan_full(
            player_id,
            player_id, // Self-shot
            wt.as_u32(),
            1000.0,
            1000.0,
            0.0, 1.0, 4.0, // In front of chest pointing into body
            0.0, 0.0, 1.0,
            0.0,
        );
        assert!(
            !res_chest.hit,
            "CRITICAL: Weapon {:?} allowed self-damage on chest shot!",
            wt
        );
        assert_eq!(res_chest.damage, 0.0);
        assert_eq!(res_chest.distance, 0.0);

        // 2. Shooter ID == Victim ID (Internal point blank: ray origin inside cylinder)
        let res_inside = engine.validate_rewind_hitscan_full(
            player_id,
            player_id,
            wt.as_u32(),
            1000.0,
            1000.0,
            0.0, 1.0, 5.0, // Exact center inside cylinder
            0.0, -1.0, 0.0, // Pointing at feet
            0.0,
        );
        assert!(
            !res_inside.hit,
            "CRITICAL: Weapon {:?} allowed self-damage on internal origin shot!",
            wt
        );
        assert_eq!(res_inside.damage, 0.0);
    }

    // Boundary ID tests:
    // Case 1: ID = 0 (Common default/uninitialized slot)
    engine.record_position(0, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);
    let res_zero = engine.validate_rewind_hitscan_full(
        0, 0, WeaponType::Assalto.as_u32(),
        1000.0, 1000.0,
        0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
    );
    assert!(!res_zero.hit, "Self-damage check failed for player_id = 0");

    // Case 2: ID = u32::MAX
    engine.record_position(u32::MAX, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);
    let res_max = engine.validate_rewind_hitscan_full(
        u32::MAX, u32::MAX, WeaponType::Assalto.as_u32(),
        1000.0, 1000.0,
        0.0, 1.0, 0.0, 0.0, 0.0, 1.0, 0.0,
    );
    assert!(!res_max.hit, "Self-damage check failed for player_id = u32::MAX");

    // Case 3: Shooter ID != Victim ID at same position MUST register hit
    let enemy_id = 43;
    let res_enemy = engine.validate_rewind_hitscan_full(
        enemy_id,
        player_id,
        WeaponType::Assalto.as_u32(),
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(res_enemy.hit, "Enemy shot at same position must HIT");
    assert_eq!(res_enemy.damage, 18.0);
}

#[test]
fn challenger2_wasm_binding_self_damage_and_malformed_json() {
    let mut wasm_engine = WasmLagCompensator::new(1000.0);
    let pid = 5;

    wasm_engine.record_player_position(pid, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);

    // Call WASM binding with shooter == victim
    let json_res = wasm_engine.validate_rewind_hitscan(
        pid,
        pid,
        WeaponType::Cecchino.as_u32(),
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );

    let parsed: HitscanResult = serde_json::from_str(&json_res).expect("Valid JSON");
    assert!(!parsed.hit);
    assert_eq!(parsed.damage, 0.0);
    assert_eq!(parsed.distance, 0.0);
    assert!(!parsed.is_headshot);

    // Call with invalid weapon type ID = 999
    let json_bad_weapon = wasm_engine.validate_rewind_hitscan(
        1,
        pid,
        999, // Invalid weapon enum
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    let parsed_bad: HitscanResult = serde_json::from_str(&json_bad_weapon).expect("Valid JSON");
    assert!(!parsed_bad.hit, "Invalid weapon enum must safely return miss");
}

// =========================================================================
// 3. MELEE WEAPON RANGE CUTOFF (2.6M) DURING TEMPORAL REWIND
// =========================================================================

#[test]
fn challenger2_melee_knife_strict_2_6m_range_cutoff_during_rewind() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id = 88;
    let shooter_id = 1;

    // Numerical Scenario: Target runs away from shooter
    // Shooter is at [0.0, 1.0, 0.0]
    // Target base radius = 0.45m.
    // Distance from shooter to cylinder surface along Z = (target_z - 0.45)
    //
    // At t = 1000ms: Target base at Z = 2.94m -> Surface distance = 2.94 - 0.45 = 2.49m (<= 2.6m, in melee range)
    // At t = 1100ms: Target base at Z = 3.50m -> Surface distance = 3.50 - 0.45 = 3.05m (> 2.6m, out of melee range)
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 2.94, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 0.0, 0.0, 3.50, 0.45, 2.0);

    // 1. Rewind to t = 1000ms (Target at surface distance 2.49m)
    // MUST register a HIT with 999.0 damage
    let knife_hit_rewind = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Coltello.as_u32(),
        1000.0, // Rewind to 1000ms
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0, // default range -> canonical 2.6m
    );
    assert!(
        knife_hit_rewind.hit,
        "Melee knife within 2.6m range (2.49m) at rewound time MUST HIT!"
    );
    assert!((knife_hit_rewind.distance - 2.49).abs() < EPSILON);
    assert_eq!(knife_hit_rewind.damage, 999.0);

    // 2. Current time t = 1100ms (Target at surface distance 3.05m)
    // MUST register a MISS with 0.0 damage
    let knife_miss_current = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Coltello.as_u32(),
        1100.0, // Current time
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !knife_miss_current.hit,
        "Melee knife beyond 2.6m range (3.05m) at current time MUST MISS!"
    );
    assert_eq!(knife_miss_current.damage, 0.0);

    // 3. Knife range boundary during rewind:
    // Create exact 2.6000m vs 2.6001m scenarios
    let victim_exact = 89;
    // Surface distance = 3.05 - 0.45 = 2.6000m
    engine.record_position(victim_exact, 1000.0, 0.0, 0.0, 3.05, 0.45, 2.0);

    let knife_boundary_hit = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_exact,
        WeaponType::Coltello.as_u32(),
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        knife_boundary_hit.hit,
        "Knife at exact boundary 2.600m must HIT"
    );
    assert_eq!(knife_boundary_hit.damage, 999.0);

    // Surface distance = 3.0501 - 0.45 = 2.6001m
    let victim_over = 90;
    engine.record_position(victim_over, 1000.0, 0.0, 0.0, 3.0501, 0.45, 2.0);

    let knife_boundary_miss = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_over,
        WeaponType::Coltello.as_u32(),
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    assert!(
        !knife_boundary_miss.hit,
        "Knife past boundary (2.6001m) MUST MISS"
    );
    assert_eq!(knife_boundary_miss.damage, 0.0);

    // 4. Client attempts to pass spoofed max_range = 100.0m for melee knife
    let knife_spoofed_range = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Coltello.as_u32(),
        1100.0, // target is at 3.05m
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0, // Spoofed max_range
    );
    assert!(
        !knife_spoofed_range.hit,
        "SECURITY FAILURE: Spoofed max_range for knife must be clamped to 2.6m effective range!"
    );
}

// =========================================================================
// 4. HEADSHOT BOUNDARIES & VERTICAL ELEVATIONS DURING REWIND
// =========================================================================

#[test]
fn challenger2_headshot_boundaries_and_elevations_during_rewind() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id = 66;
    let shooter_id = 2;

    // Elevated spawn platform: Target at Y = 17.5m (G.O.N.E. central platform)
    // Cylinder base at Y = 17.5m, top at Y = 19.5m.
    // Headshot zone is [17.5 + 1.55, 17.5 + 2.0] = [19.05m, 19.50m].
    // Body zone is [17.50m, 19.05m).
    // Target is at Z = 20.0m.
    engine.record_position(victim_id, 1000.0, 0.0, 17.5, 20.0, 0.45, 2.0);

    let shooter_origin_x = 0.0;
    let shooter_origin_z = 0.0;
    let dir = [0.0, 0.0, 1.0]; // Firing parallel to ground along +Z

    // 1. Headshot at Y = 19.10m (rel_y = 1.60m >= 1.55m)
    let hs_elevated = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Cecchino.as_u32(),
        1000.0,
        1000.0,
        shooter_origin_x, 19.10, shooter_origin_z,
        dir[0], dir[1], dir[2],
        0.0,
    );
    assert!(hs_elevated.hit, "Elevated target headshot must hit");
    assert!(hs_elevated.is_headshot, "Y=19.10m on base Y=17.5m must be headshot");
    assert_eq!(hs_elevated.damage, 140.0, "Sniper headshot must deal 140.0 dmg");

    // 2. Just below headshot line: Y = 19.04m (rel_y = 1.54m < 1.55m)
    let body_elevated = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Cecchino.as_u32(),
        1000.0,
        1000.0,
        shooter_origin_x, 19.04, shooter_origin_z,
        dir[0], dir[1], dir[2],
        0.0,
    );
    assert!(body_elevated.hit, "Elevated target body shot must hit");
    assert!(!body_elevated.is_headshot, "Y=19.04m must be classified as body hit");
    assert_eq!(body_elevated.damage, 70.0, "Sniper body shot must deal 70.0 dmg");

    // 3. Just above headshot line: Y = 19.06m (rel_y = 1.56m >= 1.55m)
    let hs_boundary = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        1000.0,
        1000.0,
        shooter_origin_x, 19.06, shooter_origin_z,
        dir[0], dir[1], dir[2],
        0.0,
    );
    assert!(hs_boundary.hit);
    assert!(hs_boundary.is_headshot, "Y=19.06m must be headshot");
    // At 19.55m distance, Assalto is still before the canonical 35m falloff start.
    // Headshot multiplier is 1.5: 18.0 * 1.5 = 27.0.
    assert!((hs_boundary.damage - 27.0).abs() < 1e-4);

    // Also test non-falloff distance at Z = 10.0m (distance = 9.55m <= 10.0m falloff start)
    let victim_close = 67;
    engine.record_position(victim_close, 1000.0, 0.0, 17.5, 10.0, 0.45, 2.0);
    let hs_close = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_close,
        WeaponType::Assalto.as_u32(),
        1000.0,
        1000.0,
        shooter_origin_x, 19.06, shooter_origin_z,
        dir[0], dir[1], dir[2],
        0.0,
    );
    assert!(hs_close.hit);
    assert!(hs_close.is_headshot);
    assert_eq!(hs_close.damage, 27.0); // Exactly 18.0 * 1.5 with 0 falloff

    // 4. Over cylinder top: Y = 19.55m
    let over_top = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Assalto.as_u32(),
        1000.0,
        1000.0,
        shooter_origin_x, 19.55, shooter_origin_z,
        dir[0], dir[1], dir[2],
        0.0,
    );
    assert!(!over_top.hit, "Ray above top of cylinder must MISS");

    // 5. Downward angled sniper shot hitting cylinder top cap
    // Shooter at [0.0, 30.0, 10.0] looking down-forward at target at [0.0, 17.5, 20.0]
    // Vector to top center [0.0, 19.5, 20.0] is [0.0, -10.5, 10.0]
    let down_dir = [0.0, -1.05, 1.0];
    let top_cap_shot = engine.validate_rewind_hitscan_full(
        shooter_id,
        victim_id,
        WeaponType::Cecchino.as_u32(),
        1000.0,
        1000.0,
        0.0, 30.0, 10.0,
        down_dir[0], down_dir[1], down_dir[2],
        0.0,
    );
    assert!(top_cap_shot.hit, "Downward shot intersecting top cap must HIT");
    assert!(
        top_cap_shot.is_headshot,
        "Top cap hit (y = base + height = 19.5 >= 1.55) must be HEADSHOT"
    );
    assert_eq!(top_cap_shot.damage, 140.0);
}

// =========================================================================
// 5. RING BUFFER ROBUSTNESS & ADVERSARIAL FLOATS
// =========================================================================

#[test]
fn challenger2_ring_buffer_extreme_floats_and_rejections() {
    let mut buffer = SnapshotRingBuffer::new(128);

    // Initial snapshot
    buffer.push(PlayerSnapshot {
        timestamp_ms: 1000.0,
        x: 0.0,
        y: 0.0,
        z: 0.0,
        radius: 0.45,
        height: 2.0,
    });
    buffer.push(PlayerSnapshot {
        timestamp_ms: 2000.0,
        x: 10.0,
        y: 0.0,
        z: 0.0,
        radius: 0.45,
        height: 2.0,
    });

    // Out-of-order packet: timestamp 1500.0 after 2000.0 must be discarded
    buffer.push(PlayerSnapshot {
        timestamp_ms: 1500.0,
        x: 999.0,
        y: 0.0,
        z: 0.0,
        radius: 0.45,
        height: 2.0,
    });
    assert_eq!(buffer.len(), 2, "Out-of-order snapshot must be rejected");
    assert_eq!(buffer.newest().unwrap().timestamp_ms, 2000.0);
    assert_eq!(buffer.newest().unwrap().x, 10.0);

    // Extreme float queries:
    // 1. Negative infinity
    let neg_inf = buffer.sample_at(f64::NEG_INFINITY);
    assert!(neg_inf.is_some());
    assert_eq!(neg_inf.unwrap().timestamp_ms, 1000.0); // Clamped to oldest

    // 2. Positive infinity
    let pos_inf = buffer.sample_at(f64::INFINITY);
    assert!(pos_inf.is_some());
    assert_eq!(pos_inf.unwrap().timestamp_ms, 2000.0); // Clamped to newest

    // Sub-microsecond identical timestamps: dt < 1e-6
    buffer.push(PlayerSnapshot {
        timestamp_ms: 2000.0000001, // dt = 1e-7 < 1e-6
        x: 20.0,
        y: 0.0,
        z: 0.0,
        radius: 0.45,
        height: 2.0,
    });
    let sampled_near = buffer.sample_at(2000.00000005);
    assert!(sampled_near.is_some());
    assert!(!sampled_near.unwrap().x.is_nan(), "LERP with dt < 1e-6 must not produce NaN");
}

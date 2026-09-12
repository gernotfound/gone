//! Milestone 2 - Comprehensive Lag Compensation Test Verification Suite
//!
//! Tests exact 100ms rewind hit confirmation, current time miss, LERP interpolation,
//! headshot classification, clamped max unlag, and adversarial edge cases.

use game_core::lag_compensation::{
    LagCompensationEngine, PlayerSnapshot, SnapshotRingBuffer, WasmLagCompensator,
};
use game_core::weapons::{HitscanResult, WeaponType};

const EPSILON: f64 = 1e-3;

/// Test 1 & 2: Acceptance Criterion - Rewind of 100ms -> evaluates target at (0, 0, 10) -> Hit Confirmed.
/// Current Time Evaluation - No rewind -> target at (1, 0, 10) -> Miss.
#[test]
fn test_m2_100ms_temporal_rewind_hit_vs_current_time_miss() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 42;

    // Numerical Scenario: Target at (0, 0, 10) at t=1000ms, moves to (1, 0, 10) at t=1100ms
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 1.0, 0.0, 10.0, 0.45, 2.0);

    // Shooter fired at t=1100ms aimed along ray through (0, 0, 10)
    let shooter_origin = [0.0, 1.0, 0.0];
    let shooter_dir = [0.0, 0.0, 1.0]; // Forward along +Z

    // --- TEST 1: Rewind of 100ms (t = 1000ms) -> HIT CONFIRMED ---
    let rewind_res = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0, // Rewind 100ms
        1000.0, // Max unlag window
        shooter_origin,
        shooter_dir,
    );

    assert!(
        rewind_res.hit,
        "ACCEPTANCE CRITERIA FAILURE: Shot aimed at (0, 0, 10) with 100ms rewind MUST be a confirmed HIT!"
    );
    assert!(
        (rewind_res.distance - 9.55).abs() < EPSILON,
        "Hit distance should be 9.55m (10m - 0.45m radius), got {}",
        rewind_res.distance
    );
    assert!(
        !rewind_res.is_headshot,
        "Shot at chest height Y=1.0m must be a body hit"
    );
    assert_eq!(
        rewind_res.damage, 18.0,
        "Assault rifle damage at 9.55m must be full base damage 18.0"
    );

    // --- TEST 2: No rewind (Current position at t = 1100ms) -> MISS ---
    let current_res = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1100.0, // Current time
        1000.0,
        shooter_origin,
        shooter_dir,
    );

    assert!(
        !current_res.hit,
        "At current time t=1100ms, target moved to X=1.0m; shot at X=0.0m MUST be a MISS!"
    );
    assert_eq!(current_res.damage, 0.0);
    assert_eq!(current_res.distance, 0.0);
}

/// Test 3: Multiple snapshots interpolation (e.g. t=1050ms halfway position and t=1025ms quarter-way)
#[test]
fn test_m2_snapshot_linear_interpolation_halfway_and_quarters() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 101;

    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 1.0, 0.0, 10.0, 0.45, 2.0);

    // 1. Halfway evaluation at t = 1050ms: target must be interpolated to X = 0.50m
    // Shot aimed at X = 0.50m must HIT
    let hit_half = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1050.0,
        1000.0,
        [0.50, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        hit_half.hit,
        "Shot aimed at interpolated halfway position X=0.50m must HIT at t=1050ms"
    );
    assert!((hit_half.distance - 9.55).abs() < EPSILON);

    // 2. Shot aimed at old position X = 0.0m at t = 1050ms must MISS (distance to axis = 0.50m > 0.45m)
    let miss_old = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1050.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        !miss_old.hit,
        "Shot aimed at X=0.0m must MISS when target has interpolated to X=0.50m"
    );

    // 3. Shot aimed at final position X = 1.0m at t = 1050ms must MISS (distance to axis = 0.50m > 0.45m)
    let miss_new = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1050.0,
        1000.0,
        [1.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        !miss_new.hit,
        "Shot aimed at X=1.0m must MISS when target has interpolated to X=0.50m"
    );

    // 4. Quarter-way evaluation at t = 1025ms (target at X = 0.25m): shot at X = 0.25m must HIT
    let hit_quarter = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1025.0,
        1000.0,
        [0.25, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        hit_quarter.hit,
        "Shot aimed at X=0.25m must HIT at t=1025ms"
    );
}

/// Test 4: Headshot detection with temporal rewind
#[test]
fn test_m2_headshot_detection_with_temporal_rewind() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 7;

    // Target at (0, 0, 10) at t=1000ms, moves to (1, 0, 10) at t=1100ms
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 1.0, 0.0, 10.0, 0.45, 2.0);

    // 1. Headshot ray at rewound time t = 1000ms: Y = 1.75m (rel_y = 1.75m >= 1.55m)
    let head_rewind = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.75, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(head_rewind.hit, "Head-level ray must register HIT");
    assert!(head_rewind.is_headshot, "Ray at Y=1.75m must be classified as HEADSHOT");
    assert_eq!(
        head_rewind.damage, 27.0,
        "Assault rifle headshot damage must be 18.0 * 1.5 = 27.0"
    );

    // 2. Railphantom sniper headshot test: 70 * 2.0 = 140.0 damage
    let sniper_head = engine.validate_rewind_hitscan(
        WeaponType::Cecchino,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.75, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(sniper_head.hit);
    assert!(sniper_head.is_headshot);
    assert_eq!(sniper_head.damage, 140.0, "Sniper headshot must deal 140.0 damage");

    // 3. Body shot ray at rewound time: Y = 1.0m (rel_y = 1.0m < 1.55m)
    let body_rewind = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.00, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(body_rewind.hit);
    assert!(!body_rewind.is_headshot, "Ray at Y=1.00m must NOT be classified as headshot");
    assert_eq!(body_rewind.damage, 18.0);

    // 4. Over-head ray at Y = 2.05m must MISS
    let over_head = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 2.05, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!over_head.hit, "Ray above cylinder top (Y=2.05m) must MISS");

    // 5. Headshot ray at current time t = 1100ms (no rewind) must MISS because target moved
    let head_current = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1100.0,
        1000.0,
        [0.0, 1.75, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!head_current.hit, "Unrewound headshot must MISS target at X=1.0m");
}

/// Test 5: Clamped max unlag window test (preventing rewinding beyond limit)
#[test]
fn test_m2_clamped_max_unlag_window_prevents_backtracking() {
    let mut engine = LagCompensationEngine::new(1000.0); // 1000ms max unlag
    let victim_id: u32 = 99;

    // Target history:
    // t = 1000ms: at (0, 0, 10)
    // t = 1500ms: at (5, 0, 10)
    // t = 2500ms: at (15, 0, 10) (current host time)
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1500.0, 5.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 2500.0, 15.0, 0.0, 10.0, 0.45, 2.0);

    // Shooter attempts 1500ms rewind back to t=1000ms (aimed at X=0)
    // Max unlag is 1000ms -> clamped to t = 2500 - 1000 = 1500ms
    // At t=1500ms, target is at X=5.0m. Shot at X=0.0m must MISS!
    let exploit_shot = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0, // Claimed shot timestamp (1500ms in the past)
        1000.0, // Max unlag window
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );

    assert!(
        !exploit_shot.hit,
        "Backtracking exploit exceeding max_unlag_ms MUST be clamped and result in a MISS!"
    );

    // Valid rewind within 1000ms limit:
    // Shooter claims t = 1600ms (900ms ago <= 1000ms limit).
    // Interpolated target at t=1600ms: X = 5.0 + (100/1000)*(15.0 - 5.0) = 6.0m
    let legit_shot = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1600.0,
        1000.0,
        [6.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );

    assert!(
        legit_shot.hit,
        "Legitimate shot within max_unlag window aimed at interpolated position X=6.0m must HIT!"
    );
}

/// Test 6: Future timestamps (clock drift / negative ping) clamped to newest snapshot
#[test]
fn test_m2_future_timestamp_clamped_to_newest() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 12;

    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 1.0, 0.0, 10.0, 0.45, 2.0);

    // Client timestamp is in future: t = 1200ms (> newest 1100ms)
    // Must clamp to t = 1100ms (X = 1.0m) without extrapolating into thin air
    let future_miss = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1200.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!future_miss.hit, "Ray at X=0 must miss target clamped at X=1.0");

    let future_hit = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1200.0,
        1000.0,
        [1.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(future_hit.hit, "Ray at X=1.0 must hit target clamped at X=1.0");
}

/// Test 7: Ring buffer capacity wrap-around without panic or heap re-allocation
#[test]
fn test_m2_ring_buffer_capacity_saturation_and_wrap_around() {
    let mut buffer = SnapshotRingBuffer::new(128);

    // Push 200 snapshots with 10ms intervals (t = 0 to 1990ms)
    for i in 0..200 {
        let t = (i * 10) as f64;
        let x = (i as f64) * 0.1;
        buffer.push(PlayerSnapshot {
            timestamp_ms: t,
            x,
            y: 0.0,
            z: 10.0,
            radius: 0.45,
            height: 2.0,
        });
    }

    // Capacity must remain 128
    assert_eq!(buffer.len(), 128);

    // Oldest surviving snapshot is at index 200 - 128 = 72 -> t = 720.0ms, x = 7.2m
    let oldest = buffer.sample_at(500.0).expect("Should clamp to oldest available");
    assert!((oldest.timestamp_ms - 720.0).abs() < EPSILON);
    assert!((oldest.x - 7.2).abs() < EPSILON);

    // Midpoint sample inside valid window at t = 1505.0ms (between t=1500 and t=1510)
    let mid = buffer.sample_at(1505.0).expect("Should interpolate inside valid window");
    assert!((mid.timestamp_ms - 1505.0).abs() < EPSILON);
    assert!((mid.x - 15.05).abs() < EPSILON);
}

/// Test 8: Unknown or cleared player graceful failure
#[test]
fn test_m2_unknown_and_cleared_player_handling() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 88;

    // 1. Unknown victim query
    let res_unknown = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!res_unknown.hit);
    assert_eq!(res_unknown.damage, 0.0);

    // 2. Add player then clear
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.clear_player(victim_id);

    let res_cleared = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!res_cleared.hit, "Cleared player must safely return no hit");
}

/// Test 9: Single snapshot degenerate case (newly connected player)
#[test]
fn test_m2_single_snapshot_interpolation_safety() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 55;

    // Single snapshot
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    // Query before, at, and after the snapshot timestamp
    for t in [900.0, 1000.0, 1100.0] {
        let res = engine.validate_rewind_hitscan(
            WeaponType::Assalto,
            victim_id,
            t,
            1000.0,
            [0.0, 1.0, 0.0],
            [0.0, 0.0, 1.0],
        );
        assert!(res.hit, "Single snapshot must be returned safely at t={}", t);
        assert!((res.distance - 9.55).abs() < EPSILON);
    }
}

/// Test 10: Duplicate timestamp guard against division by zero
#[test]
fn test_m2_duplicate_timestamp_guard() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 33;

    // Two packets with identical timestamp
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    let res = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(res.hit);
    assert!(!res.distance.is_nan(), "Distance must not be NaN");
}

/// Test 11: Weapon range cutoff during rewind (Knife 2.5m hard limit)
#[test]
fn test_m2_melee_knife_range_cutoff_during_rewind() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 77;

    // Target at Z = 10.0m
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    // Knife fired from Z = 0.0m towards target at Z = 10.0m (distance = 9.55m > 2.5m)
    let knife_res = engine.validate_rewind_hitscan(
        WeaponType::Coltello,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        !knife_res.hit,
        "Knife has strict 2.5m effective range; shot at 9.55m must MISS"
    );
    assert_eq!(knife_res.damage, 0.0);
}

/// Test 12: WASM JSON binding protocol verification
#[test]
fn test_m2_wasm_lag_compensator_json_protocol() {
    let mut wasm_comp = WasmLagCompensator::new(1000.0);
    let victim_id: u32 = 1;

    wasm_comp.record_player_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    wasm_comp.record_player_position(victim_id, 1100.0, 1.0, 0.0, 10.0, 0.45, 2.0);

    // Call WASM binding function returning JSON string
    // shooter_id = 0, victim_id = 1, weapon_type = 0 (Assalto)
    let json_str = wasm_comp.validate_rewind_hitscan(
        0, // shooter_id
        victim_id,
        0, // WeaponType::Assalto
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0, // default range
    );

    let parsed: HitscanResult =
        serde_json::from_str(&json_str).expect("Must parse valid HitscanResult JSON");
    assert!(parsed.hit);
    assert!((parsed.distance - 9.50).abs() < EPSILON);
    assert_eq!(parsed.damage, 18.0);
    assert!(!parsed.is_headshot);

    // Test self-damage rejection through WASM binding
    let self_shot_str = wasm_comp.validate_rewind_hitscan(
        victim_id, // shooter == victim
        victim_id,
        0,
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    let self_parsed: HitscanResult =
        serde_json::from_str(&self_shot_str).expect("Must parse valid HitscanResult JSON");
    assert!(!self_parsed.hit, "Self-damage through WASM wrapper must be rejected");
    assert_eq!(self_parsed.damage, 0.0);
}

/// Test 13: Empty buffer and uninitialized player edge cases
#[test]
fn test_m2_empty_buffer_and_no_snapshots() {
    let buffer = SnapshotRingBuffer::new(128);
    assert!(buffer.is_empty());
    assert_eq!(buffer.len(), 0);
    assert_eq!(buffer.sample_at(1000.0), None);
    assert_eq!(buffer.sample_at_with_unlag(1000.0, 500.0), None);
    assert_eq!(buffer.oldest(), None);
    assert_eq!(buffer.newest(), None);
    assert_eq!(buffer.oldest_timestamp(), None);
    assert_eq!(buffer.newest_timestamp(), None);

    let engine = LagCompensationEngine::new(1000.0);
    assert_eq!(engine.player_count(), 0);

    let res = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        999, // Unregistered player
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!res.hit, "Empty engine shot must be a MISS");
    assert_eq!(res.damage, 0.0);
    assert_eq!(res.distance, 0.0);
    assert!(!res.is_headshot);

    let wasm_comp = WasmLagCompensator::new(1000.0);
    let json_str = wasm_comp.validate_rewind_hitscan(
        0, 1, 0, 1000.0, 1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        0.0,
    );
    let parsed: HitscanResult = serde_json::from_str(&json_str).expect("Valid JSON");
    assert!(!parsed.hit);
    assert_eq!(parsed.damage, 0.0);
}

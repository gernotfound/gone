//! Challenger 1 - Milestone 2 Empirical Adversarial Test Suite
//!
//! Rigorous, adversarial challenge of lag compensation:
//! 1. 100ms temporal rewind 2x2 matrix proof (shooter ping vs current time)
//! 2. 1,000 snapshot wrap-around saturation and index bijective mapping
//! 3. Rapid timestamp jumps, monotonicity rejections, and sub-microsecond dt guards
//! 4. 3D diagonal fractional LERP math and crouching height transitions
//! 5. Exact boundary clamping of max_unlag window and anti-backtracking
//! 6. Self-damage rejection through engine and WASM
//! 7. Weapon headshot and melee range cutoffs during rewind
//! 8. WASM JSON protocol and invalid weapon ID handling

use game_core::lag_compensation::{
    LagCompensationEngine, PlayerSnapshot, SnapshotRingBuffer, WasmLagCompensator,
    RING_BUFFER_CAPACITY,
};
use game_core::weapons::{HitscanResult, WeaponType};

const EPSILON: f64 = 1e-3;

/// 1. EMPIRICAL PROOF: 100ms temporal rewind 2x2 matrix
/// Verifies all 4 combinations:
/// - Firing at old position with rewind -> HIT
/// - Firing at current position with rewind -> MISS
/// - Firing at old position WITHOUT rewind (current time) -> MISS
/// - Firing at current position WITHOUT rewind (current time) -> HIT
#[test]
fn test_challenger_m2_complete_2x2_rewind_matrix() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 42;

    // Target starts at X=0.0 at t=1000ms, moves to X=2.0 at t=1100ms (100ms delta)
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1100.0, 2.0, 0.0, 10.0, 0.45, 2.0);

    let ray_at_old_pos = [0.0, 1.0, 0.0];
    let ray_at_curr_pos = [2.0, 1.0, 0.0];
    let dir_forward = [0.0, 0.0, 1.0];

    // Case 1: Rewind 100ms (shot_time = 1000ms), aimed at OLD position (X=0.0) -> MUST HIT
    let hit_rewound = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        ray_at_old_pos,
        dir_forward,
    );
    assert!(
        hit_rewound.hit,
        "Case 1 FAILED: Shot aimed at 100ms past position with 100ms rewind MUST HIT"
    );
    assert!((hit_rewound.distance - 9.55).abs() < EPSILON);
    assert_eq!(hit_rewound.damage, 18.0);

    // Case 2: Rewind 100ms (shot_time = 1000ms), aimed at CURRENT position (X=2.0) -> MUST MISS
    let miss_rewound = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        1000.0,
        ray_at_curr_pos,
        dir_forward,
    );
    assert!(
        !miss_rewound.hit,
        "Case 2 FAILED: Shot aimed at current position with 100ms rewind MUST MISS"
    );
    assert_eq!(miss_rewound.damage, 0.0);

    // Case 3: No rewind (shot_time = 1100ms), aimed at OLD position (X=0.0) -> MUST MISS
    let miss_current = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1100.0,
        1000.0,
        ray_at_old_pos,
        dir_forward,
    );
    assert!(
        !miss_current.hit,
        "Case 3 FAILED: Shot aimed at old position without rewind MUST MISS"
    );
    assert_eq!(miss_current.damage, 0.0);

    // Case 4: No rewind (shot_time = 1100ms), aimed at CURRENT position (X=2.0) -> MUST HIT
    let hit_current = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1100.0,
        1000.0,
        ray_at_curr_pos,
        dir_forward,
    );
    assert!(
        hit_current.hit,
        "Case 4 FAILED: Shot aimed at current position without rewind MUST HIT"
    );
    assert!((hit_current.distance - 9.55).abs() < EPSILON);
    assert_eq!(hit_current.damage, 18.0);
}

/// 2. STRESS TEST: 1,000 Snapshot Ring Buffer Wrap-around and Invariant Validation
#[test]
fn test_challenger_m2_ring_buffer_1000_wrap_around_stress() {
    let mut buffer = SnapshotRingBuffer::new(RING_BUFFER_CAPACITY);

    const TOTAL_SNAPSHOTS: usize = 1000;
    for i in 0..TOTAL_SNAPSHOTS {
        let t = i as f64 * 16.6666667; // ~60Hz ticks
        buffer.push(PlayerSnapshot {
            timestamp_ms: t,
            x: i as f64 * 0.05,
            y: (i as f64 * 0.1).sin() * 2.0,
            z: i as f64 * 0.2,
            radius: 0.45,
            height: 2.0,
        });
    }

    assert_eq!(buffer.len(), RING_BUFFER_CAPACITY);
    assert!(!buffer.is_empty());

    // The surviving snapshots are indices 1000 - 128 = 872 up to 999
    let expected_oldest_idx = TOTAL_SNAPSHOTS - RING_BUFFER_CAPACITY;
    let expected_newest_idx = TOTAL_SNAPSHOTS - 1;

    let oldest = buffer.oldest().unwrap();
    let newest = buffer.newest().unwrap();

    assert!(
        (oldest.timestamp_ms - (expected_oldest_idx as f64 * 16.6666667)).abs() < 1e-4,
        "Oldest snapshot mismatch: got {}, expected {}",
        oldest.timestamp_ms,
        expected_oldest_idx as f64 * 16.6666667
    );
    assert!((oldest.x - (expected_oldest_idx as f64 * 0.05)).abs() < 1e-4);

    assert!(
        (newest.timestamp_ms - (expected_newest_idx as f64 * 16.6666667)).abs() < 1e-4,
        "Newest snapshot mismatch: got {}, expected {}",
        newest.timestamp_ms,
        expected_newest_idx as f64 * 16.6666667
    );

    // Verify chronological order and index bijectivity across all 128 logical indices
    let mut prev_ts = -1.0;
    for k in 0..buffer.len() {
        let snap = buffer.get_logical(k);
        let original_i = expected_oldest_idx + k;
        assert!(
            snap.timestamp_ms > prev_ts,
            "Ring buffer logical index {} violated chronological ordering",
            k
        );
        assert!((snap.x - (original_i as f64 * 0.05)).abs() < 1e-4);
        prev_ts = snap.timestamp_ms;
    }

    // Binary search sample tests inside the 128 window
    let sample_idx = 920;
    let sample_t = sample_idx as f64 * 16.6666667;
    let sampled_exact = buffer.sample_at(sample_t).unwrap();
    assert!((sampled_exact.x - (sample_idx as f64 * 0.05)).abs() < 1e-4);

    // Midpoint interpolation between index 920 and 921
    let mid_t = (920.5) * 16.6666667;
    let sampled_mid = buffer.sample_at(mid_t).unwrap();
    let expected_mid_x = 920.5 * 0.05;
    assert!((sampled_mid.x - expected_mid_x).abs() < 1e-4);

    // Timestamp before oldest surviving snapshot must clamp to oldest
    let clamped_past = buffer.sample_at(0.0).unwrap();
    assert_eq!(clamped_past.timestamp_ms, oldest.timestamp_ms);
    assert_eq!(clamped_past.x, oldest.x);

    // Timestamp after newest snapshot must clamp to newest
    let clamped_future = buffer.sample_at(999999.0).unwrap();
    assert_eq!(clamped_future.timestamp_ms, newest.timestamp_ms);
    assert_eq!(clamped_future.x, newest.x);
}

/// 3. ADVERSARIAL TEST: Rapid Timestamp Jumps, Clock Resets, and Out-of-Order Packets
#[test]
fn test_challenger_m2_timestamp_jumps_and_monotonicity() {
    let mut buffer = SnapshotRingBuffer::new(RING_BUFFER_CAPACITY);

    buffer.push(PlayerSnapshot {
        timestamp_ms: 1000.0,
        x: 10.0,
        ..Default::default()
    });
    buffer.push(PlayerSnapshot {
        timestamp_ms: 2000.0,
        x: 20.0,
        ..Default::default()
    });

    // 1. Adversarial packet: timestamp goes backwards (out-of-order)
    buffer.push(PlayerSnapshot {
        timestamp_ms: 1500.0, // Backwards packet
        x: 999.0,
        ..Default::default()
    });
    buffer.push(PlayerSnapshot {
        timestamp_ms: 500.0, // Ancient packet
        x: -999.0,
        ..Default::default()
    });
    buffer.push(PlayerSnapshot {
        timestamp_ms: -100.0, // Negative timestamp packet
        x: -500.0,
        ..Default::default()
    });

    // None of the out-of-order packets should enter the buffer
    assert_eq!(buffer.len(), 2);
    assert_eq!(buffer.newest().unwrap().timestamp_ms, 2000.0);
    assert_eq!(buffer.newest().unwrap().x, 20.0);

    // 2. Rapid forward timestamp jump (e.g. 1 hour = 3,600,000ms jump)
    buffer.push(PlayerSnapshot {
        timestamp_ms: 3_602_000.0,
        x: 50.0,
        ..Default::default()
    });
    assert_eq!(buffer.len(), 3);
    assert_eq!(buffer.newest().unwrap().timestamp_ms, 3_602_000.0);

    // 3. Duplicate and sub-microsecond timestamps
    buffer.push(PlayerSnapshot {
        timestamp_ms: 3_602_000.0, // Exact duplicate
        x: 50.0,
        ..Default::default()
    });
    assert_eq!(buffer.len(), 4);

    // Sampling at duplicate timestamp must be completely safe from divide-by-zero
    let sample_dup = buffer.sample_at(3_602_000.0).unwrap();
    assert!(!sample_dup.x.is_nan());
    assert_eq!(sample_dup.x, 50.0);
}

/// 4. FRACTIONAL LERP MATH: 3D Diagonal Motion and Stance Crouching Height Transitions
#[test]
fn test_challenger_m2_fractional_lerp_3d_and_crouching() {
    let mut buffer = SnapshotRingBuffer::new(RING_BUFFER_CAPACITY);

    // Player transitions from standing to crouching while moving diagonally
    buffer.push(PlayerSnapshot {
        timestamp_ms: 1000.0,
        x: 0.0,
        y: 10.0,
        z: 0.0,
        radius: 0.45,
        height: 2.0, // Standing
    });
    buffer.push(PlayerSnapshot {
        timestamp_ms: 1100.0,
        x: 10.0,
        y: 20.0,
        z: -30.0,
        radius: 0.40,
        height: 1.2, // Crouched
    });

    // Test quarter-interpolations: alpha = 0.25, 0.50, 0.75
    let sample_25 = buffer.sample_at(1025.0).unwrap();
    assert!((sample_25.x - 2.5).abs() < 1e-6);
    assert!((sample_25.y - 12.5).abs() < 1e-6);
    assert!((sample_25.z - (-7.5)).abs() < 1e-6);
    assert!((sample_25.radius - 0.4375).abs() < 1e-6);
    assert!((sample_25.height - 1.8).abs() < 1e-6);

    let sample_50 = buffer.sample_at(1050.0).unwrap();
    assert!((sample_50.x - 5.0).abs() < 1e-6);
    assert!((sample_50.y - 15.0).abs() < 1e-6);
    assert!((sample_50.z - (-15.0)).abs() < 1e-6);
    assert!((sample_50.radius - 0.425).abs() < 1e-6);
    assert!((sample_50.height - 1.6).abs() < 1e-6);

    let sample_75 = buffer.sample_at(1075.0).unwrap();
    assert!((sample_75.x - 7.5).abs() < 1e-6);
    assert!((sample_75.y - 17.5).abs() < 1e-6);
    assert!((sample_75.z - (-22.5)).abs() < 1e-6);
    assert!((sample_75.radius - 0.4125).abs() < 1e-6);
    assert!((sample_75.height - 1.4).abs() < 1e-6);

    // Microscopic fractions: alpha = 0.001 and 0.999
    let sample_001 = buffer.sample_at(1000.1).unwrap();
    assert!((sample_001.x - 0.01).abs() < 1e-5);
    assert!((sample_001.height - 1.9992).abs() < 1e-5);

    let sample_999 = buffer.sample_at(1099.9).unwrap();
    assert!((sample_999.x - 9.99).abs() < 1e-5);
    assert!((sample_999.height - 1.2008).abs() < 1e-5);
}

/// 5. ADVERSARIAL TEST: Exact Boundary Clamping of max_unlag Window
#[test]
fn test_challenger_m2_max_unlag_window_boundaries() {
    let mut engine = LagCompensationEngine::new(500.0); // 500ms max history
    let victim_id: u32 = 9;

    // Target history:
    // t=1000: X=0.0
    // t=1500: X=10.0 (500ms ago)
    // t=2000: X=20.0 (current host time)
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 1500.0, 10.0, 0.0, 10.0, 0.45, 2.0);
    engine.record_position(victim_id, 2000.0, 20.0, 0.0, 10.0, 0.45, 2.0);

    // Attacker claims shot at t=1000ms (1000ms ago) with max_unlag=500ms.
    // Allowed window is [2000 - 500, 2000] = [1500, 2000].
    // Shot time must clamp to t=1500ms (where target is at X=10.0).
    // Firing at old position X=0.0 MUST MISS!
    let exploit = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        500.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        !exploit.hit,
        "Backtracking exploit past 500ms window MUST MISS"
    );

    // Firing at clamped position X=10.0 MUST HIT!
    let clamped_hit = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1000.0,
        500.0,
        [10.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(
        clamped_hit.hit,
        "Shot at clamped window boundary position X=10.0 MUST HIT"
    );

    // Boundary check: shot right at window edge t=1500.0ms
    let edge_hit = engine.validate_rewind_hitscan(
        WeaponType::Assalto,
        victim_id,
        1500.0,
        500.0,
        [10.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(edge_hit.hit, "Shot right at boundary t=1500ms must HIT");
}

/// 6. ADVERSARIAL TEST: Self-Damage Prevention in Engine and WASM
#[test]
fn test_challenger_m2_strict_self_damage_prevention() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let player_id: u32 = 77;

    engine.record_position(player_id, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);

    // Direct shot down the barrel into player's own cylinder
    let self_shot = engine.validate_rewind_hitscan_full(
        player_id, // shooter_id == victim_id
        player_id,
        0, // Assalto
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0,
    );
    assert!(!self_shot.hit, "Self-damage must be completely blocked");
    assert_eq!(self_shot.damage, 0.0);

    // Same test through WasmLagCompensator
    let mut wasm = WasmLagCompensator::new(1000.0);
    wasm.record_player_position(player_id, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);
    let wasm_json = wasm.validate_rewind_hitscan(
        player_id,
        player_id,
        0,
        1000.0,
        1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0,
    );
    let parsed: HitscanResult = serde_json::from_str(&wasm_json).unwrap();
    assert!(!parsed.hit);
    assert_eq!(parsed.damage, 0.0);
}

/// 7. ADVERSARIAL TEST: Weapon Damage Multipliers & Range Cutoffs during Rewind
#[test]
fn test_challenger_m2_weapons_damage_and_range_during_rewind() {
    let mut engine = LagCompensationEngine::new(1000.0);
    let victim_id: u32 = 123;

    // Target placed at Z=10.0m at t=1000ms
    engine.record_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    // 1. Sniper Rifle (Cecchino): Body shot = 70.0, Headshot = 140.0
    let sniper_body = engine.validate_rewind_hitscan(
        WeaponType::Cecchino,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(sniper_body.hit);
    assert!(!sniper_body.is_headshot);
    assert_eq!(sniper_body.damage, 70.0);

    let sniper_head = engine.validate_rewind_hitscan(
        WeaponType::Cecchino,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.8, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(sniper_head.hit);
    assert!(sniper_head.is_headshot);
    assert_eq!(sniper_head.damage, 140.0);

    // 2. Submachine Gun (Mitraglietta): Base 12.0, Headshot multiplier 1.5 => 18.0
    let smg_head = engine.validate_rewind_hitscan(
        WeaponType::Mitraglietta,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.8, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(smg_head.hit);
    assert!(smg_head.is_headshot);
    assert_eq!(smg_head.damage, 18.0);

    // 3. Shotgun (Pompa): Base 64.0, Headshot multiplier 1.5 => 96.0
    let shotgun_head = engine.validate_rewind_hitscan(
        WeaponType::Pompa,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.8, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(shotgun_head.hit);
    assert!(shotgun_head.is_headshot);
    assert_eq!(shotgun_head.damage, 96.0);

    // 4. Knife: strict 2.5m range cutoff
    // Target is at 9.55m distance -> knife MUST deal 0 damage and MISS
    let knife_far = engine.validate_rewind_hitscan(
        WeaponType::Coltello,
        victim_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(!knife_far.hit, "Knife cannot hit at 9.55m");
    assert_eq!(knife_far.damage, 0.0);

    // Move victim within 2.0m (Z=2.0, cylinder mantle at 2.0 - 0.45 = 1.55m)
    let victim_near_id: u32 = 124;
    engine.record_position(victim_near_id, 1000.0, 0.0, 0.0, 2.0, 0.45, 2.0);
    let knife_near = engine.validate_rewind_hitscan(
        WeaponType::Coltello,
        victim_near_id,
        1000.0,
        1000.0,
        [0.0, 1.0, 0.0],
        [0.0, 0.0, 1.0],
    );
    assert!(knife_near.hit, "Knife must hit target at 1.55m");
    assert_eq!(knife_near.damage, 50.0);
}

/// 8. WASM API: Invalid weapon types and unknown players
#[test]
fn test_challenger_m2_wasm_invalid_inputs_and_edge_cases() {
    let mut wasm = WasmLagCompensator::new(1000.0);
    let victim_id: u32 = 10;
    wasm.record_player_position(victim_id, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    // Invalid weapon type 999
    let json_bad_weapon = wasm.validate_rewind_hitscan(
        1, victim_id, 999, 1000.0, 1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0,
    );
    let parsed_bad_weapon: HitscanResult = serde_json::from_str(&json_bad_weapon).unwrap();
    assert!(!parsed_bad_weapon.hit);
    assert_eq!(parsed_bad_weapon.damage, 0.0);

    // Non-existent victim
    let json_no_victim = wasm.validate_rewind_hitscan(
        1, 9999, 0, 1000.0, 1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0,
    );
    let parsed_no_victim: HitscanResult = serde_json::from_str(&json_no_victim).unwrap();
    assert!(!parsed_no_victim.hit);

    // Clear player and ensure immediate MISS
    wasm.clear_player(victim_id);
    let json_cleared = wasm.validate_rewind_hitscan(
        1, victim_id, 0, 1000.0, 1000.0,
        0.0, 1.0, 0.0,
        0.0, 0.0, 1.0,
        100.0,
    );
    let parsed_cleared: HitscanResult = serde_json::from_str(&json_cleared).unwrap();
    assert!(!parsed_cleared.hit);
}

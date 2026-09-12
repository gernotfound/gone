use game_core::lag_compensation::LagCompensationEngine;

#[test]
fn rewound_robot_hitbox_matches_visible_browser_geometry() {
    let mut engine = LagCompensationEngine::new(500.0);
    engine.record_position(2, 1000.0, 0.0, 0.0, 10.0, 0.45, 2.0);

    let body = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 0.5, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(body.hit);
    assert!(!body.is_headshot);
    assert!((body.distance - 9.5).abs() < 1e-9);
    assert!((body.damage - 18.0).abs() < 1e-9);

    let head = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 1.2, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(head.hit);
    assert!(head.is_headshot);
    assert!((head.distance - 9.66).abs() < 1e-9);
    assert!((head.damage - 27.0).abs() < 1e-9);

    let old_cylinder_only_zone = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, 1.75, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(!old_cylinder_only_zone.hit);

    let lower_visible_body = engine.validate_rewind_robot_hitscan_full(
        1, 2, 0, 1000.0, 500.0,
        0.0, -0.3, 0.0,
        0.0, 0.0, 1.0,
        180.0,
    );
    assert!(lower_visible_body.hit);
    assert!(!lower_visible_body.is_headshot);
}

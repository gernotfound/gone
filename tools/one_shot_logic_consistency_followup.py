from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]

# Browser lifecycle fixture: authoritative shooter state must match the declared firing position.
path = ROOT / 'tests/tier1_features/test_combat_lifecycle.mjs'
text = path.read_text(encoding='utf-8')

old = """    // Victim is at central platform [0, 17.5, 0]. Host is at [0, 17.5, -10] aiming +Z\n    const now = performance.now();\n"""
new = """    // Victim is at central platform [0, 17.5, 0]. Move the authoritative host\n    // record to z=-10; supplied shot origins are no longer trusted for X/Z.\n    const shooter = host.playerRecords.get('host_01');\n    shooter.position = { x: 0, y: 17.5, z: -10 };\n    const now = performance.now();\n"""
if text.count(old) != 1:
    raise RuntimeError(f'shielded shooter fixture expected 1 match, got {text.count(old)}')
text = text.replace(old, new, 1)

old = """    const victim = host.playerRecords.get('victim_peer');\n    host.respawnPlayer('victim_peer');\n\n    // Fast-forward time past the 10.0s shield expiration\n"""
new = """    const victim = host.playerRecords.get('victim_peer');\n    host.respawnPlayer('victim_peer');\n    const shooter = host.playerRecords.get('host_01');\n    shooter.position = { x: 0, y: 17.5, z: -10 };\n\n    // Fast-forward time past the 10.0s shield expiration\n"""
if text.count(old) != 1:
    raise RuntimeError(f'expired-shield shooter fixture expected 1 match, got {text.count(old)}')
text = text.replace(old, new, 1)

count = text.count('[0, 17.0, -10]')
if count != 3:
    raise RuntimeError(f'expected 3 stale fallback-origin fixtures, got {count}')
text = text.replace('[0, 17.0, -10]', '[0, 17.3, -10]')
text = text.replace('origin 10m south at valid fallback-collider body height', 'camera/eye origin 10m south inside visible torso height')
text = text.replace('Hitscan must confirm ray-cylinder intersection with victim', 'Hitscan must confirm visible robot hitbox intersection with victim')
path.write_text(text, encoding='utf-8')

# WASM wrapper now intentionally uses the same visible robot AABB as the browser.
# At z=10 the front face is z=9.50 rather than the legacy cylinder mantle z=9.55.
path = ROOT / 'game-core/tests/lag_compensation_tests.rs'
text = path.read_text(encoding='utf-8')
old = """    assert!(parsed.hit);\n    assert!((parsed.distance - 9.55).abs() < EPSILON);\n    assert_eq!(parsed.damage, 18.0);\n"""
new = """    assert!(parsed.hit);\n    assert!((parsed.distance - 9.50).abs() < EPSILON);\n    assert_eq!(parsed.damage, 18.0);\n"""
if text.count(old) != 1:
    raise RuntimeError(f'WASM hitbox expectation expected 1 match, got {text.count(old)}')
text = text.replace(old, new, 1)
path.write_text(text, encoding='utf-8')

print('lifecycle and WASM fixtures aligned with authoritative visible hitboxes')

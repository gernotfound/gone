//! Lag compensation temporal rewind buffer and authoritative hit validation engine.
//!
//! Maintains a per-player circular ring buffer of spatial bounding cylinders
//! and rewinds targets to the exact client shot timestamp to eliminate latency dusting.

use std::collections::HashMap;
use serde::{Deserialize, Serialize};
use wasm_bindgen::prelude::*;

use crate::weapons::{
    calculate_damage, get_weapon_config, intersect_ray_cylinder, intersect_ray_robot_hitbox, HitscanResult, WeaponType,
};

/// Maximum capacity of the circular history buffer (power of two: 2^7 = 128).
pub const RING_BUFFER_CAPACITY: usize = 128;
/// Bitwise mask for circular index calculation (128 - 1 = 127).
pub const RING_BUFFER_MASK: usize = RING_BUFFER_CAPACITY - 1;
/// Default maximum lag compensation rewind limit in milliseconds (1.0 second).
pub const DEFAULT_MAX_HISTORY_MS: f64 = 1000.0;

/// Individual temporal snapshot representing a player's spatial bounding cylinder.
///
/// Memory footprint: 48 bytes (6 * f64), 8-byte aligned, zero padding holes.
#[repr(C)]
#[derive(Clone, Copy, Debug, PartialEq, Serialize, Deserialize)]
pub struct PlayerSnapshot {
    /// Monotonic timestamp in milliseconds
    pub timestamp_ms: f64,
    /// Feet center X coordinate
    pub x: f64,
    /// Feet center Y coordinate (ground level)
    pub y: f64,
    /// Feet center Z coordinate
    pub z: f64,
    /// Collision cylinder radius in meters (standard: 0.45m)
    pub radius: f64,
    /// Collision cylinder height in meters (standard: 2.0m standing)
    pub height: f64,
}

impl Default for PlayerSnapshot {
    fn default() -> Self {
        Self {
            timestamp_ms: 0.0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            radius: 0.45,
            height: 2.0,
        }
    }
}

/// Fixed-capacity circular ring buffer storing up to 128 snapshots with zero heap allocations in loop.
#[derive(Clone, Debug)]
pub struct SnapshotRingBuffer {
    buffer: [PlayerSnapshot; RING_BUFFER_CAPACITY],
    head: usize,
    count: usize,
}

impl SnapshotRingBuffer {
    /// Create a new empty ring buffer. Allocates 0 heap memory.
    pub fn new(_capacity: usize) -> Self {
        Self {
            buffer: [PlayerSnapshot::default(); RING_BUFFER_CAPACITY],
            head: 0,
            count: 0,
        }
    }

    /// Number of active snapshots in the buffer.
    #[inline]
    pub fn len(&self) -> usize {
        self.count
    }

    /// Whether the buffer contains no snapshots.
    #[inline]
    pub fn is_empty(&self) -> bool {
        self.count == 0
    }

    /// Clear all snapshots in O(1) time.
    #[inline]
    pub fn clear(&mut self) {
        self.head = 0;
        self.count = 0;
    }

    /// Push a new snapshot into the ring buffer in O(1) time.
    ///
    /// If the buffer is full, the oldest snapshot is overwritten.
    /// Non-monotonic snapshots (timestamp < latest) are ignored to preserve chronological order.
    pub fn push(&mut self, snapshot: PlayerSnapshot) {
        if self.count > 0 {
            let newest_idx = (self.head + RING_BUFFER_CAPACITY - 1) & RING_BUFFER_MASK;
            if snapshot.timestamp_ms < self.buffer[newest_idx].timestamp_ms {
                // Ignore out-of-order packet
                return;
            }
        }

        self.buffer[self.head] = snapshot;
        self.head = (self.head + 1) & RING_BUFFER_MASK;
        if self.count < RING_BUFFER_CAPACITY {
            self.count += 1;
        }
    }

    /// Get snapshot at logical index `k`, where `k=0` is oldest and `k=count-1` is newest.
    #[inline]
    pub fn get_logical(&self, k: usize) -> &PlayerSnapshot {
        debug_assert!(k < self.count, "Logical index out of bounds");
        let oldest_idx = (self.head + RING_BUFFER_CAPACITY - self.count) & RING_BUFFER_MASK;
        let physical_idx = (oldest_idx + k) & RING_BUFFER_MASK;
        &self.buffer[physical_idx]
    }

    /// Retrieve the oldest snapshot in the buffer, if any.
    #[inline]
    pub fn oldest(&self) -> Option<&PlayerSnapshot> {
        if self.count == 0 {
            None
        } else {
            Some(self.get_logical(0))
        }
    }

    /// Retrieve the newest snapshot in the buffer, if any.
    #[inline]
    pub fn newest(&self) -> Option<&PlayerSnapshot> {
        if self.count == 0 {
            None
        } else {
            Some(self.get_logical(self.count - 1))
        }
    }

    /// Returns the timestamp of the oldest snapshot in the buffer.
    #[inline]
    pub fn oldest_timestamp(&self) -> Option<f64> {
        self.oldest().map(|s| s.timestamp_ms)
    }

    /// Returns the timestamp of the newest recorded snapshot.
    #[inline]
    pub fn newest_timestamp(&self) -> Option<f64> {
        self.newest().map(|s| s.timestamp_ms)
    }

    /// Sample an interpolated snapshot at `target_time_ms` in O(log N) time with zero heap allocation.
    ///
    /// Edge Case Handling:
    /// - If buffer is empty: returns None.
    /// - If buffer has 1 snapshot: returns that snapshot.
    /// - If target_time_ms <= oldest.timestamp_ms: returns oldest snapshot.
    /// - If target_time_ms >= newest.timestamp_ms: returns newest snapshot.
    /// - If target_time_ms is between two snapshots: linearly interpolates position, radius, and height.
    /// - If delta_t < 1e-6: returns the bounding snapshot directly to prevent NaN / division by zero.
    pub fn sample_at(&self, target_time_ms: f64) -> Option<PlayerSnapshot> {
        if self.count == 0 {
            return None;
        }
        if self.count == 1 {
            return Some(*self.get_logical(0));
        }

        let oldest = self.get_logical(0);
        let newest = self.get_logical(self.count - 1);

        if target_time_ms <= oldest.timestamp_ms {
            return Some(*oldest);
        }
        if target_time_ms >= newest.timestamp_ms {
            return Some(*newest);
        }

        // In-place binary search on logical indices [0..count-1]
        let mut low = 0;
        let mut high = self.count - 1;

        while low + 1 < high {
            let mid = low + ((high - low) >> 1);
            let mid_ts = self.get_logical(mid).timestamp_ms;
            if mid_ts <= target_time_ms {
                low = mid;
            } else {
                high = mid;
            }
        }

        let snap_a = self.get_logical(low);
        let snap_b = self.get_logical(high);

        let dt = snap_b.timestamp_ms - snap_a.timestamp_ms;
        if dt < 1e-6 {
            return Some(*snap_b);
        }

        let alpha = ((target_time_ms - snap_a.timestamp_ms) / dt).clamp(0.0, 1.0);

        Some(PlayerSnapshot {
            timestamp_ms: target_time_ms,
            x: snap_a.x + alpha * (snap_b.x - snap_a.x),
            y: snap_a.y + alpha * (snap_b.y - snap_a.y),
            z: snap_a.z + alpha * (snap_b.z - snap_a.z),
            radius: snap_a.radius + alpha * (snap_b.radius - snap_a.radius),
            height: snap_a.height + alpha * (snap_b.height - snap_a.height),
        })
    }

    /// Sample an interpolated snapshot with an explicit max unlag clamp window.
    pub fn sample_at_with_unlag(
        &self,
        target_time_ms: f64,
        max_unlag_ms: f64,
    ) -> Option<PlayerSnapshot> {
        if self.count == 0 {
            return None;
        }
        let newest = self.get_logical(self.count - 1);
        let effective_max_unlag = if max_unlag_ms > 0.0 {
            max_unlag_ms
        } else {
            DEFAULT_MAX_HISTORY_MS
        };
        let min_allowed_time = newest.timestamp_ms - effective_max_unlag;
        let clamped_target = target_time_ms.max(min_allowed_time);
        self.sample_at(clamped_target)
    }
}

impl Default for SnapshotRingBuffer {
    fn default() -> Self {
        Self::new(RING_BUFFER_CAPACITY)
    }
}

/// Core authoritative lag compensation coordinator.
#[derive(Clone, Debug)]
pub struct LagCompensationEngine {
    players: HashMap<u32, SnapshotRingBuffer>,
    max_history_ms: f64,
}

impl LagCompensationEngine {
    /// Create a new engine with specified max history limit in milliseconds.
    pub fn new(max_history_ms: f64) -> Self {
        Self {
            players: HashMap::new(),
            max_history_ms: if max_history_ms > 0.0 {
                max_history_ms
            } else {
                DEFAULT_MAX_HISTORY_MS
            },
        }
    }

    /// Record a player position snapshot into their ring buffer.
    #[allow(clippy::too_many_arguments)]
    pub fn record_player_position(
        &mut self,
        player_id: u32,
        timestamp_ms: f64,
        x: f64,
        y: f64,
        z: f64,
        radius: f64,
        height: f64,
    ) {
        let buffer = self
            .players
            .entry(player_id)
            .or_insert_with(|| SnapshotRingBuffer::new(RING_BUFFER_CAPACITY));

        buffer.push(PlayerSnapshot {
            timestamp_ms,
            x,
            y,
            z,
            radius: if radius > 0.0 { radius } else { 0.45 },
            height: if height > 0.0 { height } else { 2.0 },
        });
    }

    /// Alias for `record_player_position` for ergonomic test and script usage.
    #[inline]
    #[allow(clippy::too_many_arguments)]
    pub fn record_position(
        &mut self,
        player_id: u32,
        timestamp_ms: f64,
        x: f64,
        y: f64,
        z: f64,
        radius: f64,
        height: f64,
    ) {
        self.record_player_position(player_id, timestamp_ms, x, y, z, radius, height);
    }

    /// Clear all history for a specific player (e.g. on disconnect or respawn).
    pub fn clear_player(&mut self, player_id: u32) {
        self.players.remove(&player_id);
    }

    /// Clear all player history buffers (e.g. on match reset).
    pub fn clear_all(&mut self) {
        self.players.clear();
    }

    /// Return the number of currently tracked players.
    pub fn player_count(&self) -> usize {
        self.players.len()
    }

    /// Sample interpolated snapshot for a player at a target time.
    pub fn sample_player_at(&self, player_id: u32, timestamp_ms: f64) -> Option<PlayerSnapshot> {
        self.players.get(&player_id).and_then(|b| b.sample_at(timestamp_ms))
    }

    /// Convenient validation method accepting `WeaponType`, vector arrays, and victim ID.
    pub fn validate_rewind_hitscan(
        &self,
        weapon_type: WeaponType,
        victim_id: u32,
        shot_time_ms: f64,
        max_unlag_ms: f64,
        origin: [f64; 3],
        direction: [f64; 3],
    ) -> HitscanResult {
        self.validate_rewind_hitscan_full(
            u32::MAX, // Distinct dummy shooter ID so self-hit check passes
            victim_id,
            weapon_type.as_u32(),
            shot_time_ms,
            max_unlag_ms,
            origin[0],
            origin[1],
            origin[2],
            direction[0],
            direction[1],
            direction[2],
            0.0, // Default to weapon effective range
        )
    }

    /// Authoritatively validate a rewound hitscan ray against a victim's historical bounding cylinder.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_rewind_hitscan_full(
        &self,
        shooter_id: u32,
        victim_id: u32,
        weapon_type: u32,
        shot_time_ms: f64,
        max_unlag_ms: f64,
        origin_x: f64,
        origin_y: f64,
        origin_z: f64,
        dir_x: f64,
        dir_y: f64,
        dir_z: f64,
        max_range: f64,
    ) -> HitscanResult {
        // Disallow self-damage
        if shooter_id == victim_id {
            return HitscanResult {
                hit: false,
                damage: 0.0,
                is_headshot: false,
                distance: 0.0,
            };
        }

        let wt = match WeaponType::from_u32(weapon_type) {
            Some(wt) => wt,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let buffer = match self.players.get(&victim_id) {
            Some(b) => b,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let newest_ts = match buffer.newest_timestamp() {
            Some(ts) => ts,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        // Enforce maximum unlag window
        let unlag_window = if max_unlag_ms > 0.0 {
            max_unlag_ms.min(self.max_history_ms)
        } else {
            self.max_history_ms
        };

        let min_allowed_ts = newest_ts - unlag_window;
        let clamped_ts = shot_time_ms.max(min_allowed_ts).min(newest_ts);

        let snapshot = match buffer.sample_at(clamped_ts) {
            Some(s) => s,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let cfg = get_weapon_config(wt);
        let effective_range = if max_range > 0.0 {
            max_range.min(cfg.effective_range_m)
        } else {
            cfg.effective_range_m
        };

        let origin = [origin_x, origin_y, origin_z];
        let direction = [dir_x, dir_y, dir_z];
        let target_base = [snapshot.x, snapshot.y, snapshot.z];

        if let Some((distance, is_headshot)) = intersect_ray_cylinder(
            origin,
            direction,
            target_base,
            snapshot.radius,
            snapshot.height,
            effective_range,
        ) {
            let damage = calculate_damage(wt, distance, is_headshot);
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

    /// Validate rewind against the visible floating-robot torso/head hitboxes.
    #[allow(clippy::too_many_arguments)]
    pub fn validate_rewind_robot_hitscan_full(
        &self,
        shooter_id: u32,
        victim_id: u32,
        weapon_type: u32,
        shot_time_ms: f64,
        max_unlag_ms: f64,
        origin_x: f64,
        origin_y: f64,
        origin_z: f64,
        dir_x: f64,
        dir_y: f64,
        dir_z: f64,
        max_range: f64,
    ) -> HitscanResult {
        // Disallow self-damage
        if shooter_id == victim_id {
            return HitscanResult {
                hit: false,
                damage: 0.0,
                is_headshot: false,
                distance: 0.0,
            };
        }

        let wt = match WeaponType::from_u32(weapon_type) {
            Some(wt) => wt,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let buffer = match self.players.get(&victim_id) {
            Some(b) => b,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let newest_ts = match buffer.newest_timestamp() {
            Some(ts) => ts,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        // Enforce maximum unlag window
        let unlag_window = if max_unlag_ms > 0.0 {
            max_unlag_ms.min(self.max_history_ms)
        } else {
            self.max_history_ms
        };

        let min_allowed_ts = newest_ts - unlag_window;
        let clamped_ts = shot_time_ms.max(min_allowed_ts).min(newest_ts);

        let snapshot = match buffer.sample_at(clamped_ts) {
            Some(s) => s,
            None => {
                return HitscanResult {
                    hit: false,
                    damage: 0.0,
                    is_headshot: false,
                    distance: 0.0,
                };
            }
        };

        let cfg = get_weapon_config(wt);
        let effective_range = if max_range > 0.0 {
            max_range.min(cfg.effective_range_m)
        } else {
            cfg.effective_range_m
        };

        let origin = [origin_x, origin_y, origin_z];
        let direction = [dir_x, dir_y, dir_z];
        let target_base = [snapshot.x, snapshot.y, snapshot.z];

        if let Some((distance, is_headshot)) = intersect_ray_robot_hitbox(
            origin,
            direction,
            target_base,
            effective_range,
        ) {
            let damage = calculate_damage(wt, distance, is_headshot);
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
}

impl Default for LagCompensationEngine {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_HISTORY_MS)
    }
}

/// WebAssembly exported lag compensation engine.
#[wasm_bindgen]
pub struct WasmLagCompensator {
    engine: LagCompensationEngine,
}

#[wasm_bindgen]
impl WasmLagCompensator {
    #[wasm_bindgen(constructor)]
    pub fn new(max_history_ms: f64) -> Self {
        Self {
            engine: LagCompensationEngine::new(max_history_ms),
        }
    }

    /// Record a player position snapshot into their ring buffer.
    #[allow(clippy::too_many_arguments)]
    pub fn record_player_position(
        &mut self,
        player_id: u32,
        timestamp_ms: f64,
        x: f64,
        y: f64,
        z: f64,
        radius: f64,
        height: f64,
    ) {
        self.engine
            .record_player_position(player_id, timestamp_ms, x, y, z, radius, height);
    }

    /// Authoritatively validate a rewound hitscan shot against victim historical visible robot hitboxes.
    /// Returns a JSON string of HitscanResult: { hit, damage, is_headshot, distance }
    #[allow(clippy::too_many_arguments)]
    pub fn validate_rewind_hitscan(
        &self,
        shooter_id: u32,
        victim_id: u32,
        weapon_type: u32,
        shot_time_ms: f64,
        max_unlag_ms: f64,
        origin_x: f64,
        origin_y: f64,
        origin_z: f64,
        dir_x: f64,
        dir_y: f64,
        dir_z: f64,
        max_range: f64,
    ) -> String {
        let result = self.engine.validate_rewind_robot_hitscan_full(
            shooter_id,
            victim_id,
            weapon_type,
            shot_time_ms,
            max_unlag_ms,
            origin_x,
            origin_y,
            origin_z,
            dir_x,
            dir_y,
            dir_z,
            max_range,
        );

        serde_json::to_string(&result)
            .unwrap_or_else(|_| "{\"hit\":false,\"damage\":0.0,\"is_headshot\":false,\"distance\":0.0}".to_string())
    }

    /// Clear all history for a specific player.
    pub fn clear_player(&mut self, player_id: u32) {
        self.engine.clear_player(player_id);
    }
}

impl Default for WasmLagCompensator {
    fn default() -> Self {
        Self::new(DEFAULT_MAX_HISTORY_MS)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_ring_buffer_empty_and_single() {
        let buffer = SnapshotRingBuffer::new(128);
        assert!(buffer.is_empty());
        assert_eq!(buffer.len(), 0);
        assert_eq!(buffer.sample_at(1000.0), None);

        let mut buffer = SnapshotRingBuffer::new(128);
        let s1 = PlayerSnapshot {
            timestamp_ms: 1000.0,
            x: 10.0,
            y: 0.0,
            z: 5.0,
            radius: 0.45,
            height: 2.0,
        };
        buffer.push(s1);

        assert_eq!(buffer.len(), 1);
        assert!(!buffer.is_empty());
        assert_eq!(buffer.sample_at(500.0), Some(s1));
        assert_eq!(buffer.sample_at(1000.0), Some(s1));
        assert_eq!(buffer.sample_at(1500.0), Some(s1));
    }

    #[test]
    fn test_ring_buffer_wraparound_over_128() {
        let mut buffer = SnapshotRingBuffer::new(128);

        for i in 0..200 {
            buffer.push(PlayerSnapshot {
                timestamp_ms: i as f64 * 30.0,
                x: i as f64,
                y: 0.0,
                z: 0.0,
                radius: 0.45,
                height: 2.0,
            });
        }

        assert_eq!(buffer.len(), RING_BUFFER_CAPACITY);

        let oldest = buffer.oldest().unwrap();
        assert_eq!(oldest.timestamp_ms, 72.0 * 30.0);
        assert_eq!(oldest.x, 72.0);

        let newest = buffer.newest().unwrap();
        assert_eq!(newest.timestamp_ms, 199.0 * 30.0);
        assert_eq!(newest.x, 199.0);

        for k in 0..buffer.len() {
            let item = buffer.get_logical(k);
            let expected_idx = 72 + k;
            assert_eq!(item.timestamp_ms, expected_idx as f64 * 30.0);
            assert_eq!(item.x, expected_idx as f64);
        }
    }

    #[test]
    fn test_exact_midpoint_lerp() {
        let mut buffer = SnapshotRingBuffer::new(128);
        buffer.push(PlayerSnapshot {
            timestamp_ms: 1000.0,
            x: 0.0,
            y: 0.0,
            z: 0.0,
            radius: 0.45,
            height: 2.0,
        });
        buffer.push(PlayerSnapshot {
            timestamp_ms: 1100.0,
            x: 10.0,
            y: 2.0,
            z: -4.0,
            radius: 0.45,
            height: 1.0,
        });

        let sampled = buffer.sample_at(1050.0).unwrap();
        assert_eq!(sampled.timestamp_ms, 1050.0);
        assert!((sampled.x - 5.0).abs() < 1e-6);
        assert!((sampled.y - 1.0).abs() < 1e-6);
        assert!((sampled.z - (-2.0)).abs() < 1e-6);
        assert!((sampled.height - 1.5).abs() < 1e-6);
    }

    #[test]
    fn test_monotonicity_enforcement() {
        let mut buffer = SnapshotRingBuffer::new(128);
        buffer.push(PlayerSnapshot {
            timestamp_ms: 100.0,
            x: 1.0,
            ..Default::default()
        });
        buffer.push(PlayerSnapshot {
            timestamp_ms: 200.0,
            x: 2.0,
            ..Default::default()
        });

        // Out-of-order snapshot ignored
        buffer.push(PlayerSnapshot {
            timestamp_ms: 150.0,
            x: 99.0,
            ..Default::default()
        });

        assert_eq!(buffer.len(), 2);
        assert_eq!(buffer.newest().unwrap().timestamp_ms, 200.0);
        assert_eq!(buffer.newest().unwrap().x, 2.0);
    }

    #[test]
    fn test_self_hit_prevention() {
        let mut engine = LagCompensationEngine::new(1000.0);
        engine.record_player_position(1, 1000.0, 0.0, 0.0, 5.0, 0.45, 2.0);

        let res = engine.validate_rewind_hitscan_full(
            1, 1, 0, 1000.0, 1000.0,
            0.0, 1.0, 0.0,
            0.0, 0.0, 1.0,
            0.0,
        );
        assert!(!res.hit, "Self-damage must be prevented");
    }

    #[test]
    fn test_ring_buffer_sample_at_with_unlag() {
        let mut buffer = SnapshotRingBuffer::new(128);
        buffer.push(PlayerSnapshot {
            timestamp_ms: 1000.0,
            x: 0.0,
            ..Default::default()
        });
        buffer.push(PlayerSnapshot {
            timestamp_ms: 2000.0,
            x: 10.0,
            ..Default::default()
        });

        // Query 500ms with max_unlag 600ms -> clamped to 2000 - 600 = 1400ms
        let sampled = buffer.sample_at_with_unlag(500.0, 600.0).unwrap();
        assert_eq!(sampled.timestamp_ms, 1400.0);
        assert!((sampled.x - 4.0).abs() < 1e-6);
    }
}

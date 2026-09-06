export default async function init() {}
export function generate_chunk() {
  return {
    get_heights: () => new Float32Array(),
    get_colors: () => new Float32Array(),
    get_rocks: () => new Float32Array(),
  };
}
export function get_height_at() {
  return 0;
}

export class WasmLagCompensator {
  constructor(max_history_ms) {}
  free() {}
  record_player_position(player_id, timestamp_ms, x, y, z, radius, height) {}
  validate_rewind_hitscan(
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
    max_range
  ) {
    return JSON.stringify({ hit: false, damage: 0.0, is_headshot: false, distance: 0.0 });
  }
  clear_player(player_id) {}
}

export class PhysicsInput {
  constructor(x, y, z, vel_y, is_grounded, forward, backward, left, right, yaw, jump, sprint, crouch, delta) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vel_y = vel_y;
    this.is_grounded = is_grounded;
  }
  free() {}
}

export function step_physics(input) {
  return {
    x: input.x,
    y: input.y,
    z: input.z,
    vel_y: input.vel_y,
    is_grounded: input.is_grounded,
    free: () => {}
  };
}

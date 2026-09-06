/* tslint:disable */
/* eslint-disable */
export default function init(): Promise<any>;
export function generate_chunk(
  cx: number,
  cz: number,
  offsetX: number,
  offsetZ: number,
  size: number,
  resolution: number
): {
  free(): void;
  get_heights(): Float32Array;
  get_colors(): Float32Array;
  get_rocks(): Float32Array;
};
export function get_height_at(x: number, z: number): number;

export class WasmLagCompensator {
  free(): void;
  constructor(max_history_ms: number);
  record_player_position(
    player_id: number,
    timestamp_ms: number,
    x: number,
    y: number,
    z: number,
    radius: number,
    height: number
  ): void;
  validate_rewind_hitscan(
    shooter_id: number,
    victim_id: number,
    weapon_type: number,
    shot_time_ms: number,
    max_unlag_ms: number,
    origin_x: number,
    origin_y: number,
    origin_z: number,
    dir_x: number,
    dir_y: number,
    dir_z: number,
    max_range: number
  ): string;
  clear_player(player_id: number): void;
}

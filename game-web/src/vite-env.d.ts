/// <reference types="vite/client" />

declare module '../pkg/game_core.js' {
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
}

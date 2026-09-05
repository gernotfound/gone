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

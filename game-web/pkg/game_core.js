// Functional JavaScript fallback for deployments where wasm-pack is not executed.
// build.sh can overwrite this file with the real wasm-bindgen output.
// The fallback intentionally mirrors the public API used by the web client.

export default async function init() {
  return true;
}

const TAU = Math.PI * 2;

function fract(v) {
  return v - Math.floor(v);
}

function hash(x, y) {
  return fract(Math.sin(x * 12.9898 + y * 78.233) * 43758.5453123);
}

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function noise2d(x, z) {
  const ix = Math.floor(x);
  const iz = Math.floor(z);
  const fx = x - ix;
  const fz = z - iz;
  const u = fade(fx);
  const v = fade(fz);
  const a = hash(ix, iz);
  const b = hash(ix + 1, iz);
  const c = hash(ix, iz + 1);
  const d = hash(ix + 1, iz + 1);
  return (lerp(lerp(a, b, u), lerp(c, d, u), v) * 2) - 1;
}

function fbm(x, z, octaves = 3, scale = 0.002, persistence = 0.5, lacunarity = 2) {
  let total = 0;
  let amplitude = 1;
  let frequency = scale;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    total += noise2d(x * frequency, z * frequency) * amplitude;
    norm += amplitude;
    amplitude *= persistence;
    frequency *= lacunarity;
  }
  return norm > 0 ? total / norm : 0;
}

function ridged(x, z, octaves = 3, scale = 0.003) {
  let total = 0;
  let amplitude = 1;
  let frequency = scale;
  let norm = 0;
  for (let i = 0; i < octaves; i += 1) {
    const n = 1 - Math.abs(noise2d(x * frequency, z * frequency));
    total += n * n * amplitude;
    norm += amplitude;
    amplitude *= 0.5;
    frequency *= 2;
  }
  return norm > 0 ? total / norm : 0;
}

function smoothstep01(t) {
  const c = Math.max(0, Math.min(1, t));
  return c * c * (3 - 2 * c);
}

function craterContribution(x, z) {
  const grid = 210;
  const cellX = Math.floor(x / grid);
  const cellZ = Math.floor(z / grid);
  let h = 0;

  for (let gx = -1; gx <= 1; gx += 1) {
    for (let gz = -1; gz <= 1; gz += 1) {
      const cx = cellX + gx;
      const cz = cellZ + gz;
      const rx = cx * grid + hash(cx, cz) * grid;
      const rz = cz * grid + hash(cx * 1.17, cz * 1.31) * grid;
      const dx = x - rx;
      const dz = z - rz;
      const dist = Math.hypot(dx, dz);
      const radius = 22 + hash(cx * 1.73, cz * 0.91) * 28;
      const t = dist / radius;
      if (t < 1) {
        h += (t * t - 1) * radius * 0.28;
      } else if (t < 1.35) {
        h += Math.sin(((t - 1) / 0.35) * Math.PI) * radius * 0.08;
      }
    }
  }
  return h;
}

export function get_height_at(x, z) {
  const distCenter = Math.hypot(x, z);

  // Broad rolling landscape.
  const warpX = fbm(x + 431, z - 117, 2, 0.0012) * 85;
  const warpZ = fbm(x - 263, z + 719, 2, 0.0012) * 85;
  const wx = x + warpX;
  const wz = z + warpZ;

  let h = fbm(wx, wz, 4, 0.0021, 0.52, 2.05) * 28;
  h += ridged(wx + 900, wz - 500, 4, 0.0031) * Math.max(0, fbm(x + 1400, z - 800, 2, 0.0011) * 1.7) * 72;
  h += craterContribution(x, z);

  // Large south-east landmark crater.
  const giantDist = Math.hypot(x - 1200, z - 1200);
  const giantRadius = 250;
  const gt = giantDist / giantRadius;
  if (gt < 1) {
    h += (gt * gt - 1) * giantRadius * 0.42;
  } else if (gt < 1.45) {
    h += Math.sin(((gt - 1) / 0.45) * Math.PI) * giantRadius * 0.14;
  }

  // Small deterministic surface detail.
  h += fbm(x, z, 2, 0.075, 0.5, 2) * 0.35;

  // Guaranteed flat and safe spawn platform, blended into the terrain.
  if (distCenter < 48) {
    const spawnHeight = 15;
    if (distCenter <= 22) {
      h = spawnHeight;
    } else {
      const t = smoothstep01((distCenter - 22) / 26);
      h = lerp(spawnHeight, h, t);
    }
  }

  return Number.isFinite(h) ? h : 15;
}

class ChunkData {
  constructor(heights, normals, colors, rocks) {
    this.heights = heights;
    this.normals = normals;
    this.colors = colors;
    this.rocks = rocks;
  }
  get_heights() { return this.heights; }
  get_normals() { return this.normals; }
  get_colors() { return this.colors; }
  get_rocks() { return this.rocks; }
  free() {}
}

export function generate_chunk(cx, cz, offsetX, offsetZ, size, resolution) {
  const res = Math.max(2, Math.floor(resolution));
  const verts = res + 1;
  const count = verts * verts;
  const heights = new Float32Array(count);
  const normals = new Float32Array(count * 3);
  const colors = new Uint8Array(count * 3);
  const half = size / 2;

  // Height pass: one expensive height lookup per vertex.
  for (let row = 0; row < verts; row += 1) {
    for (let col = 0; col < verts; col += 1) {
      const i = row * verts + col;
      const x = offsetX + (col / res) * size - half;
      const z = offsetZ + (row / res) * size - half;
      heights[i] = get_height_at(x, z);
    }
  }

  // Color pass derives slope from neighboring cached vertices instead of
  // recomputing terrain multiple times.
  const dark = [2 / 255, 6 / 255, 15 / 255];
  const light = [30 / 255, 41 / 255, 59 / 255];
  const cell = size / res;
  for (let row = 0; row < verts; row += 1) {
    for (let col = 0; col < verts; col += 1) {
      const i = row * verts + col;
      const left = heights[row * verts + Math.max(0, col - 1)];
      const right = heights[row * verts + Math.min(res, col + 1)];
      const down = heights[Math.max(0, row - 1) * verts + col];
      const up = heights[Math.min(res, row + 1) * verts + col];
      const dxSpan = Math.max((Math.min(res, col + 1) - Math.max(0, col - 1)) * cell, 0.001);
      const dzSpan = Math.max((Math.min(res, row + 1) - Math.max(0, row - 1)) * cell, 0.001);
      const sx = (right - left) / dxSpan;
      const sz = (up - down) / dzSpan;
      const invLen = 1 / Math.sqrt(sx * sx + 1 + sz * sz);
      normals[i * 3] = -sx * invLen;
      normals[i * 3 + 1] = invLen;
      normals[i * 3 + 2] = -sz * invLen;
      const t = Math.max(0, Math.min(1, (invLen - 0.5) * 2.5));
      colors[i * 3] = Math.round(2 + (30 - 2) * t);
      colors[i * 3 + 1] = Math.round(6 + (41 - 6) * t);
      colors[i * 3 + 2] = Math.round(15 + (59 - 15) * t);
    }
  }

  // Lightweight deterministic rock placement. Keep density bounded to avoid
  // stalling the main thread during initial chunk generation.
  const rockValues = [];
  const clusterCount = 3 + Math.floor(hash(cx * 3.7, cz * 5.1) * 5);
  for (let i = 0; i < clusterCount; i += 1) {
    const localX = (hash(cx + i * 11.3, cz + 3.1) - 0.5) * size;
    const localZ = (hash(cx + 7.7, cz + i * 13.1) - 0.5) * size;
    const worldX = offsetX + localX;
    const worldZ = offsetZ + localZ;
    if (Math.hypot(worldX, worldZ) < 55) continue;
    const y = get_height_at(worldX, worldZ);
    const sx = 0.7 + hash(worldX, worldZ) * 2.6;
    const sy = 0.45 + hash(worldX + 8, worldZ - 2) * 1.9;
    const sz = 0.7 + hash(worldX - 4, worldZ + 5) * 2.6;
    rockValues.push(
      localX, y, localZ,
      sx, sy, sz,
      hash(worldX + 1, worldZ) * TAU,
      hash(worldX, worldZ + 1) * TAU,
      hash(worldX + 2, worldZ + 2) * TAU,
    );
  }

  return new ChunkData(heights, normals, colors, new Float32Array(rockValues));
}

export class PhysicsInput {
  constructor(
    x, y, z, vel_y, is_grounded,
    forward, backward, left, right, yaw,
    jump, sprint, crouch, movement_scale, delta,
  ) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vel_y = vel_y;
    this.is_grounded = is_grounded;
    this.forward = !!forward;
    this.backward = !!backward;
    this.left = !!left;
    this.right = !!right;
    this.yaw = Number.isFinite(yaw) ? yaw : 0;
    this.jump = !!jump;
    this.sprint = !!sprint;
    this.crouch = !!crouch;
    this.movement_scale = Number.isFinite(movement_scale) ? Math.max(0.25, Math.min(1.25, movement_scale)) : 1;
    this.delta = Math.max(0, Math.min(0.1, Number.isFinite(delta) ? delta : 0));
  }
  free() {}
}

export class PhysicsState {
  constructor(x, y, z, vel_y, is_grounded) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.vel_y = vel_y;
    this.is_grounded = is_grounded;
  }
  free() {}
}

export function step_physics(input) {
  let x = input.x;
  let y = input.y;
  let z = input.z;
  let velY = input.vel_y;
  let grounded = !!input.is_grounded;
  const dt = input.delta;

  let dx = 0;
  let dz = 0;
  if (input.forward) dz -= 1;
  if (input.backward) dz += 1;
  if (input.left) dx -= 1;
  if (input.right) dx += 1;

  const len = Math.hypot(dx, dz);
  if (len > 0) {
    dx /= len;
    dz /= len;
    const c = Math.cos(input.yaw);
    const s = Math.sin(input.yaw);
    const worldX = dx * c + dz * s;
    const worldZ = -dx * s + dz * c;
    dx = worldX;
    dz = worldZ;
  }

  let speed = 12 * (input.crouch ? 0.6 : (input.sprint ? 2 : 1)) * input.movement_scale;
  if (grounded && len > 0) {
    const probe = 0.8;
    const forwardHeight = get_height_at(x + dx * probe, z + dz * probe);
    const backwardHeight = get_height_at(x - dx * probe, z - dz * probe);
    const directionalSlope = (forwardHeight - backwardHeight) / (2 * probe);
    speed /= Math.sqrt(1 + directionalSlope * directionalSlope);
  }
  x += dx * speed * dt;
  z += dz * speed * dt;

  if (input.jump && grounded) {
    velY = 25;
    grounded = false;
  }

  if (!grounded) {
    velY = Math.max(-54, velY - 49 * dt);
  }
  y += velY * dt;

  const radius = 1.15;
  const terrain = Math.max(
    get_height_at(x, z),
    get_height_at(x + radius, z),
    get_height_at(x - radius, z),
    get_height_at(x, z + radius),
    get_height_at(x, z - radius),
  );
  const groundY = terrain + 2.5;

  if (y <= groundY || (velY <= 0 && y - groundY < 0.45)) {
    y = groundY;
    if (velY <= 0) {
      velY = 0;
      grounded = true;
    }
  } else {
    grounded = false;
  }

  return new PhysicsState(x, y, z, velY, grounded);
}

const WEAPON_DAMAGE = {
  0: { body: 34, head: 51, range: 120 },
  1: { body: 90, head: 140, range: 400 },
  2: { body: 80, head: 100, range: 24 },
  3: { body: 20, head: 30, range: 75 },
  4: { body: 999, head: 999, range: 2.6 },
};

function rayCylinder(origin, dir, snap, maxRange) {
  const dLen = Math.hypot(dir[0], dir[1], dir[2]);
  if (dLen < 1e-6) return null;
  const dx = dir[0] / dLen;
  const dy = dir[1] / dLen;
  const dz = dir[2] / dLen;

  // Player network Y represents the top/physics anchor. The collision
  // cylinder base therefore lives one player-height below it.
  const baseY = snap.y - snap.height;
  const ox = origin[0] - snap.x;
  const oz = origin[2] - snap.z;
  const a = dx * dx + dz * dz;
  if (a < 1e-8) return null;
  const b = 2 * (ox * dx + oz * dz);
  const c = ox * ox + oz * oz - snap.radius * snap.radius;
  const disc = b * b - 4 * a * c;
  if (disc < 0) return null;

  const root = Math.sqrt(disc);
  const ts = [(-b - root) / (2 * a), (-b + root) / (2 * a)]
    .filter((t) => t >= 0 && t <= maxRange)
    .sort((a0, b0) => a0 - b0);

  for (const t of ts) {
    const hitY = origin[1] + dy * t;
    if (hitY >= baseY && hitY <= baseY + snap.height) {
      const relativeY = hitY - baseY;
      return {
        distance: t,
        isHeadshot: relativeY >= snap.height * 0.78,
      };
    }
  }
  return null;
}

export class WasmLagCompensator {
  constructor(max_history_ms = 500) {
    this.maxHistoryMs = Math.max(100, Number(max_history_ms) || 500);
    this.players = new Map();
  }

  free() {
    this.players.clear();
  }

  record_player_position(player_id, timestamp_ms, x, y, z, radius, height) {
    const id = Number(player_id);
    let history = this.players.get(id);
    if (!history) {
      history = [];
      this.players.set(id, history);
    }
    const ts = Number.isFinite(timestamp_ms) ? timestamp_ms : performance.now();
    history.push({
      timestamp: ts,
      x, y, z,
      radius: radius > 0 ? radius : 0.45,
      height: height > 0 ? height : 2,
    });
    const cutoff = ts - this.maxHistoryMs - 100;
    while (history.length > 2 && history[0].timestamp < cutoff) history.shift();
    if (history.length > 96) history.splice(0, history.length - 96);
  }

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
    max_range,
  ) {
    if (Number(shooter_id) === Number(victim_id)) {
      return JSON.stringify({ hit: false, damage: 0, is_headshot: false, distance: 0 });
    }

    const history = this.players.get(Number(victim_id));
    if (!history || history.length === 0) {
      return JSON.stringify({ hit: false, damage: 0, is_headshot: false, distance: 0 });
    }

    const newest = history[history.length - 1];
    const allowed = Math.max(0, Math.min(this.maxHistoryMs, Number(max_unlag_ms) || this.maxHistoryMs));
    let targetTime = Number(shot_time_ms);

    // performance.now() is not synchronized across computers. If the supplied
    // timestamp clearly belongs to another clock domain, validate against the
    // newest authoritative state rather than producing a false miss.
    if (!Number.isFinite(targetTime) || Math.abs(targetTime - newest.timestamp) > allowed + 250) {
      targetTime = newest.timestamp;
    } else {
      targetTime = Math.max(newest.timestamp - allowed, Math.min(newest.timestamp, targetTime));
    }

    let snap = newest;
    let best = Math.abs(newest.timestamp - targetTime);
    for (let i = history.length - 2; i >= 0; i -= 1) {
      const d = Math.abs(history[i].timestamp - targetTime);
      if (d <= best) {
        best = d;
        snap = history[i];
      } else if (history[i].timestamp < targetTime) {
        break;
      }
    }

    const cfg = WEAPON_DAMAGE[weapon_type] || WEAPON_DAMAGE[0];
    const range = Math.max(0.1, Math.min(Number(max_range) || cfg.range, cfg.range));
    const hit = rayCylinder(
      [origin_x, origin_y, origin_z],
      [dir_x, dir_y, dir_z],
      snap,
      range,
    );

    if (!hit) {
      return JSON.stringify({ hit: false, damage: 0, is_headshot: false, distance: 0 });
    }

    const damage = hit.isHeadshot ? cfg.head : cfg.body;
    return JSON.stringify({
      hit: true,
      damage,
      is_headshot: hit.isHeadshot,
      distance: hit.distance,
    });
  }

  clear_player(player_id) {
    this.players.delete(Number(player_id));
  }
}

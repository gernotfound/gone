use wasm_bindgen::prelude::*;

// Pseudo-random hash
fn hash(x: f64, y: f64) -> f64 {
    let n = (x * 12.9898 + y * 78.233).sin() * 43758.5453;
    n - n.floor()
}

fn pseudo_random(x: f64, z: f64) -> f64 {
    let n = (x * 12.9898 + z * 78.233).sin() * 43758.5453123;
    n - n.floor()
}

fn fade(t: f64) -> f64 {
    t * t * t * (t * (t * 6.0 - 15.0) + 10.0)
}

fn lerp(t: f64, a: f64, b: f64) -> f64 {
    a + t * (b - a)
}

fn noise2d(x: f64, y: f64) -> f64 {
    let i = x.floor();
    let j = y.floor();
    let fx = x - i;
    let fy = y - j;

    let u = fade(fx);
    let v = fade(fy);

    let a = hash(i, j);
    let b = hash(i + 1.0, j);
    let c = hash(i, j + 1.0);
    let d = hash(i + 1.0, j + 1.0);

    lerp(v, lerp(u, a, b), lerp(u, c, d)) * 2.0 - 1.0
}

fn fbm(x: f64, z: f64, octaves: i32, scale: f64, persistence: f64, lacunarity: f64) -> f64 {
    let mut total = 0.0;
    let mut frequency = scale;
    let mut amplitude = 1.0;
    let mut max_value = 0.0;
    
    for _ in 0..octaves {
        total += noise2d(x * frequency, z * frequency) * amplitude;
        max_value += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    total / max_value
}

fn ridged_noise(x: f64, z: f64, octaves: i32, scale: f64, persistence: f64, lacunarity: f64) -> f64 {
    let mut total = 0.0;
    let mut frequency = scale;
    let mut amplitude = 1.0;
    let mut max_value = 0.0;
    
    for _ in 0..octaves {
        let mut v = noise2d(x * frequency, z * frequency).abs();
        v = 1.0 - v; // Invert for ridges
        v = v * v; 
        total += v * amplitude;
        max_value += amplitude;
        amplitude *= persistence;
        frequency *= lacunarity;
    }
    total / max_value
}

fn get_crater_depth(x: f64, z: f64) -> f64 {
    let mut depth = 0.0;
    
    // Grandi Crateri
    let grid = 200.0; 
    let cell_x = (x / grid).floor();
    let cell_z = (z / grid).floor();
    
    for i in -1..=1 {
        for j in -1..=1 {
            let cx = cell_x + i as f64;
            let cz = cell_z + j as f64;
            
            let rx = cx * grid + pseudo_random(cx, cz) * grid;
            let rz = cz * grid + pseudo_random(cx * 1.1, cz * 1.1) * grid;
            
            let dx = x - rx;
            let dz = z - rz;
            let dist = (dx*dx + dz*dz).sqrt();
            
            let crater_radius = 20.0 + pseudo_random(cx*1.2, cz*1.2) * 30.0; 
            
            if dist < crater_radius * 1.5 {
                let t = dist / crater_radius;
                if t < 1.0 { 
                    let cavity = t.powf(2.0) - 1.0; 
                    depth += cavity * crater_radius * 0.4;
                } else if t < 1.5 { 
                    let rim_t = (t - 1.0) / 0.5;
                    let rim = (rim_t * std::f64::consts::PI).sin() * crater_radius * 0.15;
                    depth += rim;
                }
            }
        }
    }
    
    // Piccoli Crateri
    let s_grid = 30.0;
    let s_cell_x = (x / s_grid).floor();
    let s_cell_z = (z / s_grid).floor();
    let sx = s_cell_x * s_grid + pseudo_random(s_cell_x, s_cell_z) * s_grid;
    let sz = s_cell_z * s_grid + pseudo_random(s_cell_x*1.3, s_cell_z*1.3) * s_grid;
    let s_dist = ((x-sx)*(x-sx) + (z-sz)*(z-sz)).sqrt();
    let s_rad = 4.0 + pseudo_random(s_cell_x*1.4, s_cell_z*1.4) * 4.0;
    
    if s_dist < s_rad * 1.5 {
        let st = s_dist / s_rad;
        if st < 1.0 {
            depth += (st.powf(2.0) - 1.0) * s_rad * 0.5;
        } else if st < 1.5 {
            depth += (((st - 1.0) / 0.5) * std::f64::consts::PI).sin() * s_rad * 0.2;
        }
    }
    
    depth
}

fn get_terrain_height(x: f64, z: f64) -> f64 {
    let dist_center = (x*x + z*z).sqrt();
    let mut h = 0.0;
    
    // 1. Domain Warping
    let warp_x = fbm(x, z, 2, 0.001, 0.5, 2.0) * 150.0;
    let warp_z = fbm(x + 500.0, z - 500.0, 2, 0.001, 0.5, 2.0) * 150.0;
    let wx = x + warp_x;
    let wz = z + warp_z;

    // 2. Colline
    h += fbm(wx, wz, 4, 0.002, 0.5, 2.13) * 40.0;
    
    // Montagne Altissime (Nord-Ovest)
    let nw_dist = ((x + 1500.0).powi(2) + (z + 1500.0).powi(2)).sqrt();
    let mut nw_mask = 1.0 - (nw_dist / 2000.0).min(1.0);
    nw_mask = nw_mask * nw_mask * (3.0 - 2.0 * nw_mask);
    
    if nw_mask > 0.0 {
        let mut peak_noise = ridged_noise(x, z, 6, 0.0025, 0.5, 2.0) * 450.0;
        let step_height = 25.0;
        let t_index = peak_noise / step_height;
        let t_floor = t_index.floor();
        let t_fract = t_index - t_floor;
        let smoothed_fract = t_fract * t_fract * (3.0 - 2.0 * t_fract);
        peak_noise = (t_floor + smoothed_fract) * step_height;
        h += peak_noise * nw_mask;
    }

    // 3. Montagne normali
    let mnt = ridged_noise(wx, wz, 5, 0.003, 0.5, 1.97) * 150.0;
    let mut mnt_mask = fbm(x + 1000.0, z - 500.0, 2, 0.001, 0.5, 2.0);
    mnt_mask = (mnt_mask * 2.0).max(0.0);
    let raw_mnt = mnt * mnt_mask;
    
    let step_height = 12.0;
    let t_index = raw_mnt / step_height;
    let t_floor = t_index.floor();
    let t_fract = t_index - t_floor;
    let smoothed_fract = t_fract * t_fract * (3.0 - 2.0 * t_fract);
    h += (t_floor + smoothed_fract) * step_height;
    
    // 4. Erosione Idrica
    let erosion_noise = ridged_noise(x, z, 4, 0.005, 0.5, 2.0);
    let erosion = (1.0 - erosion_noise * 1.5).max(0.0);
    h -= (erosion * erosion) * 15.0; 
    
    // 5. Trincee
    let trench_noise = fbm(x, z, 3, 0.005, 0.5, 2.0);
    let trench = trench_noise.abs();
    if trench < 0.1 {
        let t_param = trench / 0.1;
        let depth = (1.0 - (t_param * t_param)) * 30.0;
        h -= depth;
    }

    // Cratere Enorme (Sud-Est)
    let crater_x = 1200.0;
    let crater_z = 1200.0;
    let giant_radius = 250.0;
    let g_dist = ((x - crater_x).powi(2) + (z - crater_z).powi(2)).sqrt();
    
    if g_dist < giant_radius * 1.5 {
        let gt = g_dist / giant_radius;
        if gt < 1.0 {
            let cavity = gt.powf(2.0) - 1.0; 
            h += cavity * giant_radius * 0.5;
        } else if gt < 1.5 {
            let rim_t = (gt - 1.0) / 0.5;
            let rim = (rim_t * std::f64::consts::PI).sin() * giant_radius * 0.2;
            h += rim;
        }
    }
    
    // 6. Crateri Procedurali Normali
    h += get_crater_depth(x, z);

    // 7. Micro-Dettagli
    h += fbm(x, z, 2, 0.1, 0.5, 2.0) * 0.4;
    
    // 8. SPAWN OVERRIDE
    if dist_center < 40.0 {
        let spawn_height = 15.0; 
        if dist_center <= 15.0 {
            h = spawn_height; 
        } else {
            let mut t = (dist_center - 15.0) / 25.0; 
            t = t * t * (3.0 - 2.0 * t); 
            h = spawn_height * (1.0 - t) + h * t;
        }
    }
    
    h
}

#[wasm_bindgen]
pub struct ChunkData {
    heights: Vec<f32>,
    colors: Vec<f32>,
    rocks: Vec<f32>,
}

#[wasm_bindgen]
impl ChunkData {
    pub fn get_heights(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(self.heights.as_slice())
    }
    
    pub fn get_colors(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(self.colors.as_slice())
    }
    
    pub fn get_rocks(&self) -> js_sys::Float32Array {
        js_sys::Float32Array::from(self.rocks.as_slice())
    }
}

#[wasm_bindgen]
pub fn get_height_at(x: f64, z: f64) -> f64 {
    get_terrain_height(x, z)
}

#[wasm_bindgen]
pub fn generate_chunk(cx: f64, cz: f64, offset_x: f64, offset_z: f64, size: f64, resolution: usize) -> ChunkData {
    let verts = resolution + 1;
    let count = verts * verts;
    
    let mut heights = Vec::with_capacity(count);
    let mut colors = Vec::with_capacity(count * 3);
    let mut rocks = Vec::new();
    
    let half = size / 2.0;
    
    for i in 0..verts {
        for j in 0..verts {
            let x = offset_x + (j as f64 / resolution as f64) * size - half;
            let z = offset_z + (i as f64 / resolution as f64) * size - half;
            
            let h = get_terrain_height(x, z);
            heights.push(h as f32);
            
            let h_right = get_terrain_height(x + 1.0, z);
            let h_up = get_terrain_height(x, z + 1.0);
            let nx = h - h_right;
            let nz = h - h_up;
            let slope = 1.0 / (nx*nx + 1.0 + nz*nz).sqrt();
            
            let mut t = (slope - 0.5) * 2.5;
            t = t.max(0.0).min(1.0);
            
            let r1 = 30.0/255.0; let g1 = 41.0/255.0; let b1 = 59.0/255.0;
            let r2 = 2.0/255.0;  let g2 = 6.0/255.0;  let b2 = 15.0/255.0;
            
            colors.push((r2 + (r1 - r2) * t) as f32);
            colors.push((g2 + (g1 - g2) * t) as f32);
            colors.push((b2 + (b1 - b2) * t) as f32);
        }
    }
    
    let max_clusters = 8 + (pseudo_random(cx, cz) * 10.0) as i32;
    for c in 0..max_clusters {
        let local_x = (pseudo_random(cx + c as f64, cz) - 0.5) * size;
        let local_z = (pseudo_random(cx, cz + c as f64) - 0.5) * size;
        let world_x = offset_x + local_x;
        let world_z = offset_z + local_z;
        
        let dist_center = (world_x*world_x + world_z*world_z).sqrt();
        if dist_center < 50.0 { continue; }
        
        let h = get_terrain_height(world_x, world_z);
        let h_right = get_terrain_height(world_x + 1.0, world_z);
        let h_up = get_terrain_height(world_x, world_z + 1.0);
        let nx = h - h_right;
        let nz = h - h_up;
        let slope = 1.0 / (nx*nx + 1.0 + nz*nz).sqrt();
        
        if slope > 0.85 {
            let sx = 1.0 + pseudo_random(world_x, world_z) * 4.0;
            let sy = 0.5 + pseudo_random(world_x+1.0, world_z) * 3.5;
            let sz = 1.0 + pseudo_random(world_x, world_z+1.0) * 4.0;
            let rot_x = pseudo_random(world_x+2.0, world_z) * std::f64::consts::PI;
            let rot_y = pseudo_random(world_x, world_z+2.0) * std::f64::consts::PI;
            let rot_z = pseudo_random(world_x+2.0, world_z+2.0) * std::f64::consts::PI;
            
            rocks.push(local_x as f32); rocks.push(h as f32); rocks.push(local_z as f32);
            rocks.push(sx as f32); rocks.push(sy as f32); rocks.push(sz as f32);
            rocks.push(rot_x as f32); rocks.push(rot_y as f32); rocks.push(rot_z as f32);
            
            let debris_count = 4 + (pseudo_random(world_x*2.0, world_z*2.0) * 8.0) as i32;
            for d in 0..debris_count {
                let d_local_x = local_x + (pseudo_random(world_x+d as f64, world_z) - 0.5) * 12.0;
                let d_local_z = local_z + (pseudo_random(world_x, world_z+d as f64) - 0.5) * 12.0;
                let d_world_x = offset_x + d_local_x;
                let d_world_z = offset_z + d_local_z;

                let d_h = get_terrain_height(d_world_x, d_world_z);
                let dsx = 0.2 + pseudo_random(d_world_x, d_world_z) * 1.5;
                let dsy = 0.2 + pseudo_random(d_world_x+1.0, d_world_z) * 1.0;
                let dsz = 0.2 + pseudo_random(d_world_x, d_world_z+1.0) * 1.5;
                
                let drx = pseudo_random(d_world_x+2.0, d_world_z) * std::f64::consts::PI;
                let dry = pseudo_random(d_world_x, d_world_z+2.0) * std::f64::consts::PI;
                let drz = pseudo_random(d_world_x+2.0, d_world_z+2.0) * std::f64::consts::PI;

                rocks.push(d_local_x as f32); rocks.push(d_h as f32); rocks.push(d_local_z as f32);
                rocks.push(dsx as f32); rocks.push(dsy as f32); rocks.push(dsz as f32);
                rocks.push(drx as f32); rocks.push(dry as f32); rocks.push(drz as f32);
            }
        }
    }
    
    ChunkData {
        heights,
        colors,
        rocks
    }
}

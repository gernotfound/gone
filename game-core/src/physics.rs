use wasm_bindgen::prelude::*;

#[wasm_bindgen]
pub struct PhysicsInput {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vel_y: f64,
    pub is_grounded: bool,
    pub forward: bool,
    pub backward: bool,
    pub left: bool,
    pub right: bool,
    pub yaw: f64,
    pub jump: bool,
    pub sprint: bool,
    pub crouch: bool,
    pub delta: f64,
}

#[wasm_bindgen]
impl PhysicsInput {
    #[wasm_bindgen(constructor)]
    pub fn new(
        x: f64, y: f64, z: f64, vel_y: f64, is_grounded: bool,
        forward: bool, backward: bool, left: bool, right: bool, yaw: f64,
        jump: bool, sprint: bool, crouch: bool, delta: f64
    ) -> PhysicsInput {
        PhysicsInput {
            x, y, z, vel_y, is_grounded,
            forward, backward, left, right, yaw,
            jump, sprint, crouch, delta
        }
    }
}

#[wasm_bindgen]
pub struct PhysicsState {
    pub x: f64,
    pub y: f64,
    pub z: f64,
    pub vel_y: f64,
    pub is_grounded: bool,
}

#[wasm_bindgen]
pub fn step_physics(input: &PhysicsInput) -> PhysicsState {
    let mut vel_y = input.vel_y;
    let mut is_grounded = input.is_grounded;
    let mut x = input.x;
    let mut y = input.y;
    let mut z = input.z;
    let delta = input.delta;

    let speed = 12.0;
    let sprint_multiplier = 2.0;
    let crouch_multiplier = 0.6;
    let jump_force = 25.0;
    let gravity = 9.8;
    let gravity_scale = 5.0;
    let terminal_velocity = -54.0;
    
    let player_height = 2.0;
    let float_height = 0.5;
    let r = 1.5;
    let ground_snap_margin = 0.5;

    let mut move_dir_x: f64 = 0.0;
    let mut move_dir_z: f64 = 0.0;

    if input.forward { move_dir_z -= 1.0; }
    if input.backward { move_dir_z += 1.0; }
    if input.left { move_dir_x -= 1.0; }
    if input.right { move_dir_x += 1.0; }

    if move_dir_x != 0.0 || move_dir_z != 0.0 {
        let length = (move_dir_x * move_dir_x + move_dir_z * move_dir_z).sqrt();
        move_dir_x /= length;
        move_dir_z /= length;
        
        let yaw = input.yaw;
        let cos_yaw = yaw.cos();
        let sin_yaw = yaw.sin();
        let nx = move_dir_x * cos_yaw + move_dir_z * sin_yaw;
        let nz = -move_dir_x * sin_yaw + move_dir_z * cos_yaw;
        move_dir_x = nx;
        move_dir_z = nz;
    }

    if input.jump && is_grounded {
        vel_y = jump_force;
        is_grounded = false;
    }

    let mut current_speed = speed;
    if input.sprint && !input.crouch {
        current_speed = speed * sprint_multiplier;
    } else if input.crouch {
        current_speed = speed * crouch_multiplier;
    }

    x += move_dir_x * current_speed * delta;
    z += move_dir_z * current_speed * delta;

    if !is_grounded {
        vel_y -= (gravity * gravity_scale) * delta;
        if vel_y < terminal_velocity {
            vel_y = terminal_velocity;
        }
    }
    y += vel_y * delta;

    let h_center = crate::get_height_at(x, z);
    let h1 = crate::get_height_at(x + r, z);
    let h2 = crate::get_height_at(x - r, z);
    let h3 = crate::get_height_at(x, z + r);
    let h4 = crate::get_height_at(x, z - r);

    let mut max_terrain_height = h_center;
    if h1 > max_terrain_height { max_terrain_height = h1; }
    if h2 > max_terrain_height { max_terrain_height = h2; }
    if h3 > max_terrain_height { max_terrain_height = h3; }
    if h4 > max_terrain_height { max_terrain_height = h4; }

    let ground_height = max_terrain_height + player_height + float_height;

    if y <= ground_height {
        y = ground_height;
        if vel_y <= 0.0 {
            vel_y = 0.0;
            is_grounded = true;
        } else {
            is_grounded = false;
        }
    } else if vel_y <= 0.0 && y - ground_height < ground_snap_margin {
        y = ground_height;
        vel_y = 0.0;
        is_grounded = true;
    } else {
        is_grounded = false;
    }

    PhysicsState {
        x,
        y,
        z,
        vel_y,
        is_grounded,
    }
}

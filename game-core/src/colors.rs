use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use wasm_bindgen::prelude::*;

/// Predefined Cyberpunk Neon palette guaranteed to pass HSV fluorescence checks.
pub const PRESET_NEON_PALETTE: [&str; 8] = [
    "#00F0FF", // Cyan
    "#FF007F", // Neon Pink
    "#39FF14", // Acid Green
    "#FFE600", // Neon Yellow
    "#BD00FF", // Electric Purple
    "#FF5F00", // Neon Orange
    "#FF003C", // Bright Red
    "#00D4FF", // Ice Blue
];

/// Minimum Saturation (0.0 - 1.0) required for a fluorescent color
pub const MIN_FLUORESCENCE_SATURATION: f64 = 0.70;

/// Minimum Value / Brightness (0.0 - 1.0) required for a fluorescent color
pub const MIN_FLUORESCENCE_VALUE: f64 = 0.70;

/// Error types for color registration
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub enum ColorErrorCode {
    ColorAlreadyTaken,
    InvalidFluoColor,
    InvalidHexFormat,
    InvalidPlayerId,
}

impl ColorErrorCode {
    pub fn as_str(&self) -> &'static str {
        match self {
            ColorErrorCode::ColorAlreadyTaken => "COLOR_ALREADY_TAKEN",
            ColorErrorCode::InvalidFluoColor => "INVALID_FLUO_COLOR",
            ColorErrorCode::InvalidHexFormat => "INVALID_HEX_FORMAT",
            ColorErrorCode::InvalidPlayerId => "INVALID_PLAYER_ID",
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ColorResponse {
    pub success: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub color: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub message: Option<String>,
}

impl ColorResponse {
    pub fn success(color: String) -> Self {
        Self {
            success: true,
            color: Some(color),
            error: None,
            message: None,
        }
    }

    pub fn error(error: ColorErrorCode, message: &str) -> Self {
        Self {
            success: false,
            color: None,
            error: Some(error.as_str().to_string()),
            message: Some(message.to_string()),
        }
    }

    pub fn to_json(&self) -> String {
        serde_json::to_string(self).unwrap_or_else(|_| {
            r#"{"success":false,"error":"INTERNAL_ERROR","message":"Serialization failed"}"#.to_string()
        })
    }
}

/// Convert RGB in [0, 255] to HSV (H: [0.0, 360.0), S: [0.0, 1.0], V: [0.0, 1.0])
pub fn rgb_to_hsv(r: u8, g: u8, b: u8) -> (f64, f64, f64) {
    let rf = r as f64 / 255.0;
    let gf = g as f64 / 255.0;
    let bf = b as f64 / 255.0;

    let c_max = rf.max(gf).max(bf);
    let c_min = rf.min(gf).min(bf);
    let delta = c_max - c_min;

    let v = c_max;
    let s = if c_max > 1e-9 { delta / c_max } else { 0.0 };

    let h = if delta < 1e-9 {
        0.0
    } else if (c_max - rf).abs() < 1e-9 {
        let mut val = 60.0 * (((gf - bf) / delta) % 6.0);
        if val < 0.0 {
            val += 360.0;
        }
        val
    } else if (c_max - gf).abs() < 1e-9 {
        60.0 * (((bf - rf) / delta) + 2.0)
    } else {
        60.0 * (((rf - gf) / delta) + 4.0)
    };

    let h = if h < 0.0 {
        h + 360.0
    } else if h >= 360.0 {
        h - 360.0
    } else {
        h
    };

    (h, s, v)
}

/// Validate that a color meets the neon/fluorescent saturation and brightness criteria.
/// S >= 0.70 and V >= 0.70.
pub fn is_fluorescent(r: u8, g: u8, b: u8) -> bool {
    let (_h, s, v) = rgb_to_hsv(r, g, b);
    s >= (MIN_FLUORESCENCE_SATURATION - 1e-6) && v >= (MIN_FLUORESCENCE_VALUE - 1e-6)
}

/// Normalize a hex color string to uppercase `#RRGGBB` format.
/// Accepts strings with or without leading '#', case-insensitive.
pub fn normalize_hex(hex: &str) -> Result<String, ColorErrorCode> {
    let trimmed = hex.trim();
    let stripped = trimmed.strip_prefix('#').unwrap_or(trimmed);

    if stripped.len() != 6 {
        return Err(ColorErrorCode::InvalidHexFormat);
    }

    if !stripped.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err(ColorErrorCode::InvalidHexFormat);
    }

    Ok(format!("#{}", stripped.to_ascii_uppercase()))
}

/// Parse normalized `#RRGGBB` string into (r, g, b) bytes.
pub fn parse_hex_rgb(normalized_hex: &str) -> Result<(u8, u8, u8), ColorErrorCode> {
    if normalized_hex.len() != 7 || !normalized_hex.starts_with('#') {
        return Err(ColorErrorCode::InvalidHexFormat);
    }
    let r = u8::from_str_radix(&normalized_hex[1..3], 16)
        .map_err(|_| ColorErrorCode::InvalidHexFormat)?;
    let g = u8::from_str_radix(&normalized_hex[3..5], 16)
        .map_err(|_| ColorErrorCode::InvalidHexFormat)?;
    let b = u8::from_str_radix(&normalized_hex[5..7], 16)
        .map_err(|_| ColorErrorCode::InvalidHexFormat)?;
    Ok((r, g, b))
}

/// Pure Rust Session Color Registry enforcing uniqueness per P2P match session
/// and vibrant neon fluorescence compliance.
#[derive(Debug, Clone, Default)]
pub struct SessionColorRegistry {
    /// Maps player_id -> normalized_hex
    player_colors: HashMap<String, String>,
}

impl SessionColorRegistry {
    pub fn new() -> Self {
        Self {
            player_colors: HashMap::new(),
        }
    }

    /// Check if a hex color string is valid, meets fluorescence rules,
    /// and is NOT currently claimed by any active player.
    pub fn is_color_available(&self, hex: &str) -> bool {
        let normalized = match normalize_hex(hex) {
            Ok(n) => n,
            Err(_) => return false,
        };

        let (r, g, b) = match parse_hex_rgb(&normalized) {
            Ok(rgb) => rgb,
            Err(_) => return false,
        };

        if !is_fluorescent(r, g, b) {
            return false;
        }

        !self.player_colors.values().any(|claimed| claimed == &normalized)
    }

    /// Attempt to claim a color for a player.
    /// Returns structured ColorResponse.
    pub fn request_color_internal(&mut self, player_id: &str, hex: &str) -> ColorResponse {
        let player_id = player_id.trim();
        if player_id.is_empty() {
            return ColorResponse::error(
                ColorErrorCode::InvalidPlayerId,
                "Player ID cannot be empty",
            );
        }

        let normalized = match normalize_hex(hex) {
            Ok(n) => n,
            Err(_) => {
                return ColorResponse::error(
                    ColorErrorCode::InvalidHexFormat,
                    "Invalid hex color format. Expected 6 hex characters (e.g. #00F0FF or 00F0FF)",
                );
            }
        };

        let (r, g, b) = match parse_hex_rgb(&normalized) {
            Ok(rgb) => rgb,
            Err(_) => {
                return ColorResponse::error(
                    ColorErrorCode::InvalidHexFormat,
                    "Invalid hex color format",
                );
            }
        };

        if !is_fluorescent(r, g, b) {
            return ColorResponse::error(
                ColorErrorCode::InvalidFluoColor,
                "Color does not meet neon/fluorescence requirements (Saturation >= 0.70, Value >= 0.70)",
            );
        }

        // Check if claimed by another player
        for (pid, claimed_color) in &self.player_colors {
            if claimed_color == &normalized {
                if pid == player_id {
                    // Same player re-requesting their own current color
                    return ColorResponse::success(normalized);
                } else {
                    return ColorResponse::error(
                        ColorErrorCode::ColorAlreadyTaken,
                        "Color is already claimed by another player",
                    );
                }
            }
        }

        // Assign color (updating player's color if they already had one)
        self.player_colors.insert(player_id.to_string(), normalized.clone());
        ColorResponse::success(normalized)
    }

    /// Request a color and return JSON string
    pub fn request_color(&mut self, player_id: &str, hex: &str) -> String {
        self.request_color_internal(player_id, hex).to_json()
    }

    /// Free any color assigned to this player_id when they leave the session.
    pub fn release_player(&mut self, player_id: &str) {
        self.player_colors.remove(player_id.trim());
    }

    /// Predefined preset neon Cyberpunk palette
    pub fn get_preset_palette() -> Vec<String> {
        PRESET_NEON_PALETTE.iter().map(|s| s.to_string()).collect()
    }

    /// Preset palette colors that are currently unclaimed in this session
    pub fn get_available_palette(&self) -> Vec<String> {
        PRESET_NEON_PALETTE
            .iter()
            .filter(|hex| !self.player_colors.values().any(|c| c.as_str() == **hex))
            .map(|s| s.to_string())
            .collect()
    }

    /// Currently assigned color for a player, if any
    pub fn get_player_color(&self, player_id: &str) -> Option<&String> {
        self.player_colors.get(player_id.trim())
    }

    /// Total count of active players in the registry
    pub fn active_player_count(&self) -> usize {
        self.player_colors.len()
    }
}

/// WASM exported wrapper for SessionColorRegistry
#[wasm_bindgen]
pub struct WasmColorRegistry {
    inner: SessionColorRegistry,
}

impl Default for WasmColorRegistry {
    fn default() -> Self {
        Self::new()
    }
}

#[wasm_bindgen]
impl WasmColorRegistry {
    #[wasm_bindgen(constructor)]
    pub fn new() -> Self {
        Self {
            inner: SessionColorRegistry::new(),
        }
    }

    /// Validates and registers a player's proposed fluo color.
    /// Returns JSON:
    /// `{"success": true, "color": "#00F0FF"}`
    /// or `{"success": false, "error": "COLOR_ALREADY_TAKEN", "message": "Color is already claimed by another player"}`
    /// or `{"success": false, "error": "INVALID_FLUO_COLOR", "message": "Color does not meet neon/fluorescence requirements"}`
    pub fn request_color(&mut self, player_id: &str, color_hex: &str) -> String {
        self.inner.request_color(player_id, color_hex)
    }

    /// Releases a player's assigned color upon disconnect.
    pub fn release_player(&mut self, player_id: &str) {
        self.inner.release_player(player_id);
    }

    /// Checks whether a color is valid fluo and currently available.
    pub fn is_color_available(&self, color_hex: &str) -> bool {
        self.inner.is_color_available(color_hex)
    }

    /// Returns list of available preset neon colors.
    pub fn get_available_palette(&self) -> Vec<String> {
        self.inner.get_available_palette()
    }

    /// Returns all preset neon palette colors.
    pub fn get_preset_palette(&self) -> Vec<String> {
        SessionColorRegistry::get_preset_palette()
    }

    /// Returns currently assigned color for a player, if any.
    pub fn get_player_color(&self, player_id: &str) -> Option<String> {
        self.inner.get_player_color(player_id).cloned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_hex_normalization() {
        assert_eq!(normalize_hex("#00F0FF").unwrap(), "#00F0FF");
        assert_eq!(normalize_hex("00f0ff").unwrap(), "#00F0FF");
        assert_eq!(normalize_hex(" #39ff14 ").unwrap(), "#39FF14");
        assert_eq!(normalize_hex("#bd00ff").unwrap(), "#BD00FF");

        // Invalid lengths or characters
        assert!(normalize_hex("123").is_err());
        assert!(normalize_hex("#12345").is_err());
        assert!(normalize_hex("#1234567").is_err());
        assert!(normalize_hex("#ZZZZZZ").is_err());
        assert!(normalize_hex("").is_err());
    }

    #[test]
    fn test_fluorescence_rgb_to_hsv() {
        // Pure red: H=0, S=1, V=1
        let (h, s, v) = rgb_to_hsv(255, 0, 0);
        assert_eq!(h, 0.0);
        assert_eq!(s, 1.0);
        assert_eq!(v, 1.0);

        // Pure green: H=120, S=1, V=1
        let (h, s, v) = rgb_to_hsv(0, 255, 0);
        assert_eq!(h, 120.0);
        assert_eq!(s, 1.0);
        assert_eq!(v, 1.0);

        // Pure blue: H=240, S=1, V=1
        let (h, s, v) = rgb_to_hsv(0, 0, 255);
        assert_eq!(h, 240.0);
        assert_eq!(s, 1.0);
        assert_eq!(v, 1.0);

        // Black: S=0, V=0
        let (_, s_black, v_black) = rgb_to_hsv(0, 0, 0);
        assert_eq!(s_black, 0.0);
        assert_eq!(v_black, 0.0);

        // White: S=0, V=1
        let (_, s_white, v_white) = rgb_to_hsv(255, 255, 255);
        assert_eq!(s_white, 0.0);
        assert_eq!(v_white, 1.0);
    }

    #[test]
    fn test_preset_neon_palette_all_fluorescent() {
        for hex in PRESET_NEON_PALETTE {
            let normalized = normalize_hex(hex).expect("Preset hex must normalize");
            let (r, g, b) = parse_hex_rgb(&normalized).expect("Preset hex must parse RGB");
            let (_h, s, v) = rgb_to_hsv(r, g, b);
            assert!(
                s >= MIN_FLUORESCENCE_SATURATION - 1e-6,
                "Preset {} saturation {} < {}",
                hex,
                s,
                MIN_FLUORESCENCE_SATURATION
            );
            assert!(
                v >= MIN_FLUORESCENCE_VALUE - 1e-6,
                "Preset {} value {} < {}",
                hex,
                v,
                MIN_FLUORESCENCE_VALUE
            );
            assert!(is_fluorescent(r, g, b), "Preset {} must be fluorescent", hex);
        }
    }

    #[test]
    fn test_dull_and_dark_colors_rejected() {
        // Black
        assert!(!is_fluorescent(0, 0, 0));
        // Dark gray #333333
        assert!(!is_fluorescent(0x33, 0x33, 0x33));
        // White #FFFFFF
        assert!(!is_fluorescent(0xFF, 0xFF, 0xFF));
        // Dull brown #5C4033
        assert!(!is_fluorescent(0x5C, 0x40, 0x33));
        // Washed-out pastel pink #FFB6C1 (R=255, G=182, B=193 -> S=0.286)
        assert!(!is_fluorescent(0xFF, 0xB6, 0xC1));
    }

    #[test]
    fn test_color_uniqueness_and_collision() {
        let mut registry = SessionColorRegistry::new();

        // Player 1 claims Cyan
        let resp1 = registry.request_color_internal("player1", "#00f0ff");
        assert!(resp1.success);
        assert_eq!(resp1.color.unwrap(), "#00F0FF");
        assert_eq!(registry.active_player_count(), 1);

        // Player 2 attempts to claim the exact same Cyan
        let resp2 = registry.request_color_internal("player2", "00F0FF");
        assert!(!resp2.success);
        assert_eq!(resp2.error.unwrap(), "COLOR_ALREADY_TAKEN");
        assert_eq!(registry.active_player_count(), 1);

        // Player 2 claims Neon Pink instead
        let resp2_ok = registry.request_color_internal("player2", "#FF007F");
        assert!(resp2_ok.success);
        assert_eq!(resp2_ok.color.unwrap(), "#FF007F");
        assert_eq!(registry.active_player_count(), 2);

        // Player 1 re-requests their own color (idempotent)
        let resp1_re = registry.request_color_internal("player1", "#00F0FF");
        assert!(resp1_re.success);
        assert_eq!(resp1_re.color.unwrap(), "#00F0FF");

        // Player 3 requests a non-fluo color (black)
        let resp3_fail = registry.request_color_internal("player3", "#000000");
        assert!(!resp3_fail.success);
        assert_eq!(resp3_fail.error.unwrap(), "INVALID_FLUO_COLOR");

        // Player 3 requests invalid hex format
        let resp3_bad_hex = registry.request_color_internal("player3", "not-a-color");
        assert!(!resp3_bad_hex.success);
        assert_eq!(resp3_bad_hex.error.unwrap(), "INVALID_HEX_FORMAT");
    }

    #[test]
    fn test_player_release() {
        let mut registry = SessionColorRegistry::new();

        // Player 1 claims Acid Green
        assert!(registry.request_color_internal("player1", "#39FF14").success);
        assert!(!registry.is_color_available("#39FF14"));

        // Player 2 cannot claim it
        assert!(!registry.request_color_internal("player2", "#39FF14").success);

        // Player 1 disconnects / releases
        registry.release_player("player1");
        assert!(registry.is_color_available("#39FF14"));

        // Now Player 2 can successfully claim it
        let resp2 = registry.request_color_internal("player2", "#39FF14");
        assert!(resp2.success);
        assert_eq!(resp2.color.unwrap(), "#39FF14");
    }

    #[test]
    fn test_available_palette_filtering() {
        let mut registry = SessionColorRegistry::new();
        let total_presets = PRESET_NEON_PALETTE.len();

        assert_eq!(registry.get_available_palette().len(), total_presets);

        // Claim one color
        registry.request_color_internal("p1", "#00F0FF");
        let available = registry.get_available_palette();
        assert_eq!(available.len(), total_presets - 1);
        assert!(!available.contains(&"#00F0FF".to_string()));

        // Release player
        registry.release_player("p1");
        assert_eq!(registry.get_available_palette().len(), total_presets);
        assert!(registry.get_available_palette().contains(&"#00F0FF".to_string()));
    }

    #[test]
    fn test_wasm_wrapper_json_protocol() {
        let mut wasm_registry = WasmColorRegistry::new();

        // Request color via JSON string interface
        let json_str1 = wasm_registry.request_color("player_alpha", "#FFE600");
        let parsed1: serde_json::Value = serde_json::from_str(&json_str1).unwrap();
        assert_eq!(parsed1["success"], true);
        assert_eq!(parsed1["color"], "#FFE600");

        // Duplicate request from different player
        let json_str2 = wasm_registry.request_color("player_beta", "#ffe600");
        let parsed2: serde_json::Value = serde_json::from_str(&json_str2).unwrap();
        assert_eq!(parsed2["success"], false);
        assert_eq!(parsed2["error"], "COLOR_ALREADY_TAKEN");

        // Release player_alpha
        wasm_registry.release_player("player_alpha");

        // Retry player_beta
        let json_str3 = wasm_registry.request_color("player_beta", "#ffe600");
        let parsed3: serde_json::Value = serde_json::from_str(&json_str3).unwrap();
        assert_eq!(parsed3["success"], true);
        assert_eq!(parsed3["color"], "#FFE600");
    }
}

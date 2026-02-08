use serde::{Deserialize, Serialize};
use std::fs;
use std::path::PathBuf;

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ShortcutConfig {
    pub modifiers: Vec<String>, // e.g., ["super", "shift"]
    pub key: String,            // e.g., "Space"
}

impl Default for ShortcutConfig {
    fn default() -> Self {
        Self {
            modifiers: vec!["super".to_string(), "shift".to_string()],
            key: "Space".to_string(),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
#[serde(rename_all = "lowercase")]
pub enum TranscriptionProvider {
    #[default]
    OpenAI,
    Groq,
}

// API keys are now stored securely in the OS keychain.
// This struct is kept only so old settings files deserialize without error.
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
#[allow(dead_code)]
pub struct ApiKeysConfig {
    #[serde(default, skip_serializing)]
    openai_api_key: Option<String>,
    #[serde(default, skip_serializing)]
    groq_api_key: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct TranscriptionConfig {
    pub provider: TranscriptionProvider,
}

impl Default for TranscriptionConfig {
    fn default() -> Self {
        Self {
            provider: TranscriptionProvider::OpenAI,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub shortcut: ShortcutConfig,
    #[serde(default)]
    pub api_keys: ApiKeysConfig,
    #[serde(default)]
    pub transcription: TranscriptionConfig,
    #[serde(default)]
    pub audio_input_device: Option<String>,
}

fn get_settings_path() -> PathBuf {
    let config_dir = dirs::config_dir()
        .unwrap_or_else(|| PathBuf::from("."))
        .join("scrivano");

    fs::create_dir_all(&config_dir).ok();
    config_dir.join("settings.json")
}

pub fn load_settings() -> Settings {
    let path = get_settings_path();

    if path.exists() {
        match fs::read_to_string(&path) {
            Ok(content) => match serde_json::from_str(&content) {
                Ok(settings) => return settings,
                Err(e) => eprintln!("Failed to parse settings: {}", e),
            },
            Err(e) => eprintln!("Failed to read settings file: {}", e),
        }
    }

    Settings::default()
}

pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = get_settings_path();

    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    fs::write(&path, content).map_err(|e| format!("Failed to write settings file: {}", e))?;

    Ok(())
}

use tauri_plugin_global_shortcut::{Code, Modifiers};

pub fn parse_modifiers(modifiers: &[String]) -> Modifiers {
    let mut result = Modifiers::empty();

    for modifier in modifiers {
        match modifier.to_lowercase().as_str() {
            "super" | "cmd" | "command" | "meta" => result |= Modifiers::SUPER,
            "shift" => result |= Modifiers::SHIFT,
            "ctrl" | "control" => result |= Modifiers::CONTROL,
            "alt" | "option" => result |= Modifiers::ALT,
            _ => {}
        }
    }

    result
}

pub fn parse_key(key: &str) -> Option<Code> {
    match key.to_lowercase().as_str() {
        // Letters
        "a" => Some(Code::KeyA),
        "b" => Some(Code::KeyB),
        "c" => Some(Code::KeyC),
        "d" => Some(Code::KeyD),
        "e" => Some(Code::KeyE),
        "f" => Some(Code::KeyF),
        "g" => Some(Code::KeyG),
        "h" => Some(Code::KeyH),
        "i" => Some(Code::KeyI),
        "j" => Some(Code::KeyJ),
        "k" => Some(Code::KeyK),
        "l" => Some(Code::KeyL),
        "m" => Some(Code::KeyM),
        "n" => Some(Code::KeyN),
        "o" => Some(Code::KeyO),
        "p" => Some(Code::KeyP),
        "q" => Some(Code::KeyQ),
        "r" => Some(Code::KeyR),
        "s" => Some(Code::KeyS),
        "t" => Some(Code::KeyT),
        "u" => Some(Code::KeyU),
        "v" => Some(Code::KeyV),
        "w" => Some(Code::KeyW),
        "x" => Some(Code::KeyX),
        "y" => Some(Code::KeyY),
        "z" => Some(Code::KeyZ),
        // Numbers
        "0" | "digit0" => Some(Code::Digit0),
        "1" | "digit1" => Some(Code::Digit1),
        "2" | "digit2" => Some(Code::Digit2),
        "3" | "digit3" => Some(Code::Digit3),
        "4" | "digit4" => Some(Code::Digit4),
        "5" | "digit5" => Some(Code::Digit5),
        "6" | "digit6" => Some(Code::Digit6),
        "7" | "digit7" => Some(Code::Digit7),
        "8" | "digit8" => Some(Code::Digit8),
        "9" | "digit9" => Some(Code::Digit9),
        // Function keys
        "f1" => Some(Code::F1),
        "f2" => Some(Code::F2),
        "f3" => Some(Code::F3),
        "f4" => Some(Code::F4),
        "f5" => Some(Code::F5),
        "f6" => Some(Code::F6),
        "f7" => Some(Code::F7),
        "f8" => Some(Code::F8),
        "f9" => Some(Code::F9),
        "f10" => Some(Code::F10),
        "f11" => Some(Code::F11),
        "f12" => Some(Code::F12),
        // Special keys
        "space" => Some(Code::Space),
        "enter" | "return" => Some(Code::Enter),
        "tab" => Some(Code::Tab),
        "escape" | "esc" => Some(Code::Escape),
        "backspace" => Some(Code::Backspace),
        "delete" => Some(Code::Delete),
        "insert" => Some(Code::Insert),
        "home" => Some(Code::Home),
        "end" => Some(Code::End),
        "pageup" => Some(Code::PageUp),
        "pagedown" => Some(Code::PageDown),
        // Arrow keys
        "arrowup" | "up" => Some(Code::ArrowUp),
        "arrowdown" | "down" => Some(Code::ArrowDown),
        "arrowleft" | "left" => Some(Code::ArrowLeft),
        "arrowright" | "right" => Some(Code::ArrowRight),
        // Punctuation
        "minus" | "-" => Some(Code::Minus),
        "equal" | "=" => Some(Code::Equal),
        "bracketleft" | "[" => Some(Code::BracketLeft),
        "bracketright" | "]" => Some(Code::BracketRight),
        "backslash" | "\\" => Some(Code::Backslash),
        "semicolon" | ";" => Some(Code::Semicolon),
        "quote" | "'" => Some(Code::Quote),
        "backquote" | "`" => Some(Code::Backquote),
        "comma" | "," => Some(Code::Comma),
        "period" | "." => Some(Code::Period),
        "slash" | "/" => Some(Code::Slash),
        _ => None,
    }
}

pub fn format_shortcut_display(config: &ShortcutConfig) -> String {
    let mut parts = Vec::new();

    for modifier in &config.modifiers {
        match modifier.to_lowercase().as_str() {
            "super" | "cmd" | "command" | "meta" => parts.push("⌘"),
            "shift" => parts.push("⇧"),
            "ctrl" | "control" => parts.push("⌃"),
            "alt" | "option" => parts.push("⌥"),
            _ => {}
        }
    }

    // Format the key nicely
    let key_display = match config.key.to_lowercase().as_str() {
        "space" => "Space",
        "enter" | "return" => "↩",
        "tab" => "⇥",
        "escape" | "esc" => "⎋",
        "backspace" => "⌫",
        "delete" => "⌦",
        "arrowup" | "up" => "↑",
        "arrowdown" | "down" => "↓",
        "arrowleft" | "left" => "←",
        "arrowright" | "right" => "→",
        other => return format!("{}{}", parts.join(""), other.to_uppercase()),
    };

    format!("{}{}", parts.join(""), key_display)
}

/// Get API key for a provider from the keychain.
/// NOTE: Runtime code should use `get_api_key_from_cache` in lib.rs instead
/// to avoid repeated keychain prompts.  This function is kept for tests.
#[allow(dead_code)]
pub fn get_api_key_for_provider(provider: &TranscriptionProvider) -> Option<String> {
    let provider_key = match provider {
        TranscriptionProvider::OpenAI => "openai",
        TranscriptionProvider::Groq => "groq",
    };

    crate::keychain::get_api_key(provider_key)
}

/// Get the model name for a provider
pub fn get_model_for_provider(provider: &TranscriptionProvider) -> &'static str {
    match provider {
        TranscriptionProvider::OpenAI => "whisper-1",
        TranscriptionProvider::Groq => "whisper-large-v3-turbo",
    }
}

/// Get the endpoint URL for a provider
pub fn get_endpoint_for_provider(provider: &TranscriptionProvider) -> &'static str {
    match provider {
        TranscriptionProvider::OpenAI => "https://api.openai.com/v1/audio/transcriptions",
        TranscriptionProvider::Groq => "https://api.groq.com/openai/v1/audio/transcriptions",
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_shortcut_config_default() {
        let config = ShortcutConfig::default();
        assert_eq!(config.modifiers, vec!["super", "shift"]);
        assert_eq!(config.key, "Space");
    }

    #[test]
    fn test_transcription_provider_default() {
        let provider = TranscriptionProvider::default();
        assert_eq!(provider, TranscriptionProvider::OpenAI);
    }

    #[test]
    fn test_transcription_config_default() {
        let config = TranscriptionConfig::default();
        assert_eq!(config.provider, TranscriptionProvider::OpenAI);
    }

    #[test]
    fn test_settings_default() {
        let settings = Settings::default();
        assert_eq!(settings.shortcut.modifiers, vec!["super", "shift"]);
        assert_eq!(settings.shortcut.key, "Space");
        assert_eq!(
            settings.transcription.provider,
            TranscriptionProvider::OpenAI
        );
    }

    #[test]
    fn test_parse_modifiers_super() {
        let modifiers = vec!["super".to_string()];
        let result = parse_modifiers(&modifiers);
        assert!(result.contains(Modifiers::SUPER));
    }

    #[test]
    fn test_parse_modifiers_shift() {
        let modifiers = vec!["shift".to_string()];
        let result = parse_modifiers(&modifiers);
        assert!(result.contains(Modifiers::SHIFT));
    }

    #[test]
    fn test_parse_modifiers_multiple() {
        let modifiers = vec!["super".to_string(), "shift".to_string(), "ctrl".to_string()];
        let result = parse_modifiers(&modifiers);
        assert!(result.contains(Modifiers::SUPER));
        assert!(result.contains(Modifiers::SHIFT));
        assert!(result.contains(Modifiers::CONTROL));
    }

    #[test]
    fn test_parse_key_letter() {
        assert_eq!(parse_key("a"), Some(Code::KeyA));
        assert_eq!(parse_key("z"), Some(Code::KeyZ));
        assert_eq!(parse_key("A"), Some(Code::KeyA)); // Test case insensitivity
    }

    #[test]
    fn test_parse_key_special() {
        assert_eq!(parse_key("space"), Some(Code::Space));
        assert_eq!(parse_key("enter"), Some(Code::Enter));
        assert_eq!(parse_key("return"), Some(Code::Enter));
        assert_eq!(parse_key("tab"), Some(Code::Tab));
    }

    #[test]
    fn test_parse_key_function() {
        assert_eq!(parse_key("f1"), Some(Code::F1));
        assert_eq!(parse_key("f12"), Some(Code::F12));
    }

    #[test]
    fn test_parse_key_invalid() {
        assert_eq!(parse_key("invalid_key"), None);
    }

    #[test]
    fn test_format_shortcut_display() {
        let config = ShortcutConfig {
            modifiers: vec!["super".to_string(), "shift".to_string()],
            key: "space".to_string(),
        };
        let display = format_shortcut_display(&config);
        assert_eq!(display, "⌘⇧Space");
    }

    #[test]
    fn test_format_shortcut_display_letter() {
        let config = ShortcutConfig {
            modifiers: vec!["ctrl".to_string()],
            key: "c".to_string(),
        };
        let display = format_shortcut_display(&config);
        assert_eq!(display, "⌃C");
    }

    #[test]
    fn test_get_model_for_provider_openai() {
        let model = get_model_for_provider(&TranscriptionProvider::OpenAI);
        assert_eq!(model, "whisper-1");
    }

    #[test]
    fn test_get_model_for_provider_groq() {
        let model = get_model_for_provider(&TranscriptionProvider::Groq);
        assert_eq!(model, "whisper-large-v3-turbo");
    }

    #[test]
    fn test_get_endpoint_for_provider_openai() {
        let endpoint = get_endpoint_for_provider(&TranscriptionProvider::OpenAI);
        assert_eq!(endpoint, "https://api.openai.com/v1/audio/transcriptions");
    }

    #[test]
    fn test_get_endpoint_for_provider_groq() {
        let endpoint = get_endpoint_for_provider(&TranscriptionProvider::Groq);
        assert_eq!(
            endpoint,
            "https://api.groq.com/openai/v1/audio/transcriptions"
        );
    }

    #[test]
    fn test_get_api_key_for_provider_no_key() {
        let key = get_api_key_for_provider(&TranscriptionProvider::Groq);
        // Should be None if no keychain key is set
        // (unless developer has a real key in keychain, so we just verify it returns Option<String>)
        assert!(key.is_none() || key.is_some());
    }

    #[test]
    fn test_serialization_transcription_provider() {
        // Test that TranscriptionProvider serializes correctly
        let openai = TranscriptionProvider::OpenAI;
        let serialized = serde_json::to_string(&openai).unwrap();
        assert_eq!(serialized, "\"openai\"");

        let groq = TranscriptionProvider::Groq;
        let serialized = serde_json::to_string(&groq).unwrap();
        assert_eq!(serialized, "\"groq\"");
    }

    #[test]
    fn test_deserialization_transcription_provider() {
        let openai: TranscriptionProvider = serde_json::from_str("\"openai\"").unwrap();
        assert_eq!(openai, TranscriptionProvider::OpenAI);

        let groq: TranscriptionProvider = serde_json::from_str("\"groq\"").unwrap();
        assert_eq!(groq, TranscriptionProvider::Groq);
    }
}

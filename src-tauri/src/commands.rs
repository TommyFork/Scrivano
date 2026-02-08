use crate::keychain;
use crate::paste;
use crate::settings::{self, ShortcutConfig, TranscriptionProvider};
use crate::{AppState, SettingsState, ShortcutSettings, MAIN_WINDOW_WIDTH};
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use tauri::{AppHandle, Manager};
use tauri_plugin_global_shortcut::{GlobalShortcutExt, Shortcut};

#[tauri::command]
pub fn get_transcription(state: tauri::State<'_, Mutex<AppState>>) -> String {
    state.lock().last_transcription.clone()
}

#[tauri::command]
pub fn get_recording_status(state: tauri::State<'_, Mutex<AppState>>) -> bool {
    state.lock().is_recording
}

#[tauri::command]
pub fn copy_to_clipboard(text: String) -> Result<(), String> {
    paste::copy_to_clipboard(&text)
}

#[tauri::command]
pub fn paste_text(text: String) -> Result<(), String> {
    paste::set_clipboard_and_paste(&text)
}

#[tauri::command]
pub fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
pub fn resize_window(app: AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let width = MAIN_WINDOW_WIDTH;
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));

        // Clamp position to screen bounds after resize
        #[cfg(target_os = "macos")]
        {
            use core_graphics::display::CGDisplay;
            if let Ok(pos) = window.outer_position() {
                let bounds = CGDisplay::main().bounds();
                let screen_w = bounds.size.width as i32;
                let screen_h = bounds.size.height as i32;
                let width_i32 = (width as i32).max(0);
                let height_i32 = (height as i32).max(0);
                let x = pos.x.max(0).min(screen_w.saturating_sub(width_i32));
                let y = pos.y.max(0).min(screen_h.saturating_sub(height_i32));
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ShortcutInfo {
    pub modifiers: Vec<String>,
    pub key: String,
    pub display: String,
}

#[tauri::command]
pub fn get_shortcut(state: tauri::State<'_, Mutex<ShortcutSettings>>) -> ShortcutInfo {
    let config = state.lock().config.clone();
    ShortcutInfo {
        modifiers: config.modifiers.clone(),
        key: config.key.clone(),
        display: settings::format_shortcut_display(&config),
    }
}

#[tauri::command]
pub fn set_shortcut(
    app: AppHandle,
    modifiers: Vec<String>,
    key: String,
) -> Result<ShortcutInfo, String> {
    // Check for multi-key shortcuts (not supported by global shortcut API)
    if key.contains('+') {
        return Err("Multi-key shortcuts (e.g., R+L) are not supported. Use modifier keys (⌘⇧⌃⌥) with a single key.".to_string());
    }

    // Validate the key
    if settings::parse_key(&key).is_none() {
        return Err(format!("Invalid key: {}", key));
    }

    let new_config = ShortcutConfig {
        modifiers: modifiers.clone(),
        key: key.clone(),
    };

    // Build the new shortcut
    let parsed_modifiers = settings::parse_modifiers(&modifiers);
    let parsed_key = settings::parse_key(&key).unwrap();
    let mods = if parsed_modifiers.is_empty() {
        None
    } else {
        Some(parsed_modifiers)
    };
    let new_shortcut = Shortcut::new(mods, parsed_key);

    // Unregister the old shortcut
    {
        let state = app.state::<Mutex<ShortcutSettings>>();
        let guard = state.lock();
        if let Some(old_shortcut) = &guard.current_shortcut {
            let _ = app.global_shortcut().unregister(*old_shortcut);
        }
    }

    // Register the new shortcut
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    // Update the state
    {
        let state = app.state::<Mutex<ShortcutSettings>>();
        let mut guard = state.lock();
        guard.current_shortcut = Some(new_shortcut);
        guard.config = new_config.clone();
    }

    // Save to settings file
    let mut full_settings = settings::load_settings();
    full_settings.shortcut = new_config.clone();
    settings::save_settings(&full_settings)?;

    Ok(ShortcutInfo {
        modifiers,
        key,
        display: settings::format_shortcut_display(&new_config),
    })
}

// ============================================================================
// API Key and Provider Commands
// ============================================================================

#[derive(Serialize, Deserialize, Clone)]
pub struct ApiKeyStatus {
    openai_configured: bool,
    groq_configured: bool,
    openai_source: Option<String>,
    groq_source: Option<String>,
}

fn get_api_key_status_internal() -> ApiKeyStatus {
    let openai_from_keychain = keychain::has_api_key("openai");
    let openai_from_env = std::env::var("OPENAI_API_KEY").is_ok();
    let groq_from_keychain = keychain::has_api_key("groq");
    let groq_from_env = std::env::var("GROQ_API_KEY").is_ok();

    ApiKeyStatus {
        openai_configured: openai_from_keychain || openai_from_env,
        groq_configured: groq_from_keychain || groq_from_env,
        openai_source: if openai_from_keychain {
            Some("keychain".to_string())
        } else if openai_from_env {
            Some("env".to_string())
        } else {
            None
        },
        groq_source: if groq_from_keychain {
            Some("keychain".to_string())
        } else if groq_from_env {
            Some("env".to_string())
        } else {
            None
        },
    }
}

#[tauri::command]
pub fn get_api_key_status() -> ApiKeyStatus {
    get_api_key_status_internal()
}

#[tauri::command]
pub fn set_api_key(provider: String, api_key: String) -> Result<ApiKeyStatus, String> {
    let provider_key = match provider.to_lowercase().as_str() {
        "openai" => "openai",
        "groq" => "groq",
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    let trimmed_key = api_key.trim();

    if trimmed_key.is_empty() {
        // Delete the key from keychain
        keychain::delete_api_key(provider_key)?;
    } else {
        // Validate API key format
        match provider_key {
            "openai" => {
                if !trimmed_key.starts_with("sk-") {
                    return Err("OpenAI API keys should start with 'sk-'".to_string());
                }
            }
            "groq" => {
                if !trimmed_key.starts_with("gsk_") {
                    return Err("Groq API keys should start with 'gsk_'".to_string());
                }
            }
            _ => {}
        }

        // Store the key in keychain
        keychain::store_api_key(provider_key, trimmed_key)?;
    }

    Ok(get_api_key_status_internal())
}

#[derive(Serialize, Deserialize, Clone)]
pub struct ProviderInfo {
    id: String,
    name: String,
    model: String,
    available: bool,
}

#[tauri::command]
pub fn get_available_providers() -> Vec<ProviderInfo> {
    vec![
        ProviderInfo {
            id: "openai".to_string(),
            name: "OpenAI Whisper".to_string(),
            model: "whisper-1".to_string(),
            available: settings::get_api_key_for_provider(&TranscriptionProvider::OpenAI).is_some(),
        },
        ProviderInfo {
            id: "groq".to_string(),
            name: "Groq Whisper".to_string(),
            model: "whisper-large-v3-turbo".to_string(),
            available: settings::get_api_key_for_provider(&TranscriptionProvider::Groq).is_some(),
        },
    ]
}

#[derive(Serialize, Deserialize, Clone)]
pub struct TranscriptionSettings {
    provider: String,
    model: String,
}

#[tauri::command]
pub fn get_transcription_settings(
    state: tauri::State<'_, Mutex<SettingsState>>,
) -> TranscriptionSettings {
    let settings = &state.lock().settings;
    TranscriptionSettings {
        provider: match settings.transcription.provider {
            TranscriptionProvider::OpenAI => "openai".to_string(),
            TranscriptionProvider::Groq => "groq".to_string(),
        },
        model: settings::get_model_for_provider(&settings.transcription.provider).to_string(),
    }
}

#[tauri::command]
pub fn set_transcription_provider(
    provider: String,
    state: tauri::State<'_, Mutex<SettingsState>>,
) -> Result<TranscriptionSettings, String> {
    let mut state_guard = state.lock();

    let new_provider = match provider.to_lowercase().as_str() {
        "openai" => TranscriptionProvider::OpenAI,
        "groq" => TranscriptionProvider::Groq,
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    // Validate that the provider has an API key configured
    if settings::get_api_key_for_provider(&new_provider).is_none() {
        return Err(format!("No API key configured for {}", provider));
    }

    state_guard.settings.transcription.provider = new_provider.clone();
    settings::save_settings(&state_guard.settings)?;

    Ok(TranscriptionSettings {
        provider,
        model: settings::get_model_for_provider(&new_provider).to_string(),
    })
}

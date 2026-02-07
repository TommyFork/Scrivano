mod audio;
mod keychain;
mod paste;
mod settings;
mod transcription;

use audio::RecordingHandle;
use serde::{Deserialize, Serialize};
use settings::{Settings, ShortcutConfig, TranscriptionProvider};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    ActivationPolicy, AppHandle, Emitter, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct AppState {
    pub last_transcription: String,
    pub is_recording: bool,
}

struct RecorderState {
    handle: Option<RecordingHandle>,
}

struct ShortcutStateInner {
    current_shortcut: Option<Shortcut>,
    config: ShortcutConfig,
}

struct SettingsState {
    settings: Settings,
}

#[tauri::command]
fn get_transcription(state: tauri::State<'_, Mutex<AppState>>) -> String {
    state.lock().unwrap().last_transcription.clone()
}

#[tauri::command]
fn get_recording_status(state: tauri::State<'_, Mutex<AppState>>) -> bool {
    state.lock().unwrap().is_recording
}

#[tauri::command]
fn copy_to_clipboard(text: String) -> Result<(), String> {
    paste::copy_to_clipboard(&text)
}

#[tauri::command]
fn paste_text(text: String) -> Result<(), String> {
    paste::set_clipboard_and_paste(&text)
}

#[derive(Serialize, Deserialize, Clone)]
struct ShortcutInfo {
    modifiers: Vec<String>,
    key: String,
    display: String,
}

#[tauri::command]
fn get_shortcut(state: tauri::State<'_, Mutex<ShortcutStateInner>>) -> ShortcutInfo {
    let config = state.lock().unwrap().config.clone();
    ShortcutInfo {
        modifiers: config.modifiers.clone(),
        key: config.key.clone(),
        display: settings::format_shortcut_display(&config),
    }
}

#[tauri::command]
fn set_shortcut(
    app: AppHandle,
    modifiers: Vec<String>,
    key: String,
) -> Result<ShortcutInfo, String> {
    // Validate the key
    if settings::parse_key(&key).is_none() {
        return Err(format!("Invalid key: {}", key));
    }

    // Validate at least one modifier
    if modifiers.is_empty() {
        return Err("At least one modifier key is required".to_string());
    }

    let new_config = ShortcutConfig {
        modifiers: modifiers.clone(),
        key: key.clone(),
    };

    // Build the new shortcut
    let parsed_modifiers = settings::parse_modifiers(&modifiers);
    let parsed_key = settings::parse_key(&key).unwrap();
    let new_shortcut = Shortcut::new(Some(parsed_modifiers), parsed_key);

    // Unregister the old shortcut
    {
        let shortcut_state = app.state::<Mutex<ShortcutStateInner>>();
        let state = shortcut_state.lock().unwrap();
        if let Some(old_shortcut) = &state.current_shortcut {
            let _ = app.global_shortcut().unregister(old_shortcut.clone());
        }
    }

    // Register the new shortcut
    app.global_shortcut()
        .register(new_shortcut.clone())
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    // Update the state
    {
        let shortcut_state = app.state::<Mutex<ShortcutStateInner>>();
        let mut state = shortcut_state.lock().unwrap();
        state.current_shortcut = Some(new_shortcut);
        state.config = new_config.clone();
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
struct ApiKeyStatus {
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
fn get_api_key_status() -> ApiKeyStatus {
    get_api_key_status_internal()
}

#[tauri::command]
fn set_api_key(provider: String, api_key: String) -> Result<ApiKeyStatus, String> {
    let provider_key = match provider.to_lowercase().as_str() {
        "openai" => "openai",
        "groq" => "groq",
        _ => return Err(format!("Unknown provider: {}", provider)),
    };

    if api_key.trim().is_empty() {
        // Delete the key from keychain
        keychain::delete_api_key(provider_key)?;
    } else {
        // Store the key in keychain
        keychain::store_api_key(provider_key, api_key.trim())?;
    }

    Ok(get_api_key_status_internal())
}

#[derive(Serialize, Deserialize, Clone)]
struct ProviderInfo {
    id: String,
    name: String,
    model: String,
    available: bool,
}

#[tauri::command]
fn get_available_providers() -> Vec<ProviderInfo> {
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
struct TranscriptionSettings {
    provider: String,
    model: String,
}

#[tauri::command]
fn get_transcription_settings(
    state: tauri::State<'_, Mutex<SettingsState>>,
) -> TranscriptionSettings {
    let settings = &state.lock().unwrap().settings;
    TranscriptionSettings {
        provider: match settings.transcription.provider {
            TranscriptionProvider::OpenAI => "openai".to_string(),
            TranscriptionProvider::Groq => "groq".to_string(),
        },
        model: settings::get_model_for_provider(&settings.transcription.provider).to_string(),
    }
}

#[tauri::command]
fn set_transcription_provider(
    provider: String,
    state: tauri::State<'_, Mutex<SettingsState>>,
) -> Result<TranscriptionSettings, String> {
    let mut state_guard = state.lock().unwrap();

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

// ============================================================================
// Window and Recording Helpers
// ============================================================================

fn show_window_at_position(window: &tauri::WebviewWindow, x: i32, y: i32) {
    let window_width = 320;
    let adjusted_x = (x - (window_width / 2)).max(10);
    let _ = window.show();
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        adjusted_x, y,
    )));
    let _ = window.set_focus();
}

async fn handle_recording_stop(app: AppHandle, audio_path: std::path::PathBuf) {
    // Get settings and API key for the selected provider
    let (api_key, endpoint, model) = {
        let settings_state = app.state::<Mutex<SettingsState>>();
        let settings = &settings_state.lock().unwrap().settings;

        let provider = &settings.transcription.provider;
        let api_key = settings::get_api_key_for_provider(provider);
        let endpoint = settings::get_endpoint_for_provider(provider);
        let model = settings::get_model_for_provider(provider);

        (api_key, endpoint, model)
    };

    let api_key = match api_key {
        Some(key) => key,
        None => {
            let err = "No API key configured. Please add an API key in Settings.";
            eprintln!("API key error: {}", err);
            let _ = app.emit("error", err);
            return;
        }
    };

    let _ = app.emit("transcription-status", "Transcribing...");

    let request = transcription::TranscriptionRequest {
        audio_path: &audio_path,
        api_key: &api_key,
        endpoint,
        model,
    };

    match transcription::transcribe_audio(request).await {
        Ok(text) => {
            app.state::<Mutex<AppState>>()
                .lock()
                .unwrap()
                .last_transcription = text.clone();
            let _ = app.emit("transcription", text.clone());

            if let Err(e) = paste::set_clipboard_and_paste(&text) {
                eprintln!("Failed to paste: {}", e);
                let _ = app.emit("error", format!("Failed to paste: {}", e));
            }
        }
        Err(e) => {
            eprintln!("Transcription failed: {}", e);
            let _ = app.emit("error", format!("Transcription failed: {}", e));
        }
    }

    let _ = std::fs::remove_file(audio_path);
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Load settings at startup
    let loaded_settings = settings::load_settings();
    let shortcut_config = loaded_settings.shortcut.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(RecorderState { handle: None }))
        .manage(Mutex::new(ShortcutStateInner {
            current_shortcut: None,
            config: shortcut_config.clone(),
        }))
        .manage(Mutex::new(SettingsState {
            settings: loaded_settings,
        }))
        .setup(move |app| {
            #[cfg(target_os = "macos")]
            app.set_activation_policy(ActivationPolicy::Accessory);

            // Hide window when it loses focus (click outside)
            if let Some(window) = app.get_webview_window("main") {
                let w = window.clone();
                window.on_window_event(move |event| {
                    if let tauri::WindowEvent::Focused(false) = event {
                        let _ = w.hide();
                    }
                });
            }

            let quit = MenuItemBuilder::with_id("quit", "Quit Scrivano").build(app)?;
            let menu = MenuBuilder::new(app).item(&quit).build()?;

            let _tray = TrayIconBuilder::new()
                .icon(app.default_window_icon().unwrap().clone())
                .menu(&menu)
                .show_menu_on_left_click(false)
                .on_menu_event(|app, event| {
                    if event.id() == "quit" {
                        app.exit(0);
                    }
                })
                .on_tray_icon_event(|tray, event| {
                    use tauri::tray::{MouseButtonState, TrayIconEvent};
                    if let TrayIconEvent::Click {
                        rect,
                        button_state: MouseButtonState::Down,
                        ..
                    } = event
                    {
                        if let Some(window) = tray.app_handle().get_webview_window("main") {
                            if window.is_visible().unwrap_or(false) {
                                let _ = window.hide();
                            } else {
                                let (x, y, h) = match (&rect.position, &rect.size) {
                                    (tauri::Position::Physical(p), tauri::Size::Physical(s)) => {
                                        (p.x, p.y, s.height as i32)
                                    }
                                    (tauri::Position::Logical(p), tauri::Size::Logical(s)) => {
                                        (p.x as i32, p.y as i32, s.height as i32)
                                    }
                                    _ => (100, 0, 30),
                                };
                                show_window_at_position(&window, x, y + h);
                            }
                        }
                    }
                })
                .build(app)?;

            // Build shortcut from loaded config
            let parsed_modifiers = settings::parse_modifiers(&shortcut_config.modifiers);
            let parsed_key = settings::parse_key(&shortcut_config.key).unwrap_or(Code::Space);
            let shortcut = Shortcut::new(Some(parsed_modifiers), parsed_key);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(|app, _shortcut_ref, event| {
                        // Handle any registered shortcut (we only register one for recording)
                        let recorder_state = app.state::<Mutex<RecorderState>>();
                        let app_state = app.state::<Mutex<AppState>>();

                        match event.state() {
                            ShortcutState::Pressed => match audio::start_recording() {
                                Ok(handle) => {
                                    recorder_state.lock().unwrap().handle = Some(handle);
                                    app_state.lock().unwrap().is_recording = true;
                                    let _ = app.emit("recording-status", true);
                                }
                                Err(e) => {
                                    eprintln!("Failed to start recording: {}", e);
                                    let _ = app
                                        .emit("error", format!("Failed to start recording: {}", e));
                                }
                            },
                            ShortcutState::Released => {
                                let handle = recorder_state.lock().unwrap().handle.take();
                                app_state.lock().unwrap().is_recording = false;
                                let _ = app.emit("recording-status", false);

                                if let Some(handle) = handle {
                                    let app_clone = app.clone();
                                    std::thread::spawn(move || match handle.stop() {
                                        Ok(path) => {
                                            tauri::async_runtime::block_on(handle_recording_stop(
                                                app_clone, path,
                                            ));
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to stop recording: {}", e);
                                            let _ = app_clone.emit(
                                                "error",
                                                format!("Failed to stop recording: {}", e),
                                            );
                                        }
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            // Register the shortcut and store it in state
            app.global_shortcut().register(shortcut.clone())?;
            {
                let shortcut_state = app.state::<Mutex<ShortcutStateInner>>();
                shortcut_state.lock().unwrap().current_shortcut = Some(shortcut);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_transcription,
            get_recording_status,
            copy_to_clipboard,
            paste_text,
            get_shortcut,
            set_shortcut,
            get_api_key_status,
            set_api_key,
            get_available_providers,
            get_transcription_settings,
            set_transcription_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

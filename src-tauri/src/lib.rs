mod audio;
mod cursor;
mod keychain;
mod paste;
mod settings;
mod transcription;

use audio::RecordingHandle;
use serde::{Deserialize, Serialize};
use settings::{Settings, ShortcutConfig, TranscriptionProvider};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::ActivationPolicy;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Listener, Manager, WebviewUrl, WebviewWindowBuilder,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct AppState {
    pub last_transcription: String,
    pub is_recording: bool,
}

struct RecorderState {
    handle: Option<RecordingHandle>,
    stop_polling: Arc<AtomicBool>,
    original_app: Option<String>,
}

#[derive(Clone)]
struct TrayIcons {
    idle_1x: tauri::image::Image<'static>,
    idle_2x: tauri::image::Image<'static>,
    recording_1x: tauri::image::Image<'static>,
    recording_2x: tauri::image::Image<'static>,
}

impl TrayIcons {
    fn select(&self, app: &AppHandle, recording: bool) -> tauri::image::Image<'static> {
        let scale_factor = app
            .get_webview_window("main")
            .and_then(|window| window.scale_factor().ok())
            .unwrap_or(1.0);
        let use_retina = scale_factor >= 2.0;

        match (recording, use_retina) {
            (false, false) => self.idle_1x.clone(),
            (false, true) => self.idle_2x.clone(),
            (true, false) => self.recording_1x.clone(),
            (true, true) => self.recording_2x.clone(),
        }
    }
}

struct ShortcutSettings {
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

#[tauri::command]
fn hide_window(window: tauri::Window) {
    let _ = window.hide();
}

#[tauri::command]
fn resize_window(app: AppHandle, height: f64) {
    if let Some(window) = app.get_webview_window("main") {
        let width = 320.0;
        let _ = window.set_size(tauri::Size::Logical(tauri::LogicalSize::new(width, height)));

        // Clamp position to screen bounds after resize.
        // outer_position() returns physical pixels, while CGDisplay bounds
        // are in logical points.  Multiply by the scale factor so we compare
        // apples to apples – otherwise on Retina (2×) displays the window
        // gets dragged toward the centre of the screen.
        #[cfg(target_os = "macos")]
        {
            use core_graphics::display::CGDisplay;
            if let Ok(pos) = window.outer_position() {
                let scale = window.scale_factor().unwrap_or(1.0);
                let bounds = CGDisplay::main().bounds();
                let screen_w = (bounds.size.width * scale) as i32;
                let screen_h = (bounds.size.height * scale) as i32;
                let width_phys = (width * scale) as i32;
                let height_phys = (height * scale) as i32;
                let x = pos.x.max(0).min(screen_w.saturating_sub(width_phys));
                let y = pos.y.max(0).min(screen_h.saturating_sub(height_phys));
                let _ = window.set_position(tauri::Position::Physical(
                    tauri::PhysicalPosition::new(x, y),
                ));
            }
        }
    }
}

#[derive(Serialize, Deserialize, Clone)]
struct ShortcutInfo {
    modifiers: Vec<String>,
    key: String,
    display: String,
}

#[tauri::command]
fn get_shortcut(state: tauri::State<'_, Mutex<ShortcutSettings>>) -> ShortcutInfo {
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
        let shortcut_state = app.state::<Mutex<ShortcutSettings>>();
        let state = shortcut_state.lock().unwrap();
        if let Some(old_shortcut) = &state.current_shortcut {
            let _ = app.global_shortcut().unregister(*old_shortcut);
        }
    }

    // Register the new shortcut
    app.global_shortcut()
        .register(new_shortcut)
        .map_err(|e| format!("Failed to register shortcut: {}", e))?;

    // Update the state
    {
        let shortcut_state = app.state::<Mutex<ShortcutSettings>>();
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

/// Create or reuse the indicator window at the mouse cursor position.
/// Returns (window, is_new_window). When is_new_window is false, the
/// existing window was repositioned and the ready handshake can be skipped.
fn create_indicator_window(app: &AppHandle) -> (Option<tauri::WebviewWindow>, bool) {
    let width: i32 = 36;
    let height: i32 = 36;

    let (mx, my) = cursor::get_mouse_position().unwrap_or((100, 100));

    // Place above-right of mouse cursor
    let pos_x = mx + 8;
    let pos_y = if my - height - 12 >= 4 {
        my - height - 12
    } else {
        my + 4
    };

    // Clamp to screen bounds
    let (pos_x, pos_y) = {
        use core_graphics::display::CGDisplay;
        let bounds = CGDisplay::main().bounds();
        let screen_w = bounds.size.width as i32;
        let screen_h = bounds.size.height as i32;

        (
            pos_x.max(4).min(screen_w - width - 4),
            pos_y.max(4).min(screen_h - height - 4),
        )
    };

    // Reuse existing indicator window if it exists (avoids destroy/create race)
    if let Some(existing) = app.get_webview_window("indicator") {
        let _ = existing.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
            pos_x, pos_y,
        )));
        let _ = existing.show();
        let _ = app.emit("indicator-state", "recording");
        return (Some(existing), false);
    }

    let url = WebviewUrl::App("indicator.html".into());

    match WebviewWindowBuilder::new(app, "indicator", url)
        .title("Recording")
        .inner_size(width as f64, height as f64)
        .position(pos_x as f64, pos_y as f64)
        .decorations(false)
        .transparent(true)
        .shadow(false)
        .always_on_top(true)
        .skip_taskbar(true)
        .resizable(false)
        .focused(false)
        .visible(true)
        .build()
    {
        Ok(window) => (Some(window), true),
        Err(e) => {
            eprintln!("Failed to create indicator window: {}", e);
            (None, false)
        }
    }
}

fn destroy_indicator_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("indicator") {
        let _ = window.destroy();
    }
}

async fn handle_recording_stop(
    app: AppHandle,
    audio_path: std::path::PathBuf,
    original_app: Option<String>,
) {
    // Helper: check if a NEW recording is in progress (our indicator may have been reused).
    // When true, we must not modify the indicator or paste — the user is re-recording.
    let new_recording_active =
        || -> bool { app.state::<Mutex<AppState>>().lock().unwrap().is_recording };

    // Update indicator to processing state (only if no new recording started)
    if !new_recording_active() {
        eprintln!("[Scrivano] Emitting indicator-state: processing");
        let _ = app.emit("indicator-state", "processing");
    }

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
            if !new_recording_active() {
                destroy_indicator_window(&app);
            }
            return;
        }
    };

    // Log audio file info for debugging
    if let Ok(meta) = std::fs::metadata(&audio_path) {
        let size_kb = meta.len() as f64 / 1024.0;
        eprintln!("[Scrivano] Audio file: {:.1} KB", size_kb);
    }

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

            // Only hide indicator and paste if no new recording started
            if !new_recording_active() {
                destroy_indicator_window(&app);

                // Paste to the original app (this will re-activate it).
                // The paste functions save and restore the clipboard so the
                // transcription text does not remain in the user's clipboard.
                let paste_result = if let Some(ref bundle_id) = original_app {
                    paste::paste_to_app(&text, bundle_id)
                } else {
                    paste::set_clipboard_and_paste(&text)
                };

                if let Err(e) = paste_result {
                    eprintln!("Failed to paste: {}", e);
                    let _ = app.emit("error", format!("Failed to paste: {}", e));
                }
            } else {
                eprintln!("[Scrivano] Skipping paste — new recording in progress");
            }
        }
        Err(e) => {
            eprintln!("Transcription failed: {}", e);
            let _ = app.emit("error", format!("Transcription failed: {}", e));
            if !new_recording_active() {
                destroy_indicator_window(&app);
            }
        }
    }

    let _ = std::fs::remove_file(audio_path);
}

pub fn run() {
    // Load settings at startup
    let loaded_settings = settings::load_settings();
    let shortcut_config = loaded_settings.shortcut.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(RecorderState {
            handle: None,
            stop_polling: Arc::new(AtomicBool::new(false)),
            original_app: None,
        }))
        .manage(Mutex::new(ShortcutSettings {
            current_shortcut: None,
            config: shortcut_config.clone(),
        }))
        .manage(Mutex::new(SettingsState {
            settings: loaded_settings,
        }))
        .setup(move |app| {
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

            let tray_icons = TrayIcons {
                idle_1x: tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray-idle-22.png"
                ))
                .expect("Failed to load tray idle 22px icon"),
                idle_2x: tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray-idle-44.png"
                ))
                .expect("Failed to load tray idle 44px icon"),
                recording_1x: tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray-recording-22.png"
                ))
                .expect("Failed to load tray recording 22px icon"),
                recording_2x: tauri::image::Image::from_bytes(include_bytes!(
                    "../icons/tray-recording-44.png"
                ))
                .expect("Failed to load tray recording 44px icon"),
            };

            let tray = TrayIconBuilder::new()
                .icon(tray_icons.select(app.handle(), false))
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

            let tray_handle = tray.clone();
            let tray_icons_for_handler = tray_icons.clone();

            // Build shortcut from loaded config
            let parsed_modifiers = settings::parse_modifiers(&shortcut_config.modifiers);
            let parsed_key = settings::parse_key(&shortcut_config.key).unwrap_or(Code::Space);
            let mods = if parsed_modifiers.is_empty() {
                None
            } else {
                Some(parsed_modifiers)
            };
            let shortcut = Shortcut::new(mods, parsed_key);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, _shortcut_ref, event| {
                        // Handle any registered shortcut (we only register one for recording)
                        //
                        // Lock ordering: always acquire recorder_state before app_state
                        // to prevent deadlocks. handle_recording_stop only locks app_state.
                        let recorder_state = app.state::<Mutex<RecorderState>>();
                        let app_state = app.state::<Mutex<AppState>>();

                        let set_tray_icon = |recording: bool| {
                            let icon = tray_icons_for_handler.select(app, recording);
                            let _ = tray_handle.set_icon(Some(icon));
                        };

                        match event.state() {
                            ShortcutState::Pressed => {
                                // Save the frontmost app for later focus restoration.
                                // Filter out our own bundle ID — when running as a .app,
                                // the global shortcut can briefly activate Scrivano, and
                                // trying to send AppleScript to ourselves deadlocks.
                                let own_bundle_id = "com.tommyross.scrivano";
                                let original_app = cursor::get_frontmost_bundle_id()
                                    .filter(|id| id != own_bundle_id);

                                match audio::start_recording() {
                                    Ok(handle) => {

                                        // Create or reuse indicator window at mouse position.
                                        // If reused, listeners are already mounted (skip ready handshake).
                                        // Window ref is unused — Tauri owns the window lifecycle internally.
                                        let (_indicator_window, is_new_window) = create_indicator_window(app);

                                        // Register the ready listener BEFORE the window can emit.
                                        // If reusing, mark ready immediately — the window is already live.
                                        let ready = Arc::new(AtomicBool::new(!is_new_window));
                                        let ready_clone = Arc::clone(&ready);
                                        let listener_id = app.listen("indicator-ready", move |_| {
                                            ready_clone.store(true, Ordering::Relaxed);
                                        });

                                        // Immediately re-activate the original app so focus isn't stolen.
                                        // Use the fast variant (no 50ms sleep) since we're not pasting.
                                        if let Some(ref bundle_id) = original_app {
                                            let _ = paste::activate_app_fast(bundle_id);
                                        }

                                        // Get the audio levels Arc before storing the handle
                                        let audio_levels_arc = handle.get_audio_levels_arc();

                                        // Reset stop flag and store the handle
                                        let stop_flag = Arc::new(AtomicBool::new(false));
                                        {
                                            let mut state = recorder_state.lock().unwrap();
                                            state.stop_polling = Arc::clone(&stop_flag);
                                            state.handle = Some(handle);
                                            state.original_app = original_app;
                                        }

                                        // Start polling thread for audio levels.
                                        // Wait for the indicator window to signal it's ready
                                        // before emitting events, with a timeout fallback.
                                        //
                                        // NOTE: This thread is not joined — it exits when
                                        // stop_flag is set (within ~50ms). Each recording gets
                                        // a new Arc<AtomicBool>, so old threads always see
                                        // their own flag go true and exit cleanly.
                                        let app_clone = app.clone();

                                        let app_for_unlisten = app.clone();
                                        std::thread::spawn(move || {
                                            // Wait up to 3s for indicator to signal ready
                                            let start = std::time::Instant::now();
                                            while !ready.load(Ordering::Relaxed)
                                                && start.elapsed().as_millis() < 3000
                                                && !stop_flag.load(Ordering::Relaxed)
                                            {
                                                std::thread::sleep(std::time::Duration::from_millis(20));
                                            }
                                            if ready.load(Ordering::Relaxed) {
                                                eprintln!("[Scrivano] Indicator signaled ready after {}ms", start.elapsed().as_millis());
                                            } else {
                                                eprintln!("[Scrivano] Indicator ready timeout after {}ms", start.elapsed().as_millis());
                                            }
                                            app_for_unlisten.unlisten(listener_id);

                                            while !stop_flag.load(Ordering::Relaxed) {
                                                let levels =
                                                    audio_levels_arc.lock().unwrap().clone();
                                                let _ = app_clone.emit("audio-levels", &levels);
                                                std::thread::sleep(
                                                    std::time::Duration::from_millis(50),
                                                );
                                            }
                                        });

                                        app_state.lock().unwrap().is_recording = true;
                                        set_tray_icon(true);
                                        let _ = app.emit("recording-status", true);
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to start recording: {}", e);
                                        let _ = app.emit(
                                            "error",
                                            format!("Failed to start recording: {}", e),
                                        );
                                    }
                                }
                            }
                            ShortcutState::Released => {
                                // Stop audio level polling and get original app
                                let original_app;
                                {
                                    let state = recorder_state.lock().unwrap();
                                    state.stop_polling.store(true, Ordering::Relaxed);
                                    original_app = state.original_app.clone();
                                }

                                let handle = recorder_state.lock().unwrap().handle.take();
                                app_state.lock().unwrap().is_recording = false;
                                set_tray_icon(false);
                                let _ = app.emit("recording-status", false);

                                if let Some(handle) = handle {
                                    let app_clone = app.clone();
                                    std::thread::spawn(move || match handle.stop() {
                                        Ok(path) => {
                                            tauri::async_runtime::block_on(handle_recording_stop(
                                                app_clone,
                                                path,
                                                original_app,
                                            ));
                                        }
                                        Err(e) => {
                                            eprintln!("Failed to stop recording: {}", e);
                                            let _ = app_clone.emit(
                                                "error",
                                                format!("Failed to stop recording: {}", e),
                                            );
                                            destroy_indicator_window(&app_clone);
                                        }
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            // Prompt for accessibility permission once at startup
            cursor::prompt_accessibility_once();

            // Register the shortcut and store it in state
            app.global_shortcut().register(shortcut)?;
            {
                let shortcut_state = app.state::<Mutex<ShortcutSettings>>();
                shortcut_state.lock().unwrap().current_shortcut = Some(shortcut);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_transcription,
            get_recording_status,
            copy_to_clipboard,
            paste_text,
            hide_window,
            resize_window,
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

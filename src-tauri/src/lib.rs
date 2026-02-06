mod audio;
mod cursor;
mod paste;
mod settings;
mod transcription;

use audio::RecordingHandle;
use serde::{Deserialize, Serialize};
use settings::ShortcutConfig;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
};

#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
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

fn get_api_key() -> Result<String, String> {
    std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not set".to_string())
}

fn show_window_at_position(window: &tauri::WebviewWindow, x: i32, y: i32) {
    let window_width = 320;
    let adjusted_x = (x - (window_width / 2)).max(10);
    let _ = window.show();
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        adjusted_x, y,
    )));
    let _ = window.set_focus();
}

fn create_indicator_window(app: &AppHandle, x: i32, y: i32, is_caret: bool) -> Option<tauri::WebviewWindow> {
    // Close existing indicator window if any
    if let Some(existing) = app.get_webview_window("indicator") {
        let _ = existing.close();
    }

    // Indicator dimensions
    let width = 60.0;
    let height = 36.0;

    // Position relative to the reference point.
    // If caret: place just to the right of the caret at the same height.
    // If mouse fallback: place slightly above and to the right.
    let (pos_x, pos_y) = if is_caret {
        (x + 4, y)
    } else {
        (x + 10, y - 45)
    };

    let url = WebviewUrl::App("index.html".into());

    match WebviewWindowBuilder::new(app, "indicator", url)
        .title("Recording")
        .inner_size(width, height)
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
        Ok(window) => Some(window),
        Err(e) => {
            eprintln!("Failed to create indicator window: {}", e);
            None
        }
    }
}

fn hide_indicator_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("indicator") {
        let _ = window.close();
    }
}

async fn handle_recording_stop(
    app: AppHandle,
    audio_path: std::path::PathBuf,
    original_app: Option<String>,
) {
    // Update indicator to processing state
    let _ = app.emit("indicator-state", "processing");

    let api_key = match get_api_key() {
        Ok(key) => key,
        Err(e) => {
            eprintln!("API key error: {}", e);
            let _ = app.emit("error", e);
            hide_indicator_window(&app);
            return;
        }
    };

    let _ = app.emit("transcription-status", "Transcribing...");

    match transcription::transcribe_audio(&audio_path, &api_key).await {
        Ok(text) => {
            app.state::<Mutex<AppState>>()
                .lock()
                .unwrap()
                .last_transcription = text.clone();
            let _ = app.emit("transcription", text.clone());

            // Show success briefly
            let _ = app.emit("indicator-state", "success");

            // Hide indicator first, then paste to original app
            hide_indicator_window(&app);

            // Paste to the original app (this will re-activate it)
            let paste_result = if let Some(ref bundle_id) = original_app {
                paste::paste_to_app(&text, bundle_id)
            } else {
                paste::set_clipboard_and_paste(&text)
            };

            if let Err(e) = paste_result {
                eprintln!("Failed to paste: {}", e);
                let _ = app.emit("error", format!("Failed to paste: {}", e));
            }
        }
        Err(e) => {
            eprintln!("Transcription failed: {}", e);
            let _ = app.emit("error", format!("Transcription failed: {}", e));
            hide_indicator_window(&app);
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
        .manage(Mutex::new(RecorderState {
            handle: None,
            stop_polling: Arc::new(AtomicBool::new(false)),
            original_app: None,
        }))
        .manage(Mutex::new(ShortcutSettings {
            current_shortcut: None,
            config: shortcut_config.clone(),
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
                        let recorder_state = app.state::<Mutex<RecorderState>>();
                        let app_state = app.state::<Mutex<AppState>>();

                        let set_tray_icon = |recording: bool| {
                            let icon = tray_icons_for_handler.select(app, recording);
                            let _ = tray_handle.set_icon(Some(icon));
                        };

                        match event.state() {
                            ShortcutState::Pressed => {
                                // Save the frontmost app BEFORE we do anything that might steal focus
                                let original_app = paste::get_frontmost_app().ok();

                                match audio::start_recording() {
                                    Ok(handle) => {
                                        // Get cursor position for indicator placement
                                        let (cursor_x, cursor_y, is_caret) =
                                            match cursor::get_cursor_position() {
                                                Ok(pos) => (pos.x, pos.y, pos.is_caret),
                                                Err(_) => (100, 100, false),
                                            };

                                        // Create indicator window at cursor position
                                        let _ = create_indicator_window(app, cursor_x, cursor_y, is_caret);

                                        // Immediately re-activate the original app so focus isn't stolen.
                                        // The indicator stays visible because always_on_top is set.
                                        if let Some(ref bundle_id) = original_app {
                                            let _ = paste::activate_app(bundle_id);
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

                                        // Start polling thread for audio levels
                                        let app_clone = app.clone();
                                        std::thread::spawn(move || {
                                            // Give the indicator window time to load
                                            std::thread::sleep(std::time::Duration::from_millis(
                                                150,
                                            ));

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
                                            hide_indicator_window(&app_clone);
                                        }
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

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
            get_shortcut,
            set_shortcut,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

mod audio;
mod cursor;
mod paste;
mod transcription;

use audio::RecordingHandle;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
use tauri::{
    AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder,
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    ActivationPolicy,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

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

fn get_api_key() -> Result<String, String> {
    std::env::var("OPENAI_API_KEY")
        .map_err(|_| "OPENAI_API_KEY environment variable not set".to_string())
}

fn show_window_at_position(window: &tauri::WebviewWindow, x: i32, y: i32) {
    let window_width = 320;
    let adjusted_x = (x - (window_width / 2)).max(10);
    let _ = window.show();
    let _ = window.set_position(tauri::Position::Physical(
        tauri::PhysicalPosition::new(adjusted_x, y),
    ));
    let _ = window.set_focus();
}

fn create_indicator_window(app: &AppHandle, x: i32, y: i32) -> Option<tauri::WebviewWindow> {
    // Close existing indicator window if any
    if let Some(existing) = app.get_webview_window("indicator") {
        let _ = existing.close();
    }

    // Indicator dimensions
    let width = 60.0;
    let height = 36.0;

    // Position slightly above and to the right of cursor
    let pos_x = x + 10;
    let pos_y = y - 45;

    let url = WebviewUrl::App("index.html?window=indicator".into());

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

async fn handle_recording_stop(app: AppHandle, audio_path: std::path::PathBuf, original_app: Option<String>) {
    // Update indicator to processing state
    if let Some(indicator) = app.get_webview_window("indicator") {
        let _ = indicator.emit("indicator-state", "processing");
    }

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
            app.state::<Mutex<AppState>>().lock().unwrap().last_transcription = text.clone();
            let _ = app.emit("transcription", text.clone());

            // Show success briefly
            if let Some(indicator) = app.get_webview_window("indicator") {
                let _ = indicator.emit("indicator-state", "success");
            }

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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(RecorderState {
            handle: None,
            stop_polling: Arc::new(AtomicBool::new(false)),
            original_app: None,
        }))
        .setup(|app| {
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
                    use tauri::tray::{TrayIconEvent, MouseButtonState};
                    if let TrayIconEvent::Click { rect, button_state: MouseButtonState::Down, .. } = event {
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

            let shortcut = Shortcut::new(Some(Modifiers::SUPER | Modifiers::SHIFT), Code::Space);

            app.handle().plugin(
                tauri_plugin_global_shortcut::Builder::new()
                    .with_handler(move |app, shortcut_ref, event| {
                        if shortcut_ref != &shortcut {
                            return;
                        }

                        let recorder_state = app.state::<Mutex<RecorderState>>();
                        let app_state = app.state::<Mutex<AppState>>();

                        match event.state() {
                            ShortcutState::Pressed => {
                                // Save the frontmost app BEFORE we do anything that might steal focus
                                let original_app = paste::get_frontmost_app().ok();

                                match audio::start_recording() {
                                    Ok(handle) => {
                                        // Get cursor position for indicator placement
                                        let (cursor_x, cursor_y) = match cursor::get_cursor_position() {
                                            Ok(pos) => (pos.x, pos.y),
                                            Err(_) => (100, 100), // Fallback position
                                        };

                                        // Create indicator window at cursor position
                                        let _ = create_indicator_window(app, cursor_x, cursor_y);

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
                                            std::thread::sleep(std::time::Duration::from_millis(100));

                                            while !stop_flag.load(Ordering::Relaxed) {
                                                // Get audio levels directly from the Arc
                                                let levels = audio_levels_arc.lock().unwrap().clone();
                                                // Emit to indicator window specifically
                                                if let Some(indicator) = app_clone.get_webview_window("indicator") {
                                                    let _ = indicator.emit("audio-levels", levels);
                                                }
                                                std::thread::sleep(std::time::Duration::from_millis(50));
                                            }
                                        });

                                        app_state.lock().unwrap().is_recording = true;
                                        let _ = app.emit("recording-status", true);
                                    }
                                    Err(e) => {
                                        eprintln!("Failed to start recording: {}", e);
                                        let _ = app.emit("error", format!("Failed to start recording: {}", e));
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
                                let _ = app.emit("recording-status", false);

                                if let Some(handle) = handle {
                                    let app_clone = app.clone();
                                    std::thread::spawn(move || {
                                        match handle.stop() {
                                            Ok(path) => {
                                                tauri::async_runtime::block_on(
                                                    handle_recording_stop(app_clone, path, original_app)
                                                );
                                            }
                                            Err(e) => {
                                                eprintln!("Failed to stop recording: {}", e);
                                                let _ = app_clone.emit("error", format!("Failed to stop recording: {}", e));
                                                hide_indicator_window(&app_clone);
                                            }
                                        }
                                    });
                                }
                            }
                        }
                    })
                    .build(),
            )?;

            app.global_shortcut().register(shortcut)?;

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            get_transcription,
            get_recording_status,
            copy_to_clipboard,
            paste_text,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

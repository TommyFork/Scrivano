mod audio;
mod paste;
mod transcription;

use audio::RecordingHandle;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Manager,
};
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Modifiers, Shortcut, ShortcutState};

#[derive(Default, Serialize, Deserialize, Clone)]
pub struct AppState {
    pub last_transcription: String,
    pub is_recording: bool,
}

struct RecorderState {
    handle: Option<RecordingHandle>,
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
    let _ = window.set_position(tauri::Position::Physical(tauri::PhysicalPosition::new(
        adjusted_x, y,
    )));
    let _ = window.set_focus();
}

async fn handle_recording_stop(app: AppHandle, audio_path: std::path::PathBuf) {
    let api_key = match get_api_key() {
        Ok(key) => key,
        Err(e) => {
            eprintln!("API key error: {}", e);
            let _ = app.emit("error", e);
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_shell::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(RecorderState { handle: None }))
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

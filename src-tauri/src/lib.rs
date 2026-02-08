mod audio;
mod commands;
mod cursor;
mod keychain;
mod paste;
mod recording;
mod settings;
mod transcription;
mod window;

use audio::RecordingHandle;
use parking_lot::Mutex;
use serde::{Deserialize, Serialize};
use settings::{Settings, ShortcutConfig};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::Arc;
#[cfg(target_os = "macos")]
use tauri::ActivationPolicy;
use tauri::{
    menu::{MenuBuilder, MenuItemBuilder},
    tray::TrayIconBuilder,
    AppHandle, Emitter, Listener, Manager,
};
use tauri_plugin_global_shortcut::{Code, GlobalShortcutExt, Shortcut, ShortcutState};

// ============================================================================
// Constants
// ============================================================================

pub(crate) const MAIN_WINDOW_WIDTH: f64 = 320.0;
pub(crate) const INDICATOR_SIZE: i32 = 36;

/// Minimum time between recording stop and next start (debounce)
const RECORDING_DEBOUNCE_MS: u64 = 300;

// ============================================================================
// State Types
// ============================================================================

#[derive(Default, Serialize, Deserialize, Clone)]
pub(crate) struct AppState {
    pub last_transcription: String,
    pub is_recording: bool,
}

pub(crate) struct RecorderState {
    pub handle: Option<RecordingHandle>,
    pub stop_polling: Arc<AtomicBool>,
    pub original_app: Option<String>,
    pub last_stop_time: Option<std::time::Instant>,
}

pub(crate) struct ShortcutSettings {
    pub current_shortcut: Option<Shortcut>,
    pub config: ShortcutConfig,
}

pub(crate) struct SettingsState {
    pub settings: Settings,
}

// ============================================================================
// Tray Icons
// ============================================================================

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

// ============================================================================
// App Entry Point
// ============================================================================

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Initialize structured logging
    tracing_subscriber::fmt()
        .with_env_filter(
            tracing_subscriber::EnvFilter::from_default_env()
                .add_directive("scrivano=info".parse().unwrap()),
        )
        .init();

    // Load settings at startup
    let loaded_settings = settings::load_settings();
    let shortcut_config = loaded_settings.shortcut.clone();

    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .manage(Mutex::new(AppState::default()))
        .manage(Mutex::new(RecorderState {
            handle: None,
            stop_polling: Arc::new(AtomicBool::new(false)),
            original_app: None,
            last_stop_time: None,
        }))
        .manage(Mutex::new(ShortcutSettings {
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
            if let Some(win) = app.get_webview_window("main") {
                let w = win.clone();
                win.on_window_event(move |event| {
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
                        if let Some(win) = tray.app_handle().get_webview_window("main") {
                            if win.is_visible().unwrap_or(false) {
                                let _ = win.hide();
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
                                window::show_window_at_position(&win, x, y + h);
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
                        // Lock ordering: always acquire recorder_state before app_state
                        let recorder_state = app.state::<Mutex<RecorderState>>();
                        let app_state = app.state::<Mutex<AppState>>();

                        let set_tray_icon = |recording: bool| {
                            let icon = tray_icons_for_handler.select(app, recording);
                            let _ = tray_handle.set_icon(Some(icon));
                        };

                        match event.state() {
                            ShortcutState::Pressed => {
                                // Debounce: ignore press if too soon after last stop
                                {
                                    let state = recorder_state.lock();
                                    if let Some(last_stop) = state.last_stop_time {
                                        if last_stop.elapsed()
                                            < std::time::Duration::from_millis(
                                                RECORDING_DEBOUNCE_MS,
                                            )
                                        {
                                            tracing::debug!(
                                                "Recording debounce: ignoring press within {}ms of last stop",
                                                RECORDING_DEBOUNCE_MS
                                            );
                                            return;
                                        }
                                    }
                                }

                                // Save the frontmost app for later focus restoration.
                                let own_bundle_id = "com.tommyross.scrivano";
                                let original_app = cursor::get_frontmost_bundle_id()
                                    .filter(|id| id != own_bundle_id);

                                match audio::start_recording() {
                                    Ok(handle) => {
                                        let (_indicator_window, is_new_window) =
                                            window::create_indicator_window(app);

                                        let ready = Arc::new(AtomicBool::new(!is_new_window));
                                        let ready_clone = Arc::clone(&ready);
                                        let listener_id =
                                            app.listen("indicator-ready", move |_| {
                                                ready_clone.store(true, Ordering::Relaxed);
                                            });

                                        // Re-activate the original app so focus isn't stolen
                                        if let Some(ref bundle_id) = original_app {
                                            let _ = paste::activate_app_fast(bundle_id);
                                        }

                                        let audio_levels_arc = handle.get_audio_levels_arc();

                                        let stop_flag = Arc::new(AtomicBool::new(false));
                                        {
                                            let mut state = recorder_state.lock();
                                            state.stop_polling = Arc::clone(&stop_flag);
                                            state.handle = Some(handle);
                                            state.original_app = original_app;
                                        }

                                        // Polling thread for audio levels
                                        let app_clone = app.clone();
                                        let app_for_unlisten = app.clone();
                                        std::thread::spawn(move || {
                                            let start = std::time::Instant::now();
                                            while !ready.load(Ordering::Relaxed)
                                                && start.elapsed().as_millis() < 3000
                                                && !stop_flag.load(Ordering::Relaxed)
                                            {
                                                std::thread::sleep(
                                                    std::time::Duration::from_millis(20),
                                                );
                                            }
                                            if ready.load(Ordering::Relaxed) {
                                                tracing::debug!(
                                                    "Indicator ready after {}ms",
                                                    start.elapsed().as_millis()
                                                );
                                            } else {
                                                tracing::debug!(
                                                    "Indicator ready timeout after {}ms",
                                                    start.elapsed().as_millis()
                                                );
                                            }
                                            app_for_unlisten.unlisten(listener_id);

                                            while !stop_flag.load(Ordering::Relaxed) {
                                                let levels = audio_levels_arc.lock().clone();
                                                let _ =
                                                    app_clone.emit("audio-levels", &levels);
                                                std::thread::sleep(
                                                    std::time::Duration::from_millis(50),
                                                );
                                            }
                                        });

                                        app_state.lock().is_recording = true;
                                        set_tray_icon(true);
                                        let _ = app.emit("recording-status", true);
                                    }
                                    Err(e) => {
                                        tracing::error!("Failed to start recording: {}", e);
                                        let _ = app.emit(
                                            "error",
                                            format!("Failed to start recording: {}", e),
                                        );
                                    }
                                }
                            }
                            ShortcutState::Released => {
                                // Stop audio level polling, get original app, record stop time
                                let original_app;
                                {
                                    let mut state = recorder_state.lock();
                                    state.stop_polling.store(true, Ordering::Relaxed);
                                    original_app = state.original_app.clone();
                                    state.last_stop_time = Some(std::time::Instant::now());
                                }

                                let handle = recorder_state.lock().handle.take();
                                app_state.lock().is_recording = false;
                                set_tray_icon(false);
                                let _ = app.emit("recording-status", false);

                                if let Some(handle) = handle {
                                    let app_clone = app.clone();
                                    std::thread::spawn(move || match handle.stop() {
                                        Ok(path) => {
                                            tauri::async_runtime::block_on(
                                                recording::handle_recording_stop(
                                                    app_clone,
                                                    path,
                                                    original_app,
                                                ),
                                            );
                                        }
                                        Err(e) => {
                                            tracing::error!(
                                                "Failed to stop recording: {}",
                                                e
                                            );
                                            let _ = app_clone.emit(
                                                "error",
                                                format!("Failed to stop recording: {}", e),
                                            );
                                            window::destroy_indicator_window(&app_clone);
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
                shortcut_state.lock().current_shortcut = Some(shortcut);
            }

            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_transcription,
            commands::get_recording_status,
            commands::copy_to_clipboard,
            commands::paste_text,
            commands::hide_window,
            commands::resize_window,
            commands::get_shortcut,
            commands::set_shortcut,
            commands::get_api_key_status,
            commands::set_api_key,
            commands::get_available_providers,
            commands::get_transcription_settings,
            commands::set_transcription_provider,
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}

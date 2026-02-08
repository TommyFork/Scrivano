use crate::window::destroy_indicator_window;
use crate::{paste, settings, transcription, AppState, SettingsState};
use parking_lot::Mutex;
use tauri::{AppHandle, Emitter, Manager};

pub async fn handle_recording_stop(
    app: AppHandle,
    audio_path: std::path::PathBuf,
    original_app: Option<String>,
) {
    // Helper: check if a NEW recording is in progress (our indicator may have been reused).
    // When true, we must not modify the indicator or paste — the user is re-recording.
    let new_recording_active = || -> bool { app.state::<Mutex<AppState>>().lock().is_recording };

    // Update indicator to processing state (only if no new recording started)
    if !new_recording_active() {
        tracing::debug!("Emitting indicator-state: processing");
        let _ = app.emit("indicator-state", "processing");
    }

    // Get settings and API key for the selected provider
    let (api_key, endpoint, model) = {
        let settings_state = app.state::<Mutex<SettingsState>>();
        let settings = &settings_state.lock().settings;

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
            tracing::warn!("{}", err);
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
        tracing::info!("Audio file: {:.1} KB", size_kb);
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
            app.state::<Mutex<AppState>>().lock().last_transcription = text.clone();
            let _ = app.emit("transcription", text.clone());

            // Only hide indicator and paste if no new recording started
            if !new_recording_active() {
                destroy_indicator_window(&app);

                // Paste to the original app (this will re-activate it)
                let paste_result = if let Some(ref bundle_id) = original_app {
                    paste::paste_to_app(&text, bundle_id)
                } else {
                    paste::set_clipboard_and_paste(&text)
                };

                if let Err(e) = paste_result {
                    tracing::error!("Failed to paste: {}", e);
                    let _ = app.emit("error", format!("Failed to paste: {}", e));
                }
            } else {
                tracing::debug!("Skipping paste — new recording in progress");
            }
        }
        Err(e) => {
            tracing::error!("Transcription failed: {}", e);
            let _ = app.emit("error", format!("Transcription failed: {}", e));
            if !new_recording_active() {
                destroy_indicator_window(&app);
            }
        }
    }

    if let Err(e) = std::fs::remove_file(&audio_path) {
        tracing::warn!("Failed to delete audio file {:?}: {}", audio_path, e);
    }
}

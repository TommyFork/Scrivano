use crate::INDICATOR_SIZE;
use crate::MAIN_WINDOW_WIDTH;
use tauri::{AppHandle, Emitter, Manager, WebviewUrl, WebviewWindowBuilder};

pub fn show_window_at_position(window: &tauri::WebviewWindow, x: i32, y: i32) {
    let window_width = MAIN_WINDOW_WIDTH as i32;
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
pub fn create_indicator_window(app: &AppHandle) -> (Option<tauri::WebviewWindow>, bool) {
    let width = INDICATOR_SIZE;
    let height = INDICATOR_SIZE;

    let (mx, my) = crate::cursor::get_mouse_position().unwrap_or((100, 100));

    // Place above-right of mouse cursor
    let pos_x = mx + 8;
    let pos_y = if my - height - 12 >= 4 {
        my - height - 12
    } else {
        my + 4
    };

    // Clamp to screen bounds
    #[cfg(target_os = "macos")]
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
            tracing::error!("Failed to create indicator window: {}", e);
            (None, false)
        }
    }
}

pub fn destroy_indicator_window(app: &AppHandle) {
    if let Some(window) = app.get_webview_window("indicator") {
        let _ = window.destroy();
    }
}

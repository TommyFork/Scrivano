use std::io::Write;
use std::process::Command;

/// Read the current clipboard contents (plain text) via pbpaste.
/// Returns an empty string if the clipboard is empty or contains non-text data.
fn get_clipboard() -> String {
    Command::new("pbpaste")
        .output()
        .map(|o| String::from_utf8_lossy(&o.stdout).into_owned())
        .unwrap_or_default()
}

pub fn copy_to_clipboard(text: &str) -> Result<(), String> {
    let mut child = Command::new("pbcopy")
        .stdin(std::process::Stdio::piped())
        .spawn()
        .map_err(|e| format!("Failed to spawn pbcopy: {}", e))?;

    child
        .stdin
        .take()
        .unwrap()
        .write_all(text.as_bytes())
        .map_err(|e| format!("Failed to write to pbcopy: {}", e))?;

    child.wait().map_err(|e| format!("pbcopy failed: {}", e))?;
    Ok(())
}

/// Activate an application by its bundle identifier
pub fn activate_app(bundle_id: &str) -> Result<(), String> {
    activate_app_fast(bundle_id)?;
    // Give the app a moment to come to front before pasting
    std::thread::sleep(std::time::Duration::from_millis(50));
    Ok(())
}

/// Activate an application without waiting — use when restoring focus, not before pasting
pub fn activate_app_fast(bundle_id: &str) -> Result<(), String> {
    // Validate bundle_id to prevent AppleScript injection (should only contain [a-zA-Z0-9.-])
    if !bundle_id
        .bytes()
        .all(|b| b.is_ascii_alphanumeric() || b == b'.' || b == b'-')
    {
        return Err(format!("Invalid bundle identifier: {}", bundle_id));
    }

    let script = format!(r#"tell application id "{}" to activate"#, bundle_id);

    let output = Command::new("osascript")
        .arg("-e")
        .arg(&script)
        .output()
        .map_err(|e| format!("Failed to activate app: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "AppleScript error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

pub fn set_clipboard_and_paste(text: &str) -> Result<(), String> {
    let previous = get_clipboard();
    copy_to_clipboard(text)?;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .output()
        .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

    if !output.status.success() {
        let _ = copy_to_clipboard(&previous);
        return Err(format!(
            "AppleScript error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Give the paste a moment to complete, then restore the previous clipboard
    std::thread::sleep(std::time::Duration::from_millis(100));
    let _ = copy_to_clipboard(&previous);

    Ok(())
}

/// Paste text to a specific app (activates it first)
pub fn paste_to_app(text: &str, bundle_id: &str) -> Result<(), String> {
    let previous = get_clipboard();
    copy_to_clipboard(text)?;
    activate_app(bundle_id)?;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .output()
        .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

    if !output.status.success() {
        let _ = copy_to_clipboard(&previous);
        return Err(format!(
            "AppleScript error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    // Give the paste a moment to complete, then restore the previous clipboard
    std::thread::sleep(std::time::Duration::from_millis(100));
    let _ = copy_to_clipboard(&previous);

    Ok(())
}

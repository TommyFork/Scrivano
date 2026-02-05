use std::io::Write;
use std::process::Command;

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

pub fn set_clipboard_and_paste(text: &str) -> Result<(), String> {
    copy_to_clipboard(text)?;

    let output = Command::new("osascript")
        .arg("-e")
        .arg(r#"tell application "System Events" to keystroke "v" using command down"#)
        .output()
        .map_err(|e| format!("Failed to execute AppleScript: {}", e))?;

    if !output.status.success() {
        return Err(format!(
            "AppleScript error: {}",
            String::from_utf8_lossy(&output.stderr)
        ));
    }

    Ok(())
}

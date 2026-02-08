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

/// Simulate Cmd+V keystroke using CoreGraphics events.
/// Only requires Accessibility permission (no Automation/osascript needed).
#[cfg(target_os = "macos")]
fn simulate_cmd_v() -> Result<(), String> {
    use core_graphics::event::{CGEvent, CGEventFlags, CGEventTapLocation};
    use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

    let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState)
        .map_err(|_| "Failed to create CGEventSource".to_string())?;

    // Key code 9 = 'V' on macOS
    let key_down = CGEvent::new_keyboard_event(source.clone(), 9, true)
        .map_err(|_| "Failed to create key down event".to_string())?;
    let key_up = CGEvent::new_keyboard_event(source, 9, false)
        .map_err(|_| "Failed to create key up event".to_string())?;

    key_down.set_flags(CGEventFlags::CGEventFlagCommand);
    key_up.set_flags(CGEventFlags::CGEventFlagCommand);

    key_down.post(CGEventTapLocation::HID);
    key_up.post(CGEventTapLocation::HID);

    Ok(())
}

#[cfg(not(target_os = "macos"))]
fn simulate_cmd_v() -> Result<(), String> {
    Err("Paste simulation not supported on this platform".to_string())
}

/// Activate an application by bundle identifier using NSRunningApplication.
/// Only requires Accessibility permission (no Automation/osascript needed).
#[cfg(target_os = "macos")]
fn activate_app_native(bundle_id: &str) -> Result<(), String> {
    use core_foundation::base::TCFType;
    use core_foundation::string::CFString;
    use std::ffi::c_void;

    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const std::os::raw::c_char) -> *mut c_void;
        fn sel_registerName(name: *const std::os::raw::c_char) -> *mut c_void;
        fn objc_msgSend(obj: *mut c_void, sel: *mut c_void) -> *mut c_void;
    }

    unsafe {
        let cls = objc_getClass(c"NSRunningApplication".as_ptr());
        if cls.is_null() {
            return Err("Failed to get NSRunningApplication class".to_string());
        }

        // CFString is toll-free bridged with NSString
        let cf_bundle_id = CFString::new(bundle_id);
        let ns_bundle_id = cf_bundle_id.as_concrete_TypeRef() as *mut c_void;

        // [NSRunningApplication runningApplicationsWithBundleIdentifier:]
        let send_with_id: extern "C" fn(*mut c_void, *mut c_void, *mut c_void) -> *mut c_void =
            std::mem::transmute(objc_msgSend as *const c_void);
        let apps = send_with_id(
            cls,
            sel_registerName(c"runningApplicationsWithBundleIdentifier:".as_ptr()),
            ns_bundle_id,
        );
        if apps.is_null() {
            return Err(format!("No running apps found for {}", bundle_id));
        }

        // [apps firstObject]
        let app = objc_msgSend(apps, sel_registerName(c"firstObject".as_ptr()));
        if app.is_null() {
            return Err(format!("App {} is not running", bundle_id));
        }

        // [app activateWithOptions:NSApplicationActivateIgnoringOtherApps]
        // NSApplicationActivateIgnoringOtherApps = 1 << 1 = 2
        let send_with_opts: extern "C" fn(*mut c_void, *mut c_void, u64) -> i8 =
            std::mem::transmute(objc_msgSend as *const c_void);
        send_with_opts(
            app,
            sel_registerName(c"activateWithOptions:".as_ptr()),
            2,
        );

        Ok(())
    }
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
    #[cfg(target_os = "macos")]
    {
        activate_app_native(bundle_id)
    }
    #[cfg(not(target_os = "macos"))]
    {
        let _ = bundle_id;
        Ok(())
    }
}

pub fn set_clipboard_and_paste(text: &str) -> Result<(), String> {
    copy_to_clipboard(text)?;
    simulate_cmd_v()
}

/// Paste text to a specific app (activates it first)
pub fn paste_to_app(text: &str, bundle_id: &str) -> Result<(), String> {
    copy_to_clipboard(text)?;
    activate_app(bundle_id)?;
    simulate_cmd_v()
}

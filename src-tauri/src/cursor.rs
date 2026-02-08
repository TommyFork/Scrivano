//! Cursor position and frontmost app detection for macOS

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::CFString;
    use std::ffi::c_void;
    use std::ptr;

    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    }

    // Objective-C runtime for NSWorkspace access
    #[link(name = "objc")]
    extern "C" {
        fn objc_getClass(name: *const std::os::raw::c_char) -> *mut c_void;
        fn sel_registerName(name: *const std::os::raw::c_char) -> *mut c_void;
        fn objc_msgSend(obj: *mut c_void, sel: *mut c_void) -> *mut c_void;
    }

    /// Check if accessibility permission is already granted (no UI prompt).
    pub fn is_accessibility_granted() -> bool {
        unsafe { AXIsProcessTrustedWithOptions(ptr::null()) }
    }

    /// Check accessibility and show the macOS system dialog if not granted.
    /// Should only be called once (e.g., at startup).
    pub fn prompt_accessibility_permission() -> bool {
        unsafe {
            extern "C" {
                static kCFBooleanTrue: CFTypeRef;
                fn CFDictionaryCreate(
                    allocator: CFTypeRef,
                    keys: *const CFTypeRef,
                    values: *const CFTypeRef,
                    num_values: isize,
                    key_callbacks: *const c_void,
                    value_callbacks: *const c_void,
                ) -> CFTypeRef;
                static kCFTypeDictionaryKeyCallBacks: c_void;
                static kCFTypeDictionaryValueCallBacks: c_void;
            }

            let key = CFString::new("AXTrustedCheckOptionPrompt");
            let key_ref = key.as_concrete_TypeRef() as CFTypeRef;

            let keys = [key_ref];
            let values = [kCFBooleanTrue];

            let dict = CFDictionaryCreate(
                ptr::null(),
                keys.as_ptr(),
                values.as_ptr(),
                1,
                &kCFTypeDictionaryKeyCallBacks as *const c_void,
                &kCFTypeDictionaryValueCallBacks as *const c_void,
            );

            let result = AXIsProcessTrustedWithOptions(dict);
            if !dict.is_null() {
                CFRelease(dict);
            }
            result
        }
    }

    /// Activate this app so windows can come to the foreground.
    /// Required for Accessory apps (no dock icon) that launch via LaunchAgent.
    pub fn activate_self() {
        unsafe {
            let cls = objc_getClass(c"NSApplication".as_ptr());
            if cls.is_null() {
                return;
            }
            let ns_app = objc_msgSend(cls, sel_registerName(c"sharedApplication".as_ptr()));
            if ns_app.is_null() {
                return;
            }
            // [NSApp activateIgnoringOtherApps:YES]
            // Cast objc_msgSend to accept a BOOL (i8) argument
            let send: extern "C" fn(*mut c_void, *mut c_void, i8) =
                std::mem::transmute(objc_msgSend as *const c_void);
            send(
                ns_app,
                sel_registerName(c"activateIgnoringOtherApps:".as_ptr()),
                1, // YES
            );
        }
    }

    /// Get the bundle identifier of the frontmost application via NSWorkspace.
    pub fn get_frontmost_bundle_id() -> Option<String> {
        unsafe {
            let cls = objc_getClass(c"NSWorkspace".as_ptr());
            if cls.is_null() {
                return None;
            }
            let workspace = objc_msgSend(cls, sel_registerName(c"sharedWorkspace".as_ptr()));
            if workspace.is_null() {
                return None;
            }
            let app = objc_msgSend(
                workspace,
                sel_registerName(c"frontmostApplication".as_ptr()),
            );
            if app.is_null() {
                return None;
            }
            let ns_string = objc_msgSend(app, sel_registerName(c"bundleIdentifier".as_ptr()));
            if ns_string.is_null() {
                return None;
            }
            let c_str = objc_msgSend(ns_string, sel_registerName(c"UTF8String".as_ptr()))
                as *const std::os::raw::c_char;
            if c_str.is_null() {
                return None;
            }
            Some(
                std::ffi::CStr::from_ptr(c_str)
                    .to_string_lossy()
                    .into_owned(),
            )
        }
    }

    /// Get mouse cursor position.
    pub fn get_mouse_position() -> Option<(i32, i32)> {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
        let event = CGEvent::new(source).ok()?;
        let location = event.location();

        Some((location.x as i32, location.y as i32))
    }
}

/// Activate this app so windows can come to the foreground.
#[cfg(target_os = "macos")]
pub fn activate_self() {
    macos::activate_self();
}

#[cfg(not(target_os = "macos"))]
pub fn activate_self() {}

/// Get the bundle identifier of the frontmost application via NSWorkspace.
#[cfg(target_os = "macos")]
pub fn get_frontmost_bundle_id() -> Option<String> {
    macos::get_frontmost_bundle_id()
}

#[cfg(not(target_os = "macos"))]
pub fn get_frontmost_bundle_id() -> Option<String> {
    None
}

/// Get the current mouse cursor position.
#[cfg(target_os = "macos")]
pub fn get_mouse_position() -> Option<(i32, i32)> {
    macos::get_mouse_position()
}

#[cfg(not(target_os = "macos"))]
pub fn get_mouse_position() -> Option<(i32, i32)> {
    None
}

/// Prompt for accessibility permission once at startup, only if not already granted.
#[cfg(target_os = "macos")]
pub fn prompt_accessibility_once() {
    if macos::is_accessibility_granted() {
        eprintln!("[Scrivano] Accessibility permission already granted.");
        return;
    }
    let granted = macos::prompt_accessibility_permission();
    if granted {
        eprintln!("[Scrivano] Accessibility permission granted.");
    } else {
        eprintln!("[Scrivano] Accessibility permission not granted. Grant access in System Settings > Privacy & Security > Accessibility.");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prompt_accessibility_once() {}

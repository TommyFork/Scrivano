//! Cursor/caret position detection for macOS
//!
//! Attempts to get the text caret (insertion point) position from the focused
//! text field using macOS Accessibility APIs. Falls back to mouse position.

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::geometry::{CGPoint, CGRect};
    use std::ffi::c_void;
    use std::ptr;

    // Accessibility API types
    type AXUIElementRef = *mut c_void;
    type AXValueRef = *mut c_void;
    type AXError = i32;

    const kAXErrorSuccess: AXError = 0;
    const kAXValueTypeCGPoint: u32 = 1;
    const kAXValueTypeCGRect: u32 = 3;

    // Link against ApplicationServices framework
    #[link(name = "ApplicationServices", kind = "framework")]
    extern "C" {
        fn AXUIElementCreateSystemWide() -> AXUIElementRef;
        fn AXUIElementCopyAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXUIElementCopyParameterizedAttributeValue(
            element: AXUIElementRef,
            attribute: CFStringRef,
            parameter: CFTypeRef,
            value: *mut CFTypeRef,
        ) -> AXError;
        fn AXValueGetValue(value: AXValueRef, value_type: u32, value_ptr: *mut c_void) -> bool;
        fn AXIsProcessTrustedWithOptions(options: CFTypeRef) -> bool;
    }

    /// Check if the app has accessibility permissions (no prompt).
    pub fn is_accessibility_enabled() -> bool {
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

    #[derive(Debug, Clone, Copy)]
    pub struct CursorPosition {
        pub x: i32,
        pub y: i32,
    }

    /// Try to get the text caret position using Accessibility APIs.
    /// Falls back through: AXBoundsForRange → AXPosition of focused element.
    pub fn get_caret_position() -> Option<CursorPosition> {
        if !is_accessibility_enabled() {
            return None;
        }

        unsafe {
            let system_wide = AXUIElementCreateSystemWide();
            if system_wide.is_null() {
                return None;
            }

            // Get the focused UI element
            let focused_attr = CFString::new("AXFocusedUIElement");
            let mut focused_element: CFTypeRef = ptr::null_mut();

            let result = AXUIElementCopyAttributeValue(
                system_wide,
                focused_attr.as_concrete_TypeRef(),
                &mut focused_element,
            );

            CFRelease(system_wide as CFTypeRef);

            if result != kAXErrorSuccess || focused_element.is_null() {
                return None;
            }

            // Try to get exact caret position via AXSelectedTextRange + AXBoundsForRange
            let range_attr = CFString::new("AXSelectedTextRange");
            let mut range_value: CFTypeRef = ptr::null_mut();

            let result = AXUIElementCopyAttributeValue(
                focused_element as AXUIElementRef,
                range_attr.as_concrete_TypeRef(),
                &mut range_value,
            );

            if result == kAXErrorSuccess && !range_value.is_null() {
                let bounds_attr = CFString::new("AXBoundsForRange");
                let mut bounds_value: CFTypeRef = ptr::null_mut();

                let result = AXUIElementCopyParameterizedAttributeValue(
                    focused_element as AXUIElementRef,
                    bounds_attr.as_concrete_TypeRef(),
                    range_value,
                    &mut bounds_value,
                );

                CFRelease(range_value);

                if result == kAXErrorSuccess && !bounds_value.is_null() {
                    let mut rect = CGRect::default();
                    let success = AXValueGetValue(
                        bounds_value as AXValueRef,
                        kAXValueTypeCGRect,
                        &mut rect as *mut CGRect as *mut c_void,
                    );
                    CFRelease(bounds_value);

                    if success {
                        eprintln!("[Scrivano] Got exact caret position: ({}, {})", rect.origin.x as i32, rect.origin.y as i32);
                        CFRelease(focused_element);
                        return Some(CursorPosition {
                            x: rect.origin.x as i32,
                            y: rect.origin.y as i32,
                        });
                    }
                }
            } else if !range_value.is_null() {
                CFRelease(range_value);
            }

            // Fallback: get position of the focused element itself
            let pos_attr = CFString::new("AXPosition");
            let mut pos_value: CFTypeRef = ptr::null_mut();

            let result = AXUIElementCopyAttributeValue(
                focused_element as AXUIElementRef,
                pos_attr.as_concrete_TypeRef(),
                &mut pos_value,
            );

            if result == kAXErrorSuccess && !pos_value.is_null() {
                let mut point = CGPoint { x: 0.0, y: 0.0 };
                let success = AXValueGetValue(
                    pos_value as AXValueRef,
                    kAXValueTypeCGPoint,
                    &mut point as *mut CGPoint as *mut c_void,
                );
                CFRelease(pos_value);
                CFRelease(focused_element);

                if success {
                    eprintln!("[Scrivano] Using focused element position: ({}, {})", point.x as i32, point.y as i32);
                    return Some(CursorPosition {
                        x: point.x as i32,
                        y: point.y as i32,
                    });
                }
            } else {
                CFRelease(focused_element);
            }

            None
        }
    }

    /// Get mouse cursor position as fallback
    pub fn get_mouse_position() -> Option<CursorPosition> {
        use core_graphics::event::CGEvent;
        use core_graphics::event_source::{CGEventSource, CGEventSourceStateID};

        let source = CGEventSource::new(CGEventSourceStateID::CombinedSessionState).ok()?;
        let event = CGEvent::new(source).ok()?;
        let location = event.location();

        Some(CursorPosition {
            x: location.x as i32,
            y: location.y as i32,
        })
    }
}

#[derive(Debug, Clone, Copy)]
pub struct CursorPosition {
    pub x: i32,
    pub y: i32,
    pub is_caret: bool,
}

/// Prompt for accessibility permission once at startup.
#[cfg(target_os = "macos")]
pub fn prompt_accessibility_once() {
    let granted = macos::prompt_accessibility_permission();
    if granted {
        eprintln!("[Scrivano] Accessibility permission granted — caret detection enabled.");
    } else {
        eprintln!("[Scrivano] Accessibility permission not granted — will use mouse position. Grant access in System Settings > Privacy & Security > Accessibility.");
    }
}

#[cfg(not(target_os = "macos"))]
pub fn prompt_accessibility_once() {}

#[cfg(target_os = "macos")]
pub fn get_cursor_position() -> Result<CursorPosition, String> {
    // Try to get caret position first
    if let Some(pos) = macos::get_caret_position() {
        eprintln!("[Scrivano] Got caret position via Accessibility: ({}, {})", pos.x, pos.y);
        return Ok(CursorPosition { x: pos.x, y: pos.y, is_caret: true });
    }

    // Fall back to mouse position
    eprintln!("[Scrivano] Caret detection failed, falling back to mouse position");
    if let Some(pos) = macos::get_mouse_position() {
        return Ok(CursorPosition { x: pos.x, y: pos.y, is_caret: false });
    }

    Err("Failed to get cursor position".to_string())
}

#[cfg(not(target_os = "macos"))]
pub fn get_cursor_position() -> Result<CursorPosition, String> {
    Err("Cursor position not supported on this platform".to_string())
}

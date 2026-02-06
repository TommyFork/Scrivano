//! Cursor/caret position detection for macOS
//!
//! Attempts to get the text caret (insertion point) position from the focused
//! text field using macOS Accessibility APIs. Falls back to mouse position.

#[cfg(target_os = "macos")]
mod macos {
    use core_foundation::base::{CFRelease, CFTypeRef, TCFType};
    use core_foundation::string::{CFString, CFStringRef};
    use core_graphics::geometry::CGRect;
    use std::ffi::c_void;
    use std::ptr;

    // Accessibility API types
    type AXUIElementRef = *mut c_void;
    type AXValueRef = *mut c_void;
    type AXError = i32;

    const kAXErrorSuccess: AXError = 0;
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

    /// Check if the app has accessibility permissions.
    /// If `prompt` is true and permission is not granted, shows the macOS
    /// system dialog asking the user to grant it.
    pub fn check_accessibility(prompt: bool) -> bool {
        unsafe {
            if prompt {
                use core_foundation::base::TCFType as _;
                use core_foundation::boolean::CFBoolean;
                use core_foundation::dictionary::CFDictionary;

                let key = CFString::new("AXTrustedCheckOptionPrompt");
                let value = if prompt {
                    CFBoolean::true_value()
                } else {
                    CFBoolean::false_value()
                };

                let dict = CFDictionary::from_CFType_pairs(&[(
                    key.as_CFType(),
                    value.as_CFType(),
                )]);

                AXIsProcessTrustedWithOptions(dict.as_CFTypeRef())
            } else {
                AXIsProcessTrustedWithOptions(ptr::null())
            }
        }
    }

    #[derive(Debug, Clone, Copy)]
    pub struct CursorPosition {
        pub x: i32,
        pub y: i32,
    }

    /// Try to get the text caret position using Accessibility APIs
    pub fn get_caret_position() -> Option<CursorPosition> {
        if !check_accessibility(true) {
            eprintln!("[Scrivano] Accessibility permission not granted. A system prompt should appear - grant access, then restart Scrivano.");
            return None;
        }

        unsafe {
            let system_wide = AXUIElementCreateSystemWide();
            if system_wide.is_null() {
                eprintln!("[Scrivano] Failed to create system-wide AX element");
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
                eprintln!("[Scrivano] No focused UI element found (AX error: {})", result);
                return None;
            }

            // Get the selected text range (this represents the caret position)
            let range_attr = CFString::new("AXSelectedTextRange");
            let mut range_value: CFTypeRef = ptr::null_mut();

            let result = AXUIElementCopyAttributeValue(
                focused_element as AXUIElementRef,
                range_attr.as_concrete_TypeRef(),
                &mut range_value,
            );

            if result != kAXErrorSuccess || range_value.is_null() {
                eprintln!("[Scrivano] Focused element doesn't have AXSelectedTextRange (AX error: {}). Not a text field?", result);
                CFRelease(focused_element);
                return None;
            }

            // Get bounds for the range using parameterized attribute
            let bounds_attr = CFString::new("AXBoundsForRange");
            let mut bounds_value: CFTypeRef = ptr::null_mut();

            let result = AXUIElementCopyParameterizedAttributeValue(
                focused_element as AXUIElementRef,
                bounds_attr.as_concrete_TypeRef(),
                range_value,
                &mut bounds_value,
            );

            CFRelease(range_value);
            CFRelease(focused_element);

            if result != kAXErrorSuccess || bounds_value.is_null() {
                eprintln!("[Scrivano] Failed to get AXBoundsForRange (AX error: {})", result);
                return None;
            }

            // Extract CGRect from AXValue
            let mut rect = CGRect::default();
            let success = AXValueGetValue(
                bounds_value as AXValueRef,
                kAXValueTypeCGRect,
                &mut rect as *mut CGRect as *mut c_void,
            );

            CFRelease(bounds_value);

            if success {
                Some(CursorPosition {
                    x: rect.origin.x as i32,
                    y: rect.origin.y as i32,
                })
            } else {
                eprintln!("[Scrivano] Failed to extract CGRect from AXValue");
                None
            }
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

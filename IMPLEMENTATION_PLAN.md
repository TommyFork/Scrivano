# Implementation Plan: Security & Code Quality Remediation

This plan addresses all 18 issues identified in `SECURITY_AUDIT.md`, ordered to minimize
conflicts and rework. Each phase is designed as a separate commit.

---

## Dependency Analysis & Ordering Rationale

- **Issue 10 (decompose lib.rs)** creates new files that nearly every other Rust-side fix
  touches. Doing it early avoids merge conflicts from later changes landing in a monolithic
  804-line file. It also makes Issues 4, 13, 15, 17, and 18 easier because the code is in
  smaller, focused modules.
- **Issues 1+2 (shell permissions + CSP)** are config-only changes with zero Rust code
  overlap. They go first due to P0 severity.
- **Issue 4 (parking_lot Mutex)** is a global find-and-replace. Doing it right after
  decomposition means touching each new module exactly once.
- **Issues 3, 5, 6, 7, 18** are localized to specific modules with no interdependencies.
  They can be parallelized within a phase.
- **Issue 12 (tokio features)** should come after all code changes are final, since adding
  crates may change tokio requirements.
- **Issues 8, 9 (gitignore + CI)** are infrastructure-only with no code dependencies.
- **Issue 13 (tracing)** should follow decomposition so each module gets clean structured
  logging.
- **Issue 14 (integration tests)** comes last since it tests the final module shapes.

---

## Phase 1: Critical Security Configuration (Issues 1, 2)

P0 severity, config-only, zero risk of conflicting with later phases.

### Step 1.1: Remove shell permissions (Issue 1)

**File:** `src-tauri/capabilities/default.json`

Remove `"shell:allow-execute"` and `"shell:allow-spawn"` from the permissions array.
The frontend never imports `@tauri-apps/plugin-shell`. All shell invocations happen in
Rust via `std::process::Command` (in `paste.rs`), which does **not** require webview
shell permissions.

Also remove the plugin entirely:
- Delete `.plugin(tauri_plugin_shell::init())` from `src-tauri/src/lib.rs:525`
- Delete `tauri-plugin-shell = "2"` from `src-tauri/Cargo.toml:19`

**Verification:**
- `cargo build` succeeds
- App still records, transcribes, and pastes (pbcopy/osascript work via `std::process::Command`)
- `grep -r "shell:" src-tauri/capabilities/` returns nothing

### Step 1.2: Enable restrictive CSP (Issue 2)

**File:** `src-tauri/tauri.conf.json`

Replace `"csp": null` with:
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' asset: https://asset.localhost; connect-src ipc: http://ipc.localhost"
```

Directive rationale:
- `default-src 'self'` -- only allow same-origin resources
- `script-src 'self'` -- only bundled scripts, no inline/eval
- `style-src 'self' 'unsafe-inline'` -- React inline styles (e.g., Indicator.tsx)
- `img-src 'self' asset: https://asset.localhost` -- Tauri 2 asset protocol
- `connect-src ipc: http://ipc.localhost` -- Tauri 2 IPC; no external network
  (all API calls go through Rust reqwest, not the webview)

**Verification:**
- App launches without CSP violation errors (check via Console.app or Safari dev tools)
- Both main window and indicator window render correctly
- All `invoke()` / `listen()` / `emit()` calls work

---

## Phase 2: Decompose lib.rs (Issue 10)

The largest structural change. Creates module boundaries for all subsequent Rust work.

### Step 2.1: Extract modules

**Current `lib.rs` (804 lines) breaks down as:**

| Lines | Content | Target module |
|-------|---------|---------------|
| 22-66 | State structs (`AppState`, `RecorderState`, `TrayIcons`, `ShortcutSettings`, `SettingsState`) | Keep in `lib.rs` or new `state.rs` |
| 68-334 | 13 Tauri `#[command]` functions + helper structs | `commands.rs` |
| 340-419 | `show_window_at_position`, `create_indicator_window`, `destroy_indicator_window` | `window.rs` |
| 421-515 | `handle_recording_stop` | `recording.rs` |
| 34-57, 553-610 | `TrayIcons` struct + tray builder | `tray.rs` |
| 517-804 | `run()` function | Stays in `lib.rs`, slimmed down |

**New file map:**

| New file | Content | ~Lines |
|----------|---------|--------|
| `src-tauri/src/commands.rs` | All `#[tauri::command]` fns + `ShortcutInfo`, `ApiKeyStatus`, `ProviderInfo`, `TranscriptionSettings` | 270 |
| `src-tauri/src/tray.rs` | `TrayIcons` struct + impl, tray builder setup | 60 |
| `src-tauri/src/window.rs` | Window creation, positioning, destruction | 80 |
| `src-tauri/src/recording.rs` | `handle_recording_stop`, recording lifecycle helpers | 100 |

### Step 2.2: Update lib.rs

After extraction, `lib.rs` becomes:
```rust
mod audio;
mod commands;
mod cursor;
mod keychain;
mod paste;
mod recording;
mod settings;
mod transcription;
mod tray;
mod window;

// State structs (or `mod state;`)
// ...

pub fn run() {
    // Tauri builder wiring, using:
    //   commands::* in generate_handler![]
    //   tray::build_tray()
    //   window::create_indicator_window()
    //   recording::handle_recording_stop()
}
```

**Key constraint:** The global shortcut handler closure (lines 627-769) captures many
variables and cannot easily be extracted as a function. It should remain in `run()` but
delegate the actual start/stop logic to `recording.rs` functions.

**Verification:**
- `cargo build` + `cargo clippy --all-targets -- -D warnings`
- `cargo test` passes (existing tests unaffected)
- App functions identically

---

## Phase 3: Mutex Safety (Issue 4)

With code now decomposed, each module can be updated independently.

### Step 3.1: Add dependency

**File:** `src-tauri/Cargo.toml`
```toml
parking_lot = "0.12"
```

### Step 3.2: Replace all Mutex usage

**Files to change:**
- `lib.rs` -- `use` statements and `Mutex::new()` calls (~6 locations)
- `commands.rs` -- all `tauri::State<'_, Mutex<...>>` params and `.lock()` calls (~10 locations)
- `recording.rs` -- `handle_recording_stop` lock calls (~4 locations)
- `audio.rs` -- 7 occurrences of `.lock().unwrap()` on `Arc<Mutex<...>>`

**What changes:**
- `use std::sync::Mutex` -> `use parking_lot::Mutex`
- All `.lock().unwrap()` -> `.lock()` (parking_lot never poisons)
- `std::sync::Arc` stays (parking_lot doesn't replace Arc)
- Tauri's `manage()` still works since `parking_lot::Mutex<T>` is `Send + Sync`

**Verification:**
- `cargo build` succeeds
- `grep -rn "\.lock()\.unwrap()" src-tauri/src/` returns zero matches
- Stress test: rapid press/release of shortcut key does not crash

---

## Phase 4: Localized Security Fixes (Issues 3, 5, 6, 7, 18)

Five independent fixes, no interdependencies. Can be implemented in any order.

### Step 4.1: Unique temp file names (Issue 3)

**File:** `src-tauri/src/audio.rs:200-201`

**Add dependency:**
```toml
# src-tauri/Cargo.toml
tempfile = "3"
```

**Replace:**
```rust
let temp_dir = std::env::temp_dir();
let file_path = temp_dir.join("scrivano_recording.wav");
```

**With:**
```rust
let file_path = tempfile::Builder::new()
    .prefix("scrivano_")
    .suffix(".wav")
    .tempfile_in(std::env::temp_dir())
    .map_err(|e| format!("Failed to create temp file: {}", e))?
    .into_temp_path()
    .to_path_buf();
```

The `tempfile` crate creates files atomically with random names and exclusive access
(O_EXCL), preventing TOCTOU race conditions and symlink attacks.

**Verification:**
- Record twice rapidly, inspect `/tmp/` for different `scrivano_*` filenames
- Files are cleaned up after transcription

### Step 4.2: Sanitize API error messages (Issue 5)

**File:** `src-tauri/src/transcription.rs:62`

**Replace:**
```rust
return Err(format!("API error ({}): {}", status, body));
```

**With:**
```rust
eprintln!("[Scrivano] API error ({}): {}", status, body);
return Err(format!(
    "Transcription failed (HTTP {}). Check your API key and try again.",
    status.as_u16()
));
```

The full body is still logged server-side for debugging. Only a sanitized message
reaches the frontend.

**Verification:**
- Set an invalid API key, trigger transcription
- UI shows generic error without raw JSON
- stderr still logs the full error body

### Step 4.3: Atomic settings write (Issue 6)

**File:** `src-tauri/src/settings.rs:87-96`

**Replace the `save_settings` function body with:**
```rust
pub fn save_settings(settings: &Settings) -> Result<(), String> {
    let path = get_settings_path();
    let content = serde_json::to_string_pretty(settings)
        .map_err(|e| format!("Failed to serialize settings: {}", e))?;

    let tmp_path = path.with_extension("json.tmp");
    fs::write(&tmp_path, &content)
        .map_err(|e| format!("Failed to write temp settings file: {}", e))?;
    fs::rename(&tmp_path, &path)
        .map_err(|e| format!("Failed to rename settings file: {}", e))?;

    Ok(())
}
```

`fs::rename` within the same filesystem is atomic on macOS/Linux.

**Verification:**
- Change a setting, verify `~/.config/scrivano/settings.json` updated correctly
- No `.json.tmp` file left behind after successful save

### Step 4.4: API key format validation (Issue 7)

**File:** `src-tauri/src/commands.rs` (or `lib.rs` pre-decomposition), in `set_api_key`

**Add before `keychain::store_api_key()` call:**
```rust
let trimmed_key = api_key.trim();
if !trimmed_key.is_empty() {
    match provider_key {
        "openai" => {
            if !trimmed_key.starts_with("sk-") {
                return Err("OpenAI API keys should start with 'sk-'".to_string());
            }
        }
        "groq" => {
            if !trimmed_key.starts_with("gsk_") {
                return Err("Groq API keys should start with 'gsk_'".to_string());
            }
        }
        _ => {}
    }
}
```

**Verification:**
- Try saving `"invalid-key"` for OpenAI -- error
- Try saving `"sk-abc123"` for OpenAI -- success
- Try saving `""` -- deletes key (existing behavior preserved)
- Frontend shows the error message appropriately

### Step 4.5: Robust audio file deletion (Issue 18)

**File:** `src-tauri/src/recording.rs` (or `lib.rs:514` pre-decomposition)

**Replace:**
```rust
let _ = std::fs::remove_file(audio_path);
```

**With:**
```rust
if let Err(e) = std::fs::remove_file(&audio_path) {
    eprintln!("[Scrivano] Warning: failed to delete audio file {:?}: {}", audio_path, e);
}
```

If using the `tempfile` crate from Step 4.1, `TempPath` provides auto-deletion on drop
as an additional safety net.

**Verification:**
- After transcription, confirm temp WAV is gone from `/tmp/`
- If already deleted, warning logs but no crash

---

## Phase 5: Infrastructure & CI (Issues 8, 9)

### Step 5.1: Update .gitignore (Issue 8)

**File:** `.gitignore`

**Append:**
```gitignore
# Environment and secrets
.env
.env.*
.env.local

# Audio recordings
*.wav

# Rust build artifacts
src-tauri/target/
```

### Step 5.2: Add cargo audit to CI (Issue 9)

**File:** `.github/workflows/ci.yml`

**Add after the "Test" step in the `rust` job:**
```yaml
      - name: Install cargo-audit
        run: cargo install cargo-audit --locked

      - name: Audit dependencies
        run: cargo audit
```

**Verification:**
- Push to branch, confirm CI runs the audit step
- Any known CVEs surface in CI output

---

## Phase 6: Code Quality (Issues 11, 12, 16, 17)

### Step 6.1: Extract duplicate paste logic (Issue 11)

**File:** `src-tauri/src/paste.rs`

**Extract a private helper:**
```rust
fn simulate_paste() -> Result<(), String> {
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
```

**Then simplify both callers:**
```rust
pub fn set_clipboard_and_paste(text: &str) -> Result<(), String> {
    copy_to_clipboard(text)?;
    simulate_paste()
}

pub fn paste_to_app(text: &str, bundle_id: &str) -> Result<(), String> {
    copy_to_clipboard(text)?;
    activate_app(bundle_id)?;
    simulate_paste()
}
```

### Step 6.2: Narrow tokio features (Issue 12)

**File:** `src-tauri/Cargo.toml`

**Replace:**
```toml
tokio = { version = "1", features = ["full"] }
```

**With:**
```toml
tokio = { version = "1", features = ["macros", "rt-multi-thread"] }
```

`rt-multi-thread` is required because Tauri 2 uses a multi-threaded runtime. `macros`
is needed for `#[tokio::test]`. `reqwest` pulls in any additional tokio features it
needs via its own dependency declarations.

**Verification:**
- `cargo build` succeeds
- `cargo test` passes (`#[tokio::test]` in `transcription.rs` still works)

### Step 6.3: Remove ApiKeysConfig dead code (Issue 16)

**File:** `src-tauri/src/settings.rs`

**Replace the `ApiKeysConfig` struct (lines 30-37) and the `api_keys` field in `Settings`:**
```rust
#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct Settings {
    #[serde(default)]
    pub shortcut: ShortcutConfig,
    #[serde(default, skip_serializing)]
    api_keys: Option<serde_json::Value>, // Backwards compat: consumed but never written
    #[serde(default)]
    pub transcription: TranscriptionConfig,
}
```

This replaces a 10-line struct with a 1-line field that silently absorbs old `api_keys`
JSON without writing it back.

**Verification:**
- `cargo build` + `cargo test`
- Load a settings file containing `"api_keys": {"openai_api_key": "sk-..."}` -- no error
- Save settings -- `api_keys` field does not appear in output

### Step 6.4: Extract hardcoded magic numbers (Issue 17)

**Files:**
- Rust side: Add constants at module tops (or shared `constants.rs`)
  ```rust
  pub const MAIN_WINDOW_WIDTH: f64 = 320.0;
  pub const INDICATOR_SIZE: i32 = 36;
  ```
- Replace all inline literals in `lib.rs`/`window.rs`/`commands.rs` with the constants
- Frontend: `App.tsx` lines 40-41 already use named constants (`SETTINGS_HEIGHT`,
  `MAIN_HEIGHT`) -- add a comment documenting the relationship with Rust-side values

**Verification:**
- `cargo build` + `cargo clippy`
- All windows render at correct dimensions

---

## Phase 7: Structured Logging (Issue 13)

### Step 7.1: Add dependencies

**File:** `src-tauri/Cargo.toml`
```toml
tracing = "0.1"
tracing-subscriber = { version = "0.3", features = ["env-filter"] }
```

### Step 7.2: Initialize subscriber

**File:** `src-tauri/src/lib.rs`, in `run()` before `tauri::Builder`
```rust
tracing_subscriber::fmt()
    .with_env_filter(
        tracing_subscriber::EnvFilter::from_default_env()
            .add_directive("scrivano=info".parse().unwrap())
    )
    .init();
```

### Step 7.3: Replace all eprintln! calls

**All .rs files with `eprintln!` (~30 occurrences across 5 files):**

| Pattern | Replacement |
|---------|-------------|
| `eprintln!("Failed to ...")` | `tracing::error!(...)` |
| `eprintln!("[Scrivano] ...")` (informational) | `tracing::info!(...)` |
| `eprintln!("[Scrivano] ...")` (diagnostics) | `tracing::debug!(...)` |
| `eprintln!("API key error: ...")` | `tracing::warn!(...)` |

**Verification:**
- `cargo build` + `cargo clippy`
- `RUST_LOG=scrivano=debug` shows structured output with timestamps and levels
- `grep -rn "eprintln" src-tauri/src/` returns zero matches

---

## Phase 8: Recording Debounce (Issue 15)

**File:** `src-tauri/src/recording.rs` (or `lib.rs` shortcut handler)

### Step 8.1: Add cooldown to RecorderState

```rust
struct RecorderState {
    handle: Option<RecordingHandle>,
    stop_polling: Arc<AtomicBool>,
    original_app: Option<String>,
    last_stop_time: Option<std::time::Instant>,  // NEW
}
```

### Step 8.2: Check cooldown on press

In the `ShortcutState::Pressed` handler:
```rust
{
    let state = recorder_state.lock();
    if let Some(last_stop) = state.last_stop_time {
        if last_stop.elapsed() < std::time::Duration::from_millis(300) {
            tracing::debug!("Ignoring press within 300ms of last stop");
            return;
        }
    }
}
```

### Step 8.3: Record timestamp on release

In the `ShortcutState::Released` handler, after stopping:
```rust
{
    let mut state = recorder_state.lock();
    state.last_stop_time = Some(std::time::Instant::now());
}
```

**Verification:**
- Rapid tap (<100ms hold) does not trigger a recording or API call
- Normal press-and-hold still works
- Pressing again after 300ms works normally

---

## Phase 9: Integration Tests (Issue 14)

Comes last since it tests the final state of all modules.

### Step 9.1: Add test dependencies

**File:** `src-tauri/Cargo.toml`
```toml
[dev-dependencies]
mockito = "1"
```

### Step 9.2: Create integration tests

**File:** `src-tauri/tests/integration.rs` (new)

**Test scenarios:**

1. **Transcription with mocked HTTP** -- Create a WAV file with `hound`, start a
   `mockito` server returning a Whisper JSON response, call `transcribe_audio()`,
   verify correct text returned.

2. **Hallucination filtering** -- Mock server returns `{"text": "thank you"}`,
   verify `transcribe_audio()` returns an error.

3. **Settings round-trip** -- `save_settings()` to temp dir, `load_settings()`,
   verify equality.

4. **API key validation** -- Test `set_api_key` with invalid prefixes, verify errors.

5. **API error handling** -- Mock server returns HTTP 401 / 429, verify user-friendly
   error messages (not raw body).

**Verification:**
- `cargo test` passes all new integration tests
- CI pipeline runs them (mock server needs no network)

---

## Summary: Commit Strategy

| Commit | Phase | Issues | Description |
|--------|-------|--------|-------------|
| 1 | Phase 1 | 1, 2 | Remove shell permissions; enable restrictive CSP |
| 2 | Phase 2 | 10 | Decompose lib.rs into commands, tray, window, recording modules |
| 3 | Phase 3 | 4 | Replace std::sync::Mutex with parking_lot::Mutex |
| 4 | Phase 4 | 3, 5, 6, 7, 18 | Secure temp files, sanitize errors, atomic settings, validate keys, robust cleanup |
| 5 | Phase 5 | 8, 9 | Update .gitignore and add cargo audit to CI |
| 6 | Phase 6 | 11, 12, 16, 17 | Deduplicate paste, narrow tokio, remove dead code, extract constants |
| 7 | Phase 7 | 13 | Replace eprintln with tracing structured logging |
| 8 | Phase 8 | 15 | Add recording debounce cooldown |
| 9 | Phase 9 | 14 | Add integration tests with mocked HTTP |

---

## Files Changed Per Issue

| Issue | Files Modified |
|-------|---------------|
| 1. Shell permissions | `capabilities/default.json`, `Cargo.toml`, `lib.rs` |
| 2. CSP | `tauri.conf.json` |
| 3. Temp file path | `audio.rs`, `Cargo.toml` |
| 4. Mutex poisoning | `Cargo.toml`, `lib.rs`, `audio.rs`, all extracted modules |
| 5. API error leak | `transcription.rs` |
| 6. Atomic settings | `settings.rs` |
| 7. API key validation | `commands.rs` (or `lib.rs`) |
| 8. .gitignore | `.gitignore` |
| 9. cargo audit CI | `ci.yml` |
| 10. Decompose lib.rs | `lib.rs` + 4 new modules |
| 11. Paste dedup | `paste.rs` |
| 12. tokio features | `Cargo.toml` |
| 13. Structured logging | `Cargo.toml`, all `.rs` files |
| 14. Integration tests | `Cargo.toml`, new `tests/integration.rs` |
| 15. Recording debounce | `recording.rs` (or `lib.rs`) |
| 16. Dead code removal | `settings.rs` |
| 17. Magic numbers | `lib.rs` / extracted modules |
| 18. Audio file cleanup | `recording.rs` (or `lib.rs`) |

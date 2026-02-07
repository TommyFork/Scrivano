# Scrivano Security & Code Quality Audit

**Date:** 2026-02-07
**Scope:** Full codebase review covering security, best practices, and maintainability

---

## SECURITY

### 1. CRITICAL: Overly Broad Shell Permissions in Tauri Capabilities

**File:** `src-tauri/capabilities/default.json:12-13`

Both the `main` and `indicator` windows are granted `shell:allow-execute` and `shell:allow-spawn`. This means any JavaScript running in *either* webview can execute arbitrary shell commands. The indicator window is a 36x36 overlay that only displays audio bars — it has no need for shell access. Even for the main window, these permissions are broader than necessary.

**Risk:** If any code injection occurs in the webview (via a future dependency vulnerability, a crafted transcription result, etc.), the attacker gains full shell access on the user's machine.

**Recommendation:** Remove `shell:allow-execute` and `shell:allow-spawn` from the capabilities entirely. The Rust backend already invokes `pbcopy` and `osascript` directly via `std::process::Command` — those calls happen in Rust, not from the webview, so they don't need shell permissions in the Tauri capability config. If shell access is truly needed from the frontend, scope it to specific allowed commands only and restrict it to the `main` window.

---

### 2. HIGH: CSP Disabled

**File:** `src-tauri/tauri.conf.json:28`

Content Security Policy is explicitly set to `null`. While this is common in desktop Tauri apps, combining a null CSP with the broad shell permissions above significantly increases the attack surface. If any untrusted content is ever rendered (e.g., an error message from the API containing HTML), there's no policy restricting script execution.

**Recommendation:** Set a restrictive CSP:
```json
"csp": "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src https://api.openai.com https://api.groq.com"
```

---

### 3. HIGH: Predictable Temp File Path (Symlink / Race Condition)

**File:** `src-tauri/src/audio.rs:200-201`

The recording is always written to `/tmp/scrivano_recording.wav`. Issues:
- **Symlink attack:** On a multi-user system, an attacker could create a symlink pointing to a sensitive file, causing the app to overwrite it.
- **Race condition:** If two instances run or the user records rapidly, the file gets overwritten.
- **Information disclosure:** Any process on the system can read the recording at the known path.

**Recommendation:** Use `tempfile::NamedTempFile` or `std::env::temp_dir()` with a random suffix to create a unique, unpredictable file path for each recording.

---

### 4. MEDIUM: Mutex Poisoning Crashes via `.unwrap()` on Locks

**Files:** `src-tauri/src/lib.rs` (lines 70, 75, 128, 184, 299, 314, 429, 480, 678, 721, 738, 743, 744, 781)

Every mutex lock uses `.lock().unwrap()`. If any thread panics while holding a lock, the mutex becomes poisoned and every subsequent `.unwrap()` will panic too, cascading the crash through the entire application.

**Recommendation:** Use `.lock().unwrap_or_else(|e| e.into_inner())` to recover from poisoned mutexes, or adopt `parking_lot::Mutex` which doesn't poison.

---

### 5. MEDIUM: API Error Responses Leaked to Frontend

**File:** `src-tauri/src/transcription.rs:62`

The full API response body is returned as an error, which gets emitted to the frontend. API error responses may contain account metadata or other sensitive information.

**Recommendation:** Log the full error server-side but return a sanitized, user-friendly error message to the frontend.

---

### 6. MEDIUM: No API Key Format Validation

**File:** `src-tauri/src/lib.rs:245-258`

Any non-whitespace string is accepted and stored in the keychain. OpenAI keys start with `sk-`, Groq keys start with `gsk_`.

**Recommendation:** Add basic prefix validation to catch copy-paste errors early.

---

### 7. LOW: Audio File Not Securely Deleted

**File:** `src-tauri/src/lib.rs:514`

The audio recording (containing the user's voice) is deleted with standard `remove_file`. The deletion error is silently ignored. The file is also never deleted on some error paths when `new_recording_active()` returns true.

**Recommendation:** Don't ignore deletion errors. For stronger privacy, overwrite the file with zeros before deleting.

---

## BEST PRACTICES

### 8. Settings File Write Is Not Atomic

**File:** `src-tauri/src/settings.rs:87-96`

If the app crashes mid-write, the settings file will be corrupted (partially written JSON).

**Recommendation:** Use write-to-temp-then-rename pattern:
```rust
let temp_path = path.with_extension("json.tmp");
fs::write(&temp_path, content)?;
fs::rename(&temp_path, &path)?;
```

---

### 9. `tokio` Features Are Overbroad

**File:** `src-tauri/Cargo.toml:25`

`features = ["full"]` pulls in every tokio component. The app only needs the async runtime for HTTP calls.

**Recommendation:** Replace with minimal required features (e.g., `["rt", "macros"]`).

---

### 10. No Structured Logging

The entire codebase uses `eprintln!()` for logging (30+ occurrences). There's no log level filtering, timestamps, or structured format.

**Recommendation:** Adopt the `tracing` crate. Replace `eprintln!()` with appropriate tracing macros.

---

### 11. No Dependency Vulnerability Scanning in CI

**File:** `.github/workflows/ci.yml`

CI runs formatting, linting, and tests but never checks for known CVEs in dependencies.

**Recommendation:** Add `cargo audit` and `npm audit` steps to the CI pipeline.

---

### 12. No Rate Limiting / Debouncing on Recording

**File:** `src-tauri/src/lib.rs:640-768`

Rapid press-release cycles each trigger a new HTTP transcription request with no cooldown.

**Recommendation:** Add a minimum recording duration check in the shortcut handler.

---

### 13. `.gitignore` Missing Key Entries

**File:** `.gitignore`

Missing entries for `.env` files (which could contain API keys), `*.wav` (temp recordings), and explicit `src-tauri/target/` coverage.

**Recommendation:** Add `.env`, `.env.*`, `*.wav`.

---

## MAINTAINABILITY

### 14. `lib.rs` Exceeds 800 Lines

**File:** `src-tauri/src/lib.rs` (804 lines)

Handles app init, tray icon, window management, 13 Tauri commands, shortcut callback logic, state definitions, and recording lifecycle. Violates single-responsibility principle.

**Recommendation:** Extract into focused modules: `commands.rs`, `tray.rs`, `window.rs`, `recording.rs`.

---

### 15. Duplicated AppleScript Paste Logic

**File:** `src-tauri/src/paste.rs:57-74` and `77-95`

Both `set_clipboard_and_paste()` and `paste_to_app()` contain identical AppleScript paste code.

**Recommendation:** Extract a `simulate_paste()` helper.

---

### 16. Hardcoded Magic Numbers for Window Dimensions

Window sizes scattered across multiple files with no named constants:
- `320` width: `lib.rs:96`, `lib.rs:341`
- `520` / `340`: `App.tsx:41-42`
- `36x36`: `lib.rs:354-355`

**Recommendation:** Define named constants.

---

### 17. No Integration Tests for Critical Paths

Critical paths are untested: the full recording-to-paste pipeline, error recovery, concurrent recording attempts, settings round-trips.

**Recommendation:** Add integration tests with mocked HTTP responses (using `mockito` or `wiremock`).

---

### 18. `ApiKeysConfig` Dead Code

**File:** `src-tauri/src/settings.rs:30-37`

Struct exists only for backwards compatibility with old settings files, annotated `#[allow(dead_code)]`.

**Recommendation:** Add one-time migration, then remove the struct.

---

## Prioritized Action Items

| Priority | Issue | Action |
|----------|-------|--------|
| **P0** | Overly broad shell permissions | Remove `shell:allow-execute` and `shell:allow-spawn` from capabilities |
| **P0** | CSP disabled | Set a restrictive CSP in `tauri.conf.json` |
| **P1** | Predictable temp file path | Use random/unique temp file names |
| **P1** | Mutex `.unwrap()` poisoning | Use `unwrap_or_else` or `parking_lot::Mutex` |
| **P1** | API error body leaked to UI | Sanitize error messages before emitting to frontend |
| **P2** | Non-atomic settings write | Use write-to-temp-then-rename pattern |
| **P2** | API key format validation | Add basic prefix checks |
| **P2** | Missing `.gitignore` entries | Add `.env`, `*.wav` |
| **P2** | Add `cargo audit` to CI | Catch known CVEs in dependencies |
| **P3** | Decompose `lib.rs` | Extract commands, tray, window, recording modules |
| **P3** | Duplicate paste logic | Extract `simulate_paste()` helper |
| **P3** | `tokio` features too broad | Reduce to minimal required features |
| **P3** | Add structured logging | Adopt `tracing` crate |
| **P3** | Integration tests | Add pipeline tests with mocked HTTP |
| **P3** | Recording debounce | Add minimum duration check |
| **P3** | Remove `ApiKeysConfig` dead code | Migrate and clean up |

# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Scrivano is a macOS voice-to-text tray application built with Tauri 2. Press-and-hold a global shortcut to record audio, release to transcribe via OpenAI/Groq Whisper API, and auto-paste at the cursor position. It runs as a menu bar app (no dock icon) using `ActivationPolicy::Accessory`.

## Common Commands

### Development
```bash
bun install                    # Install frontend dependencies
bun run tauri dev              # Run full app in dev mode (Vite + Rust)
```

### Frontend
```bash
bun run build                  # TypeScript compile + Vite build
bun run lint                   # ESLint
bun run lint:fix               # ESLint with auto-fix
bun run tsc --noEmit           # Type check only
bun run test                   # Vitest watch mode
bun run test:run               # Vitest single run
```

### Rust (run from `src-tauri/`)
```bash
cargo fmt -- --check           # Check formatting
cargo clippy --all-targets -- -D warnings   # Lint (CI treats warnings as errors)
cargo test                     # Run tests (some keychain tests are #[ignore])
cargo test -- --ignored        # Run ignored tests (requires macOS Keychain)
```

### Production Build
```bash
bun run tauri build            # Outputs .app bundle to src-tauri/target/release/bundle/macos/
```

## CI

CI runs on push/PR to `main` with two jobs:
- **Frontend**: bun install → tsc --noEmit → lint → vite build → test:run
- **Rust**: cargo fmt --check → clippy (warnings = errors) → cargo test

PR titles must follow conventional commits (e.g., `feat: ...`, `fix: ...`) with lowercase subject. Validated by `amannn/action-semantic-pull-request`.

## Architecture

### Two-Process Model
- **Rust backend** (`src-tauri/src/`): Audio capture, transcription API calls, clipboard/paste automation, settings, keychain storage, tray icon, global shortcut handling
- **React frontend** (`src/`): UI for main popup window and recording indicator overlay

### Multi-Window Setup
Both windows are built from separate HTML entry points via Vite multi-page config (`vite.config.ts`):
- **Main window** (`index.html` → `main.tsx` → `App.tsx`): 320x400 popup shown on tray click. Contains transcription display and settings UI.
- **Indicator window** (`indicator.html` → `indicator-main.tsx` → `Indicator.tsx`): 36x36 floating overlay shown near cursor during recording. Displays audio level bars and transcription spinner.

Window detection uses `__TAURI_INTERNALS__.metadata.currentWindow.label` (not query params — Tauri's asset protocol strips them).

### Recording Flow
1. User presses shortcut → `lib.rs` saves frontmost app bundle ID via `cursor.rs`
2. `audio.rs` starts cpal recording → writes WAV to `/tmp/scrivano_recording.wav`
3. Indicator window created/shown near cursor → original app re-activated via AppleScript (`paste.rs`) to prevent focus steal
4. Audio levels emitted every 512 samples as `audio-levels` event
5. User releases shortcut → recording stops → `transcription.rs` sends WAV to Whisper API
6. `paste.rs` re-activates original app → sets clipboard → simulates Cmd+V paste

### Cross-Window Communication
Uses Tauri global events (`app.emit()`, not `window.emit()`). Key events: `recording-status`, `transcription`, `audio-levels`, `indicator-state`, `error`. Frontend listens via `@tauri-apps/api/event`.

### Rust Modules
| File | Purpose |
|------|---------|
| `lib.rs` | App setup, tray, global shortcut handler, all Tauri commands, state management |
| `audio.rs` | cpal microphone capture, WAV encoding (hound), audio level computation |
| `transcription.rs` | OpenAI/Groq Whisper API client, hallucination filtering |
| `settings.rs` | JSON settings persistence (`~/.config/scrivano/settings.json`) |
| `keychain.rs` | macOS Keychain storage for API keys (service: "scrivano") |
| `paste.rs` | Clipboard (pbcopy), AppleScript paste automation, app activation |
| `cursor.rs` | Mouse position (Core Graphics), frontmost app detection (NSWorkspace), accessibility API |

### Key Gotchas
- **Accessibility permission**: `AXIsProcessTrustedWithOptions` with prompt must only be called once at startup, never on every shortcut press. Use `AXIsProcessTrustedWithOptions(null)` for runtime checks.
- **Whisper hallucinations**: Always pass `language=en` to reduce "you"/"Thank you" on silence/short audio.
- **Focus stealing**: Creating a Tauri window steals focus on macOS even with `focused(false)`. Must immediately re-activate the original app via AppleScript after window creation.
- **macOS permissions needed**: Microphone, Accessibility (System Settings), Automation (AppleScript). In dev mode, grant accessibility to the dev binary, not a .app bundle.

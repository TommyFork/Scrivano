# Scrivano

A macOS voice-to-text tray app built with Tauri 2.x. Press and hold a global hotkey to record audio, which is then transcribed via OpenAI's Whisper API and automatically pasted at your cursor position.

## Features

- **Tray app**: Runs in the macOS menu bar, no dock icon
- **Global hotkey**: Press and hold `Cmd+Shift+Space` to record
- **Whisper transcription**: Accurate speech-to-text via OpenAI API
- **Auto-paste**: Transcribed text is automatically pasted at cursor
- **Popup UI**: Click tray icon to view, edit, and copy transcriptions

## Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌─────────────────┐
│  System Tray    │────▶│  Tauri Backend   │◀───▶│  React Frontend │
│  (click=popup)  │     │  (Rust)          │     │  (popup window) │
└─────────────────┘     └──────────────────┘     └─────────────────┘
                               │
        ┌──────────────────────┼──────────────────────┐
        ▼                      ▼                      ▼
┌───────────────┐     ┌───────────────┐     ┌───────────────┐
│ Global Hotkey │     │ Audio Record  │     │ Whisper API   │
│ (press/hold)  │────▶│ (cpal/hound)  │────▶│ (transcribe)  │
└───────────────┘     └───────────────┘     └───────────────┘
                                                    │
                                                    ▼
                                           ┌───────────────┐
                                           │ Paste Text    │
                                           │ (AppleScript) │
                                           └───────────────┘
```

## Prerequisites

- macOS 11.0+
- Rust 1.70+
- Node.js 18+ or Bun
- OpenAI API key

## Setup

1. **Clone and install dependencies**:
   ```bash
   bun install
   ```

2. **Set your OpenAI API key**:
   ```bash
   export OPENAI_API_KEY="sk-your-api-key-here"
   ```

3. **Run in development mode**:
   ```bash
   bun run tauri dev
   ```

4. **Build for production**:
   ```bash
   bun run tauri build
   ```

## macOS Permissions

The app requires the following permissions:

1. **Microphone**: Prompted automatically on first recording
2. **Accessibility**: Required for global hotkeys and paste simulation
   - System Preferences → Privacy & Security → Accessibility → Enable Scrivano
3. **Automation**: Prompted when using AppleScript to paste

## Usage

1. The app runs in your menu bar (no dock icon)
2. **Press and hold** `Cmd+Shift+Space` to start recording
3. **Release** the hotkey to stop recording and trigger transcription
4. The transcribed text is automatically pasted at your cursor position
5. **Click** the tray icon to open the popup and:
   - View the last transcription
   - Edit the text before pasting again
   - Copy to clipboard

## Configuration

| Setting | Default | Description |
|---------|---------|-------------|
| `OPENAI_API_KEY` | (required) | Your OpenAI API key for Whisper |
| Hotkey | `Cmd+Shift+Space` | Global shortcut for recording |

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Tauri 2.x, Rust
- **Audio**: cpal (capture), hound (WAV encoding)
- **API**: OpenAI Whisper
- **Paste**: AppleScript automation

## Project Structure

```
src/                    # React frontend
  App.tsx              # Main UI component
  App.css              # Styles
src-tauri/             # Rust backend
  src/
    lib.rs             # Main app logic, tray, hotkeys
    audio.rs           # Audio recording
    transcription.rs   # Whisper API client
    paste.rs           # Clipboard and paste
  Cargo.toml           # Rust dependencies
  tauri.conf.json      # Tauri configuration
  capabilities/        # Permission capabilities
  entitlements.plist   # macOS entitlements
```

## License

MIT

# Scrivano

A macOS voice-to-text tray app built with Tauri 2.x. Press and hold a global hotkey to record audio, which is then transcribed via Whisper and automatically pasted at your cursor position.

## Features

- **Tray app**: Runs in the macOS menu bar, no dock icon
- **Global hotkey**: Press and hold `Cmd+Shift+Space` to record (customizable)
- **Multi-provider support**: Choose between OpenAI Whisper or Groq Whisper
- **In-app configuration**: Set API keys and preferences directly in the app
- **Auto-paste**: Transcribed text is automatically pasted at cursor
- **Popup UI**: Click tray icon to view, edit, and copy transcriptions

## Supported Transcription Providers

| Provider | Model | Speed | Notes |
|----------|-------|-------|-------|
| **OpenAI** | whisper-1 | ~Real-time | Original Whisper API |
| **Groq** | whisper-large-v3-turbo | 216x real-time | Faster & cheaper |

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
- API key for at least one provider (OpenAI or Groq)

## Setup

1. **Clone and install dependencies**:
   ```bash
   bun install
   ```

2. **Configure API keys** (choose one or both methods):

   **Option A: In-app configuration (recommended)**
   - Launch the app and click the settings gear icon
   - Enter your API key(s) in the API Keys section
   - Keys are stored securely in the macOS Keychain

   **Option B: Environment variables**
   ```bash
   # For OpenAI
   export OPENAI_API_KEY="sk-your-api-key-here"

   # For Groq
   export GROQ_API_KEY="gsk_your-api-key-here"
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
   - Access settings

## Configuration

Click the gear icon in the popup to access settings:

### API Keys
- **OpenAI**: Enter your OpenAI API key (starts with `sk-`)
- **Groq**: Enter your Groq API key (starts with `gsk_`)
- Keys configured in-app are stored securely in the **macOS Keychain**
- Keys can also be set via environment variables (keychain takes priority)

### Transcription Model
- Select your preferred provider from the available options
- Only providers with configured API keys will be selectable

### Recording Shortcut
- Customize the global hotkey for recording
- Default: `Cmd+Shift+Space`

## Settings Storage

**Settings** are stored in `~/.config/scrivano/settings.json`:
- Recording shortcut preferences
- Selected transcription provider

**API Keys** are stored securely in the **macOS Keychain** (under the service name "scrivano"):
- Keys are never written to disk in plaintext
- Access is protected by macOS security policies
- Keys can be managed via Keychain Access.app if needed

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite
- **Backend**: Tauri 2.x, Rust
- **Audio**: cpal (capture), hound (WAV encoding)
- **API**: OpenAI Whisper, Groq Whisper
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
    settings.rs        # Settings management
    keychain.rs        # Secure API key storage
    paste.rs           # Clipboard and paste
  Cargo.toml           # Rust dependencies
  tauri.conf.json      # Tauri configuration
  capabilities/        # Permission capabilities
  entitlements.plist   # macOS entitlements
```

## License

MIT

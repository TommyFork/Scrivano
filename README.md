<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="24" height="24">
  <path d="M5.70821,13.3496 C6.3327,11.4305 7.45808,8.97098 9.46459,6.96447 C13.3986,3.03043 19.1172,2.44872 19.2619,2.43416 C19.3386,2.42645 19.4974,2.41874 19.6844,2.48197 C19.8978,2.55415 20.0837,2.69913 20.2058,2.88827 C20.4141,3.20137 21.5853,5.17098 20.0147,7.5508 C19.9367,7.66899 19.8428,7.78418 19.7386,7.89549 C19.7513,8.01579 19.7422,8.14042 19.7083,8.26411 C19.5195,8.95363 19.2754,9.67684 18.9594,10.4002 C18.4079,11.6631 17.6313,12.9399 16.5357,14.0355 C14.4857,16.0855 11.7943,17.0271 9.69205,17.4663 C8.63099,17.688 7.69346,17.7872 7.0192,17.8311 C6.94619,17.8359 6.87619,17.84 6.80937,17.8436 C6.77801,18.0912 6.5,20.5711 6.5,21 C6.5,21.5523 6.05229,22 5.5,22 C4.94772,22 4.5,21.5522 4.5,21 C4.5,20.4288 4.6163,19.3305 4.72139,18.4398 C4.9257,16.7082 5.16676,15.0135 5.70821,13.3496 Z M18.3454,6.44911 C18.8723,5.65078 18.8645,4.96914 18.7599,4.52997 C17.2335,4.80498 13.5414,5.71605 10.8788,8.37868 C9.17534,10.0821 8.17939,12.2188 7.61005,13.9684 C7.37877,14.6792 7.22112,15.3161 7.1158,15.819 C7.69469,15.7732 8.44693,15.6832 9.28307,15.5086 C11.2031,15.1075 13.4615,14.2813 15.1214,12.6213 C15.9709,11.7719 16.6045,10.7636 17.0753,9.71555 C16.0989,10.2357 15.057,10.7017 14.3163,10.9486 C13.7923,11.1233 13.226,10.8401 13.0514,10.3162 C12.8767,9.79224 13.1599,9.22592 13.6838,9.05127 C14.3583,8.82646 15.4424,8.33773 16.4381,7.7857 C16.9324,7.51168 17.3842,7.23343 17.7394,6.97791 C18.1228,6.70212 18.2996,6.51857 18.3454,6.44911 Z" fill="white"/>
</svg>

A macOS voice-to-text tray app built with Tauri 2.x. Press and hold a global hotkey to record audio, which is then transcribed via Whisper and automatically pasted at your cursor position.

![Scrivano](https://github.com/user-attachments/assets/33d38cd3-5502-4b29-9005-59c14f79c1d6)

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

<h1 align="center">Scrivano</h1>

<p align="center">
  A macOS voice-to-text app that lives in your menu bar.<br/>
  Press and hold a hotkey to record, release to transcribe, and the text is pasted at your cursor.
</p>

<p align="center">
  <strong>macOS only</strong> — built exclusively for the Mac menu bar, Keychain, Accessibility APIs, and AppleScript ecosystem. Not available for Windows, Linux, iOS, or Android.
</p>

<p align="center">
  <img src="https://img.shields.io/badge/platform-macOS-blue" alt="macOS" />
  <img src="https://img.shields.io/badge/built_with-Tauri_2-orange" alt="Tauri 2" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-green" alt="MIT License" /></a>
</p>

<p align="center">
  <img src="https://github.com/user-attachments/assets/33d38cd3-5502-4b29-9005-59c14f79c1d6" alt="Scrivano" width="600" />
</p>

---

## How It Works

1. **Press and hold** `Cmd+Shift+Space` (customizable) to start recording
2. A small indicator appears near your cursor showing audio levels
3. **Release** the hotkey to stop recording and send audio to Whisper
4. The transcribed text is automatically pasted where your cursor is
5. Click the tray icon to view, edit, or copy the last transcription

No dock icon, no windows to manage — just hold, speak, release.

## Transcription Providers

| Provider | Model | Speed | Notes |
|----------|-------|-------|-------|
| **OpenAI** | whisper-1 | ~Real-time | Original Whisper API |
| **Groq** | whisper-large-v3-turbo | 216x real-time | Faster and cheaper |

You need an API key from at least one provider. Keys are stored in the macOS Keychain.

## Getting Started

### Prerequisites

- macOS 11.0+
- [Rust](https://rustup.rs/) 1.70+
- [Bun](https://bun.sh/) (or Node.js 18+)

### Install and Run

```bash
git clone https://github.com/TommyFork/Scrivano.git
cd Scrivano
bun install
bun run tauri dev
```

On first launch, configure your API key by clicking the tray icon and opening settings.

### Build for Production

```bash
bun run tauri build
```

The `.app` bundle is output to `src-tauri/target/release/bundle/macos/`.

## macOS Permissions

Scrivano needs three permissions to function:

| Permission | How It's Granted |
|-----------|-----------------|
| **Microphone** | Prompted automatically on first recording |
| **Accessibility** | System Settings → Privacy & Security → Accessibility → enable Scrivano |
| **Automation** | Prompted automatically when pasting via AppleScript |

> In development, grant Accessibility to the dev binary (e.g. the terminal running `tauri dev`), not a `.app` bundle.

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

**Frontend**: React 19 + TypeScript + Vite (two windows — main popup and floating indicator)

**Backend**: Tauri 2 + Rust — handles audio capture (`cpal`), WAV encoding (`hound`), Whisper API calls, clipboard/paste automation (AppleScript), macOS Keychain storage, and global shortcut management.

> **Why macOS only?** Scrivano is deeply integrated with macOS-specific APIs: menu bar tray (NSStatusItem via Tauri), Keychain for API key storage, Accessibility APIs for global hotkeys, AppleScript for paste automation and app activation, and Core Graphics for cursor tracking. These aren't portable to other platforms without fundamental redesign.

## License

MIT

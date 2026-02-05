import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import {
  createShortcutRecorder,
  formatShortcutForDisplay,
  type ShortcutRecorder,
  type KeyboardEventLike,
} from "./shortcutUtils";

interface ShortcutInfo {
  modifiers: string[];
  key: string;
  display: string;
}

const STATUS_DISPLAY_DURATION = 1500;

function App() {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Awaiting thy voice");
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [currentShortcut, setCurrentShortcut] = useState<ShortcutInfo | null>(null);
  const [pendingShortcut, setPendingShortcut] = useState<{ modifiers: string[]; key: string } | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const [isRecordingShortcutActive, setIsRecordingShortcutActive] = useState(false);
  const [liveDisplay, setLiveDisplay] = useState("");

  // Use a ref to hold the recorder so it persists across renders
  const recorderRef = useRef<ShortcutRecorder>(createShortcutRecorder());

  useEffect(() => {
    invoke<string>("get_transcription").then((t) => {
      if (t) setText(t);
    });
    invoke<boolean>("get_recording_status").then(setIsRecording);
    invoke<ShortcutInfo>("get_shortcut").then(setCurrentShortcut);

    const unlisteners = [
      listen<boolean>("recording-status", (e) => {
        setIsRecording(e.payload);
        setStatus(e.payload ? "Hearkening..." : "The quill doth write...");
        if (e.payload) setError("");
      }),
      listen<string>("transcription", (e) => {
        setText(e.payload);
        setStatus("Awaiting thy voice");
      }),
      listen<string>("transcription-status", (e) => setStatus(e.payload)),
      listen<string>("error", (e) => {
        setError(e.payload);
        setStatus("Error");
      }),
    ];

    // Auto-focus textarea when window gains focus
    const currentWindow = getCurrentWindow();
    const focusUnlisten = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused && textareaRef.current) {
        textareaRef.current.focus();
      }
    });

    // Initial focus
    requestAnimationFrame(() => textareaRef.current?.focus());

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
      focusUnlisten.then((fn) => fn());
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent) => {
      const isEscape =
        event.key === "Escape" ||
        event.key === "Esc" ||
        event.code === "Escape" ||
        event.keyCode === 27;

      if (isEscape) {
        event.preventDefault();
        event.stopPropagation();
        invoke("hide_window");
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
  }, []);

  const handleCopy = async () => {
    try {
      await invoke("copy_to_clipboard", { text });
      setError("");
      setStatus("'Tis copied!");
      setTimeout(() => setStatus("Awaiting thy voice"), STATUS_DISPLAY_DURATION);
    } catch (e) {
      setError(String(e));
    }
  };

  // Sync recorder state to React state
  const syncRecorderState = useCallback(() => {
    const recorder = recorderRef.current;
    const state = recorder.state;

    if (state.type === "complete") {
      setPendingShortcut(state.shortcut);
      setShortcutError("");
      setIsRecordingShortcutActive(false);
      setLiveDisplay("");
      recorder.cancel(); // Reset to idle
    } else if (state.type === "error") {
      setShortcutError(state.message);
      setPendingShortcut(null);
      setIsRecordingShortcutActive(false);
      setLiveDisplay("");
      recorder.cancel(); // Reset to idle
    } else if (state.type === "recording") {
      setLiveDisplay(recorder.getDisplay());
    }
  }, []);

  // Key down handler
  const handleShortcutKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isRecordingShortcutActive) {
      setPendingShortcut(null);
      setShortcutError("");
      setLiveDisplay("");
      recorderRef.current.start();
      setIsRecordingShortcutActive(true);
    }

    const keyEvent: KeyboardEventLike = {
      code: e.code,
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    };

    recorderRef.current.handleKeyDown(keyEvent);
    syncRecorderState();
  }, [isRecordingShortcutActive, syncRecorderState]);

  // Key up handler
  const handleShortcutKeyUp = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isRecordingShortcutActive) return;

    const keyEvent: KeyboardEventLike = {
      code: e.code,
      key: e.key,
      metaKey: e.metaKey,
      ctrlKey: e.ctrlKey,
      altKey: e.altKey,
      shiftKey: e.shiftKey,
    };

    recorderRef.current.handleKeyUp(keyEvent);
    syncRecorderState();
  }, [isRecordingShortcutActive, syncRecorderState]);

  const startRecordingShortcut = useCallback(() => {
    setPendingShortcut(null);
    setShortcutError("");
    setLiveDisplay("");
    recorderRef.current.start();
    setIsRecordingShortcutActive(true);
  }, []);

  const cancelRecordingShortcut = useCallback(() => {
    recorderRef.current.cancel();
    setPendingShortcut(null);
    setShortcutError("");
    setLiveDisplay("");
    setIsRecordingShortcutActive(false);
  }, []);

  const handleShortcutBlur = useCallback(() => {
    if (isRecordingShortcutActive) {
      cancelRecordingShortcut();
    }
  }, [isRecordingShortcutActive, cancelRecordingShortcut]);

  const saveShortcut = async () => {
    if (!pendingShortcut || shortcutError) return;

    try {
      const result = await invoke<ShortcutInfo>("set_shortcut", {
        modifiers: pendingShortcut.modifiers,
        key: pendingShortcut.key,
      });
      setCurrentShortcut(result);
      setPendingShortcut(null);
      setShortcutError("");
      setError("");
    } catch (e) {
      const message = String(e);
      const friendlyMessage = message.toLowerCase().includes("failed to register shortcut")
        ? "That shortcut is reserved by the system and cannot be registered. Try another."
        : message;
      setShortcutError(friendlyMessage);
    }
  };

  const formatPendingShortcut = (shortcut: { modifiers: string[]; key: string }): string => {
    return formatShortcutForDisplay(shortcut.modifiers, shortcut.key);
  };

  if (showSettings) {
    return (
      <div className="container">
        <div className="header">
          <span className="status-text">Configuration</span>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="content settings-content">
          <div className="settings-section">
            <label className="settings-label">Recording Shortcut</label>
            <p className="settings-description">
              Press and hold this key combination to record thy voice.
            </p>

            {shortcutError && (
              <div className="shortcut-error-box">
                <span className="shortcut-error-icon">⚠</span>
                <span>{shortcutError}</span>
              </div>
            )}

            <div className={`shortcut-display ${isRecordingShortcutActive ? "shortcut-display-recording" : ""} ${shortcutError ? "shortcut-display-error" : ""}`}>
              {isRecordingShortcutActive || pendingShortcut ? (
                <input
                  type="text"
                  className="shortcut-input"
                  placeholder="Press thy keys..."
                  value={isRecordingShortcutActive ? liveDisplay : pendingShortcut ? formatPendingShortcut(pendingShortcut) : ""}
                  onKeyDown={handleShortcutKeyDown}
                  onKeyUp={handleShortcutKeyUp}
                  onBlur={handleShortcutBlur}
                  autoFocus
                  readOnly
                />
              ) : (
                <span className="shortcut-current">{currentShortcut?.display || "⌘⇧Space"}</span>
              )}
            </div>

            <div className="shortcut-actions">
              {isRecordingShortcutActive ? (
                <button onClick={cancelRecordingShortcut} className="btn">
                  Cease
                </button>
              ) : pendingShortcut ? (
                <>
                  <button onClick={saveShortcut} className="btn primary">
                    Inscribe
                  </button>
                  <button onClick={cancelRecordingShortcut} className="btn">
                    Discard
                  </button>
                </>
              ) : shortcutError ? (
                <button onClick={startRecordingShortcut} className="btn">
                  Try Again
                </button>
              ) : (
                <button onClick={startRecordingShortcut} className="btn">
                  Change
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="actions">
          <button onClick={() => { setShowSettings(false); setShortcutError(""); setPendingShortcut(null); }} className="btn primary">
            Return
          </button>
        </div>

        <div className="hint">Configure thy scribe's instruments</div>
      </div>
    );
  }

  return (
    <div className="container" tabIndex={0} ref={(el) => el?.focus()}>
      <div className="header">
        <div className={`status-indicator ${isRecording ? "recording" : ""}`} />
        <span className="status-text">{status}</span>
        <button className="settings-btn" onClick={() => setShowSettings(true)} title="Settings">
          ⚙
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="content">
        <textarea
          ref={textareaRef}
          className="edit-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={`Speak unto the aether with ${currentShortcut?.display || "⌘⇧Space"}`}
          aria-label="Transcription text"
          spellCheck={false}
        />
      </div>

      <div className="actions">
        <button onClick={handleCopy} className="btn" disabled={!text}>Duplicate</button>
      </div>

      <div className="hint">Summon the scribe: {currentShortcut?.display || "⌘⇧Space"}</div>
    </div>
  );
}

export default App;

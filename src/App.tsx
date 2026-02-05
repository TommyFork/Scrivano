import { useState, useEffect, useRef, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
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

function App() {
  const [transcription, setTranscription] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Awaiting thy voice");
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState("");

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const [currentShortcut, setCurrentShortcut] = useState<ShortcutInfo | null>(null);
  const [pendingShortcut, setPendingShortcut] = useState<{ modifiers: string[]; key: string } | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [liveDisplay, setLiveDisplay] = useState("");

  // Use a ref to hold the recorder so it persists across renders
  const recorderRef = useRef<ShortcutRecorder>(createShortcutRecorder());

  useEffect(() => {
    invoke<string>("get_transcription").then(setTranscription);
    invoke<boolean>("get_recording_status").then(setIsRecording);
    invoke<ShortcutInfo>("get_shortcut").then(setCurrentShortcut);

    const unlisteners = [
      listen<boolean>("recording-status", (e) => {
        setIsRecording(e.payload);
        setStatus(e.payload ? "Hearkening..." : "The quill doth write...");
        if (e.payload) setError("");
      }),
      listen<string>("transcription", (e) => {
        setTranscription(e.payload);
        setStatus("Awaiting thy voice");
      }),
      listen<string>("transcription-status", (e) => setStatus(e.payload)),
      listen<string>("error", (e) => {
        setError(e.payload);
        setStatus("Error");
      }),
    ];

    return () => { unlisteners.forEach((p) => p.then((fn) => fn())); };
  }, []);

  const handleCopy = async () => {
    try {
      await invoke("copy_to_clipboard", { text: transcription });
      setError("");
      setStatus("'Tis copied!");
      setTimeout(() => setStatus("Awaiting thy voice"), 1500);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSaveEdit = async () => {
    setTranscription(editText);
    setIsEditing(false);
    try {
      await invoke("paste_text", { text: editText });
      setError("");
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
      setIsRecordingShortcut(false);
      setLiveDisplay("");
      recorder.cancel(); // Reset to idle
    } else if (state.type === "error") {
      setShortcutError(state.message);
      setPendingShortcut(null);
      setIsRecordingShortcut(false);
      setLiveDisplay("");
      recorder.cancel(); // Reset to idle
    } else if (state.type === "recording") {
      setLiveDisplay(recorder.getDisplay());
    }
  }, []);

  // Key down handler
  const handleShortcutKeyDown = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isRecordingShortcut) {
      setPendingShortcut(null);
      setShortcutError("");
      setLiveDisplay("");
      recorderRef.current.start();
      setIsRecordingShortcut(true);
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
  }, [isRecordingShortcut, syncRecorderState]);

  // Key up handler
  const handleShortcutKeyUp = useCallback((e: React.KeyboardEvent<HTMLInputElement>) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isRecordingShortcut) return;

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
  }, [isRecordingShortcut, syncRecorderState]);

  const startRecordingShortcut = useCallback(() => {
    setPendingShortcut(null);
    setShortcutError("");
    setLiveDisplay("");
    recorderRef.current.start();
    setIsRecordingShortcut(true);
  }, []);

  const cancelRecordingShortcut = useCallback(() => {
    recorderRef.current.cancel();
    setPendingShortcut(null);
    setShortcutError("");
    setLiveDisplay("");
    setIsRecordingShortcut(false);
  }, []);

  const handleShortcutBlur = useCallback(() => {
    if (isRecordingShortcut) {
      cancelRecordingShortcut();
    }
  }, [isRecordingShortcut, cancelRecordingShortcut]);

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

            <div className={`shortcut-display ${isRecordingShortcut ? "shortcut-display-recording" : ""} ${shortcutError ? "shortcut-display-error" : ""}`}>
              {isRecordingShortcut || pendingShortcut ? (
                <input
                  type="text"
                  className="shortcut-input"
                  placeholder="Press thy keys..."
                  value={isRecordingShortcut ? liveDisplay : pendingShortcut ? formatPendingShortcut(pendingShortcut) : ""}
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
              {isRecordingShortcut ? (
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
    <div className="container">
      <div className="header">
        <div className={`status-indicator ${isRecording ? "recording" : ""}`} />
        <span className="status-text">{status}</span>
        <button className="settings-btn" onClick={() => setShowSettings(true)} title="Settings">
          ⚙
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="content">
        {isEditing ? (
          <textarea
            className="edit-area"
            value={editText}
            onChange={(e) => setEditText(e.target.value)}
            autoFocus
          />
        ) : (
          <div className="transcription">
            {transcription || `Speak unto the aether with ${currentShortcut?.display || "⌘⇧Space"}`}
          </div>
        )}
      </div>

      <div className="actions">
        {isEditing ? (
          <>
            <button onClick={handleSaveEdit} className="btn primary">Inscribe</button>
            <button onClick={() => setIsEditing(false)} className="btn">Withdraw</button>
          </>
        ) : (
          <>
            <button onClick={handleCopy} className="btn" disabled={!transcription}>Duplicate</button>
            <button onClick={() => { setEditText(transcription); setIsEditing(true); }} className="btn" disabled={!transcription}>Amend</button>
          </>
        )}
      </div>

      <div className="hint">Summon the scribe: {currentShortcut?.display || "⌘⇧Space"}</div>
    </div>
  );
}

export default App;

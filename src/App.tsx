import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

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
  const [isRecordingShortcut, setIsRecordingShortcut] = useState(false);
  const [pendingShortcut, setPendingShortcut] = useState<{ modifiers: string[]; key: string } | null>(null);

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

  // Shortcut recording handler
  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!isRecordingShortcut) return;

    e.preventDefault();
    e.stopPropagation();

    // Collect modifiers
    const modifiers: string[] = [];
    if (e.metaKey) modifiers.push("super");
    if (e.shiftKey) modifiers.push("shift");
    if (e.ctrlKey) modifiers.push("ctrl");
    if (e.altKey) modifiers.push("alt");

    // Map key code to our key format
    const keyMap: Record<string, string> = {
      Space: "Space",
      Enter: "Enter",
      Tab: "Tab",
      Escape: "Escape",
      Backspace: "Backspace",
      Delete: "Delete",
      Insert: "Insert",
      Home: "Home",
      End: "End",
      PageUp: "PageUp",
      PageDown: "PageDown",
      ArrowUp: "ArrowUp",
      ArrowDown: "ArrowDown",
      ArrowLeft: "ArrowLeft",
      ArrowRight: "ArrowRight",
      Minus: "Minus",
      Equal: "Equal",
      BracketLeft: "BracketLeft",
      BracketRight: "BracketRight",
      Backslash: "Backslash",
      Semicolon: "Semicolon",
      Quote: "Quote",
      Backquote: "Backquote",
      Comma: "Comma",
      Period: "Period",
      Slash: "Slash",
    };

    let key = "";

    // Check for letter keys
    if (e.code.startsWith("Key")) {
      key = e.code.replace("Key", "").toLowerCase();
    }
    // Check for digit keys
    else if (e.code.startsWith("Digit")) {
      key = e.code.replace("Digit", "");
    }
    // Check for function keys
    else if (e.code.startsWith("F") && /^F\d+$/.test(e.code)) {
      key = e.code;
    }
    // Check mapped keys
    else if (keyMap[e.code]) {
      key = keyMap[e.code];
    }
    // Skip if it's just a modifier key
    else if (["Meta", "Shift", "Control", "Alt"].includes(e.key)) {
      return;
    }

    // Must have at least one modifier and a key
    if (modifiers.length > 0 && key) {
      setPendingShortcut({ modifiers, key });
      setIsRecordingShortcut(false);
    }
  }, [isRecordingShortcut]);

  useEffect(() => {
    if (isRecordingShortcut) {
      window.addEventListener("keydown", handleKeyDown);
      return () => window.removeEventListener("keydown", handleKeyDown);
    }
  }, [isRecordingShortcut, handleKeyDown]);

  const startRecordingShortcut = () => {
    setPendingShortcut(null);
    setIsRecordingShortcut(true);
  };

  const cancelRecordingShortcut = () => {
    setIsRecordingShortcut(false);
    setPendingShortcut(null);
  };

  const saveShortcut = async () => {
    if (!pendingShortcut) return;

    try {
      const result = await invoke<ShortcutInfo>("set_shortcut", {
        modifiers: pendingShortcut.modifiers,
        key: pendingShortcut.key,
      });
      setCurrentShortcut(result);
      setPendingShortcut(null);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };

  const formatPendingShortcut = (shortcut: { modifiers: string[]; key: string }) => {
    const modSymbols: Record<string, string> = {
      super: "⌘",
      shift: "⇧",
      ctrl: "⌃",
      alt: "⌥",
    };
    const parts = shortcut.modifiers.map(m => modSymbols[m] || m);
    const keyDisplay = shortcut.key.length === 1 ? shortcut.key.toUpperCase() : shortcut.key;
    return parts.join("") + keyDisplay;
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
              Press and hold this key combination to record thy voice
            </p>

            <div className="shortcut-display">
              {isRecordingShortcut ? (
                <span className="shortcut-recording">Press thy keys...</span>
              ) : pendingShortcut ? (
                <span className="shortcut-pending">{formatPendingShortcut(pendingShortcut)}</span>
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
              ) : (
                <button onClick={startRecordingShortcut} className="btn">
                  Change
                </button>
              )}
            </div>
          </div>
        </div>

        <div className="actions">
          <button onClick={() => setShowSettings(false)} className="btn primary">
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

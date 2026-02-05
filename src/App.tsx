import { useState, useEffect, useRef } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";

const STATUS_DISPLAY_DURATION = 1500;

function App() {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Awaiting thy voice");
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  useEffect(() => {
    invoke<string>("get_transcription").then((t) => {
      if (t) setText(t);
    });
    invoke<boolean>("get_recording_status").then(setIsRecording);

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

  return (
    <div className="container">
      <div className="header">
        <div className={`status-indicator ${isRecording ? "recording" : ""}`} />
        <span className="status-text">{status}</span>
      </div>

      {error && <div className="error">{error}</div>}

      <div className="content">
        <textarea
          ref={textareaRef}
          className="edit-area"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Speak unto the aether with Cmd+Shift+Space"
          aria-label="Transcription text"
          spellCheck={false}
        />
      </div>

      <div className="actions">
        <button onClick={handleCopy} className="btn" disabled={!text}>Duplicate</button>
      </div>

      <div className="hint">Summon the scribe: Cmd+Shift+Space</div>
    </div>
  );
}

export default App;

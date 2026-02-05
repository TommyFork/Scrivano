import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

function App() {
  const [transcription, setTranscription] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Awaiting thy voice");
  const [isEditing, setIsEditing] = useState(false);
  const [editText, setEditText] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    invoke<string>("get_transcription").then(setTranscription);
    invoke<boolean>("get_recording_status").then(setIsRecording);

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

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
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

  return (
    <div className="container" tabIndex={0} ref={(el) => el?.focus()}>
      <div className="header">
        <div className={`status-indicator ${isRecording ? "recording" : ""}`} />
        <span className="status-text">{status}</span>
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
            {transcription || "Speak unto the aether with Cmd+Shift+Space"}
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

      <div className="hint">Summon the scribe: Cmd+Shift+Space</div>
    </div>
  );
}

export default App;

import { useState, useEffect, useCallback } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import "./App.css";

interface ShortcutInfo {
  modifiers: string[];
  key: string;
  display: string;
}

interface ApiKeyStatus {
  openai_configured: boolean;
  groq_configured: boolean;
  openai_source: string | null;
  groq_source: string | null;
}

interface ProviderInfo {
  id: string;
  name: string;
  model: string;
  available: boolean;
}

interface TranscriptionSettings {
  provider: string;
  model: string;
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

  // API Keys state
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);

  // Provider/Model state
  const [providers, setProviders] = useState<ProviderInfo[]>([]);
  const [transcriptionSettings, setTranscriptionSettings] = useState<TranscriptionSettings | null>(null);

  useEffect(() => {
    invoke<string>("get_transcription").then(setTranscription);
    invoke<boolean>("get_recording_status").then(setIsRecording);
    invoke<ShortcutInfo>("get_shortcut").then(setCurrentShortcut);
    invoke<ApiKeyStatus>("get_api_key_status").then(setApiKeyStatus);
    invoke<ProviderInfo[]>("get_available_providers").then(setProviders);
    invoke<TranscriptionSettings>("get_transcription_settings").then(setTranscriptionSettings);

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

  // API Key handlers
  const handleSaveApiKey = async (provider: "openai" | "groq") => {
    setApiKeySaving(true);
    try {
      const keyValue = provider === "openai" ? openaiKeyInput : groqKeyInput;
      const result = await invoke<ApiKeyStatus>("set_api_key", {
        provider,
        apiKey: keyValue,
      });
      setApiKeyStatus(result);

      // Clear input after successful save
      if (provider === "openai") setOpenaiKeyInput("");
      else setGroqKeyInput("");

      // Refresh providers list
      const updatedProviders = await invoke<ProviderInfo[]>("get_available_providers");
      setProviders(updatedProviders);

      setError("");
    } catch (e) {
      setError(String(e));
    }
    setApiKeySaving(false);
  };

  const handleClearApiKey = async (provider: "openai" | "groq") => {
    setApiKeySaving(true);
    try {
      const result = await invoke<ApiKeyStatus>("set_api_key", {
        provider,
        apiKey: "",
      });
      setApiKeyStatus(result);

      // Refresh providers list
      const updatedProviders = await invoke<ProviderInfo[]>("get_available_providers");
      setProviders(updatedProviders);

      // If the cleared provider was selected, switch to another if available
      if (transcriptionSettings?.provider === provider) {
        const otherProvider = updatedProviders.find(p => p.available && p.id !== provider);
        if (otherProvider) {
          await handleProviderChange(otherProvider.id);
        }
      }

      setError("");
    } catch (e) {
      setError(String(e));
    }
    setApiKeySaving(false);
  };

  const handleProviderChange = async (providerId: string) => {
    try {
      const result = await invoke<TranscriptionSettings>("set_transcription_provider", {
        provider: providerId,
      });
      setTranscriptionSettings(result);
      setError("");
    } catch (e) {
      setError(String(e));
    }
  };

  const hasAnyApiKey = apiKeyStatus?.openai_configured || apiKeyStatus?.groq_configured;

  if (showSettings) {
    return (
      <div className="container">
        <div className="header">
          <span className="status-text">Configuration</span>
        </div>

        {error && <div className="error">{error}</div>}

        <div className="content settings-content">
          {/* API Keys Section */}
          <div className="settings-section">
            <label className="settings-label">API Keys</label>
            <p className="settings-description">
              Configure thy transcription services
            </p>

            {/* OpenAI Key */}
            <div className="api-key-row">
              <div className="api-key-header">
                <span className="api-key-label">OpenAI</span>
                {apiKeyStatus?.openai_configured && (
                  <span className="api-key-status configured">
                    {apiKeyStatus.openai_source === "env" ? "(from env)" : "Configured"}
                  </span>
                )}
              </div>
              <div className="api-key-input-row">
                <input
                  type={showOpenaiKey ? "text" : "password"}
                  className="api-key-input"
                  placeholder={apiKeyStatus?.openai_configured ? "••••••••••••" : "sk-..."}
                  value={openaiKeyInput}
                  onChange={(e) => setOpenaiKeyInput(e.target.value)}
                />
                <button
                  className="api-key-toggle"
                  onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                  title={showOpenaiKey ? "Hide" : "Reveal"}
                >
                  {showOpenaiKey ? "◉" : "◎"}
                </button>
                <button
                  className="btn small"
                  onClick={() => handleSaveApiKey("openai")}
                  disabled={apiKeySaving || !openaiKeyInput.trim()}
                >
                  Save
                </button>
                {apiKeyStatus?.openai_configured && apiKeyStatus.openai_source === "settings" && (
                  <button
                    className="btn small danger"
                    onClick={() => handleClearApiKey("openai")}
                    disabled={apiKeySaving}
                    title="Remove saved key"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Groq Key */}
            <div className="api-key-row">
              <div className="api-key-header">
                <span className="api-key-label">Groq</span>
                {apiKeyStatus?.groq_configured && (
                  <span className="api-key-status configured">
                    {apiKeyStatus.groq_source === "env" ? "(from env)" : "Configured"}
                  </span>
                )}
              </div>
              <div className="api-key-input-row">
                <input
                  type={showGroqKey ? "text" : "password"}
                  className="api-key-input"
                  placeholder={apiKeyStatus?.groq_configured ? "••••••••••••" : "gsk_..."}
                  value={groqKeyInput}
                  onChange={(e) => setGroqKeyInput(e.target.value)}
                />
                <button
                  className="api-key-toggle"
                  onClick={() => setShowGroqKey(!showGroqKey)}
                  title={showGroqKey ? "Hide" : "Reveal"}
                >
                  {showGroqKey ? "◉" : "◎"}
                </button>
                <button
                  className="btn small"
                  onClick={() => handleSaveApiKey("groq")}
                  disabled={apiKeySaving || !groqKeyInput.trim()}
                >
                  Save
                </button>
                {apiKeyStatus?.groq_configured && apiKeyStatus.groq_source === "settings" && (
                  <button
                    className="btn small danger"
                    onClick={() => handleClearApiKey("groq")}
                    disabled={apiKeySaving}
                    title="Remove saved key"
                  >
                    Clear
                  </button>
                )}
              </div>
            </div>

            {/* Warning if no keys configured */}
            {apiKeyStatus && !hasAnyApiKey && (
              <div className="warning">
                No API keys configured. Transcription will not function.
              </div>
            )}
          </div>

          {/* Transcription Model Section */}
          <div className="settings-section">
            <label className="settings-label">Transcription Model</label>
            <p className="settings-description">
              Choose thy oracle of speech
            </p>

            <div className="model-selector">
              {providers.map((provider) => (
                <button
                  key={provider.id}
                  className={`model-option ${
                    transcriptionSettings?.provider === provider.id ? "selected" : ""
                  } ${!provider.available ? "disabled" : ""}`}
                  onClick={() => provider.available && handleProviderChange(provider.id)}
                  disabled={!provider.available}
                  title={!provider.available ? "API key not configured" : undefined}
                >
                  <span className="model-name">{provider.name}</span>
                  <span className="model-id">{provider.model}</span>
                  {!provider.available && <span className="model-unavailable">No key</span>}
                </button>
              ))}
            </div>
          </div>

          {/* Shortcut Section */}
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

      {/* Show setup required if no API keys */}
      {apiKeyStatus && !hasAnyApiKey && (
        <div className="content">
          <div className="setup-required">
            <p>The scribe requires configuration.</p>
            <p className="setup-hint">Please add an API key to begin transcription.</p>
            <button className="btn primary" onClick={() => setShowSettings(true)}>
              Open Settings
            </button>
          </div>
        </div>
      )}

      {/* Normal content when API keys are configured */}
      {hasAnyApiKey && (
        <>
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

          <div className="hint">
            {transcriptionSettings && (
              <span className="current-model">{transcriptionSettings.model}</span>
            )}
            {" "}Summon the scribe: {currentShortcut?.display || "⌘⇧Space"}
          </div>
        </>
      )}
    </div>
  );
}

export default App;

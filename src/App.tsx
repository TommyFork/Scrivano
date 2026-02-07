import { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
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
  const [pendingShortcut, setPendingShortcut] = useState<{ modifiers: string[]; key: string } | null>(null);
  const [shortcutError, setShortcutError] = useState("");
  const [isRecordingShortcutActive, setIsRecordingShortcutActive] = useState(false);
  const [liveDisplay, setLiveDisplay] = useState("");

  // Use a ref to hold the recorder so it persists across renders
  const recorderRef = useRef<ShortcutRecorder>(createShortcutRecorder());

  // API Keys state
  const [apiKeyStatus, setApiKeyStatus] = useState<ApiKeyStatus | null>(null);
  const [openaiKeyInput, setOpenaiKeyInput] = useState("");
  const [groqKeyInput, setGroqKeyInput] = useState("");
  const [showOpenaiKey, setShowOpenaiKey] = useState(false);
  const [showGroqKey, setShowGroqKey] = useState(false);
  const [apiKeySaving, setApiKeySaving] = useState(false);
  const [editingProvider, setEditingProvider] = useState<"openai" | "groq" | null>(null);

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

      // Clear input and exit edit mode
      if (provider === "openai") setOpenaiKeyInput("");
      else setGroqKeyInput("");
      setEditingProvider(null);

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

            {/* Warning if no keys configured - shown above keys */}
            {apiKeyStatus && !hasAnyApiKey && (
              <div className="warning">
                No API keys configured. Transcription will not function.
              </div>
            )}

            {/* OpenAI Key */}
            <div className="api-key-row">
              <div className="api-key-header">
                <span className="api-key-label">OpenAI</span>
                {apiKeyStatus?.openai_configured && (
                  <span className="api-key-status configured">
                    {apiKeyStatus.openai_source === "env" ? "from env" : "configured"}
                  </span>
                )}
              </div>
              {apiKeyStatus?.openai_configured && editingProvider !== "openai" ? (
                <div className="api-key-input-row">
                  <div className="api-key-display">••••••••••••••••</div>
                  <button
                    className="btn small"
                    onClick={() => { setOpenaiKeyInput(""); setEditingProvider("openai"); }}
                  >
                    Edit
                  </button>
                  {apiKeyStatus.openai_source === "keychain" && (
                    <button
                      className="api-key-clear"
                      onClick={() => handleClearApiKey("openai")}
                      disabled={apiKeySaving}
                      title="Remove key"
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <div className="api-key-input-row">
                  <div className="api-key-input-wrapper">
                    <input
                      type={showOpenaiKey ? "text" : "password"}
                      className="api-key-input"
                      placeholder="sk-..."
                      value={openaiKeyInput}
                      onChange={(e) => setOpenaiKeyInput(e.target.value)}
                      autoFocus={editingProvider === "openai"}
                    />
                    {openaiKeyInput && (
                      <button
                        className="api-key-eye"
                        onClick={() => setShowOpenaiKey(!showOpenaiKey)}
                        title={showOpenaiKey ? "Conceal" : "Reveal"}
                        tabIndex={-1}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                          {showOpenaiKey && <line x1="1" y1="1" x2="23" y2="23" />}
                        </svg>
                      </button>
                    )}
                  </div>
                  <button
                    className="btn small"
                    onClick={() => handleSaveApiKey("openai")}
                    disabled={apiKeySaving || !openaiKeyInput.trim()}
                  >
                    Save
                  </button>
                  {editingProvider === "openai" && (
                    <button
                      className="btn small"
                      onClick={() => { setOpenaiKeyInput(""); setEditingProvider(null); }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Groq Key */}
            <div className="api-key-row">
              <div className="api-key-header">
                <span className="api-key-label">Groq</span>
                {apiKeyStatus?.groq_configured && (
                  <span className="api-key-status configured">
                    {apiKeyStatus.groq_source === "env" ? "from env" : "configured"}
                  </span>
                )}
              </div>
              {apiKeyStatus?.groq_configured && editingProvider !== "groq" ? (
                <div className="api-key-input-row">
                  <div className="api-key-display">••••••••••••••••</div>
                  <button
                    className="btn small"
                    onClick={() => { setGroqKeyInput(""); setEditingProvider("groq"); }}
                  >
                    Edit
                  </button>
                  {apiKeyStatus.groq_source === "keychain" && (
                    <button
                      className="api-key-clear"
                      onClick={() => handleClearApiKey("groq")}
                      disabled={apiKeySaving}
                      title="Remove key"
                    >
                      ×
                    </button>
                  )}
                </div>
              ) : (
                <div className="api-key-input-row">
                  <div className="api-key-input-wrapper">
                    <input
                      type={showGroqKey ? "text" : "password"}
                      className="api-key-input"
                      placeholder="gsk_..."
                      value={groqKeyInput}
                      onChange={(e) => setGroqKeyInput(e.target.value)}
                      autoFocus={editingProvider === "groq"}
                    />
                    {groqKeyInput && (
                      <button
                        className="api-key-eye"
                        onClick={() => setShowGroqKey(!showGroqKey)}
                        title={showGroqKey ? "Conceal" : "Reveal"}
                        tabIndex={-1}
                      >
                        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                          <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                          <circle cx="12" cy="12" r="3" />
                          {showGroqKey && <line x1="1" y1="1" x2="23" y2="23" />}
                        </svg>
                      </button>
                    )}
                  </div>
                  <button
                    className="btn small"
                    onClick={() => handleSaveApiKey("groq")}
                    disabled={apiKeySaving || !groqKeyInput.trim()}
                  >
                    Save
                  </button>
                  {editingProvider === "groq" && (
                    <button
                      className="btn small"
                      onClick={() => { setGroqKeyInput(""); setEditingProvider(null); }}
                    >
                      Cancel
                    </button>
                  )}
                </div>
              )}
            </div>
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

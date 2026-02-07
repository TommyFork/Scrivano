import React, { useState, useEffect, useRef, useCallback, type KeyboardEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen } from "@tauri-apps/api/event";
import { getCurrentWindow } from "@tauri-apps/api/window";
import "./App.css";
import {
  createShortcutRecorder,
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

type SectionId = "model" | "shortcut" | "apikeys";

const STATUS_DISPLAY_DURATION = 1500;
const SETTINGS_HEIGHT = 520;
const MAIN_HEIGHT = 340;

function CollapsibleSection({
  id,
  title,
  openSection,
  onToggle,
  children,
}: {
  id: SectionId;
  title: string;
  openSection: SectionId | null;
  onToggle: (id: SectionId) => void;
  children: React.ReactNode;
}) {
  const isOpen = openSection === id;
  return (
    <div className="collapsible-section">
      <button className="section-header" onClick={() => onToggle(id)}>
        <span className="section-title">{title}</span>
        <span className={`section-chevron ${isOpen ? "open" : ""}`}>&#x25B8;</span>
      </button>
      {isOpen && <div className="section-body">{children}</div>}
    </div>
  );
}

function App() {
  const [text, setText] = useState("");
  const [isRecording, setIsRecording] = useState(false);
  const [status, setStatus] = useState("Ready");
  const [error, setError] = useState("");
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);

  // Settings state
  const [showSettings, setShowSettings] = useState(false);
  const showSettingsRef = useRef(false);
  const [openSection, setOpenSection] = useState<SectionId | null>("model");
  const [currentShortcut, setCurrentShortcut] = useState<ShortcutInfo | null>(null);
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

  // Keep ref in sync with state
  useEffect(() => {
    showSettingsRef.current = showSettings;
  }, [showSettings]);

  useEffect(() => {
    invoke<string>("get_transcription").then((t) => {
      if (t) setText(t);
    });
    invoke<boolean>("get_recording_status").then(setIsRecording);
    invoke<ShortcutInfo>("get_shortcut").then(setCurrentShortcut);
    invoke<ApiKeyStatus>("get_api_key_status").then(setApiKeyStatus);
    invoke<ProviderInfo[]>("get_available_providers").then(setProviders);
    invoke<TranscriptionSettings>("get_transcription_settings").then(setTranscriptionSettings);

    const unlisteners = [
      listen<boolean>("recording-status", (e) => {
        setIsRecording(e.payload);
        setStatus(e.payload ? "Recording..." : "Transcribing...");
        if (e.payload) setError("");
      }),
      listen<string>("transcription", (e) => {
        setText(e.payload);
        setStatus("Ready");
      }),
      listen<string>("transcription-status", (e) => setStatus(e.payload)),
      listen<string>("error", (e) => {
        setError(e.payload);
        setStatus("Error");
      }),
    ];

    // Auto-focus textarea when window gains focus, reset settings on blur
    const currentWindow = getCurrentWindow();
    const focusUnlisten = currentWindow.onFocusChanged(({ payload: focused }) => {
      if (focused) {
        if (textareaRef.current) {
          textareaRef.current.focus();
        }
      } else if (showSettingsRef.current) {
        // Window lost focus while settings open: discard and reset
        setShowSettings(false);
        setShortcutError("");
        setIsRecordingShortcutActive(false);
        setLiveDisplay("");
        setEditingProvider(null);
        setOpenaiKeyInput("");
        setGroqKeyInput("");
        invoke("resize_window", { height: MAIN_HEIGHT }).catch(() => {});
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

        if (isRecordingShortcutActive) {
          // Cancel shortcut recording on Escape
          cancelRecordingShortcut();
          return;
        }

        if (showSettingsRef.current) {
          closeSettings();
          return;
        }

        invoke("hide_window");
      }
    };

    document.addEventListener("keydown", handleKeyDown, true);
    return () => document.removeEventListener("keydown", handleKeyDown, true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isRecordingShortcutActive]);

  const openSettings = useCallback(() => {
    setShowSettings(true);
    setOpenSection("model");
    invoke("resize_window", { height: SETTINGS_HEIGHT }).catch(() => {});
  }, []);

  const closeSettings = useCallback(() => {
    setShowSettings(false);
    setShortcutError("");
    setIsRecordingShortcutActive(false);
    setLiveDisplay("");
    setEditingProvider(null);
    setOpenaiKeyInput("");
    setGroqKeyInput("");
    invoke("resize_window", { height: MAIN_HEIGHT }).catch(() => {});
  }, []);

  const handleCopy = async () => {
    try {
      await invoke("copy_to_clipboard", { text });
      setError("");
      setStatus("Copied!");
      setTimeout(() => setStatus("Ready"), STATUS_DISPLAY_DURATION);
    } catch (e) {
      setError(String(e));
    }
  };

  const handleSectionToggle = useCallback((id: SectionId) => {
    setOpenSection((prev) => (prev === id ? null : id));
  }, []);

  // ── Shortcut recording (simplified: click box → press keys → release auto-saves) ──

  const syncRecorderState = useCallback(() => {
    const recorder = recorderRef.current;
    const state = recorder.state;

    if (state.type === "complete") {
      // Auto-save on completion
      const shortcut = state.shortcut;
      setLiveDisplay("");
      setIsRecordingShortcutActive(false);
      recorder.cancel(); // Reset to idle

      invoke<ShortcutInfo>("set_shortcut", {
        modifiers: shortcut.modifiers,
        key: shortcut.key,
      })
        .then((result) => {
          setCurrentShortcut(result);
          setShortcutError("");
          setError("");
        })
        .catch((e) => {
          const message = String(e);
          const friendlyMessage = message.toLowerCase().includes("failed to register shortcut")
            ? "That shortcut is reserved by the system. Try another."
            : message;
          setShortcutError(friendlyMessage);
        });
    } else if (state.type === "error") {
      setShortcutError(state.message);
      setIsRecordingShortcutActive(false);
      setLiveDisplay("");
      recorder.cancel();
    } else if (state.type === "recording") {
      setLiveDisplay(recorder.getDisplay());
    }
  }, []);

  const handleShortcutKeyDown = useCallback((e: KeyboardEvent) => {
    e.preventDefault();
    e.stopPropagation();

    if (!isRecordingShortcutActive) {
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

  const cancelRecordingShortcut = useCallback(() => {
    recorderRef.current.cancel();
    setShortcutError("");
    setLiveDisplay("");
    setIsRecordingShortcutActive(false);
  }, []);

  const handleShortcutBlur = useCallback(() => {
    if (isRecordingShortcutActive) {
      cancelRecordingShortcut();
    }
  }, [isRecordingShortcutActive, cancelRecordingShortcut]);

  // ── API Key handlers ──

  const handleSaveApiKey = async (provider: "openai" | "groq") => {
    setApiKeySaving(true);
    try {
      const keyValue = provider === "openai" ? openaiKeyInput : groqKeyInput;
      const result = await invoke<ApiKeyStatus>("set_api_key", {
        provider,
        apiKey: keyValue,
      });
      setApiKeyStatus(result);

      if (provider === "openai") setOpenaiKeyInput("");
      else setGroqKeyInput("");
      setEditingProvider(null);

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

      const updatedProviders = await invoke<ProviderInfo[]>("get_available_providers");
      setProviders(updatedProviders);

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

  // ═══════════════════════════════════════════════════════════════════════════
  // SETTINGS VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  if (showSettings) {
    return (
      <div className="container">
        <div className="header">
          <button className="back-btn" onClick={closeSettings} title="Return">
            &#x2190;
          </button>
          <span className="status-text">Configuration</span>
        </div>

        {error && <div className="error">{error}</div>}

        {/* Warning banner always visible above sections */}
        {apiKeyStatus && !hasAnyApiKey && (
          <div className="warning settings-warning">
            No API keys configured. Transcription will not function.
          </div>
        )}

        <div className="content settings-content">
          {/* ── Model Section ── */}
          <CollapsibleSection
            id="model"
            title="Transcription Model"
            openSection={openSection}
            onToggle={handleSectionToggle}
          >
            <p className="settings-description">Select a transcription provider</p>
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
          </CollapsibleSection>

          {/* ── Shortcut Section ── */}
          <CollapsibleSection
            id="shortcut"
            title="Recording Shortcut"
            openSection={openSection}
            onToggle={handleSectionToggle}
          >
            <p className="settings-description">
              Press and hold to record.
            </p>

            {shortcutError && (
              <div className="shortcut-error-box">
                <span className="shortcut-error-icon">&#x26A0;</span>
                <span>{shortcutError}</span>
              </div>
            )}

            <div
              className={`shortcut-display shortcut-clickable ${isRecordingShortcutActive ? "shortcut-display-recording" : ""} ${shortcutError ? "shortcut-display-error" : ""}`}
              tabIndex={0}
              onKeyDown={handleShortcutKeyDown}
              onKeyUp={handleShortcutKeyUp}
              onBlur={handleShortcutBlur}
              onClick={(e) => {
                if (!isRecordingShortcutActive) {
                  setShortcutError("");
                  setLiveDisplay("");
                  recorderRef.current.start();
                  setIsRecordingShortcutActive(true);
                  (e.currentTarget as HTMLElement).focus();
                }
              }}
            >
              {isRecordingShortcutActive ? (
                <span className="shortcut-recording-text">
                  {liveDisplay || "Press keys..."}
                </span>
              ) : (
                <>
                  <span className="shortcut-current">{currentShortcut?.display || "\u2318\u21E7Space"}</span>
                  <span className="shortcut-change-hint">Click to change</span>
                </>
              )}
            </div>
          </CollapsibleSection>

          {/* ── API Keys Section ── */}
          <CollapsibleSection
            id="apikeys"
            title="API Keys"
            openSection={openSection}
            onToggle={handleSectionToggle}
          >
            <p className="settings-description">Manage your API keys</p>

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
                  <div className="api-key-display">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</div>
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
                      &#xD7;
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
                        title={showOpenaiKey ? "Hide" : "Show"}
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
                  <div className="api-key-display">&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;</div>
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
                      &#xD7;
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
                        title={showGroqKey ? "Hide" : "Show"}
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
          </CollapsibleSection>
        </div>

        <div className="hint">Settings</div>
      </div>
    );
  }

  // ═══════════════════════════════════════════════════════════════════════════
  // MAIN VIEW
  // ═══════════════════════════════════════════════════════════════════════════

  return (
    <div className="container">
      <div className="header">
        <div className={`status-indicator ${isRecording ? "recording" : ""}`} />
        <span className="status-text">{status}</span>
        <button className="settings-btn" onClick={openSettings} title="Settings">
          &#x2699;
        </button>
      </div>

      {error && <div className="error">{error}</div>}

      {apiKeyStatus && !hasAnyApiKey ? (
        <div className="content">
          <div className="setup-required">
            <p>No API key configured.</p>
            <p className="setup-hint">Add an API key to start transcribing.</p>
            <button className="btn primary" onClick={openSettings}>
              Open Settings
            </button>
          </div>
        </div>
      ) : (
        <>
          <div className="content">
            <textarea
              ref={textareaRef}
              className="edit-area"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Press ${currentShortcut?.display || "\u2318\u21E7Space"} to record`}
              aria-label="Transcription text"
              spellCheck={false}
            />
          </div>

          <div className="actions">
            <button onClick={handleCopy} className="btn" disabled={!text}>Copy</button>
          </div>

          {transcriptionSettings && (
            <div className="hint">
              <button className="current-model" onClick={openSettings}>{transcriptionSettings.model}</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

export default App;

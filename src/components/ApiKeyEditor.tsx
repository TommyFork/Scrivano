import { useState } from "react";

interface ApiKeyEditorProps {
  label: string;
  placeholder: string;
  configured: boolean;
  source: string | null;
  saving: boolean;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  onSave: (key: string) => void;
  onClear: () => void;
}

export function ApiKeyEditor({
  label,
  placeholder,
  configured,
  source,
  saving,
  isEditing,
  onStartEdit,
  onCancelEdit,
  onSave,
  onClear,
}: ApiKeyEditorProps) {
  const [keyInput, setKeyInput] = useState("");
  const [showKey, setShowKey] = useState(false);

  const handleSave = () => {
    onSave(keyInput);
    setKeyInput("");
  };

  const handleCancel = () => {
    setKeyInput("");
    onCancelEdit();
  };

  return (
    <div className="api-key-row">
      <div className="api-key-header">
        <span className="api-key-label">{label}</span>
        {configured && (
          <span className="api-key-status configured">
            {source === "env" ? "from env" : "configured"}
          </span>
        )}
      </div>
      {configured && !isEditing ? (
        <div className="api-key-input-row">
          <div className="api-key-display">
            &#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;&#x2022;
          </div>
          <button
            className="btn small"
            onClick={() => {
              setKeyInput("");
              onStartEdit();
            }}
          >
            Edit
          </button>
          {source === "keychain" && (
            <button
              className="api-key-clear"
              onClick={onClear}
              disabled={saving}
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
              type={showKey ? "text" : "password"}
              className="api-key-input"
              placeholder={placeholder}
              value={keyInput}
              onChange={(e) => setKeyInput(e.target.value)}
              autoFocus={isEditing}
            />
            {keyInput && (
              <button
                className="api-key-eye"
                onClick={() => setShowKey(!showKey)}
                title={showKey ? "Hide" : "Show"}
                tabIndex={-1}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                  <circle cx="12" cy="12" r="3" />
                  {showKey && <line x1="1" y1="1" x2="23" y2="23" />}
                </svg>
              </button>
            )}
          </div>
          <button className="btn small" onClick={handleSave} disabled={saving || !keyInput.trim()}>
            Save
          </button>
          {isEditing && (
            <button className="btn small" onClick={handleCancel}>
              Cancel
            </button>
          )}
        </div>
      )}
    </div>
  );
}

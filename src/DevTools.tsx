import { useState, useEffect, useRef, useCallback, type RefObject } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import "./DevTools.css";

export interface EventLogEntry {
  id: number;
  timestamp: string;
  event: string;
  payload: string;
}

type DevTab = "events" | "state" | "mocks";

interface DevToolsProps {
  isOpen: boolean;
  onClose: () => void;
  eventLog: EventLogEntry[];
  onClearLog: () => void;
  // Current app state for the inspector
  appState: {
    isRecording: boolean;
    status: string;
    textLength: number;
    hasApiKey: boolean;
    provider: string | null;
    shortcut: string | null;
    error: string;
  };
}

export function DevTools({ isOpen, onClose, eventLog, onClearLog, appState }: DevToolsProps) {
  const [activeTab, setActiveTab] = useState<DevTab>("events");
  const [autoScroll, setAutoScroll] = useState(true);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (autoScroll && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [eventLog, autoScroll]);

  if (!isOpen) return null;

  return (
    <div className="devtools-overlay">
      <div className="devtools-panel">
        <div className="devtools-header">
          <span className="devtools-title">Dev Tools</span>
          <div className="devtools-tabs">
            <button
              className={`devtools-tab ${activeTab === "events" ? "active" : ""}`}
              onClick={() => setActiveTab("events")}
            >
              Events ({eventLog.length})
            </button>
            <button
              className={`devtools-tab ${activeTab === "state" ? "active" : ""}`}
              onClick={() => setActiveTab("state")}
            >
              State
            </button>
            <button
              className={`devtools-tab ${activeTab === "mocks" ? "active" : ""}`}
              onClick={() => setActiveTab("mocks")}
            >
              Mocks
            </button>
          </div>
          <button className="devtools-close" onClick={onClose} title="Close">
            &#xD7;
          </button>
        </div>

        <div className="devtools-body">
          {activeTab === "events" && (
            <EventLogPanel
              eventLog={eventLog}
              onClear={onClearLog}
              autoScroll={autoScroll}
              onToggleAutoScroll={() => setAutoScroll((s) => !s)}
              logEndRef={logEndRef}
            />
          )}
          {activeTab === "state" && <StatePanel appState={appState} />}
          {activeTab === "mocks" && <MockPanel />}
        </div>
      </div>
    </div>
  );
}

// ── Event Log Panel ──

function EventLogPanel({
  eventLog,
  onClear,
  autoScroll,
  onToggleAutoScroll,
  logEndRef,
}: {
  eventLog: EventLogEntry[];
  onClear: () => void;
  autoScroll: boolean;
  onToggleAutoScroll: () => void;
  logEndRef: RefObject<HTMLDivElement | null>;
}) {
  return (
    <div className="devtools-event-panel">
      <div className="devtools-toolbar">
        <button className="devtools-btn" onClick={onClear}>
          Clear
        </button>
        <label className="devtools-checkbox">
          <input type="checkbox" checked={autoScroll} onChange={onToggleAutoScroll} />
          Auto-scroll
        </label>
      </div>
      <div className="devtools-log">
        {eventLog.length === 0 && (
          <div className="devtools-empty">No events captured yet. Interact with the app to see IPC events.</div>
        )}
        {eventLog.map((entry) => (
          <div key={entry.id} className={`devtools-log-entry ${getEventClass(entry.event)}`}>
            <span className="devtools-log-time">{entry.timestamp}</span>
            <span className="devtools-log-event">{entry.event}</span>
            <span className="devtools-log-payload">{entry.payload}</span>
          </div>
        ))}
        <div ref={logEndRef} />
      </div>
    </div>
  );
}

function getEventClass(event: string): string {
  if (event === "error") return "event-error";
  if (event === "recording-status") return "event-recording";
  if (event === "transcription") return "event-transcription";
  if (event === "audio-levels") return "event-audio";
  return "";
}

// ── State Inspector Panel ──

function StatePanel({ appState }: { appState: DevToolsProps["appState"] }) {
  return (
    <div className="devtools-state-panel">
      <table className="devtools-state-table">
        <tbody>
          <StateRow label="Recording" value={appState.isRecording ? "YES" : "no"} highlight={appState.isRecording} />
          <StateRow label="Status" value={appState.status} />
          <StateRow label="Text length" value={`${appState.textLength} chars`} />
          <StateRow label="API key" value={appState.hasApiKey ? "configured" : "MISSING"} highlight={!appState.hasApiKey} />
          <StateRow label="Provider" value={appState.provider || "—"} />
          <StateRow label="Shortcut" value={appState.shortcut || "—"} />
          <StateRow label="Error" value={appState.error || "—"} highlight={!!appState.error} />
        </tbody>
      </table>
    </div>
  );
}

function StateRow({ label, value, highlight }: { label: string; value: string; highlight?: boolean }) {
  return (
    <tr className={highlight ? "devtools-state-highlight" : ""}>
      <td className="devtools-state-label">{label}</td>
      <td className="devtools-state-value">{value}</td>
    </tr>
  );
}

// ── Mock Controls Panel ──

function MockPanel() {
  const [mockText, setMockText] = useState("The quick brown fox jumps over the lazy dog.");

  const emitRecording = useCallback((recording: boolean) => {
    emit("recording-status", recording);
  }, []);

  const emitTranscription = useCallback(() => {
    emit("transcription", mockText);
  }, [mockText]);

  const emitError = useCallback(() => {
    emit("error", "Mock error: This is a simulated error for testing.");
  }, []);

  const emitTranscribing = useCallback(() => {
    emit("transcription-status", "Transcribing...");
  }, []);

  return (
    <div className="devtools-mock-panel">
      <div className="devtools-mock-section">
        <span className="devtools-mock-label">Recording state</span>
        <div className="devtools-mock-row">
          <button className="devtools-btn" onClick={() => emitRecording(true)}>
            Start recording
          </button>
          <button className="devtools-btn" onClick={() => emitRecording(false)}>
            Stop recording
          </button>
        </div>
      </div>

      <div className="devtools-mock-section">
        <span className="devtools-mock-label">Status</span>
        <div className="devtools-mock-row">
          <button className="devtools-btn" onClick={emitTranscribing}>
            Transcribing...
          </button>
          <button className="devtools-btn" onClick={emitError}>
            Trigger error
          </button>
        </div>
      </div>

      <div className="devtools-mock-section">
        <span className="devtools-mock-label">Inject transcription</span>
        <textarea
          className="devtools-mock-textarea"
          value={mockText}
          onChange={(e) => setMockText(e.target.value)}
          rows={2}
        />
        <button className="devtools-btn" onClick={emitTranscription}>
          Send transcription
        </button>
      </div>
    </div>
  );
}

// ── Event logging hook ──

let nextEventId = 0;
const MAX_LOG_SIZE = 200;

/**
 * Hook that subscribes to all Tauri IPC events and maintains an event log.
 * Only active in dev mode.
 */
export function useEventLog() {
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);

  const addEntry = useCallback((event: string, payload: unknown) => {
    // Throttle audio-levels: only log every 10th one
    if (event === "audio-levels") {
      const id = nextEventId++;
      if (id % 10 !== 0) return;
    }

    const now = new Date();
    const timestamp = `${now.getHours().toString().padStart(2, "0")}:${now.getMinutes().toString().padStart(2, "0")}:${now.getSeconds().toString().padStart(2, "0")}.${now.getMilliseconds().toString().padStart(3, "0")}`;

    let payloadStr: string;
    if (typeof payload === "string") {
      payloadStr = payload.length > 100 ? payload.slice(0, 100) + "..." : payload;
    } else {
      const json = JSON.stringify(payload);
      payloadStr = json.length > 100 ? json.slice(0, 100) + "..." : json;
    }

    setEventLog((prev) => {
      const next = [
        ...prev,
        { id: nextEventId++, timestamp, event, payload: payloadStr },
      ];
      return next.length > MAX_LOG_SIZE ? next.slice(-MAX_LOG_SIZE) : next;
    });
  }, []);

  useEffect(() => {
    const events = [
      "recording-status",
      "transcription",
      "transcription-status",
      "audio-levels",
      "indicator-state",
      "error",
    ];

    const unlisteners = events.map((eventName) =>
      listen(eventName, (e) => addEntry(eventName, e.payload))
    );

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, [addEntry]);

  const clearLog = useCallback(() => setEventLog([]), []);

  return { eventLog, clearLog };
}

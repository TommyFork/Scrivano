import { useState, useEffect } from "react";
import { emit, listen } from "@tauri-apps/api/event";
import "./Indicator.css";

type IndicatorState = "recording" | "processing" | "success";

function Indicator() {
  const [state, setState] = useState<IndicatorState>("recording");
  const [audioLevels, setAudioLevels] = useState<number[]>([0.2, 0.3, 0.2, 0.3, 0.2]);

  useEffect(() => {
    const unlisteners = [
      listen<number[]>("audio-levels", (e) => {
        setAudioLevels(e.payload);
      }),
      listen<string>("indicator-state", (e) => {
        setState(e.payload as IndicatorState);
      }),
    ];

    // Signal to the backend that our listeners are ready
    Promise.all(unlisteners).then(() => {
      emit("indicator-ready", true);
    });

    return () => {
      unlisteners.forEach((p) => p.then((fn) => fn()));
    };
  }, []);

  return (
    <div className={`indicator-container ${state}`}>
      {state === "recording" && (
        <div className="audio-bars">
          {audioLevels.map((level, i) => (
            <div
              key={i}
              className="audio-bar"
              style={{
                height: `${Math.max(20, Math.min(100, level * 100))}%`,
              }}
            />
          ))}
        </div>
      )}
      {state === "processing" && (
        <div className="processing-dots">
          <span className="dot" />
          <span className="dot" />
          <span className="dot" />
        </div>
      )}
      {state === "success" && (
        <div className="success-check">✓</div>
      )}
    </div>
  );
}

export default Indicator;

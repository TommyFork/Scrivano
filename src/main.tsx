import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Indicator from "./Indicator";

let isIndicator = false;
try {
  const label = (window as any).__TAURI_INTERNALS__?.metadata?.currentWindow?.label;
  isIndicator = label === "indicator";
} catch {
  // fallback: not an indicator window
}

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);

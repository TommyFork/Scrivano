import React from "react";
import ReactDOM from "react-dom/client";
import { getCurrentWindow } from "@tauri-apps/api/window";
import App from "./App";
import Indicator from "./Indicator";

const isIndicator = getCurrentWindow().label === "indicator";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);

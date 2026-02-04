import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import Indicator from "./Indicator";

const params = new URLSearchParams(window.location.search);
const isIndicator = params.get("window") === "indicator";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    {isIndicator ? <Indicator /> : <App />}
  </React.StrictMode>,
);

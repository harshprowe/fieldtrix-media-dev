import React from "react";
import ReactDOM from "react-dom/client";

import { App } from "./App";
import { AppProviders } from "./providers";
import { registerServiceWorker } from "./workers/registerServiceWorker";
import "./styles/global.css";

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <AppProviders>
      <App />
    </AppProviders>
  </React.StrictMode>
);

registerServiceWorker();


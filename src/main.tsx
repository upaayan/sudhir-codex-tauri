import React from "react";
import { createRoot } from "react-dom/client";

import { App } from "./app.tsx";
import "./app.css";
import { ErrorBoundary } from "./components/error-boundary.tsx";
import { parseThemePreference, resolveTheme, THEME_STORAGE_KEY } from "./theme.ts";

const initialTheme = parseThemePreference(localStorage.getItem(THEME_STORAGE_KEY));
const resolvedInitialTheme = resolveTheme(
  initialTheme,
  window.matchMedia("(prefers-color-scheme: dark)").matches,
);
document.documentElement.dataset.theme = resolvedInitialTheme;
document.documentElement.style.colorScheme = resolvedInitialTheme;

window.addEventListener("error", (event) => {
  try {
    localStorage.setItem(
      "sudhir-codex-tauri.lastError",
      JSON.stringify({ message: event.message, stack: event.error?.stack }),
    );
  } catch {
    // best-effort
  }
});

window.addEventListener("unhandledrejection", (event) => {
  const reason = event.reason;
  const message = reason instanceof Error ? reason.message : String(reason);
  const stack = reason instanceof Error ? reason.stack : undefined;
  try {
    localStorage.setItem(
      "sudhir-codex-tauri.lastError",
      JSON.stringify({ message, stack }),
    );
  } catch {
    // best-effort
  }
});

// Debug-only: `?nostrict` disables StrictMode so the harness can reproduce
// production effect semantics (production builds are StrictMode no-ops).
const noStrict = new URLSearchParams(window.location.search).has("nostrict");

const root = document.getElementById("root");
if (!root) {
  throw new Error("missing #root element");
}

const app = <App />;
createRoot(root).render(
  <ErrorBoundary>
    {noStrict ? app : (
      <React.StrictMode>
        {app}
      </React.StrictMode>
    )}
  </ErrorBoundary>,
);

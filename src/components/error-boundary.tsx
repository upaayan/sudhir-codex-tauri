import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    try {
      localStorage.setItem(
        "sudhir-codex-tauri.lastError",
        JSON.stringify({ message: error.message, stack: error.stack, info: info.componentStack }),
      );
    } catch {
      // Persistence is best-effort; the visible card is the primary signal.
    }
  }

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="fatal-card" role="alert">
          <h2>Sudhir-Codex hit an unexpected error</h2>
          <pre className="card-output">{this.state.error.message}</pre>
          <pre className="card-output">{this.state.error.stack}</pre>
          <div className="interaction-actions">
            <button
              type="button"
              className="button primary"
              onClick={() => window.location.reload()}
            >
              Reload
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import { invoke } from "@tauri-apps/api/core";
import { listen, type UnlistenFn } from "@tauri-apps/api/event";
import { FitAddon } from "@xterm/addon-fit";
import { Terminal } from "@xterm/xterm";
import "@xterm/xterm/css/xterm.css";

import { TerminalSessionRegistry } from "../terminal-session.ts";

export const MIN_TERMINAL_HEIGHT = 220;
export const DEFAULT_TERMINAL_HEIGHT = 340;

// Ceiling calibrated to this app's chrome (~200px of header + composer +
// status); floor wins at pathological sizes.
export function terminalHeightCeiling(): number {
  return Math.max(MIN_TERMINAL_HEIGHT, window.innerHeight - 240);
}

export function clampTerminalHeight(height: number): number {
  return Math.min(Math.max(MIN_TERMINAL_HEIGHT, height), terminalHeightCeiling());
}

// Module-level registry: survives StrictMode remounts. The Rust side
// additionally enforces one live PTY per cwd, so even a webview reload
// re-attaches to the same shell.
const registry = new TerminalSessionRegistry((cwd) =>
  invoke<number>("terminal_open", { cwd, cols: 80, rows: 24 }));

interface Props {
  visible: boolean;
  projectPath: string | null;
  height: number;
  onHeightChange: (height: number) => void;
}

interface TerminalOutputPayload {
  id: number;
  data: string;
}

export function TerminalPanel({ visible, projectPath, height, onHeightChange }: Props) {
  const hostRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);
  const fitRef = useRef<FitAddon | null>(null);
  const termIdRef = useRef<number | null>(null);
  const listenReadyRef = useRef<Promise<void> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exited, setExited] = useState(false);
  const [attachNonce, setAttachNonce] = useState(0);
  // Once shown, the xterm host stays mounted; hiding is display:none only.
  const [activated, setActivated] = useState(false);

  useEffect(() => {
    if (visible) {
      setActivated(true);
    }
  }, [visible]);

  const sendResize = useCallback(() => {
    const id = termIdRef.current;
    const term = termRef.current;
    if (id !== null && term) {
      void invoke("terminal_resize", { id, cols: term.cols, rows: term.rows })
        .catch(() => undefined);
    }
  }, []);

  // One shared output/exit subscription, awaited before any open so the first
  // chunk can never be emitted while no listener exists.
  useEffect(() => {
    let unlistenOutput: UnlistenFn | undefined;
    let unlistenExit: UnlistenFn | undefined;
    let disposed = false;
    listenReadyRef.current = (async () => {
      const output = await listen<TerminalOutputPayload>("terminal://output", (event) => {
        if (event.payload.id === termIdRef.current && termRef.current) {
          termRef.current.write(base64ToBytes(event.payload.data));
        }
      });
      const exit = await listen<{ id: number }>("terminal://exit", (event) => {
        registry.markExited(event.payload.id);
        if (event.payload.id === termIdRef.current) {
          setExited(true);
        }
      });
      if (disposed) {
        output();
        exit();
      } else {
        unlistenOutput = output;
        unlistenExit = exit;
      }
    })();
    return () => {
      disposed = true;
      unlistenOutput?.();
      unlistenExit?.();
    };
  }, []);

  // Attach an xterm instance to the selected project's PTY. Cleanup disposes
  // the xterm but NEVER closes the PTY — sessions outlive toggles and project
  // switches by design.
  useEffect(() => {
    const host = hostRef.current;
    if (!activated || !projectPath || !host) {
      return;
    }
    let disposed = false;
    const term = new Terminal({
      fontSize: 12.5,
      fontFamily: 'ui-monospace, "SF Mono", Menlo, Consolas, monospace',
      scrollback: 4000,
      theme: {
        background: "#0f1117",
        foreground: "#d7dae0",
        cursor: "#d7dae0",
      },
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(host);
    // Keep xterm from swallowing the app's own shortcuts: returning false
    // stops xterm emitting ^J/^O to the PTY but the event still bubbles to
    // the window listener that handles the toggle.
    term.attachCustomKeyEventHandler((event) => {
      if ((event.metaKey || event.ctrlKey) && !event.shiftKey && !event.altKey) {
        const key = event.key.toLowerCase();
        if (key === "j" || event.code === "KeyJ" || key === "o" || event.code === "KeyO") {
          return false;
        }
      }
      return true;
    });
    termRef.current = term;
    fitRef.current = fit;
    setError(null);
    setExited(false);

    const dataDisposable = term.onData((data) => {
      const id = termIdRef.current;
      if (id !== null) {
        void invoke("terminal_write", { id, data }).catch(() => undefined);
      }
    });

    void (async () => {
      await listenReadyRef.current;
      try {
        const id = await registry.open(projectPath);
        if (disposed) {
          return;
        }
        termIdRef.current = id;
        const session = registry.get(projectPath);
        if (session?.exited) {
          setExited(true);
        }
        requestAnimationFrame(() => {
          if (!disposed && fitRef.current && termRef.current) {
            fitRef.current.fit();
            sendResize();
            termRef.current.refresh(0, termRef.current.rows - 1);
          }
        });
      } catch (openError) {
        if (!disposed) {
          setError(String(openError));
        }
      }
    })();

    const observer = new ResizeObserver(() => {
      if (fitRef.current && termRef.current && host.offsetHeight > 0) {
        fitRef.current.fit();
        sendResize();
      }
    });
    observer.observe(host);

    return () => {
      disposed = true;
      observer.disconnect();
      dataDisposable.dispose();
      term.dispose();
      termRef.current = null;
      fitRef.current = null;
      termIdRef.current = null;
    };
  }, [activated, projectPath, attachNonce, sendResize]);

  // Re-fit + force repaint when coming back from display:none (fit() is a
  // no-op when dimensions are unchanged, so refresh explicitly).
  useEffect(() => {
    if (!visible) {
      return;
    }
    requestAnimationFrame(() => {
      const term = termRef.current;
      if (fitRef.current && term) {
        fitRef.current.fit();
        sendResize();
        term.refresh(0, term.rows - 1);
        term.focus();
      }
    });
  }, [visible, sendResize]);

  // Keep the persisted height inside the ceiling when the window shrinks.
  useEffect(() => {
    const onWindowResize = () => {
      const clamped = clampTerminalHeight(height);
      if (clamped !== height) {
        onHeightChange(clamped);
      }
    };
    window.addEventListener("resize", onWindowResize);
    return () => window.removeEventListener("resize", onWindowResize);
  }, [height, onHeightChange]);

  const restart = useCallback(() => {
    const id = termIdRef.current;
    if (projectPath) {
      registry.drop(projectPath);
    }
    if (id !== null) {
      void invoke("terminal_close", { id }).catch(() => undefined);
    }
    termIdRef.current = null;
    setError(null);
    setExited(false);
    setAttachNonce((nonce) => nonce + 1);
  }, [projectPath]);

  const startDrag = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startY = event.clientY;
    const startHeight = height;
    const onMove = (move: PointerEvent) => {
      onHeightChange(clampTerminalHeight(startHeight + (startY - move.clientY)));
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  }, [height, onHeightChange]);

  return (
    <section
      className={`terminal-panel${visible ? "" : " terminal-panel-hidden"}`}
      style={{ height: `${height}px` }}
      aria-label="Terminal"
    >
      <div className="terminal-resize-handle" onPointerDown={startDrag} />
      {!projectPath ? (
        <div className="terminal-notice">Select a project to open a terminal.</div>
      ) : null}
      {error ? (
        <div className="terminal-notice" role="alert">
          <span className="terminal-notice-text">{error}</span>
          <button type="button" className="terminal-notice-button" onClick={restart}>
            Retry
          </button>
        </div>
      ) : null}
      {exited && !error ? (
        <div className="terminal-notice" role="status">
          <span className="terminal-notice-text">Shell exited.</span>
          <button type="button" className="terminal-notice-button" onClick={restart}>
            Restart
          </button>
        </div>
      ) : null}
      <div className="terminal-host" ref={hostRef} />
    </section>
  );
}

function base64ToBytes(data: string): Uint8Array {
  const binary = atob(data);
  const bytes = new Uint8Array(binary.length);
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index);
  }
  return bytes;
}

//! Rust-side ownership of the sudhir-codex app-server child process.

use std::process::Stdio;
use std::sync::{Arc, Mutex};

use serde_json::Value;
use tauri::{AppHandle, Emitter};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::{Child, ChildStdin, Command};
use tokio::sync::Mutex as AsyncMutex;

use crate::platform;

const MESSAGE_EVENT: &str = "app-server://message";
const DIAGNOSTIC_EVENT: &str = "app-server://diagnostic";
const EXIT_EVENT: &str = "app-server://exit";

/// Bounded recent-diagnostic buffer for startup/runtime errors. Not a logging
/// subsystem: it keeps the most recent lines so the window can show an
/// actionable message plainly.
#[derive(Debug, Default)]
pub struct DiagnosticBuffer {
    lines: Vec<String>,
    chars: usize,
}

impl DiagnosticBuffer {
    const MAX_LINES: usize = 100;
    const MAX_CHARS: usize = 32_768;

    pub fn push(&mut self, line: String) {
        let mut line = line;
        if line.chars().count() > Self::MAX_CHARS {
            line = line.chars().take(Self::MAX_CHARS).collect();
        }
        self.lines.push(line.clone());
        self.chars += line.chars().count();
        while self.lines.len() > Self::MAX_LINES || self.chars > Self::MAX_CHARS {
            if let Some(removed) = self.lines.first() {
                self.chars = self.chars.saturating_sub(removed.chars().count());
            }
            self.lines.remove(0);
        }
    }

    pub fn content(&self) -> String {
        self.lines.join("\n")
    }
}

/// Classify one stdout line: protocol JSONL vs anything else (for example a
/// WSL login profile greeting). Non-JSON lines never reach the RPC layer.
fn classify_stdout_line(line: &str) -> Option<Value> {
    serde_json::from_str(line).ok()
}

pub struct AppServerProcess {
    child: Child,
    stdin: AsyncMutex<Option<ChildStdin>>,
    diagnostics: Arc<Mutex<DiagnosticBuffer>>,
}

impl AppServerProcess {
    pub async fn spawn(app: AppHandle) -> Result<Self, String> {
        let spec = platform::app_server_launch();
        let mut command = Command::new(&spec.program);
        command.args(&spec.args);
        command.envs(spec.env.iter().cloned());
        command
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        #[cfg(target_os = "windows")]
        {
            use std::os::windows::process::CommandExt;
            if spec.create_no_window {
                command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
            }
        }

        let mut child = command
            .spawn()
            .map_err(|error| format!("failed to launch {}: {error}", spec.program))?;
        let stdin = child
            .stdin
            .take()
            .ok_or_else(|| "failed to open app-server stdin".to_string())?;
        let stdout = child
            .stdout
            .take()
            .ok_or_else(|| "failed to open app-server stdout".to_string())?;
        let stderr = child
            .stderr
            .take()
            .ok_or_else(|| "failed to open app-server stderr".to_string())?;

        let diagnostics = Arc::new(Mutex::new(DiagnosticBuffer::default()));

        let app_for_stdout = app.clone();
        let diagnostics_for_stdout = Arc::clone(&diagnostics);
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stdout);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => {
                        // stdout EOF means the app-server child exited. Emit
                        // the exit event so the window can show the retained
                        // diagnostic plainly.
                        let _ = app_for_stdout.emit(EXIT_EVENT, -1_i32);
                        break;
                    }
                    Ok(_) => {
                        let trimmed = line.trim_end_matches(['\r', '\n']);
                        if trimmed.is_empty() {
                            continue;
                        }
                        if let Some(value) = classify_stdout_line(trimmed) {
                            let _ = app_for_stdout.emit(MESSAGE_EVENT, value);
                        } else {
                            push_diagnostic(
                                &diagnostics_for_stdout,
                                trimmed.to_string(),
                                &app_for_stdout,
                            );
                        }
                    }
                }
            }
        });

        let app_for_stderr = app.clone();
        let diagnostics_for_stderr = Arc::clone(&diagnostics);
        tauri::async_runtime::spawn(async move {
            let mut reader = BufReader::new(stderr);
            let mut line = String::new();
            loop {
                line.clear();
                match reader.read_line(&mut line).await {
                    Ok(0) | Err(_) => break,
                    Ok(_) => {
                        let trimmed = line.trim_end_matches(['\r', '\n']);
                        if !trimmed.is_empty() {
                            push_diagnostic(
                                &diagnostics_for_stderr,
                                trimmed.to_string(),
                                &app_for_stderr,
                            );
                        }
                    }
                }
            }
        });

        Ok(Self {
            child,
            stdin: AsyncMutex::new(Some(stdin)),
            diagnostics,
        })
    }

    pub async fn write_line(&self, line: &str) -> Result<(), String> {
        let mut stdin_guard = self.stdin.lock().await;
        let stdin = stdin_guard
            .as_mut()
            .ok_or_else(|| "app-server stdin is closed".to_string())?;
        stdin
            .write_all(line.as_bytes())
            .await
            .map_err(|error| format!("failed to write to app-server: {error}"))?;
        stdin
            .write_all(b"\n")
            .await
            .map_err(|error| format!("failed to write to app-server: {error}"))
    }

    /// Close app-server stdin and, if the child does not exit on its own,
    /// terminate only that child. Never touches the persistent gateway.
    pub async fn shutdown(&mut self) {
        if let Some(mut stdin) = self.stdin.get_mut().take() {
            let _ = stdin.shutdown().await;
            drop(stdin);
        }
        match tokio::time::timeout(std::time::Duration::from_secs(5), self.child.wait()).await {
            Ok(_) => {}
            Err(_) => {
                let _ = self.child.kill().await;
                let _ = self.child.wait().await;
            }
        }
    }

    pub fn diagnostics(&self) -> String {
        self.diagnostics
            .lock()
            .map(|buffer| buffer.content())
            .unwrap_or_default()
    }
}

fn push_diagnostic(buffer: &Arc<Mutex<DiagnosticBuffer>>, line: String, app: &AppHandle) {
    if let Ok(mut buffer) = buffer.lock() {
        buffer.push(line.clone());
    }
    let _ = app.emit(DIAGNOSTIC_EVENT, line);
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn diagnostic_buffer_is_bounded() {
        let mut buffer = DiagnosticBuffer::default();
        for index in 0..250 {
            buffer.push(format!("line {index}"));
        }
        assert_eq!(buffer.lines.len(), 100);
        assert!(buffer.content().starts_with("line 150"));
        assert!(buffer.content().ends_with("line 249"));
    }

    #[test]
    fn diagnostic_buffer_truncates_by_chars() {
        let mut buffer = DiagnosticBuffer::default();
        let long = "x".repeat(40_000);
        buffer.push(long.clone());
        assert!(buffer.lines.len() == 1);
        assert_eq!(buffer.content().len(), DiagnosticBuffer::MAX_CHARS);
    }

    #[test]
    fn json_stdout_lines_are_classified_as_json() {
        assert!(classify_stdout_line(r#"{"jsonrpc":"2.0","id":1,"result":{}}"#).is_some());
    }

    #[test]
    fn non_json_stdout_lines_are_routed_away_from_rpc() {
        assert!(classify_stdout_line("Welcome to Ubuntu 24.04").is_none());
        assert!(classify_stdout_line("").is_none());
        assert!(classify_stdout_line("{broken json").is_none());
    }
}

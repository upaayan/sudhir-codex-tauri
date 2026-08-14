//! PTY host for the in-app terminal panel.
//!
//! One live session per project cwd, enforced here (not in the frontend):
//! `terminal_open` returns the existing live session's id when the cwd
//! matches, so a webview reload re-attaches instead of orphaning a shell.
//! Output flows over a single shared `terminal://output` event carrying
//! `{id, data}` (base64), so the frontend can subscribe once before any
//! session exists.

use base64::Engine;
use portable_pty::{native_pty_system, Child, CommandBuilder, MasterPty, PtySize};
use serde::Serialize;
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::atomic::{AtomicU32, Ordering};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, State};

use crate::platform;

pub struct PtySession {
    cwd: String,
    alive: bool,
    master: Box<dyn MasterPty + Send>,
    writer: Box<dyn Write + Send>,
    child: Box<dyn Child + Send + Sync>,
}

#[derive(Default)]
pub struct TerminalMap(pub Arc<Mutex<HashMap<u32, PtySession>>>);

static NEXT_TERMINAL_ID: AtomicU32 = AtomicU32::new(1);

#[derive(Clone, Serialize)]
struct TerminalOutput {
    id: u32,
    data: String,
}

#[derive(Clone, Serialize)]
struct TerminalExit {
    id: u32,
}

#[tauri::command]
pub fn terminal_open(
    app: AppHandle,
    state: State<'_, TerminalMap>,
    cwd: String,
    cols: u16,
    rows: u16,
) -> Result<u32, String> {
    let sessions = Arc::clone(&state.0);
    {
        let map = sessions.lock().map_err(|_| "terminal state poisoned")?;
        if let Some((id, _)) = map
            .iter()
            .find(|(_, session)| session.alive && session.cwd == cwd)
        {
            return Ok(*id);
        }
    }

    let spec = platform::terminal_launch(&cwd);
    let pty = native_pty_system()
        .openpty(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("failed to open pty: {error}"))?;

    let mut command = CommandBuilder::new(&spec.program);
    command.args(&spec.args);
    for (key, value) in &spec.env {
        command.env(key, value);
    }
    for key in &spec.remove_env {
        command.env_remove(key);
    }
    if let Some(process_cwd) = &spec.process_cwd {
        command.cwd(process_cwd);
    }

    let child = pty
        .slave
        .spawn_command(command)
        .map_err(|error| format!("failed to start {}: {error}", spec.program))?;
    drop(pty.slave);

    let writer = pty
        .master
        .take_writer()
        .map_err(|error| format!("failed to open pty writer: {error}"))?;
    let mut reader = pty
        .master
        .try_clone_reader()
        .map_err(|error| format!("failed to open pty reader: {error}"))?;

    let id = NEXT_TERMINAL_ID.fetch_add(1, Ordering::Relaxed);
    {
        let mut map = sessions.lock().map_err(|_| "terminal state poisoned")?;
        map.insert(
            id,
            PtySession {
                cwd,
                alive: true,
                master: pty.master,
                writer,
                child,
            },
        );
    }

    let reader_sessions = Arc::clone(&sessions);
    std::thread::spawn(move || {
        let engine = base64::engine::general_purpose::STANDARD;
        let mut buffer = [0u8; 8192];
        loop {
            match reader.read(&mut buffer) {
                Ok(0) | Err(_) => break,
                Ok(n) => {
                    let payload = TerminalOutput {
                        id,
                        data: engine.encode(&buffer[..n]),
                    };
                    if app.emit("terminal://output", payload).is_err() {
                        break;
                    }
                }
            }
        }
        if let Ok(mut map) = reader_sessions.lock() {
            if let Some(session) = map.get_mut(&id) {
                session.alive = false;
            }
        }
        let _ = app.emit("terminal://exit", TerminalExit { id });
    });

    Ok(id)
}

#[tauri::command]
pub fn terminal_write(state: State<'_, TerminalMap>, id: u32, data: String) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "terminal state poisoned")?;
    let session = map
        .get_mut(&id)
        .ok_or_else(|| format!("no terminal session {id}"))?;
    session
        .writer
        .write_all(data.as_bytes())
        .map_err(|error| format!("terminal write failed: {error}"))
}

#[tauri::command]
pub fn terminal_resize(
    state: State<'_, TerminalMap>,
    id: u32,
    cols: u16,
    rows: u16,
) -> Result<(), String> {
    let map = state.0.lock().map_err(|_| "terminal state poisoned")?;
    let session = map
        .get(&id)
        .ok_or_else(|| format!("no terminal session {id}"))?;
    session
        .master
        .resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        })
        .map_err(|error| format!("terminal resize failed: {error}"))
}

#[tauri::command]
pub fn terminal_close(state: State<'_, TerminalMap>, id: u32) -> Result<(), String> {
    let mut map = state.0.lock().map_err(|_| "terminal state poisoned")?;
    if let Some(mut session) = map.remove(&id) {
        let _ = session.child.kill();
    }
    Ok(())
}

/// Kill every session; called alongside app-server shutdown on window close.
pub fn shutdown_all(map: &TerminalMap) {
    if let Ok(mut sessions) = map.0.lock() {
        for (_, mut session) in sessions.drain() {
            let _ = session.child.kill();
        }
    }
}

// Real PTY round-trip through the exact launch spec: proves spawn, cwd, and
// TERM propagation without the UI. macOS only — the Windows arm needs WSL.
#[cfg(all(test, target_os = "macos"))]
mod tests {
    use super::*;
    use std::sync::mpsc;
    use std::time::Duration;

    #[test]
    fn pty_roundtrip_echo_expands_term_from_spec() {
        let spec = crate::platform::terminal_launch("/tmp");
        let pty = native_pty_system()
            .openpty(PtySize {
                rows: 24,
                cols: 80,
                pixel_width: 0,
                pixel_height: 0,
            })
            .expect("openpty");
        let mut command = CommandBuilder::new(&spec.program);
        command.args(&spec.args);
        for (key, value) in &spec.env {
            command.env(key, value);
        }
        for key in &spec.remove_env {
            command.env_remove(key);
        }
        if let Some(process_cwd) = &spec.process_cwd {
            command.cwd(process_cwd);
        }
        let mut child = pty.slave.spawn_command(command).expect("spawn shell");
        drop(pty.slave);

        let mut writer = pty.master.take_writer().expect("writer");
        let mut reader = pty.master.try_clone_reader().expect("reader");
        writer
            .write_all(b"echo roundtrip-$TERM; exit\n")
            .expect("write");

        let (sender, receiver) = mpsc::channel::<String>();
        std::thread::spawn(move || {
            let mut collected = String::new();
            let mut buffer = [0u8; 4096];
            loop {
                match reader.read(&mut buffer) {
                    Ok(0) | Err(_) => break,
                    Ok(n) => {
                        collected.push_str(&String::from_utf8_lossy(&buffer[..n]));
                        if collected.contains("roundtrip-xterm-256color") {
                            break;
                        }
                    }
                }
            }
            let _ = sender.send(collected);
        });

        let collected = receiver
            .recv_timeout(Duration::from_secs(20))
            .expect("shell produced output before the deadline");
        assert!(
            collected.contains("roundtrip-xterm-256color"),
            "TERM did not expand; output was: {collected}"
        );
        let _ = child.kill();
        let _ = child.wait();
    }
}

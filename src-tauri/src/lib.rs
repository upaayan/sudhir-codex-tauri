use serde::Serialize;
use std::path::{Path, PathBuf};
use tauri::{Manager, State};
use tokio::sync::Mutex;

mod app_server;
mod platform;
mod terminal;

#[cfg(test)]
mod attachment_tests {
    use super::attachment_kind_for_path;
    use std::path::Path;

    #[test]
    fn classifies_supported_images_separately_from_documents() {
        assert_eq!(attachment_kind_for_path(Path::new("photo.PNG")), "image");
        assert_eq!(attachment_kind_for_path(Path::new("photo.webp")), "image");
        assert_eq!(
            attachment_kind_for_path(Path::new("report.pdf")),
            "document"
        );
        assert_eq!(attachment_kind_for_path(Path::new("README")), "document");
    }
}

use app_server::AppServerProcess;

struct AppServerState(Mutex<Option<AppServerProcess>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFolder {
    display_path: String,
    backend_path: String,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct AttachmentFile {
    display_path: String,
    backend_path: String,
    name: String,
    kind: String,
}

#[tauri::command]
async fn spawn_app_server(
    app: tauri::AppHandle,
    state: State<'_, AppServerState>,
) -> Result<(), String> {
    {
        let guard = state.0.lock().await;
        if guard.is_some() {
            return Err("app-server is already running".to_string());
        }
    }
    let process = AppServerProcess::spawn(app).await?;
    *state.0.lock().await = Some(process);
    Ok(())
}

#[tauri::command]
async fn write_app_server_line(
    state: State<'_, AppServerState>,
    line: String,
) -> Result<(), String> {
    let guard = state.0.lock().await;
    let process = guard
        .as_ref()
        .ok_or_else(|| "app-server is not running".to_string())?;
    process.write_line(&line).await
}

#[tauri::command]
async fn shutdown_app_server(state: State<'_, AppServerState>) -> Result<(), String> {
    let process = state.0.lock().await.take();
    if let Some(mut process) = process {
        process.shutdown().await;
    }
    Ok(())
}

#[tauri::command]
async fn app_server_diagnostic(state: State<'_, AppServerState>) -> Result<String, String> {
    let guard = state.0.lock().await;
    Ok(guard
        .as_ref()
        .map(|process| process.diagnostics())
        .unwrap_or_default())
}

#[tauri::command]
async fn pick_project_folder() -> Result<Option<ProjectFolder>, String> {
    let picked = rfd::AsyncFileDialog::new()
        .set_title("Add a project folder")
        .pick_folder()
        .await;
    let Some(folder) = picked else {
        return Ok(None);
    };
    let display_path = folder.path().to_string_lossy().to_string();
    let backend_path = platform::convert_host_path_to_backend(&display_path).await?;
    Ok(Some(ProjectFolder {
        display_path,
        backend_path,
    }))
}

#[tauri::command]
async fn pick_attachment_files() -> Result<Vec<AttachmentFile>, String> {
    let files = rfd::AsyncFileDialog::new()
        .set_title("Attach images or documents")
        .pick_files()
        .await
        .unwrap_or_default();
    prepare_attachment_files(
        files
            .into_iter()
            .map(|file| file.path().to_path_buf())
            .collect(),
    )
    .await
}

#[tauri::command]
async fn prepare_attachment_paths(paths: Vec<String>) -> Result<Vec<AttachmentFile>, String> {
    prepare_attachment_files(paths.into_iter().map(PathBuf::from).collect()).await
}

async fn prepare_attachment_files(paths: Vec<PathBuf>) -> Result<Vec<AttachmentFile>, String> {
    let mut attachments = Vec::new();
    for path in paths {
        if !path.is_file() {
            continue;
        }
        let display_path = path.to_string_lossy().to_string();
        let backend_path = platform::convert_host_path_to_backend(&display_path).await?;
        let name = path
            .file_name()
            .map(|name| name.to_string_lossy().to_string())
            .unwrap_or_else(|| display_path.clone());
        attachments.push(AttachmentFile {
            display_path,
            backend_path,
            name,
            kind: attachment_kind_for_path(&path).to_string(),
        });
    }
    Ok(attachments)
}

fn attachment_kind_for_path(path: &Path) -> &'static str {
    match path
        .extension()
        .and_then(|extension| extension.to_str())
        .map(str::to_ascii_lowercase)
        .as_deref()
    {
        Some("png" | "jpg" | "jpeg" | "webp" | "gif") => "image",
        _ => "document",
    }
}

pub fn run() {
    tauri::Builder::default()
        .manage(AppServerState(Mutex::new(None)))
        .manage(terminal::TerminalMap::default())
        .invoke_handler(tauri::generate_handler![
            spawn_app_server,
            write_app_server_line,
            shutdown_app_server,
            app_server_diagnostic,
            pick_project_folder,
            pick_attachment_files,
            prepare_attachment_paths,
            terminal::terminal_open,
            terminal::terminal_write,
            terminal::terminal_resize,
            terminal::terminal_close,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
                if let Some(terminals) = app.try_state::<terminal::TerminalMap>() {
                    terminal::shutdown_all(&terminals);
                }
                tauri::async_runtime::spawn(async move {
                    if let Some(state) = app.try_state::<AppServerState>() {
                        let process = state.0.lock().await.take();
                        if let Some(mut process) = process {
                            process.shutdown().await;
                        }
                    }
                });
            }
        })
        .run(tauri::generate_context!())
        .expect("error while running Sudhir-Codex Tauri");
}

use serde::Serialize;
use tauri::{Manager, State};
use tokio::sync::Mutex;

mod app_server;
mod platform;

use app_server::AppServerProcess;

struct AppServerState(Mutex<Option<AppServerProcess>>);

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
struct ProjectFolder {
    display_path: String,
    backend_path: String,
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

pub fn run() {
    tauri::Builder::default()
        .manage(AppServerState(Mutex::new(None)))
        .invoke_handler(tauri::generate_handler![
            spawn_app_server,
            write_app_server_line,
            shutdown_app_server,
            app_server_diagnostic,
            pick_project_folder,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { .. } = event {
                let app = window.app_handle().clone();
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

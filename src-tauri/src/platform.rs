//! Platform-specific app-server launch and project-path conversion.

/// Complete launch specification for the sudhir-codex app-server child.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ChildLaunchSpec {
    pub program: String,
    pub args: Vec<String>,
    /// Extra environment variables applied to the child.
    pub env: Vec<(String, String)>,
    /// Windows only: CREATE_NO_WINDOW (0x08000000) so no console appears.
    pub create_no_window: bool,
}

/// macOS: the existing launcher at `$HOME/.local/bin/sudhir-codex`, with a
/// single environment override allowed for development tests.
#[cfg(target_os = "macos")]
pub fn app_server_launch() -> ChildLaunchSpec {
    let program = std::env::var("SUDHIR_CODEX_TAURI_APP_SERVER").unwrap_or_else(|_| {
        let home = std::env::var("HOME").unwrap_or_default();
        format!("{home}/.local/bin/sudhir-codex")
    });
    ChildLaunchSpec {
        program,
        args: vec!["app-server".to_string(), "--stdio".to_string()],
        env: vec![],
        create_no_window: false,
    }
}

/// Windows: resolve the default WSL distribution and run a login shell so the
/// existing `sudhir-codex` command is found exactly as in the owner's WSL
/// setup. `WSL_UTF8=1` makes `wsl.exe`'s own messages readable UTF-8.
#[cfg(target_os = "windows")]
pub fn app_server_launch() -> ChildLaunchSpec {
    ChildLaunchSpec {
        program: "wsl.exe".to_string(),
        args: vec![
            "--exec".to_string(),
            "bash".to_string(),
            "-lic".to_string(),
            "exec sudhir-codex app-server --stdio".to_string(),
        ],
        env: vec![("WSL_UTF8".to_string(), "1".to_string())],
        create_no_window: true,
    }
}

/// True when a Windows host path is already a WSL UNC path.
#[cfg(any(target_os = "windows", test))]
pub fn is_wsl_unc_path(path: &str) -> bool {
    let lower = path.to_ascii_lowercase();
    lower.starts_with("\\\\wsl.localhost\\") || lower.starts_with("\\\\wsl$\\")
}

/// Reduce a `\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...` path to
/// its absolute Linux path by dropping the host and distribution components
/// and normalizing separators. Returns None for non-UNC paths.
#[cfg(any(target_os = "windows", test))]
pub fn reduce_wsl_unc_path(path: &str) -> Option<String> {
    let lower = path.to_ascii_lowercase();
    let after_host = if lower.starts_with("\\\\wsl.localhost\\") {
        Some(&path["\\\\wsl.localhost\\".len()..])
    } else if lower.starts_with("\\\\wsl$\\") {
        Some(&path["\\\\wsl$\\".len()..])
    } else {
        None
    }?;

    // Drop the distribution component.
    let rest = match after_host.find('\\') {
        Some(index) => &after_host[index + 1..],
        None => "",
    };
    if rest.is_empty() {
        return Some("/".to_string());
    }
    let mut linux = String::from("/");
    for component in rest.split('\\') {
        if !component.is_empty() {
            linux.push_str(component);
            linux.push('/');
        }
    }
    if linux.len() > 1 {
        linux.pop();
    }
    Some(linux)
}

/// Convert a native folder-picker result into the backend path the app-server
/// sees. macOS returns the host path unchanged. Windows converts a genuine
/// drive path with `wslpath -a -u` and reduces WSL UNC paths directly.
#[cfg(target_os = "windows")]
pub async fn convert_host_path_to_backend(path: &str) -> Result<String, String> {
    if is_wsl_unc_path(path) {
        return reduce_wsl_unc_path(path).ok_or_else(|| "invalid WSL path".to_string());
    }
    let mut command = tokio::process::Command::new("wsl.exe");
    command
        .args(["--exec", "wslpath", "-a", "-u", path])
        .env("WSL_UTF8", "1");
    {
        command.creation_flags(0x0800_0000); // CREATE_NO_WINDOW
    }
    let output = command
        .output()
        .await
        .map_err(|error| format!("failed to run wslpath: {error}"))?;
    if !output.status.success() {
        return Err(format!(
            "wslpath failed with {}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr).trim()
        ));
    }
    let converted = String::from_utf8_lossy(&output.stdout).trim().to_string();
    if converted.is_empty() {
        return Err("wslpath returned an empty path".to_string());
    }
    Ok(converted)
}

#[cfg(target_os = "macos")]
pub async fn convert_host_path_to_backend(path: &str) -> Result<String, String> {
    Ok(path.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_launcher_defaults_to_home_local_bin() {
        std::env::set_var("HOME", "/Users/owner");
        std::env::remove_var("SUDHIR_CODEX_TAURI_APP_SERVER");
        let spec = app_server_launch();
        assert_eq!(spec.program, "/Users/owner/.local/bin/sudhir-codex");
        assert_eq!(spec.args, ["app-server", "--stdio"]);
        assert!(!spec.create_no_window);
        assert!(spec.env.is_empty());
    }

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_launcher_honors_test_override() {
        std::env::set_var("SUDHIR_CODEX_TAURI_APP_SERVER", "/tmp/fake-sudhir-codex");
        let spec = app_server_launch();
        assert_eq!(spec.program, "/tmp/fake-sudhir-codex");
        std::env::remove_var("SUDHIR_CODEX_TAURI_APP_SERVER");
    }

    #[cfg(target_os = "windows")]
    #[test]
    fn windows_launch_uses_wsl_login_shell_no_window_and_utf8() {
        let spec = app_server_launch();
        assert_eq!(spec.program, "wsl.exe");
        assert_eq!(
            spec.args,
            [
                "--exec",
                "bash",
                "-lic",
                "exec sudhir-codex app-server --stdio"
            ]
        );
        assert!(spec.create_no_window, "CREATE_NO_WINDOW must be set");
        assert!(spec
            .env
            .contains(&("WSL_UTF8".to_string(), "1".to_string())));
    }

    #[test]
    fn wsl_unc_paths_reduce_to_linux_paths() {
        assert_eq!(
            reduce_wsl_unc_path(r"\\wsl.localhost\Ubuntu\home\owner\proj"),
            Some("/home/owner/proj".to_string())
        );
        assert_eq!(
            reduce_wsl_unc_path(r"\\wsl$\Ubuntu\home\owner"),
            Some("/home/owner".to_string())
        );
        assert_eq!(
            reduce_wsl_unc_path(r"\\wsl.localhost\Ubuntu\"),
            Some("/".to_string())
        );
        assert_eq!(
            reduce_wsl_unc_path(r"\\wsl.localhost\Ubuntu"),
            Some("/".to_string())
        );
        assert_eq!(reduce_wsl_unc_path(r"C:\Users\owner\proj"), None);
        assert_eq!(reduce_wsl_unc_path(r"\\server\share\path"), None);
        assert!(!is_wsl_unc_path(r"C:\Users\owner"));
        assert!(is_wsl_unc_path(r"\\wsl$\Ubuntu\home"));
        assert!(is_wsl_unc_path(r"\\WSL.LOCALHOST\Ubuntu\home"));
    }
}

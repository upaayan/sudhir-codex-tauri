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

/// Interactive-terminal launch: what shell to spawn inside the PTY.
///
/// Unlike [`ChildLaunchSpec`] this carries `process_cwd` (the OS working
/// directory — `None` on Windows, where the project path is a Linux path and
/// `--cd` conveys it inside WSL) and `remove_env` (vars dropped from the
/// inherited environment).
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct TerminalLaunchSpec {
    pub program: String,
    pub args: Vec<String>,
    /// Extra environment variables set on top of the inherited environment.
    pub env: Vec<(String, String)>,
    /// Variables removed from the inherited environment.
    pub remove_env: Vec<String>,
    /// OS working directory for the spawned process.
    pub process_cwd: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TerminalOs {
    MacOs,
    Windows,
}

/// Pure spec builder — both arms compile and are asserted by `cargo test` on
/// every platform; the `#[cfg]` wrappers below pick the arm and read the real
/// environment at runtime.
pub fn terminal_launch_spec(
    os: TerminalOs,
    shell: Option<&str>,
    cwd: &str,
    parent_wslenv: Option<&str>,
) -> TerminalLaunchSpec {
    let term = ("TERM".to_string(), "xterm-256color".to_string());
    let remove_env = vec!["TERMINFO".to_string(), "TERMINFO_DIRS".to_string()];
    match os {
        TerminalOs::MacOs => TerminalLaunchSpec {
            program: shell.unwrap_or("/bin/zsh").to_string(),
            args: vec!["-l".to_string()],
            env: vec![term],
            remove_env,
            process_cwd: Some(cwd.to_string()),
        },
        TerminalOs::Windows => {
            // WSLENV entries are colon-separated NAME/flags; `/u` passes the
            // Win32 value into WSL. Append to any existing list, never clobber.
            let wslenv = match parent_wslenv {
                Some(existing) if !existing.is_empty() => format!("{existing}:TERM/u"),
                _ => "TERM/u".to_string(),
            };
            TerminalLaunchSpec {
                program: "wsl.exe".to_string(),
                args: vec!["--cd".to_string(), cwd.to_string()],
                env: vec![
                    term,
                    ("WSL_UTF8".to_string(), "1".to_string()),
                    ("WSLENV".to_string(), wslenv),
                ],
                remove_env,
                process_cwd: None,
            }
        }
    }
}

#[cfg(target_os = "macos")]
pub fn terminal_launch(cwd: &str) -> TerminalLaunchSpec {
    let shell = std::env::var("SHELL").ok();
    terminal_launch_spec(TerminalOs::MacOs, shell.as_deref(), cwd, None)
}

#[cfg(target_os = "windows")]
pub fn terminal_launch(cwd: &str) -> TerminalLaunchSpec {
    let wslenv = std::env::var("WSLENV").ok();
    terminal_launch_spec(TerminalOs::Windows, None, cwd, wslenv.as_deref())
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

    /// The two macOS launcher tests mutate shared process env vars; cargo runs
    /// tests in parallel threads, so they must serialize or they race.
    #[cfg(target_os = "macos")]
    static ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

    #[cfg(target_os = "macos")]
    #[test]
    fn macos_launcher_defaults_to_home_local_bin() {
        let _guard = ENV_LOCK.lock().unwrap();
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
        let _guard = ENV_LOCK.lock().unwrap();
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
    fn macos_terminal_spec_uses_login_shell_with_term_and_cwd() {
        let spec = terminal_launch_spec(
            TerminalOs::MacOs,
            Some("/opt/homebrew/bin/fish"),
            "/Users/owner/proj",
            None,
        );
        assert_eq!(spec.program, "/opt/homebrew/bin/fish");
        assert_eq!(spec.args, ["-l"]);
        assert_eq!(
            spec.env,
            [("TERM".to_string(), "xterm-256color".to_string())]
        );
        assert_eq!(spec.remove_env, ["TERMINFO", "TERMINFO_DIRS"]);
        assert_eq!(spec.process_cwd.as_deref(), Some("/Users/owner/proj"));
    }

    #[test]
    fn macos_terminal_spec_falls_back_to_zsh_without_shell() {
        let spec = terminal_launch_spec(TerminalOs::MacOs, None, "/Users/owner/proj", None);
        assert_eq!(spec.program, "/bin/zsh");
    }

    #[test]
    fn windows_terminal_spec_uses_wsl_cd_with_no_process_cwd() {
        let spec = terminal_launch_spec(TerminalOs::Windows, None, "/home/owner/proj", None);
        assert_eq!(spec.program, "wsl.exe");
        assert_eq!(spec.args, ["--cd", "/home/owner/proj"]);
        assert_eq!(
            spec.process_cwd, None,
            "a Linux path is not a valid Win32 cwd"
        );
        assert!(spec
            .env
            .contains(&("TERM".to_string(), "xterm-256color".to_string())));
        assert!(spec
            .env
            .contains(&("WSL_UTF8".to_string(), "1".to_string())));
        assert!(spec
            .env
            .contains(&("WSLENV".to_string(), "TERM/u".to_string())));
    }

    #[test]
    fn windows_terminal_spec_appends_term_to_existing_wslenv_with_colon() {
        let spec = terminal_launch_spec(
            TerminalOs::Windows,
            None,
            "/home/owner/proj",
            Some("FOO/p:BAR"),
        );
        assert!(spec
            .env
            .contains(&("WSLENV".to_string(), "FOO/p:BAR:TERM/u".to_string())));
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

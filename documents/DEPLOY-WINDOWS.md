# Deploy — Windows (WSL)

## WSL and backend preflight

The app launches the existing `sudhir-codex` installation inside the **default**
WSL distribution via a login shell; it does not bundle or install one, and it
does not offer a distribution picker.

The installed Tauri app does **not** require the Windows Codex desktop app,
the Windows ChatGPT app, or a Windows Codex CLI. Node, pnpm, and Rust are build
dependencies only; they are not required on a machine receiving an already
built installer.

Inside WSL (default distro):

```bash
which sudhir-codex
sudhir-codex --version
sudhir-codex gateway status
```

Confirm `sudhir-codex` is on the login-shell `PATH` exactly as your working
setup finds it (the app invokes `bash -lic 'exec sudhir-codex app-server
--stdio'`).

## NSIS artifact and installation

1. Obtain the verified x64 NSIS installer. A local Windows build emits it under
   `src-tauri\target\release\bundle\nsis\`; a future approved GitHub Actions
   run exposes the same `.exe` through the
   `sudhir-codex-tauri-windows-x64` artifact.
2. Run the NSIS installer and accept the defaults (or choose an install
   location).
3. The app is installed for the current Windows user; WebView2 is already
   present on Windows 11.

## Default-distribution and project-path expectations

- Projects live inside WSL (for example `/home/<user>/<project>`). Explorer
  and the native folder picker surface them as
  `\\wsl.localhost\<distro>\home\<user>\<project>`.
- The app converts a picked path to the Linux path the backend expects:
  `\\wsl.localhost\...` and `\\wsl$\...` selections are reduced directly;
  genuine Windows drive paths (for example `C:\...`) are converted with
  `wslpath -a -u` to `/mnt/c/...`.
- Threads are filtered by the project's exact backend `cwd`, so existing WSL
  CLI threads appear under the matching project.

## Browser control status

Browser control is intentionally **not supported by the Windows Tauri app**.
This is an owner-approved product boundary, not pending bridge work. In
particular, the installer must not copy, launch, or depend on browser assets
from an official Windows Codex or ChatGPT installation.

```text
Windows Sudhir-Codex Tauri -> WSL Sudhir-Codex app-server
                         (no Windows browser helper or native-host registration)
```

The shared transcript can still render ordinary generated images and safe MCP
image blocks returned by supported WSL tools. That rendering capability does
not imply Windows browser control. Browser runtime packaging, the Chrome/Edge
extension host, native-messaging registration, and a WSL-to-Windows browser
bridge are excluded from this release.

## First-run and real WSL functional smoke test

1. Launch the app from the Start menu. No console window should appear
   alongside the app (the child runs with `CREATE_NO_WINDOW`).
2. Add a project by picking a WSL folder (UNC path).
3. List existing threads, resume one, and complete one short turn.
4. While a turn is active, confirm the composer says `Thinking…`, remains
   editable, and sends **Steer** input into that same turn.
5. Type a long multi-line draft and confirm the composer grows upward to
   220 px before becoming internally scrollable.
6. Press Ctrl-plus and Ctrl-minus to change the full WebView2 UI scale, then
   Ctrl-0 to reset it.
7. Switch models and verify every model shows its backend-supported Effort
   choices. For a `gpt-*` model with a service tier, also change Speed; confirm
   Speed is absent for non-GPT models and the next idle turn uses the choices.
8. Verify the Usage panel (ChatGPT/account and thread tokens) renders or shows
   a plain no-data note.
9. Inspect approval and `request_user_input` cards only if the current backend
   configuration emits them; the fake app-server integration test is the
   authoritative proof for those interaction families.
10. Close and relaunch; the app-server child restarts cleanly and the WSL
   distribution and persistent gateway are untouched.

## Replacement and rollback

Uninstall the previous version from Windows Settings (Apps), then install the
new NSIS artifact. To roll back, keep the previous installer and repeat. WSL
state and `sudhir-codex` are unaffected.

## Removal

Uninstall from Windows Settings (Apps). This preserves the WSL `sudhir-codex`
installation and all state inside WSL.

# Deploy — Windows (WSL)

## WSL and backend preflight

The app launches the existing `sudhir-codex` installation inside the **default**
WSL distribution via a login shell; it does not bundle or install one, and it
does not offer a distribution picker.

Inside WSL (default distro):

```bash
which sudhir-codex
sudhir-codex --version
sudhir-codex gateway status
```

Confirm `sudhir-codex` is on the login-shell `PATH` exactly as your working
setup finds it (the app invokes `bash -lic 'exec sudhir-codex app-server
--stdio'`).

## Artifact download and NSIS installation

1. Download the Windows artifact
   `sudhir-codex-tauri-windows-x64` (NSIS installer `.exe`) from the GitHub
   Actions run.
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

## First-run and real WSL functional smoke test

1. Launch the app from the Start menu. No console window should appear
   alongside the app (the child runs with `CREATE_NO_WINDOW`).
2. Add a project by picking a WSL folder (UNC path).
3. List existing threads, resume one, and complete one short turn.
4. Switch models in the header picker; verify the next turn uses the selection.
5. Verify the Usage panel (ChatGPT/account and thread tokens) renders or shows
   a plain no-data note.
6. Inspect approval and `request_user_input` cards only if the current backend
   configuration emits them; the fake app-server integration test is the
   authoritative proof for those interaction families.
7. Close and relaunch; the app-server child restarts cleanly and the WSL
   distribution and persistent gateway are untouched.

## Replacement and rollback

Uninstall the previous version from Windows Settings (Apps), then install the
new NSIS artifact. To roll back, keep the previous installer and repeat. WSL
state and `sudhir-codex` are unaffected.

## Removal

Uninstall from Windows Settings (Apps). This preserves the WSL `sudhir-codex`
installation and all state inside WSL.

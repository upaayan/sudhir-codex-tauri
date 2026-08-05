# Deploy — macOS

## Backend preflight

The app launches the existing `sudhir-codex` installation; it does not bundle
or install one.

```bash
~/.local/bin/sudhir-codex --version
sudhir-codex gateway status   # if the CLI exposes it
```

The launcher shim must exist at `$HOME/.local/bin/sudhir-codex` (the standard
install location for this machine).

## Artifact download and inspection

1. Download the macOS artifact
   `sudhir-codex-tauri-macos-aarch64.zip` from the GitHub Actions run.
2. Verify the checksum:

```bash
shasum -a 256 ~/Downloads/Sudhir-Codex-Tauri-macos-aarch64.zip
```

3. Verify the ad-hoc signature after extraction:

```bash
ditto -x -k ~/Downloads/Sudhir-Codex-Tauri-macos-aarch64.zip ~/Downloads/sct-extract
codesign -dv --verbose=2 ~/Downloads/sct-extract/"Sudhir-Codex Tauri.app"
```

The signature is ad-hoc (`flags=0x20002(adhoc,linker-signed)`); there is no
Developer ID.

## Installation

```bash
cp -R ~/Downloads/sct-extract/"Sudhir-Codex Tauri.app" /Applications/
```

This does not touch official ChatGPT or the existing Sudhir-Codex frontend;
both may remain installed during migration testing.

## First run — Gatekeeper

The Actions artifact carries `com.apple.quarantine`, so the first launch is
blocked by Gatekeeper. Use Finder: right-click (or Control-click) the app in
`/Applications` and choose **Open**, then confirm in the dialog. Only if
Finder Open is not sufficient, remove quarantine scoped to the installed app
path:

```bash
xattr -dr com.apple.quarantine "/Applications/Sudhir-Codex Tauri.app"
```

## First-run and functional smoke test

1. Launch the app. A diagnostic banner would show startup problems; a healthy
   start shows no banner.
2. Add a project (native folder picker).
3. Select an existing thread or start a new one; send one short turn.
4. Switch the model in the header picker; verify the next turn uses it.
5. Open the Usage panel and confirm ChatGPT/account and thread token figures
   render (or show a plain "no data" note).
6. Inspect approval and `request_user_input` cards only if the current
   backend configuration emits them; the fake app-server integration test is
   the authoritative proof for those interaction families.
7. Close the window and relaunch; the app-server child is shut down and
   restarted cleanly. The persistent `sudhir-codex` gateway keeps running.

## Replacement and rollback

To replace: quit the app, `rm -rf "/Applications/Sudhir-Codex Tauri.app"`,
then repeat installation. To roll back to a previous build, keep the previous
ZIP and repeat the same steps. Your threads and state live under
`$HOME/.sudhir-codex` and are untouched by any of this.

## Removal

```bash
rm -rf "/Applications/Sudhir-Codex Tauri.app"
```

This preserves `$HOME/.sudhir-codex`, all threads, credentials, and the
`sudhir-codex` installation.

# Deploy — macOS

## Backend preflight

The app launches the existing `sudhir-codex` installation; it does not bundle
or install one.

```bash
~/.local/bin/sudhir-codex --version
~/.local/bin/sudhir-codex doctor
```

The launcher must exist at `$HOME/.local/bin/sudhir-codex`, and the persistent
gateway must already be healthy.

For this local build, Chrome control uses the `node_repl`, browser-client, and
module assets configured from `/Applications/Sudhir-Codex.app`. Keep that
separately namespaced app installed (it does not need to be running) until the
runtime is packaged independently; removing it will break the Chrome-control
smoke step below.

## Build and sign the local candidate

From the repository root:

```bash
pnpm install --frozen-lockfile
pnpm test
pnpm build
cd src-tauri && cargo fmt --check && cargo test && cd ..
pnpm tauri:package:mac
```

`tauri:package:mac` builds for Apple Silicon and then runs
`scripts/sign-macos-candidate.mjs`. The script retrieves secret
`alamelu/pi-codesign` from AWS Secrets Manager in `ap-south-1`, unlocks the
explicit dedicated keychain, signs by the AWS-provided identity hash with
hardened runtime and no timestamp, and verifies the result. It must never
print the secret, request a password, or fall back to a friendly certificate
name.

The signed candidate is:

```text
src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Sudhir-Codex Tauri.app
```

Tauri creates the DMG before this post-build signing step, so that DMG is not
the local test artifact. ZIP the signed app instead:

```bash
mkdir -p work/artifacts
ditto -c -k --sequesterRsrc --keepParent \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Sudhir-Codex Tauri.app" \
  "work/artifacts/Sudhir-Codex-Tauri-macos-aarch64-signed.zip"
shasum -a 256 work/artifacts/Sudhir-Codex-Tauri-macos-aarch64-signed.zip
```

## Static verification

```bash
candidate="src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Sudhir-Codex Tauri.app"
codesign --verify --deep --strict --verbose=2 "$candidate"
codesign -dv --verbose=4 "$candidate"
/usr/libexec/PlistBuddy \
  -c 'Print :CFBundleIdentifier' \
  -c 'Print :CFBundleName' \
  -c 'Print :CFBundleExecutable' \
  "$candidate/Contents/Info.plist"
```

Expected identifier: `com.sudhir.codex.tauri`. `codesign -dv` must show a
non-ad-hoc local signature and hardened runtime. This is local signing, not an
Apple-notarized Developer ID release.

## Installation

Quit only an older `Sudhir-Codex Tauri` instance. Do not stop official ChatGPT,
the separately namespaced `/Applications/Sudhir-Codex.app`, or the persistent
gateway.

If an older Tauri app exists, preserve a dated rollback before replacement:

```bash
mkdir -p work/backups
stamp="$(date +%Y%m%d-%H%M%S)"
ditto "/Applications/Sudhir-Codex Tauri.app" \
  "work/backups/Sudhir-Codex-Tauri.pre-update-$stamp.app"
codesign --verify --deep --strict \
  "work/backups/Sudhir-Codex-Tauri.pre-update-$stamp.app"
```

Install the verified candidate at the canonical path:

```bash
ditto \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Sudhir-Codex Tauri.app" \
  "/Applications/Sudhir-Codex Tauri.app"
codesign --verify --deep --strict "/Applications/Sudhir-Codex Tauri.app"
open "/Applications/Sudhir-Codex Tauri.app"
```

A locally built app should not carry download quarantine. If a ZIP transferred
through another service acquires quarantine, use Finder's right-click **Open**
flow first. Do not remove quarantine from any broader path.

## Functional smoke test

1. Launch the app. A healthy start shows no diagnostic banner.
2. Confirm the Parallel Handoff logo appears in Finder and the Dock.
3. Add a project with the native folder picker.
4. Select an existing thread or start a new one; send one short turn. Confirm
   the thread is named automatically and tool/thinking output stays inside the
   initially closed Activity disclosure.
5. While that turn is active, confirm the composer says `Thinking…`, remains
   editable, and shows both **Steer** and **Interrupt**. Type a correction and
   press Enter or **Steer**; confirm it joins the same running turn. After the
   turn completes, confirm the idle prompt says `Type your request…`.
6. Paste or type a long multi-line draft. Confirm the composer grows upward as
   text wraps, up to 220 px, and only then becomes internally scrollable.
7. Press Command-plus and Command-minus to change the complete UI scale, then
   Command-0 to reset it.
8. Attach one image and one document, once with the picker and once by dropping
   a file into the composer. Confirm both attachment chips appear and send.
9. Ask for a generated image. Confirm the in-progress card becomes a rendered
   image with its revised prompt below it.
10. Switch among System, Light, and Dark themes. Switch models and confirm each
   model exposes its backend-supported Effort choices. For a `gpt-*` model,
   also change the available Speed tier; confirm Speed is absent for non-GPT
   models and the next idle turn uses the choices.
11. With Google Chrome already running and the ChatGPT browser extension
   enabled, ask `Use Chrome to open https://example.com and take a screenshot`.
   Accept the visible browser-origin request. Expand Activity and confirm the
   returned screenshot renders there.
12. Open Usage and confirm account and thread figures render.
13. Close and relaunch. The app-server child must stop and restart while the
   persistent gateway remains running.
14. With a project selected, press Command-J (or the topbar terminal icon).
   The terminal panel opens with a shell prompt at the project directory.
   This must be tested on the installed Finder-launched bundle — `tauri dev`
   inherits the developer shell's `TERM` and cannot prove this.
15. In that terminal run `clear`, then open and quit `vim`. Both must work
   (proves `TERM=xterm-256color` reaches the shell).
16. On a thread that produced file changes, press Command-D (or the changes
   icon). The Changes panel opens as a right column with colorized diffs; the
   usage rail hides while it is open and returns when it closes.
17. Press Command-O; the native folder picker opens.
18. Quit the app, then check `ps aux | grep -i zsh` (or the login shell) for
   shells left behind by the terminal panel; none should remain.

Generated images and MCP screenshot image blocks are delivered by app-server
JSON-RPC and rendered as data URLs; display does not require filesystem
permissions. File-picker and drag/drop attachments are converted to backend
paths before the turn starts.

## Release sequencing

Stop after the signed local app and owner smoke test. Do not modify or dispatch
GitHub Actions until the owner explicitly approves this build. After approval,
regenerate both Windows and macOS artifacts so the same UI and icon changes are
tested on both platforms.

## Post-approval GitHub Actions artifact

Only after that approval and a successful Actions run, download artifact
`sudhir-codex-tauri-macos-aarch64`. Verify the downloaded wrapper and the inner
`Sudhir-Codex-Tauri-macos-aarch64.zip` checksum before extraction, then inspect
the CI bundle:

```bash
shasum -a 256 ~/Downloads/Sudhir-Codex-Tauri-macos-aarch64.zip
mkdir -p ~/Downloads/sudhir-codex-tauri-actions
ditto -x -k ~/Downloads/Sudhir-Codex-Tauri-macos-aarch64.zip \
  ~/Downloads/sudhir-codex-tauri-actions
codesign --verify --deep --strict --verbose=2 \
  ~/Downloads/sudhir-codex-tauri-actions/"Sudhir-Codex Tauri.app"
codesign -dv --verbose=4 \
  ~/Downloads/sudhir-codex-tauri-actions/"Sudhir-Codex Tauri.app"
```

The Actions bundle is ad-hoc signed, unlike the locally signed owner-test
bundle. After installing it under `/Applications`, use Finder's right-click
**Open** flow for the first quarantined launch. Only if Finder Open is
insufficient, remove quarantine from the exact installed Tauri app path—never
from `/Applications` or another broader path.

## Rollback and removal

To roll back, quit only `Sudhir-Codex Tauri`, preserve the failed candidate,
restore the verified dated backup to `/Applications/Sudhir-Codex Tauri.app`,
verify it, and reopen it.

Removing `/Applications/Sudhir-Codex Tauri.app` removes only this frontend. It
does not remove `$HOME/.sudhir-codex`, the CLI/backend, gateway, threads, or
credentials.

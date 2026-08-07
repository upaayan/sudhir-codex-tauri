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

## NSIS artifact overview

1. Obtain the verified x64 NSIS installer. A local Windows build emits it under
   `src-tauri\target\release\bundle\nsis\`; a future approved GitHub Actions
   run exposes the same `.exe` through the
   `sudhir-codex-tauri-windows-x64` artifact.
2. Do not run it until artifact preflight, rollback preservation, and exact
   process inspection below have passed.
3. Install through the bounded installation-only stage below. The result is a
   current-user app; WebView2 is already present on Windows 11.

The exact update procedure follows. Do not replace it with one combined
install-and-test command.

## Required deployment shape: one observable stage at a time

Do not combine download, backup, installation, verification, launch, shutdown,
and relaunch in one S3-relay command. The relay uploads captured output only
after a command exits, so a monolithic command hides its last successful step.

Use one command object and one response object for each stage:

1. artifact preflight;
2. current-install inspection and backup;
3. exact-process shutdown, if an older app is running;
4. NSIS installation only;
5. registry, shortcut, version, signature, and hash verification;
6. first launch and WSL-child verification;
7. graceful shutdown and child cleanup;
8. relaunch and gateway health verification.

Do not submit the next stage until the current response exists and ends in
`PASS`. A failed install-stage response is a diagnostic result: inspect Windows
state before deciding whether to retry. Never blindly rerun the installer.

### S3 relay protocol

The current relay uses bucket `sudhir-windows-relay` in `ap-south-1`:

```text
command:  s3://sudhir-windows-relay/relay_cmd_<run-id>.sh
claim:    s3://sudhir-windows-relay/claims/<run-id>
response: s3://sudhir-windows-relay/relay_response_<run-id>.txt
```

For each stage, create a unique run ID, upload that stage's short shell script,
and poll its exact response key. For example, from the controlling Mac:

```bash
TAURI_DEPLOY_RUN_ID="windows_artifact_preflight_$(date +%s)"
TAURI_DEPLOY_STAGE_SCRIPT="/absolute/path/to/windows-artifact-preflight.sh"

aws s3 cp \
  "$TAURI_DEPLOY_STAGE_SCRIPT" \
  "s3://sudhir-windows-relay/relay_cmd_${TAURI_DEPLOY_RUN_ID}.sh" \
  --region ap-south-1

for TAURI_DEPLOY_ATTEMPT in $(seq 1 180); do
  if aws s3api head-object \
    --bucket sudhir-windows-relay \
    --region ap-south-1 \
    --key "relay_response_${TAURI_DEPLOY_RUN_ID}.txt" >/dev/null 2>&1; then
    break
  fi
  sleep 2
done

aws s3api head-object \
  --bucket sudhir-windows-relay \
  --region ap-south-1 \
  --key "relay_response_${TAURI_DEPLOY_RUN_ID}.txt" >/dev/null
aws s3 cp \
  "s3://sudhir-windows-relay/relay_response_${TAURI_DEPLOY_RUN_ID}.txt" \
  - \
  --region ap-south-1
```

For a PowerShell stage, first upload the `.ps1` as a payload, then make the
short relay command do only the download and bounded PowerShell invocation:

```bash
TAURI_DEPLOY_PAYLOAD_NAME="windows-install-only.ps1"
aws s3 cp \
  "/absolute/path/$TAURI_DEPLOY_PAYLOAD_NAME" \
  "s3://sudhir-windows-relay/payloads/$TAURI_DEPLOY_PAYLOAD_NAME" \
  --region ap-south-1
```

```bash
#!/usr/bin/env bash
set -euo pipefail

TAURI_DEPLOY_POWERSHELL_SCRIPT="/tmp/windows-install-only.ps1"
aws s3 cp \
  s3://sudhir-windows-relay/payloads/windows-install-only.ps1 \
  "$TAURI_DEPLOY_POWERSHELL_SCRIPT" \
  --region ap-south-1 >/dev/null

TAURI_DEPLOY_POWERSHELL_NATIVE="$(wslpath -w "$TAURI_DEPLOY_POWERSHELL_SCRIPT")"
/mnt/c/Windows/System32/WindowsPowerShell/v1.0/powershell.exe \
  -NoLogo \
  -NoProfile \
  -NonInteractive \
  -ExecutionPolicy Bypass \
  -File "$TAURI_DEPLOY_POWERSHELL_NATIVE"
```

Each stage script must use `set -euo pipefail`, print `step=<name>` before its
work, print the paths, PIDs, hashes, or statuses needed to diagnose failure,
and print `<name>=PASS` only after its assertions pass. Put an explicit bound
on every process wait.

### Critical relay-shell trap

Never invoke `bash -i`, `bash -ic`, or `bash -lic` inside a background relay
command. An interactive shell without a controlling foreground terminal can
receive the job-control stop signal and remain in process state `T`. The
2026-08-06 deployment stopped at exactly this command before installation:

```text
bash -lic command -v sudhir-codex
```

Use a non-interactive shell or the already verified absolute executable:

```bash
bash -lc 'command -v sudhir-codex'
/home/ubuntu/.local/bin/sudhir-codex gateway status
```

This restriction applies to relay scripts. The Tauri application itself
intentionally starts its WSL backend with
`wsl.exe --exec bash -lic "exec sudhir-codex app-server --stdio"`; that
foreground Windows child launch is separately tested and must not be changed
to work around a relay-only job-control problem.

If a relay job appears stuck, inspect it before terminating anything:

```powershell
wsl.exe -- bash -lc "pstree -ap <timeout-pid>; ps -o pid,ppid,stat,wchan:32,etime,args --ppid <timeout-pid>,<script-pid>"
```

Only after the tree proves the installer was never started may the exact
stopped relay PIDs be terminated. Never kill all WSL, PowerShell, installer, or
Tauri processes.

## Artifact preflight

Retain all three inputs before changing Windows:

- the new NSIS installer;
- the matching raw `target\\release\\sudhir-codex-tauri.exe`, needed for the
  unsigned NSIS hash proof below — for a GitHub Actions build this is the
  `sudhir-codex-tauri-windows-x64-raw` artifact from the same run (added
  2026-08-07; earlier runs shipped only the installer);
- the last known-good installer for rollback.

In WSL, use task-specific variables and verify every input before installation:

```bash
TAURI_DEPLOY_INSTALLER="/mnt/c/Users/Asus/Downloads/<new-installer>.exe"
TAURI_DEPLOY_BUILD_EXE="/mnt/c/Users/Asus/<build>/src-tauri/target/release/sudhir-codex-tauri.exe"
TAURI_DEPLOY_ROLLBACK_INSTALLER="/mnt/c/Users/Asus/SudhirCodexTauriBackups/<previous-installer>.exe"
TAURI_DEPLOY_EXPECTED_INSTALLER_SHA256="<published-installer-sha256>"
TAURI_DEPLOY_EXPECTED_ROLLBACK_SHA256="<published-rollback-sha256>"

test -f "$TAURI_DEPLOY_INSTALLER"
test -f "$TAURI_DEPLOY_BUILD_EXE"
test -f "$TAURI_DEPLOY_ROLLBACK_INSTALLER"

TAURI_DEPLOY_INSTALLER_SHA256="$(sha256sum "$TAURI_DEPLOY_INSTALLER" | awk '{print $1}')"
TAURI_DEPLOY_BUILD_SHA256="$(sha256sum "$TAURI_DEPLOY_BUILD_EXE" | awk '{print $1}')"
TAURI_DEPLOY_ROLLBACK_SHA256="$(sha256sum "$TAURI_DEPLOY_ROLLBACK_INSTALLER" | awk '{print $1}')"

printf 'installer_sha256=%s\n' "$TAURI_DEPLOY_INSTALLER_SHA256"
printf 'build_executable_sha256=%s\n' "$TAURI_DEPLOY_BUILD_SHA256"
printf 'rollback_installer_sha256=%s\n' "$TAURI_DEPLOY_ROLLBACK_SHA256"

test "$TAURI_DEPLOY_INSTALLER_SHA256" = "$TAURI_DEPLOY_EXPECTED_INSTALLER_SHA256"
test "$TAURI_DEPLOY_ROLLBACK_SHA256" = "$TAURI_DEPLOY_EXPECTED_ROLLBACK_SHA256"
printf 'artifact_preflight=PASS\n'
```

The published installer SHA-256 is the primary artifact-integrity check. It
must be calculated after any legitimate signing operation because signing
changes the file bytes.

## Windows signing rule

Windows does not require Authenticode signing for this owner's local install.
When no Windows code-signing certificate is configured, `NotSigned` is the
expected result for both the installer and installed executable:

```powershell
$TauriDeployInstallerPath = "C:\Users\Asus\Downloads\<new-installer>.exe"
Get-AuthenticodeSignature -LiteralPath $TauriDeployInstallerPath |
  Select-Object Status, StatusMessage
```

Do not create or trust a self-signed certificate merely to make this check say
`Valid`. The AWS signing material used for the Mac build is Apple-only and is
not a Windows Authenticode certificate.

If Windows signing becomes a release requirement later, stop and configure a
real Windows code-signing identity in the build. Sign before publishing the
final installer hash, require `Valid` for the installer and installed
executable, and add a signed-payload hash manifest to the release. The unsigned
marker-derived hash procedure below is not sufficient for a signed executable
because Authenticode adds bytes after the NSIS bundle marker is patched.

## Inspect, preserve, and stop an existing installation

Before updating, inspect the current-user uninstall entry and the exact app
process. Preserve the last known-good installer and copy the existing install
directory to a timestamped rollback directory. Verify the copied executable's
hash before continuing.

The default current-user paths are:

```text
executable: C:\Users\<user>\AppData\Local\Sudhir-Codex Tauri\sudhir-codex-tauri.exe
shortcut:   C:\Users\<user>\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Sudhir-Codex Tauri.lnk
backup:     C:\Users\<user>\SudhirCodexTauriBackups\pre-update-<timestamp>\
```

Use the uninstall entry and shortcut target as the authority if a custom path
was selected. Stop only the process whose `Path` equals that resolved
executable. First request `CloseMainWindow()` and wait up to 15 seconds. If it
does not exit, report that result before deciding whether to force only that
exact PID. Do not stop the persistent WSL gateway.

## NSIS installation-only stage

Run installation as its own PowerShell stage. The silent local install does not
need signing or elevation. Wait on the exact installer PID with a hard bound;
do not use an unbounded `Start-Process -Wait` in the relay:

```powershell
$ErrorActionPreference = "Stop"
$TauriDeployInstallerPath = "C:\Users\Asus\Downloads\<new-installer>.exe"

Write-Output "step=nsis_install"
$TauriDeployInstallProcess = Start-Process `
  -FilePath $TauriDeployInstallerPath `
  -ArgumentList "/S" `
  -WorkingDirectory (Split-Path -Parent $TauriDeployInstallerPath) `
  -PassThru
Write-Output "installer_pid=$($TauriDeployInstallProcess.Id)"

if (-not $TauriDeployInstallProcess.WaitForExit(120000)) {
  Stop-Process -Id $TauriDeployInstallProcess.Id -Force -ErrorAction SilentlyContinue
  throw "Installer did not exit within 120 seconds"
}

$TauriDeployInstallProcess.Refresh()
Write-Output "nsis_exit_code=$($TauriDeployInstallProcess.ExitCode)"
if ($TauriDeployInstallProcess.ExitCode -ne 0) {
  throw "NSIS installer failed"
}
Write-Output "nsis_install=PASS"
```

The successful stage must end before any registry, launch, or gateway check is
submitted.

## Installed-file and hash verification

Verify all of the following in a separate read-only stage:

1. exactly one uninstall entry whose `DisplayName` is `Sudhir-Codex Tauri`;
2. the expected `DisplayVersion`;
3. an existing Start-menu shortcut whose target exists;
4. the installed executable's SHA-256;
5. the expected Authenticode status (`NotSigned` for the current local flow,
   `Valid` only after a real Windows signing flow is configured);
6. the executable's product version;
7. no unexpected running Tauri process before the first-launch stage.

When using PowerShell strict mode to enumerate uninstall entries, do not assume
every unrelated registry object has `DisplayName`. Test the property first:

```powershell
Where-Object {
  $TauriDeployDisplayName = $_.PSObject.Properties["DisplayName"]
  $null -ne $TauriDeployDisplayName -and
    $TauriDeployDisplayName.Value -eq "Sudhir-Codex Tauri"
}
```

### Critical Tauri NSIS hash trap

Do not directly compare the installed executable with the raw
`target\\release\\sudhir-codex-tauri.exe`. Tauri temporarily changes the
embedded bundle marker from `__TAURI_BUNDLE_TYPE_VAR_UNK` to
`__TAURI_BUNDLE_TYPE_VAR_NSS` before constructing the NSIS installer, then
restores the raw build executable. Therefore the two correct files normally
have different SHA-256 values.

For the current unsigned build, derive the exact expected installed hash from
the raw build without modifying either file:

```bash
TAURI_DEPLOY_BUILD_EXE="/mnt/c/Users/Asus/<build>/src-tauri/target/release/sudhir-codex-tauri.exe"
TAURI_DEPLOY_INSTALLED_EXE="/mnt/c/Users/Asus/AppData/Local/Sudhir-Codex Tauri/sudhir-codex-tauri.exe"

TAURI_DEPLOY_BUILD_MARKER="$(LC_ALL=C grep -ao '__TAURI_BUNDLE_TYPE_VAR_[A-Z]*' "$TAURI_DEPLOY_BUILD_EXE" | sort -u)"
TAURI_DEPLOY_INSTALLED_MARKER="$(LC_ALL=C grep -ao '__TAURI_BUNDLE_TYPE_VAR_[A-Z]*' "$TAURI_DEPLOY_INSTALLED_EXE" | sort -u)"
TAURI_DEPLOY_EXPECTED_INSTALLED_SHA256="$(LC_ALL=C sed 's/__TAURI_BUNDLE_TYPE_VAR_UNK/__TAURI_BUNDLE_TYPE_VAR_NSS/' "$TAURI_DEPLOY_BUILD_EXE" | sha256sum | awk '{print $1}')"
TAURI_DEPLOY_ACTUAL_INSTALLED_SHA256="$(sha256sum "$TAURI_DEPLOY_INSTALLED_EXE" | awk '{print $1}')"

printf 'build_marker=%s\n' "$TAURI_DEPLOY_BUILD_MARKER"
printf 'installed_marker=%s\n' "$TAURI_DEPLOY_INSTALLED_MARKER"
printf 'expected_nsis_patched_sha256=%s\n' "$TAURI_DEPLOY_EXPECTED_INSTALLED_SHA256"
printf 'actual_installed_sha256=%s\n' "$TAURI_DEPLOY_ACTUAL_INSTALLED_SHA256"

test "$TAURI_DEPLOY_BUILD_MARKER" = "__TAURI_BUNDLE_TYPE_VAR_UNK"
test "$TAURI_DEPLOY_INSTALLED_MARKER" = "__TAURI_BUNDLE_TYPE_VAR_NSS"
test "$TAURI_DEPLOY_EXPECTED_INSTALLED_SHA256" = "$TAURI_DEPLOY_ACTUAL_INSTALLED_SHA256"
printf 'nsis_bundle_hash_proof=PASS\n'
```

If any of those assertions fails, stop. Do not reinstall merely because the
raw and installed hashes differ.

## First launch, shutdown, and relaunch gates

Keep these as three separate PowerShell/relay responses.

### First launch

1. Start the verified Start-menu `.lnk`.
2. Wait at most 20 seconds for the exact `sudhir-codex-tauri.exe` path.
3. Find its direct `wsl.exe` child with `Get-CimInstance Win32_Process -Filter
   "ParentProcessId = <app-pid>"`.
4. Require the child command line to contain both `--exec` and
   `sudhir-codex app-server --stdio`.
5. Require the WSL process's `MainWindowHandle` to be `0`.
6. Wait five seconds and require the Tauri process to remain alive.
7. Record both PIDs and end with `first_launch=PASS`.

### Graceful shutdown

1. Resolve the same exact app process and its one direct WSL child.
2. Record both PIDs.
3. Call `CloseMainWindow()` and wait at most 15 seconds.
4. Require the recorded WSL child PID to disappear.
5. End with `first_shutdown=PASS`. Do not relaunch inside this stage.

### Relaunch and runtime health

1. Start the same Start-menu shortcut again.
2. Repeat the app PID, WSL child command, hidden-console, and five-second
   survival checks; end with `relaunch=PASS` and leave the app open.
3. In a final non-interactive WSL stage, run the already resolved CLI's
   `--version` and `gateway status`, require at least one
   `sudhir-codex-core ... app-server --stdio` process, and end with
   `wsl_runtime_health=PASS`.

Only after all stages pass is the installation ready for owner testing.

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

For a normal replacement, preserve the old installer and installed directory,
close only the exact Tauri process, and run the new NSIS installer in place.
Then repeat every verification, launch, shutdown, relaunch, and gateway gate
above. Do not uninstall first unless the installer explicitly requires it; an
unnecessary uninstall makes rollback less observable.

To roll back:

1. close only the exact installed Tauri process;
2. verify the retained rollback installer's published SHA-256;
3. run that installer as a bounded installation-only stage;
4. repeat the registry, shortcut, version, signature, correct bundle-hash,
   first-launch, shutdown, relaunch, and gateway checks;
5. keep the failed/new installer and captured relay responses until the cause
   is understood.

WSL state and `sudhir-codex` are unaffected. Do not stop, reinstall, or delete
the persistent gateway as part of desktop rollback.

## Current verified baseline (2026-08-07)

These values identify the installation from which the next Windows update must
start:

```text
reviewed commit:        7be86f1 (UI/UX overhaul + owner requests, main)
installer S3:           s3://sudhir-windows-relay/artifacts/Sudhir-Codex-Tauri-gha-windows-x64-uiux-20260807.exe
installer SHA-256:      6db5b27bf1a30d9dbef03b6f71adc20a268c1039d414f2e1ca76fa17e84c6d24
installed EXE SHA-256:  91c67bdbb50433002847b0097f0bd9de2ae36a75caa73e10bfe59f25bcefc087
rollback installer:     C:\Users\Asus\SudhirCodexTauriBackups\Sudhir-Codex-Tauri-local-windows-x64-effort-20260806-2208.exe
rollback SHA-256:       3ba51c3979761705893aa4463969a899a5e43cf7c2d82f04840e42f5482f3049
pre-update backup:      C:\Users\Asus\SudhirCodexTauriBackups\pre-update-20260807-191347\
display/product version: 0.1.0
Authenticode:           NotSigned (expected and owner-approved)
```

Deviation from the raw-build hash proof: the GitHub Actions artifact ships only
the NSIS installer (no raw `target\release\sudhir-codex-tauri.exe`), so the
marker-derived expected-hash proof could not be computed for this update. The
installer SHA-256 (primary check) and the installed-executable
`__TAURI_BUNDLE_TYPE_VAR_NSS` marker assertion both passed. Fixed for future
deployments on 2026-08-07: the workflow now also uploads the raw exe as the
`sudhir-codex-tauri-windows-x64-raw` artifact, restoring the full proof from
the next build onward.

All stages passed on 2026-08-07: artifact preflight, inspect/backup, exact-stop
(no instance running), bounded NSIS install (exit 0), registry/shortcut/
version/signature/hash/marker verification, first launch (hidden WSL child with
the exact app-server command), graceful shutdown with child cleanup, relaunch
(left open for owner testing), and WSL runtime health (gateway pid 579, one
`app-server --stdio` process). Credential sync executed the same day: Mac push
with round-trip verification, WSL pull with backups; all four installed hashes
match the Mac sources byte-for-byte.

## Previous verified baseline (2026-08-06)

These values identify the installation from which the next Windows update must
start:

```text
reviewed commit:        b647288b287d955bcc9a760ba026dd0f1a1cbde7
installer S3:           s3://sudhir-windows-relay/artifacts/Sudhir-Codex-Tauri-local-windows-x64-effort-20260806-2208.exe
installer SHA-256:      3ba51c3979761705893aa4463969a899a5e43cf7c2d82f04840e42f5482f3049
raw build EXE SHA-256:  629ba6d63b360262054a6737d81b1edfa69f17ab09b0ff7ea98c67266cd0078a
installed EXE SHA-256:  442eba1b86ca8d1b59b36d679c5f71c9f00f6a7c66df1161bd7532afcc905d8f
rollback SHA-256:       03c910fdf10159d6173c9cf298ad3999d184016d0cb145a4517e9f9e08fd84bc
display/product version: 0.1.0
Authenticode:           NotSigned (expected and owner-approved)
```

The installed executable is
`C:\Users\Asus\AppData\Local\Sudhir-Codex Tauri\sudhir-codex-tauri.exe`.
The rollback installer is
`C:\Users\Asus\SudhirCodexTauriBackups\Sudhir-Codex-Tauri-baseline-20260806.exe`.
The Start-menu shortcut, first launch, graceful shutdown, relaunch, hidden WSL
child, exact app-server command, and persistent gateway health all passed. The
app was left open for owner testing. Windows browser control remains absent by
the owner's ruling.

## Post-deployment cleanup (after success or completed rollback)

Run cleanup only after the final gate has passed **and** the owner has
confirmed hands-on testing (or, for a rollback, after the rollback's own gates
passed and the failure cause is understood — the doc's retention rule for
failed artifacts takes precedence until then). Clean transients; never clean
the rollback chain.

**Mac (controlling machine):**

- Delete staged copies of installers, extracted app bundles, stage scripts,
  and downloaded relay responses from the session scratch/work area.
- Delete any pre-update `.app` backups taken on the Mac once the new Mac build
  is owner-confirmed.
- Nothing credential-bearing is ever staged on the Mac by this flow (the sync
  path is Secrets Manager only); there is nothing credential-related to wipe.

**Relay bucket (`s3://sudhir-windows-relay`):** delete the transient objects of
the completed deployment; retain `scripts/` (poller + sync) and `artifacts/`
(current installer, raw exe, and the rollback chain).

Do **not** use `aws s3 rm --recursive` — bulk recursive deletes trip the
repo-memory safety hook on the controlling Mac (verified 2026-08-07) and are
also harder to audit. Enumerate the exact keys first, review the keep-list,
then delete the enumerated objects explicitly:

```bash
aws s3api list-objects-v2 --bucket sudhir-windows-relay --region ap-south-1 \
  --query 'Contents[].Key' --output json > /tmp/relay_all_keys.json

python3 - << 'PY'
import json
keys = json.load(open("/tmp/relay_all_keys.json"))
transient = [k for k in keys if k.startswith(
    ("relay_cmd_", "relay_response_", "claims/", "payloads/"))]
keep = [k for k in keys if k not in transient]
print(f"total={len(keys)} delete={len(transient)} keep={len(keep)}")
print("--- keeping ---")
for k in sorted(keep):
    print(" ", k)
json.dump({"Objects": [{"Key": k} for k in transient], "Quiet": True},
          open("/tmp/relay_delete_payload.json", "w"))
PY

# Review the printed keep-list (must be exactly scripts/ + the artifacts/
# rollback chain) BEFORE running the delete:
aws s3api delete-objects --bucket sudhir-windows-relay --region ap-south-1 \
  --delete file:///tmp/relay_delete_payload.json
rm -f /tmp/relay_all_keys.json /tmp/relay_delete_payload.json
```

`delete-objects` accepts at most 1000 keys per call; repeat the enumeration if
more remain. Keep the two most recent installers under `artifacts/` (current +
rollback); older ones may be pruned once a newer baseline has been verified.

**Windows/WSL:** remove the temp payloads the stages downloaded; keep the
Downloads installer (it is the current release) and every
`SudhirCodexTauriBackups` entry that is part of the live rollback chain (the
retained rollback installer and the latest `pre-update-<timestamp>` directory;
older pre-update directories may be pruned after the *next* verified baseline):

```bash
rm -f /tmp/stage*.ps1 /tmp/windows-credential-sync.sh /tmp/relay_claim.*
```

**Never delete as part of cleanup:** Secrets Manager entries; the WSL
credential backups (`~/.pi/agent/backups/<ts>`) until the next successful
sync; the rollback installer or the latest pre-update backup; the persistent
gateway or any WSL state.

## Removal

Uninstall from Windows Settings (Apps). This preserves the WSL `sudhir-codex`
installation and all state inside WSL.

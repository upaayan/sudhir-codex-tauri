# Build and rebuild

This document records the exact toolchain and commands for building
Sudhir-Codex Tauri from a clean clone. Commands marked **[verified]** were run
on 2026-08-05 during implementation; re-run them after any change.

## Prerequisites and pinned versions

- macOS Apple Silicon (this build: macOS 26.5.2, arm64) or x64 Windows.
- Node `24.16.0` (required: the tests run `.ts` files directly through the
  built-in type stripper; do not use an older Node).
- pnpm `11.5.2` (recorded in `package.json` via `packageManager`).
- Stable Rust (this build: `rustc 1.97.1`). macOS needs the
  `aarch64-apple-darwin` target; Windows needs the MSVC x64 target.
- GitHub Actions runner labels pinned to `macos-15` (Apple Silicon) and
  `windows-2022` (x64). **Re-check the official runner-image deprecation
  notices before reusing these labels.**

Frontend dependencies are pinned exactly in `package.json`; Rust dependencies
are caret-constrained in `src-tauri/Cargo.toml` and pinned by the committed
`src-tauri/Cargo.lock` and `pnpm-lock.yaml`.

Since the 2026-08-14 Alamelu-Pi port the frontend depends on `@xterm/xterm`
and `@xterm/addon-fit` (exact pins) for the terminal panel, and the Rust
crate on `portable-pty` (openpty on macOS, ConPTY on Windows) and `base64`
for the PTY host in `src-tauri/src/terminal.rs`. Both lockfiles must be
committed together with any dependency change — the GHA workflow installs
with `--frozen-lockfile` and fails otherwise. `cargo test` includes a real
PTY round-trip on macOS (spawns `/bin/zsh -l` through the exact launch spec
and asserts `TERM=xterm-256color`); it is `#[cfg(target_os = "macos")]` and
does not run on the Windows CI job, where the WSL terminal is proven at the
owner's Windows smoke instead.

## Repository

- Public repository: `https://github.com/upaayan/sudhir-codex-tauri`
- Local checkout: `git clone git@github.com:upaayan/sudhir-codex-tauri.git`
- Default branch: `main`. `origin` is the public repository.
- The local-only debate-loop records live under
  `documents/plan-audit-implementation/` and are recursively gitignored; they
  are never pushed.
- Generated output (`node_modules/`, `dist/`, `src-tauri/target/`,
  `src-tauri/gen/`, scratch under `work/`) is gitignored.

## Clean clone through local dev, test, and package

```bash
git clone git@github.com:upaayan/sudhir-codex-tauri.git
cd sudhir-codex-tauri
pnpm install --frozen-lockfile
```

### TypeScript typecheck and web build **[verified]**

```bash
pnpm typecheck
pnpm build
```

### Tests **[verified]**

```bash
pnpm test
# runs the RPC/state tests plus transcript grouping regression tests
```

`tests/codex-rpc.test.ts` contains the fake app-server integration checks and
spawns `tests/fake-app-server.mjs` over real JSONL pipes; this is the
authoritative proof for the approval and `request_user_input` interaction
families, which the owner's live policy (`approval_policy = "never"`,
Default-mode sessions) does not emit.

### Rust tests and builds **[verified on macOS]**

```bash
cd src-tauri
cargo fmt
cargo test
cargo build          # debug
cd ..
pnpm tauri build     # release bundles (.app + .dmg on macOS, NSIS on Windows)
```

An explicit Apple Silicon build lands under
`src-tauri/target/aarch64-apple-darwin/release/bundle/`:

```bash
pnpm tauri:package:mac
```

That command builds the app, retrieves `alamelu/pi-codesign` from AWS Secrets
Manager, unlocks the dedicated signing keychain non-interactively, signs by
the AWS-provided identity hash, and verifies the hardened-runtime signature.
It never prints the keychain password or signs by the duplicated friendly
certificate name.

Tauri creates its DMG before the post-build local signing step. For local
testing, install the signed `.app` directly or ZIP that signed bundle:

```bash
mkdir -p work/artifacts
ditto -c -k --sequesterRsrc --keepParent \
  "src-tauri/target/aarch64-apple-darwin/release/bundle/macos/Sudhir-Codex Tauri.app" \
  "work/artifacts/Sudhir-Codex-Tauri-macos-aarch64-signed.zip"
```

### Native Windows verification and local package

Run the Windows build with Windows Node/Rust from a Windows-drive checkout;
the packaged app will still launch the backend in default WSL at runtime.
Neither the Windows Codex desktop app nor the Windows ChatGPT app is a build or
runtime dependency.

On a Corepack-only Windows installation, Tauri's configured
`beforeBuildCommand` still invokes bare `pnpm build`. Before the commands below,
put this temporary, build-only shim on `PATH` (this is the exact approach used
for the verified local package):

```powershell
$pnpmShimRoot = Join-Path $env:TEMP "sudhir-codex-pnpm-shim"
New-Item -ItemType Directory -Force -Path $pnpmShimRoot | Out-Null
Set-Content -LiteralPath (Join-Path $pnpmShimRoot "pnpm.cmd") `
  -Encoding Ascii -NoNewline -Value "@echo off`r`ncorepack.cmd pnpm %*`r`n"
$env:PATH = "$pnpmShimRoot;$env:PATH"
```

```powershell
corepack pnpm install --frozen-lockfile
corepack pnpm test
corepack pnpm typecheck
corepack pnpm build

Push-Location src-tauri
cargo fmt --check
cargo test --locked
cargo check --locked
Pop-Location

corepack pnpm tauri build

Remove-Item -LiteralPath $pnpmShimRoot -Recurse -Force
```

The final command emits the x64 NSIS installer under
`src-tauri\target\release\bundle\nsis\`. Building the installer does not
install or launch it.

### Local dev (debug window)

```bash
pnpm tauri dev
```

This starts Vite on port `1420` and opens the Tauri window against
`http://localhost:1420`.

## Live contract checks (against real sudhir-codex)

The scratch script `work/live-contract.mjs` (gitignored) launches the installed
`sudhir-codex app-server --stdio`, runs the fixed `initialize` identity plus
read-only `thread/list`, `model/list`, `account/rateLimits/read`, and
`account/usage/read`, and prints only counts and model identifiers — never
prompts, transcripts, tokens, or credentials. **[verified 2026-08-05: OK]**

```bash
node work/live-contract.mjs      # read-only: initialize + thread/model/usage reads
node work/live-turn.mjs          # one short turn on the owner's default model (live acceptance)
```

The macOS launch resolves `$HOME/.local/bin/sudhir-codex`; the single
environment override for development tests is
`SUDHIR_CODEX_TAURI_APP_SERVER` (used by the Rust unit tests).

## Updating the minimal app-server wire types

After a `sudhir-codex` backend upgrade, re-verify the wire contract with the
read-only live check above, then reconcile `src/codex-types.ts` against the
installed protocol source (`codex-rs/app-server-protocol/src`): method names,
payload field names (camelCase), and the internally tagged `ThreadItem` enum
(`{ type: "...", ... }`). Nested fields may use their own tagged unions (for
example, `FileUpdateChange.kind`). Keep the Node-tested modules on erasable
TypeScript only (no enums, namespaces, constructor parameter properties),
explicit `.ts` import extensions, and no `.tsx` imports.

## Icons

The checked-in cross-platform icon set is generated from the supplied Parallel
Handoff logo:

```bash
pnpm tauri icon documents/logo/parallel-handoff-1024x1024.png
```

`pnpm tauri icon` rewrites `src-tauri/icons/` for macOS, Windows, iOS, and
Android. The desktop bundle configuration consumes `icon.icns`, `icon.ico`,
and the PNG sizes, so the same source logo is used on macOS and Windows.

## Local macOS signing and installation

The sanctioned credential source is AWS Secrets Manager secret
`alamelu/pi-codesign` in `ap-south-1`. The signing script requires
`identity_hash`, `keychain_path`, and `keychain_password`, unlocks the explicit
keychain, sets the code-signing partition list, signs with no timestamp, and
runs strict deep verification. Do not substitute the friendly certificate
name or inspect the signing keychain interactively.

See `DEPLOY-MACOS.md` for installation, launch, smoke testing, and rollback.

## GitHub Actions

The workflow `.github/workflows/native-build.yml` is manually dispatched with
a `platform` choice (`all`, `macos`, `windows`). macOS produces an Apple
Silicon `.app` (ad-hoc signed, verified, ZIPped); Windows produces an x64 NSIS
installer. The Windows hosted job does **not** run a real WSL integration
test — that check runs on the owner's Windows laptop per
`DEPLOY-WINDOWS.md`.

For UI and icon changes, stop after the signed local macOS build and owner
test. Do not dispatch or modify GitHub Actions until the owner explicitly
approves the locally tested result; only then regenerate both macOS and
Windows artifacts.

## Rebuild checklist (for a future agent)

1. Verify Node `24.16.0`, pnpm `11.5.2`, stable Rust with the right target.
2. Check the `macos-15` / `windows-2022` runner labels against official
   deprecation notices; update if retired.
3. `pnpm install --frozen-lockfile`.
4. `pnpm typecheck && pnpm build && pnpm test`.
5. `cd src-tauri && cargo fmt && cargo test && cargo build && cd ..`.
6. Run `node work/live-contract.mjs` (read-only) against the installed
   `sudhir-codex`.
7. On macOS, run `pnpm tauri:package:mac`; strictly verify the signed `.app`
   and record the signed ZIP checksum. On Windows, use the normal Tauri build.
8. Cross-check every command in `DEPLOY-MACOS.md` / `DEPLOY-WINDOWS.md` from a
   clean clone before claiming a release candidate.

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

macOS artifacts land in `src-tauri/target/release/bundle/`; the app is
ad-hoc/linker signed (`codesign -dv` shows `adhoc`).

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

Regenerate the icon set from the source scratch image:

```bash
node work/gen-icon.mjs      # writes work/icon.png (1024x1024)
pnpm tauri icon work/icon.png
```

`pnpm tauri icon` rewrites `src-tauri/icons/` for every platform.

## GitHub Actions

The workflow `.github/workflows/native-build.yml` is manually dispatched with
a `platform` choice (`all`, `macos`, `windows`). macOS produces an Apple
Silicon `.app` (ad-hoc signed, verified, ZIPped); Windows produces an x64 NSIS
installer. The Windows hosted job does **not** run a real WSL integration
test — that check runs on the owner's Windows laptop per
`DEPLOY-WINDOWS.md`.

## Rebuild checklist (for a future agent)

1. Verify Node `24.16.0`, pnpm `11.5.2`, stable Rust with the right target.
2. Check the `macos-15` / `windows-2022` runner labels against official
   deprecation notices; update if retired.
3. `pnpm install --frozen-lockfile`.
4. `pnpm typecheck && pnpm build && pnpm test`.
5. `cd src-tauri && cargo fmt && cargo test && cargo build && cd ..`.
6. Run `node work/live-contract.mjs` (read-only) against the installed
   `sudhir-codex`.
7. `pnpm tauri build`; record artifact paths and checksums.
8. Cross-check every command in `DEPLOY-MACOS.md` / `DEPLOY-WINDOWS.md` from a
   clean clone before claiming a release candidate.

# Sudhir-Codex Tauri — architecture

## Terminology

- `sudhir-codex` is the build variant of Codex that supplies the CLI,
  app-server, state, gateway integration, and model execution.
- Sudhir-Codex is the existing frontend application that this Tauri app
  replaces.
- Sudhir-Codex Tauri is this repository: a lightweight personal desktop
  frontend for the installed `sudhir-codex` backend.

`sudhir-codex` remains the source of truth for threads, credentials, provider
and model configuration, model visibility, tools, MCP servers, skills, agents,
sandboxing, and model execution. This app only renders and drives it.

## The app-server / gateway boundary and why stdio

The Tauri host launches the supported `sudhir-codex` app-server interface and
forwards newline-delimited JSON-RPC messages between the Rust host and the
webview. The frontend never talks directly to the private model gateway at
port 32179. Launching via `sudhir-codex` preserves the backend's private
state, gateway startup, token injection, and security policy.

- stdout is expected to be protocol JSONL; a non-JSON stdout line (for
  example a WSL login profile greeting) is routed to a bounded
  recent-diagnostic buffer and never reaches the RPC layer.
- stderr is retained in the same bounded buffer for an actionable
  startup/runtime error. It is not a logging subsystem.
- Closing the app closes app-server stdin and terminates only that child if it
  does not exit. It never stops the persistent `sudhir-codex` gateway and
  never terminates the WSL distribution.

## Process diagrams

### macOS

```text
React/TypeScript UI
        |
        | Tauri commands and events carrying JSON values
        v
small Rust process bridge
        |
        +-- ~/.local/bin/sudhir-codex app-server --stdio
        |
        v
existing sudhir-codex state and private gateway
```

The macOS launcher resolves `$HOME/.local/bin/sudhir-codex` (a `/bin/sh` shim
that execs the installed Python venv and core binary by absolute path, so no
GUI `PATH` plumbing is needed). The single environment override for
development tests is `SUDHIR_CODEX_TAURI_APP_SERVER`.

### Windows / WSL

```text
React/TypeScript UI
        |
        | Tauri commands and events carrying JSON values
        v
small Rust process bridge
        |
        +-- wsl.exe --exec bash -lic 'exec sudhir-codex app-server --stdio'
        |      (CREATE_NO_WINDOW, WSL_UTF8=1)
        v
default WSL distribution -> existing sudhir-codex state and private gateway
```

The Windows child is spawned with the `CREATE_NO_WINDOW` creation flag so no
console window appears alongside the Tauri window, and with `WSL_UTF8=1` so
`wsl.exe`'s own failure text is readable UTF-8 in the diagnostic banner.

Project paths: a native picker returns a Windows path. A genuine Windows
drive path is converted with `wsl.exe --exec wslpath -a -u`. A path already in
`\\wsl.localhost\<distro>\...` or `\\wsl$\<distro>\...` form is converted
directly by dropping the host and distribution components and normalizing
separators; it is never sent to `wslpath`. The project record stores both the
display/picker path and the Linux path sent to app-server.

## The fixed initialize identity

`initialize` sends exactly:

```json
{
  "name": "codex_cli_rs",
  "title": "Sudhir-Codex Tauri",
  "version": "0.1.0"
}
```

`clientInfo.name` becomes the process-global originator and is folded into the
outbound User-Agent, and the Sudhir-Codex gateway forwards `originator` and
`user-agent` to the ChatGPT Codex backend. The backend routes model slugs by
originator cohort, and `codex_cli_rs` is a first-party originator. **Changing
`clientInfo.name` to any other value requires the owner's approval and a
successful live turn on the owner's default ChatGPT model.** `title` supplies
the human-readable frontend name only; `version` must stay equal to the
application version in `package.json` and `src-tauri/tauri.conf.json`.

## Source of truth and local persistence

Thread transcripts are never copied into frontend storage; they remain under
the existing `sudhir-codex` state and are loaded with app-server APIs. The
frontend persists only one small versioned JSON value in webview local
storage: favorite projects (display name, picker path, backend/WSL path) and
the last selected project. Removing a project removes only that favorite
entry — never files or threads.

## Protocol flow

- Rust owns the app-server child: startup, stdin/stdout/stderr, and shutdown.
- TypeScript owns JSON-RPC request IDs, response correlation,
  initialization, notifications, and server-request responses.
- The TypeScript RPC module takes a small send/subscribe transport parameter:
  `app.tsx` supplies the Tauri command/event binding; the integration test
  supplies a real child-process pipe binding.
- Known notifications update a per-thread reducer keyed by `threadId`, so a
  background thread keeps streaming while another is selected.
- Known server requests (command/file/permission approval,
  `item/tool/requestUserInput`) render inline cards. Any server request the
  client does not implement receives an immediate JSON-RPC error response and
  a plain inline unsupported-request card; it is never silently ignored.
- Unknown item notification types are preserved and rendered through a
  compact fallback card so a new harmless item does not crash the transcript.
- The client does not opt into experimental app-server capabilities and does
  not register dynamic tools or attestation support.

## Scoped UI state and process shutdown

The UI has three compact areas: a project/thread sidebar, the transcript and
composer, and header controls (model picker and a Usage panel). The composer
is disabled only while its selected thread has an active turn. If app-server
startup fails or the child exits unexpectedly, the window shows the retained
bounded diagnostic plainly, even before any project or thread is selected.
Closing the window closes app-server stdin and waits briefly, then terminates
only that child.

## Explicit non-goals

No provider login/configuration, no model-visibility editing, no general
settings screen, no backend bundling, no direct gateway HTTP access, no
automatic installation or upgrading of `sudhir-codex`/WSL/WebView2, no
updater, no background service, no tray, no notifications, no telemetry, no
crash reporting, no cloud sync, no account management, no repository/file
browser, no terminal, no git staging UI, no worktrees, no MCP app widgets, no
audio/image attachments, no provider billing dashboards, no notarization or
Windows code-signing, no GitHub Releases publishing, no Intel macOS, no
Windows ARM, no Linux desktop, and no non-default WSL distribution selection.
Anything outside the objective requires owner approval before it enters the
implementation.

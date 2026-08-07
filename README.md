# Sudhir-Codex Tauri

A lightweight personal desktop frontend for the installed
[`sudhir-codex`](https://github.com/upaayan/sudhir-codex) backend. It replaces
the existing Sudhir-Codex frontend with a native Tauri 2 app for Apple Silicon
macOS and x64 Windows (Windows talks to `sudhir-codex` inside the default WSL
distribution).

What it provides: favorite projects, stored chat-thread listing/opening/
continuation and new-thread creation, per-next-turn model selection from the
`sudhir-codex` catalog, backend-supported reasoning Effort for every model,
GPT-only speed/service-tier selection,
ChatGPT/account and per-thread usage display, automatic thread naming,
active-turn conversation steering, initially collapsed per-turn Activity,
an auto-growing composer, native zoom shortcuts, image/document picker and drag/drop
attachments, generated-image and MCP-image display, System/Light/Dark themes,
and the inline approvals, `request_user_input`, and browser-origin elicitation
responses a chat turn needs.

`sudhir-codex` remains the source of truth for threads, credentials,
configuration, models, tools, MCP servers, skills, agents, sandboxing, and
model execution. This app never talks to the private gateway directly.

## Prerequisites

- macOS Apple Silicon with `sudhir-codex` installed, or Windows x64 with WSL
  and `sudhir-codex` installed in the default distribution.
- For building from source: Node 24.16.0, pnpm 11.5.2, stable Rust (see
  [BUILD-AND-REBUILD.md](documents/BUILD-AND-REBUILD.md)).

## Build and deploy

- [Architecture](documents/ARCHITECTURE.md)
- [Build and rebuild](documents/BUILD-AND-REBUILD.md)
- [Deploy — macOS](documents/DEPLOY-MACOS.md)
- [Deploy — Windows](documents/DEPLOY-WINDOWS.md)

## Status

Initial implementation and baseline macOS/Windows CI builds are complete, and
the 2026-08-07 UI/UX overhaul (config-seeded effort/speed, compact activity
rows, one-box composer) has shipped through owner-authorized GitHub Actions
builds — the `native-build` workflow is now the standard build path for both
platforms. The current Mac candidate and the GHA-built Windows NSIS candidate
are installed for owner testing (Windows via the staged S3-relay procedure in
DEPLOY-WINDOWS.md); the installer and installed executable are intentionally
unsigned. Browser control is intentionally unsupported on Windows, and the
Windows app has no dependency on the Windows Codex or ChatGPT desktop apps.
See the local debate-loop records under `documents/plan-audit-implementation/`
(gitignored).

# Sudhir-Codex Tauri

Lightweight personal desktop frontend for an existing `sudhir-codex`
installation. It is intended to replace the existing Sudhir-Codex frontend app.

This repository is currently in the planning stage. Implementation must not
begin until the owner approves the local debate-loop plan. Plan, audit, and
implementation records remain local under
`documents/plan-audit-implementation/` and are intentionally excluded from Git.

The intended application will:

- run natively on Apple Silicon macOS and x64 Windows;
- connect to `sudhir-codex` directly on macOS and through WSL on Windows;
- provide projects, chat threads, model selection, and usage views; and
- leave model/provider configuration, credentials, and agent execution inside
  `sudhir-codex`.

Project documentation is indexed in [`documents/README.md`](documents/README.md).

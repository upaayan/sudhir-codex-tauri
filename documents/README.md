# Documentation index

## Local planning and audit history

The complete debate-loop record is kept in
`plan-audit-implementation/` in the owner's working checkout and is
intentionally excluded from Git and the public repository. It contains:

- `sudhir_codex_tauri_plan.md`;
- `sudhir_codex_tauri_audit.md`; and
- `sudhir_codex_tauri_implementation.md`, created during implementation after
  owner approval.

## Documents created during implementation

- `ARCHITECTURE.md` — runtime boundary, process lifecycle, protocol flow, and
  intentionally excluded features
- `BUILD-AND-REBUILD.md` — clean-clone setup, pinned tools, local builds, tests,
  protocol maintenance, and GitHub Actions rebuild instructions
- `DEPLOY-MACOS.md` — macOS artifact verification, installation, smoke test,
  rollback, and removal
- `DEPLOY-WINDOWS.md` — Windows/WSL prerequisites, artifact verification,
  installation, smoke test, rollback, and removal

These four public files are implementation deliverables. The local planning
documents define their required content before any product code is written.

# Documents

- [ARCHITECTURE.md](ARCHITECTURE.md) — terminology, app-server/gateway
  boundary, process diagrams, the fixed initialize identity, persistence
  rules, protocol flow, and non-goals.
- [BUILD-AND-REBUILD.md](BUILD-AND-REBUILD.md) — pinned versions, clean-clone
  build/test/package commands, live-contract check, icon regeneration, and
  the rebuild checklist.
- [DEPLOY-MACOS.md](DEPLOY-MACOS.md) — preflight, artifact inspection,
  installation, Gatekeeper, smoke test, rollback, removal.
- [DEPLOY-WINDOWS.md](DEPLOY-WINDOWS.md) — exact staged S3-relay update,
  Windows signing rule, Tauri NSIS hash trap, WSL preflight, project-path
  expectations, the intentional browser-control boundary, launch/relaunch
  smoke gates, rollback, and removal.

The local debate-loop records (plan, audit, implementation) live under
`documents/plan-audit-implementation/`, which is gitignored and never pushed.

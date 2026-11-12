# ADR-0028: Dependency policy

- Status: Accepted; simplified November 12, 2026 by owner workflow direction.
- Context: all packages share one pnpm lockfile; concurrent installs and unreviewed lifecycle scripts cause real risk.

Use one designated devops/lockfile writer and install project-local packages when technically needed. No between-wave
waiting, per-package ADR, owner commit or new formal report is required. Coordinate changes with affected consumers.
The initial install already exists; rerun only for a fresh checkout or actual manifest/lockfile/dependency need.
Pin compatible versions, review licenses/transitive changes, keep manifest and lockfile consistent, and verify affected builds/tests.
Review third-party lifecycle scripts before allowing them; ask Cee only when trust/permission is genuinely unresolved.
No machine-wide installs or paid services without owner authorization. Major toolchain/architecture changes still get a concise ADR.
Existing Dependabot grouping/engine constraints and SHA-pinned Actions remain; Cee chooses git/merge timing after validation.

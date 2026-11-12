# ADR-0017: Asset storage - no Git LFS by default

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, technical-artist, devops-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Asset storage row), section 5 (Git LFS)

## Context

The game needs baked terrain/Earth/star textures, glTF models, audio and fonts, and the repo may be public. GitHub Free gives 10 GiB/month of LFS bandwidth (metered); **GitHub Actions downloads and every Vercel build that pulls LFS objects count against it**, so ~300 MB of LFS content allows only about 30 builds a month before developer clones. LFS also does not solve license redistribution in a public repo. Vercel pulls LFS only if enabled in project settings and has reported build failures when LFS objects were never pushed.

## Options considered

1. **No LFS; commit only compressed game-ready derivatives within a budget; raw/source art outside git with a manifest.** Pro: no bandwidth cap; simple clones and builds. Con: repo grows with each asset revision; need strict budgets.
2. **Git LFS for all binary assets.** Pro: keeps history small. Con: metered bandwidth shared with CI and Vercel; failure modes on Vercel.
3. **External object storage/CDN (R2, S3) with a manifest.** Pro: no repo bloat. Con: another service, likely needs a card; not in the $0 tier set.
4. **Generate everything at build time.** Pro: tiny repo. Con: slow Vercel builds (45-min limit), dependence on third-party downloads.
5. **Git submodule for assets.** Pro: separate history. Con: Vercel/Render checkout complexity.

## Decision

Option 1. Rules:
- **No Git LFS by default** (revisit only through a new ADR).
- Commit **only final derivatives** produced by the asset pipeline (ADR-0013), under byte budgets enforced in CI; baked terrain data is committed as derivatives plus a **manifest with checksums**, `assets/terrain/raw/` is git-ignored.
- Large source art, raw LOLA data and Mixamo prototypes live **outside git** (private storage); the manifest records origin, license and checksum; each committed asset has a row in `docs/ASSET_LICENSES.md`.
- Avoid regenerating heavy intermediates (mip chains, LOD pyramids, atlases) on Vercel builds; generate offline once.
- Large single files over a size threshold (set by devops, initially ~10 MB) require lead approval.
- CC BY-SA derived star data stays a separate file with its own license notice.

## Consequences

**Positive**
- Free CI/Vercel builds are never blocked by LFS bandwidth; contributors can clone without LFS setup.

**Negative / risks**
- **Research disagreement:** [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) section 10 suggested Git LFS for runtime assets (while warning about the bandwidth). tech-stack.md rejected LFS by default because of the shared 10 GiB bandwidth; this ADR follows tech-stack.
- Binary churn grows `.git` size; periodic history cleanup may be needed.
- Source art outside git can be lost; needs an owner-held backup.

## Revisit trigger

- The repo exceeds ~1 GB, or committed assets exceed ~300 MB.
- GitHub changes LFS pricing or Vercel changes LFS handling in a way that removes the bandwidth risk.

## Evidence

- [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) (Executive summary 14; section 10 Git LFS and Vercel)
- [platform-limits.md](../research/tech/platform-limits.md) (A5 Git LFS, A2 Vercel build limits)
- [browser-feasibility.md](../research/browser-feasibility.md) (download budgets)

# assets/models

**Owner role:** `technical-artist`

## What goes here

Small glTF 2.0 source models (props, rovers, robots, tools, character meshes) before pipeline compression. Big source art (high-poly, Blender, Substance) stays outside git.

## Rules

- **Budget first.** Commit only small, compressed, game-ready files (no Git LFS, ADR-0017). Individual files above 10 MB fail CI
  (`.github/workflows/asset-validation.yml`); large or raw source art lives outside git with a manifest.
- **License ledger.** Every file or file group needs a row in [`docs/ASSET_LICENSES.md`](../../docs/ASSET_LICENSES.md) in the same
  commit (source URL, author, SPDX license, attribution, modified?, commit-raw-OK?). CI checks that new asset paths appear in the ledger.
- **Allowed licenses:** CC0, public domain, CC-BY (with attribution), OFL fonts, MIT/ISC/Apache icons, original or commissioned work.
  **Forbidden:** NC/ND licenses, unclear terms, assets from reference games, Gaia-derived data.
- **Never commit raw files** from Mixamo, Sonniss, Pixabay or Quaternius (their terms forbid redistributing raw files). Commit only transformed
  derivatives when the ledger row says "Commit raw OK? no" and the license permits redistribution of modified works; otherwise keep the
  file out of git and document how to fetch it.
- Web-ready output (meshopt glTF, KTX2, Opus/WebM) is produced by `tools/asset-pipeline` into `apps/client/public/assets/` with
  **content-hashed names** (`name.<8+ hex>.ext`) plus a short-TTL `manifest.json` that maps logical names to hashed files (the only unhashed file allowed there). `.github/workflows/asset-validation.yml` fails the build on any shipped file without a hash; files under `assets/` keep their source names.

## Notes

- Target format: glTF 2.0 / GLB, optimized with glTF-Transform + meshopt. `.blend` files are not committed (CI forbids them outside `assets/source/`); `.fbx` is never shipped in `public/`.

Placeholder: this folder is empty until the first asset lands (`.gitkeep`).

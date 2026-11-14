# M0-W0-T06 technical-artist report

Task M0-W0-T06 / status: in-review / 2026-11-12 / technical-artist (Fable 5.2). No installs, no git mutations.

Done: two original assets go from a source script through headless Blender 4.5.10, glTF-Transform (meshopt), a content-hashed file and `manifest.json`, to a budget checker that passes them and fails an oversize fixture. 32 turntable images rendered.
Not done: KTX2 (no `ktx` CLI on this machine; textures stay PNG, reported as warnings). `assets:build` / `assets:check` in `package.json` are still T03's `echo` placeholders.

Next: T03 owner sets `"assets:build": "tsx src/build.ts"` and `"assets:check": "tsx src/check.ts"`. CI should run `assets:check` only (build needs Blender). Cee installs KTX-Software if KTX2 is wanted in M0; the encode step is detection-only today.

## Evidence (Node 26.13.1, Windows 11, i7-8650U; outputs `rock_boulder_a.936c0346f2bb.glb`, `boreal_hab_module.a9201d780d3a.glb`)
| Check | Result |
|---|---|
| `tsx src/build.ts` | exit 0; build log in `assets/models/.cache/build-log.source.txt` (git-ignored) |
| `tsx src/check.ts` (proof) | PASS, 0 errors, 7 `TEXTURE_NOT_KTX2` warnings |
| `tsx src/budgets/fixtures.ts <dir>` then `check.ts --dir <dir>` | FAIL exit 1: LOD chain, 5000 > 3000 triangles, 2048 > 1024 px, 2 > 1 materials |
| `pnpm typecheck`, `lint`, `test` in the package | pass; 7/7 tests (includes the committed proof assets) |
| `gltf-transform validate` | no errors or warnings on both files |
| Rock rebuilt twice in Blender | raw GLB byte-identical (same SHA-256) |
| `pnpm verify` (repo-wide) | NOT RUN |

## Art-direction 13.3 bar
| Check | Rock (1.63 x 1.22 x 1.17 m) | Outpost module (7.1 x 4.2 x 4.7 m) |
|---|---|---|
| Triangles LOD0/1/2 | 2400 / 300 / 60 (budget 3000 / 300 / 60) | 27,736 / 11,572 / 2,584 (budget 20-40k LOD0) |
| Textures, materials | 3 x 1024 px (base, normal, ORM baked from an 82k-triangle high-poly), 1 material | trim sheet v0, 4 x 1024 px, 1 material, vertex AO in `COLOR_0` |
| File size | 1.87 MB | 1.42 MB |
| Curvature | n/a | 64 segments on shell and ribs, 24 on pads and rings. Rails and pipes are 10-sided |
| Texel density | median 321 px/m (no bar for rocks) | median 358 px/m; **miss:** 94.9 % of area is at or above 256 px/m, 5th percentile 236 |
| Palette (turntable pixels) | n/a | ivory 60.5 %, teal 25.1 %, yellow 1.5 % (max 3.2 % in one view): inside 5.1 |
| Bevels at 3 m | n/a | **not verified:** real 2-segment bevels plus trim normals exist, but the camera sits about 12 m away |
| Turntable by the harness | **miss:** method preview only | **miss:** method preview only |
| KTX2 | **miss** (PNG) | **miss** (PNG) |

Turntables: 8 views x noon + night-near per asset, 1920x1080 PNG, with `turntable.json` sidecar. They are a **method preview**, rendered with Blender EEVEE Next from the raw pre-meshopt GLB, not an in-engine capture (VT-M1-35 stays open until the M0-W1 harness).

## Throughput
| Step | Rock | Module |
|---|---|---|
| Blender source script | 72-79 s (bake is 57 s; 35 s on an idle machine) | 28-34 s |
| glTF-Transform + hash + manifest | 0.3 s | 0.5-0.9 s |
| Turntable, 16 frames | 577 s (first frame 122 s, then about 30 s each) | about 520 s active; wall time was 3078 s because the laptop suspended mid-run |

- By hand: nothing for a rebuild. A human reviews the turntables and installs `ktx`.
- Cycles on this laptop took 5.5 min per frame (no GPU device), so the turntable defaults to EEVEE; `--engine cycles` remains.
- Authoring: both assets plus the shared libraries (rock generator, kitbash v0, trim sheet v0) were written in one session; the rock needed one shape iteration, the module ran first time. New rock variants are a seed change; a new hard-surface module is a script of roughly 150 lines on the existing kit.
- Verdict for ADR-0027: the scripted Blender path works for rocks and modular hard-surface. It says nothing yet about the custodian (organic shape, rig, skinning), which is the real M1-W4-T07 risk.

## For the lead
- Outputs are in `assets/models/proof/`, not `apps/client/public/assets/` (not owned by this task); `--out` redirects.
- Per-asset byte caps in `budgets.ts` (rock 3 MiB, module 4 MiB) and module LOD1/LOD2 caps are my provisional numbers; the docs define none.
- `COLOR_0` vertex AO multiplies base colour in three's loader; rendering-engineer may prefer routing it to AO.
- The trim sheet is embedded in the module GLB; a kit needs it as one shared external file.
- The turntable folder is 38 MB of PNG. Cee decides how much of it to commit.
- Both assets are tagged `placeholder: true`. No signage, decals or dust patina yet.

Files: `tools/asset-pipeline/src/**`, `assets/models/{rocks,outpost,proof}/**`, `assets/models/README.md`, `docs/ASSET_LICENSES.md` (3 rows, `LicenseRef-Original`, reviewer pending), `docs/visual-reviews/M0/asset-proof/**`.
Blockers: none. Requests: T03 script lines above; `ktx` CLI (Cee).
Commit suggestion: `feat(asset-pipeline): prove Blender-to-hashed-glTF path on a rock and an outpost module`

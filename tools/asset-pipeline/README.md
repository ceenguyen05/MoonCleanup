# @moon-cleanup/asset-pipeline

**Path:** `tools/asset-pipeline` - **Owner role:** `technical-artist`

## Purpose

Turns source art in `assets/` into game-ready web assets in `apps/client/public/assets/` (ADR-0013, ADR-0017): glTF 2.0 with
**meshopt** compression and **KTX2** textures (UASTC for normals/hero, ETC1S for bulk) through glTF-Transform 4.5.1, Opus/WebM
(+ AAC fallback) audio, and a **budget checker** that fails on oversize files (mirrors the 10 MB per-file CI rule in
`.github/workflows/asset-validation.yml`) and per-tier totals. Only compressed derivatives are committed; raw/source art stays outside
git with a manifest.

## What Fable will build here

`src/gltf/` (optimize/compress scripts), `src/textures/` (KTX2 encode orchestration), `src/budgets/` (budget definitions + checker),
`src/build.ts` and `src/check.ts` entries. Output file names must be **content-hashed** (`name.<8+ hex>.ext`; they are served `immutable` for one year by
`vercel.json`) and every build writes a short-TTL **`manifest.json`** mapping logical names to the hashed files (it is the only unhashed file allowed in `apps/client/public/assets/`). `asset-validation.yml` fails on any shipped file without a hash, and the budget checker reads the manifest.

## Original 3D art (decision D5 / OPEN_QUESTIONS Q23)

The technical-artist has no DCC tool. Hard-surface assets (tools, outpost hardware, vehicles) and the modular custodian suit are produced here by **scripted, licence-clean procedural modelling** (bevelled primitives, baked AO, UV/colour-slot masks) feeding glTF-Transform and KTX2. Blockout assets (M1-W3-T07) meet art-direction §13.4 (final proportions, final shader, player-colour slots) until the production tasks (M1-W4-T07 custodian + tools, M1-W5-T03 / M1-W6-T05 outpost kit, M1-W7-T02 vehicles) land. Base meshes from outside need Cee's approval of licence and budget. **Headless Blender is the preferred source when Cee has installed it** (Q23 default: Cee installs Blender LTS when the M0 asset-pipeline proof starts); otherwise the Node-only path is used. The path is ADR-0027 (3D art) with ADR-0028 (dependency policy); the whole chain is **proven in M0-W0-T06 on one rock and one outpost module** (art-direction §13.5), including a budget-checked, content-hashed output and a 1080p turntable (VT-M1-35).

## Key contracts consumed

`@moon-cleanup` contracts are not imported here (asset tooling is standalone). It reads the budgets from
`docs/design/` once written, and writes a ledger reminder: every asset needs a row in `docs/ASSET_LICENSES.md`.

## External tools (not npm packages; install on the artist machine, never globally by agents)

KTX-Software `ktx` CLI v4.4.2 (KTX2 encoding is delegated to it by gltf-transform - re-verify), optionally basisu v2.50 and FFmpeg
for audio. Their versions are recorded in `docs/research/tech/tooling-and-libraries.md`; verify before pinning in docs.

## Commands

```
pnpm --filter @moon-cleanup/asset-pipeline assets:build   # placeholder
pnpm --filter @moon-cleanup/asset-pipeline assets:check   # placeholder
```

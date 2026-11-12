# @moon-cleanup/terrain-bake

**Path:** `tools/terrain-bake` - **Owner role:** `terrain-dust-engineer`

## Purpose

Bakes NASA LRO LOLA gridded elevation (LDEM_16 / LDEM_64 from the PDS Geosciences Node or the NASA SVS CGI Moon Kit) into the
resident **height cube map** used by CDLOD terrain (ADR-0008), with vertical exaggeration, and writes a manifest with source
URLs, credits and **checksums**. Use LOLA-only products (not SLDEM2015: it contains JAXA data with unclear terms).

## What Fable will build here

`src/lola/` (reader for the downloaded rasters), `src/cubemap/` (reproject equirectangular to cube faces, mip/tiling),
`src/manifest/` (checksummed manifest), and `src/bake.ts`. Baked derivatives go to `assets/terrain/` (committed, budgeted); raw downloads
go to `assets/terrain/raw/` which is **git-ignored** and never committed. Outputs are **content-hashed** (`height-cube-1024.<hash>.bin`; the hash is also recorded in `manifest.json` with the source URLs and SHA-256s) because the client serves them `immutable` for one year; the manifest itself (short TTL) is the only unhashed file shipped. `asset-validation.yml` enforces the naming. The bake also writes the far-occluder **horizon map** (6 x 512^2, 8 azimuths, about 12 MiB; occluders under 20 m ignored; rendering-pipeline §5.2, world-and-dust §3.2) and its hash into the manifest.

## Key contracts consumed

`@moon-cleanup/shared` (units, save/format where relevant) and `@moon-cleanup/world` (height sampling must agree with the
analytic height function and cube-map layout).

## Credits

NASA SVS / LOLA science team credit lines are in `docs/ASSET_LICENSES.md`; every baked file needs a ledger row.

## Commands

```
pnpm --filter @moon-cleanup/terrain-bake bake   # placeholder -> tsx src/bake.ts
```

# @moon-cleanup/terrain-bake

**Path:** `tools/terrain-bake` - **Owner role:** `terrain-dust-engineer`

## Purpose

Bakes NASA LRO LOLA gridded elevation (LDEM_16 from the PDS Geosciences Node; LDEM_64 for the release bake) into the
resident **height cube map** used by CDLOD terrain (ADR-0008), with two-band vertical exaggeration, outpost pad edits,
the far-occluder **horizon map**, and a manifest with source URLs, credits and **checksums**. LOLA-only products (not
SLDEM2015: it contains JAXA data with unclear terms).

## Status (M0-W2-T05 spike)

Steps 1-7, 8b and 9 of world-and-dust-simulation 3.2 run on LDEM_16. Step 8 (per-plot dust class, grid golden hash) waits
for the M1 plot grid and is recorded as `grid.status = deferred` in the manifest. Numbers: `docs/agent-reports/M0-W2-T05-terrain-dust-engineer.md`.

## Run it

```
# 1. fetch (git-ignored folder; the bake verifies size and SHA-256 against src/lola/sources.ts)
mkdir -p assets/terrain/raw && cd assets/terrain/raw
B=https://pds-geosciences.wustl.edu/lro/lro-l-lola-3-rdr-v1/lrolol_1xxx/data/lola_gdr/cylindrical/img
curl -fsSL -O $B/ldem_16.lbl && curl -fsSL -O $B/ldem_16.img

# 2. bake (about 2 minutes, peak RSS about 0.4 GB)
pnpm --filter @moon-cleanup/terrain-bake bake            # add -- --previews for hillshade PNGs in the report folder
pnpm --filter @moon-cleanup/terrain-bake bake:sweep 3 2.5 2   # E_high step-down slope sweep
```

Outputs land in `assets/terrain/`: `height-cube-1024.<hash>.bin`, `height-cube-256.<hash>.bin`, `horizon-map.<hash>.bin`,
`manifest.json` (the only unhashed file) and `fixtures/` (64^2 test cube, golden samples). Old hashed binaries are removed on
each run. Timings and peak RAM go to the git-ignored `assets/terrain/cache/bake-stats.json`.

## Layout of the code

- `src/lola/` label parser, LDEM decoder, equirect sampler, pinned sources (URL, size, SHA-256).
- `src/cubemap/` mapping (layout v1), low-pass, reprojection/pads/relaxation/quantisation (`bake.ts`), reference sampler
  (`sample.ts`), horizon bake, slope/seam/accuracy/golden analysis, container codec (`codec.ts`).
- `src/manifest/` manifest + `bakeHash`. `src/pipeline.ts` orchestration. `src/png.ts` preview writer.

## Contracts proposed to others

See the T05 report: cube layout v1 and the CTMH/CTMW containers (consumed by `packages/world` M1-W1-T01 and the client
terrain loader), `bakeHash` for the save header. After a re-bake, copy the new `bakeHash` into `TERRAIN_BAKE_HASH`
(`packages/world/src/height/bake-hash.ts`, exported from `@moon-cleanup/world`); `src/bake-hash.test.ts` fails on drift and the bake CLI warns.

## Credits

NASA SVS / LOLA science team credit lines are in `docs/ASSET_LICENSES.md`; every baked file needs a ledger row.

# @moon-cleanup/world

**Path:** `packages/world` - **Owner role:** `terrain-dust-engineer` - **Layer:** world math (environment-agnostic)

## Purpose

The geometry and dust math shared by client and server: icosahedral hex plot grid (Goldberg GP(m,0), 10m^2+2 plots,
diamond (i,j) indexing, contract sizes Moonlet m=64 / Standard m=128), point-to-plot lookup, neighbors, analytic height
sampling, stroke rasterization into the 32x32x4-bit coarse ledger, and coverage / plot completion math.

## What Fable will build here

`src/grid/` (GP(m,0) construction, `PlotGrid` implementation), `src/height/` (analytic height function; the baked LOLA
cube map itself is produced by `tools/terrain-bake`), `src/dust/` (ledger + coverage), `src/stroke/` (rasterizer).
Barrel `src/index.ts`. Property tests for neighbor symmetry and plot counts.

## Key contracts consumed (from `@moon-cleanup/shared`)

`PlotGrid` interface and dust state enums (`world/plot-grid`, `world/dust`), stroke format (`world/stroke`), IDs & units,
save format (`save/format`, for the ledger layout).

## Rules

- No DOM, no Node APIs, no three.js, no Colyseus.
- Consumed by `packages/sim`, `apps/client` (terrain) and `apps/server` (world). Never imports `apps/*` / `tools/*`.

## Commands

```
pnpm --filter @moon-cleanup/world test
```

`lint` / `typecheck` are echo placeholders until sources land.

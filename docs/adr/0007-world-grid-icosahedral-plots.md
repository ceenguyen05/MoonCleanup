# ADR-0007: World grid - icosahedral hex plots (Goldberg GP(m,0))

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, terrain-dust-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (World grid row)

## Context

The game mechanic is cleaning discrete "plots" of a small spherical moon, with a completion threshold (<= 1% dust left) and a payout per plot. The reference game uses about 163,842 hexagonal sectors, which is exactly the dual of a level-7 icosphere (GP(128,0): 12 pentagons + 163,830 hexagons). The grid must give O(1) point-to-plot lookup (on server and client), a neighbor table, a stable tangent frame per plot, and a compact index for dust arrays and save blobs.

## Options considered

1. **Recursive-subdivision icosphere, plots at the vertices (dual Goldberg GP(m,0)), diamond (i,j) indexing + 2 poles.** Pro: 10m^2+2 plots; cell-area ratio about 1.30x (CV 8.5%); cell centers are mesh vertices so orbit view can color vertices directly. Con: 12 pentagons; areas not exactly equal.
2. **ISEA4H (DGGRID) equal-area hex grid.** Pro: exactly equal areas. Con: more complex lookup; no vertex/orbit shortcut.
3. **HEALPix.** Pro: equal-area, simple hierarchy. Con: 196,608 cells at Nside = 128 (does not match reference); quad (not hex) shape.
4. **Lat/long grid.** Pro: trivial. Con: polar singularity, wildly unequal cells.
5. **Cube-face square tiles.** Pro: aligns with CDLOD terrain. Con: square cells; not the hex identity of the game; corner distortion.

## Decision

Option 1. Plot count is **10m^2 + 2**; the contract sizes are **Moonlet m = 64** (40,962 plots) and **Standard m = 128** (163,842 plots). Indexing pairs the 20 icosahedron faces into 10 diamonds of m x m plots plus the two poles. Point-to-plot is a constant-step lookup, the neighbor table (e.g. 983,040 entries at m = 128) and a canonical tangent frame per plot are baked offline into one binary asset. The `PlotGrid` interface (`plotAt(dir)`, `neighbors(id)`, `center(id)`, `count`) is a contract in `shared/world/plot-grid.ts`; the implementation lives in `packages/world`. Payout is scaled by plot area (or flat per plot, a game-design toggle).

## Consequences

**Positive**
- Identical grid math on server, client and tools; orbit view colors the level-k icosphere directly; tiny index space for dust and saves.
- At R = 3 km a plot is ~690 m^2 (~28 m across): readable at ground level and gives a 1% threshold of ~6.9 m^2.

**Negative / risks**
- 12 pentagon plots need special neighbor handling.
- Plot grid (icosahedral diamonds) and terrain grid (spherified cube, ADR-0008) do not share a parametrization; dust tiles must map via the lookup.
- Plot area varies up to ~1.3x; economy must either normalize or accept it.

## Revisit trigger

- Exactly equal plot areas become a hard design requirement: move to ISEA.
- Terrain-to-plot mismatch causes visible seams or cost: spike the diamond-CDLOD variant (ADR-0008 T2).

## Evidence

- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (sections 1.1-1.5, Executive summary 1-4)
- [moon-sweepers-mechanics.md](../research/moon-sweepers-mechanics.md)
- [module-boundaries.md](../architecture/module-boundaries.md) (contracts table: Plot grid interface)

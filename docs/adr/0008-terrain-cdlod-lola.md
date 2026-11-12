# ADR-0008: Terrain - CDLOD on a spherified cube with LOLA height cube map

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, terrain-dust-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Terrain row)

## Context

The player walks on a whole small moon (a radius of a few km) and can fly or orbit above it. Near the player the surface needs 0.25-0.5 m vertex spacing so dust berms and footprints have geometry to displace; from orbit the whole sphere must draw cheaply. Three has no planetary terrain system. Real-world relief should come from NASA LOLA data (public domain from the PDS and the NASA SVS CGI Moon Kit), vertically exaggerated for gameplay. At a few-km radius, 32-bit float precision is sufficient without floating origin.

## Options considered

1. **CDLOD on a spherified cube (six quadtrees, instanced grid patches) + resident height cube map + procedural near-field detail.** Pro: smooth vertex morphing, no cracks; hardware cube sampling; 6 x 1024^2 16-bit = 12 MiB (~4.6 m/texel at R = 3 km). Con: terrain grid differs from the icosahedral plot grid.
2. **CDLOD on 10 icosahedral diamonds (T2 spike).** Pro: terrain, plots and dust tiles share one (d,i,j) space. Con: no seamless cube sampling; axis remaps at diamond edges.
3. **Geometry clipmaps / spherical clipmaps.** Pro: constant cost. Con: awkward on a sphere; not researched in depth.
4. **Pre-baked static mesh with discrete LOD chunks.** Pro: simplest. Con: memory, popping, and no near-field detail.
5. **SLDEM2015 (LOLA + Kaguya).** Pro: higher resolution. Con: includes JAXA data with unresolved terms.

## Decision

Option 1. Heights are baked offline by `tools/terrain-bake` from **LOLA-only LDEM_16 / LDEM_64** into a six-face height cube map (with checksum manifest); the baked derivative is committed, raw data is git-ignored (ADR-0017). Procedural detail is added near the camera. Normals are derived from height in shader. Leaf spacing near the player is 0.25-0.5 m. Characters use an **analytic height function** shared between client and server (ADR-0010), so terrain collision on the server costs no mesh. Rapier colliders (client-only, optional) are streamed in a 3 x 3 ring of 32-64 m tangent-plane chunks with the curvature drop baked in (4.3 cm at 16 m, 68 cm at 64 m for R = 3 km). NASA is credited ("NASA's Scientific Visualization Studio"); no NASA insignia is used. Gaia-derived and SLDEM2015 content are excluded until reviewed by a human.

## Consequences

**Positive**
- One resident 12 MiB height source drives rendering, character ground queries and bake tests; CDLOD morphing avoids popping.

**Negative / risks**
- Cube-grid terrain vs icosahedral plots: every dust lookup needs a per-vertex plot ID computation (ADR-0007, ADR-0009).
- The CDLOD implementation, cube-seam handling and morphing are custom code (no library).
- No WebGPU tessellation stage; patch density is by instanced grids only.
- LROC website images carry different terms than PDS products; LROC management moved in May 2026, so re-check before launch.

## Revisit trigger

- The terrain/plot parametrization mismatch causes seams or costs > 1 ms: build the T2 diamond-CDLOD spike.
- A height texel of ~4.6 m is too coarse for the gameplay surface: add a procedural/second-tier detail cube.
- Terrain exceeds the 4 ms (Tier B) budget.

## Evidence

- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (sections 2.1-2.7, 3; Executive summary 5-6)
- [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) (Executive summary 1-6: NASA/USGS/LROC/SLDEM terms)
- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (Rapier examples; community planet LOD)

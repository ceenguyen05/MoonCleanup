# Whole-Moon Terrain LOD and Dust/Cleaning Simulation: Technique Research

**Date:** 2026-11-11 · **Author:** research subagent P2i · **Scope:** sector-grid math, terrain LOD on a sphere, collision, how dust is stored, synced, priced and persisted, how it is rendered, and a prototype plan · **Constraint (project brief, 2026-11-11 update):** the authoritative Node.js server runs on Render's free tier (about 0.1 CPU and 512 MB RAM). Server-side dust bookkeeping therefore has to be scalar or analytic and very cheap, and fine masks live on the clients.

**Notation.** [n] is a numbered source in the Sources list (all accessed 2026-11-11). **[C]** means I computed the value for this report. I ran the computation once in Node.js v22 and saved nothing to the repo; the method is described where the value is used. **Assumption** marks a planning assumption that the prototypes in §8 must check. This document contains no code or shaders by design.

---

## Executive summary

1. **The math checks out.** An icosphere at subdivision level *n* has V = 10·4ⁿ + 2 vertices, F = 20·4ⁿ triangles and E = 30·4ⁿ edges [2][C]. Level 7 gives **163,842 vertices**, 327,680 triangles and 491,520 edges. Its dual is the Goldberg polyhedron GP(128,0), which has **163,842 cells: 12 pentagons and 163,830 hexagons** [3][C]. DGGRID's equal-area ISEA4H grid also has exactly 163,842 cells, at resolution 7 [4]. The reference game reportedly uses 163,842 "hexagonal sectors" and counts a sector as cleaned at ≤1% dust remaining [1].
2. **Cell areas vary, and how much depends on the construction.** I measured the spherical Voronoi cell areas of the level-7 grid myself [C]:
   - Recursive midpoint subdivision with normalisation: largest hexagon is 1.30× the smallest (coefficient of variation 8.5%).
   - One-shot subdivision projected gnomonically (straight out from the centre): 1.96× (CV 13.3%). This matches H3's published ratio of about 1.97 [5].
   - ISEA is equal-area by construction [4].
   - HEALPix is equal-area and has **196,608** cells at Nside = 128 [6][C].
3. **Indexing.** Pair the 20 icosahedron triangles into 10 diamonds. Each diamond holds 128 × 128 sectors, and the two poles are separate cells: 10·128² + 2 = 163,842 [C]. This is the same quad-plus-(i, j) idea as DGGRID's Q2DI address form [4][8][9]. A precomputed neighbour table has 983,040 entries [C]. Finding the cell that contains a point takes a fixed number of steps (O(1)), described in §1.4.
4. **Scale.** At a moon radius of 3 km, a sector is about **690 m²**, about **28 m** across, and sector centres are about 28 m apart. The 1% threshold is then about 6.9 m² of leftover dust [C][1].
5. **Terrain recommendation: CDLOD on a spherified cube.** CDLOD is a quadtree of regular grids that morph smoothly between detail levels [14][15]. Heights come in the vertex shader from a **height cube map that stays fully in memory**: 6 × 1024² 16-bit texels is 12 MiB and gives about 4.6 m per texel at R = 3 km. Procedural detail adds the near-field relief [C]. At a radius of a few km, 32-bit floats are accurate to well under a millimetre, so camera-relative matrices plus reversed-Z depth are enough. Double-precision emulation and a floating origin are not needed [18][19][C].
6. **Collision.** Characters use an **analytic height function that the client and server share**. Rapier runs only on clients, for vehicles and props:
   - World gravity is set to zero and each body gets a radial force [34].
   - Colliders near players are heightfield or triangle-mesh chunks, each rotated to sit on the local tangent plane [32][33].

   The 0.1-CPU server runs **no physics**.
7. **Dust recommendation.** Clients receive validated cleaning strokes and draw them on the GPU into per-sector tiles of 64²–128² texels, using a lookup table indexed by sector. A small high-resolution "detail ring" around the player handles footprints and trail edges. The **server stores only** one scalar per sector plus a tiny **coarse ledger** (32 × 32 × 4-bit = 512 B) for each partly cleaned sector. Server work grows with the number of strokes, and memory stays at a few MB, so it fits the free tier [C].
8. **Economy.** Collected dust is computed **on the server from the coarse ledger**. That is exact at about 1 m resolution and cannot count the same patch twice. Clients run the same ledger maths to predict the counter instantly. Reading results back from the GPU (`mapAsync`) is asynchronous, its delay varies by browser, and it is never authoritative [54][55][56].
9. **Visuals.**
   - Soft masks become crisp, natural edges when thresholded against high-frequency noise, combined with distance-field edges [57].
   - Raised "berms" along trail edges come from the mask, in the way Rise of the Tomb Raider rebuilds both dips and ridges at render time [45].
   - Dusty and clean surfaces get different glitter and specular response, following Journey [27][47].
   - From orbit, the 163,842 sector values are drawn directly as a per-vertex value on the level-7 icosphere, because sector centres *are* its vertices [C].
10. **Sync sizes [C].**
    - Full snapshot at 1 byte per sector: 160 KiB raw.
    - Compact form (2-bit state plus values for partly cleaned sectors only): about 40 KiB plus *k* bytes.
    - One sector update: about 4 B. One stroke: about 16 B.
    - Worst case, 16 players all cleaning by hand: about 2.4 KB/s of strokes per client.

    Turn off per-message `permessage-deflate`, because the `ws` library warns about memory fragmentation [58][59]. Compress snapshots once and cache them instead.
11. **Render free tier.** It spins down after 15 minutes without inbound traffic (WebSocket messages count as traffic) and takes about 1 minute to spin up. The filesystem is ephemeral, the allowance is 750 instance-hours per month, and Render says not to use free instances for production [13]. The server therefore has to **write state to MySQL in the background every 10–30 s and when it goes idle**.
12. **Prototype three candidates:**
    - **P1:** scalar dust plus procedural visuals (baseline).
    - **P2:** strokes plus a tile atlas plus the coarse ledger (**preferred**).
    - **P3:** clients paint tiles and merge them by taking the per-texel minimum.

    Compare them on GPU time per hardware tier, memory, bytes/s, server CPU when capped at 0.1 core, how crisp trail edges look, and whether cleaned areas read clearly from orbit.

---

## 1. Sector grid: verified math, cell areas, indexing, lookups

### 1.1 Counts (verified)

- The geodesic polyhedron {3,5+}b,c has **V = 10T + 2, F = 20T, E = 30T** with T = b² + bc + c². Geodesic polyhedra are the duals of Goldberg polyhedra. All vertices have six neighbours except 12, which have five [2].
- Subdividing each triangle into 4 children *n* times is the class-I case b = 2ⁿ, c = 0, so T = 4ⁿ [2][C].
- A Goldberg polyhedron has 10T + 2 faces: **12 pentagons and 10(T − 1) hexagons**. GP(m,0) has T = m² [3]. Level 7 corresponds to m = 128, so T = 16,384 and the cell count is 163,842, of which 163,830 are hexagons [3][C].
- The DGGRID manual's table for ISEA4H (aperture-4 hexagons on the Icosahedral Snyder Equal Area projection) lists **163,842 cells at resolution 7**. It also states that pentagons have 5/6 the area of a hexagon [4].

| Level *n* | Vertices = dual cells (10·4ⁿ+2) | Triangles (20·4ⁿ) | Edges (30·4ⁿ) | Hexagons (dual) |
|---|---|---|---|---|
| 5 | 10,242 | 20,480 | 30,720 | 10,230 |
| 6 | 40,962 | 81,920 | 122,880 | 40,950 |
| **7** | **163,842** | **327,680** | **491,520** | **163,830** |
| 8 | 655,362 | 1,310,720 | 1,966,080 | 655,350 |

Euler's formula V − E + F = 2 holds at every level [C]. The reference game's fan wiki says the Moon has 163,842 regions, describes them as "hexagonal sectors", and counts a region as cleaned at ≤1% dust left. It also counts a region as "started" at 0.1% cleaned and skips regions with no dust [1]. That is consistent with a level-7 icosahedral hexagon grid; this is my inference, not something the developer has stated.

**Alternative grids and their counts:**

| Scheme | Cell-count formula | Configurations near 163,842 | Equal-area? |
|---|---|---|---|
| Icosahedral hexagons (Goldberg / ISEA4H) | 10·4ⁿ + 2 | n = 7 → **163,842** exactly [4][C] | ISEA: yes [4]; plain geodesic: no (§1.2) |
| HEALPix | 12·Nside² [6] | Nside = 128 → **196,608** (verified [C]); Nside = 64 → 49,152 [C] | Yes. Every pixel has area π/(3·Nside²) [6] |
| Cube-sphere quads | 6·N² | N = 128 → 98,304; **N = 165 → 163,350**; N = 256 → 393,216 [C] | No; depends on the mapping (§1.2) |
| H3 (aperture 7) | 2 + 120·7ʳ (my fit to the table) | r = 3 → 41,162; r = 4 → 288,122 [5] | No. Hexagon max/min area is 1.970 at r = 4 [5] |

The NESTED HEALPix hierarchy assumes Nside is a power of two [6]. So 196,608 (Nside = 128) is the HEALPix configuration closest to 163,842 that still has a clean hierarchy.

### 1.2 How even the cell areas are (computed)

**Method [C].**
1. Generate the level-7 vertices.
2. For each triangle, compute its spherical circumcentre.
3. Give each vertex the area of two spherical sub-triangles per neighbouring triangle: (vertex, edge midpoint, circumcentre). This is valid here because every triangle is acute.
4. Compute spherical triangle areas with the Van Oosterom–Strackee formula.

The cell areas summed to 4π to within 10⁻¹⁴. These cells are the spherical Voronoi cells around each vertex, which is exactly the partition that a "nearest sector centre" lookup produces.

| Construction (163,842 cells unless noted) | Hexagon max/min area | Hexagon CV | Mean pentagon / mean hexagon | All cells max/min | Edge length max/min |
|---|---|---|---|---|---|
| **Recursive midpoint + normalise** (great-circle bisection, the usual "icosphere") | **1.300** | **8.5%** | 0.886 | 1.362 | 1.195 |
| One-shot flat 128-frequency grid + normalise (gnomonic) | 1.961 | 13.3% | 0.583 | 2.069 | 1.473 |
| H3, resolution 4 (published, 288,122 cells) | 1.970 [5] | n/a | n/a | n/a | n/a |
| ISEA4H, resolution 7 (Snyder equal-area) | 1 for hexagons by construction [4] | 0 | 5/6 [4] | 1.2 | n/a |
| Cube-sphere, linear (gnomonic), N = 165 (163,350 cells) | 5.13 | 38% | n/a | 5.13 | n/a |
| Cube-sphere, tangent (equal-angle), N = 165 | 1.41 | 9.0% | n/a | 1.41 | n/a |
| Cube-sphere, analytic "spherified cube" map, N = 165 | 1.31 | 3.4% | n/a | 1.31 | n/a |
| HEALPix, Nside = 128 (196,608 cells) | 1 [6] | 0 | n/a | 1 | n/a |

**Cross-checks [C].**
- A gnomonic projection scales area by cos³θ, where θ is the angle from the face centre.
- At a cube corner, cos θ = 1/√3, so the limiting max/min ratio is 3√3 ≈ 5.196. The computed 5.13 is close.
- At an icosahedron vertex, θ ≈ 37.4°, so the limit is about 1/cos³θ ≈ 1.99. That matches both the computed 1.96 and H3's published 1.97 [5].

**Implications.**
- If each sector holds dust in proportion to its area, the recursive icosphere varies by about ±15% between sectors. The 12 pentagons are 11% smaller than an average hexagon.
- The gnomonic construction varies by 2×, and its pentagons are 42% smaller. Avoid it for gameplay unless rewards are scaled by area.
- ISEA gives exactly equal areas, at the cost of "relatively high shape distortion" according to DGGRID [4]. DGGRID is a command-line tool and could produce the cell table offline [4].
- The two icosphere constructions put their vertices in **different places**. Choose one, generate it once, and **ship one canonical table** (163,842 × 3 float32 = 1.97 MB raw [C]) to both server and client. This avoids small floating-point differences between two separate implementations.

### 1.3 Indexing schemes

- **10 diamonds + 2 poles (Q2DI-like), recommended.**
  - Pair the 20 icosahedron triangles into 10 diamonds (rhombi). At level 7 each diamond holds a 128 × 128 grid of vertices (i, j), and the two remaining icosahedron vertices are the poles: 10·16,384 + 2 = 163,842 [C].
  - DGGRID's Q2DI address form is "quad number and (i, j) coordinates on that quad" [4], and R wrappers number the quads 0–11 [10].
  - The THOR climate model stores icosahedral grids with the "rhomboid face index (0 to 9)" as the slowest-changing index. It warns that indexing across rhomboid boundaries is not straightforward because the axis orientation changes [8].
  - The GRIB2 icosahedral template also forms diamonds from pairs of triangles [9].
  - The dyadic icosahedral triangulation with geodesic midpoints, and a data structure that makes it convenient to work with, go back to Baumgardner & Frederickson (1985) [7].
  - A linear ID is d·16384 + i·128 + j, with 163,840 and 163,841 for the poles. That fits in 18 bits, since 2¹⁸ = 262,144 [C].
  - Morton (Z-order) ordering of (i, j) inside each diamond gives a free hierarchy for map and UI grouping. For example, level-3 "super-regions" give 10·8² + 2 = 642 groups [C].
- **Per-face (i, j) on the 20 triangles.** This is simpler to generate, but there are 20 index spaces and more edge cases.
- **H3-like or ISEA3H hierarchies.** Aperture-7 or aperture-3 parent/child nesting does not reproduce 163,842 cells [5]. Sahr's work describes pyramid addressing with a "quadrilateral 2-dimensional integer system" [12] and surveys the design choices for geodesic grids [11]. That is useful background but not needed here.
- **Open-source "hexasphere" JavaScript libraries.** Not surveyed in this pass because of budget; see the uncertainty section.

### 1.4 Constant-time point-to-cell and neighbour lookups

- **Neighbours.** Directed adjacency entries total 2E = 163,830·6 + 12·5 = **983,040** [C].
  - Stored as a compressed adjacency list of uint32 values: 3.75 MiB. Packed at 18 bits per entry: about 2.11 MiB [C].
  - Neighbours can also be derived on the fly inside a diamond from (i±1, j), (i, j±1), (i+1, j−1) and (i−1, j+1), plus remapping rules at diamond edges [8].
  - Precomputing the table is simpler and safer, and is cheap on both server and client.
- **Point → cell for the gnomonic construction (closed form) [C].**
  1. Find the face with the largest dot product among the 20 face normals.
  2. Intersect the ray with that face's plane.
  3. Solve a 2 × 2 system for lattice coordinates.
  4. Round to the nearest vertex of the triangular lattice.
  5. Check that candidate and its 6 neighbours by dot product and keep the best. Step 5 is needed because the nearest vertex in the plane is not always the nearest on the sphere.

  This costs about 27 dot products.
- **Point → cell for the recursive construction [C].**
  1. Do the same 20-face test.
  2. Descend 7 levels. At each level, three great-circle side tests choose 1 of 4 child triangles.
  3. Refine among the corners and their neighbours.

  This costs about 50 dot products and is still constant time for a fixed level.
- **On the GPU [C].** Doing that lookup for every pixel is too expensive on integrated GPUs. Instead:
  - Look up the sector once per vertex (near-field terrain vertices are dense) and pass it to the fragment shader as a flat value.
  - Give each sector tile a gutter of shared texels at least one triangle wide, so a fragment just across a border still samples valid content.
  - For far views, use a baked cube map of sector IDs.

### 1.5 Recommendation (grid)

- Use the **recursive level-7 icosphere**, whose cell centres are the sectors, in the **diamond-plus-poles** layout.
- Precompute the neighbour table and a **canonical tangent frame for each sector** (centre plus two tangent axes) and ship them as one binary asset.
- Scale each sector's total dust by its actual area so that payout per m² is the same everywhere. Alternatively, keep a flat reward per sector as the reference game appears to do [1].
- Switch to ISEA only if exactly equal sector areas becomes a design requirement [4].

---

## 2. Terrain LOD on a sphere in the browser

### 2.1 What our scale implies [C]

| Moon radius R | Surface area | Mean sector area | Hexagon width (flat to flat) | Centre spacing | float32 precision at radius R |
|---|---|---|---|---|---|
| 1 km | 12.57 km² | 76.7 m² | 9.4 m | 9.4 m | 0.06 mm |
| 2 km | 50.27 km² | 306.8 m² | 18.8 m | 18.9 m | 0.12 mm |
| **3 km** | **113.10 km²** | **690.3 m²** | **28.2 m** | **28.3 m** | **0.24 mm** |
| 4 km | 201.06 km² | 1,227.2 m² | 37.6 m | 37.8 m | 0.24 mm |
| 5 km | 314.16 km² | 1,917.5 m² | 47.1 m | 47.2 m | 0.49 mm |

- Centre spacing is the mean level-7 edge angle (9.443 × 10⁻³ rad) multiplied by R.
- The precision column is the gap between adjacent IEEE-754 single-precision numbers (24-bit significand) at that magnitude.

**Conclusion.** Unlike Earth-scale globes, a moon a few km across has no single-precision vertex problem.

### 2.2 Candidate LOD techniques

- **CDLOD (Strugar)** [14].
  - A "quadtree of regular grids, more similar to [Ulrich 02]" (chunked LOD).
  - It uses a single LOD function based on the true 3-D distance between viewer and terrain.
  - Vertices morph continuously between detail levels with distance, which avoids popping and seams between tiles at different levels [14][15].
  - The reference code is old (DirectX 9) [14], but the method fits a vertex shader that samples a height texture well.
  - On a sphere: run one quadtree per cube face (or per icosahedral diamond), use a fixed N × N grid mesh per node drawn with instancing, and compute the morph from 3-D distance. Because both sides of a cube edge use the same distance function, they choose matching detail levels. **Assumption:** this removes most of the need for skirts; verify at cube edges.
- **Geometry clipmaps** [16][17].
  - Nested regular grids centred on the viewer, refilled incrementally as the viewer moves. LOD is chosen in world space by distance.
  - The GPU version keeps elevations in vertex textures and flew over a 20-billion-sample US dataset in 355 MB at about 90 fps [17].
  - On a sphere the planar rings must be adapted to a curved parametrisation. Clipmaps are also built around one centre, which complicates multiple views (orbit transition, picture-in-picture, drone cameras).
  - The spherical-clipmap literature could not be retrieved in this pass.
- **Chunked LOD.** Precomputed chunk hierarchies; CDLOD positions itself relative to this approach [14]. Our data is small enough to stay fully in memory, so chunked LOD's main strength (out-of-core streaming) matters little here.
- **ROAM and restricted quadtrees.** These are 1990s techniques that refine triangles on the CPU. Not re-researched; not recommended.

### 2.3 Cracks, morphing and precision

- **Cracks.**
  - CDLOD morphing removes seams inside a quadtree [14][15].
  - Cube-face edges need matching morph decisions and seamless height sampling. A cube texture gives seamless filtering at face edges; a 6-layer texture array needs gutters.
  - Vertical "skirts" (strips hanging down from patch borders) are a fallback for any remaining hairline cracks.
- **Precision.**
  - Cozzi's "Precisions, Precisions" describes the jitter you get at large coordinates and fixes it by building the model-view matrix relative to the viewer in double precision on the CPU [18].
  - Reversed-Z depth "helps a lot" with depth-buffer precision [19].
  - Cesium has used a logarithmic depth buffer for very large depth ranges [21].
  - Godot documents emulating double precision on the GPU for very large worlds [20]. **At our scale this is unnecessary** (§2.1).

  Recommendation: compute matrices in JavaScript doubles, upload camera-relative matrices, use reversed-Z (or push the near plane out in orbit view), and **do not** add a floating origin or double emulation.

### 2.4 Height data (LOLA) and baking

- **Products.**
  - NASA's **CGI Moon Kit** provides displacement maps at **64, 16 and 4 pixels per degree (ppd)**, made from LOLA's global cylindrical products [22].
  - USGS hosts a global LOLA DEM at **118 m/px**: an 8 GB GeoTIFF of 16-bit integers with a 0.5 scale factor [23].
  - LOLA-derived shaded-relief products are named "474m" for the 64 ppd grid [24].
  - NASA PGDA offers a 64 ppd shape model (about 683 MB GeoTIFF) in the **MOON_PA frame, which differs from the standard LDEM frame** [25].
  - A LOLA–Kaguya merged DEM covers 60°N–60°S at **59 m** [26].
- **Scaling [C].**
  - 64 ppd ≈ 474 m/px implies a lunar circumference of about 360·64·474 m ≈ 10,920 km, i.e. a radius of about 1,738 km.
  - For R_game = 3 km the scale factor is about 1/579. One 64 ppd pixel becomes about 0.82 m in the game, a 16 ppd pixel about 3.3 m, and a 4 ppd pixel about 13 m.
  - Relief shrinks by the same factor: a 3 km crater wall becomes about 5 m. Some vertical exaggeration is probably a design necessity.
- **Resident height cube map [C].**
  - At R = 3 km a cube face spans (π/2)·R ≈ 4,712 m.
  - 1024² per face gives about 4.6 m/texel (12 MiB at 16-bit); 2048² gives about 2.3 m/texel (48 MiB).
  - 16 ppd source data is enough for 1024², and 64 ppd is enough for 2048².
  - **No tile streaming is needed** for the base DEM at this scale. Ship one compressed asset.
  - Detail below about 2 m (small craters, rocks, noise) should be **procedural and deterministic**, so the Node server can evaluate the same height function for ground checks (§3).

### 2.5 Normals and texturing

- Compute normals from the height cube map by finite differences, add detail normal maps near the camera, and blend textures with slope and curvature masks.
- On steep crater walls, use triplanar-style blending. Journey's sand ripples blended four textures by dune orientation and steepness, which Zucconi describes as similar to triplanar shading [27].

### 2.6 Existing web engines and demos (for reference, not adoption)

- **3DTilesRendererJS** (NASA-AMMOS, three.js): documents ellipsoid support "used to model planet-scale surfaces" [28].
- **LithoSphere** (NASA-AMMOS): a tile-based 3D globe renderer extracted from MMGIS [29].
- **Giro3D:** a Globe entity with ellipsoid tile geometry, WGS84 by default [30].
- **geo-three:** builds terrain from height tiles in software or with GPU displacement, and has spherical tile modes [31].

These are built for streaming geodata at Earth scale. Our moon is tiny, fully resident, and tightly coupled to dust rendering, so a **small custom CDLOD is the lower-risk path**. WebGPU support in these libraries was not verified in this pass.

### 2.7 Terrain recommendation

1. **Primary (T1): spherified-cube CDLOD.**
   - Six quadtrees with instanced grid patches.
   - The tangent or "spherified" warp keeps texel areas within 1.3–1.4× of each other (§1.2).
   - Height comes in the vertex shader from the resident cube map, plus procedural detail near the camera.
   - Leaf vertex spacing near the player is about 0.25–0.5 m, so dust displacement and berms have vertices to move.
   - Dust lookups use a sector ID computed per vertex (§1.4).
2. **Spike (T2): icosahedral-diamond CDLOD.**
   - Ten quadtrees in the same (d, i, j) space as the sectors, so terrain patches, sectors and dust tiles share one parametrisation.
   - Costs: no hardware-seamless cube sampling, and axis remaps at diamond edges [8].
   - Prototype it only if T1's mismatch between the terrain grid and the sector tiles causes real problems.

---

## 3. Collision and ground queries on a sphere

- **Characters: analytic ground (recommended) [C].**
  - "Up" is the normalised position. Ground radius g(û) = R + H(û), where H is the cube-map height (bilinear) plus procedural detail.
  - Get slope from finite differences of H in the tangent plane.
  - The same H runs in Node on the server for cheap plausibility checks (speed caps, "not under ground").
  - Rapier's built-in character controller takes an **up vector** that "instructs the character controller of what direction should be considered vertical". It **supports translations only**, not rotation [32].
- **Vehicles and props: Rapier on clients only.**
  - Rapier heightfields are rectangles in the X–Z plane on a regular grid, and "can be given any orientation by changing the orientation of the collider itself" [33]. Each chunk can therefore sit on its local tangent plane.
  - Triangle-mesh winding does not matter. The `FIX_INTERNAL_EDGES` flag is a popular fix for ghost collisions. Long, thin triangles hurt stability, and triangle meshes are discouraged on *dynamic* bodies, where a convex decomposition is recommended [33].
  - **Radial gravity:** set world gravity to zero and apply a per-body force toward the centre each step. The Ecctrl controller uses this pattern, with zero Rapier gravity and its own gravity field [34].
- **Curvature inside a flat collider chunk [C].** The surface drops below the tangent plane by d²/(2R). At R = 3 km that is 4.3 cm at 16 m from the chunk centre, 17 cm at 32 m and 68 cm at 64 m. Bake this drop into the chunk's heights.
- **Gravity direction across a chunk [C].** Over 64 m, the direction of gravity changes by about 1.2°, which is negligible.
- **Stream colliders in a ring around each local player:** for example, 3 × 3 chunks of 32–64 m.
- **Server:** no physics engine on 0.1 CPU. Movement is client-authoritative with sanity checks. Dust is server-authoritative (§5).

---

## 4. Dust and cleaning representations

### 4.1 Requirements turned into numbers [C]

| Item | Value at R = 3 km |
|---|---|
| Sector | ≈690 m², hexagon ≈28.2 m across flats and ≈32.6 m across corners |
| Square tile covering one sector | ≈34 m |
| Texel size at 32² / 64² / 128² / 256² | 1.06 / 0.53 / 0.27 / 0.13 m |
| Texel size needed for crisp footprints | ≈2–5 cm. That would mean about 1,000² texels per sector, so it is **impossible as persistent per-sector state** and has to be local and temporary |
| Sectors within 100 / 300 / 500 m of the player | ≈46 / ≈410 / ≈1,140 |
| One hand-cleaner, 0.5 m tool, 10 strokes/s | ≈1,380 stroke segments and ≈2.3 min per sector, ignoring overlap. Reaching all 163,842 sectors by hand would take thousands of player-hours, which is why vehicles and automation matter |

### 4.2 Options compared

| Option | Server state and CPU | Bandwidth | Client GPU memory | Visual fidelity | Persistence | Authority | Main pitfalls |
|---|---|---|---|---|---|---|---|
| **(a) Scalar per sector + procedural visuals** | 163,842 scalars (160 KiB at 8-bit, 640 KiB at float32), O(1) per update | Minimal (about 4 B per sector change) | One global buffer | Trails are **not persistent or consistent**. A partly cleaned sector is drawn as a procedural "dissolve" pattern, not where you actually cleaned | Trivial | Weak scoring: assuming dust is spread evenly lets players "remove" dust by scrubbing the same spot again | What you cleaned is not what others or your future self see; edges cannot be crisp |
| **(b) Fine masks painted on the GPU, synced as masks** | Opaque blobs relayed and stored | Tile changes of KBs each, plus edit conflicts | Atlas, e.g. 410 tiles × 16 KiB ≈ 6.4 MiB at 128² 8-bit | Best | Heavy (KBs per partly cleaned sector) | Weak: masks are made by clients | Needs a merge rule (per-texel minimum works, see P3). WebGPU has no sparse textures [52] |
| **(c) Stroke replication + server coarse ledger** | Scalars plus a 512 B ledger per active sector; work grows with the number of strokes | About 16 B per stroke segment | Same atlas as (b) | Independent of resolution; the same on every client apart from GPU rounding | Ledger plus capped stroke logs | **Strong**: the server ledger is authoritative | Stroke logs grow; late joiners need reconstruction; robots need intent replication instead |
| **(d) RVT-style virtual texturing** | n/a (a client caching technique) | n/a | Page pool plus lookup table | Very good when pages are resident | n/a | n/a | Pages are generated on demand and look blurry after teleports [51]. WebGPU must emulate it with an atlas and lookup table [52][53] |

### 4.3 Lessons from shipped games

- **PowerWash Simulator (FuturLab).**
  - *Completion snapping.* A walkthrough reports that pieces "remove any remaining dirt once the total cleanliness of that object gets above 99%" [35]. GameSpot describes an invisible "close enough" threshold [36]. Completed objects "ding" [38].
  - *Granularity.* Players report that designers split large surfaces into several objects so they do not complete too early [37]. This is community speculation.
    - For us: at R = 3 km, 1% of a sector is about 6.9 m², a visible patch about 2.6 m across.
    - So make the snap visible and satisfying (a fade plus sound), or shrink sectors by choosing a smaller R.
  - *Feedback.* The progress bar can lag behind what looks clean, and the tablet flashes incomplete objects [39]. The sequel adds a "dirt finder" that highlights remaining dirt [43]. Our server ledger can drive the same kind of highlight.
  - *Dirt variety.* The first game had seven dirt types, with any three applied to an object [41]. In the sequel, layers can be stacked more freely, dirt is supported by ambient occlusion, and spray particles match each dirt type [42]. For us, multiple 4-bit ledger levels plus tool strength give "tough" layers.
  - *Co-op.* "Only the host will gain the progression" [40]. PowerWash co-op centres on the host, whereas we have a persistent world on a dedicated server.
  - *Not public:* the actual dirt-mask implementation is not documented in any source found.
- **Splatoon (Nintendo).**
  - Turf War is won by covering the most ground with ink, and special weapons charge by painting [44].
  - Lesson: paint is visual, a gameplay resource and the score all at once, so it needs **one authoritative coverage count**. Our ledger is that count.
  - Searches in English and Japanese, including for CEDEC talks, found **no public technical description** of how the ink is painted or synchronised.
- **Rise of the Tomb Raider (snow).**
  - "Deferred snow deformation" moves the cost from rendering the deformation heightmap to **rebuilding depressions and elevations at render time**. It uses adaptive tessellation and fewer snow vertices to keep costs down [45].
  - The related SIGGRAPH 2015 talk describes the method as independent of the snow mesh and using compute shaders. Its bibliography cites "Deformable Snow Rendering in Batman: Arkham Origins" (GDC 2014) [46].
  - Lesson: store a *mask* and rebuild the trough and berm shape when shading.
- **Journey (sand).**
  - The GDC 2013 talk covers about three years spent refining the sand [47].
  - Zucconi's breakdown lists rim lighting, an "ocean specular" and a separate **glitter** term, a random normal texture drawn from a Gaussian distribution, and ripple textures blended by orientation [27].
  - This is a direct model for making dusty and clean surfaces look different.
- **Unreal Runtime Virtual Texturing.**
  - It caches camera-independent landscape shading (layer blending) into a virtual texture. Decals and splines are composited into it, and any actors inside the RVT volume are rendered into it [48][49].
  - Pages live in memory pools with residency tracking [50]. Users see blurry tiles after teleporting, until the new pages are produced [51].
  - The WebGPU discussion of sparse textures notes that not all hardware supports them (desktop Intel is singled out) and that console games often use indirection for atlases and virtual texturing [52]. A WebGPU tutorial chapter implements a "mega texture" [53].
  - Our design is a light version of RVT where **one page = one sector tile**. Which pages to load is decided analytically from distance to players, so no GPU feedback readback is needed.
- **Not researched in this pass (budget):** God of War and Horizon snow, Viscera Cleanup Detail, and Batman: Arkham Origins details. See the uncertainty section.

### 4.4 Recommended layered design (feeds prototype P2)

| Layer | Where it lives | What it holds | Size [C] |
|---|---|---|---|
| L0: sector scalars | Server (authoritative) and all clients | Fraction of dust remaining per sector, plus a state of untouched, partial or complete | 163,842 × 1 B on the wire, float32 in server memory (640 KiB) |
| L1: coarse ledger | Server, **only for partly cleaned sectors** | 32 × 32 × 4-bit grid in the sector's canonical tangent frame (about 1 m texels) | 512 B per active sector, e.g. 10k active ≈ 5 MB |
| L2: sector tiles | Client GPU atlas, sectors near players | Remaining dust (R) plus berm height (G) at 64²–128² | 4–32 KiB per tile; 4096² r8 atlas = 16 MiB ≈ 1,024 tiles of 128² |
| L3: detail ring | Client GPU, toroidal (wraps around as the player moves) | Footprints, wheel ruts, crisp trail edges at 2–3 cm | 2048² rg8 = 8 MiB (≈51 m across at 2.5 cm) |
| L4: stroke log | Server (capped) and clients near the sector | The last N validated strokes per active sector, for late joiners and re-drawing | 16 B per stroke; cap e.g. 256 strokes = 4 KiB per sector |

How the layers work together:
- **Order does not matter.** Every stroke *subtracts* dust, clamped at 0. Clamped subtraction of non-negative amounts gives the same result in any order, so clients converge even when strokes arrive in different orders. Only coverage at stroke edges, where the GPU's rounding can differ, may differ slightly.
- **Snap.** When the L1 ledger reaches ≤1% remaining [1], the server marks the sector complete. Clients fade any leftover dust in L2 to zero and play the "ding". L1 and L4 for that sector are then freed.
- **Footprints and tracks of other players** are generated locally from their replicated movement and cost no extra bandwidth.
- **Robots and automation:** replicate *intent*, such as a route program and a start time, and let clients simulate the strokes. Send only L0 updates to clients that are far away.

---

## 5. Economy: computing "how much dust was collected"

| Approach | Accuracy | Cost on a 0.1-CPU server | Pitfalls |
|---|---|---|---|
| Analytic: stroke area ∩ sector × density × strength, scalar state only | Wrong for re-swept areas (assumes dust is spread evenly) | Tiny | Scrubbing the same spot repeatedly still "earns" dust. Diminishing returns cannot tell fresh dust from swept ground |
| **Coarse ledger on the CPU (recommended)** | Exact at about 1 m texels, no double counting | Tiny [C]: a hand stroke touches about 6 ledger texels, a vehicle stroke about 15. With 4 × 4 coverage samples per texel that is about 250 point tests per stroke, or about 40k/s for 160 strokes/s | Coverage is coarse, so a thin unswept sliver smaller than a texel can disagree with what the player sees. The snap at ≤1% and the dirt-finder highlight hide this |
| GPU reduction + readback (`mapAsync`) | Exact at fine resolution, but only on that client | Zero on the server | Asynchronous: copy to a `MAP_READ` staging buffer, then map it [54][56]. Delay depends on the implementation; WebKit had `mapAsync` waiting on unrelated command buffers [55]. A ring of buffers keeps several transfers in flight but does not hide the delay [56]. **Clients can lie**, so it is never authoritative |

**Formula, in words.** For each ledger texel *t* that a stroke covers:
- c_t is the fraction of the texel the stroke covers.
- s is the tool strength.
- d_t is the dust remaining in that texel (0–1).
- ρ_t is the base dust density.
- A_t is the texel area.

The removed fraction is min(d_t, s·c_t), so the mass collected is the sum over covered texels of min(d_t, s·c_t)·ρ_t·A_t. Then subtract min(d_t, s·c_t) from d_t.

**Recommendation.** The server ledger is authoritative. Each client runs **the same ledger code on its own strokes** to predict the dust counter instantly, then reconciles with the server's acknowledgement. GPU readback is optional and only for visual effects.

---

## 6. Rendering a dust layer that visibly thins

- **Thinning.**
  - Visible dust = a smooth step of (remaining fraction × local dust depth + high-frequency height or noise − threshold).
  - As the fraction falls, more peaks of the "clean" layer show through, so the layer looks patchy and thin rather than uniformly faded.
  - The same threshold turns a soft 0.27 m mask into crisp, natural-looking edges. This is the dissolve, or height-blend, idea.
- **Crisp stroke edges at low resolution.**
  - Valve's technique stores a **signed distance field** in a low-resolution texture so alpha-tested edges stay sharp when magnified [57].
  - For strokes, keep "distance to the cleaned region" per texel by taking the minimum of each stroke capsule's distance. A minimum gives the exact union outside the strokes, and the edge is all we need.
  - **Assumption:** min/max blending is available on both WebGPU and WebGL2. Check this in the prototype.
- **Troughs and berms.**
  - When drawing a stroke, also add "pile" height in a narrow band just outside the capsule, proportional to the dust removed, into the G channel.
  - Shade the trough (R) and berm (G) through vertex displacement on the dense CDLOD near-field grid plus normal perturbation. This follows Rise of the Tomb Raider's approach of rebuilding depressions and elevations at render time [45].
  - Rise of the Tomb Raider relied on adaptive tessellation [45]. Design for **dense-mesh vertex displacement** instead, because we assume no hardware tessellation in WebGPU (not re-verified in this pass).
- **Parallax occlusion mapping (POM).** Keep it out of the integrated-GPU tier. Use normal perturbation from mask gradients plus detail normals, and benchmark POM only on discrete GPUs (§8). **Assumption:** a per-pixel ray march through a height field costs too much on integrated GPUs; measure it.
- **Footprints and wheel tracks.**
  - Use the L3 detail ring at 2–3 cm, wrapping around the local camera.
  - Fade old marks out over time, or bake them coarsely into L2 as "trampled".
- **Sparkle and specular.**
  - Dusty: bright albedo, rough, with a Journey-style glitter term and a random normal texture [27][47], and possibly rim brightening.
  - Clean: darker, smoother, slightly specular.
  - The albedo difference also carries to distant views.
- **Clean vs. dirty from orbit [C].**
  - Sector centres are the level-7 icosphere's vertices. So for orbit and map view, keep a **163,842-entry per-sector buffer** (one byte each, 160 KiB) and draw it as a per-vertex value on a level-7 icosphere proxy. This gives a smooth coverage field, and only changed entries need updating.
  - For a "region scan" look, colour Goldberg faces flat, about 655k triangles with 4 per hexagon. The reference game's scan shows sector edges and percent clean [1].
  - For far terrain LODs, sample a coverage cube map (6 × 256² r8 = 384 KiB) rebuilt incrementally from L0.
- **Optional RVT-style caching.** Draw the combined terrain plus dust albedo and normal into each sector's tile when it changes, so integrated GPUs do not pay for layered material shading on every pixel every frame [48][49].

---

## 7. Sync and persistence sizing [C]

**Assumptions:** 16 players, R = 3 km, hand tools sending 10 stroke segments/s, deltas sent at 5 Hz, and every player inside every other player's interest radius (worst case).

| Payload | Raw size | Notes |
|---|---|---|
| Scalars, 1-bit (clean or not) | 20,481 B (20.0 KiB) | Fine for completion only |
| Scalars, 4-bit | 81,921 B (80.0 KiB) | |
| **Scalars, 8-bit** | **163,842 B (160.0 KiB)** | One step = 0.39% (enough to show a 1% threshold) |
| Scalars, 16-bit | 327,684 B (320.0 KiB) | Good for persistence |
| Scalars, float32 (server memory) | 655,368 B (640.0 KiB) | Exact accounting |
| **3-state map (2-bit) + 8-bit values for partial sectors only** | 40,961 B + *k* B | Joining mid-game: ≈43 KB with k = 2,000, before compression |
| Entropy floor, example: 10% of sectors touched with uniform values, the rest untouched | ≈1.27 bit/sector ≈ 25.4 KiB | Real cleaned regions are contiguous, so run-length encoding or deflate should do better. Purely random values cannot be compressed (≈160 KiB) |
| Delta entry (18-bit ID + 14-bit value) | 4 B | |
| Stroke segment (sector ID, start and end in local 16-bit coordinates, width, strength, tool, sequence) | ≈16 B | |
| Ledger per active sector | 512 B (32 × 32 × 4-bit) | |
| Stroke log per active sector (capped at 256) | ≤4 KiB | An uncapped hand-cleaned sector would be ≈22 KB (≈1,380 segments) |

**Rates (worst case) [C].**

| Traffic | Rate |
|---|---|
| Strokes into the server | 16 players × 10 segments/s × 16 B = **2.56 KB/s** |
| Strokes out to each client (15 other players) | **2.4 KB/s** |
| Delta updates to each client (≤2 sectors per player per tick, 5 Hz) | 32 × 4 B × 5 Hz = 0.64 KB/s |
| **Total server outbound** | **≈48.6 KB/s ≈ 175 MB/hour** |

- Interest management (strokes only within about 300 m) cuts this sharply.
- Robots must not send per-stroke traffic to distant clients. 100 robots at 5 segments/s each would be 8 KB/s per interested client.

**Joining mid-game [C].**
- The compact L0 map and values: about 40–45 KB before compression.
- Plus nearby ledgers: up to 100 × 512 B ≈ 51 KB.
- Plus nearby stroke logs: up to 100 × 4 KiB ≈ 400 KiB worst case.

That totals about 150 KB in a typical case and about 0.5 MB at worst, streamed nearest-first.

**Compression and transport.**
- The `ws` library disables `permessage-deflate` on the server by default and enables it on the client. It warns that the extension adds significant performance and memory overhead and can cause "catastrophic memory fragmentation" under concurrency on Linux [58][59].
- On a 0.1-CPU server: send **binary messages**, leave `permessage-deflate` off, and **build and cache the compressed snapshot every few seconds** rather than compressing per join or per message.

**Persistence (MySQL, external to Render).**
- Render's free web services have an ephemeral filesystem and spin down after 15 minutes without inbound traffic [13]. Render's documented free managed database is Postgres, which expires after 30 days [13], so MySQL must be hosted elsewhere.

Schema sketch, described in prose:
1. **World table:** one row per world with the L0 scalars as a 16-bit blob (320 KiB). Better still, split it into **640 chunks of 16 × 16 sectors** within each diamond (512 B each at 16-bit), plus a tiny pole chunk, and write only changed chunks [C].
2. **Active-sector table:** keyed by (world, sector), with the L1 ledger (512 B), the L4 log (≤4 KiB) and a version number. Upsert changed rows in the background every 10–30 s, and when the last player leaves, before the 15-minute idle spin-down.
3. **Completed sectors:** delete their active rows, since the L0 state marks them complete.

**Fine masks (L2) are not persisted.** Clients rebuild them from L1 (upsampled and noise-thresholded) plus L4. Older edges come back slightly softer, which is acceptable for background areas. If masks *are* persisted, as in option (b) and P3, a 128² 4-bit mask is 8 KiB raw. Run-length encoding or bitplanes should shrink stroke-like masks a lot, but **measure this**; no source was found.

**Server memory and CPU budget [C].**
- Dust state is about 0.64 MB of scalars, about 5 MB of ledgers for 10k active sectors, and about 8 MiB of logs if capped for 2k sectors near players: **tens of MB at most**, well within 512 MB.
- CPU is event-driven, with no loops over all 163,842 sectors per tick. Per-stroke work is about 250 point tests.
- **Assumption:** Node on 0.1 vCPU easily handles about 10⁴–10⁵ simple operations per second. Measure it in §8.
- Spin-up takes about 1 minute after an idle spin-down [13], so clients need a "waking the server" state.
- 750 free instance-hours per month [13] is more than one always-on service needs: a 31-day month has 744 hours [C].

---

## 8. Candidate architectures for competitive prototyping

All three share the T1 terrain (§2.7), the grid assets (§1.5) and the same bot harness.

| | **P1: Scalar + procedural (baseline)** | **P2: Strokes + sector atlas + coarse ledger (preferred)** | **P3: Client-painted tiles, min-merge** |
|---|---|---|---|
| Server state | L0 only | L0 + L1 + capped L4 | L0 + opaque tile blobs (merged by per-texel minimum) |
| Client visuals | Procedural dissolve from the sector scalar + L3 ring | L2 drawn from strokes + L3 + snap fade | L2 painted locally with any brush or particles; tile changes uploaded |
| Authority for scoring | Server, assuming uniform dust (exploitable) | **Server ledger (exact at ≈1 m)** | Client-reported, server only checks bounds |
| Must demonstrate | Lowest possible server and network cost; whether players accept trails that don't persist | Crisp, consistent trails across 16 bot clients; joining mid-game; snap at ≤1%; restore after a Render spin-down; robots replicated as intent | Freedom of tool shape; conflict-free merging (dust only ever goes down, so per-texel minimum is order-independent); bandwidth and storage cost of tile changes |
| Expected risk | Visual and design disappointment | Determinism edge cases; log caps | Bandwidth, persistence size, cheating |

**Benchmark protocol (apply to all three):**
1. **GPU time.**
   - Fixed camera paths: walking at 1.7 m eye height, a vehicle at about 20 m/s, an orbit fly-over, and a 16-bot cleaning stress test.
   - Run on three hardware tiers (discrete mid-range, current integrated GPU, older integrated GPU) and on both WebGPU and WebGL2.
   - Record GPU time where the browser exposes timestamp queries; otherwise use frame-time deltas.
   - Targets from the brief: 60 FPS on discrete, 30+ FPS on integrated. Budget about 4 ms for terrain and about 2 ms for dust on integrated GPUs (**Assumption**).
2. **Memory.** Total texture and buffer bytes (atlas, ring, cube maps, orbit buffer) and the JavaScript heap.
3. **Network.** Bytes per second per client and total server outbound, at 1, 4 and 16 players, with and without robots.
4. **Server.** Run the Node process limited to 0.1 CPU and 512 MB, the brief's free-tier figure. Record event-loop lag and the 99th-percentile time to process a stroke, plus memory after 1 hour of bot play. Also test a forced spin-down and restore from MySQL.
5. **Visual quality.**
   - Screenshot pairs from fixed bookmarks, compared blind.
   - Edge width of a sweep trail, measured in pixels, at 2 m, 10 m and 50 m.
   - An "orbit readability" test: can testers point out cleaned regions from 5 km?
   - Check for visible hexagon outlines after snapping.

**Preferred: P2.**
- Its server work grows only with stroke count, on 512 B ledgers, which suits a 0.1-CPU, 512 MB instance.
- Scoring is authoritative without GPU readback.
- Visuals do not depend on any stored resolution: strokes are re-drawn at whatever resolution a client needs.
- Persistence stays small: ledgers and capped logs, with only changed L0 chunks written.
- It matches the RVT idea with "page = sector".

P3 is the fallback if tool variety (spray cones, particle cleaning, robot brushes) outgrows what strokes can express. P1 is the floor for comparing costs. T2 terrain is a time-boxed spike, not a competitor.

---

## Contradictions & uncertainty

1. **Reference-game numbers come from fan sources.** The 163,842 regions, "hexagonal sectors", ≤1% completion and 0.1% "started" figures are from a fan wiki, not the developer [1].
2. **PowerWash Simulator's threshold is not confirmed.** One walkthrough says more than 99% cleanliness removes the remaining dirt [35], while GameSpot only describes an invisible threshold [36]. The claim that surfaces are split to avoid early completion is speculation in a Steam thread [37]. **No source documents its dirt-mask or co-op sync implementation.**
3. **Splatoon's implementation is undocumented.** Searches in English and Japanese, including CEDEC, found no public description of how ink is painted or synchronised. Only gameplay facts are cited [44].
4. **Not researched in this pass (budget):** God of War and Horizon snow, Viscera Cleanup Detail, the contents of the Batman: Arkham Origins talk (only its title, via [46]), spherical clipmaps, `three-geospatial` (takram), open-source hexasphere libraries, and whether the listed web globe engines support WebGPU.
5. **Render free-tier CPU and RAM (0.1 CPU, 512 MB) come from the project brief.** The Render free-tier page I read does not state them [13]. Bandwidth limits on the free tier were not checked.
6. **WebGPU details not re-verified in this pass:**
   - No tessellation stage.
   - Availability of min/max blend operations (on WebGL2 as well).
   - How available and how precise timestamp queries are.
   - Device texture limits. Size atlases conservatively and query the limits at runtime.
   - Whether sparse textures are still missing. The open gpuweb discussion [52] shows hardware gaps; check its current status.
7. **Readback delay** has no authoritative figures. It depends on the implementation [55][56].
8. **LOLA products differ by frame and resolution.** 64 ppd is about 474 m/px and 256 ppd about 118 m/px. PGDA's 64 ppd model is in the MOON_PA frame, unlike the standard LDEM [25]. My lunar radius of about 1,738 km is back-calculated from the "474m" product name [24] and is approximate.
9. **CDLOD venue and year.** The repository is titled "CDLOD (2010)" [14]. Other listings cite it as a journal paper; check the venue before citing it formally.
10. **Computed statistics.** The area figures assume Voronoi cells built from circumcentres, which requires acute triangles. That held here: total area matched 4π to 10⁻¹⁴. The "spherified cube" map is the common analytic cube-to-sphere formula; I did not attribute it to a source.
11. **Server CPU, bandwidth and compression ratios** in §5 and §7 are estimates from stated assumptions. They are not measurements, and prototype P2 must confirm them.
12. **Determinism.** Different GPUs may cover stroke edges slightly differently. Scoring is unaffected because the ledger is on the server, but snapshots taken on two clients may differ by a texel at stroke edges.

---

## Sources

1. Moon Sweepers: Regions (Wikily fan wiki) — https://wikily.gg/moon-sweepers/regions — accessed 2026-11-11
2. Geodesic polyhedron (Wikipedia) — https://en.wikipedia.org/wiki/Geodesic_polyhedron — accessed 2026-11-11
3. Goldberg polyhedron (Wikipedia) — https://en.wikipedia.org/wiki/Goldberg_polyhedron — accessed 2026-11-11
4. DGGRID User Documentation (manual; ISEA/FULLER, Appendix E address forms, Appendix F cell statistics) — https://dggrid.readthedocs.io/latest/dggrid_manual.html — accessed 2026-11-11
5. H3: Tables of Cell Statistics Across Resolutions — https://h3geo.org/docs/core-library/restable/ — accessed 2026-11-11
6. Górski et al., "HEALPix: a Framework for High Resolution Discretization, and Fast Analysis of Data Distributed on the Sphere" (arXiv astro-ph/0409513) — https://arxiv.org/pdf/astro-ph/0409513 — accessed 2026-11-11
7. Baumgardner & Frederickson, "Icosahedral Discretization of the Two-Sphere," SIAM J. Numer. Anal. 22(6), 1985 — https://epubs.siam.org/doi/10.1137/0722066 — accessed 2026-11-11
8. THOR wiki: Grid data structure (exoclime/THOR) — https://github.com/exoclime/THOR/wiki/Grid-data-structure — accessed 2026-11-11
9. NCEP GRIB2 Grid Definition Template 3.100: Triangular grid based on an icosahedron — https://www.nco.ncep.noaa.gov/pmb/docs/grib2/grib2_doc/grib2_temp3-100.shtml — accessed 2026-11-11
10. hexify (R): hexify_quad_ij_to_icosa_tri, quad IJ to icosahedron triangle — https://rdrr.io/cran/hexify/man/hexify_quad_ij_to_icosa_tri.html — accessed 2026-11-11
11. Sahr, White & Kimerling, "Geodesic Discrete Global Grid Systems," Cartography and GIS 30(2), 2003 — https://typeset.io/pdf/geodesic-discrete-global-grid-systems-5bqef88b6j.pdf — accessed 2026-11-11
12. Sahr, "Location coding on icosahedral aperture 3 hexagon discrete global grids," Computers, Environment and Urban Systems 32(3), 2008 — https://katalog.lib.cas.cz/KNAV/EdsRecord/edselp,S0198971507000889 — accessed 2026-11-11
13. Render Docs: Deploy for Free (free instance spin-down, hours, ephemeral filesystem, free Postgres) — https://render.com/docs/free — accessed 2026-11-11
14. Strugar, CDLOD (2010) paper, collateral data and source code (GitHub) — https://github.com/fstrugar/CDLOD — accessed 2026-11-11
15. terrain-cdlod (CDLOD morphing demo, GitHub) — https://github.com/tschie/terrain-cdlod — accessed 2026-11-11
16. Losasso & Hoppe, "Geometry clipmaps: Terrain rendering using nested regular grids" (project page) — https://hhoppe.com/proj/geomclipmap/ — accessed 2026-11-11
17. Asirvatham & Hoppe, GPU Gems 2 Chapter 2: "Terrain Rendering Using GPU-Based Geometry Clipmaps" — https://developer.nvidia.com/gpugems/gpugems2/part-i-geometric-complexity/chapter-2-terrain-rendering-using-gpu-based-geometry — accessed 2026-11-11
18. Cozzi, "Precisions, Precisions" (AGI blog) — https://help.agi.com/AGIComponents/html/BlogPrecisionsPrecisions.htm — accessed 2026-11-11
19. Reed, "Depth Precision Visualized" — https://www.reedbeta.com/blog/depth-precision-visualized/ — accessed 2026-11-11
20. Godot Engine, "Emulating double precision on the GPU to render large worlds" — https://godotengine.org/article/emulating-double-precision-gpu-render-large-worlds — accessed 2026-11-11
21. Cesium blog, "Logarithmic depth" (2018) — https://cesium.com/blog/2018/05/24/logarithmic-depth/ — accessed 2026-11-11
22. NASA Scientific Visualization Studio: CGI Moon Kit — https://svs.gsfc.nasa.gov/4720 — accessed 2026-11-11
23. USGS Astrogeology: Moon LRO LOLA DEM 118m — https://astrogeology.usgs.gov/search/map/moon_lro_lola_dem_118m — accessed 2026-11-11
24. USGS Astrogeology: Moon LRO LOLA Color Shaded Relief Blue Steel 474m — https://astrogeology.usgs.gov/search/map/moon_lro_lola_color_shaded_relief_blue_steel_474m — accessed 2026-11-11
25. NASA PGDA: LOLA MOON_PA gridded dataset — https://pgda.gsfc.nasa.gov/products/95 — accessed 2026-11-11
26. USGS Astrogeology: Moon LRO LOLA - SELENE Kaguya TC DEM Merge 60N60S 59m — https://astrogeology.usgs.gov/search/map/moon_lro_lola_selene_kaguya_tc_dem_merge_60n60s_59m — accessed 2026-11-11
27. Zucconi, "A Journey Into Journey's Sand Shader" — https://www.alanzucconi.com/2019/10/08/journey-sand-shader-1/ — accessed 2026-11-11
28. NASA-AMMOS 3DTilesRendererJS: three.js renderer API docs (ellipsoid support) — https://raw.githubusercontent.com/NASA-AMMOS/3DTilesRendererJS/master/src/three/renderer/API.md — accessed 2026-11-11
29. NASA-AMMOS LithoSphere — https://nasa-ammos.github.io/LithoSphere — accessed 2026-11-11
30. Giro3D Globe entity source (v2.0.3) — https://app.unpkg.com/@giro3d/giro3d@2.0.3/files/entities/Globe.js — accessed 2026-11-11
31. geo-three (tentone): map and terrain tiles for three.js — https://fr.github.com/tentone/geo-three — accessed 2026-11-11
32. Rapier JS user guide: Character controller — https://www.rapier.rs/docs/user_guides/javascript/character_controller — accessed 2026-11-11
33. Rapier JS user guide: Colliders (heightfield, trimesh) — https://rapier.rs/docs/user_guides/javascript/colliders — accessed 2026-11-11
34. Ecctrl README v2.0.0 (zero Rapier gravity plus custom gravity field) — https://cdn.jsdelivr.net/npm/ecctrl@2.0.0/README.md — accessed 2026-11-11
35. TrueAchievements: PowerWash Simulator walkthrough, part 3 (Career Mode) — https://www.trueachievements.com/game/PowerWash-Simulator/walkthrough/3 — accessed 2026-11-11
36. GameSpot: PowerWash Simulator review — https://gamespot.com/reviews/powerwash-simulator-review-filthy-rich/1900-6417923/ — accessed 2026-11-11
37. Steam Community discussion, PowerWash Simulator (app 1290000) — https://steamcommunity.com/app/1290000/discussions/0/3821906878982244099 — accessed 2026-11-11
38. PlatGet: PowerWash Simulator trophy guide — https://platget.com/guides/powerwash-simulator-trophy-guide/ — accessed 2026-11-11
39. GamesRadar: PowerWash Simulator tips — https://gamesradar.com/powerwash-simulator-tips — accessed 2026-11-11
40. FuturLab Support: PowerWash Simulator FAQs — https://futurlab.freshdesk.com/support/solutions/articles/204000073336-powerwash-simulator-faqs — accessed 2026-11-11
41. Axios, "PowerWash Simulator shows how life's mundane tasks can be sensational" (2021) — https://www.axios.com/2021/06/04/futurlab-power-wash-simulator-game — accessed 2026-11-11
42. Xbox Wire, "PowerWash Simulator 2: How FuturLab Built a Sparkling Sequel" (2025) — https://news.xbox.com/en-us/2025/10/23/powerwash-simulator-2-how-futurlab-built-a-sparking-sequel/ — accessed 2026-11-11
43. PowerWash Simulator 2 (Wikipedia) — https://en.wikipedia.org/wiki/PowerWash_Simulator_2 — accessed 2026-11-11
44. Splatoon (video game) (Wikipedia) — https://en.wikipedia.org/wiki/Splatoon_(video_game) — accessed 2026-11-11
45. Michels & Sikachev, "Deferred Snow Deformation in Rise of the Tomb Raider," GPU Pro 7 (Graphics and Game Gems Database entry) — https://www.gameenginegems.com/gemsdb/article.php?id=1314 — accessed 2026-11-11
46. Michels et al., "Labs R&D: Rendering Techniques in Rise of the Tomb Raider" (SIGGRAPH 2015 talk) — https://history.siggraph.org/wp-content/uploads/2022/10/2015-Talks-Michels_Labs-R_D-Rendering-Techniques-in-Rise-of-the-Tomb-Raider.pdf — accessed 2026-11-11
47. Edwards, "Sand Rendering in Journey" (GDC 2013, GDC Vault) — https://gdcvault.com/play/1017742/Sand-Rendering-in — accessed 2026-11-11
48. Unreal Engine documentation: Runtime Virtual Texturing — https://dev.epicgames.com/documentation/unreal-engine/runtime-virtual-texturing-in-unreal-engine?lang=en-US — accessed 2026-11-11
49. Unreal Engine documentation: Runtime Virtual Texturing Quick Start — https://dev.epicgames.com/documentation/en-us/unreal-engine/runtimevirtual-texturing-quick-start-in-unreal-engine — accessed 2026-11-11
50. Unreal Engine documentation: Virtual Texture Memory Pools — https://dev.epicgames.com/documentation/unreal-engine/virtual-texture-memory-pools-in-unreal-engine?lang=en-US — accessed 2026-11-11
51. Unreal Engine forums: "Blurry RVT Tiles After Load or Teleport" — https://forums.unrealengine.com/t/blurry-rvt-tiles-after-load-or-teleport/2687566 — accessed 2026-11-11
52. gpuweb issue #455 (sparse resources discussion) — https://github.com/gpuweb/gpuweb/issues/455 — accessed 2026-11-11
53. WebGPU Unleashed, 5.4 "Mega Texture" — https://shi-yan.github.io/webgpuunleashed/Advanced/mega_texture.html — accessed 2026-11-11
54. MDN: GPUBuffer.mapAsync() — https://developer.mozilla.org/en-US/docs/Web/API/GPUBuffer/mapAsync — accessed 2026-11-11
55. WebKit Bug 272804, "[WebGPU][Performance] GPUBuffer.mapAsync waits for unrelated command buffers" — https://bugs.webkit.org/show_bug.cgi?id=272804 — accessed 2026-11-11
56. luma.gl: GPU readback ring — https://luma.gl/next/docs/api-reference/experimental/gpu-primitives/gpu-readback-ring — accessed 2026-11-11
57. Green (Valve), "Improved Alpha-Tested Magnification for Vector Textures and Special Effects" (SIGGRAPH 2007) — https://cdn.akamai.steamstatic.com/apps/valve/2007/SIGGRAPH2007_AlphaTestedMagnification.pdf — accessed 2026-11-11
58. ws: a Node.js WebSocket library, README (v8.22.1; permessage-deflate notes) — https://cdn.jsdelivr.net/npm/ws@8.22.1/README.md — accessed 2026-11-11
59. websockets/ws issue #1202 (permessage-deflate memory fragmentation) — https://github.com/websockets/ws/issues/1202 — accessed 2026-11-11

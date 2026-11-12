# World and dust simulation — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Draft for implementation (planning session 2026-11-12)** · Owner: lead (authored via brief) · Implementers: `terrain-dust-engineer` (primary), `gameplay-systems-engineer`, `netcode-engineer`, `backend-data-engineer`, `rendering-engineer`.
Canonical inputs (this doc never overrides them): [tech-stack.md](tech-stack.md), [module-boundaries.md](module-boundaries.md), [naming-bible.md](../design/naming-bible.md).
Evidence: [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (main source, "TDT" below), [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md), [browser-feasibility.md](../research/browser-feasibility.md), [visual-analysis.md](../research/visual-analysis.md), [moon-sweepers-mechanics.md](../research/moon-sweepers-mechanics.md) §4–§5, [asset-and-data-licensing.md](../research/asset-and-data-licensing.md).
Companion: [rendering-pipeline.md](rendering-pipeline.md) (frame, lighting, post, presets).

Rules for implementers: every number marked **[D]** is derived in this doc and must be re-checked by the bake or a unit test; **[R]** is a recommendation that a prototype may change; everything else is a decision. TDT computed its tables at R = 3 km; **all numbers here are recomputed for the canonical R = 2,000 m**.

**Canonical scope (lead decision B1, 2026-11-12):** this document is the single source of truth for everything dust-related: chunking, plot ids, stroke encoding, the ledger, robots as ledger operations, dust interest radii, echo/reconciliation, drift checks and the dust chunk payload. [netcode.md](netcode.md) owns only transport and message framing (type ids, FRAME sections, slicing, rate limits) and links here for dust semantics; [data-model.md §3.7/§3.7b](data-model.md) owns the save tables, slot rules and load rule. If another doc disagrees with this one on a dust topic, this one wins and the other is a bug. Ledger rule: [ADR-0026](../adr/0026-dust-ledger-absolute-removal.md).

---

## 0. Key numbers (Standard contract)

| Quantity | Value |
| --- | --- |
| Grid | Icosahedral hex grid GP(128,0) = dual of the level-7 recursive icosphere |
| Plots | **163,842** = 10·4⁷ + 2 = 163,830 hexagons + 12 pentagons |
| Moon radius R | **2,000 m** (Moonlet option: GP(64,0) = 40,962 plots, R = 1,000 m) |
| Surface area | 50.27 km² [D] |
| Mean plot area | **306.8 m²** [D]; mean centre spacing **18.9 m** [D] |
| Horizon distance at 1.7 m eye height | **82.5 m** [D] (√(2·R·h)); 126 m at 4 m; 219 m at 12 m |
| Plot frame (tile + ledger footprint) | **25.6 m × 25.6 m** square in the plot tangent plane |
| Coarse ledger | 32 × 32 × 8 bit = **1 KiB**, texel **0.80 m** (0.64 m²), ≈479 owned texels per plot [D]; texel value in **1/16-level units** (§4.5) |
| Dust per plot | Terrain class → dust level L_P = 5 / 8 / 13 (Highland / Mare / Crater Floor, [progression-and-economy §1.1](../design/progression-and-economy.md)) |
| Client tile | 64² (40 cm texels) or 128² (20 cm texels) RGBA8 |
| Detail ring | 1024²–2048² RGBA8 at 2.0–4.0 cm/texel |
| Height cube map | 6 × 1024² r16uint, ≈3.07 m/texel, 12 MiB (+mips 16 MiB) |
| CDLOD | 6 quadtrees, levels L0–L8 (Ultra L9), 33 × 33 vertex patches, leaf vertex spacing 0.38 m (0.19 m Ultra) |
| Thresholds | **Opened** ≥ 0.1 % of initial dust removed · **Polished** ≤ 1 % remaining (Inspector's Stamp auto-completes the rest) |
| Server sim / snapshots / stroke cadence | `SIM_TICK_HZ` / `SNAPSHOT_HZ` (20 / 10 by default, [netcode.md N4](netcode.md)) / one stroke per active tool per frame interval (`SIM_TICK_HZ / SNAPSHOT_HZ` ticks; 10 Hz at defaults). Nothing in this doc hard-codes a tick count |
| Dust interest radius | Client-declared tile residency radius + 20 m hysteresis (100–240 m, §5.2) |

---

## 1. World frame and constants

| Item | Decision |
| --- | --- |
| Units | metres, seconds, kilograms (Dust Cells and economy count **integer grams** internally) |
| Origin | Moon centre |
| Axes (three.js-compatible, right-handed, Y-up) | **+Y = north pole** (Outpost Boreal), **−Y = south pole** (Outpost Austral), **+X = latitude 0°, longitude 0°** (sub-Earth point), **−Z = latitude 0°, 90°E** (Outpost Dawnside), **+Z = latitude 0°, 90°W** (Outpost Duskside) |
| Gravity | 1.62 m/s² toward the centre (sim-owned constant in `shared/units.ts`) |
| Determinism rule | Grid generation, point→plot, tangent frames, stroke quantisation and ledger rasterisation use only `+ − × ÷ √`, comparisons, `Math.floor/round/min/max/abs` and integer ops. **No `Math.sin/cos/atan/exp/pow`** in those paths (results differ between JS engines in the last bit). The 12 icosahedron vertices are hard-coded as 17-significant-digit literals. |
| Golden hash | `packages/world` exposes a SHA-256 of the quantised grid (centres rounded to 1 µm) and of 1,000 seeded point→plot answers and ledger operations. CI checks the same hash in Node 26, Chromium, Firefox and WebKit (Playwright). |

---

## 2. Plot grid

### 2.1 Counts (verified)

| Level n / GP(m,0) | Plots 10·4ⁿ+2 | Triangles 20·4ⁿ | Edges 30·4ⁿ | Hexagons | Pentagons |
| --- | --- | --- | --- | --- | --- |
| 6 / GP(64,0) Moonlet | 40,962 | 81,920 | 122,880 | 40,950 | 12 |
| **7 / GP(128,0) Standard** | **163,842** | **327,680** | **491,520** | **163,830** | **12** |

Check: 4⁷ = 16,384; 10·16,384 + 2 = 163,842. Euler: 163,842 − 491,520 + 327,680 = 2. Directed neighbour entries: 163,830·6 + 12·5 = **983,040** = 2E. Sources: TDT §1.1, mechanics §4.

### 2.2 Construction (deterministic)

1. Icosahedron on the unit sphere: N = +Y, S = −Y; upper ring U₀…U₄ at latitude +atan(½) ≈ 26.565°, longitudes 0°, 72°, 144°, 216°, 288°; lower ring L₀…L₄ at latitude −26.565°, longitudes 36°, 108°, 180°, 252°, 324°. Longitude 0° is +X; longitude increases toward −Z (east). Coordinates are literals (§1).
2. The 20 faces, grouped into 10 **diamonds** (indices mod 5):
   - North diamond d (d = 0…4): triangles (U_d, N, U_{d+1}) and (U_d, L_d, U_{d+1}); corners U_d, N, U_{d+1}, L_d.
   - South diamond d (d = 5…9 means k = d − 5): triangles (L_k, U_{k+1}, L_{k+1}) and (L_k, S, L_{k+1}); corners L_k, U_{k+1}, L_{k+1}, S.
3. Recursive midpoint subdivision 7 times (great-circle bisection: midpoint = normalise(a + b)). This is the "recursive + normalise" construction of TDT §1.2 (hexagon max/min area 1.30, CV 8.5 %). **Do not** use the one-shot gnomonic construction (2× area spread).
4. Every level-7 vertex is a plot centre. All 327,680 triangles are acute (TDT §1.2), so the Voronoi cell of a vertex covers exactly the triangle regions nearest to it.

### 2.3 Indexing: 10 diamonds × 128² + 2 poles

| Item | Rule |
| --- | --- |
| Diamond lattice | Each diamond owns lattice points (i, j) with 0 ≤ i, j ≤ 127 (16,384 points) |
| North diamond d | Origin U_d = (0,0); **i axis toward N**, **j axis toward L_d**; U_{d+1} = (128,128). Triangle (U_d, N, U_{d+1}) is j ≤ i; triangle (U_d, L_d, U_{d+1}) is j ≥ i |
| South diamond 5+k | Origin L_k = (0,0); **i axis toward U_{k+1}**, **j axis toward S**; L_{k+1} = (128,128). Triangle (L_k, U_{k+1}, L_{k+1}) is j ≤ i; triangle (L_k, S, L_{k+1}) is j ≥ i |
| Barycentric → (i, j) (128-lattice weights β) | North cap face: i = 128(β_N + β_{U_{d+1}}), j = 128·β_{U_{d+1}}. North middle face: i = 128·β_{U_{d+1}}, j = 128(β_{L_d} + β_{U_{d+1}}). South middle face: i = 128(β_{U_{k+1}} + β_{L_{k+1}}), j = 128·β_{L_{k+1}}. South cap face: i = 128·β_{L_{k+1}}, j = 128(β_S + β_{L_{k+1}}) |
| Edge remaps (apply repeatedly until 0 ≤ i, j ≤ 127 or a pole) | North d, i = 128 → north d+1 at (128 − j, 0). North d, j = 128 → south 5+d at (i, 0). South 5+k, i = 128 → north k+1 at (0, j). South 5+k, j = 128 → south 5+(k+1) at (0, 128 − i). North d (128, 0) = N pole. South 5+k (0, 128) = S pole |
| Linear PlotId | **d·16,384 + i·128 + j**; N pole = **163,840**; S pole = **163,841**. Fits 18 bits (2¹⁸ = 262,144) |
| Pentagons | The 12 icosahedron vertices: the 2 poles plus U_d = (north d, 0, 0) and L_k = (south 5+k, 0, 0) |
| Moonlet | Same rules with 64 in place of 128: PlotId = d·4,096 + i·64 + j; poles 40,960 / 40,961 |

### 2.4 Chunks and display IDs

| Item | Rule |
| --- | --- |
| Chunk | (d, i >> 4, j >> 4) → 10 × 8 × 8 = **640 chunks** of 16 × 16 plots (≈300 m across) + **chunk 640** holding the 2 poles. ChunkId = d·64 + (i >> 4)·8 + (j >> 4) |
| Local index | (i & 15)·16 + (j & 15), 0…255 (poles: 0 = N, 1 = S) |
| Player-facing ID | "Plot {chunkId}-{localIndex}", e.g. **Plot 41-207** (matches the naming bible format) |
| Super-regions (map grouping, robot search) | Chunks double as the 641 coarse regions; each keeps a count of non-Polished plots |

### 2.5 Neighbour table

- Built once from the level-7 triangle list (edge set), not from diamond rules, then verified: 163,830 plots with 6 neighbours, 12 with 5, symmetric, total 983,040 entries.
- Stored as `Int32Array(163,842 × 6)` (3.9 MB), slot 6 of a pentagon = −1. **Order:** counter-clockwise around the outward normal, starting with the neighbour whose direction is closest to the plot's local east axis (§2.7). Generation time target (client): ≤ 150 ms in a worker; result cached in IndexedDB keyed by the golden hash.
- Ring queries (Roost coverage: 2 rings = 19 plots, 3 rings = 37 plots) are BFS over this table.
- **Server: precomputed, shared per process (M11).** Plot centres, neighbour table, per-plot class and area arrays are generated at **build time** (a `packages/world` build step) into hash-checked binaries (`grid-128.<contenthash>.bin`, golden hash in the manifest), loaded once at boot and shared **immutably by all rooms**. A room's `onCreate` never builds grid or neighbour tables; it only allocates its own per-room state (§4.3). Boot verifies the hash and refuses to start on mismatch.

### 2.6 Point → plot, O(1)

| Step | Work |
| --- | --- |
| 1. Fast path (moving players, tool heads) | Test the cached previous plot and its 6 neighbours: choose the largest dot(p, centre). Accept if the winner is the cached plot or a neighbour whose own neighbours do not beat it. 7–13 dot products |
| 2. Full path: face | Among the 20 faces pick the largest dot(p, face centroid); confirm with 3 great-circle side tests, else try the 3 adjacent faces |
| 3. Full path: descend | 7 levels; at each level the triangle's edge midpoints are **looked up** (via barycentric → (d, i, j) → PlotId → centre table), not recomputed; 3 side tests pick 1 of 4 children |
| 4. Full path: refine | The answer is the nearest of the final triangle's 3 vertices (valid because every triangle is acute). Ties → lower PlotId |
| Cost | ≈47 dot products (TDT §1.4). Target ≤ 2 µs in Node/V8 |

### 2.7 Tangent frames and plot-local coordinates

- Normal n = plot centre (unit). East e = normalise(Ŷ × n); north t = n × e. Poles: N pole e = +X, t = −Z; S pole e = +X, t = +Z.
- **Plot-local coordinates (u, v)** in metres: gnomonic projection onto the tangent plane at the centre: q = p / dot(p, n) − n; u = R·dot(q, e), v = R·dot(q, t). Inverse: p = normalise(n + (u/R)·e + (v/R)·t). Distortion within ±12.8 m is < 5·10⁻⁵ [D]; the sphere drops 4.1 cm below the plane at 12.8 m [D].
- Wire coordinates: (u, v) as **int16 millimetres** (±32.767 m), which covers the 25.6 m frame plus spill.
- Frames are derived at load (not shipped), identical on server and client by the determinism rule.

### 2.8 Plot area statistics at R = 2,000 m

| Statistic | Value |
| --- | --- |
| Mean (all plots) | 306.8 m² [D] |
| Hexagon spread | max/min ≈ 1.30, CV 8.5 % (TDT §1.2) → ≈266–346 m², σ ≈ 26 m² [D] |
| Mean pentagon | 0.886 × mean hexagon ≈ 272 m² [D] |
| Hexagon width | ≈18.8 m flat-to-flat; corner radius ≈10.9 m mean, **≤11.6 m** largest [D] |
| Edge spacing | centre spacing 18.9 m mean, edge length max/min 1.195 [D] |
| Frame margin | 25.6 m frame half-width 12.8 m ≥ largest corner radius 11.6 m + 1.2 m margin |

The bake prints the measured min/max/CV and fails if the largest corner radius exceeds 12.3 m.
Dust mass scales with each plot's real area (§4.1), so Lumens per m² are the same everywhere (TDT §1.5).

### 2.9 Moonlet variant (later option)

GP(64,0), R = 1,000 m: 40,962 plots, mean area **306.8 m²** (same plot size by construction), horizon 58 m at 1.7 m eye height. Everything in §3–§7 works unchanged except: diamond side 64, chunks 10 × 4 × 4 + 1 = 161, height cube map 512² per face (same 3.07 m texel), CDLOD one level fewer. `gridM` and `radius` are fields of the save header (§6), so one server build supports both.

---

## 3. Terrain

### 3.1 Data source and licensing

| Item | Decision |
| --- | --- |
| Source | **NASA LRO LOLA gridded DEMs only**: `LDEM_16` (5760 × 2880, ≈33 MB) for iteration, `LDEM_64` (23040 × 11520, ≈531 MB) for the release bake. PDS Geosciences Node. ([licensing §1.2](../research/asset-and-data-licensing.md)) |
| Not used | SLDEM2015 / Kaguya merges (JAXA terms unresolved), PGDA MOON_PA products (different frame) |
| Licence | NASA mission data, no licence text; credit requested. Credits screen and `docs/ASSET_LICENSES.md`: **"Elevation: NASA LRO Lunar Orbiter Laser Altimeter (LOLA) Science Team, NASA/GSFC; data via NASA Planetary Data System."** |
| Repo | Raw files in `assets/terrain/raw/` (git-ignored). Only baked derivatives + manifest are committed (ADR-0017) |

### 3.2 Bake pipeline (`tools/terrain-bake`, prose)

1. **Fetch** the `.IMG` + `.LBL` files; record URL, size and SHA-256 in `assets/terrain/manifest.json`.
2. **Decode** using the label's sample type, scaling factor and offset (do not assume); convert to metres above the 1,737.4 km reference sphere.
3. **Reproject** to 6 equal-angle cube faces (§3.4) in the world frame of §1 by area-weighted supersampling (4 × 4 bilinear taps of LDEM_64 per output texel).
4. **Scale and exaggerate** (§3.3): game height = s·(E_low·low + E_high·(h − low)), with s = 2,000 / 1,737,400 = 1/868.7.
5. **Gameplay edits**: flatten the 4 outpost pads (60 m radius, 20 m blend ring); relax any texel steeper than 50° by iterative averaging; clamp the 4 Relay Pad/Railshot sites to ≤ 5° slope.
6. **Validate**: slope histogram and acceptance (§3.3); min/max height; checksum.
7. **Quantise** to uint16: height = offset + value·scale, scale = (max − min)/65,535 (≈2.1 mm at a 140 m range). Write `height-cube-1024.<contenthash>.bin` (6 faces) and a 256² preview `height-cube-256.<contenthash>.bin` for the lobby/Survey Globe.
8. **Per-plot dust class** (§4.1): import `packages/world`, generate the grid, classify every plot, write `plot-dust-class.<contenthash>.bin` (uint8 per plot, 160 KiB).
8b. **Far-occluder horizon map** (rendering-pipeline §5.2): 6 × 512², horizon elevation in 8 azimuths, 2 × RGBA8 (≈ 12 MiB, all presets), occluders < 20 m ignored. Write `horizon-map.<contenthash>.bin`.
9. **Manifest**: sources + hashes, parameters (E_low, E_high, σ, resolution, pad edits, class thresholds and resulting class shares), output file names (content-hashed) and hashes, grid golden hash, credit line. Server and client refuse to start if the manifest hash differs from the save header's `bakeHash` (§6).

**Delivery (M15):** every baked output is **content-hashed in its file name** so it can be cached `immutable`; the client finds them through the manifest, which is served with a short TTL (`vercel.json`). Unhashed names are never published.

### 3.3 Vertical exaggeration

At 1/868.7 scale, the Moon's ~20 km of total relief becomes ~23 m and a 3 km crater wall becomes ~3.5 m: too flat to read (TDT §2.4). Uniform exaggeration would turn real 20–30° walls into cliffs. **Recommendation [R]: two-band exaggeration.**

| Parameter | Value [R] | Effect |
| --- | --- | --- |
| Low-pass σ | 30 km real (≈35 m in game) | Separates basins/maria from crater walls |
| E_low (basins, maria, highlands) | **6** | Total relief ≈ 140 m; the globe silhouette and maria read from orbit |
| E_high (craters, walls, ridges) | **3** | Walls ≈ 10–20 m; slopes tan × 3 |
| Acceptance | ≤ 5 % of surface > 30°, ≤ 1 % > 45° outside crater rims; outpost pads ≤ 3° | If failed, lower E_high in steps of 0.5 (min 2) |

### 3.4 Height cube map: resolution and memory

| Item | Value |
| --- | --- |
| Parametrisation | Equal-angle ("tangent") spherified cube: face by major axis; a = (4/π)·atan(x/major), b likewise; area spread 1.41 (TDT §1.2). Same mapping for mesh and texture |
| Resolution | **1024² per face**, 1-texel gutter (1026²) for seamless manual bilinear across faces; ≈3.07 m mean texel (2.6–3.3 m) [D]. LDEM_16 is 2.18 m/px in game and LDEM_64 0.55 m/px, so both over-sample it |
| GPU format | `r16uint` 2D array texture (6 layers), 4 manual `textureLoad` taps (uint is not filterable; `r16unorm` is not core WebGPU). Mips 512/256/128 built at load by averaging |
| GPU memory | 12.6 MB base + 4.2 MB mips ≈ **16 MiB** |
| CPU memory | Server and client keep the base level as `Uint16Array` (12.6 MB) for the shared height function |
| Download | Row-delta + Brotli, estimate 4–6 MB [R, measure]; 256² preview ≈ 0.3 MB loads first |
| Not chosen | 2048² (48 MiB, needs LDEM_64 for every client and breaks the ≤ 20 MB lobby budget, [browser-feasibility §5](../research/browser-feasibility.md)); real detail below 3 m is procedural |

### 3.5 Ground height function (shared by client, server and GPU)

g(û) = R + H(û), H = H_base + H_detail. Lives in `packages/world` (JS) with a TSL twin in `apps/client/src/terrain` that must match within **±2 cm** (verified by a GPU-readback test at 10,000 seeded points).

| Term | Definition |
| --- | --- |
| H_base | Bilinear sample of the uint16 cube map (§3.4) |
| H_detail: craters | 3 bands of hashed jittered-grid craters in equal-angle face space: cell 4 m (radius 0.5–2 m, p = 0.35), 12 m (2–6 m, p = 0.25), 40 m (6–15 m, p = 0.15). Profile: parabolic bowl depth 0.12·radius, raised rim 0.04·radius, ejecta falloff to 1.6·radius. 3 × 3 cells per band |
| H_detail: noise | 2 octaves of value noise, wavelength 1.5 m (amplitude 0.12 m) and 0.4 m (0.03 m) |
| Hash | 32-bit integer hash (PCG-style) of (face, cellX, cellY, band); identical in JS and TSL (both backends have uint ops) |
| Pads | Detail amplitude × 0 inside the outpost pad radius, smoothstep over the blend ring |
| Rocks/boulders | Instanced meshes, not part of H. Non-colliding for players on the server (cosmetic) |
| Cost | ≈1 µs per evaluation in V8 (4 cube taps + 27 crater cells + 2 noise octaves) |
| Server use | Plausibility only: "not under ground", tool-head-on-ground check, speed caps. **No physics** (tech-stack §1) |
| Slope | Finite differences of H at ±0.25 m in the tangent plane |

### 3.6 CDLOD on the spherified cube

| Item | Decision |
| --- | --- |
| Structure | 6 quadtrees (one per face); node (face, level, x, y); face arc 3,141.6 m [D] |
| Patch | One shared 33 × 33 vertex grid (32 × 32 quads, 2,048 triangles) + 1-vertex skirt ring; Low preset uses 17 × 17 |
| Draws | **One instanced draw per pass** for all selected nodes (instance data: face, node origin a/b, node size, level, morph start/end). Shadow cascades reuse the camera selection clipped to each cascade, one level coarser |
| Height | Vertex shader: (face, a, b) → equal-angle direction → H (§3.5) → position = dir·(R + H) |
| Normals | Per fragment from 4 extra height taps (±½ texel) + procedural detail normal; vertex normals beyond 400 m |

| Level | Node edge [D] | Vertex spacing (33²) [D] | High LOD range (camera distance) [R] |
| --- | --- | --- | --- |
| L9 (Ultra only) | 6.1 m | 0.19 m | 12 m |
| **L8 (leaf)** | 12.3 m | **0.38 m** | 20 m (Ultra 24 m) |
| L7 | 24.5 m | 0.77 m | 40 m |
| L6 | 49 m | 1.53 m | 80 m |
| L5 | 98 m | 3.07 m (= height texel) | 160 m |
| L4 | 196 m | 6.1 m | 320 m |
| L3 | 393 m | 12.3 m | 640 m |
| L2 | 785 m | 24.5 m | 1,280 m |
| L1 | 1,571 m | 49 m | 2,560 m |
| L0 | 3,142 m | 98 m | ∞ (orbit) |

| Item | Decision |
| --- | --- |
| LOD selection | Strugar's single 3-D distance function, ranges doubling per level; presets scale ranges by 0.75 / 1.0 / 1.25 / 1.5 (Low…Ultra) |
| Morph | Last 30 % of each range: morph factor = clamp((dist − 0.7·range)/(0.3·range), 0, 1); odd grid vertices slide to the parent grid. Same distance function on both sides of a face edge → matching levels (TDT §2.3) |
| Skirts | Depth = max(0.3 m, 0.02 × node edge), hides residual cube-edge cracks |
| Culling | Per node: frustum (bounding sphere from node min/max height) + **horizon culling** against the sphere of radius R + H_min_global, using node max height. Min/max per node from a quadtree pyramid of the height map built at load (≈2 MB) |
| Expected load (walking, High) | ≈150–250 nodes before horizon culling, ≈60–120 after [R]; ≤ 0.5 M triangles |
| Precision | JS doubles on the CPU; float32 on the GPU is accurate to **0.12 mm at 2 km** (TDT §2.1). Terrain vertex positions are made camera-relative in the shader (camera position uniform subtracted before projection). **No floating origin, no double emulation, no `highPrecision`** |
| Depth | **Reversed-Z** (`reversedDepthBuffer`), near 0.05 m, far 30 km. If the WebGL2 backend cannot provide it (needs clip-control support), use standard depth with near 0.1 m / far 6 km for surface cameras and a separate orbit camera (near 5 m) — see Open issues |

---

## 4. Dust model

### 4.1 Units and initial dust

| Item | Decision |
| --- | --- |
| Mass unit | kg in UI/events; **integer grams** in sim/ledger/Dust Cells |
| Terrain classes and density | **Canonical in [progression-and-economy §1.1](../design/progression-and-economy.md)** (game-designer, values in `packages/game-data`): Highland dust level **5** (0.310 kg/m²), Mare **8** (0.496 kg/m²), Crater Floor **13** (0.806 kg/m²); moon mean 0.424 kg/m². This doc never restates other values |
| Per-plot class | Baked uint8 class id per plot (§3.2 step 8). Rule [R]: concavity = clamp((mean H on a 120 m ring − H at centre)/8 m, −1, 1); **Crater Floor** if concavity ≥ c₁; else **Mare** if the 30 km low-pass height is below the p-th percentile; else **Highland**. The bake tunes c₁ and p to hit the design shares (55 / 35 / 10 %, outposts ≈90 % Highland) and prints the achieved shares; it fails if any share is off by > 3 points |
| Empty plots | Plots whose centre is within 40 m of an outpost centre (≈16 plots per outpost): class **Empty**, no dust, counts toward the Shine Index, pays nothing |
| Plot mass | M_P = kgPerM2(class_P) · area_P → mean ≈130 kg; whole moon ≈21,310 t (matches the design total) [D] |
| Dust level L_P | L_P = dust level of the plot's class (5 / 8 / 13). A tool's **Depth** D removes D levels per full-coverage pass (design meaning, [progression §1.1](../design/progression-and-economy.md)) |
| Ledger units | Each owned texel holds u_t in **1/16-level units** (u8). Initial u0_P = 16 · L_P = **80 / 128 / 208**. initialUnits_P = u0_P × ownedTexels_P (Highland ≈38,300) |
| Mass per unit | mgPerUnit_P = floor(M_P in mg / initialUnits_P) (Highland mean ≈2,480 mg) [D]. Each actor keeps a milligram accumulator; whole grams go to the Dust Cell, the remainder carries (deterministic, no float) |
| Visual layer depth | D_P = 2.5 cm × L_P / 6.85, clamped 1.5–5 cm (visual only, exaggerated for readability; real regolith dust would be sub-mm) |

### 4.2 Plot states and thresholds

| State (2-bit wire code) | Meaning | Ledger | Display (naming bible) |
| --- | --- | --- | --- |
| 0 **Grimy** | Untouched, or touched below 0.1 % | none, or allocated ("touched") | deep umber |
| 1 **Opened** | removed ≥ ceil(initialUnits/1,000) | allocated | cool cyan |
| 2 **Polished** | remaining ≤ floor(initialUnits/100) → Inspector's Stamp | freed | ivory glow |
| 3 **Empty** | No dust (outpost pads) | none | ivory glow (counts as Polished) |

- **Shine Index** = (Polished + Empty) / plot count.
- Integer comparisons only; 1 unit of one texel ≈ 0.003 % of a Highland plot, so both thresholds resolve cleanly.
- **Reachability guarantee:** because removal never depends on what is left (§4.5), every texel a tool touches with at least C_min coverage loses ≥ 1 unit per stroke, so every plot reaches the Polished threshold with any tool, including the T1 Desk Duster.
- Transitions are monotonic (Grimy → Opened → Polished). Events: `plot.opened` (proposal), `plot.polished` (exists in the catalog).

### 4.3 Server data (in `apps/server/src/world`)

| Structure | Scope | Size |
| --- | --- | --- |
| Per-plot class (`Uint8Array`), area (`Float32Array`) | **process, shared, precomputed** (§2.5) | 160 KiB + 640 KiB |
| Centres (`Float64Array`, 3 per plot), neighbours (`Int32Array`, 6 per plot) | process, shared, precomputed | 3.9 MB + 3.9 MB |
| Height map base (`Uint16Array`) | process, shared | 12.6 MB |
| **Process static total** | once per process, not per room | **≈21 MB** |
| `state: Uint8Array(163,842)` (2-bit state + "touched" flag) | per room | 160 KiB |
| Remaining fraction cache for L0 (`Uint8Array`) | per room | 160 KiB |
| `ledgers: Map<PlotId, Ledger>` for touched/Opened plots: 1,024 B texel units + header (version u32, remainingUnits u32, initialUnits u32, ownedTexels u16, mgPerUnit u32, hash u32, contributions: up to 4 × (actorSlot, units)) | per room | ≈1.1 KiB each |
| Stroke log per touched/Opened plot (ring of the last 256 strokes touching the plot) | per room, **one process-wide RAM cap of 16 MB, LRU** (logs for plots with no player within 300 m for 10 min are trimmed to the 64 most recent) | ≤ 4 KiB each |
| **Per-room totals** | | ≈4–8 MB typical (3,000 Opened); ≤ 40 MB heavy (20,000 Opened, incl. its share of the log cap) |

Ownership mask: ledger texel (a, b), 0 ≤ a, b ≤ 31, covers u ∈ [−12.8 + 0.8a, −12.8 + 0.8(a+1)), v likewise. It is **owned** by plot P if its centre's nearest plot (P vs its 6 neighbours, enough because the frame corner is 18.1 m from the centre while second-ring centres are ≥32 m away [D]) is P. Computed when the ledger is allocated (1,024 × 7 dot products, ≈0.1 ms). Byte index = b·32 + a. Non-owned texels hold 0 and are ignored.

### 4.4 Strokes

**Logical record** (contract `shared/world/stroke.ts`): anchor PlotId; start and end (u, v) in the anchor's frame (int16 mm); width (cm, 10 bits, ≤ 10.23 m); **depth16** (u8: units removed by a full-coverage pass = 16 × effective Depth, §4.5); toolId (6 bits); tick; **actorSlot** (6 bits: players 0–15, 16–63 reserved for vehicles/robots credited to the shift); **inputSeq** (u16, the input that produced it; 0 for robots). `actorSlot` and `inputSeq` are part of the contract (no longer a proposal).

| Topic | Rule |
| --- | --- |
| Who creates strokes | **The server**, from server-side tool-head positions. Clients never send strokes; they send inputs (`toolActive`, aim) per `shared/sim/input.ts` |
| Tool head | `packages/sim` computes a contact point per sim tick from the player's server-side pose, aim, tool reach and a deterministic sweep motion (piecewise-linear "triangle wave" with smoothstep easing; no `Math.sin`). **Sweep phase is derived from `inputSeq`** (phase = (inputSeq − seqAtToolDown) × phaseStep mod period, all integers), so the predicting client and the server produce the same head path from the same inputs (M5). Vehicles: one contact segment per cleaning intake (Trundle drum, Skiff, Bulldust, Behemoth), width from intake width × Wide Mouth level |
| Effective depth | depth16 = min(255, floor(16 × (tool or vehicle Depth + Scour + Master Stroke) × (1 − night penalty))) with values from `packages/game-data`. **Charge** (Static Rake): depth16 = 255 (one pass clears any class, 255 ≥ 208). **Detailing** (Desk Duster RMB): a 0.5 m-diameter disc op with depth16 = 255 — clears any straggler texel it covers by ≥ 31 % (≤ 4.9 levels left) [R, game-designer confirms]. Robots: robot Depth from game-data |
| Cadence | One stroke per frame interval (`SIM_TICK_HZ / SNAPSHOT_HZ` ticks; 10 Hz at defaults): stroke = segment from the contact point one frame interval ago to now. No stroke if the head is > 0.15 m above H, the tool is lifted, or the actor is airborne (Crescent Squeegee **Flick** excepted) |
| Anchor | The plot containing the end point. Endpoints are quantised to mm in the anchor frame **before** any use, so server and predicting client rasterise identical integers |
| Validation (server, per stroke) | (1) tool owned and equipped; (2) Dust Cell below capacity; (3) head within reach + 0.3 m of the server pose; (4) head speed ≤ tool max sweep speed (hand tools 6 m/s, vehicles 1.2 × max vehicle speed); (5) \|head height − H\| ≤ 0.15 m; (6) segment length ≤ 4 m; (7) not on Empty plots (silently skipped); (8) ≤ 1 stroke per tool per frame interval. A failed check drops the stroke and increments a per-player counter (logged once per minute, `ops`) |
| Client prediction | The local client runs the same `packages/sim` + `packages/world` code on its predicted pose: draws the stroke into its tile/ring immediately and predicts its Dust Cell gauge. It keeps **two ledger views**: the *authoritative* copy (only server-echoed or server-relayed strokes and robot chunks are applied) and a *predicted overlay* = authoritative + its own unacknowledged strokes, recomputed for the touched texels whenever an echo arrives. Unacknowledged strokes are kept in a list keyed by `inputSeq` |
| Echo and reconciliation | The server **echoes every accepted stroke to its originator** with `actorSlot` + `inputSeq` (inside the next `FRAME`). The client removes the matching prediction and applies the echo to its authoritative copy (never twice: the echo replaces the prediction). Visuals: if both endpoints are within 30 mm of the prediction the already-drawn stroke stands; otherwise the authoritative stroke is drawn and, if the prediction was rejected (no echo within 1 s) or misplaced, the affected tiles are marked for rebuild (§7.4) |
| Order | Ledger texel results are **order-independent** by construction (§4.5), so clients converge whatever order strokes arrive in. Dust Cell caps and credit are order-dependent, so the server applies ops in a fixed sequence and broadcasts the results (§4.5a); clients never derive economy values themselves |

### 4.5 Coarse ledger rasterisation (exact integer algorithm, `packages/world`; [ADR-0026](../adr/0026-dust-ledger-absolute-removal.md))

The previous rule (remove `floor(d·E/A)` of what is left, clear only at ≥ 90 % cover) is **withdrawn**: it stalled partially covered texels above the 1 % threshold (no plot could be Polished with T1–T3 tools) and it depended on application order. The rule below removes a **state-independent, coverage-weighted amount** with a minimum per pass.

1. **Affected plots:** the anchor plus every neighbour whose 25.6 m frame overlaps the stroke's bounding box (typically 1–3 plots).
2. **Transform** quantised endpoints from the anchor frame to each affected plot's frame via the sphere (§2.7) and round to mm.
3. **Lattice sampling (flat-ended segment):** cover the bounding box with a square lattice of pitch p = clamp(width/8, 25 mm, 100 mm), rounded to whole mm, aligned to the plot frame. A lattice point is inside if its squared distance to the segment's line ≤ (width/2)² **and** its projection parameter t on the segment satisfies 0 ≤ t < 1 (integer/exact double arithmetic, values < 2⁴⁶). Flat ends make consecutive segments of one chain tile the swept area without double counting; round caps are visual only (§7.3). Each inside point deposits p² mm² into the owned ledger texel containing it: C_t = min(A, Σ p²), with A = 640,000 mm² (texel area).
4. **Removal per texel (state-independent):**
   - r_t = floor((depth16 · C_t + A/2) / A) (round to nearest unit; numerator < 2³¹);
   - if C_t ≥ C_min = A/64 = 10,000 mm² then r_t = max(r_t, 1) (**minimum per-pass removal**);
   - u_t ← max(0, u_t − r_t); removed_t = old u_t − new u_t.
5. **Plot totals:** remainingUnits −= Σ removed_t; contributions[actor] += Σ removed_t; state thresholds re-checked (§4.2); ledger version +1; ledger hash updated (§5.5).
6. **Cost [D]:** 60–600 lattice points per stroke (hand ≈100, vehicle ≈600) → ≈5–20 µs in V8. 160 strokes/s (16 players) ≈ 2–3 ms CPU per second.

**Why it works (the math the tests must hold):**

| Property | Argument |
| --- | --- |
| Order independence | r_t depends only on the stroke and the texel geometry, never on u_t. Saturating subtraction of state-independent amounts commutes: max(0, max(0, u − a) − b) = max(0, u − a − b). Any permutation of the same set of ops gives the same bytes |
| Reachability | Every stroke covering ≥ C_min of a texel removes ≥ 1 unit, so any texel reaches 0 after finitely many touches; Polished is reachable with every tool (B2) |
| Matches design Depth | A full-cover pass removes depth16 = 16·D units = D levels. Passes to clear a class = ceil(L_P / D), exactly the design table (Mare at Depth 5: 80 + 48 units → 2 passes; Crater Floor at Depth 5: 3 passes; at Depth 13: 1) |
| Thin tools | Desk Duster (0.15 m, depth16 = 80) crossing a 0.8 m texel covers ≈ 0.12 m² = 18.75 % → removes 15 of 80 units; ≈5.3 adjacent lanes clear a Highland texel, i.e. one full-coverage pass, so pacing follows the design area rate (one Highland plot ≈ 21 min at 0.25 m²/s) |
| Bounded over-collection | Re-scrubbing one thin line drains the texels it crosses at the same grams per stroke as sweeping fresh ground (≤ depth16·C_t/A + 1 unit per texel per stroke), so it cannot farm faster than honest sweeping. The coarse texel may empty before the line is visibly wide; the client then clears that cell visually (ledger-zero clear, §7.3) so economy and visuals agree |

#### 4.5a Server sequencing and op results

Ledger bytes are order-independent, but **Dust Cell acceptance, credit and Polished timing are not**. The server therefore applies all ledger ops of one tick in a fixed order: (1) player strokes by ascending actorSlot, (2) vehicle intakes by ascending vehicle entity id, (3) robot chunks by ascending robot id; each actor's ops in emission order. Dust Cell acceptance (§4.6) is decided per stroke in that order, before the stroke touches the ledger; a rejected stroke is never broadcast. The server then broadcasts the **op results**: accepted strokes and robot chunks (for visuals and ledger replay), authoritative Dust Cell grams per actor (`dust.ack`), changed plot states/remaining (`dust.plots`) and per-chunk ledger hashes (`dust.check`). Clients take every economy value from these results and never from their own replay.

#### 4.5b Test vectors (required before the ledger merges; owner terrain-dust-engineer, reviewed by balance-reviewer)

| # | Test | Pass bar |
| --- | --- | --- |
| V1 | Golden vectors `packages/world/test/vectors/ledger-v1.json`: 1,000 seeded strokes over 20 plots covering T1–T6, Detailing, Charge, every vehicle intake width and robot lanes; expected per-plot ledger SHA-256, remainingUnits and per-actor removed units | Bit-exact in Node 26, Chromium, Firefox and WebKit (CI four-engine job) |
| V2 | Permutation property test: 200 random permutations of the same op set (and random client-side arrival interleavings of own predictions vs echoes) | Identical ledger hashes |
| V3 | Reachability: each tool T1–T6 sweeping a Highland, Mare and Crater Floor plot in realistic lanes (0.75 coverage efficiency, ±5 cm lane jitter, sweep phase from `inputSeq`) | Reaches Polished; stroke count within ±20 % of [progression §4](../design/progression-and-economy.md) times |
| V4 | Over-collection: 200 strokes re-scrubbing one line vs 200 strokes on fresh lanes | Grams collected by the re-scrub ≤ fresh-lane grams |
| V5 | Client two-view model: predicted overlay after all echoes == authoritative copy == server ledger | 100 % hash match in `/bot-test` (S4) |

### 4.6 Collected kg and Dust Cells

- Milligrams collected by a stroke = Σ over affected plots of Σ removed_t × mgPerUnit_P, added to the actor's milligram accumulator; whole grams move to the Dust Cell.
- A stroke is accepted only while the actor's Dust Cell is below capacity (decided in the fixed tick order of §4.5a). Added grams = min(collected, capacity − current). Any excess (at most one stroke's worth) is lost, so the ledger, visuals and gauge stay consistent: **a full Dust Cell stops pickup** (mechanics §2.2).
- The server is authoritative; the client gauge shows server value + predicted unacknowledged grams. GPU readback is never used for economy (TDT §5).
- Events: `dust.collected { actor, grams, plotIds }` per 10 Hz batch.

### 4.7 Inspector's Stamp (auto-complete)

1. When remainingUnits ≤ floor(initialUnits/100), the server sets state **Polished** in the same tick.
2. The residual ≤ 1 % is **not** paid as dust (it never entered a Dust Cell). Instead the Inspector's Stamp bonus (Lumens, `game-data`, scaled by **Stamp Premium**) goes to the shift wallet.
3. Credit: the actor slot with ≥ 50 % of removed levels gets personal credit (Stamp Premium multiplier applies); otherwise "the shift". Robots count as the shift. [R — game-designer confirms.]
4. Ledger and log are freed; the event `plot.polished { plotId, creditedTo, lumens }` triggers the stamp VFX/audio; clients fade the plot's leftover dust to zero over 0.6 s (§7.7).

### 4.8 Robots as ledger operations

Robots never send per-stroke traffic to distant clients (TDT §4.4).

| Topic | Rule |
| --- | --- |
| Work unit | A **lane**: a straight capsule across a plot in its frame, parallel to the plot's u axis, lane spacing = 0.9 × robot width, clipped to the frame |
| Lane plan | At plot start the robot reads the ledger and keeps only lanes that cross owned texels with u > 0 (deterministic, row order v ascending, alternating direction). The plan is fixed at start and travels in `laneMask`, so clients never need the ledger state the robot saw |
| Execution | The server applies each lane in **1-second chunks** (one flat-ended segment per chunk, depth16 from the robot's game-data Depth) through the same rasterisation (§4.5), actor = shift, in the robot slot of the tick order (§4.5a) |
| Intent replication | When a robot starts a plot: `robot.plot { robotId, plotId, startTick, width, depth16, speed, laneMask }` (≈17 B) to clients within the dust interest radius (§5.2); clients animate the robot and replay the same chunks locally into ledger and tiles, keyed by server tick (startTick + k·`SIM_TICK_HZ`), not by their own clock. Because ledger results are order-independent, a client that applies a robot chunk before or after a player stroke ends with the same bytes. Far clients only receive L0 changes |
| Sandpiper / Plover | Work the 19 / 37 plots of their Roost's 2 / 3 rings (neighbour BFS), nearest non-Polished first; idle when all are Polished |
| Albatross | Target = nearest Grimy or Opened plot: BFS over neighbours up to 2,000 visited plots, else jump to the nearest chunk with a non-zero non-Polished count. Bales go to Nests (gameplay-owned) |
| CPU budget | ≈20 µs per chunk → 400 robots ≈ 8 ms CPU/s. The robot scheduler (`apps/server/src/sim`) caps robot ledger ops at **150 chunks/s per process** (≈3 ms CPU/s, the robot row of [netcode.md §15](netcode.md)); above that robots slow down rather than the server lagging |
| When the room is empty | The room may stop (Render spin-down); robots pause. Offline progress is an open design question (§12) |

---

## 5. Sync

### 5.1 Dust messages (bytes channel, `packages/protocol` codec)

**Framing decision (B1):** the per-frame dust records ride as **sections inside the per-client `FRAME`** (one socket write per frame interval; type ids and section order in [netcode.md §4.2](netcode.md)). Bulk and on-demand dust data travel as **separate bytes messages**, sliced to ≤ 4 KB. Bit layouts are fixed in `shared/protocol/messages.ts` by contracts-architect as the first Wave-0 task; the sizes below are the budget the layout must meet.

| Record | Carried as | Direction, rate | Content | Size |
| --- | --- | --- | --- | --- |
| `dust.strokes` | FRAME section | S→C, every frame | Accepted stroke **chains** per actor, including the originator's own strokes (echo with `inputSeq`, §4.4). Chain header = full record (anchor PlotId, start/end int16 mm, width, depth16, toolId, actorSlot, tick offset, inputSeq) ≤ 17 B; continuation = 4 B (actorSlot 6 b, dx 13 b, dy 13 b in mm; same width/depth/tool; tick and inputSeq advance by one frame interval); a new header when the anchor frame changes by > 30 m or parameters change | 4 B per stroke steady state |
| `robot.plot` | FRAME section | S→C, on robot plot start | Robot intent (§4.8) | ≈17 B |
| `dust.ack` | FRAME section | S→C, when changed | Authoritative Dust Cell grams per local actor (also in Self) | 3 B |
| `dust.plots` | FRAME section, every `SNAPSHOT_HZ/2`-th frame (2 Hz at defaults) | S→C | L0 deltas: PlotId 18 b + state 2 b + remaining fraction 8 b + 4 b spare, for every changed plot on the moon | 4 B per changed plot |
| `dust.snapshot` | bytes message (sliced) | S→C, on join / hidden-tab return / resync | Compact world (§5.4), deflated, cached | see §5.4 |
| `dust.ledger` | bytes message | S→C, on interest entry or request | Full ledger of one plot (header + 1,024 B), deflated | ≈300–500 B |
| `dust.log` | bytes message | S→C, on interest entry within 60 m or request | A plot's stroke log as chains | ≈4–5 B per stroke |
| `dust.check` | bytes message | S→C, every 5 s | Per chunk intersecting the client's dust radius: chunkId 10 b + XOR of the per-plot ledger hashes of its Opened plots (32 b). On request, *detail mode*: (PlotId, ledger version, hash) per Opened plot of one chunk | ≈6 B per chunk (typ. 2–8 chunks); detail 10 B per plot |
| `dust.request` | bytes message | C→S, ≤ 1 per 2 s | Up to 8 PlotIds (ledger + log wanted) **or** one chunkId (detail check wanted) | ≤ 34 B |
| `dust_interest` | control message | C→S, on join and on preset change | `{residencyRadiusM}` (clamped 60–220) | ~20 B |

`permessage-deflate` stays **off** (TDT §7); the server compresses the snapshot itself (Node zlib, level 6) at most every 5 s when dirty and caches it.

### 5.2 Interest radii (around each player's server-side position)

| Data | Radius | Plots inside [D] (π r² / 306.8 m²) |
| --- | --- | --- |
| Strokes, robot intents, ledgers (**dust radius**) | client-declared tile residency radius (§7.2) **+ 20 m**: Low 100 m, Medium 140 m, High 180 m, Ultra 240 m; server clamps to 60–240 m | ≈100 / 200 / 330 / 590 |
| Ledgers + stroke logs in the blocking join snapshot | **60 m** | ≈37 |
| `dust.check` | chunks intersecting the dust radius | 2–8 chunks |
| L0 (`dust.plots`) | whole moon | 163,842 |

- **Invariant (M1):** dust radius ≥ residency radius + hysteresis, so every resident tile of an Opened plot has a ledger and receives its strokes. Test: in `/bot-test`, every resident Opened tile of every bot has a ledger whose hash matches the server.
- Hysteresis 20 m. When an Opened plot enters a client's dust radius the server sends its ledger; inside 60 m also its log.
- The sets are produced by the single **`InterestService`** (netcode.md §7) together with the entity sets, on the same 0.5 s staggered schedule.
- Under CPU saturation the server may lower the dust radius to 100 m for everyone (§11); clients then fall back to the mid-field dissolve beyond it.

### 5.3 Rates [D]

| Scenario | Per client in | Server out total |
| --- | --- | --- |
| Typical (4 players, 2 cleaning near each other, 50 robots) | strokes 2 × 10 × 4 B = 80 B/s; L0 ≈150 B/s; checks ≈5 B/s; robot intents ≈20 B/s → **≈0.26 KB/s** | ≈1.0 KB/s ≈ 3.8 MB/h |
| Worst (16 players clustered, all cleaning, incl. own echoes, 400 robots) | strokes 16 × 10 × 4 B = 640 B/s + headers ≈100 B/s; L0 ≈200 B/s; checks ≈10 B/s; robot intents ≈20 B/s → **≈0.97 KB/s** | ≈16 KB/s ≈ **56 MB/h** |
| Budget context | Render 5 GB/month outbound shared with entity snapshots ([platform-limits §A8](../research/tech/platform-limits.md)); worst-case dust alone ≈ 86 h/month of 16-player clustered play |

### 5.4 Join snapshot sizes [D]

| Part | Raw | Compressed (estimate, measure in P2) |
| --- | --- | --- |
| **Blocking part** (`ready` after this) | | |
| Plot states, 2 bits × 163,842 | 40,961 B | 1–10 KB (contiguous regions) |
| Remaining byte per Opened plot (k plots, PlotId order) | k B (typ. 3,000) | ≈2 KB |
| Ledgers of Opened plots within 60 m | typ. 10 × 1.1 KB; worst 37 × 1.1 KB ≈ 41 KB | ≈4 KB / ≈15 KB |
| Stroke logs within 60 m | typ. 10 × 128 × 4.5 B ≈ 6 KB; worst 37 × 256 × 16 B ≈ 152 KB (no chains) | ≈6 KB / ≈50 KB |
| **Blocking total** | typ. ≈60 KB; worst ≈245 KB | **typ. ≈15–25 KB; worst ≈80 KB (bar ≤ 150 KB)** |
| **Streamed part** (after `ready`, nearest-first, ≤ 8 KB/s shared with structures) | | |
| Ledgers of Opened plots between 60 m and the dust radius | typ. 20 × 1.1 KB; worst (Ultra) ≈550 × 1.1 KB | typ. ≈8 KB; worst ≈220 KB (≈30 s at 8 KB/s; tiles use the dissolve fallback until their ledger lands) |

Order: states + remaining first (player may move once these and the ledgers within 60 m arrive), then the streamed ledgers nearest-first. A client returning from a hidden tab requests a fresh snapshot instead of replaying missed deltas ([browser-feasibility §6](../research/browser-feasibility.md)); while hidden it receives no dust sections at all (netcode.md §7, `visibility`).

### 5.5 Consistency

- Clients apply every received stroke and robot chunk to their authoritative ledger copies with the same integer code (§4.5). Results are order-independent, so ledgers stay identical without re-sending, whatever order records arrive in.
- **Drift check (two levels):** each ledger keeps a 32-bit hash of its 1,024 bytes (recomputed on change, ≈1 µs); each chunk keeps the XOR of `mix(plotId, hash)` over its Opened plots (O(1) update). Every 5 s the server sends the chunk hashes for the client's dust radius. A chunk mismatch → client sends `dust.request` for detail mode → per-plot hashes → `dust.request` for the mismatching plots' ledgers → tiles marked for rebuild. This detects ledger drift directly (an L0 checksum would not).
- `PROTOCOL_VERSION` bump on any codec change; golden test vectors in `packages/protocol`; ledger vectors in `packages/world` (§4.5b).

---

## 6. Persistence (Aiven PostgreSQL Free, 1 GB total)

**Canonical storage is [data-model.md §3.7/§3.7b](data-model.md)** (lead decision): per Contract, a header blob in two alternating slots (A/B) plus per-chunk dust rows, each chunk kept in **two versions** stamped with the header `save_seq` that wrote them; header slot and dirty chunk versions are written in **one transaction**, and the load rule picks the newest valid header and, per chunk, the newest version with `save_seq` ≤ that header. Tables, columns, guards, load rule and the capacity policy live there only. This section defines only the **dust chunk payload** (section `DUST_CHUNK` of `shared/save/format.ts`, owner contracts-architect; serialised by `apps/server/src/world`).

Dust chunk payload (one per chunk id 0–640, deflated as a whole):
1. Chunk payload version, chunk id, `bakeHash` check byte.
2. **Plot states** of the chunk's 256 plots (2 bits each; chunk 640: 2 plots) and the remaining-fraction byte of every touched plot. Plot state lives **with its ledger**, so a chunk version is self-consistent on its own.
3. For each touched/Opened plot: local index, ledger version, contributions (≤ 4 × (actorSlot, units)), the 1,024-byte ledger, and up to the **32 most recent** strokes as chains.

The header blob holds no per-plot dust data; L0 and the Shine Index are recomputed from the chunk rows on load (the header keeps a Shine mirror for lists only).

| Size [D, measure in P2] | Value |
| --- | --- |
| Chunk with no touched plots | not stored (pristine) |
| Per Opened plot | ledger ≈200–300 B deflated + 32 strokes ≈150 B → **≈0.4 KB** per version |
| Typical contract (3,000 Opened) | ≈1.2 MB per version, ≈2.4 MB with both chunk versions |
| Heavy contract (20,000 Opened) | ≈8 MB per version → exceeds the per-Contract cap; compaction stage 1 (logs dropped, ≈0.25 KB/plot) applies (data-model §5.1) |
| Database budget | Owned by [data-model.md §4–§5.1](data-model.md) (per-Contract caps, compaction, refusal threshold). This doc sets no quota |

Write policy: dirty chunks only, every ≤ 30 s, on room empty and on SIGTERM; typical 1–20 chunk versions per write. **Dust, Dust Cells, wallet and robot state are written in one transaction** so a crash rolls them back together. Each chunk write overwrites that chunk's older version, so autovacuum must keep up on the 1 GB disk (failure mode §11).

Fine tiles (client atlas) are **never persisted**; clients rebuild them from ledgers + logs (TDT §7).

---

## 7. GPU side (`apps/client/src/terrain`)

### 7.1 Plot data on the GPU

| Texture | Format / size | Memory | Updates |
| --- | --- | --- | --- |
| Plot centres | RGBA32F, 512 × 321 | 2.6 MB | static |
| Neighbour IDs (6 × 18 bits packed) | RGBA32UI, 512 × 321 | 2.6 MB | static |
| **Plot table**: R = L0 remaining (0–255), G = state (2 bits) + flags, B = stamp progress (0–65,535), A = atlas slot (0xFFFF = none) | RGBA16UI (integer texture, `textureLoad`/texelFetch on both backends), 512 × 321 | 1.3 MB | partial row uploads per frame for changed plots |
| Plot-ID cube (nearest plot per texel) | r32uint, 6 × 512² | 6.3 MB | built at load in a worker (≈1.6 M lookups, ≤ 0.5 s, cached in IndexedDB) |

**Per-fragment plot lookup (near field, within the residency radius):** candidate = plot-ID cube texel (≤5.1 m error [D], below the 9.4 m plot inradius) → compare the candidate and its 6 neighbours' centres (7 dot products) → exact plot. Mid field uses the candidate directly. This avoids flat varyings (not verified in TSL) and works on both backends.

### 7.2 Tile atlas: allocation and eviction

| Preset | Slot | Texel | Slots | Atlas | Memory | Residency radius |
| --- | --- | --- | --- | --- | --- | --- |
| Low | 64² | 40 cm | 512 | 2048 × 1024 | 8 MiB | 80 m (≈66 plots) |
| Medium | 64² | 40 cm | 1,024 | 2048² | 16 MiB | 120 m (≈147) |
| High | 128² | 20 cm | 512 | 4096 × 2048 | 32 MiB | 160 m (≈262) |
| Ultra | 128² | 20 cm | 1,024 | 4096² | 64 MiB | 220 m (≈495) |

The per-preset numbers above (slot size, slots, residency radius, rebuild budget) and in §7.5 are informational: **[rendering-pipeline §14](rendering-pipeline.md) is the canonical preset table**; `shared/render/quality.ts` is generated from or checked against it (TAD F2). A change goes to §14 first. The residency radius also sets the client's declared dust radius (§5.2).

| Topic | Rule |
| --- | --- |
| Channels (RGBA8) | **R** remaining dust 0–1 · **G** "unpolish" (1 = never swept; each pass subtracts 0.25·coverage → more passes = shinier clean ground) · **B** "untrampled" (wheel/foot compaction subtracts) · **A** berm pile height (max) |
| Stroke direction (lane stripes, TAD F12) | **Decision (lead, supersedes the earlier "no direction channel" note): lane stripes ARE supported** through an **R8 stroke-direction texture beside the atlas** (same layout and slot addressing; last-pass heading where coverage > 0.5, 8-bit over 360°; client-only, cosmetic, never synced). Medium/High/Ultra only: +4 / 8 / 16 MiB (Low: 0, tonal G bands only). Compute path: written by the same kernel. Fragment path: separate R8 render target, written only where coverage > 0.5. VM-05 covers the whole plot; VT-M1-06 (art-direction / visual-target) |
| Sub-texel strokes (TAD F11) | A stroke narrower than one atlas texel (e.g. 12–15 cm in a 20–40 cm texel) is drawn with **analytic area coverage** (§7.3), so it reduces R proportionally and reads as a faint continuous line, never as broken dots. P2 decides between this, an SDF edge channel and promoting recently stroked plots to a finer tile, using the "12 cm brush at 20 m" capture |
| Who gets a tile | Plots inside the residency radius that are touched, Opened, or Polished-with-a-touched-neighbour. Untouched Grimy plots read R = 1 and Polished/Empty plots without a tile read R = 0 from the plot table — no tile needed |
| Priority | distance to camera, −30 % if outside the view frustum; hysteresis 20 m |
| Eviction | LRU among the farthest; an evicted Opened plot falls back to the mid-field dissolve (§7.8) |
| Slot table | `plot table.slot` (0xFFFF = none); CPU-side free list |
| Rebuild budget per frame | Low 2, Medium 3, High 6, Ultra 10 tiles |

### 7.3 Stroke replay pass

Semantics (identical on both paths, **order-independent**): R ← max(0, R − s·c); G ← max(0, G − 0.25·c); B unchanged by cleaning strokes; A ← max(A, berm profile). c is analytic capsule coverage with a 1-texel anti-aliased edge; **s = min(1, depth16 / (16·L_P))**, the fraction of the plot's initial dust one full-coverage pass removes (Desk Duster on Highland 1.0, on Mare 0.625, on Crater Floor 0.38), so multi-pass terrain visibly thins pass by pass (TAD F10). s·c is **quantised to 1/255 before subtracting**, so sums commute exactly. Berm profile: in a band from w/2 to w/2 + max(0.15 m, 0.3·w) outside the capsule, height ∝ the swept dust (s·D_P), peak at 35 % of the band. Each stroke is drawn into **every resident tile whose 25.6 m frame it overlaps**, so overlapping tile gutters stay identical (no seams).

**Ledger-zero clear (economy ↔ visual consistency, TAD F10):** whenever a plot's authoritative ledger reports a texel at u_t = 0, the client clears that 0.8 m cell in every resident tile (R ← 0 inside the cell with a blue-noise jittered edge, fade 0.3 s; same operation as the stamp, per cell). A texel the economy counts as clean therefore never shows residue, and a Polished plot can never show leftover islands larger than one partially-owned edge cell before the stamp fade (§4.7) removes those too.

| | WebGPU (`webgpu` / `webgpu-compat` backends) | WebGL2 (`webgl2` backend, Tier C) |
| --- | --- | --- |
| Method | **Compute**: one dispatch per frame over a work list of (tile, stroke range); each thread owns one texel and loops over that tile's strokes in arrival order; reads the atlas via `textureLoad`, writes a **scratch** storage texture (rgba8unorm, core storage format), then `copyTextureToTexture` scratch → atlas slot | **Fragment**: rasterise each stroke as a capsule quad into the atlas render target; blend RGB = reverse-subtract (dst − src), alpha = max |
| Why | No atomics needed; analytic coverage; scratch-then-copy avoids read/write hazards and the same-frame storage visibility issue #33795 | No compute on WebGL2; the blend equations give exactly the same commutative result |
| Scratch | 1024² (64 slots of 128²) or 512² (64 of 64²) | none |
| Cost target | ≤ 0.3 ms Tier A / ≤ 0.6 ms Tier B per frame, steady state | same |

P2 must also benchmark the fragment path **on WebGPU**; if it is as fast and looks the same, keep one path (Open issues).

### 7.4 Tile rebuild (join, eviction return, mispredict, resync)

1. **Initialise** each texel from the ledger texel of the plot that owns that point (R = u_t / u0_P; owner via the per-texel nearest-centre test, neighbours' ledgers for the gutter; Grimy → 1, Polished/Empty → 0; ledger-zero cells stay exactly 0), bilinear between ledger centres, then threshold with blue noise so 0.8 m cells never read as squares. G, B = 1; A = 0.
2. **Replay** the strokes from the logs of the plot and its 6 neighbours whose capsules overlap the frame, in log order.
3. Strokes older than the log cap are represented only by the ledger, so old edges come back softer (accepted, TDT §7).
4. Polished plots in the frame get the stamp operation (§7.7).

### 7.5 Detail ring (L3)

| Preset | Size | Texel | Side (radius ≈ half) | Direction R8 |
| --- | --- | --- | --- | --- |
| Low | 1024² | 4.0 cm | 41 m | 1 MiB |
| Medium | 1024² | 3.5 cm | 36 m | 1 MiB |
| High | 2048² | 2.5 cm | 51 m | 4 MiB |
| Ultra | 2048² | 2.0 cm | 41 m | 4 MiB |

- Toroidal addressing in a local tangent plane at a **ring anchor**; re-anchor when the camera is > 100 m from the anchor (scale error < 0.3 %) by one reprojection pass (≈0.3 ms, rare).
- Newly exposed strips are initialised from the atlas (or plot table) by one fragment pass.
- Channels: R remaining dust, G unpolish, B untrampled (all reverse-subtract), **A footprint/track depth (max)**. Updated by rasterisation + blending on **both** backends.
- Strokes inside the ring are drawn into both ring and atlas. Shading uses the ring inside its radius (2 m cross-fade at the edge) and the atlas outside.
- **R8 direction texture beside the ring** (1 / 1 / 4 / 4 MiB, all presets): carries stroke heading and boot-print heading for the tread stamp (§7.6) and lane stripes (§7.2). Client-only, cosmetic.
- Per-preset sizes above: [rendering-pipeline §14](rendering-pipeline.md) is the canonical preset table; `quality.ts` is generated from or checked against it (TAD F2).
- **Ring-edge handoff test (TAD F11, V1 in P2; VT-M1-05b):** a Lane Broom stroke crossing the ring edge, captured at the preset's ladder distances: width changes by ≤ 1 px and berm delta by ≤ 20 % across the cross-fade; a Desk Duster stroke stays continuous with mean luma change ≤ 15 % (a 1 px width bar is not achievable for a sub-texel Desk Duster stroke in the atlas). Target edge width ≤ 2 cm world inside the ring (1-texel reconstruction floor; art-direction/visual-target hold the reconciled number).

### 7.6 Footprints and wheel tracks: **ring, not decals**

| Item | Rule |
| --- | --- |
| Source | Local, from foot-plant events (animation) and wheel contacts (vehicle visuals) of **all** visible players and vehicles, generated from replicated motion. **No bandwidth, not synced, not persisted** |
| Boot print | Sprite stamp: depth 1.5 cm visual (A on grime), compaction −0.3 on B. **Tread detail is a normal-map stamp** (small tileable chevron normal map, blended by the print mask in the terrain shader), so lug detail (1–2 cm) does not depend on the 2–4 cm ring texel (TAD F13) |
| Wheel track | Continuous capsule chain per wheel: depth 2 cm, B −0.4, tread stripes procedural along the track (same normal-stamp approach) |
| Coarse bake | Wheel tracks are also drawn into resident atlas tiles' B channel (20–40 cm), so Carryall tracks survive leaving the ring until tile eviction |
| Lifetimes (per channel, TAD F13) | **Grime prints (A channel, on dust):** stay until the ring scrolls past them or the preset lifetime ends (60 / 120 / 300 / 600 s, Low…Ultra). **Clean-ground prints (B channel compaction on clean ground):** fade in 30 s. Lifetimes: rendering-pipeline §14 is canonical (`quality.ts` generated from or checked against it); art-direction owns the look |
| Fade arithmetic | **Subtractive with stochastic rounding**: once per second each channel loses (255 / lifetime_s) code values, with the fractional part applied as +1 when a world-hashed per-texel random < fraction. Values always reach 0 (a multiplicative fade on 8 bits stalls, e.g. 50 × 0.99 rounds back to 50) |
| Why not decals | No draw calls, works on deforming dust, identical on both backends, shares the dust shading |

### 7.7 Dust-layer shading (terrain fragment shader hooks; look owned by technical-artist)

| Element | Rule |
| --- | --- |
| Presence mask (crisp edges) | m = smoothstep(−w, +w, R − τ), τ = 0.04 + 0.08·h_eff, h_eff = mix(h, 0.5, f), where h is the normalised 1–5 cm regolith detail height (peaks clean first) and f → 1 when the detail is sub-pixel; w from screen-space derivatives with a floor of ≥ 1 output px. Any R above ≈0.1 reads as dust with **crisp, natural noisy edges** (TDT §6); R = 0 is clean |
| Thickness (progressive thinning, TAD F10) | Dust opacity t = m · (0.35 + 0.65·R): albedo = mix(clean, grime, t), roughness = mix(clean, grime, t). R = 1 → full grime, R ≈ 0.4 (Mare after one Depth-5 pass) → visibly thinner, lighter dust, R = 0 → clean. The luma ramp over R is **monotonic** with no speckle (the relief height only moves the edge, never the interior; expected ramp 182/161/151/137/119) |
| Layer height | h = t·D_P + berm, berm = A·R_local + k·\|∇R_blurred\|·R (the **mask-gradient berm** rides on the dusty side of every edge and **scales with R**, so a thinned layer has a lower lip) |
| Normals | Perturbed from the gradient of h: 4 extra atlas/ring taps on High/Ultra, screen derivatives on Low/Medium. High/Ultra also displace leaf vertices within 10 m by h |
| Grime (dusty) | albedo ≈**0.085** linear (art-direction §3.2 is the single source, TAD F1), roughness 0.95, opposition-surge/backscatter term, **matte, no sparkle** |
| Clean ground | albedo ≈**0.34** linear (≈4× grime, art-direction §3.2), roughness = mix(0.62, 0.82, G) (art-direction §3.2), faint specular, **sparkle** (glassy beads): cell and fade per rendering-pipeline §14 (1 cm / 15–25 m on High/Ultra; 2 cm / 8–12 m on Low/Medium), stable under TRAA; clamp ≤ 4× diffuse and ≤ 0.6 × bloom threshold 4.0 |
| Edge read | Berm lit side brightens, shadow side darkens → the stepped lip of the reference stroke (visual-analysis §2.1). **Readability targets (art-direction §2.3; 8-bit sRGB luma after AgX in capture mode): noon ratio ≥ 1.45 and clean − grime ≥ 50 codes** (4× albedo gives 1.53 / 63; AgX is log-domain, so a 1.9 ratio is not reachable). Calibrate with AgX on (visual-target VT-M0-06/08) |
| Thinning checks (TAD F10) | See **VT-M1-34** (visual-target): monotonic ramp with step ≥ 8 codes, ledger agreement ±10 points, no island > 0.5 m² |
| Inspector's Stamp | Shader multiplies R by (1 − stamp progress) for fragments of the stamping plot; after 0.6 s the stamp operation (rasterise the plot's hexagon, edge jittered ±0.3 m by noise, R −= 1) is applied to every resident tile overlapping it |
| Plot Card (key G) | Outline where the distance difference between the nearest and second-nearest plot centre < 8 cm; the scanned plot's 32 × 32 ledger is uploaded as a tiny r8 texture and texels with dust left glow faintly ("what's left" highlight) |

### 7.8 Mid field, orbit and Survey Globe coverage

| View | Source | Look |
| --- | --- | --- |
| Beyond residency radius (jetpack heights, crater rims) | plot table via plot-ID cube candidate | Opened: procedural dissolve, coverage = smoothstep against plot-seeded 2 m noise at the plot's L0 fraction (P1 style); Grimy = dust; Polished/Empty = clean |
| Orbit / high altitude | level-7 icosphere proxy (163,842 vertices = plot centres, 327,680 triangles), vertex attribute = PlotId, colour from the plot table in the vertex shader | Smooth coverage field; only changed plot-table rows are uploaded (TDT §6) |
| Survey Globe (map) | same proxy; optional **hex mode** built lazily: non-indexed triangles carrying the 3 corner PlotIds + barycentrics, fragment picks the largest barycentric (≈16 MB, not on Low) | Naming-bible colours: Grimy deep umber, Opened cool cyan, Polished ivory glow; plot outlines when zoomed |

---

## 8. Module ownership mapping (per [module-boundaries.md](module-boundaries.md))

| Piece | Path | Owner |
| --- | --- | --- |
| Grid generation, indexing, point→plot, neighbours, frames, height function, ledger rasterisation, stroke quantisation, robot lane math | `packages/world` | terrain-dust-engineer |
| Tool-head motion, Dust Cell rules, robot behaviour/state | `packages/sim` | gameplay-systems-engineer |
| Authoritative dust state, tick sequencing of ledger ops (§4.5a), snapshot cache, chunk hashes, dust chunk payload serialisation | `apps/server/src/world` | terrain-dust-engineer |
| `InterestService` (entity **and** dust sets, horizon-aware) | `apps/server/src/net` | netcode-engineer |
| Robot scheduling budget | `apps/server/src/sim` | gameplay-systems-engineer |
| Codecs (chains, deltas, snapshot), test vectors | `packages/protocol` | netcode-engineer |
| DB tables, write coalescing | `packages/db`, `apps/server/src/persistence` | backend-data-engineer |
| CDLOD, atlas, replay, ring, footprints, orbit coverage | `apps/client/src/terrain` | terrain-dust-engineer |
| Regolith/dust look (albedo, sparkle, backscatter) | `apps/client/src/visuals` | technical-artist |
| LOLA bake | `tools/terrain-bake`, `assets/terrain` | terrain-dust-engineer |

**Contract items** (for contracts-architect, first Wave-0 task): stroke record of §4.4 (incl. `actorSlot`, `inputSeq`, `depth16`); dust records of §5.1 inside the single `protocol/messages.ts` catalog; `DUST_CHUNK` save section of §6 (tables per data-model §3.7b); plot state enum incl. Empty; dust class enum; `plot.opened` event; quality knobs of §7.2/§7.5/§7.6 in `render/quality.ts`.

---

## 9. Performance budget

| Area | Tier A (discrete) | Tier B (integrated) | Server (0.1 CPU) |
| --- | --- | --- | --- |
| Dust GPU (replay + ring + rebuilds), per frame | ≤ 0.5 ms | ≤ 1.0 ms | — |
| Terrain GPU (main pass incl. dust shading) | ≤ 3.0 ms | ≤ 7.0 ms | — |
| Dust/terrain client CPU per frame (CDLOD select, ledger prediction, decode, atlas mgmt) | ≤ 0.8 ms | ≤ 1.5 ms | — |
| Dust + terrain GPU memory (atlas + scratch + ring + height 16 MiB + plot data 12.8 MiB) | Ultra ≈ **129 MiB**, High ≈ **105 MiB** | Medium ≈ **67 MiB**, Low ≈ **55 MiB** | — |
| Survey Globe hex mode (lazy, not on Low) | +16 MiB | +16 MiB (Medium) | — |
| Server dust CPU | — | — | ≤ 8 ms per second (8 % of 0.1 CPU) incl. robots (robot ops capped at ≈3 ms/s); p99 stroke ≤ 0.2 ms |
| Server dust RAM | — | — | ≈21 MB static per process (shared) + ≈4–8 MB per room typical, ≤ 40 MB per room heavy |
| Bandwidth per client | ≤ 1 KB/s worst, ≈0.3 KB/s typical | same | ≤ 16 KB/s total worst |

---

## 10. Prototype contest (competing-approach rule, `prototypes/dust-sim/`)

All three share: the grid and height function from §2–§3, T1 terrain (§3.6), the same bot harness, scene, seed and camera paths.

| | **P1 scalar + procedural** (`p1-scalar-procedural`) | **P2 strokes + atlas + ledger** (`p2-stroke-atlas-ledger`, **preferred**) | **P3 client-painted, min-merge** (`p3-client-paint-minmerge`) |
| --- | --- | --- | --- |
| Server state | L0 scalar only | L0 + ledgers + capped logs (this doc) | L0 + opaque per-plot tile blobs (64² 4-bit, per-texel minimum merge) |
| Client visuals | Procedural dissolve from L0 + ring | Tiles from strokes + ring + stamp fade | Tiles painted locally with any brush; changed tile regions uploaded |
| Scoring authority | Server, assumes uniform dust (exploitable by re-scrubbing) | **Server ledger, exact at 0.8 m** | Client-reported, server only bounds-checks |
| Must prove | Lowest cost; whether non-persistent trails are acceptable | Crisp consistent trails on 16 bot clients; mid-game join; Inspector's Stamp; restore after spin-down; robots as intent; determinism hash | Brush freedom; conflict-free merge; bandwidth and storage of tile deltas |
| Expected risk | Visual/design disappointment | Determinism edge cases; log caps | Bandwidth, persistence size, cheating |

**Benchmark protocol** (lead fixes harness; performance-reviewer + visual-qa-reviewer run it; extends TDT §8):

| # | Scenario | Duration | Measured | Pass bar (P2 must meet) |
| --- | --- | --- | --- | --- |
| S1 | Walk path, 1.7 m eye, sun at 5° and 45°, one player cleaning with Desk Duster then Bristle Broom | 3 min | GPU ms per pass (timestamps; frame delta where unavailable), edge width px at 2/10/50 m | Dust GPU ≤ 0.5 ms A / ≤ 1.0 ms B; edge ≤ 2 px at 2 m |
| S2 | Skiff + Bulldust at 20 m/s across 30 plots | 2 min | Replay cost, tile churn, rebuild stalls | No frame > 2× target from tile work |
| S3 | Survey Globe / orbit spin | 1 min | Orbit readability (testers identify cleaned regions from orbit), upload cost | ≥ 80 % correct identification |
| S4 | 16 headless bots clustered, all cleaning | 10 min | Server CPU (0.1-CPU cgroup), event-loop lag p99, bytes/s per client, client ledger hash == server | lag p99 ≤ 20 ms; ≤ 1.2 KB/s per client; 100 % hash match |
| S5 | 400 robots (mixed) + 4 bots | 30 min | Server CPU and RAM, intent bytes | ≤ 10 % of 0.1 CPU for dust; RSS ≤ 300 MB |
| S6 | Forced restart mid-session; restore from PostgreSQL | — | Data loss window, restore time, visual diff after restore | ≤ 30 s lost; consistent wallet/dust |
| S7 | Late join after 30 min of S4 | — | Snapshot bytes (blocking and streamed), time to playable, tile rebuild time | Blocking part ≤ 150 KB; playable ≤ 3 s after connect |
| S9 | Ledger rules (§4.5b V1–V5) | — | Golden vectors, permutations, reachability per tool, over-collection | All pass; reachability within ±20 % of design times |
| S8 | Both backends (WebGPU, `forceWebGL`) on Tier A and Tier B reference GPUs | all above | Parity screenshots | No visible difference in trails beyond 1 texel |

Visual judgement: blind A/B screenshot pairs from fixed bookmarks (10 testers), hexagon-outline visibility after stamps, the readability ratio of rendering-pipeline §19.
**Decision rule:** P2 wins unless it misses a server bar by > 2× where P1 meets it, or loses the blind visual test to P3 by > 60/40 while P3 stays within bandwidth/storage bars. The lead records the result as an ADR.

---

## 11. Failure modes

| Failure | Detection | Handling |
| --- | --- | --- |
| Render restart / spin-down mid-session | WebSocket close | Clients show "waking the server"; reconnect; snapshot; ≤ 30 s of dust and Dust Cell progress rolled back together (single transaction) |
| Client ledger diverges | `dust.check` chunk hash mismatch → detail mode | Fetch mismatching ledgers, rebuild tiles; count in telemetry (should be 0: ledger results are order-independent) |
| Mispredicted stroke | No matching echo within 1 s / endpoints > 30 mm off | Tile rebuild from authoritative log |
| Atlas full | Free list empty | Evict farthest; far plots use dissolve fallback |
| Log cap reached | Log length = cap | Older edges soften after rebuild (accepted) |
| GPU device lost / WebGL context lost | `device.lost` / context event | Recreate renderer; rebuild atlas from CPU-side ledgers + logs (all kept on the CPU) |
| Bandwidth spike (robots near many clients) | bandwidth counters (`ops`) | Robot intents only within each client's dust radius; scheduler caps |
| Determinism break between engines | CI golden hash on 4 engines (grid + ledger vectors) | Block merge |
| DB near 1 GB | storage metric | Capacity policy of data-model §5.1 (per-Contract caps, compaction, refuse new Contracts above 800 MB) |
| Autovacuum lag from chunk rewrites | table bloat metric | Two versions per chunk overwritten alternately, ≤ 30 s cadence, explicit VACUUM on room close if bloat > 30 % |
| Newest header slot corrupt | CRC on load | Load rule of data-model §3.7b: older header + chunk versions with `save_seq` ≤ it; never mixes newer chunk versions with an older header |
| Server CPU saturation | event-loop lag > 50 ms | Shed robot ops first, then lower stroke interest radius to 100 m |
| Height mismatch GPU vs JS | readback test | Fix TSL twin; tolerance ±2 cm |

---

## 12. Open issues and risks

Contradictions keep the canonical decision; items here need a lead/owner decision.

| # | Issue | Canonical decision kept | Note |
| --- | --- | --- | --- |
| 1 | TDT sized everything at R = 3 km; mechanics §4 and the contract say 2 km | **R = 2,000 m** | All numbers recomputed |
| 2 | TDT §7 plans MySQL persistence | **PostgreSQL** (tech-stack) | Aiven MySQL free retired |
| 3 | TDT §6 makes dusty ground bright and clean ground darker; art direction wants bright clean vs darker grime | **Art direction** | Matches LROC "smoothed = brighter at low phase" (visual-analysis 3.17) |
| 4 | `rg8unorm` storage is not core WebGPU | RGBA8 atlas with scratch + copy | Doubles memory vs RG8; revisit if `texture-formats-tier1` is common |
| 5 | Compute vs fragment replay on WebGPU | Compute primary (canonical) | If P2 shows parity, collapse to one fragment path via an ADR |
| 6 | Per-plot tiles need a per-fragment plot lookup (≈10 texture loads in the near field) | Per-plot atlas (canonical) | Alternative: cube-face pages (no lookup); only via ADR if lookup cost > 0.3 ms on Tier B |
| 7 | Reversed-Z on the WebGL2 backend needs clip-control support | Reversed-Z | Verify in M0; fallback in §3.6 |
| 8 | Visual-analysis wants ≤ 2 cm dust texels on High | High ring 2.5 cm, Ultra 2.0 cm | Memory/coverage trade-off |
| 9 | Coarse ledger (0.8 m) vs tiny Desk Duster (~0.15 m) | Ledger 32 × 32 × 8 bit, absolute coverage-weighted removal with a minimum per pass (§4.5, ADR-0026) | **Resolved 2026-11-12.** Polished reachable with every tool; results order-independent; over-collection cannot beat honest sweeping; ledger-zero clear keeps visuals consistent |
| 10 | Residual ≤ 1 % at the stamp is not paid as dust; credit rule | §4.7 [R] | game-designer to confirm |
| 11 | Robots pause when the room stops; no offline progress | Server runs only while a room is live | Design decision: analytic catch-up on load (capped) or none |
| 12 | Two-band exaggeration values | E_low 6, E_high 3 [R] | Tune with the slope acceptance test and playtests |
| 13 | Dust density per class | **Resolved:** progression-and-economy §1.1 is canonical (0.310 / 0.496 / 0.806 kg/m²) | Balance owned by game-designer (`tools/balance-sim`) |
| 14 | `inputSeq`/`actorSlot` not in the stroke contract | **Resolved:** part of the stroke record (§4.4) | contracts-architect writes it in the first Wave-0 task |
| 16 | Dust class thresholds (concavity c₁, low-pass percentile p) | Bake tunes them to the design shares | game-designer confirms the 55 / 35 / 10 % targets per region |
| 17 | Detailing as a depth-255 disc op | §4.4 [R] | game-designer confirms it feels like "scrub to zero" on stragglers |
| 15 | Fan-sourced reference numbers (163,842, 0.1 %, ≤ 1 %, 2 km) | Used as design targets | They are our design now, not claims about the reference game |

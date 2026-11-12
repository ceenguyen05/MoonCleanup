# Visual target — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Accepted for build (planning session 2026-11-12)** · Owner: technical-artist · Reviewed by: visual-qa-reviewer · Changes via PR that names the VT IDs it changes.
Companion docs: [`art-direction.md`](art-direction.md) (what things look like) · [`audio-direction.md`](audio-direction.md) · [`naming-bible.md`](naming-bible.md) (all names) · evidence in [`../research/visual-analysis.md`](../research/visual-analysis.md), [`../research/browser-feasibility.md`](../research/browser-feasibility.md), [`../architecture/tech-stack.md`](../architecture/tech-stack.md).

**Direction in one line:** *bright, readable stylized realism.* The game has to be as approachable, bright and instantly readable as Moon Sweepers, and its screenshots have to hold up next to theirs. It gets there with its own identity: real lunar light (black sky, one hard sun, Earth and earthshine, stars), dark grimy dust against bright clean ground with crisp raised berms, friendly chunky Brightside hardware, slightly stylized (not chibi) custodians and a premium glassy UI.

**"Looks like a cheap browser game" is a failed build.** Every item below can be checked from a screenshot or a capture made with the protocol in §6.

---

## 1. Reference board (LINKS ONLY)

Rules: never download, embed, trace, re-host or commit reference images or video. Never paint over them. Link them in review files. Comparison is done by **viewing** the link in a browser next to our capture (§2.6); measurable checks run on our captures only. "[F]" means the page was fetched during research, "[S]" means it was seen in search results, and "[K]" means a well-known URL that was not re-verified. Check [S] and [K] links before you rely on them.

### 1.1 Moon Sweepers (DragDrop Games, Steam app 5335510): the bar we must match or beat

| # | Link | What to compare | Comparator scene (§6.2) |
|---|---|---|---|
| Store | https://store.steampowered.com/app/5335510/Moon_Sweepers/ [F] | Overall appeal, store-capsule readability | — |
| Media JSON | https://store.steampowered.com/api/appdetails?appids=5335510&l=english [F] | Lists all official media | — |
| SS-01 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/6985c316ef6f0988ea33b17954c097268134e3d1/ss_6985c316ef6f0988ea33b17954c097268134e3d1.1920x1080.jpg | Hero character, Earth, base | S10 |
| SS-02 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/76c76f72cc035c7e0fc49ea971e0bf1c6e1ba6fa/ss_76c76f72cc035c7e0fc49ea971e0bf1c6e1ba6fa.1920x1080.jpg | First-person clean strip, long shadow | **CMP-02** |
| SS-03 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/20a903f07aa2753cc99f11e26f08784f52ce5560/ss_20a903f07aa2753cc99f11e26f08784f52ce5560.1920x1080.jpg | Co-op jump, ride-on cleaner, sun disk | **CMP-03** |
| SS-04 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/63b9ea049e9f963379a0c671043965a8241818f9/ss_63b9ea049e9f963379a0c671043965a8241818f9.1920x1080.jpg | Vehicle + modules + large Earth | **CMP-04** |
| SS-05 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/86c13ff24fc6eea6b8199b88a0fe3a6a6009febb/ss_86c13ff24fc6eea6b8199b88a0fe3a6a6009febb.1920x1080.jpg | Top-down stroke, layer lip at 1:1 | **CMP-05** |
| SS-06 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/e9fe23641e5bf08387202dcfabf5450a6a0c5de2/ss_e9fe23641e5bf08387202dcfabf5450a6a0c5de2.1920x1080.jpg | Logistics network readability | S16 |
| SS-07 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/dfa019b7d256412ddd4db7349da5c41d6e4407c6/ss_dfa019b7d256412ddd4db7349da5c41d6e4407c6.1920x1080.jpg | Elevated overview of cleaned ground | **CMP-07** |
| SS-08 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/e6a6a9f0cbc3e69d7e29091bc7dae19ba4727076/ss_e6a6a9f0cbc3e69d7e29091bc7dae19ba4727076.1920x1080.jpg | Walk-behind machine, debris particles | S09 |
| SS-09 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/cdc8a6a06cf8d682b5e9b5cd2d740feb913bba2b/ss_cdc8a6a06cf8d682b5e9b5cd2d740feb913bba2b.1920x1080.jpg | Large vehicle, hill shadow | **CMP-09** |
| SS-10 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/bbba14e5a9ccae08e2bededc277afba9e3962095/ss_bbba14e5a9ccae08e2bededc277afba9e3962095.1920x1080.jpg | Solar + processing hardware | S16 |
| SS-11 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/97f7ee1528784482fe81959261e1763fccede379/ss_97f7ee1528784482fe81959261e1763fccede379.1920x1080.jpg | Solar farm, sky treatment | S16 |
| SS-12 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/991b71b20ad8ef79568f368fc1e345a1145bc484/ss_991b71b20ad8ef79568f368fc1e345a1145bc484.1920x1080.jpg | HQ exterior, color-coded players | S10 |
| SS-13 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/612ddb269880245e448d346a7cb25ae2bf6237c6/ss_612ddb269880245e448d346a7cb25ae2bf6237c6.1920x1080.jpg | Interior, hologram moon | S11 |
| SS-14 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/6f2a63a4eff7c0623e98b8e2729584c00e0b7a63/ss_6f2a63a4eff7c0623e98b8e2729584c00e0b7a63.1920x1080.jpg | Diegetic progress console | S12 |
| SS-15 | https://shared.akamai.steamstatic.com/store_item_assets/steam/apps/5335510/ca461417b7dd6a6a4953a1723e29c1daf59ae2f1/ss_ca461417b7dd6a6a4953a1723e29c1daf59ae2f1.1920x1080.jpg | Orbit/map view of the moon | **CMP-15** |
| Teaser | https://video.akamai.steamstatic.com/store_trailers/5335510/784761556/7f2635011f003ecf63a4665d7277f9f6d33d67ef/1792140508/hls_264_master.m3u8 [F, not viewed] | Motion, particles, camera feel | P-series captures |
| Trailer | https://video.akamai.steamstatic.com/store_trailers/5335510/342788504/9486723f18c0b96095e59ab99919138b85a4cf77/1791452192/hls_264_master.m3u8 [F, not viewed] | Motion, VFX timing | P-series captures |
| News hub | https://store.steampowered.com/news/app/5335510 [K] | Devlogs and patch visuals | — |

**What we take from it:** clean has to read as brighter at once, stroke feedback is instant, silhouettes are strong, player identity comes through color, and the scene is a cheerful high-key world.
**How to use the reference:** broad style, familiar equipment, palette families, brush-width paths and readable
worksite composition are intentional targets. Author our own assets/UI/text/branding; no extracted reference content.
The old blanket visual exclusions are retired. See [REFERENCE_TARGET](REFERENCE_TARGET.md) for RF checks and exact
style-dependent VT precedence; numerical artifact/performance/usability checks still apply.

### 1.2 Roblox moon-cleaning games (genre context only; thumbnails not yet inspected)

| Game | Link | Note |
|---|---|---|
| Sweep The Moon | https://www.roblox.com/games/109576450376407/Sweep-The-Moon [S] | Tile-quantized cleaning. Our continuous mask has to beat it at a glance |
| Clean The Moon! (Lunarlit Works) | https://www.roblox.com/games/76678170614451/Clean-the-Moon [S] | Incremental and robots |
| Clean The Moon! (StaticStudios6) | https://www.roblox.com/games/78086118798161/Clean-the-Moon [S] | Vehicles, pets |
| Clean THE Moon | https://www.roblox.com/games/73695758197534/Clean-THE-Moon [S] | — |

### 1.3 NASA / Apollo / LRO references (truth for light and material)

| Reference | Link | Use it for |
|---|---|---|
| Clementine near-side albedo (PIA00302) | https://photojournal.jpl.nasa.gov/catalog/PIA00302 [S] | Maria vs highlands macro albedo pattern on clean ground |
| LROC "First Look at the Apollo Landing Sites" | https://lroc.im-ldi.com/posts/157 (alt. https://www.lroc.asu.edu/images/157) [S] | Bright "blast zones" (disturbed ground reads brighter) and tracks |
| NASA Apollo 11 landing site | https://science.nasa.gov/resource/apollo-11-landing-site [S] | Site context |
| LRO view of Apollo 12 / Surveyor 3 | https://www.nasa.gov/missions/lunar-reconnaissance-orbiter-looks-at-apollo-12-surveyor-3-landing-sites/ [S] | Tracks from orbit |
| Apollo 11 EVA transcript (Spacelog) | https://apollo11.spacelog.org/04:13:20:38/04:13:44:28 [S] | Footprint depth, "powdered charcoal" dust |
| Project Apollo Archive (Flickr) | https://www.flickr.com/photos/projectapolloarchive/ [K] | Hard sun, ground bounce, black sky, suits |
| NASA Image and Video Library | https://images.nasa.gov/ [K] | Search AS11-40-5903 (bounce fill), AS11-40-5878 (bootprint), AS08-14-2383 (Earthrise) |
| Apollo Lunar Surface Journal | https://www.hq.nasa.gov/alsj/ [K] | Rover rooster tails, dust behavior |
| NASA SVS CGI Moon Kit | https://svs.gsfc.nasa.gov/4720 [K] | Survey Globe colour and relief (approved source) |
| NASA Moon Trek | https://trek.nasa.gov/moon/ [K] | Survey Points locations |
| NASA Eyes on the Solar System | https://eyes.nasa.gov/ [K] | Browser space-viz quality bar |
| NVIDIA UE4 Apollo 11 demo (2014) | https://www.unrealengine.com/blog/download-ue4-apollo-demo-maxwell-gpus [S] | Ground-bounce shadow fill |
| NVIDIA RTX Apollo remake (2019) | https://www.tomshardware.com/news/apollo-11-moon-landing-anniversary-nvidia-ray-tracing,39980.html [S] | Same, ray-traced |

### 1.4 Best-in-class browser (WebGPU) references

The live URL pattern is `https://threejs.org/examples/#<name>`. The names were verified in the r187 examples index (see [`rendering-case-threejs.md` §3](../research/tech/rendering-case-threejs.md)). The live site tracks the latest three.js, so compare *quality*, not API.

| Example | What it proves for us |
|---|---|
| `webgpu_shadowmap_csm`, `webgpu_lights_sunlight` | Cascaded hard sun shadows |
| `webgpu_tonemapping`, `webgpu_color_grading` | AgX/ACES/Neutral, grading |
| `webgpu_postprocessing_ao`, `webgpu_postprocessing_bloom_selective` | GTAO, selective bloom |
| `webgpu_postprocessing_traa`, `webgpu_postprocessing_smaa`, `webgpu_upscaling_taau`, `webgpu_upscaling_fsr1` | AA and upscaling per preset |
| `webgpu_compute_particles_snow`, `webgpu_particles_soft` | Tens of thousands of GPU particles |
| `webgpu_materials_displacementmap`, `webgpu_parallax_uv` | Near-field regolith relief |
| `webgpu_tsl_earth` | Earth with terminator |
| `webgpu_lights_ies_spotlight`, `webgpu_lights_clustered` | Crown Lamp, many work lights |
| Sundial (paged virtual sun shadows) https://discourse.threejs.org/t/sundial-paged-virtual-sun-shadows-for-three-js-webgpurenderer-mit-on-npm/94912 [S] | Fallback idea if CSM texel density falls short |
| Showcase hubs https://threejs.org/examples/ , https://www.babylonjs.com/community/ , https://playcanvas.com/explore [K] | Benchmark "best in browser" |

---

## 2. What "comparable or better" means (measurable)

### 2.1 Hardware tiers and presets

Naming is shared with every doc ([rendering-pipeline §2.1](../architecture/rendering-pipeline.md#21-detection-procedure-at-boot-renderbackendts), [performance-budgets §1](../architecture/performance-budgets.md#1-hardware-tiers)): **Tier A / Tier B / Tier C** for hardware (Tier C = any device on the WebGL2 backend), **Low / Medium / High / Ultra** for presets. "Desktop" and "Apple" below are capture *devices*, not tiers.

| Tier / device | Reference hardware (capture devices) | Default preset | Target |
|---|---|---|---|
| **Tier B** (integrated) | Intel Iris Xe 96EU; Intel Arc 140V; Radeon 680M/780M class | Medium (Low if the M0 bench shows a miss; ladder in rendering-pipeline §14.2) | 30 FPS, 33.3 ms avg, p95 ≤ 40 ms |
| **Tier A** (discrete laptop) | **RTX 4060 Laptop** (primary reference); RTX 4050/5060 Laptop | High | 60 FPS locked, 16.7 ms avg, p95 ≤ 20 ms |
| **Tier C** (WebGL2 backend) | The Tier B device with WebGPU disabled | Low | 30 FPS; same art, fewer effects |
| Desktop device (Ultra preset) | RTX 4070-class desktop or better | Ultra | 60 FPS locked at higher scale |
| Apple device (informational) | Apple-silicon Mac, Safari 26 (tiered by GPU class: base M → Tier B, Pro/Max → Tier A) | per tier | Recorded **manually** (the developer machine is Windows), not gating until v1.0 |

### 2.2 Per-preset acceptance targets (reference output 1920×1080)

**Preset settings are not restated here.** DPR caps, render-scale ranges, AA/upscaler, cascades × size, cascade-0 split and texel, CSM max far, AO, ring and atlas sizes, particle pools, draw-call, triangle and texture-pool budgets all live in the canonical table: [rendering-pipeline §14](../architecture/rendering-pipeline.md#14-quality-presets--the-canonical-preset-table-contract-sharedrenderqualityts). VT checks such as VT-M0-03 compare the capture against **that** table (via the sidecar and the debug views). A Tier C capture uses the Low column.

This table holds only the image-quality *acceptance bars* that the presets must reach:

| Metric | Low (incl. Tier C) | Medium | High | Ultra | How it is measured |
|---|---|---|---|---|---|
| Preset knobs match the canonical table | yes | yes | yes | yes | Sidecar fields (`renderScale`, `canvasDpr`, `csm`, `dustRingTexelCm`, `particlePool`, `aa`) vs rendering-pipeline §14; cascade debug view |
| Sun-shadow edge, 1 m occluder, camera 3 m (VT-M0-04) | ≤ 15 px | ≤ 15 px | ≤ 9 px | ≤ 8 px | Edge model in rendering-pipeline §5.2; measure tool, 10–90 % |
| Regolith texel density (≤ 5 m / at 50 m) | ≥ the §14 value | same | same | same | Texel-checker debug material |
| Visible tiling at 1:1 | none | none | none | none | S02/S04, 2-frame flip test |
| Stroke-edge 10–90 % width inside the ring, camera 3 m | ≤ 2 cm world (≤ 6 px) + 1 px on SMAA presets | ≤ 2 cm (≤ 6 px) + 1 px | ≤ 2 cm (≤ 6 px) | ≤ 2 cm (≤ 6 px) | Luma profile across the edge, measure tool |
| Berm line pair (lit − shaded ≥ 12 luma, ≥ 2 px wide) visible at | ≥ 6 m | ≥ 8 m | ≥ 10 m | ≥ 15 m | Distance ladder S03 |
| Perceived sharpness vs a native render of the same frame | ≥ 0.75 | ≥ 0.80 | ≥ 0.90 | ≥ 0.90 | Sobel edge-energy ratio on the fixed S02/S04 crops, captured at the render-scale **floor** (VT-M1-33) |
| Temporal stability (VT-M1-28) | ≤ 4.0 | ≤ 4.0 | ≤ 2.0 | ≤ 2.0 | 90th-percentile per-pixel luma std-dev over 32 frames, static scene, 0.1 px/frame camera drift |
| Frame time avg / p95 | 33.3 / 40 ms | 33.3 / 40 ms | 16.7 / 20 ms | 16.7 / 20 ms | 60 s path P1, after warm-up |
| Hitches > 50 ms | ≤ 1 per 60 s; 0 from shader compile | same | same | same | Frame-time trace |

Shadow bars come from the edge model W = 0.00925 · d + 1.5 · t (d = 1 m, t = cascade-0 texel from §14) divided by the pixel footprint at 3 m with vFOV 60° (≈ 3.2 mm), plus 1 px: Low/Medium 4.5 cm → 14 + 1 px; High 2.4 cm → 7.6 + 1 px; Ultra 2.0 cm → 6.2 + 1 px (rounded up).

### 2.3 HUD and text crispness

The DOM UI always renders at the **full device DPR**, whatever the canvas DPR cap or render scale is.

| DPR | Example display | CSS viewport | Min body text (CSS → device px) | Requirement |
|---|---|---|---|---|
| 1.0 | 1920×1080 @100% | 1920×1080 | 14 → 14 | Panels at rest snap to whole device px. No `transform` scale at rest. 400% crop: glyph stems show ≤ 1 device-px AA ramp |
| 1.5 | 1920×1080 @150% | 1280×720 | 14 → 21 | Same. 1 CSS px hairlines must not blur into 2 px grey (use a 1 device-px border token at DPR ≥ 1.5) |
| 2.0 | 2560×1600 @200% | 1280×800 | 14 → 28 | SVG icons render sharp. No bitmap UI anywhere |
| 3.0 | 3840×2160 @300% | 1280×720 | 14 → 42 | Same. The layout still fits 1280×720 CSS without clipping |

World-anchored labels (name tags, Plot Card readout, Flare Beacons labels) are DOM overlays projected each frame. They are never textures in the 3D scene. They follow the same rules.

### 2.4 LOD and streaming pop limits

| Distance from camera | Allowed | Fails if |
|---|---|---|
| 0–25 m | No LOD switch visible on any object > 0.5 m. Terrain CDLOD morph only | Any pop is visible in path P2/P4 at 0.25× playback |
| 25–100 m | Dithered or temporal crossfade ≥ 0.25 s. Geometric error ≤ 1 px (High/Ultra), ≤ 2 px (Low/Medium) | A pop is visible without crossfade, or silhouettes jump |
| > 100 m / beyond horizon | Impostors allowed. Crater-rim silhouettes stay stable | Horizon silhouette shimmers or jumps |
| Texture streaming | Full-res mips within 15 m by **3 s** after a Relay Pad teleport | Blurry ground still visible after 3 s |
| Shadow cascades | Blend band ≥ 10% of cascade depth | A seam line is visible on flat ground |

### 2.5 Scale facts that shape every shot

Canonical Standard contract radius R = 2,000 m (163,842 plots). ADR-0007/0008 own the value; re-derive this table if R changes. Note: distances derived from the radius were recomputed from the earlier 3 km assumption (horizon, curvature drop, plot size, close-up distance scaled by 2/3).

| Fact | Value | Consequence |
|---|---|---|
| Horizon at 1.7 m eye height | √(2Rh) ≈ **82 m** (real Moon ≈ 2.4 km) | Small-world look with visible curvature (the ground drops 0.63 m at 50 m). Detail can be dense. LOD pops cannot hide in haze because there is none |
| Horizon from Behemoth cab (≈4.5 m) / 30 m crater rim | ≈ 134 m / ≈ 346 m | Elevated views are the stress test (path P4) |
| Plot size | ≈ 17.5 m across flats (≈ 307 m²) | One plot fills the frame from 10 m. The Inspector's Stamp outline fits the screen |
| Camera defaults | Third person vFOV 60°, 4.2 m boom; first person vFOV 65° (setting 55–80°) | ≈ 16.3 px/deg at screen center at 1080p, third person |
| Sun disk / Earth disk on screen (1080p, third person) | 0.53° ≈ 9 px / 2.4° ≈ 39 px | VT checks measure these |

### 2.6 Side-by-side comparator rubric (milestone gates M1 and M2)

Recreate the composition of the Moon Sweepers shots SS-02, SS-03, SS-04, SS-05, SS-07, SS-09 and SS-15 in our build (scenes CMP-xx, §6.2). The comparator has two parts, and **neither stores a reference image**.

**How the reference is used (links-only rule, §1).** The reference is only ever *viewed*: the person scoring opens the linked Steam URL in a browser next to our PNG. Nothing is downloaded, saved, screenshotted, cached into the repo or archive, traced or measured by a script. Agents never fetch the image. That is why the measurable part below is scored on **our** frame against absolute bars, and only the side-by-side part looks at both.

**Part 1: measurable items (visual-qa-reviewer, `tools/screenshots/measure`, on our capture only).** Each axis has numeric checks. An axis passes Part 1 when all its checks pass.

| Axis | Measurable checks on our CMP frame |
|---|---|
| A1 Readability of clean vs grime | Clean/grime ratio and difference meet the art-direction §2.3 row for the shot's TOD, measured on the nearest and the farthest cleaned patch ≥ 16×16 px; every cleaned area ≥ 1 m² in frame is detectable by a luma threshold at the midpoint between the two means |
| A2 Lighting credibility | Exactly one shadow direction (VT-M0-02); shadow b* not bluer than sunlit by > 3 (VT-M1-09); up-facing shadow luma inside the §2.3 band |
| A3 Ground detail at 1:1 | VT-M1-13 relief scales present; 2-frame flip test finds no repeat; Sobel edge energy of a 512² ground crop ≥ 0.8 × the High reference crop of S02 |
| A4 Stroke edge | Edge width and berm line pair meet §2.2 for the preset; no stair-step (edge contour residual ≤ 0.5 px at 400 %) |
| A5 Character appeal | VT-M1-18 (helmet-heights, 32 px silhouette) and VT-M1-19 (player colour) pass; no placeholder asset in frame (art-direction §13.4) |
| A6 Hardware appeal | VT-M1-21 palette shares; turntable bar met for every hero asset in frame (VT-M1-35) |
| A7 Sky | VT-M0-01 sky luma; Earth phase within ±10 % (VT-M1-11); star count within the model (VT-M1-12) |
| A8 Image quality | §2.2 perceived-sharpness and temporal-stability bars for the preset; no jaggy run > 4 px on high-contrast edges at 400 % |
| A9 Brightness/cheer | Frame mean luma ≥ 95 for day shots; ≤ 5 % of non-sky pixels below luma 16 (no crushed areas); highlight clip ≤ 1 % |

**Part 2: side-by-side judgement (Cee, in a browser).** For each CMP pair, Cee views the linked reference and our PNG side by side at 100 % and marks each axis **ours better / equal / worse**, with one line of reason. The score sheet (no images) goes into `index.md`. The reviewer also records which Steam screenshot URL and its content hash *as published in the URL path* were compared, so the same pair is used every time.

**Pass, per CMP shot:** every Part 1 axis passes; in Part 2, ours is better or equal on ≥ 7 of 9 axes, and **A1 and A9 are never worse**.

**Where it runs:** on **Tier A High, Tier B Medium and Tier C Low** (each at its render-scale floor and, for High, also at its ceiling). Tier B and Tier C use the same rule except that A3 and A8 are judged against that preset's own §2.2 bars. Interim runs (rows VT-M1-02a/02b, §4.2): **CMP-02/05 at V-M1b** and **CMP-07 plus a custodian crop at V-M1c**, each on Tier A High, Tier B Medium **and** Tier C Low; full set at the M1 gate. Interim runs are scored on the Part 1 axes that exist at that checkpoint and on Part 2 for information; blockout assets are allowed in frame only under the placeholder quality bar (§4.2) and are tagged in the sidecar, whereas the gate run allows none (art-direction §13.4).

**Originality check (same gate):** the reviewer confirms that no CMP frame could be mistaken for a reference frame (palette, character proportions, vehicle archetype, UI). CMP captures are **internal only**: kept in the private archive, linked from `index.md`, never committed, never used in marketing or store material.

---

## 3. MVP visual moments (must nail)

| ID | Moment | What the frame must show | Scene | Milestone |
|---|---|---|---|---|
| VM-01 | **Clock In sunrise** at Outpost Boreal | Sun 3–5° above the horizon, metres-long hard shadows raking every rock and footprint, black sky with stars fading as exposure adapts, half-lit Earth low over the horizon, warm Brightside work lights still on | S01 | M1 |
| VM-02 | **First Light** (first stroke, Desk Duster) | A comically tiny brush parts dark grime and reveals bright ground, a crisp raised berm with a lit top and a shaded side, grains arcing ballistically, boot prints at the stroke edge | S02 | M1 |
| VM-03 | **Inspector's Stamp** | The plot's hex outline draws itself in ivory glow across the ground, the stamp emblem lands with a squash-and-settle, the Lumens tick-up floats up, Shine nudges | S13 | M1 |
| VM-04 | **Assay Counter pour** | A dust stream pours as clean ballistic arcs onto the weighing deck, the readout ticks, "ka-ching" lumen-gold flash | S14 | M1 |
| VM-05 | **Lane stripes at high sun** | Elevated view of a shift-cleaned plot. Bright ground carries lawn-mower-like directional stripes from Lane Broom passes (supported across the whole plot by the R8 stroke-direction texture beside the atlas, art-direction §3.4; not only tonal bands near the player). Remaining grime islands are obvious | S04 | M1 |
| VM-06 | **Night shift** | Near-side midnight: full blue-white Earth, earthlit ground still readable with **crisp blue-white earth shadows** from rocks and hardware, a warm Crown Lamp pool with hard shadows, outpost floods, a dense starfield | S06 | M1 |
| VM-07 | **Shift crowd** | 16 custodians at an outpost, each instantly identifiable by player color and name tag, no z-fighting or clutter | S10 | M1 |
| VM-08 | **Survey Globe** | The whole moon as a correctly spherical body with real maria/highlands, plot states (Grimy umber, Opened cyan, Polished ivory glow), the terminator, Earth in frame | S11 | M2 (Survey Globe is v1.0, scope-tiers §1) |
| VM-09 | **First drive** (Trundle in M1; Skiff in M2) | Brush-drum dust parabolas (rooster tails from the Skiff), crisp tire tracks, low-g suspension bounce | S09 | M1 (Trundle only; the Skiff is v1.0) |
| VM-10 | **Railshot away** | Coils charging teal, the sled streaks up and becomes a moving star, a ground dust ring, the "shipped" counter | S17 | M2 |

---

## 4. Per-milestone visual acceptance checklists

Every item names its scene or path (§6.2–6.3) and a pass threshold. **Severity** follows the `visual_quality.yml` issue template: **V1** reads as low quality at once (blocks the milestone), **V2** is noticeable on inspection (≤ 3 open with tickets allowed at a gate), **V3** is polish. "Luma" means the Rec.709 luma of 8-bit sRGB values **after AgX tone mapping, in capture mode** (scripted EV100, adaptation multiplier 0), averaged over a 16×16 px patch and computed by `tools/screenshots/measure`, never by eye. All luma bands come from [art-direction §2.3](art-direction.md#23-screenshot-luminance-targets), which shows the linear-albedo → display derivation; if a band there changes, the VT item changes with it. Tiers: A, B, C (§2.1); "Desktop" = the Ultra capture device.

### 4.1 M0: render spike and foundations (`v0.1.0`)

| ID | Check | Pass threshold / method | Scene | Tiers | Sev |
|---|---|---|---|---|---|
| VT-M0-01 | Sky is black | Sky pixels away from sun, Earth and stars have luma ≤ 3 and no channel > 4. No gradient, nebula or fog anywhere | S01 | A, B, C | V1 |
| VT-M0-02 | One sun, one shadow | Each test prop casts exactly one sun shadow, consistent with the sun disk direction | S05 | A, B | V1 |
| VT-M0-03 | Cascades match preset | Cascade debug view and sidecar show the count, map size and cascade-0 split of [rendering-pipeline §14](../architecture/rendering-pipeline.md#14-quality-presets--the-canonical-preset-table-contract-sharedrenderqualityts). No visible seam on flat ground in the normal view | S05 | A, B, C | V1 |
| VT-M0-04 | Shadow edge quality (derived bar) | 1 m test post, sun 60°, camera 3 m (vFOV 60°). Measure the 10–90 % width across the **lateral** edge of the post's shadow at the point where the occluder-to-receiver distance is 1.0 m (ground offset cos(elevation) m from the post foot along the shadow), averaged over 5 profiles 2 px apart, by the measure tool. Pass: ≤ 15 px Low/Medium, ≤ 9 px High, ≤ 8 px Ultra (§2.2 derivation). No stair-stepping in a 200 % crop | S05 | A, B | V1 |
| VT-M0-04b | Shadows at grazing sun | Sun at **60°, 15°, 4° and 1°**: post, a 0.5 m rock, and boots of a standing custodian on flat terrain and on a 20° slope. No acne on terrain, rock or suit (no periodic luma pattern > 4 codes in lit areas); contact gap at post foot, rock base and boot soles ≤ 1 cm world (≤ 3 px at 3 m); no peter-panning; shadow tip stays attached as the sun moves 0.1°/s for 10 s | S05 | A, B, C | V1 |
| VT-M0-05 | HDR + AgX | Sun disk blooms white with no hue shift. No 8-bit banding in bloom or Earth-limb gradients (200% crop) | S01 | A, B | V2 |
| VT-M0-06 | Albedo calibration chart (AgX on) | Test patches of linear albedo 0.10, 0.33 and 0.80, flat and sunlit at the noon key (EV100 14.3, capture mode), land on **126 / 181 / 213 ± 8** luma ([art-direction §2.3](art-direction.md#23-screenshot-luminance-targets) shows the linear → AgX → sRGB conversion). Calibrate with AgX and the fill on, never with tone mapping off | S02 | A, B, C | V1 |
| VT-M0-07 | Dust-mask spike edge | A test stroke reveals bright ground. Edge transition meets §2.2 for the preset. Berm line pair (lit − shaded ≥ 12 luma, ≥ 2 px) at 3 m | S02 | A, B | V1 |
| VT-M0-08 | Grime vs clean contrast | Noon, sunlit, calibration patch: grime **111–127**, clean **174–190**, ratio **≥ 1.45** and clean − grime **≥ 50** (expected 119 / 182 / 1.53 / 63; derivation in art-direction §2.3) | S02 | A, B, C | V1 |
| VT-M0-09 | WebGL2 parity | The same S02/S05 composition on Tier C shows identical art. Differences are only those the preset allows. No black or missing materials | S02, S05 | C | V1 |
| VT-M0-10 | HUD crispness test page | §2.3 rules hold at DPR 1, 1.5 and 2 while the canvas renders at scale 0.5. The page also reports the GPU frame cost of 4 glass panels with and without `backdrop-filter` (input to the Tier B rule, art-direction §8.3) | S12 | A, B | V1 |
| VT-M0-11 | Frame time overlay | Spike scene meets §2.2 frame time on A (High) and B (Medium). Captured with the overlay visible | S05 + P1 | A, B | V1 |
| VT-M0-12 | Harness output | Files follow §6.6 naming, PNG pixel size = output × DPR, a sidecar JSON exists for every PNG, and the **measure tool** has written its numbers (luma patches, edge profiles, Sobel, star count) into the sidecar and `index.md`. The measure tool passes its own tests on synthetic charts | all | — | V1 |
| VT-M0-13 | Stars stable | 10 s slow pan (P3), Medium (SMAA) and High: no star flicker or crawl (per-star peak luma varies ≤ 10 %). Stars are round Gaussian disks of radius ≥ 1.2 px, never squares | S06 | A, B | V2 |
| VT-M0-14 | Earth size | Earth disk diameter = 2.4° ± 0.1° (≈ 39 ± 2 px at 1080p, third-person FOV). 2.4° is resolved | S01 | A | V3 |
| VT-M0-15 | Horizon-map spike | Dawn (sun 4°) flyover P4 on Medium and High: terrain shadows continue past CSM max far with edge-width ratio ≤ 2× across the seam and no luma step > 8 on flat ground; crater rims beyond CSM range still cast long shadows on Medium (rendering-pipeline §5.2) | P4 | A, B | V1 |
| VT-M0-16 | Fill on up-facing ground | Noon shadow on flat ground, on a slope facing away from the sun, and on a vertical wall: up-facing clean ground 81–97, wall shadow brighter than flat shadow, never blue (b* rule of VT-M1-09) | S05 | A, B, C | V1 |

### 4.2 M1: MVP (`v0.2.0`)

| ID | Check | Pass threshold / method | Scene | Tiers | Sev |
|---|---|---|---|---|---|
| VT-M1-01 | All MVP visual moments present | VM-01…VM-07 and VM-09 (VM-08 Survey Globe moved to M2) captured and approved by the reviewer and the owner | §3 | A, B | V1 |
| VT-M1-02 | Comparator gate | §2.6 (Part 1 measurable + Part 2 side-by-side) passes for CMP-02, 05, 07, 15 (and 03/04/09 if vehicles are in scope) on Tier A High, Tier B Medium and Tier C Low; originality check passes | CMP-xx | A, B, C | V1 |
| VT-M1-02a | Interim comparator at V-M1b (M1-S9, "first playable that already looks good") | §2.6 Part 1 + Part 2 for **CMP-02 and CMP-05** on Tier A High, Tier B Medium and Tier C Low (floor and, for High, ceiling). A1–A4, A7–A9 must pass Part 1 now; A5/A6 are judged on the blockout custodian and Desk Duster v0 under the placeholder quality bar below (tagged in the sidecar, exempt from the "no placeholder in a CMP frame" rule for this interim run only). Part 2 score sheet recorded in `index.md` for information. Perf check on Tier A High and Tier B Medium accompanies the run. The final comparator stays at the M1 gate (VT-M1-02) | CMP-02, CMP-05 | A, B, C | V2 |
| VT-M1-02b | Interim comparator at V-M1c (M1-S15) | §2.6 Part 1 + Part 2 for **CMP-07 plus a custodian crop** (512×512 at 100 %, custodian at 3–4 m, noon) on Tier A High, Tier B Medium and Tier C Low. A1–A9 must pass Part 1; the custodian and any asset in frame must meet VT-M1-35 or be tagged placeholders under the placeholder quality bar. Part 2: ours better or equal on ≥ 7 of 9 axes, A1 and A9 never worse (advisory at this checkpoint, binding at VT-M1-02) | CMP-07 + crop | A, B, C | V2 |
| VT-M1-03 | Clean reads from distance | In S04 at 12 m elevation, every cleaned area ≥ 1 m² is detected by a luma threshold at the midpoint between the grime and clean means. Noon: ratio ≥ 1.45 and difference ≥ 50; down-sun (opposition view): ratio ≥ 1.35 and difference ≥ 45 (art-direction §2.3), compared within one macro-albedo region | S04 | A, B | V1 |
| VT-M1-04 | Continuous strokes | No stroke shows tile or grid quantization steps at any distance. Edge contour is smooth at 400% crop | S03 | A, B | V1 |
| VT-M1-05 | Berm reads at distance | Berm line pair (lit − shaded ≥ 12 luma, ≥ 2 px wide) at the §2.2 distance (distance ladder 1/3/10/25 m) | S03 | A, B | V1 |
| VT-M1-05b | Ring ↔ atlas handoff and sub-texel strokes | P2 dolly and S03 25 m shot, strokes crossing the ring edge: a Lane Broom stroke changes width by ≤ 1 px and berm difference by ≤ 20 % across the 2 m cross-fade; a Desk Duster stroke at 20 m (beyond the ring) is continuous (no gap > 2 px along 1 m of stroke) and its mean luma changes ≤ 15 % across the ring edge | S03, P2 | A, B | V1 |
| VT-M1-06 | Lane stripes | Lane Broom passes in alternating directions produce visible stripes, with stripe-to-stripe luma difference 6–15 at noon, **across the whole shift-cleaned plot in the elevated VM-05 view** (atlas direction texture, not only near the player). Off on Low by design | S04 | A, B | V1 |
| VT-M1-07 | Shadow edge in gameplay | Custodian shadow at noon, camera 4 m: lateral edge 10–90 % width (same method as VT-M0-04, d = 1 m) ≤ 12 px Medium, ≤ 7 px High. No peter-panning at boots | S05 | A, B | V1 |
| VT-M1-08 | Dawn drama | Sun 4°: shadows of 0.3 m rocks ≥ 4 m long; sun-facing clean slopes ≥ 220; flat sunlit ground grime 90–106, clean 155–171 (art-direction §2.3). Shadows continue past CSM max distance via the horizon map: edge-width ratio ≤ 2× across the seam, no luma step > 8 on flat ground (on Medium too) | S01 + P4 | A, B | V1 |
| VT-M1-09 | Shadow fill is ground-bounce | Noon, shadowed **up-facing** clean ground 81–97 luma (the 15 % linear fill through AgX), grime 28–44. Shadow hue is warm-neutral, never blue: the shadow patch's CIELAB b* is no more than 3 units lower (bluer) than the adjacent sunlit patch. Checked on flat ground, a slope facing away from the sun and a vertical wall | S05 | A, B | V1 |
| VT-M1-10 | Night readability | Near-side midnight: earthlit clean ground 124–140, grime 62–78 (ratio ≥ 1.7); Spot Ring pool at 5 m on clean ground 151–167, grime 86–102. Earth disk shows continents (not blown white) | S06 | A, B | V1 |
| VT-M1-10b | Night shadows and lamp leaks | Near-side midnight: rocks and hardware cast crisp earth shadows (edge per the §5.2 Earth edge model, VT-M0-04 method); own lamp casts hard shadows; with a 1 m rock between another player's unshadowed lamp and the ground, the ground behind the rock gains ≤ 5 luma when that lamp turns on | S06 | A, B | V1 |
| VT-M1-11 | Earth phase correct | Earth illuminated fraction matches local time (noon ≈ new, dusk/dawn ≈ half, midnight ≈ full) within ±10%. The lit limb faces the sun direction | S01, S06 | A | V2 |
| VT-M1-12 | Stars exposure-gated | The measure tool counts stars as local maxima ≥ 12 luma above their 5×5 median; the harness computes the expected count from the catalogue, camera pose, terrain/Earth occlusion and the m_lim model (rendering-pipeline §6). Pass: detected within ±15 % of expected at noon (m_lim 2.5) and at night (m_lim 6.5, capped per preset); no pops during P5 | S01, S06 | A, B | V2 |
| VT-M1-13 | Regolith detail at 1:1 | ≥ 3 distinct relief scales visible within 5 m (pebbles < 5 cm, clods/rocks 5–30 cm, undulation > 1 m). No repeat pattern found in a 2-frame flip test | S02 | A, B | V1 |
| VT-M1-14 | Rocks and craters present | ≥ 1 rock > 0.3 m and ≥ 1 small crater rim in any 20 m ground view. No "blobby empty hills" | S01, S04 | A, B | V2 |
| VT-M1-15 | Footprints | At 3 m, noon, every preset: a boot print on grime is ≥ 8 luma darker than the grime around it, and its tread shows a lug pattern with peak-to-peak ≥ 6 luma at the 2.5 cm lug period (normal-map stamp). On clean ground, faint grime prints reach 0 within 30 s ± 3 s; grime prints reach 0 by the preset lifetime ± 10 % (no stalled residue). Never misread as cleaning | S02 | A, B, C | V2 |
| VT-M1-16 | Ballistic dust | Telemetry hook (rendering-pipeline §11): tracked grains match x(t) with g = 1.62 m/s² and no drag within 5 % of range and apex height; no lingering cloud; grains gone ≤ 0.15 s after landing. Video only for a visual sanity pass | S08 | A, B, C | V1 |
| VT-M1-16b | Grains read (P3) | Third person 3–4 m, noon, Desk Duster stroke: ≥ 20 grains ≥ 2 px visible within 0.5 s of stroke start, ≥ 50 % of them ≥ 15 luma different from the ground behind them. Same bar on every preset and on Tier C; a Trundle drum or Lane Broom pass on Low/Tier C still reads as a burst (fewer, larger grains when capped) | S08 | A, B, C | V1 |
| VT-M1-17 | Particle budget | Peak live grains during a Trundle pass with 4 players sweeping nearby reach ≥ 50% of the preset pool (rendering-pipeline §14) without frame-time breach (Static Rake / Ion Curtain at M2) | S08 | A, B | V2 |
| VT-M1-18 | Custodian silhouette | Custodian reads as human-proportioned: 4.4–4.8 helmet-heights tall (chibi is 2–3; see art-direction §4.1). Silhouette identifiable at 32 px tall. No LED-eye visor. Applies to the blockout too, under the placeholder quality bar below (art-direction §13.4) | S10 | A | V1 |
| VT-M1-19 | Player color readable | All 16 player colors distinguishable at 50 m in day and night. Name tag readable at ≤ 30 m. Numeral glyph visible for color-blind modes | S10 | A, B | V1 |
| VT-M1-19b | Name tags stay attached | Camera panning at 3 rad/s: tag anchor within 4 px of the avatar's head anchor in every frame of a frame-stepped capture | S10 | A, B | V2 |
| VT-M1-20 | Tools read at a glance | Each MVP hand tool (T1–T4: Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom; all six at M2) identifiable by silhouette in first and third person at 1080p. The Desk Duster reads as comically tiny and as a palm-held puck brush, not a toothbrush (art-direction §5.3) | S02, S10 | A | V2 |
| VT-M1-21 | Outpost hardware palette | Brightside palette (ivory/teal/yellow/graphite) used per art-direction §5. Safety-yellow ≤ 10% of a hardware asset's visible area. No white/orange toy look. A blockout hardware asset is held to the palette shares and the no-toy-look rule from day one (placeholder quality bar below) | S01, S10 | A | V1 |
| VT-M1-22 | Inspector's Stamp VFX | Outline completes in 0.6–1.0 s, stamp lands with one overshoot, no z-fighting on slopes, readable at noon and night | S13 | A, B | V1 |
| VT-M1-23 | Survey Globe | Moon is spherical (silhouette deviation ≤ 0.5% of radius apart from relief), maria/highlands visible, plot states use naming-bible map colors, terminator soft ≤ 3° (judged at M2-W1; not an M1 gate) | S11 | A, B | V1 |
| VT-M1-24 | HUD on gameplay | All HUD text ≥ 14 CSS px and passes §2.3 at DPR 1/1.5/2. Glass panels meet the contrast rules over a white backdrop (art-direction §8.3) | S12 | A, B | V1 |
| VT-M1-25 | UI motion | Tick-ups, purchase feedback and toasts follow the art-direction §8.7 presets (frame-step a 60 FPS capture). Reduced-motion mode removes springs and shake | S12 | A | V2 |
| VT-M1-26 | LOD pops | §2.4 limits hold on paths P2 and P4 | P2, P4 | A, B | V1 |
| VT-M1-27 | Frame time in gameplay | §2.2 frame time on S10 with 16 bot players, P1, 60 s, after warm-up | S10 + P1 | A, B | V1 |
| VT-M1-28 | No shimmer | Static S02/S04 frames with 0.1 px/frame camera drift, 32 frames: 90th-percentile per-pixel luma std-dev ≤ 2.0 (TRAA presets) / ≤ 4.0 (SMAA presets) on grime/clean edges, sparkle, stripes and thin rails. Plus P1 at 100 % with no visible crawl, and no visible "breathing" when dynamic resolution steps (scale-step pulse: frame-mean luma change ≤ 1 and edge-energy change ≤ 5 % across a step) | P1, S02, S04 | A, B, C | V1 |
| VT-M1-29 | Bloom discipline | Sunlit clean ground (including sparkle) and ivory paint never bloom: bloom-only debug view is empty on them. Only sun, lamps, emissives and Earth exceed the threshold (rendering-pipeline §8.1) | S04 | A, B | V2 |
| VT-M1-30 | WebGL2 MVP parity | VM-01, 02, 06 on Tier C meet the Low thresholds; run at M1-W3 as well as at the gate | S01, S02, S06 | C | V1 |
| VT-M1-31 | Low preset dignity | Low on Tier B still passes VT-M1-03/04/08/10 at the Low thresholds, with contact darkening around rocks and berms visible (half-res GTAO + cavity term). "Low" never looks broken | S01–S06 | B | V1 |
| VT-M1-32 | Metals and visor reflect | A `pbr-steel` sphere (roughness 0.35) and the custodian visor at noon, dawn and night-near: the sphere's lower half reflects the lit ground (mean luma 60–150 at noon, ≥ 20 at night-near), its upper half stays dark except the Earth reflection; no metal surface renders as flat black over > 30 % of its silhouette; the visor shows a Fresnel rim and the Earth when it is in the mirror direction | S05, S06 | A, B | V1 |
| VT-M1-33 | Perceived sharpness | Sobel edge-energy ratio of the fixed S02/S04 crops vs a native (scale 1.0, TRAA) render of the same frame, at the preset's render-scale floor: ≥ 0.75 Low, ≥ 0.80 Medium, ≥ 0.90 High/Ultra | S02, S04 | A, B, C | V2 |
| VT-M1-34 | Dust thins smoothly | Whisk passes leaving R = 1, 0.75, 0.5, 0.25, 0 on adjacent 1 m² patches, noon, 3 m: mean luma monotonic, every step ≥ 8 (expected ≈ 119/137/151/161/182 for R = 1…0, art-direction §3.3), no speckle (pixel-scale high-pass energy, 3×3 Laplacian, ≤ 1.5× that of the fully clean patch; relief-scale patchiness from the height blend is intended). Visible grime coverage per plot within ±10 points of the ledger; a Polished plot shows no grime island > 0.5 m² | S03 | A, B, C | V1 |
| VT-M1-35 | Asset turntables | Every MVP hero asset (custodian, tools T1–T4, Trundle, Outpost Boreal modules, Assay Counter, Requisitions Desk, Ops Console) meets the art-direction §13.3 bar on a 1080p turntable (8 views at 45°, noon + night-near), or is a tagged placeholder before its replace-by milestone. **Asset-quality turntable check for the M1 3D-art tasks:** run when each delivering task reports, not only at the gate: M1-W3-T07 (blockout custodian + Desk Duster v0: placeholder bar), **M1-W4-T07** (production custodian suit, Desk Duster, Crescent Squeegee, Bristle Broom, Lane Broom: full §13.3 bar), M1-W5-T03 (Boreal hero hardware: Assay Counter, Receiving Gate, Dump Plate, floods), M1-W6-T05 (kit part 2: Motor Pool, Desk, Console), M1-W7-T02 (Trundle; the Skiff is turntabled in M2-W3-T02). Measured by the harness: silhouette at 32 px / 60 m, ≥ 24 segments per 360° on hero curves, bevel highlight at 3 m, texel density, palette shares (yellow ≤ 10 %), triangle/texture/bone budgets and LOD chain present, all read from the sidecar. A failed turntable blocks the task's review, not just the gate | turntable | A | V1 |

**Placeholder quality bar (blockout assets, applies to VT-M1-18, VT-M1-21 and the interim rows VT-M1-02a/02b; policy in art-direction §13.4).** A blockout is judged on what it cannot defer: (1) final proportions and scale: custodian 4.4–4.8 helmet-heights, tools at their art-direction sizes; (2) final pivots, sockets and material slots, including the player-colour mask; (3) the final shader, so the albedo and AgX calibration (VT-M0-06) hold on it; (4) the Brightside palette: yellow ≤ 10 % of visible area, no white/orange toy look; (5) a 32 px silhouette that is identifiable and has no LED-eye visor. Only modelling detail and texture fidelity may be missing. The manifest carries `placeholder: true` and the replace-by milestone; the capture sidecar lists it in `placeholderAssets`. A placeholder is exempt from VT-M1-20 and the VT-M1-35 turntable bar until its replace-by milestone, never from items 1–5 above. No placeholder in a CMP frame at the M1 gate (VT-M1-02) or in a `v1.0.0` build.

### 4.3 M2: v1.0 (`v1.0.0`, mechanics parity)

| ID | Check | Pass threshold / method | Scene | Tiers | Sev |
|---|---|---|---|---|---|
| VT-M2-01 | Comparator gate (full) | §2.6 passes for all CMP-xx including 03, 04, 09, on Tier A High, Tier B Medium and Tier C Low | CMP-xx | A, B, C | V1 |
| VT-M2-02 | All five vehicles | Trundle, Skiff, Carryall, Bulldust, Behemoth each distinct by silhouette at 60 m. Palette per art-direction §5 | S09 | A, B | V1 |
| VT-M2-03 | Vehicle dust and tracks | Rooster-tail parabolas (range 2.5–10 m at 2–4 m/s), crisp tread/cleat tracks in grime, tracks on clean ground fade ≤ 30 s | S09 | A, B | V1 |
| VT-M2-04 | Low-g suspension | Skiff landing from a 1 m bump: visible compression and ≤ 2 rebounds over ≥ 0.8 s (capture) | S09 | A | V2 |
| VT-M2-05 | Robots read as birds | Sandpiper, Plover and Albatross are each recognizable as their shorebird motif at 20 m. State light colors match art-direction §6.3 | S15 | A | V2 |
| VT-M2-06 | Albatross hop | Hop arc is ballistic, wings fold during the hop and unfold as panels on landing. No gliding | S15 | A | V2 |
| VT-M2-07 | Logistics readability | Glide Rail pucks, Rail Fork/Join, Puck Former, Bead Kiln (orange glass glow), Tile Sinterer readable from 15 m overview. Pucks don't z-fight | S16 | A, B | V1 |
| VT-M2-08 | Build pieces | Deck Plates, Gantries, Rails & Railings and Panels in all 5 finishes (Brushed, Tread, Mesh, Glow, Chevron) distinguishable at 10 m. Snapped seams have no gaps > 1 px | S16 | A | V2 |
| VT-M2-09 | Railshot away (VM-10) | Charge sequence 1.5–2.5 s, sled streak visible for ≥ 1 s, ground dust ring ballistic | S17 | A, B | V1 |
| VT-M2-10 | Far-side night | No Earth. Starfield plus lamps carry the scene. Ground silhouettes readable at luma ≥ 15. The lamp pool dominates | S07 | A, B | V2 |
| VT-M2-11 | Twilight Strips | The two equatorial points on the sun-path pole (≈135°E and ≈45°W) show a permanent grazing sun (≈0–3°) with very long shadows, distinct from the 30/30 cycle at all four outposts | S18 | A | V3 |
| VT-M2-12 | Flare Beacons | 12 beacon pillars distinguishable by color at 400 m from elevated views. Pillars read as projected light, not solid | S18 | A, B | V2 |
| VT-M2-13 | Tenure liveries | Every rank livery (Trainee → Head Custodian) distinguishable at 10 m and never overrides the player-color slots | S10 | A | V2 |
| VT-M2-14 | Suit dust patina | Boots, shins and gloves accumulate grime with cleaning time. Visible difference at 5 m between a fresh and a worked suit | S10 | A | V3 |
| VT-M2-15 | Hop Pack plumes | White plumes live ≤ 0.3 s, expand and vanish (no lingering smoke) | S08 | A | V3 |
| VT-M2-16 | Lowlight Visor | Green-amber overlay keeps the HUD readable (§2.3) and clean − grime ≥ 40 luma (ratio ≥ 1.3) | S07 | A | V2 |
| VT-M2-17 | Ultra preset | Ultra on the desktop device passes every High threshold at 2560×1440 internal or above | all | Desktop | V2 |
| VT-M2-18 | Contract Fulfilled | Ending sequence: whole-moon Polished ivory glow on the Survey Globe, Earth in frame, banner type per art-direction §8 | S11 | A | V1 |
| VT-M2-19 | Shine-driven look | At Shine 50%, orbit view clearly shows ≥ 50% ivory coverage. The albedo change is visible from orbit | S11 | A | V2 |
| VT-M2-20 | Apple / Safari 26 | VM-01…08 render correctly on the Apple device (informational until now, gating at v1.0). Captured manually on a Mac; deferred if no Mac is available, with an owner sign-off | §3 | Apple | V2 |
| VT-M2-21 | Memory | No texture-pool overrun on B after 30 min of play (sidecar `texPoolMB` ≤ preset cap) | P1 | B | V1 |
| VT-M2-22 | Stray Cargo and Survey Points | Stray Cargo pieces readable as Brightside freight at 15 m. Survey Points markers don't break the black sky | S18 | A | V3 |

### 4.4 M3: polish (post-v1.0)

| ID | Check | Pass threshold / method | Scene | Tiers | Sev |
|---|---|---|---|---|---|
| VT-M3-01 | Opposition surge / heiligenschein | Down-sun view: soft glow around the custodian's shadow head, +20–30% luma within ≈8° of the antisolar point, fading smoothly | S04 | A | V3 |
| VT-M3-02 | Milky Way band | Self-authored or HYG-derived band visible at night on High/Ultra. No Gaia-derived data (licensing) | S06 | A | V3 |
| VT-M3-03 | Earth detail | City lights on Earth's night side, slowly rotating clouds, libration wobble ≤ 6° | S06 | A | V3 |
| VT-M3-04 | Photo mode | Hides HUD, free camera, exposure ±2 EV, telephoto to 15° vFOV (big-Earth shots), grid overlay, captures at native DPR | S01 | A, B | V3 |
| VT-M3-05 | Cinematic preset | Optional SSR on Glow and Brushed finishes, DOF in photo mode. Never on by default | S16 | Desktop | V3 |
| VT-M3-06 | Color-blind modes | Deuteranopia, protanopia and tritanopia simulations of S04/S10/S11: plot states and player identity still distinguishable (luma + glyph) | S04, S10, S11 | A | V2 |
| VT-M3-07 | HUD scale 80–150% | No overlap or clipping at 1280×720 CSS at any HUD scale | S12 | A | V2 |
| VT-M3-08 | Footprint persistence | Old prints bake into "trampled" plot-tile detail instead of vanishing at the ring edge (no visible ring boundary) | P2 | A | V3 |
| VT-M3-09 | Thermal-glint sunrise | Sunrise frames show hardware specular glints and dust sparkle ramping in. No pops | S01 | A | V3 |
| VT-M3-10 | Shift graffiti readability | Freehand cleaned shapes (players "drawing") read clearly from 30 m elevation | S04 | A | V3 |
| VT-M3-11 | Loading and menus | Clock In, Contracts, Locker, Settings and Credits screens meet §2.3 and the glass style. No layout shift on load (CLS ≤ 0.1) | S12 | A, B | V2 |
| VT-M3-12 | Store-capsule set | 6 marketing shots (VM-01, 02, 05, 06, 08, 10) at 1920×1080 pass every §2.6 Part 1 measurable axis. They are **our own compositions**, never CMP recreations | §3 | A | V2 |
| VT-M3-13 | Long-session stability | 2 h capture: no texture or shadow degradation, no accumulating artifacts | P1 | A, B | V2 |

---

## 5. Physics departures in this target

Full table with reasons: [`art-direction.md` §2.4](art-direction.md#24-deliberate-departures-from-physics). VT thresholds above already include these departures: brighter exposure, a 4× clean/grime linear albedo ratio (≈ 1.53× on screen after AgX), the 15 % shadow lift, boosted earthshine, daytime bright stars, Earth at 2.4°, stylized lamp intensities and the small-moon horizon.

---

## 6. Screenshot protocol (followed by visual-qa-reviewer at every milestone)

### 6.1 Capture rules

| Rule | Detail |
|---|---|
| Lane | **Real-GPU local lane only** (Playwright 1.65 with real GPU on the reference hardware, harness in `tools/screenshots/**`). CI software-render shots are smoke tests and **never** count as visual evidence |
| Build | A tagged or wave build with the commit hash recorded in the sidecar. Production bundle (`vite build`), not dev server |
| Browser | Chrome stable (Tier A, Tier B, desktop device), Chrome with WebGPU disabled (Tier C). Safari 26 on the Apple device is captured **manually** (the developer machine is Windows) or deferred with owner sign-off. Record versions |
| Determinism | Fixed contract seed `vt-standard-01` (Standard size), fixed scene save per scene, fixed time-of-day (TOD frozen), **capture-mode exposure** (scripted EV100, adaptation multiplier 0, rendering-pipeline §8.4), bot players with scripted poses, particles seeded, dynamic resolution **locked at the preset floor**. Every comparator (CMP) scene and every High scene is also captured at the **ceiling**, so what players see at the top of the range is judged too |
| Warm-up | All pipelines compiled (async warm-up done), streaming idle for 3 s, TRAA history ≥ 64 frames before the shot |
| Resolution | Native output: 1920×1080 at DPR 1 for all world scenes. HUD scene S12 also at 1280×720 CSS @ DPR 1.5, 1280×800 CSS @ DPR 2, 1280×720 CSS @ DPR 3. **Never resize, never re-encode lossy** |
| HUD | Each world scene captured `nohud`. Scenes marked † also `hud` |
| Overlays | A debug-overlay variant (`dbg`: frame time, draw calls, triangles, render scale, cascades) only where a VT item asks for it |
| Captures (motion) | **Deterministic frame-stepped capture mode**: fixed dt (1/60 s), fixed seed, the harness advances one frame and reads it back (`toBlob` / render-target readback), writing a lossless PNG sequence. Wall-clock speed is ≈ 15–20 FPS, but the sequence plays back as true 60 FPS motion. Playwright's built-in video (≈ 25 fps, lossy) is never evidence. Frame-time numbers come from separate real-time runs (P1), not from stepped captures. Sequences are **not committed to git**: CI artifact or private archive, linked from `index.md` |
| Measurements | Computed by **`tools/screenshots/measure`** (luma patches, 10–90 % edge profiles, Sobel edge energy, CIELAB b*, disk sizes, star counts, temporal variance), never by eye. The tool writes the numbers, with pixel coordinates, into the sidecar and `index.md`; `index.md` is generated from sidecars + measurements. The tool has its own tests on synthetic charts |

### 6.2 Scenes

| Scene | Content | Camera | TODs | Milestone first used |
|---|---|---|---|---|
| S01 † | Outpost Boreal approach, rocks, footprints, Earth on horizon | 3rd person, 4.2 m boom, up-sun ±30° (`a`) and down-sun (`b`) | dawn, noon, dusk | M0 |
| S02 | First-stroke macro: Desk Duster stroke 1 m long, mid-frame; albedo chart prop at frame edge (M0) | 1st person, eye 1.6 m, pitch −45°, sun azimuth 90° to view | noon, dawn | M0 |
| S03 | Stroke distance ladder: hand strokes + 1 Lane Broom pass | Camera at 1, 3, 10, 25 m, pitch −30° | noon | M0 (M1 full) |
| S04 | Shift-cleaned plot, 50% Polished, Lane Broom stripes, freehand shapes | Elevated 12 m, pitch −35°, then down-sun variant | noon, morning | M1 |
| S05 | Shadow lab: 1 m post, custodian, Trundle (if available), boulder | 3rd person 4 m; macro 3 m on post | noon, dawn | M0 |
| S06 † | Near-side midnight at outpost, full Earth, Crown Lamp Spot Ring, floods | 3rd person, lamp pool at 5 m | night-near | M0 (stars) / M1 |
| S07 | Far-side night, lamp only, Lowlight Visor variant | 3rd person | night-far | M2 |
| S08 | Dust FX: Desk Duster, Static Rake, Ion Curtain strokes; Hop Pack burst | 3rd person 3 m side view, sun back-lit 30° | noon, dawn | M1 |
| S09 † | Vehicle: Trundle push (M1), Skiff at 8 m/s past camera (M2), then all five vehicles line-up | Side tracking 6 m; static line-up at 60 m | noon, dawn | M1 / M2 |
| S10 † | Shift crowd: 16 bots at Outpost Boreal, all player colors, mixed tools and liveries | 3rd person 8 m, then 50 m | noon, night-near | M1 |
| S11 † | Survey Globe: whole moon, plot states, terminator, Earth | Orbit view, moon fills 70% height | — (sun fixed) | M2 |
| S12 | HUD sheet: gameplay HUD + Requisitions Desk + Promotions Board + toast + DOT line + Plot Card | Over S04 (brightest background) and S06 | noon, night-near | M0 (test page) / M1 |
| S13 † | Inspector's Stamp on a plot reaching Polished | Elevated 15 m and 3rd person | noon, night-near | M1 |
| S14 † | Assay Counter pour | 3rd person 3 m | noon | M1 |
| S15 | Robots: Sandpiper, Plover at Roost; Albatross hop to a Nest | 3rd person 6 m and 20 m | noon | M2 |
| S16 | Logistics and build: Glide Rail loop, Rail Fork/Join, Puck Former, Bead Kiln, Tile Sinterer, Sun Fan, Night Cell, finish samples | Elevated 15 m | noon, night-near | M2 |
| S17 † | Railshot away | 3rd person 25 m side and ground-level up-shot | dusk, night-near | M2 |
| S18 | Elevated vista: Flare Beacons, polar outpost, horizon silhouettes, Stray Cargo | Crater rim 30 m, sweeping pan | dawn, polar | M2 |
| CMP-02/03/04/05/07/09/15 | Our recreation of the linked Moon Sweepers composition (framing, sun direction, subject); our own assets only. Internal only (§2.6) | Match reference framing ±10% (judged by viewing the linked reference in a browser) | match reference | M1 (02, 05, 07, 15; interim 02/05 at V-M1b and 07 at V-M1c), M2 (03, 04, 09) |

### 6.3 Camera paths (motion captures)

| Path | Description | Duration | Checks |
|---|---|---|---|
| P1 | Walk loop around Outpost Boreal and a half-cleaned plot, 16 bots active | 60 s | Frame time, shimmer, hitches |
| P2 | Dolly out from 1 m above a stroke to 60 m altitude | 20 s | LOD pop, berm fade, ring edge |
| P3 | Orbit custodian 360° at r = 4 m, then a 10 s slow sky pan | 22 s | Shadows, stars stable |
| P4 | Flyover at 30 m altitude, 300 m straight line, dawn | 30 s | LOD pop, CSM to horizon-shadow handoff |
| P5 | Sunset to night transition at fixed position (time-lapse ×60) | 20 s | Exposure adaptation, stars fade-in, Earth |
| P6 | Survey Globe zoom from surface to orbit | 10 s | Transition, orbit LOD |

### 6.4 Time-of-day presets

| TOD id | Sun elevation / azimuth | Location | Earth |
|---|---|---|---|
| `dawn` | +4° / E | Outpost Boreal region | Half, low on horizon |
| `morning` | +30° / E | same | Gibbous→half (by geometry) |
| `noon` | +60° (not 90°: keeps form shadows) | same | Thin crescent / new |
| `dusk` | +4° / W | Outpost Duskside region | Half |
| `night-near` | −20°, near side | Outpost Boreal region | Full or near full |
| `night-far` | −20°, far side | far-side test site | Not visible |
| `polar` | +2° circling | Outpost Boreal | On horizon |

### 6.5 Capture matrix per milestone

| Milestone | Scenes | Tier × preset × backend |
|---|---|---|
| M0 | S01, S02, S03, S05, S06, S12 (test page), P4 | A-High-webgpu, B-Medium-webgpu, C-Low-webgl2 |
| V-M1b (M1-S9, interim) | S01, S02, S08, S10 (custodian crop), CMP-02, CMP-05 | A-High-webgpu, B-Medium-webgpu, C-Low-webgl2 (VT-M1-02a); perf check on A-High and B-Medium |
| V-M1c (M1-S15, interim) | S01, S02, S04, S10, CMP-07 + custodian crop (512×512 at 100 %) | A-High-webgpu, B-Medium-webgpu, C-Low-webgl2 (VT-M1-02b) |
| M1 | All M1 scenes + CMP-02/05/07/15 + turntables | A-High-webgpu (all), B-Medium-webgpu (all), B-Low-webgpu (S01–S06), C-Low-webgl2 (S01, S02, S06 + CMP) |
| M2 | All scenes + all CMP | M1 matrix + A-Ultra-webgpu on the desktop device (all) + Apple device High (§3 moments, manual) |
| M3 | Changed scenes only + VT-M3 list | A-High, B-Medium |

The scene-by-config matrix is large (≈ 20 scenes × 4 configs). Reviewers judge the **measure-tool output** for every capture and look at images only for items that need judgement (§6.7), so the matrix stays feasible.

### 6.6 File naming and storage

Folder: `docs/visual-reviews/<milestone>/<wave|final>/`. Examples: `docs/visual-reviews/M1/W2/`, `docs/visual-reviews/M1/final/`.

This section is the **single naming and storage rule**; `.claude/commands/visual-check.md` must follow it (its `<scene>-<preset>-<tier>.png` and `REVIEW.md` conventions are superseded; change requested in the planning-fix report).

File name: `<scene>[a|b]-<tod>-tier<A|B|C>-<low|medium|high|ultra>-<webgpu|webgpu-compat|webgl2>-<W>x<H>@<dpr>-<hud|nohud|dbg>[-<floor|ceil>][-<variant>].png`. The capture device (Tier A laptop, desktop, Apple) is in the sidecar, not the name.

| Example | Meaning |
|---|---|
| `S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor.png` | First-stroke macro, Tier A High, render-scale floor |
| `S01a-dawn-tierB-medium-webgpu-1920x1080@1-hud-floor.png` | Dawn, up-sun, with HUD |
| `S12-noon-tierA-high-webgpu-2560x1600@2-hud.png` | HUD crispness at DPR 2 |
| `S03-noon-tierA-high-webgpu-1920x1080@1-nohud-floor-10m.png` | Distance-ladder 10 m shot |
| `S02-noon-tierC-low-webgl2-1920x1080@1-nohud-floor.png` | Tier C (WebGL2) parity |
| `crop/S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor-edge-x812y604.png` | 512×512 100% crop at the given origin |

Every PNG has a sidecar `<same-name>.json` with these fields: build hash, browser and version, backend, hardware tier, capture device, GPU string, preset, the §14 knob values in use (`renderScale`, `canvasDpr`, `csm`, `dustRingTexelCm`, `particlePool`, `aa`), output size, camera pose and vFOV, sun elevation/azimuth, EV100 (scripted) and adaptation multiplier (0 in captures), Earth phase, frame-time avg/p95 (if captured), draw calls, triangles, `texPoolMB`, particles live, `placeholderAssets` (list), and the **measure-tool results**.

Each folder has an `index.md` (generated): a table of VT ID → verdict (PASS/FAIL/N/A) → files → measurements → linked reference URL and Part 2 score sheet (for CMP) → issue link for failures.

| Storage rule | Limit |
|---|---|
| Committed per milestone `final/` | ≤ 16 full frames + ≤ 32 crops (512×512), ≈ ≤ 80 MB total, PNG optimized losslessly |
| Committed per wave | ≤ 6 full frames + crops for the items under review |
| CMP captures | **Never committed**; private archive only (§2.6), linked from `index.md` |
| Everything else (full matrix, frame-stepped sequences) | CI artifacts or the private archive (ADR-0017), linked from `index.md` |
| Reference images | **Never** downloaded, stored, cached or screenshotted, in the repo, the archive or a scratch folder: links only, viewed in a browser |

### 6.7 Review procedure

| Step | Action |
|---|---|
| 1 | Run the capture matrix (§6.5) with the harness. Verify the VT-M0-12 naming and sidecars |
| 2 | Run `tools/screenshots/measure` over the set; it fills the numeric checks (luma patches, edge widths, disk sizes, counts, variance, Sobel) with pixel coordinates into sidecars and the generated `index.md`. The reviewer checks the numbers against the VT bars and spot-checks 3 measurements by opening the PNG |
| 3 | Comparator (§2.6): the reviewer scores Part 1 from the measurements; Cee scores Part 2 by viewing each linked reference in a browser next to our PNG. No reference image is fetched by any agent or tool |
| 4 | Review frame-stepped motion sequences at 1× and 0.25× for LOD, shimmer, particles and UI motion |
| 5 | File each failure with `.github/ISSUE_TEMPLATE/visual_quality.yml`, quoting the VT ID and severity |
| 6 | Write `docs/agent-reports/<taskID>-review-visual-qa-reviewer.md` with the verdict. **Gate passes** when every V1 passes, ≤ 3 V2 are open with tickets, and the owner signs off on §3 moments |

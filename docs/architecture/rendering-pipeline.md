# Rendering pipeline — Clean The Moon!

Direction: `docs/design/REFERENCE_TARGET.md` overrides retired naming/style/custom-gate rules.

Status: **Draft for implementation (planning session 2026-11-12)** · Owner: lead (authored via brief) · Implementers: `rendering-engineer` (`apps/client/src/render`), `technical-artist` (`apps/client/src/visuals`), `terrain-dust-engineer` (`apps/client/src/terrain`), `performance-profiler` (`apps/client/src/debug`), `ui-ux-motion-designer` (DOM UI).
Canonical inputs (never overridden here): [tech-stack.md](tech-stack.md) (ADR-0003/0004/0005/0006), [module-boundaries.md](module-boundaries.md), [naming-bible.md](../design/naming-bible.md).
Evidence: [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) ("RCT"), [browser-feasibility.md](../research/browser-feasibility.md) ("BF"), [visual-analysis.md](../research/visual-analysis.md) ("VA"), [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md), [asset-and-data-licensing.md](../research/asset-and-data-licensing.md).
Companion: [world-and-dust-simulation.md](world-and-dust-simulation.md) ("WDS": grid, CDLOD, dust atlas, ring, dust shading).

Engine: **three 0.187.0, `WebGPURenderer` + TSL, automatic WebGL2 backend, vanilla (no R3F)**. All shaders are TSL node graphs; all post-processing is `RenderPipeline` nodes. API names below are from the r187 docs/examples as cited in RCT; implementers confirm each against the vendored snapshot in `docs/vendor/three-r187/` before use. **[R]** = recommendation a spike may change.

---

## 1. Art direction → rendering rules

"**Bright, readable stylised realism**": real lunar lighting (black sky, hard sun, Earth, earthshine) with friendly chunky hardware and boosted readability.

| Rule | Rendering consequence |
| --- | --- |
| Black sky, no atmosphere | Clear colour 0; **no fog, no aerial perspective, no haze** at any distance (VA 3.6). LOD pops are fully exposed → CDLOD morphing and horizon culling are mandatory |
| Hard sun | One directional sun, 0.53° disk; shadows hard but filtered (penumbra ≈ 9 mm per m of occluder distance, VA 3.9) |
| Fill from the ground, not the sky | Stylised warm-grey regolith-bounce fill that reaches **up-facing** ground too (§5.1), scaled by sun (or Earth) illuminance; never blue sky fill (VA 3.10) |
| Earth and earthshine | Earth fixed in the sky over the sub-Earth point (+X); cool-white earthshine is the night key light, **boosted** for playability, and it casts shadows through the sun's CSM at night (§5.2) |
| Clean strips read instantly | Linear albedo grime ≈ 0.085, clean ≈ 0.34 (≈ 4×; single source [art-direction §3.2](../design/art-direction.md#32-material-values)); crisp edges with lit berms. Display targets are **8-bit sRGB luma after AgX at the scripted exposure** and are derived in [art-direction §2.3](../design/art-direction.md#23-screenshot-luminance-targets): noon ratio ≥ 1.45 and difference ≥ 50 codes (verified, §19) |
| Friendly chunky hardware | Brightside palette and finishes exactly as [art-direction §5.1](../design/art-direction.md#51-brightside-pbr-palette-hardware) (this file sets no colours); bevelled silhouettes; rim-friendly roughness; metals lit by the environment probe (§5.5) |
| Regolith truth | Low base albedo, opposition-surge/backscatter term, Lommel-Seeliger-style flat look from orbit (VA 3.3–3.5) |
| Readable co-op | Per-player colour on suit trims, Crown Lamp tint and name labels |

---

## 2. Backend detection and feature tiers

### 2.1 Detection procedure (at boot, `render/backend.ts`)

**Naming (used in every doc):** *hardware tiers* are **Tier A** (discrete GPU), **Tier B** (integrated GPU) and **Tier C** (any device running the WebGL2 backend), as in [performance-budgets §1](performance-budgets.md#1-hardware-tiers). *Backends* are written `webgpu`, `webgpu-compat` and `webgl2` (the earlier labels G1/G2/G3 are retired). *Presets* are **Low / Medium / High / Ultra** (§14). Ultra is a preset, not a tier.

1. URL/settings override `?backend=webgpu|webgl2` (QA, support) wins.
2. No `navigator.gpu` → **`webgl2`**.
3. `requestAdapter({ powerPreference: "high-performance" })`. If null, try a compatibility-feature-level adapter **only if three r187 exposes that option** (verify, §21); success → **`webgpu-compat`**, else **`webgl2`**.
4. Adapter is a fallback/software adapter (`adapter.info.isFallbackAdapter`) → **`webgl2`** (hardware WebGL2 beats software WebGPU).
5. Adapter description matches the driver blocklist (`render/blocklist.json`, data file) → **`webgl2`**.
6. Create `WebGPURenderer` with `forceWebGL: true` for `webgl2`, `reversedDepthBuffer: true`, `antialias: false` (AA is post), then `await renderer.init()`; read back which backend actually started.
7. Record capability flags (below) into the `quality` service; log them once (`ops` line, Sentry context).
8. No WebGL2 either → static "browser not supported" page (recommend current Chrome, Edge, Firefox or Safari 26).

| Capability probed | `webgpu` / `webgpu-compat` | `webgl2` |
| --- | --- | --- |
| GPU timing | `timestamp-query` feature (98.9 %, 100 µs rounding in Chrome, BF §1.3) | `EXT_disjoint_timer_query_webgl2` (62.8 %, BF §2.2); else CPU frame time |
| Float filtering | `float32-filterable` (91 %) — never required; we sample only 16F | `OES_texture_float_linear` — never required |
| HDR targets | core | `EXT_color_buffer_float` (99.95 %) / `_half_float` (91.7 %) |
| Texture compression | `texture-compression-bc` (87 %) | s3tc/rgtc/bptc (84–86 %) |
| Parallel compile | async pipeline creation | `KHR_parallel_shader_compile` (74.6 %) |
| Reversed-Z | core | needs clip-control extension → verify; fallback WDS §3.6 |

### 2.2 Backend feature matrix

| Feature | **`webgpu`** | **`webgpu-compat`** | **`webgl2`** (Tier C) |
| --- | --- | --- | --- |
| Dust stroke replay | Compute (scratch + copy) | Compute | Fragment raster + blend (WDS §7.3) |
| Detail ring, footprints | Raster + blend | Raster + blend | Raster + blend |
| Particles | GPU compute (pool per §14) | CPU sim + instanced (no storage buffers in vertex stage in compat, BF §1.4) | CPU sim + instanced |
| Exposure adaptation (§8.4) | Compute luminance histogram (atomics) | Luminance mip chain | Luminance mip chain |
| CSM shadows | `CSMShadowNode`, cascades per §14 | same, max 3 | same, max 3 (validate on `webgl2` in M0, RCT §10 #7) |
| GTAO / bloom / TRAA / SMAA | yes | yes | yes |
| Render bundles for static sets | yes | yes | n/a |
| Max texture size used | 8192 (atlas ≤ 4096) | 4096 | 4096 |
| Max preset offered | Ultra | High | **High** (CPU particle pool, Ultra hidden) |
| Default on Tier B hardware | Medium | Low | **Low** |

### 2.3 Hardware tier and default preset

| Step | Rule |
| --- | --- |
| Classify | Adapter info (WebGPU) or `WEBGL_debug_renderer_info` (WebGL2) against `render/gpu-classes.json`: integrated patterns (Intel UHD/Iris/Arc integrated, "AMD Radeon(TM) Graphics", Radeon 6x0M/7x0M/8x0M, Vega, base Apple M-series) → **Tier B**; discrete laptop/desktop (RTX/GTX/RX, Apple Pro/Max) → **Tier A**; RTX 4070+/RX 7800+ desktop → **Ultra-capable** |
| Benchmark | 3-second warm scene in the lobby measuring GPU ms (timestamps, else frame time) at the candidate preset; step down one preset if > 85 % of the target |
| Defaults | Tier B → Medium (`webgpu`) / Low (`webgpu-compat`); Tier C (`webgl2`) → Low; Tier A → High; Ultra-capable → Ultra |
| Override | Player choice is saved in the profile; a "Restore recommended" button re-runs the benchmark |

Reference GPUs (BF §3.2): Tier A = RTX 4060 Laptop (60 FPS locked); Tier B = Iris Xe 96EU / Arc 140V / Radeon 780M (30+ FPS).

---

## 3. Frame structure

### 3.1 CPU per frame (main thread, order fixed by module-boundaries §4)

| Step | Owner | Tier A ≤ 8 ms | Tier B ≤ 14 ms |
| --- | --- | --- | --- |
| Input + net ingest | gameplay / net | 0.5 | 1.0 |
| Sim predict (fixed 20 Hz steps) | sim | 1.0 | 1.5 |
| Gameplay (camera rig, interaction) | gameplay | 0.5 | 1.0 |
| Animation (mixers, IK) | animation | 1.5 | 2.0 |
| Terrain/dust (CDLOD select, ledger prediction, atlas mgmt) | terrain | 0.8 | 1.5 |
| Visuals/VFX (emitters, light priority) | visuals | 0.3 | 0.5 |
| Render submit (culling, instance buffers, encode, three per-object UBO cost) | render | **2.5** | **4.0** |
| Audio | audio | 0.2 | 0.3 |
| UI flush (store ≤ 15 Hz, label transforms every frame) | ui | 0.2 | 0.5 |
| GC / slack | — | 0.5 | 1.7 |

Revisit trigger (tech-stack §2): WebGPU-path CPU frame time > **6 ms on Tier B** for the MVP scene → Babylon comparison spike.

### 3.2 GPU passes in order (target ms; Tier A = High at 1080p, Tier B = Medium at ≈0.7 scale)

| # | Pass | Notes | Tier A (≤ 14.0) | Tier B (≤ 28.0) |
| --- | --- | --- | --- | --- |
| 1 | Dust compute/raster | Stroke replay, tile rebuilds, ring updates (WDS §7.3–7.5) | 0.5 | 1.0 |
| 2 | Particle simulation | Compute (`webgpu`); CPU path costs 0 GPU | 0.3 | 0.4 |
| 3 | Environment probe update | One cube face per frame, only while a refresh is pending (§5.5); amortised | 0.1 | 0.1 |
| 4 | CSM cascades | Terrain (1 instanced draw per cascade) + casters. Sun by day, Earth at near-side night (§5.2); off at far-side night | 2.0 | 3.0 |
| 5 | Crown Lamp shadow | Local player's lamp when on (every preset); High/Ultra also the 1–2 nearest other lamps in a 512² tile atlas (§5.3) | 0.3 | 0.5 |
| 6 | Depth + normal prepass | High/Ultra only: terrain + large static + vehicles | 0.8 | — |
| 7 | GTAO | High/Ultra: from prepass, before main; Low/Medium: after main from MRT normals at half res | 0.9 | 1.6 |
| 8 | Main opaque — terrain | CDLOD + dust shading (WDS §7.7) + horizon-map far shadow term (§5.2, 2 taps); depth-equal test after prepass. Tier B over 7.0 ms → fallback ladder §14.2 | 2.8 | 7.0 |
| 9 | Main opaque — objects | Characters, vehicles, robots, outpost, builds, props; MRT output + normal + velocity | 2.0 | 4.5 |
| 10 | Sky | Stars, Earth, sun disk; depth-tested, no depth write | 0.2 | 0.3 |
| 11 | VFX layer | Particles, Hop Pack plumes, Flare Beacons, holograms, Inspector's Stamp; separate HDR target with manual depth test, composited after AA | 0.6 | 1.2 |
| 12 | TRAA (High/Ultra) | Velocity-based; TAAU when scale < 1 | 0.6 | — |
| 13 | Bloom | Mip chain from ¼ (or ½) res | 0.5 | 0.8 |
| 14 | Exposure | Histogram or mip chain (§8.4) | 0.1 | 0.2 |
| 15 | Tone map + grade + output | AgX, LUT, visor grade, sRGB | 0.3 | 0.4 |
| 16 | SMAA (Low/Medium) | Display-referred | — | 0.8 |
| 17 | Sharpen + upscale to canvas | CAS-style sharpen; bilinear/FSR1-style when not TAAU | 0.2 | 0.5 |
| — | Headroom | Driver, compositor, spikes | 1.7 | 5.8 |

The DOM UI is composited by the browser outside these numbers (keep it cheap, §15).

---

## 4. Camera, depth and precision

| Item | Decision |
| --- | --- |
| Precision | World float32 is accurate to 0.12 mm at 2 km (WDS §1, §3.6). CPU matrices are doubles; terrain is made camera-relative in its vertex shader. **No floating origin, no `Renderer.highPrecision`** |
| Depth | Reversed-Z, near 0.05 m, far 30 km (orbit). Fallback without reversed-Z: near 0.1 m / far 6 km surface camera; orbit camera near 5 m |
| Horizon | 82.5 m at 1.7 m eye height — the main culling lever (§10) |
| Colour space | Linear sRGB working space, half-float HDR, sRGB output |

---

## 5. Lighting

Intensities are in scene units chosen so the day exposure is fixed (§8.4); ratios matter, not absolute lux.

### 5.1 Light rig (`visuals/lighting`)

| Light | Type | Value [R] | Notes |
| --- | --- | --- | --- |
Intensities, colours and the exposure curve are authored in [art-direction §2.1–2.2](../design/art-direction.md#21-light-rig-one-rig-every-time-of-day) (physical lux / cd, pre-exposed on the CPU, §8.4). This table fixes the light *types* and shadow rules only.

| Light | Type | Rule | Notes |
| --- | --- | --- | --- |
| Sun | `DirectionalLight` + `CSMShadowNode` | Flat-ground illuminance E_flat = 133,800 lux × sin(elevation) | Direction from the sim's day/night clock (60-min cycle, 30/30, mechanics §5). Same white at every elevation |
| Earthshine | `DirectionalLight`; **casts shadows at near-side night by taking over the sun's CSM** (§5.2) | Authored lux × Earth phase × smoothstep(Earth elevation −2°…+5°) | Cool white; boosted ×30 over physical (art-direction D-06). Night ratio Earth:sun is defined there, not here |
| Regolith bounce fill | `HemisphereLight` used as a **normal-dependent ambient**, *not* as a sky: sky colour = warm grey `#8C8478` × 0.15 × E_key, ground colour = same × 0.35 × E_key, where E_key is the flat-ground illuminance of the active key (sun by day, earthshine at night) | Up-facing 15 %, vertical 25 %, down-facing 35 % of E_key | Stylised lunar fill (art-direction D-05): up-facing ground, rock tops and roofs get fill, which a black-sky hemisphere cannot give. Attenuated by GTAO (indirect only, §8.1). Specular-only environment probe (§5.5) so fill is not double-counted |
| Far-side night floor | ambient term | Authored lux (art-direction D-07) | Only where the Earth is below the horizon |
| Crown Lamp (local player) | `SpotLight` with our own angular profile LUT | §5.3 | **Shadowed on every preset** (one shadowed spot, budgeted in §3.2 row 5) |
| Other players' Crown Lamps | spot, clustered | same per level | High: nearest 1 shadowed; Ultra: nearest 2. All other lamps unshadowed **with range clamped to 8 m and a fade from 6 m**, so unshadowed light never reaches past a rock or wall into the area behind it |
| Vehicle Running Lamps, outpost work lights, robot status lights, Flare Beacon glow | point/spot via clustered lighting | caps §5.4 | Unshadowed; same 8 m clamp for spots brighter than a Clip Light, except outpost floods, which are static and placed (level-design rule) so their pools do not cross large occluders |

### 5.2 Sun (and Earth) shadows

Cascade count, map size, max far, cascade-0 split and texel size per preset: **§14 only** (canonical). Rules common to all presets:

| Item | Rule |
| --- | --- |
| Splits | `custom` mode: cascade 0 ends at the §14 split, remaining cascades practical λ 0.75 (Ultra 0.8). Cascade-0 texel t is quoted for the third-person camera (vFOV 60°, 16:9) |
| Filtering | `PCFShadowMap` with bilinear taps, kernel chosen so the **filter's own 10–90 % width is ≈ 1.5 texels** on every preset and cascade. Sharpness is set by the cascade texel, not by the kernel |
| Edge model (used by every acceptance bar) | 10–90 % world edge width **W = 0.00925 · d + 1.5 · t**, where d is the occluder-to-receiver distance (physical 0.53° penumbra ≈ 9.25 mm per m) and t the cascade texel. Screen bar = W ÷ pixel footprint + 1 px (AA/upscale). Derived bars per preset live in [visual-target VT-M0-04](../design/visual-target.md#41-m0-render-spike-and-foundations-v010) |
| Grazing sun | Normal-offset bias scaled by 1 / max(sin(elevation), 0.05) plus slope-scaled depth bias; receiver-plane bias on terrain. Tested at sun 60°, 15°, 4° and 1° (VT-M0-04b) for acne, peter-panning and contact gaps |
| Cascade fade | on (`fade: true`), blend band ≥ 10 % of cascade depth; `lightMargin` 300 m (tall crater rims at grazing sun) |
| Contact-hardening | off |
| Stabilisation | Cascade texel snapping; sun direction updated every frame but cascade fit re-quantised (sun moves 0.1°/s → shimmer risk, §18) |
| Bias | Re-tune after every three upgrade (bias changed in r183/r187, RCT §1) |
| Night (near side) | When the sun is below −0.5° and the Earth is above +5°, the **same `CSMShadowNode` is re-pointed at the Earth direction** (zero extra cost: the sun casts nothing then). Kernel widened to Earth's 2.4° disk (W = 0.042 · d + 1.5 · t). The swap happens inside the 8 s sunset exposure ramp (art-direction §2.2), with the sun-light intensity already at 0, so it is invisible. Far-side night: CSM off; only lamp shadows |

**Beyond CSM range: horizon map (all presets).** A static, baked **far-occluder horizon map** gives terrain-on-terrain shadows to the horizon on every preset, Tier B and Tier C included:

| Item | Rule |
| --- | --- |
| Data | Per height-cube texel (6 × 512², ≈ 6 m), the horizon elevation angle in **8 azimuths**, 8 bits each (2 × RGBA8, ≈ 12 MiB). Baked by `tools/terrain-bake` from the height cube. Occluders closer than 20 m to the receiver are ignored (that is CSM's job). Static: the terrain never changes |
| Shading | In the terrain pass: interpolate the horizon angle at the sun's (or Earth's) azimuth, shadow = smoothstep(h − δ, h + δ, sun elevation) with δ = 0.53°/2 + the angular error of one texel (≈ 0.5°). Cost: 2 taps + ALU, in the 7.0 ms Tier B terrain line |
| Combination | min(CSM, horizon) everywhere. Inside CSM range both agree because near occluders are excluded from the bake. CSM fades out over the last 15 % of max far; the horizon term continues |
| Handoff bar | Across the seam on P4 (dawn flyover): screen edge-width ratio ≤ 2×, no luma step > 8 on flat ground (VT-M1-08) |
| Objects beyond CSM range | Rocks, hardware and players beyond max far cast no sun shadow; their own shading keeps form (sun N·L + fill). This is accepted at > 80 m because they are ≤ 20 px tall there |
| Fallback | If the M0-W3 spike shows the horizon map is too soft or leaks at crater rims, High/Ultra add the earlier terrain-only ortho depth map (1024² / 2048², refreshed at 1 / 2 Hz) combined by min. Low/Medium keep the horizon map only |

The earlier "far terrain shadow off on Low/Medium" rule is retired: Tier B never loses the long dawn shadows at the CSM edge.

### 5.3 Crown Lamp (helmet lamp) levels

Profiles are **our own** angular falloff LUTs (64 samples, "IES-like"), not third-party IES files.

| Level (naming bible) | Range (own lamp) | Cone (outer/inner) | Relative intensity |
| --- | --- | --- | --- |
| Clip Light | 12 m | 35° / 20° | 1.0 |
| Spot Ring | 20 m | 40° / 25° | 1.8 |
| Wide Halo | 30 m | 55° / 35° | 2.6 |
| Searchlight | 45 m | 30° / 12° + 70° spill at 15 % | 4.0 |

Absolute candela values: art-direction §2.2. Own-lamp shadow map size and the number of other shadowed lamps per preset: §14. Other players' unshadowed lamps use the 8 m clamp (§5.1) whatever their level; their *cone and colour* stay correct, so pools still read as theirs. Lowlight Visor: a post grade (§8.3), not a light. Lamp colour: warm white tinted 10 % toward the player colour.

### 5.4 Local light budget (clustered lighting, r185+ Forward+ system; class name per vendored example `webgpu_lights_clustered`)

Max active non-sun lights and shadowed spots per preset: §14. Priority: intensity ÷ distance², always keep own lamp; fade in/out over 0.3 s, no pops. Outposts beyond the horizon are culled with their lights.

### 5.5 Environment probe (reflections for metals, glass and visors)

With a black sky, metals and the visor reflect nothing unless we give them an environment. One **specular-only** probe serves the whole scene:

| Item | Rule |
| --- | --- |
| Content | Rendered, not authored: a cube capture at a probe point near the local player containing **terrain only** (CDLOD at coarse LOD, dust shading on, lit by the current key and fill), the **Earth disk** (phase-correct), and a black sky. The **sun disk is excluded** (the directional light's analytic specular already gives the sun highlight; including it would double-count and break FP16). Stars excluded |
| Format | Cube 128² per face (Low 64²), RGBA16F, prefiltered with PMREM (r187 cube-render-target path; verify, §21) → ≈ 0.8 MB |
| Refresh | When the key-light elevation changes by > 2° (Low 5°), at the day/night swap, or when the player moves > 100 m from the probe point. One face per frame (6 frames), then PMREM; cross-fade old → new over 0.5 s. Never re-rendered every frame |
| Use | `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` **specular IBL only**; the diffuse/irradiance part is disabled (fill comes from §5.1), so nothing is double-lit. Applies to hardware, visors, smoked glass, Glow/Brushed finishes. Terrain does not sample it |
| Interiors / outposts | One extra static probe per outpost (baked at load, refreshed with the TOD rule) used inside its bounds |
| Budget | GPU 0.1 ms amortised (§3.2 row 3), memory ≈ 1 MB per probe; same on every preset (only the face size differs) |
| Exempt from | The "no fog, no haze" rule does not apply: the probe contains no atmosphere, only terrain and Earth |
| Acceptance | VT-M1-32 (metal sphere and visor at noon, dawn, night) |

---

## 6. Sky (`visuals/sky`)

| Element | Decision |
| --- | --- |
| Background | Pure black; no gradient, no nebula (the reference game's blue nebula is a stated shortfall, VA §2.1) |
| Stars — data | **HYG Database v4.x, CC BY-SA 4.0**; stars with V ≤ 6.5 (naked-eye set) baked offline (technical-artist, `tools/asset-pipeline`) into `stars_hyg.bin`: direction in the world frame (ecliptic north ≈ +Y), magnitude, B−V colour. The bake reads **only** the position, `mag` and `ci` columns (for V ≤ 6.5 these come from Hipparcos/Yale/Gliese) and **never** a Gaia cross-identifier or Gaia-derived column; the bake script asserts this. **No NASA SVS Deep Star Maps.** Gaia is excluded by policy; the Gaia licence wording in [licensing §5](../research/asset-and-data-licensing.md) is under verification by docs-keeper from the primary source. Alternative under evaluation: Yale Bright Star Catalogue 5th ed. (≈ 9,100 stars, V ≤ 6.5) if its terms verify as unrestricted, which would remove share-alike |
| Stars — licence | The baked file ships as a **separate file under CC BY-SA 4.0** with its own notice. Credits and `docs/ASSET_LICENSES.md`: "Star data: HYG Database (astronexus.com), CC BY-SA 4.0; derived star file © Clean The Moon! contributors, CC BY-SA 4.0." Share-alike on screenshots/trailers: open question for docs-keeper (same check as above) |
| Stars — visibility model (one model) | Limiting magnitude from the scripted exposure: **m_lim = clamp(6.5 − (EV100 − 7.3) × 4/7, 2.0, 6.5)** → night 6.5, dawn ≈ 4.2, noon (EV 14.3) 2.5. Stars with V ≤ m_lim are drawn; a 0.5-mag soft fade avoids pops. Setting "Realistic" sets m_lim = −2 whenever the sun is up (no daytime stars). Preset caps (§14) can only lower m_lim |
| Stars — render | Drawn **after AA and upscaling, at output resolution**, as analytic Gaussian disks with radius ≥ 1.2 output px (1.2–2.0 px by magnitude, constant at any DPR), depth-tested against the upsampled scene depth (nearest). Brightness ∝ 10^(−0.4·mag). No twinkle. This keeps 1-px stars stable on SMAA presets and under TAAU (§8.1) |
| Earth — texture | **NASA Blue Marble Next Generation** (day, with clouds) and optional Black Marble (night lights), KTX2, **capped at 2048 × 1024** (Low/Medium 1024 × 512; photo-mode telephoto at ≈ 173 px needs no more). Credit "NASA Earth Observatory / NASA Visible Earth" (NASA credit mandatory) |
| Earth — geometry | Sphere drawn at sky distance; apparent diameter **2.4°** default [R] (real 1.9°, stylised up for readability); fixed over the sub-Earth point (+X) with optional ±1° libration wobble per day cycle |
| Earth — shading | Phase from the sun direction; soft terminator; thin blue Fresnel limb glow; night side shows Black Marble lights at low intensity |
| Sun disk | 0.53° HDR disk with limb darkening, intensity well above the bloom threshold, small glare sprite; occluded by terrain depth. Lens flare off (Ultra photo mode option) |

---

## 7. Materials (hooks only; look owned by technical-artist)

| Material | Notes |
| --- | --- |
| Regolith + dust | Custom TSL on `MeshStandardNodeMaterial`. **All albedo, roughness, opposition (backscatter) and sparkle values come from [art-direction §3.2](../design/art-direction.md#32-material-values)** (grime ≈ 0.085, clean ≈ 0.34 linear; opposition caps D-20); this file does not restate them. Lunar-Lambert blend for a flat orbit look, tuned so the BRDF stays within ±5 % of Lambert at phase 60–120° (the calibration range of VT-M0-06). Detail texture density per preset: §14. Stochastic anti-tiling. Dust coverage, partial-removal (thinning), berm, lane stripes and footprints: [art-direction §3.3–3.5](../design/art-direction.md#33-stroke-edge-and-berm) for the look, WDS §7.5–7.7 for the data |
| Terrain cavity (all presets) | A cheap cavity term from the height-cube gradient and the detail height (concave → darker indirect light, max −35 %) multiplies the fill only. It gives contact darkening around rocks, berms and crater rims on presets where GTAO is half-res, and costs no extra pass |
| Hardware | `MeshStandardNodeMaterial` / `MeshPhysicalNodeMaterial` (clearcoat for painted panels), KTX2 UASTC normals, ETC1S bulk (ADR-0013). Specular from the environment probe (§5.5) |
| Dusty hardware | Shared "grime" TSL function: cavity/upward-facing dust from AO + world-up; Brightside signage stays readable |
| Permutation discipline | Toggles are TSL `uniform`s, not new materials; one material per surface family; target ≤ 60 distinct pipelines in a frame |

---

## 8. Post chain (`RenderPipeline`, ADR-0005)

### 8.1 Order

1. `pass(scene, camera)` with MRT: output (RGBA16F), normal (Low/Medium), velocity (High/Ultra).
2. GTAO: High/Ultra use the official r187 prepass pattern so AO attenuates **only indirect light** (ground bounce, earthshine, night floor) — a hard-sunlit surface must not darken. Low/Medium: half-res GTAO from MRT normals, composited as a multiply at strength 0.5. Verify the pattern in example `webgpu_postprocessing_ao`.
3. TRAA (High/Ultra), or TAAU when render scale < 1 (example `webgpu_upscaling_taau`). **Velocity:** terrain is static, so its velocity is camera-only reprojection from depth (no per-vertex velocity needed for camera-relative CDLOD); instanced/batched static meshes the same; skinned avatars, vehicles and robots write true motion vectors (previous-frame skinning/instance matrices). Verified in the M0 bench (§21). Dynamic-resolution steps resample the history instead of resetting it (§9).
4. VFX layer composited (after AA, so dust grains do not ghost). Stars are drawn here too, at output resolution (§6).
5. Bloom (`BloomNode`): **threshold 4.0 (scene-linear, after pre-exposure; ≈ +2 EV over display white), soft knee 0.5, strength 0.06, radius 0.35**, one set of values for every preset (single source; art-direction §2.5 points here). Only the sun disk, Earth limb, lamps and emissives exceed it. Sunlit clean ground is ≈ 0.6–0.7 and ivory paint ≈ 1.2 after exposure, so they never bloom; clean-ground sparkle is clamped to ≤ 0.6 × threshold (VT-M1-29).
6. Exposure adaptation multiplier (§8.4).
7. Tone mapping: **AgX default**, ACES Filmic selectable in Settings; Neutral available in debug only. Then optional 3D LUT grade and Lowlight Visor grade.
8. `renderOutput()` (tone map + sRGB once). `RenderPipeline.outputColorTransform = false` so steps 9–10 run display-referred (verify property name in r187).
9. SMAA (Low/Medium).
10. Sharpen (CAS-style TSL node) and upscale to the canvas.

No motion blur, DOF or SSR in gameplay; DOF only in photo mode (§16).

### 8.2 Parameters

Per-preset post knobs (GTAO resolution/samples/radius, AA, upscaler, sharpen, bloom resolution) are in **§14**. HDR buffer: half-float on every preset.

**Temporal stability on SMAA presets (Low/Medium).** SMAA is spatial only, so sub-pixel detail must be removed before it can crawl:

| Source | Rule on SMAA presets and whenever render scale < 0.75 |
| --- | --- |
| Clean-ground sparkle | World cell 2 cm (not 1 cm), fades out from 8 m to 12 m (TRAA presets: 15–25 m) |
| Lane stripes, fine tread, noise-thresholded edges | Threshold width w is never below 1 output px (screen-derivative w, WDS §7.7); stripe anisotropy fades with distance from 20 m (TRAA: 40 m) |
| Stars | Post-upscale Gaussian disks (§6) |
| Thin rails / Mesh finish | Alpha-to-coverage off on SMAA presets; Mesh finish uses a mip-biased opacity texture |

Acceptance: VT-M1-28 (per-pixel luma variance metric with a bar per AA mode).

### 8.3 Lowlight Visor grade

Exposure +3 EV, green-amber split-tone LUT, shadow lift 30 %, bloom on lamps reduced 50 %, faint scanline vignette. Cycled with `N` (lamp / visor / off) per naming bible.

### 8.4 Exposure (one architecture; art-direction §2.1–2.2 points here)

| Item | Decision |
| --- | --- |
| Key exposure (CPU, deterministic) | **EV100 is a scripted function of the key-light elevation** (sun by day, Earth at near-side night; table in [art-direction §2.2](../design/art-direction.md#22-time-of-day-script)). The CPU computes it every frame and **pre-exposes** all lights and emissives with scale = 1 / (1.2 × 2^EV100), so the half-float buffer holds display-relative values. Tone-map exposure stays 1.0 |
| Adaptation (GPU only, no readback) | A multiplier applied at the tone-map input, from the luminance histogram (`webgpu`, 64 bins, ignores top/bottom 5 %, never meters sky pixels) or mip-chain average (`webgpu-compat`, `webgl2`). It never feeds back to the CPU, so pre-exposure never waits on the GPU |
| Multiplier range | **−0.5 … +1.0 EV** around the key (the +1.0 lets a crater interior or deep shadow brighten). Night uses the same range: the key already moves to the night EV |
| Adaptation speed | Scene gets **brighter** → exposure falls at **3 EV/s**; scene gets **darker** → exposure rises at **1.5 EV/s**. Sunset/terminator: the scripted key ramps over 8 s |
| Capture / screenshot-test mode | Multiplier forced to 0 EV: exposure is exactly the scripted EV100 recorded in the sidecar, so every capture is reproducible and the art-direction §2.3 luma targets apply exactly |
| FP16 safety | Pre-exposed values are clamped to ≤ 30,000 (sun disk, lamp cores) before they enter the buffer |
| Settings | Brightness slider ±1 EV (applied as a fixed offset to the multiplier; captures use 0) |

---

## 9. Dynamic resolution controller (`render/dynres.ts`)

| Item | Decision |
| --- | --- |
| Signal | GPU frame time from timestamp queries (`webgpu`, or `webgl2` with the timer extension). Without timestamps: **vsync-aware heuristic** on the CPU frame interval: a frame counts as GPU-bound only if its interval exceeds the display refresh interval by > 20 % for 3 of the last 5 frames (vsync-bound frames at exactly the refresh interval are ignored) |
| Targets | High/Ultra: **14.0 ms GPU** (60 FPS). Low/Medium: **28.0 ms GPU** (30 FPS) |
| Ranges and DPR caps | §14 (canonical). Output = CSS × min(DPR, cap) |
| Control law | Every 0.5 s on the last 30 frames' p90: if > 1.05 × target → scale −0.10; if < 0.80 × target for 4 s → scale +0.05. Hysteresis: no reverse step within 4 s of a step; at most one change per 2 s; clamp to range |
| History | TAAU/TRAA history is **resampled** to the new scale, not reset; the 2 frames after a step blend 50 % current / 50 % resampled history, so the image does not "breathe" (scale-step pulse check in VT-M1-28) |
| Mechanism | Per-pass `setResolutionScale` (r181+; verify, §21) for scene, AO and bloom passes; fallback if absent: one internal render target resized at the step. Output and DOM always native |
| Floor reached and still slow | After 10 s at the floor, show "Lower preset?" toast (no automatic preset change) |
| Off | Disabled in capture/screenshot-test mode (BF §8.2) |

---

## 10. Culling, LOD, instancing, draw-call budget

### 10.1 Strategy

| Topic | Decision |
| --- | --- |
| Terrain | CDLOD, one instanced draw per pass (WDS §3.6) |
| Horizon culling | Every object and CDLOD node: hidden if its bounding sphere lies entirely below the horizon of the moon sphere (R + global minimum height) as seen from the camera. At 82.5 m ground horizon this removes almost the whole world |
| Frustum culling | three default per object + our per-node test |
| Distance culling | props 150 m, Dust Pucks 120 m, robots 300 m, player builds 400 m (× preset multiplier 0.6 / 0.8 / 1.0 / 1.3) |
| Repeated props/rocks | `InstancedMesh` per type (≤ 8 types visible) |
| Robots | `InstancedMesh` per robot type × part (rigid parts animated via instance matrices) |
| Dust Pucks | One `InstancedMesh` (cap 500 / 1,000 / 2,000 / 4,000 visible) |
| Player builds (Deck Plates, Gantries, Rails & Railings, Panels, Glide Rail, machines) | `BatchedMesh` per surface finish (Brushed, Tread, Mesh, Glow, Chevron) + Glide Rail + machines; LOD by per-instance geometry swap |
| Outposts | Static, merged by material; WebGPU render bundles; only the nearest is ever above the horizon |
| Characters | ≤ 2 skinned draws per player (body+helmet merged with a material atlas; tool) |
| Vehicles | ≤ 3 draws each (body, wheels/tracks instanced, attachments) |
| LOD meshes | glTF with 3 LODs (meshopt simplify), screen-size switching with 10 % hysteresis |
| GPU occlusion queries | Not in MVP (horizon culling suffices) |

### 10.2 Draw-call budget (all passes per frame; per preset in §14: High/Ultra ≤ 600, Low/Medium ≤ 350, which is the Tier A / Tier B+C budget of performance-budgets §4)

"A" columns = High; "B" columns = Medium (Low is the same minus one cascade).

| Category | A main | A prepass | A shadows (all) | B main | B shadows |
| --- | --- | --- | --- | --- | --- |
| Terrain | 1 | 1 | 4 | 1 | 3 |
| Sky (stars, Earth, Earth limb, sun) | 4 | — | — | 4 | — |
| Players (16 × 3) | 48 | — | 48 | 48 | 32 |
| Vehicles (≤ 12 visible × 3; B ≤ 8) | 36 | 36 | 36 | 24 | 12 |
| Robots (3 types × 3 parts) | 9 | 9 | 9 | 9 | 3 |
| Nearest outpost | 40 | 40 | 40 | 30 | 15 |
| Player builds (BatchedMesh) | 10 | 10 | 10 | 10 | 5 |
| Dust Pucks | 1 | — | 1 | 1 | — |
| Props/rocks | 8 | 8 | 8 | 8 | 4 |
| Flare Beacons, holograms, signage | 6 | — | — | 6 | — |
| VFX layer | 4 | — | — | 4 | — |
| Crown Lamp shadow casters (≤ 30 m) | — | — | 40 | — | 20 |
| Compute dispatches + texture copies | 12 | | | 8 | |
| Post passes | 20 | | | 16 | |
| **Subtotal** | **199** | **104** | **196** | **169** | **94** |
| **Total / budget** | **499 / 600** | | | **263 / 350** | |

Triangles per frame: per preset in §14. The debug HUD flags any frame over budget in red.

---

## 11. Particles (`visuals/vfx`)

| Item | Decision |
| --- | --- |
| Physics | Ballistic only, **no drag, no lingering clouds** (vacuum): x(t) = x₀ + v₀t + ½gt², g = 1.62 m/s² toward the moon centre at the emitter. A 3 m/s grain at 45° flies 5.6 m over 2.6 s (VA 3.16) |
| Ground hit | `webgpu`: compare with H sampled from the height texture in the compute kernel, then kill; CPU path: emitter tangent plane |
| Look | **One colour rule** (art-direction §3.6): grime-tinted grains (they are the removed dust), lit as tiny spheres by key + fill with no self-shadow; **15 % are glint grains** that flash to 2× brightness as they tumble in direct light (still below the bloom threshold). Velocity-stretched quads, 1–3 cm world size, **never below 2 output px** (size grows to keep 2 px when the camera is far or render scale is low). High/Ultra sample CSM; soft-particle depth fade near ground |
| Emitters | Cleaning strokes (rate ∝ grams removed, 0.5–2.5 m/s, 20–60°), vehicle intakes and wheel rooster tails (2–5 m/s), footsteps (≈10/step), Railshot launch bursts (≈500), Puck Former puffs, Hop Pack plumes (white cold gas, fast fade), Inspector's Stamp burst (≈64, stylised) |
| Pool sizes | §14 (GPU pool on `webgpu`, CPU pool on `webgpu-compat`/`webgl2`; CPU path uses typed arrays, one instanced-attribute upload per frame, ≤ 0.6 ms CPU) |
| Minimum-juice floor (Low, CPU path) | Hand-tool strokes are never thinned: a Desk Duster or Crescent Squeegee stroke emits the same grain count on every preset (they are small). Caps only bite on Static Rake, Ion Curtain and vehicles, where the CPU path emits **fewer but larger grains** (size × √(High rate ÷ capped rate), max 2×), so the stroke still reads as a burst (VT-M1-16b) |
| Ballistics test hook | Dev builds expose a telemetry hook that tracks N seeded grains per frame (position, time) for `tools/screenshots/measure`; ballistics are checked against x(t) numerically, not from video |
| Overflow | Oldest-first recycling; emitters scale rates by budget pressure |
| Draws | ≤ 4 (grains, gas, sparks, stamp) |

---

## 12. Shader and pipeline warm-up (during load / "Clock In")

| Step | Detail |
| --- | --- |
| 1. Manifest | `render/pipelines.manifest.ts` lists every material family × variant (static/instanced/batched/skinned × shadow-receive × lamp-on) and every compute kernel. CI fails if a frame in the screenshot suite creates a pipeline not in the manifest |
| 2. Compile | Warm-up scene with one instance of each variant, all lights and both lamp states → `renderer.compileAsync(scene, camera)` (parallel in r187) and `compileComputeAsync` for dust/particle/exposure kernels |
| 3. Shadow gap | `compileAsync` does not compile shadow pipelines (#35086) → render **2 hidden warm-up frames** into a 256² target with all cascades, the own-lamp shadow and the other-lamp shadow tiles enabled, plus one environment-probe face and PMREM pass |
| 4. Post | Build the `RenderPipeline` for the active preset and render it once |
| 5. Preset change | Rebuild post + warm-up behind a 1.5 s "Applying settings" overlay |
| Budget | Pipelines ready ≤ 4 s Tier A, ≤ 8 s Tier B; reported as `pipelinesReadyMs` telemetry |
| Never | Create materials/pipelines on first use during gameplay |

---

## 13. GPU memory budget (no browser API reports VRAM, BF §4 — we account every allocation)

| Item | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| Material texture pool (§14) | 480 MB | 600 MB | 1,536 MB | 3,072 MB |
| Geometry (meshes, instances) | 100 MB | 120 MB | 200 MB | 250 MB |
| Render targets (at max scale; 1080p High ≈ 140 MB, 1440p ≈ 250 MB) | 40 MB | 60 MB | 250 MB | 400 MB |
| Shadow maps (CSM 32-bit depth + own lamp + other-lamp tiles) | 9 MB | 16 MB | 53 MB | 82 MB |
| Terrain + dust (WDS §9: 42 / 50 / 81 / 97) + horizon map 12 + ring direction R8 (1 / 1 / 4 / 4) + atlas direction R8 (0 / 4 / 8 / 16) | 55 MB | 67 MB | 105 MB | 129 MB |
| Environment probes (player + nearest outpost) | 1 MB | 2 MB | 2 MB | 2 MB |
| Particles | < 1 MB | 1 MB | 3 MB | 6 MB |
| **Total** | **≈0.69 GB** | **≈0.87 GB** | **≈2.15 GB** | **≈3.94 GB** |
| Tier ceiling (performance-budgets §4) | Tier C ≤ 1.0 GB | Tier B ≤ 1.25 GB | Tier A ≤ 3.0 GB | Desktop ≤ 5–6 GB (BF) |

On an out-of-memory error or device loss: recreate the device and drop one preset step (BF §4).

---

## 14. Quality presets — **THE canonical preset table** (contract `shared/render/quality.ts`)

**This table is the only place preset numbers are defined.** [visual-target.md](../design/visual-target.md), [art-direction.md](../design/art-direction.md), [world-and-dust-simulation.md](world-and-dust-simulation.md) and [performance-budgets.md](performance-budgets.md) link here and must not restate different values. When `shared/render/quality.ts` exists it is generated from (or checked against) this table by a unit test; a change here is a PR that names the knob. Tiers and backends: §2.1 naming.

### 14.1 Preset table

| Knob | Low | Medium | High | Ultra |
| --- | --- | --- | --- | --- |
| **Intended for** | Tier C (`webgl2`) and Tier B on `webgpu-compat`; fallback for Tier B | Tier B on `webgpu` | Tier A | Ultra-capable desktop |
| Target FPS / GPU ms | 30 / 28 | 30 / 28 | 60 / 14 | 60 / 14 |
| **Render scale range** (× output) | 0.50–0.75 | 0.60–0.85 | 0.75–1.00 | 0.85–1.00 |
| DPR cap | 1.0 | 1.0 | 1.5 | 2.0 |
| **AA / upscale** | SMAA / bilinear | SMAA / FSR1-style (`webgpu_upscaling_fsr1`) | TRAA / TAAU | TRAA / TAAU |
| Sharpen (CAS-style) | 0.30 | 0.25 | 0.20 | 0.15 |
| **CSM cascades × size** | 2 × 1024² | 3 × 1024² | 3 × 2048² | 4 × 2048² |
| Shadow max far | 80 m | 120 m | 200 m | 300 m |
| Cascade-0 split → texel t (vFOV 60°) | 10 m → ≈ 2.4 cm | 10 m → ≈ 2.4 cm | 8 m → ≈ 1.0 cm | 6 m → ≈ 0.7 cm |
| PCF filter 10–90 % width | ≈ 1.5 texels | ≈ 1.5 texels | ≈ 1.5 texels | ≈ 1.5 texels |
| Night Earth shadows (CSM re-pointed, §5.2) | on | on | on | on |
| Horizon map (far terrain shadow, §5.2) | on | on | on | on |
| Own Crown Lamp shadow map | 512² | 1024² | 1024² | 2048² |
| Other players' shadowed lamps (512² tiles) | 0 | 0 | 1 | 2 |
| Unshadowed lamp range clamp | 8 m | 8 m | 8 m | 8 m |
| Max local lights | 8 | 16 | 32 | 64 |
| Environment probe face size (§5.5) | 64² | 128² | 128² | 128² |
| Depth/normal prepass | off | off | on | on |
| **AO**: GTAO res / samples / radius | ½ / 8 / 1.0 m + cavity term | ½ / 12 / 1.2 m + cavity term | full / 16 / 1.2 m | full / 16 + denoise / 1.5 m |
| Bloom res / mips (threshold/strength fixed, §8.1) | ¼ / 3 | ¼ / 4 | ½ / 5 | ½ / 5 |
| Tone mapping | AgX (ACES option) | AgX | AgX | AgX |
| Exposure adaptation source | mip chain | histogram (`webgpu`) | histogram | histogram |
| CDLOD leaf level / patch | L8 / 17² | L8 / 33² | L8 / 33² | L9 / 33² |
| CDLOD range multiplier | 0.75 | 1.0 | 1.25 | 1.5 |
| Procedural detail (crater bands + noise octaves) | 2 + 1 | 3 + 1 | 3 + 2 | 3 + 2 |
| Regolith texel density ≤ 5 m / at 50 m | 512 / 128 px/m | 768 / 192 px/m | 1024 / 256 px/m | 1024 / 256 px/m + 2nd detail layer |
| Anisotropy | 4 | 8 | 8 | 16 |
| **Texture pool** | 480 MB | 600 MB | 1.5 GB | 3 GB |
| **Dust atlas** slots × size (texel) | 512 × 64² (40 cm) | 1,024 × 64² (40 cm) | 512 × 128² (20 cm) | 1,024 × 128² (20 cm) |
| Dust residency radius | 80 m | 120 m | 160 m | 220 m |
| Tile rebuilds / frame | 2 | 3 | 6 | 10 |
| **Dust detail ring** size @ texel (side; radius) | 1024² @ 4.0 cm (41 m; ≈ 20 m) | 1024² @ 3.5 cm (36 m; ≈ 18 m) | 2048² @ 2.5 cm (51 m; ≈ 25 m) | 2048² @ 2.0 cm (41 m; ≈ 20 m) |
| Ring ↔ atlas cross-fade band | 2 m | 2 m | 2 m | 2 m |
| Stroke-direction textures (lane stripes, print heading; R8) | ring only (print heading); **stripes off** | ring + atlas | ring + atlas | ring + atlas |
| Grime footprint lifetime (clean-ground prints: 30 s on all presets) | 60 s | 120 s | 300 s | 600 s |
| Tread normal stamp | on | on | on | on |
| Berm normals / displacement | derivatives / none | derivatives / none | 4-tap / ≤ 10 m | 4-tap / ≤ 10 m |
| Clean-ground sparkle | 2 cm cells, fade 8–12 m | 2 cm cells, fade 8–12 m | 1 cm cells, fade 15–25 m | 1 cm cells, fade 15–25 m |
| **Particles** GPU pool (`webgpu`) / CPU pool (`webgpu-compat`, `webgl2`) | 8k / 2k | 20k / 4k | 50k / 6k | 100k / — |
| Soft particles | off | on | on | on |
| Stars: m_lim cap (model §6) | 5.5 | 6.0 | 6.5 | 6.5 |
| Earth texture | 1024 × 512 | 1024 × 512 | 2048 × 1024 | 2048 × 1024 + night lights |
| **Draw calls / frame** (all passes) | ≤ 350 | ≤ 350 | ≤ 600 | ≤ 600 |
| **Triangles / frame** (all passes) | ≤ 1.0 M | ≤ 1.5 M | ≤ 4 M | ≤ 6 M |
| Object distance multiplier | 0.6 | 0.8 | 1.0 | 1.3 |
| Robot render distance | 150 m | 200 m | 300 m | 400 m |
| Visible Dust Puck cap | 500 | 1,000 | 2,000 | 4,000 |
| Survey Globe hex mode | off | on | on | on |
| Glass UI `backdrop-filter` | off (strong glass) | off on Tier B (strong glass); on elsewhere | on (≤ 4 panels) | on (≤ 4 panels) |

Every knob is a field in `shared/render/quality.ts` (contract proposal; contracts-architect). Settings UI exposes the preset plus individual overrides for: render scale floor, shadows, AO, AA, particles, bloom, sharpen, tone mapper, star daylight visibility ("Subtle" = model §6, "Realistic" = none by day).

### 14.2 Tier B fallback ladder (pre-declared; applied in order if the M0 bench shows the Medium terrain line > 7.0 ms or total GPU > 28 ms on the Tier B reference device)

| Step | Change | Expected saving |
| --- | --- | --- |
| 1 | Procedural detail 3 + 1 → 2 + 1; one detail-texture layer | ≈ 1.0 ms terrain |
| 2 | Lane stripes off on Medium (skip the atlas direction tap) | ≈ 0.3 ms |
| 3 | Sparkle and mask-gradient berm term skipped beyond 15 m | ≈ 0.3 ms |
| 4 | CSM 3 → 2 cascades (Low layout) | ≈ 0.8 ms shadows |
| 5 | Render-scale floor 0.60 → 0.50 | proportional |

Each step is a `quality.ts` value change, not new code. The savings are estimates to be replaced by the M0 bench numbers. The ladder result is recorded in ADR-0003's follow-up note; steps 1–3 must not move any VT-M1 V1 item below its Medium bar.

---

## 15. UI is DOM

| Item | Decision |
| --- | --- |
| HUD, menus, Requisitions Desk, Promotions Board, Survey Globe overlays | React 19 DOM over the canvas (ADR-0012), always at native devicePixelRatio, text ≥ 14 CSS px; never rendered into the WebGL/WebGPU canvas, so it stays crisp at any render scale |
| World-anchored labels (player names, Flare Beacons, outposts, Plot Card readout) | A label layer that projects positions every frame and writes CSS transforms directly (no React re-render); ≤ 48 labels; hidden below the horizon (analytic test) and faded by distance. Transforms are written **immediately after render submit, from the same camera and interpolated entity matrices used for that frame**, so a tag never trails its avatar by a frame (VT-M1-19b) |
| Canvas sizing | `ResizeObserver` with `devicePixelContentBoxSize` where available, else CSS size × DPR (Safari, BF §6) |
| Cost rules | Animate only `transform`/`opacity`; **no `backdrop-filter` over the canvas on any Tier B or Tier C device, whatever the preset** (strong glass instead, §14); ≤ 1,500 DOM nodes in the HUD; UI store updates ≤ 15 Hz |
| Survey Globe | Full-screen mode rendered by the main renderer (WDS §7.8); DOM draws legends, labels and controls |

---

## 16. Screenshots and photo mode

| Feature | Decision |
| --- | --- |
| Quick screenshot (proposed key F2; bindings owned by gameplay) | Canvas only (no HUD), current resolution, PNG via render-target readback, saved with a Clean The Moon! filename |
| Photo mode (proposed key F9) | HUD hidden; free camera within 30 m of the player, kept above H + 0.3 m; local presentation frozen (entity interpolation and particles paused for rendering; network and sim continue); controls: FOV, exposure ±2 EV, roll, DOF (r180+ DOF node), LUT filters, frame overlays, toggle Earth size realistic/stylised |
| Capture | Supersample up to 2× output (Tier B 1.5×), capped by 8,192 px and 600 MB of extra targets; 16 jittered frames accumulated with TRAA off |
| Multiplayer | Other players see nothing different; photo mode exits on Esc or after 5 min idle |

---

## 17. Debug views (F3; HUD owner performance-profiler, render modes owner rendering-engineer)

| Input | Shows |
| --- | --- |
| F3 | Perf HUD: FPS, CPU ms per module (§3.1 rows), GPU ms per pass (§3.2 rows, timestamps or "n/a"), draw calls per pass vs budget, triangles, render scale, preset, backend (`webgpu`/`webgpu-compat`/`webgl2`), hardware tier (A/B/C), VRAM accounting (§13), pipelines created this session, dust stats (strokes/s, atlas slots used, rebuild queue, ring anchor), net bytes/s |
| Shift+F3 (cycle) | Render debug views: albedo · normals · lighting only · AO only · shadow cascades (tinted) · CDLOD level · CDLOD morph factor · cube face · plot ID (hash colours) · plot state · atlas residency · raw dust R / berm A / unpolish G / untrampled B · stroke direction · horizon-map shadow · detail ring footprint and cross-fade band · ledger overlay (local copy, 0.8 m grid) · overdraw · velocity · environment probe (cube faces) |
| Ctrl+F3 (dev builds) | Official three.js Inspector addon (timeline, node viewer, colour grading) |
| Export | "Copy stats" button writes JSON for `tools/perf` reports |

All debug views are TSL uniform switches in existing materials (no extra pipelines in normal play).

---

## 18. Known three.js risks and mitigations

| Risk (evidence) | Mitigation | Owner |
| --- | --- | --- |
| #30560 per-object CPU/UBO overhead on WebGPURenderer, ≈2× CPU of WebGLRenderer in a r183 benchmark (RCT §2.1) | Draw budget §10.2; instancing/BatchedMesh; render bundles for static sets; one-draw CDLOD; CPU submit target 2.5 / 4 ms; revisit trigger at 6 ms Tier B | rendering-engineer |
| API churn (RCT §1): `PostProcessing` → **`RenderPipeline`** (r183), `renderAsync` deprecated (r181, use `await renderer.init()` + `render`), `PCFSoftShadowMap` removed (r186), `RGBELoader` → `HDRLoader`, `Clock` → `Timer`, `colorBufferType` → `outputBufferType`, TSL renames (r185) | Pin `three@0.187.0`; vendored docs; one upgrade owner; quarterly upgrade with Migration Guide walk-through and screenshot re-baseline | rendering-engineer |
| Legacy code from agent habits | **ESLint ban-list**: `WebGLRenderer`, `EffectComposer`, `three/examples/jsm/postprocessing/*`, `ShaderMaterial`, `RawShaderMaterial`, `onBeforeCompile`, `PCFSoftShadowMap`, `renderAsync`, `RGBELoader`, `Clock`, `PostProcessing`; R3F and `pmndrs/postprocessing` imports banned | devops-engineer |
| #35086 shadow pipelines not precompiled | Hidden warm-up frames (§12) | rendering-engineer |
| #33821 slow material init | Few material families; warm-up behind loading | rendering-engineer |
| #33795 storage-texture writes not visible in the same frame | Scratch + `copyTextureToTexture` (WDS §7.3), or accept 1 frame latency | terrain-dust-engineer |
| #32735 compute pipeline caching | Build compute nodes once at init; never per frame | terrain-dust-engineer |
| #34720 node build failure silently falls back to a bare material | Dev build hooks console errors from node builds and throws; screenshot tests catch grey materials | rendering-engineer |
| WebGL2 backend lacks compute/atomics (RCT §2.2) | Fragment twins for dust, CPU particles, mip-chain exposure (§2.2); CI runs every scene with `forceWebGL` | all render roles |
| CSMShadowNode untested on the WebGL2 backend | M0 spike (§21); fallback `SunLight` 2-cascade on `webgl2` | technical-artist |
| Look drift between releases (PMREM, GTAO, energy) | Golden screenshots per preset re-baselined on upgrade | visual-qa-reviewer |
| Device loss (BF §1.5) | Recreate device; rebuild GPU state from CPU copies; drop a preset after 2 losses | rendering-engineer |
| Sun moves 0.1°/s → cascade shimmer | Texel snapping, PCF, TRAA; shimmer metric in the verification table | technical-artist |
| TRAA ghosting on fast dust and sparkles | Particles composited after AA; sparkle clamp and world-stable hash | technical-artist |
| TRAA ghosting on terrain (custom CDLOD velocity) | Camera-only reprojection from depth for static geometry (§8.1); verified in the M0 bench | rendering-engineer |
| SMAA presets crawl (sparkle, stripes, stars) | §8.2 stability rules; VT-M1-28 variance metric | technical-artist |
| Tier B terrain line over budget | Pre-declared ladder §14.2 | rendering-engineer + terrain-dust-engineer |

---

## 19. How to verify each item

| Item | Method | Pass criterion |
| --- | --- | --- |
| Backend detection | Playwright CI lane (software WebGL2) + local WebGPU lane; forced `?backend=` both ways | Correct backend and tier logged; no validation errors; graceful `webgl2` on missing WebGPU |
| Frame budgets (§3) | `tools/perf` fixed camera paths (walk 1.7 m, vehicle 20 m/s, orbit, 16-bot cleaning) on RTX 4060 Laptop, Iris Xe 96EU, Arc 140V; GPU timestamps per pass | Tier A p95 ≤ 20 ms frame, avg 16.7; Tier B avg ≤ 33.3, p95 ≤ 40 (VA §4) |
| CPU submit / #30560 | Perf HUD CPU rows on Tier B, WebGPU path | ≤ 4 ms render submit; total ≤ 6 ms render-related (revisit trigger) |
| Draw-call budget | Perf HUD counters during the 16-bot scene at an outpost | §14 per preset (≤ 600 High/Ultra, ≤ 350 Low/Medium) |
| Shadows | VT-M0-04 / VT-M0-04b (post, rock, boots at sun 60°, 15°, 4°, 1°); cascade debug view | Edge width per the §5.2 edge model; no acne, no peter-panning, contact gap ≤ 1 cm; no visible cascade seams; shimmer ≤ 1 px over 10 s of sun motion |
| Horizon-map handoff | P4 dawn flyover; horizon-map debug view | Edge-width ratio ≤ 2× across the seam, no luma step > 8 (VT-M1-08) |
| Night shadows and lamp leaks | S06 with Earth shadows and a 1 m rock between lamp and ground | VT-M1-10b |
| Clean-strip readability | Capture-mode bookmarks (exposure multiplier 0); `tools/screenshots/measure` luma patches | The derived targets in art-direction §2.3 (noon ratio ≥ 1.45 and Δ ≥ 50; other TOD rows there) |
| Environment probe | Metal sphere + visor sample, noon/dawn/night | VT-M1-32 |
| Sky | Visual review vs VA criteria + star count by the measure tool | Black sky; Earth phase consistent with sun; detected star count within ±15 % of the m_lim model (§6) |
| Licences | `docs/ASSET_LICENSES.md` rows for HYG, Blue Marble, LOLA; Credits screen | All three credits present; no Gaia-derived column in the star bake (script assertion) |
| Post chain | Debug views AO-only/lighting-only | Sunlit surfaces unchanged by AO on High/Ultra; bloom only on sun/lamps/Earth/emissives (threshold 4.0, §8.1) |
| Tone mapping | A/B AgX vs ACES on the bookmark set | AgX default; no clipped clean ground in full sun |
| Dynamic resolution | Stress scene with a synthetic GPU load | Converges within 3 s; no more than 1 change per 2 s; never outside range |
| Particles | Count in perf HUD; trajectory check (grain apex and range vs ballistic formula) | Pool reached without frame drop beyond budget; range within 5 % of formula |
| Warm-up | Telemetry `pipelinesReadyMs`; CI check "no new pipeline after warm-up" across the screenshot suite | ≤ 4 s A / ≤ 8 s B; zero runtime pipeline creation |
| Memory | VRAM accounting in perf HUD after 30 min | Within §13 totals ± 10 % |
| DOM UI crispness | Screenshot at DPR 2 with render scale 0.6 | Text and icons pixel-crisp |
| Photo mode | Capture at 2× | Output size correct; no HUD; no ghosting |
| Backend parity | Same bookmarks on `webgpu` and `webgl2` | Differences limited to particle count and exposure-adaptation source |
| r187 features | §21 matrix | Every row PASS or its named fallback adopted |
| Upgrade safety | Golden images per preset | Re-baselined only by the upgrade owner with a note |

---

## 20. Open issues

| # | Issue | Canonical decision kept | Note |
| --- | --- | --- | --- |
| 1 | BF suggests 2,500–4,000 draws on Tier A | **≤ 600 A / ≤ 350 B** | Driven by #30560 |
| 2 | VA proposes 4 × 2048² cascades on High | **3 cascades (Low 2, Ultra 4)** | The horizon map (§5.2) covers distant rims on every preset |
| 3 | VA's "Apollo-documentary realism" vs canonical "bright, readable stylised realism" | **Stylised realism** | Earth enlarged to 2.4°, earthshine boosted, clean ground albedo boosted |
| 4 | AO-on-indirect-only pattern name/API in r187 | Use it on High/Ultra | Verify in the vendored `webgpu_postprocessing_ao`; fallback multiply composite |
| 5 | `RenderPipeline.outputColorTransform` / `renderOutput()` exact names | As in RCT §3 | Verify in vendored docs |
| 6 | WebGPU compatibility-mode adapters via three r187 | `webgpu-compat` only if exposed | Otherwise it collapses into `webgl2` |
| 7 | Reversed-Z on the WebGL2 backend | Reversed-Z | Fallback depth ranges in §4 |
| 8 | Particle velocity for TRAA | Composite particles after AA | Revisit if three velocity MRT supports compute-driven instances |
| 9 | Apple M-series tiering | Base M → Tier B, Pro/Max → Tier A | Not researched (BF §3.2) |
| 10 | Daylight star visibility default | **Resolved:** one m_lim(EV100) model (§6); "Subtle" default, "Realistic" = none by day | — |
| 11 | Earth apparent size 2.4° vs real 1.9° | **Resolved: 2.4°** (art-direction D-09) | Photo-mode toggle shows the real size; milestone notes that still list it as open should be closed |
| 12 | Sun path geometry | **Resolved 2026-11-12:** sun travels a great circle through both poles in the plane of longitude 45°/225° (GDD §world); all 4 outposts get 30/30; permanent grazing sun only at the Twilight Strips (equator ≈135°E/≈45°W) | renderer must handle grazing sun there |

---

## 21. three r187 feature-verification matrix (M0-W2 task; owner rendering-engineer with technical-artist)

Every r187 API this plan assumes, with the example to check in `docs/vendor/three-r187/`, and the fallback adopted if it fails. Each row gets PASS/FAIL on **`webgpu`** and **`webgl2`** in the M0-W2 report; nothing visual that depends on a FAIL row may land before its fallback is chosen. The [visual-target §1.4](../design/visual-target.md#14-best-in-class-browser-webgpu-references) examples are part of this matrix.

| # | Feature | Example / API to check | Used for | Fallback if FAIL |
| --- | --- | --- | --- | --- |
| 1 | `CSMShadowNode` custom splits, `fade`, `lightMargin` | `webgpu_shadowmap_csm` | Sun/Earth shadows §5.2 | Own split math on top of `CSMShadowNode` practical mode; `webgl2`: `SunLight` 2-cascade |
| 2 | Re-pointing the CSM light direction at runtime (Earth at night) | same | Night shadows §5.2 | Second `DirectionalLight` with CSM, toggled (one active at a time, same budget) |
| 3 | `PCFShadowMap` kernel/radius control | `webgpu_shadowmap` | Edge model §5.2 | Custom TSL PCF node (bilinear 3×3 / 4×4) |
| 4 | GTAO prepass pattern (AO on indirect only) | `webgpu_postprocessing_ao` | §8.1 step 2 | Multiply composite at strength 0.5 (all presets) |
| 5 | Specular-only environment (PMREM from cube render target, irradiance disabled) | `webgpu_cubemap_dynamic`, PMREM docs | Probe §5.5 | Custom TSL specular IBL node sampling our own prefiltered cube |
| 6 | `RenderPipeline.outputColorTransform` / `renderOutput()` | `webgpu_postprocessing` family | §8.1 steps 8–10 | Tone map + sRGB in our own final node |
| 7 | TRAA velocity for static (camera-only), instanced, batched, skinned meshes | `webgpu_postprocessing_traa` | §8.1 step 3 | Custom velocity MRT node; terrain camera-only reprojection |
| 8 | TAAU and FSR1-style upscaling | `webgpu_upscaling_taau`, `webgpu_upscaling_fsr1` | §14 AA/upscale | Custom EASU + CAS TSL nodes |
| 9 | Per-pass `setResolutionScale` (r181+) | changelog + `webgpu_upscaling_*` | Dynamic resolution §9 | Resize one internal render target per step |
| 10 | Clustered lighting class and light counts | `webgpu_lights_clustered` | §5.4, §14 | Cap at 16 lights with per-object nearest-N |
| 11 | Compatibility-mode adapter | renderer init options | §2.1 step 3 | `webgpu-compat` collapses into `webgl2` |
| 12 | Reversed depth on `webgl2` (clip-control extension) | renderer option `reversedDepthBuffer` | §4 | Fallback depth ranges §4 |
| 13 | Compute + storage textures, `copyTextureToTexture` | `webgpu_compute_*` | Dust replay (WDS §7.3), particles | Fragment path (WDS §7.3) |
| 14 | `BloomNode` threshold/knee | `webgpu_postprocessing_bloom_selective` | §8.1 step 5 | Selective bloom via emissive mask |
| 15 | Integer texture `textureLoad` on both backends | TSL docs | Plot table (WDS §7.1) | RGBA16F encoding |

Capture for the matrix runs on the real Tier A device and the Tier B reference device (performance-budgets §1), not only on the CI software lane.

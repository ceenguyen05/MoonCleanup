# M0-W3-T04 technical-artist report (regolith / dust material v0)

Task M0-W3-T04 / status: **in-review** / 2026-11-12 / technical-artist, Sonnet 5.5. No installs, no git mutations. One Intel UHD 620 laptop, headed Chrome, 1920x1080 DPR 1, Medium preset, webgpu + webgl2 (ANGLE D3D11) lanes, no post stages (tone map only). **No Tier A/B claim, no frame-time claim.**

## Done
- `apps/client/src/visuals/materials/` (barrel `index.ts`): `regolith-material.ts` (TSL on `MeshStandardNodeMaterial`), `regolith-constants.ts`, `mask-texture.ts` (contract), `stroke-mask.ts` (procedural test strokes), `detail-texture.ts` (procedural tileable tile: original, no asset, so no ledger row), `agx.ts` (CPU AgX port), `materials.test.ts`.
- `apps/client/src/visuals/lookdev/`: `s02-first-stroke.ts` (S02), `s03-distance-ladder.ts` (S03), `s02-lookdev-kit.ts` (rig through T03's `SunRig`, chart, probes), `s02-dev-entry.ts` (stand-alone boot on the real RenderModule / FrameLoop / harness hooks; dev only), `s02-run.mjs` (Playwright capture + luma measurement).
- Checks: `tsc -p apps/client` clean, `eslint src/visuals/materials src/visuals/lookdev` clean, `prettier --check` clean, `vitest run src/visuals` 25 pass (9 mine). 0 console errors on all four capture runs (S02/S03 x webgpu/webgl2). `pnpm verify` NOT RUN.

## Material API (for bench v1, M0-W3-T07)
```
createRegolithMaterial({ mask: Texture, maskRect: {originX,originZ,sizeX,sizeZ}, maskSize:[w,h],
   detail?, debugView?, normalMode?, envNode?, horizonVisibility? }) -> RegolithMaterial
   .material (MeshStandardNodeMaterial; mesh.receiveShadow = true)
   .uniforms {macro, layerGain 0.7, bermGain 1.6, detailGain, albedoVariation, sparkle}
   .setMask(tex, rect, size)   .fetchCount (9)   .textureBindings (2)   .dispose()
createChipMaterial(albedo, tint?)   createMaskTexture(FromBuffer)   createMaskBuffer / stampStroke / packMaskRgba8 (test writer)
```
- Per fragment 5 taps of one mask texture (centre + 4 for the height gradient) and 4 taps of one detail texture (2 scales x 2 stochastic taps, `.grad()` so no mip seams) = **2 sampled textures** (target <= 12, hard 16). CSM cascades / probe / lamp shadow come on top.
- `envNode` is a pass-through for the specular-only `LightingNode` (r187 matrix row 5); that node is NOT built here (no probe exists yet). `horizonVisibility` is published as `userData.mcHorizonVisibility`, which T03's `MoonShadowNode` multiplies into the cascade result (wiring untested here).
- Swap point for M1 (ring + atlas): the `maskTap` closure in `regolith-material.ts`.
- **Gotcha for T07 (found here):** `transformNormalToView` is LOCAL to view (model normal matrix). The bench terrain stub feeds it a WORLD normal; that only works for an identity-rotation mesh. On a rotated mesh it made my ground 2x too dark (shadowed-looking: 52 vs 115 luma). The regolith material uses `transformDirection(worldNormal, cameraViewMatrix)`; terrain chunks in bench v1 are fine with it.

## Mask input contract (proposal for M1-W0)
One plain sampled RGBA8 texture, linear filter, colour space none, clamp-to-edge, mipmaps on. **R = remaining dust** (255 = full), **G = berm height** (255 = 8 cm; hand strokes 1.5-3 cm = about 50-95), B = polish, A = reserved (footprint depth). Covers a world rectangle (uv = (xz - origin) / size); border texels must be R = 255, G = 0 so the clamp reads as dusty ground. The material derives the berm/lip normal from the height field `layerGain*2cm*R + bermGain*8cm*G` by central differences of the same texture; no extra channel is needed. Writer freedom: WebGPU compute may write it, but WebGL2 cannot write storage textures (matrix row 13), so the writer needs a fragment-pass render-target path or a CPU upload; both end in a `Texture` for `setMask`. Test mask texel is 0.78 cm; the M1 ring texel (2.5 cm) and atlas (20/40 cm) are coarser: S03 says what the material does, not what the atlas will do at 25 m.

## Evidence (`docs/agent-reports/M0-W3-T04-evidence/`: PNG + JSON per scene/backend/variant; native 1920x1080)
Calibration chart at the noon key (sun 60 deg, EV100 14.3, AgX on, 15 % fill), luma of inner 45 % of each chip, identical on webgpu and webgl2 (`s02-*-noon.png`):

| Chip (linear albedo) | Target | Measured | Delta |
| --- | --- | --- | --- |
| 0.10 | 126 +-8 | 121.6 | -4.4 |
| 0.33 | 181 +-8 | 173.4 | -7.6 (edge of band) |
| 0.80 | 213 +-8 | 207.2 | -5.8 |
| grime 0.085 (regolith family) | 119 +-8 | 115.1 | -3.9 |
| clean 0.34 | 182 +-8 | 174.3 | -7.7 (edge of band) |

All five inside +-8 but consistently 4-8 low. Cause (not changed, T03's file): `SunRig` sun colour (1.0, 0.94, 0.88) has luma 0.95; the CPU AgX port predicts 126 / 181 / 213 exactly for a white sun. **VT-M0-06 PASS only at the edge of its band; VT-M0-08 ratio 1.51 (>= 1.45) and difference 59 codes (>= 50): PASS** (visual-qa to confirm against their measure tool). Dawn (sun 4 deg, EV 11.3): chart 40.5 / 84.4 / 124.3, grime 35.8, clean 86.2 (ratio 2.4, difference 50; art-direction dawn band 98 / 163 not met, the rig's dawn exposure/fill is T03's to tune).
Real ground, not chips (webgpu noon, my 600x600 samples): dusty ground 115.5, clean path 174.5 = the chips, so the material mean matches the calibration.
Stroke edge and berm, noon, webgpu / webgl2 (cross-section profiles in the JSON): dust 115.4 -> clean 173.9, 10-90 % edge 6 px at 2.4 mm/px = **1.4 cm (<= 2 cm)**; lit berm crest 143 vs shaded trough 85 = **line pair 58 codes (>= 12)**, shaded slope 26 px wide, lit crest 3 px. Overlapping second pass: shared floor clean (174), inner berm removed. S03 ladder (webgpu / webgl2 within 1-2 codes): berm pair lit-minus-shaded 47-50 at 3 m, 48 at 10 m (lit crest 2 px, shaded 6-7 px), 22-41 at 25 m (**lit crest 1 px, shaded 2-3 px: the >= 2 px width bar is marginal at 25 m**, fine for the Medium 8 m requirement); no shimmer or seams seen in single frames.
Visual notes from the PNGs: bright smooth clean path against warm grey-brown dust, readable stepped lip, overlapping square-ended passes read cleanly (RF-01 clean-path contrast intent met on this static mask). Dawn shows strong lit/shaded berm and pebble relief (pebbles read somewhat crater-like at grazing light; tunable via `detailGain`). Glint grains are sparse white dots on the clean path.

## Visual items
VT-M0-06 (edge of band), VT-M0-07 (edge 1.4 cm, pair 58), VT-M0-08 (1.51 / 59), VT-M0-09 (webgpu and webgl2 give identical chart numbers, 0 console errors; reviewed by eye on both). RF-01 / RF-03 are not claimed: static frames only, no motion and no reference-media comparison done.

## NOT RUN / known gaps
SwiftShader lane; Tier A/B devices; frame cost of the material (no timing taken); temporal behaviour (TRAA/SMAA not installed in these scenes, shimmer judged on single frames only); material under T03's post chain; `horizonVisibility` and `envNode` wiring; lane stripes, footprints, opposition surge / lunar-Lambert BRDF, cavity term from the height cube, per-preset density switches (not in v0); S03 at the 2.5 cm ring / 20-40 cm atlas texel sizes; faint radial streaking of the ground at 25 m grazing views remains (coarse detail normal under anisotropic filtering), low contrast, to retune with real terrain. Dawn/dusk luma bands of art-direction 2.3 are not met (rig exposure, not material). Mask mipmaps via `DataTexture.generateMipmaps` worked on both backends here.

## Handoff
- Routing `?scene=s02|s03` (integrator, M0-W3-T06): build `new S02Scene({roots, renderer, quality, search})` / `S03Scene` in the visuals module and call `update(frame)` per frame. `s02-dev-entry.ts` is dev-only (nothing imports it). URL knobs: `variant`, `dbg=1..7`, `nm=1..3`, `u=detailGain:0,...`, `noshadow=1`, `flat=1`, `nonormal=1`.
- Capture: `node src/visuals/lookdev/s02-run.mjs --scene s02|s03 --backend webgpu|webgl2 --out <dir>` against a Vite server serving a page that imports `s02-dev-entry.ts` (I used a scratch config outside the repo; the server is stopped, no processes left).
- Lighting follow-up for T03: sun colour luma 0.95 costs about 5 codes on every chip.

Commit suggestion: `feat(client): regolith dust material v0 with mask input and S02/S03 look-dev scenes`

# M0-W3-T03 Look-dev v0: light, shadows, sky, post

Status: **in-review, partial** (look, rig and scenes run on webgpu and webgl2 with 0 console errors; seam metrics and several VT rows NOT RUN) / 2026-11-12 / technical-artist, Sonnet 5.5. One Intel UHD 620 laptop only: **no Tier A/B claim**. Reference mode (REFERENCE_TARGET): black-sky, neutral-shadow and exact Earth-size rules treated as tunable.

## Done (`apps/client/src/visuals/`)

- `lighting/`: key-light model (sun lux, scripted EV100, pre-exposure, earthshine phase, sun -> Earth key hand-over), `sun-rig.ts` (one DirectionalLight + `MoonShadowNode` = CSMShadowNode subclass: custom splits, fade, lightMargin 300, per-cascade slope `biasNode`, per-frame normal bias on `csm.lights[i].shadow`, PCF radius capped 2 on SMAA presets), regolith fill hemisphere 15/25/35 % warm grey, far-side floor, `shadow-bias.ts` grazing rule, `cascade-splits.ts`.
- `sky/`: procedural seeded star catalogue (8,298 stars, B-V tint, m_lim model, no external data so no ledger row), Gaussian-disk star quads (>= 1.2 px), procedural blue-marble Earth with phase from the sun direction + limb + own exposure cap, 0.53 deg HDR sun disk, `SkyRig` following the camera.
- `post/`: High = prepass + GTAO (indirect only) + TRAA; Low/Medium = SMAA; neutral look-grade uniforms; bloom 4.0/0.5/0.06/0.35; AgX is the renderer's.
- `module.ts` (`VisualsModule`, inactive for `?scene=bench|verify|smoke`), `index.ts` barrel, `lookdev/`: S01 approach, S05 shadow lab, S06 night (`?scene=s01|s05|s06`), stand-in regolith material (not T04's), props, `terrain-patch.ts` (decodes assets/terrain cube + horizon map in the browser, per-vertex horizon angles, `createHorizonVisibility`), `window.__mcLook` hooks.
- Tests: `visuals-pure.test.ts` 16 tests pass.

## What the look is now

Hard low sun with long raking shadows, black sky with coloured stars, lit blue-marble Earth, bloomed sun disk, pale cool cleaned ground with tonal Lane-Broom stripes and a lit berm against dark umber grime, chunky ivory/orange outpost and custodian proxies; night scene with earthlit ground, crisp earth shadows, warm shadowed Crown Lamp pool and flood. Captures: `docs/visual-reviews/M0/lookdev/` (README there explains reproduction).

## Acceptance status

| Item | Status | Evidence |
| --- | --- | --- |
| Sun rig CSM per preset, PCF, texel snapping, fill | PASS (looked at) | cascades Low/Medium/High texels 2.3 / 9.7 / 27.6 cm (Medium, c0..c2), 0.9 / 6.4 / 23 cm (High); snapping is CSMShadowNode's |
| Sky: black, sun disk, stars, Earth phase | PASS (looked at) | VT-M0-01 star-free 16 px blocks: max channel 0 (S05 noon, S01 noon); dawn 29 (sun/bloom halo near the disk); night 23-26 (halos around bright stars) |
| Post: AgX, bloom, GTAO on High | PASS on webgpu High (renders, 0 errors); Low/Medium GTAO NOT DONE | |
| **VT-M0-04b grazing** | **PARTIAL**: 60 and 15 deg clean on High, 4 and 1 deg looked at: no acne seen, post/boulder/boots shadows attached; contact gap in cm NOT MEASURED; the 20 deg slope views captured. 1 deg ground is near black by physics (fill is 15 % of a 2.3 klux key) | `vt04b/` 16 PNGs |
| **VT-M0-15 horizon spike** | **PARTIAL**: real LOLA terrain + baked horizon map render; horizon term ON vs OFF visibly adds far crater shadows past the Medium CSM range (webgpu and webgl2). Edge-width ratio <= 2x and "luma step <= 8" NOT MEASURED (the flyover frame has no flat ground column; row profiles are in the json); High NOT RUN; P4 as a stepped path NOT RUN (single frame t = 0.5) | `vt15/` |
| **VT-M0-16 fill** | **PASS on webgpu Medium** | noon clean flat sunlit 177.5 (target 182 +- 8); flat shadow 84 / 83.5 (81-97); slope facing away, shadow 86 (81-97); wall shaded face 143.6 > flat shadow, b* +3.1 / +3.8 (warm), shadows b* +1.8 vs lit +0.96 (not bluer); webgl2 and High NOT RUN |
| VT-M0-02 one sun one shadow | looked at (single shadow direction in S05) | |
| VT-M0-03 cascade debug view / seam | NOT RUN (sidecar numbers only) | |
| VT-M0-05 banding in bloom / limb | NOT RUN (no 200 % crop review) | |
| VT-M0-09 webgl2 parity | PARTIAL: S01, S05, S06 render, same cascade texels, no black materials, SMAA dither visible | `webgl2/` |
| VT-M0-13 stars stable | NOT RUN (no pan capture; stars are in the scene pass, TRAA ghosting on rotation is a known risk) | |
| VT-M0-14 Earth 2.4 deg | by construction (`pixelsForAngle` test 37-41 px at 1080p); screen measurement NOT RUN; `?earthDeg=` tunes it (4 deg looks better in S01 noon/b and S06) | |

## NOT RUN / known gaps

Tier A/B anything; Low/Medium GTAO and exposure adaptation; stars as a post-AA output-res layer (they render in the HDR scene pass); HYG bake (procedural stand-in); specular-only env probe; per-pixel `sin` grazing bias beyond the rule in `shadow-bias.ts` (slope term is in a node; no numeric contact-gap measure); SwiftShader (ci) lane; perf numbers (no GPU ms taken; draws 117-179 on webgpu); `pnpm verify` (focused checks only).

## Defects / notes for others

- `lookdev/s02-first-stroke.ts:149` and `s03-distance-ladder.ts:150` (T04 worker) fail eslint `no-this-alias`. My earlier `prettier --write src/visuals` also reformatted their in-progress files (formatting only).
- r187: CSM `onCascades` hook relies on `setup()` calling `_init` lazily; `shadow.biasNode` per cascade works; the receiver-published horizon node (`material.userData.mcHorizonVisibility`) is the integration point for T07's terrain material.

## Wiring handoff (integrator)

Register `new VisualsModule()` (from `../visuals`) in `app/boot.ts` after `render`; it uses the `renderer`, `sceneRoots`, `quality` services. Nothing in `app/**` or `render/**` was edited. Dev terrain URL for the spike: `&terrain=<base url of assets/terrain/>` (Vite `/@fs/...`).

## Evidence

`tsc -p apps/client` clean; eslint clean on my files (see defects above for T04's); prettier clean on my files; vitest 16/16. Browser runs: gpu lane headed Chrome (webgpu and forced webgl2), 0 console errors in every captured page. Vite scratch server stopped.

## Next (polish ideas)

Measure VT-M0-04b contact gaps and acne luma pattern; VT-M0-15 numerically on a flat-ground flyover and High; stars/Earth post layer and VT-M0-13 pan test; Low/Medium half-res GTAO; Earth Blue Marble KTX2; make S01 cleaned region a hex plot; dome/ivory roughness and metal env probe; exposure adaptation; lens-free sun glare tuning; footprints.

Commit suggestion: `feat(client): look-dev v0 lighting, sky, post and scenes S01/S05/S06 (M0-W3-T03)`

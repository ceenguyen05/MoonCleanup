# M0-W3-T03b Look polish pass

Task M0-W3-T03b / status: **in-review** / 2026-11-12 / technical-artist, Sonnet 5.5. Intel UHD 620, headed Chrome, 1280x720 (S01/S05/S06) and 1920x1080 (S02/S03), DPR 1, Medium unless named. **No Tier A/B claim, no frame-time claim.** Reference mode (REFERENCE_TARGET): black-sky and neutral-shadow rules treated as tunable; RF-01 / RF-03 not claimed (static frames, no reference-media comparison).

Captures. Before (T03 v0): `docs/visual-reviews/M0/lookdev/webgpu/*.png`, `.../webgl2/*.png`. After: `docs/visual-reviews/M0/lookdev/polish/webgpu/` and `polish/webgl2/` (S01 noon / morning close / morning wide / dawn side-lit wide / dawn up-sun High, S05 wide, S06 pool High and wide, one `.json` each, 0 console errors on all 16) and `polish/regolith/` (S02 noon+dawn, S03 d1/d3/d10/d25, both backends, numbers in the json). Looked at on both backends: same look, no black materials.

## Changes (apps/client/src/visuals)

1. **Sun shortfall: two causes.** (a) Sun colour luma 0.95 -> (1.03, 0.998, 0.94) luma 1.00. (b) Larger, previously unrecorded: `SunRig.update` set the DirectionalLight intensity to the FLAT-ground lux (`133800*sin(el)`), applying N.L twice (noon 0.87x, dawn about 14x too dark with the fill dominating). Intensity is now the normal-incidence lux; the fill stays on flat-ground lux. Dawn EV100 11.3 -> 11.5. `lighting/sun-rig.ts`, `key-light.ts`.
2. **Ground** (`lookdev/ground-material.ts`): warm sand <-> lavender-grey clean and umber <-> slate grime hue drift at constant luminance, three tone scales, 0.2 m crisp dust edge, 7.5 cm lit berm lip, analytic cell craters (6 m and 1.7 m, rotated grids) and pebbles with distance fades. No textures added.
3. **Sky** (`sky/sky-dome.ts` new, `sky-rig.ts`, `earth.ts`, `module.ts`): gradient dome (navy zenith, periwinkle horizon band, warm lift toward the sun, faint nebula band), Earth halo, Earth 4.2 deg with `earthFullness` 0.5 (mostly lit planet), `?sky=0` and `?grade=neutral` URL switches for measurements. Sky level 1 / 0.5 / 0.3 for day / earthlit / far night. Grade `LOOK_GRADE` saturation 1.12 (luma preserving). Fill tint (1,1,1.045).
4. **Props** (`lookdev/props.ts`): rounded chunky shapes, seamed dome hab (door now faces -z, toward the cameras), annex, hazard-striped concrete apron, framed solar panels with cell grid, dish, flood mast, tanks, crates, chibi custodian with brush. **Contact AO**: soft black blob under every foot/base and one InstancedMesh of blobs under every boulder (works on Low/Medium without GTAO).
5. **T04 regolith radial streaking at 25 m grazing: fixed** (`materials/regolith-material.ts`, `regolith-constants.ts`): grazing-angle stretch fade (footprint aspect) on detail, albedo breakup/cavity now fade at 6-20 m, coarse normal fade 20-70 m. Isolation showed the streaks were albedo breakup, not normals or shadows. Confirmed gone in `polish/regolith/s03-*-d25.png` on both backends. `ALBEDO_GRIME` 0.085 -> 0.0785 to cancel a measured +4-code specular lift on dark surfaces (dielectric specular is additive: dark chips +4, light chips -1), so grime stays on its 119 target and the ratio stays >= 1.5.
6. eslint `no-this-alias` in s02/s03 no longer present (eslint clean on `src/visuals`).

## VT numbers re-recorded (S02/S03, webgpu = webgl2 to 0.1 code, tone map only, Medium, 1920x1080)

| Item | Target | T04 | Now |
| --- | --- | --- | --- |
| chart 0.10 / 0.33 / 0.80 (VT-M0-06) | 126 / 181 / 213, +-8 | 121.6 / 173.4 / 207.2 | **130.1 / 180.4 / 212.1** |
| grime chip / clean chip noon | 119 / 182 | 115.1 / 174.3 | **119.7 / 181.9** |
| dawn grime / clean | 98 / 163 (+-8) | 35.8 / 86.2 | **101.6 / 158.9** |
| VT-M0-08 real ground noon: ratio, difference | >= 1.45 (brief: 1.5), >= 50 | 1.51, 59 | **1.505, 60.8** (overlap pass 1.54, 63.8) |
| dawn ratio / difference (real ground) | >= 1.55, >= 55 | 2.4, 50 | **1.85, 92.7** |
| VT-M0-07 edge 10-90 %, berm pair | <= 2 cm, >= 12 | 1.4 cm, 58 | **1.4 cm, 61.8** (dawn pair 134) |
| berm pair at 25 m (S03, webgpu) | lit crest >= 2 px | 1 px (marginal) | see `polish/regolith/s03-*.json`; no shimmer in single frames |
| VT-M0-16 fill (S05, webgpu, High-less Medium, `measure.mjs`) | flat lit 182 +-8, shadow 81-97 | 177.5 / 84 | **183.5 / 85.1**; slope-away shadow 87.7; wall shaded face 144 > flat shadow; shadow b* +1.4 vs lit -0.7 (fill is now slightly cool, tunable) |
| VT-M0-01 sky <= 3 | diagnostic in reference mode | 0 | **not met by design**: star-free sky blocks max mean luma 14.6 / 15.0 (day / night), max channel 41, at the horizon band; zenith darker. Recorded, not claimed. `?sky=0` restores the black sky |

Dawn, noon, chart and grime/clean are inside their old +-8 bands on both backends. The 0.10 chip sits +4 (specular lift), not a rig error.

## Checks
`tsc -p apps/client` clean; `eslint src/visuals` clean; `prettier --check src/visuals` clean (I ran `prettier --write` over `src/visuals`); `vitest run src/visuals` 25/25. Textures per fragment: ground stand-in 0 sampled textures; regolith 2 (unchanged, <= 12). No installs, no git. Scratch Vite server (port 5191) stopped; no stray processes of mine.

## NOT RUN / known gaps
Tier A/B; frame cost of the new ground/sky/props/contact blobs (no timing taken; draw calls 177-358 in the capture json); Low preset and Ultra captures; GTAO on the new contact-AO blobs (double darkening on High not examined); VT-M0-15 and VT-M0-04b re-measure after the sun intensity fix (v0 numbers and captures under `vt15/`, `vt04b/` are stale for sun-lit brightness, not for geometry); VT-M0-13 pan test; webgl2 VT-M0-16 numbers; S05/S06 numeric patches after the sun fix (S06 earth mode intensity unchanged); the Earth halo and sky gradient are unlit approximations (night sky level is a plain scale); props are still placeholders; the stand-in ground is not the T04 material (T07 integrates it). The `vt04b/`, `vt15/`, `vt16/` v0 folders are kept as the "before" record.

## Next
Integrator: register `VisualsModule` (unchanged contract). Visual-qa: review `polish/` against RF-01. Follow-ups: re-run vt04b/vt15 with the corrected key intensity; add contact-AO blob fade when GTAO is on; the dawn up-sun view (`s01a-dawn-high`) is very shadow-heavy by physics, use the side-lit dawn wide for hero shots.

Commit suggestion: `feat(client): look polish pass: key-light fix, sky dome, ground variation, chunky props, regolith streak fix (M0-W3-T03b)`

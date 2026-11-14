# M0 visual checks: unrun look items closed out

Task M0-visual-checks / status: **in-review** (all five items measured; one defect fixed in `visuals/lighting`; High and most
webgl2 cells NOT RUN) / 2026-11-13 / technical-artist, Fable 5.2. One Intel UHD 620 laptop (floor device), headed Chrome, real app
through a Vite dev server, `?capture=1` stepped frames, 1920x1080 DPR 1, `scale=1`. **No Tier A/B claim.** No installs, no git.
My Vite (port 5193) and capture browsers are stopped. `pnpm verify` NOT RUN (lead's integration step).

Evidence root: `docs/visual-reviews/M0/checks/` (277 MB of PNG and json; drivers in `checks/driver/`). The older
`lookdev/vt04b` and `lookdev/vt15` folders stay as the stale "before the sun fix" record.

| # | Item | Verdict (2026-11-13, UHD 620) |
| --- | --- | --- |
| 1a | VT-M0-04b grazing-sun shadows | **Before: FAIL** (short / missing shadows at low sun). **After the fix, Medium webgpu: shadow length, open-ground acne and post / boot contact gap PASS; boulder contact gap at 4 and 1 deg UNRESOLVED** (3.5 / 5.2 cm measured, attached by eye). 1 m post at 4 deg: 6.64 m -> 10.94 m of 14.35 m (the rest is a Medium resolution limit); 0.42 m boulder at 4 deg: 0 m -> 5.88 m of 6.01 m. High and webgl2 after the fix NOT RUN (stopped by the coordinator's narrowed brief); the "sun moves 0.1 deg/s" clause was run as stepped elevations only |
| 1b | VT-M0-15 horizon map on / off | **PASS on Medium webgpu after the fix**, with one clause not isolable: far shadows continue past 120 m (12 to 13 % shadowed ON vs 0 % OFF); edge-width ratio across the seam 1.08 and 1.33 in metres (bar 2.0) at the two positions that have edges on both sides; cascade end step 0.1 to 6.6 codes (bar 8). Before the fix the ratio was not measurable (the cascades drew no terrain shadow at 4 deg). webgl2, High NOT RUN |
| 2 | Moving-camera TRAA / SMAA smear | **MEASURED, no ghost trails**: TRAA moving frame 2 to 21 % softer than the still; `CameraOnlyVelocity` cuts ground diff 1.7x to 5.9x. SMAA 0 diff. webgl2 NOT RUN |
| 3 | `?perf=1` HUD cost | **PASS**: +0.13 ms per frame main thread (p95 +1.2 ms on text-rebuild frames); frame interval delta -0.26 ms, inside run-to-run spread |
| 4 | VT-M0-03 | **PASS on Medium webgpu for what was run**: count / map / split match the preset table (Medium and High); no seam on lit flat ground; `?debug=cascades` view added and captured. Seam inside a shadow crossing a split NOT MEASURED; Low, webgl2 NOT RUN |
| 4 | VT-M0-05 | **PASS by measurement on Medium webgpu** (sun disk blooms white, bloom ring neutral within 2.2 codes; no band seen at 200 %; 8-bit plateaus up to 46 px, no dither). High, webgl2, ACES NOT RUN |
| 4 | VT-M0-13 | **FAIL**: Medium 28 % of stars vary more than 10 % (worst 13 %); High / TRAA stars drop to 72 % of their still brightness when the camera pans and 72 % of them vary more than 10 % |
| 4 | VT-M0-14 | **NOT MET BY DESIGN** (shipped Earth 4.27 deg vs 2.4; the size control is accurate: 2.47 deg / 40.3 px at 2.4). Defect: Earth is egg-shaped near the frame corner (1.18 : 1) |

## Fix: sun-shadow bias rule (`apps/client/src/visuals/lighting`)

Rule now in source: normal offset `1.1 * texel` (no `1 / sin(elevation)`), depth bias `+0.5 * texel` toward more shadow (was
`+(0.6 + 0.9 * min(tan, 9)) * texel` per pixel). Diagnosis and the A/B that led there: section 1a. Final run on the edited
source: `checks/final.log`, `checks/vt04b/final/` (`vt04b-final-medium-webgpu.json`, 0 console errors).

| Medium webgpu, flat ground | Sun | Expected | Before | After |
| --- | --- | --- | --- | --- |
| 1 m post shadow length | 60 | 0.63 m | 0.60 m | 0.60 m |
| | 15 | 3.78 m | 3.38 m | 3.64 m |
| | 4 | 14.35 m | **6.64 m (46 %)** | **10.94 m (76 %)** |
| | 1 | 57.3 m | 6.66 m | 15.96 m (scan stops at 40 m) |
| 0.42 m boulder shadow length | 15 | 1.57 m | 1.30 m | 1.58 m |
| | 4 | 6.01 m | **0 m** | **5.88 m (98 %)** |
| | 1 | 24.1 m | 0 m | at least 24 m (reads 30.5 m: another shadow crosses the scan line) |
| Contact gap post / boulder / boot | 60 | <= 1 cm | 0 / 0 / 0 cm | 0.4 / 0 / 0 cm |
| | 15 | | 0 / 0 / 0 cm | 0 / 0 / 0 cm |
| | 4 | | 0 / 0 (weak shadow) / 0 cm | 0 / **3.5** / 0.1 cm |
| | 1 | | 0 / no shadow / 0 cm | 0 / **5.2** / 0.5 cm |
| Open-ground acne, 5 windows x 4 suns | all | 0 px above 4 codes | 0 px, max 1 code | 0 px, max 0.9 code |
| Post lit pixels falsely darkened | 15 / 4 | 0 | 1.4 % / 0 % | 2.4 % / 3.3 % |

- Boulder length at 60 deg is not measurable with this driver (the 0.24 m shadow is shorter than the rock's own radius).
- **Why the post stays at 76 % at 4 degrees:** beyond 10 m from the camera its 10 cm-wide shadow is one texel of Medium
  cascade 1 (9.7 cm) and the PCF dilutes it below half strength. A resolution limit of the preset. High NOT RUN after the fix.
- **Boulder contact gap at 4 and 1 degrees is unresolved.** It reads 3.5 cm at 4 degrees with every rule tried, including a full
  texel of depth bias (5.2 cm at 1 degree with the two rules run there), while post and boot close to 0.5 cm or less. By eye the shadow is attached at the rock's lowest corner
  (`checks/vt04b/fixed/macro-boulder-sun4-fixed-medium-webgpu.png`). Suspects, not proven: the scan line runs along the side
  of the faceted rock's shadow, or the unlit patches of the stand-in ground. Do not read it as a pass.
- Cost of the depth bias: 2 to 3 % of the post's lit pixels are darkened (an edge band on the face the sun grazes). A full
  texel closes every post / boot gap to 0.0 cm but darkens 6 to 8 %; no depth bias leaves a visible lit sliver under the boots
  (1.3 to 2.1 cm, `checks/vt04b/fixed/macro-boot-sun15-fixed-medium-webgpu.png`). Half a texel is the trade taken
  (`checks/dbt-ab2.log`).
- By looking, before `checks/vt04b/view-wide-sun4-flat-medium-webgpu.png`, after
  `checks/vt04b/final/view-wide-sun4-final-medium-webgpu.png`: at 4 degrees the custodian and brush now cast long shadows and
  the ramp's shadow reaches its full length; before, the custodian had none.
- Slope (20 degree ramp, measured with the intermediate rule = same normal offset, no depth bias; NOT re-run on the final
  rule): slope boulder now has a shadow at 1 degree (before: none); gaps 0 to 1.3 cm; ramp-face acne 0 px above 4 codes except
  one sample of 6.2 codes. The runtime A/B with the final half-texel bias gave slope post / boot gaps of 0 to 0.2 cm.

Look and cost guards on the final source (`checks/look/lookcheck-final-medium-webgpu.json`, `checks/hud/final/`):

| Guard | Before (T08 report, same look state) | After |
| --- | --- | --- |
| Chart 0.10 / 0.33 / 0.80 (126 / 181 / 213 +-8) | 129.9 / 180.2 / 212.3 | 130.1 / 180.3 / 212.4 |
| Grime / clean chip, ratio (>= 1.5) | 119.8 / 181.8, 1.52 | 119.8 / 181.9, 1.52 |
| Fill: flat lit / flat shadow (S05, sun 60) | 183.5 / 85.1 | 183.6 / 85.0 |
| Sampled textures, regolith | 2 | 2 (`textureBindings` in the S02 sidecar; none added) |
| Frame interval, typical scene, Low webgpu 0.75, unthrottled, HUD off: avg / p50 | 25.58 / 25.33 ms | 25.28 / 24.98 ms (spread between windows about 1 ms: no change) |

Medium frame cost after the fix: NOT RUN (one capture was asked; it was taken on Low). The edit removes a per-pixel
`sqrt` / divide per cascade and adds one uniform, so no added shader work, but that is reasoning, not a measurement.

Checks: `tsc -p apps/client --noEmit` clean; `eslint src/visuals` clean; `prettier --check src/visuals` clean;
`vitest run src/visuals` 4 files / 44 tests pass.

**Needed from others (not edited by me):**
- `docs/architecture/rendering-pipeline.md` section 5.2 still says "Normal-offset bias scaled by 1 / max(sin(elevation), 0.05)
  plus slope-scaled depth bias". That text is what produced the defect; its owner should replace it with the rule above.
- `apps/client/src/render/bench/look-visuals.ts:97` passes a fourth argument (`BENCH_SUN_ELEVATION_DEG`) to `SunRig.update`.
  It is now ignored; the parameter is kept optional only so `render/**` still compiles. Drop the argument, then the parameter.
- The render bench and S02 / S03 use the same `SunRig`, so their shadows change too (longer at low sun). Bench numbers and
  any stored baseline taken at low sun are stale; noon numbers above did not move.

## 1a. VT-M0-04b (Medium, webgpu, flat ground) — measured BEFORE the fix (after-fix numbers: "Fix" above)

Run: `node vt04b.mjs --backend webgpu --preset medium --az 250 --targets post,boulder,boot --acne flat --macro 1 --sweep 1`.
Chain `scene > grade > bloom > smaa`, filter `tent4`, cascade texels 2.3 / 9.7 / 27.6 cm, 0 console errors.
Data: `checks/vt04b/vt04b-flat-medium-webgpu.json`; contact sheet (rows 60 / 15 / 4 / 1 deg, columns post / boulder / boot, native
pixels) `checks/vt04b/sheet-flat-medium-webgpu.png`; per-cell crops `contact-*.png`, `macro-*.png`; `view-wide-sun*.png`.

Method (no source edit; toggled at runtime in one page): frame A shipped, frame U with nothing casting, frame K with an emissive
mask on the props. Along the ground line from the object in the shadow direction: contact edge = last object pixel, shadow start =
first sample where the darkening `1 - A/U` reaches half its plateau; gap = the distance between them. Camera 3 m from the contact
on the shadow side (2.87 px/cm), plus a macro pass (11.4 px/cm). Self-check: the post's contact edge measures 5.3 to 5.4 cm
against 5.3 cm from its geometry. Sun azimuth is 250, not the scene default 200: at 200 the ramp's raised edge shadows the flat
post and boulder at 4 and 1 degrees.

| Sun | Post gap | Boulder gap | Boot gap | Lit / shadow luma at the post | Acne in open ground (share of px above 4 codes, max) |
| --- | --- | --- | --- | --- | --- |
| 60 | 0.0 cm | 0.0 cm | 0.0 cm | 184.7 / 90.7 | 0, max 1 code |
| 15 | 0.0 cm | 0.0 cm | 0.0 cm | 189.7 / 95.7 | 0, max 1 code |
| 4 | 0.0 cm | 0.0 cm | 0.0 cm | 161.5 / 65.7 | 0, max 0 |
| 1 | 0.0 cm | **no shadow found** | 0.0 cm | 101.2 / 20.9 | 0, max 0 |

- **Contact gap: 0.0 cm on all 11 cells that have a shadow** (bar 1 cm; resolution 0.09 cm macro, 0.35 cm at 3 m).
- **Acne (shadow-map self-shadowing): none.** Open flat ground up-sun of every object, 5 windows covering camera distances
  2 to 116 m (all three cascades), `|U - A|` never above 1 code at any of the four elevations.
- Sun sweep 4.0 to 5.0 and 1.0 to 2.0 degrees in 0.1 degree steps (the VT's 0.1 deg/s for 10 s): post gap 0.0 cm on all 22 steps.
- Open-ground lit luma: 182 (60), 192 (15), 175 (4), 143 (1).

Defects seen by looking at the sheet (not caught by the numbers above):

1. **Boulder shadow missing at 1 degree, and visibly short at 4 degrees** (`contact-boulder-sun1-*`, `contact-boulder-sun4-*`).
   Cause (confirmed below): the normal-offset bias is `1.1 * texel / max(sin(elevation), 0.05)` metres
   along the normal, which on Medium cascade 0 is 36 cm at 4 degrees and 51 cm at 1 degree, about the height of the rock, so the
   lookup point sits above the caster. The rule is the one written in `rendering-pipeline.md` section 5.2, so this is a spec
   question, not a coding slip. Confirmed and fixed: see the sections below and the Fix section above.
2. **Stair-stepped shadow edges at 60 degrees on Medium** (boulder and custodian cells of the top row): texel-sized steps are
   visible at 100 % from 3 m with the `tent4` kernel (no dither). VT-M0-04 asks for no stair-stepping in a 200 % crop.
3. **Black blotches on the lit ground at 4 and 1 degrees** (rows 3 and 4): hard-edged dark patches, covering more than half
   the ground at 1 degree. They are in A and U alike, so they are surface shading of the stand-in ground
   (`lookdev/ground-material.ts`), not shadow-map acne. Against REFERENCE_TARGET (bright, readable) the 1 degree ground does not
   read as regolith. Whether the real regolith material does the same is NOT CHECKED yet.
4. Earlier probe at azimuth 200, 15 degrees (`view=post`): the far canopy shadow has a blocky stepped edge in the far cascade.

### Shadow length (peter-panning), Medium webgpu — measured, and the cause confirmed

Run `--tip 1` (`vt04b-tipshipped-medium-webgpu.json`, frames `tip-*-tipshipped-*.png`): camera 3 m behind the object looking along
its shadow, last ground sample still darkened to half the plateau, against `height / tan(elevation)`.

| Object | Sun | Expected length | Shipped rule | Runtime A/B: normal offset `1.1 * texel` (no `1 / sin`) |
| --- | --- | --- | --- | --- |
| 1 m post | 60 | 0.63 m | 0.60 m | 0.60 m |
| 1 m post | 15 | 3.78 m | 3.38 m (89 %) | 3.64 m (96 %) |
| 1 m post | 4 | 14.35 m | **6.64 m (46 %)** | 10.94 m (76 %) |
| 0.42 m boulder | 15 | 1.57 m | 1.30 m (83 %) | 1.58 m |
| 0.42 m boulder | 4 | 6.01 m | **none found (0 m)** | 5.88 m (98 %) |

- **Defect confirmed: the `1 / max(sin(elevation), 0.05)` factor on the normal offset removes or halves shadows at grazing sun.**
  A 0.42 m rock casts no shadow at 4 degrees (VT-M1-08 will ask for at least 4 m from a 0.3 m rock) and the 1 m post's shadow is
  less than half length. The A/B is a runtime override in the capture page (`--nbias 1.1`), **no source edit**.
- With the flat `1.1 * texel` offset, open-ground acne stays at zero at 60 / 15 / 4 / 1 degrees in all five windows (at most
  1 code), and post and boot gaps stay 0.0 cm (`vt04b-nbias1.1-medium-webgpu.json`). So on flat ground the factor buys nothing.
- On its own it is **not a complete fix**: see the second A/B below (the depth bias then darkens the objects themselves).

### Diagnosis: two bias errors that hid each other (Medium webgpu, runtime A/B, no source edit)

Read in three r187 (`ShadowNode.setupShadowCoord`, `Renderer._shadowSide`): the shadow map is rendered with the BACK faces of
single-sided casters, and `bias` is ADDED to the receiver depth, so a positive bias means MORE shadow. The rig's slope-scaled
depth bias was positive (up to 8.7 texels on a surface the sun grazes). Not involved: cascade far / light-space bounds
(`lightMargin` 300 m, range 530 m), the horizon-map hand-over (it is a separate multiply and its luma step is 0.0).

Run `--tip 1 --nbias <k> --dbias <m>` (`checks/bias-ab.log`, json and frames in `checks/vt04b/ab/`). "Object false shadow" = share
of the convex object's lit pixels that are more than 4 codes darker than with shadows off (nothing can legitimately shadow them).

| Rule (normal offset, depth bias) | Post length 15 / 4 deg | Boulder length 15 / 4 deg | Post / boulder false shadow at 4 deg | Post contact gap 15 / 4 / 1 deg |
| --- | --- | --- | --- | --- |
| Shipped: `1.1 texel / sin(el)`, `+(0.6 + 0.9 tan) texel` | 3.38 / 6.64 m | 1.30 / 0 m | 0 % / 0.2 % | 0 / 0 / 0 cm |
| `1.1 texel`, depth bias as shipped | 3.64 / 10.94 m | 1.58 / 5.88 m | **51.9 % / 13.1 %** (43 % / 9.6 % at 15 deg) | 0 / 0 / 0 cm |
| **`1.1 texel`, depth bias 0** | 3.64 / 10.94 m | 1.58 / 5.88 m | 1.0 % / 1.4 % | 0 / 0.2 / 0.2 cm |
| `1.1 texel`, depth bias sign flipped | 3.64 / 10.94 m | 1.58 / 5.88 m | 0 % / n/a | **9.0 / 20.1 cm / n/a** |

(expected lengths: post 3.78 / 14.35 m, boulder 1.57 / 6.01 m.)

- The oversized normal offset lifted the lookup point above the caster (36 cm in cascade 0 at 4 degrees, 1.5 m in cascade 1,
  4.3 m in cascade 2): that is why the post's shadow ended exactly where cascade 0 ends (6.6 m) and the rock had none.
- The same offset was hiding the wrong-signed depth bias: with the offset corrected and the depth bias left in, half of the
  post's lit face goes dark. With the sign flipped, every contact opens a 9 to 24 cm gap.
- **Zero depth bias with a flat 1.1-texel normal offset has neither artefact.** That is the rule now in source (next section).
- The post is still 24 % short at 4 degrees with any rule: past 10 m from the camera a 10 cm-wide shadow is one texel of
  Medium cascade 1 (9.7 cm) and the PCF dilutes it below half strength. A resolution limit of the preset, not a bias error.
- The boulder "contact gap" of 3.5 cm (4 deg) / 5.2 cm (1 deg) does not change with the depth bias (same in rows 2 and 3). By
  eye the shadow is attached (`sheet-nbias1.1-medium-webgpu.png`). Suspected measurement artefact: the stand-in ground has
  unlit black patches at grazing sun, where the darkening ratio reads 0. Not proven.

### Other backends and presets, BEFORE the fix (stale for shadow length and contact, kept as the record)

- **webgl2 Medium** (`vt04b-flat-medium-webgl2.json`): same as webgpu to the last digit shown: gaps 0.0 cm, boulder shadow
  missing at 1 degree, open-ground acne 0 px above 4 codes (max 1 code), lit luma within 2 codes of webgpu. Backend parity of
  the OLD rule only; **webgl2 after the fix NOT RUN.**
- **High webgpu** (`vt04b-flat-high-webgpu.json`): post 4.66 m of 14.35 m and boulder 4.16 m of 6.01 m at 4 degrees (same
  defect, the shadow ends where High's cascade 0 ends); gaps 0.0 cm except boulder 5.1 cm at 1 degree. The acne windows read 1
  to 3 % of pixels above 4 codes at 4 degrees and 5 to 11 % at 1 degree, located on crater rims of the ground shading
  (`acne-high-sun4-flat-high-webgpu-heat.png`). **Not interpreted**: the two frames compared are separate TRAA resolves, so
  this may be temporal noise of a still camera rather than shadow acne; the control capture that would tell them apart was
  written (`--control 1`) and NOT RUN. Either reading is a High-preset defect worth a look (shimmer or acne at low sun).
  **High after the fix NOT RUN.**
- Slope before the fix (`vt04b-slope-medium-webgpu.json`): gaps 0.0 cm, slope boulder 3.3 cm at 4 degrees and no shadow at 1
  degree; ramp-face acne 0 px above 4 codes with the sun 1 to 15 degrees above the horizon and at 6 and 3 degrees on the face.

## 1b. VT-M0-15 horizon map on / off (Medium, webgpu) — measured; High and webgl2 NOT RUN

Run: `node vt15.mjs --backend webgpu --preset medium --ts 0.5,0.25,0.75` (`?scene=s01&view=fly:<t>&sun=4&az=100&terrain=/assets/terrain/`,
three positions on the P4 flyover, CSM far 120 m, 0 console errors). Data `checks/vt15/vt15-medium-webgpu.json`, frames
`checks/vt15/fly-<t>-medium-webgpu-horizon{On,Off}.png`. Method: frames ON, OFF and U (nothing casts, horizon off) toggled at
runtime; about 66,000 world ground samples per position projected to pixels; darkening `1 - frame/U` per sample by view depth.

| Position | Shadowed ground share 40-120 m, ON / OFF | Share beyond 120 m (140-240 m), ON / OFF | Mean luma 140-240 m, ON / OFF | Horizon-edge 10-90 % width beyond 120 m (median) |
| --- | --- | --- | --- | --- |
| t = 0.25 | 2.0 % / 0.3 % | 12.7 % / 0 % | 136.8 / 157.1 | 0.80 m, 4.6 px (53 edges) |
| t = 0.5 | 0.1 % / 0 % | 11.9 % / 0 % | 151.6 / 170.3 | 1.25 m, 7.9 px (50 edges) |
| t = 0.75 | 32 % / 0 % | 0.5 % / 0 % | 165.5 / 166.1 | 0.65 m, 4.2 px (22 edges) |

- **Far terrain shadows continue past the CSM range with the horizon term and vanish without it**: beyond 120 m the shadowed
  share is 12 to 13 % ON against 0 % OFF at two of three positions (the third has almost no shadow there either way).
- **Luma step at the CSM far distance: 0.0 codes** attributable to the hand-over (ring means of the shadow darkening in 4 m
  depth rings, horizon OFF: largest step within 16 m of the seam 0.00 to 0.02 codes; bar 8). The ON steps there (0.3 / 6.0 / 19.7
  codes) are real shadow boundaries of the horizon term, which does not depend on the cascades.
- **Edge-width ratio across the seam: NOT MEASURABLE in this scene.** With the horizon term off, the cascades draw no terrain
  shadow edge on any of the lateral cuts inside 120 m (0 edges at all three positions), so there is no cascade edge to compare
  with. Horizon-term edges inside vs beyond the seam at t = 0.75: 0.70 m (50 edges) vs 0.65 m (22 edges), ratio 0.93 in metres.
- Caveat: samples hidden behind terrain are not removed; shares are of sampled ground points, not of visible pixels.

Looked at (`fly-0.75-*`, `fly-0.25-*`):

1. The horizon-term shadow has a **faceted, straight-segment outline** with sharp corners (`fly-0.75-medium-webgpu-horizonOn.png`,
   mid field): the horizon angles are per vertex and interpolated across the cap's triangles.
2. **At dawn the outpost casts no shadow from the flyover** (`fly-0.25-medium-webgpu-horizonOn.png`): hab, annex, solar panels and
   all boulders are shadowless; only the upper part of the mast casts a streak, and it starts well away from the mast's foot
   (detached). Same suspected cause as 1a defect 1 (the far cascade's normal offset is several metres at 4 degrees). This is the
   most visible defect found so far.
3. Unlit terrain slopes are near black with hard polygonal edges in both ON and OFF (terrain shading facets, not shadows).

### After the shadow-bias fix (Medium webgpu, `checks/vt15/fixed/vt15-medium-webgpu.json`, 0 console errors)

Measured on the intermediate rule (flat normal offset, no depth bias); the final half-texel depth bias moves a shadow edge by
at most 14 cm in the far cascade and was not re-run here.

| Position | Shadowed share 40-100 m, ON / OFF | Cascade edges inside 120 m (horizon off): n, median | Horizon edges beyond 120 m: n, median | Ratio beyond / inside | Step at the cascade end, horizon off |
| --- | --- | --- | --- | --- | --- |
| t = 0.25 | 9.0 % / 9.0 % | 12, 0.60 m / 6.3 px | 53, 0.80 m / 4.6 px | **1.33** (m), 0.73 (px) | 0.8 codes |
| t = 0.5 | 1.7 % / 1.7 % | 1 (too few) | 50, 1.25 m / 7.9 px | not meaningful (n = 1) | 0.1 codes |
| t = 0.75 | 45.5 % / 34.8 % | 42, 0.60 m / 6.0 px | 22, 0.65 m / 4.2 px | **1.08** (m), 0.70 (px) | 6.6 codes |

- The cascades now draw terrain shadows at 4 degrees (t = 0.75: 34.8 % of the ground at 40 to 100 m with the horizon term off;
  before the fix 0 %), so the seam comparison exists: **edge-width ratio 1.08 and 1.33 against the bar of 2.0.**
- "No luma step > 8 on flat ground" at the hand-over: with the horizon term on, ring means step by 0.3 / 4.9 / 20.0 codes within
  16 m of 120 m, but those rings cross genuine shadow boundaries (the shadowed share changes from 15 % to 0 % there at
  t = 0.75). This terrain has no flat lit strip across the seam, so the clause cannot be isolated; the only seam-specific
  number is the cascade end step with the horizon off, 0.1 to 6.6 codes.
- Far-field numbers beyond 140 m are unchanged from the table above (they come from the horizon term alone).

Verdict: VT-M0-15 holds on Medium webgpu for continuation and edge-width ratio; the flat-ground step clause is not isolable in
this scene. Open look defects from the first run stand (faceted horizon-shadow outline, near-black unlit slopes). The "outpost
casts no shadow at dawn" defect had the same cause as 1a; not re-captured from the flyover after the fix. High and webgl2 NOT RUN.

## 2. Moving-camera TRAA / SMAA smear (High, webgpu) — measured

Run: `node traa.mjs --preset high --backend webgpu` (`?scene=typical`, real regolith material, 1920x1080, `scale=1`, fixed 1/60 s
steps, 0 console errors). Data `checks/traa/traa-high-webgpu.json`; frames `checks/traa/<path>-<config>-{moving,still}.png`;
side-by-side crops `checks/traa/montage-{forward-5mps,strafe-5mps,yaw-90dps}.png` (row order in the `.txt` next to each).
Per path the camera moves 20 frames at a constant speed onto a fixed end pose; the last moving frame M is compared with the
converged still S (40 held frames) of the same pose and configuration. Camera pose written before the visuals update.
Three configurations: TRAA as shipped; TRAA with the velocity buffer forced to "no motion" at runtime (what the terrain would do
without `CameraOnlyVelocity`); `traa=off` (SMAA). Ground = lower 45 % of the frame.

| Path | TRAA shipped: ground mean diff / p99 / sharpness | TRAA, no velocity: ground mean diff / p99 / sharpness | SMAA |
| --- | --- | --- | --- |
| 1.5 m/s forward | 0.52 / 5.2 codes / 0.79 | 1.00 / 8.2 / 0.69 | 0 / 0 / 1.00 |
| 5 m/s forward | 0.47 / 4.8 / 0.85 | 0.94 / 11.9 / 0.80 | 0 / 0 / 1.00 |
| 15 m/s forward | 0.39 / 3.3 / 0.93 | 0.67 / 6.0 / 1.05 | 0 / 0 / 1.00 |
| 5 m/s sideways | 0.20 / 1.8 / 0.98 | 1.17 / 11.3 / 0.69 | 0 / 0 / 1.00 |
| 30 deg/s yaw | 0.42 / 4.2 / 0.86 | 1.20 / 13.9 / 0.68 | 0 / 0 / 1.00 |
| 90 deg/s yaw | 0.31 / 2.8 / 0.96 | 1.14 / 10.9 / 0.70 | 0 / 0 / 1.00 |

(diff = `|M - S|` luma in 8-bit codes; sharpness = mean Sobel magnitude of M over S, 1 = as sharp as the still.)

- **TRAA as shipped: no ghost trails seen; the moving frame is 2 to 21 % softer than the still on the ground** (worst at walking
  speed, 1.5 m/s: sharpness 0.79), whole-frame share of pixels more than 8 codes off 0.4 to 0.9 %.
- **`CameraOnlyVelocity` does fix terrain smear.** Without it the ground diff is 1.7x to 5.9x larger (sideways 0.20 -> 1.17,
  90 deg/s yaw 0.31 -> 1.14) and the ground loses about 30 % of its edge energy on four of six paths. By looking (montages, rows
  0 vs 2): with velocity the craters and pebbles stay readable; without it they wash out and the custodian and hazard stripe
  show doubled edges on the yaw path.
- SMAA has no temporal term: moving frame identical to the still (0 codes), as expected; it is the sharper but single-sample
  option.
- Frame time in stepped mode at 1080p High: about 216 ms (TRAA + GTAO) vs 98 ms (SMAA) on the UHD 620 (not a perf claim).
- Limits: constant-speed paths only (no acceleration, no moving objects, no dust), one scene, webgl2 NOT RUN. The residual
  softening was not compared against a tuned TRAA (history weight, sharpening); that is a tuning question, not a defect call.

## 3. `?perf=1` HUD cost — measured

Run: `node hud.mjs --preset low --backend webgpu` (`?scene=typical&scale=0.75&perf=1&hud=0`, free-running, Chrome
`--disable-frame-rate-limit`, 8 alternating 8 s windows HUD on / off in one page, about 317 frames each, 0 errors).
Data `checks/hud/hud-cost-low-webgpu.json`, capture `checks/hud/hud-on-low-webgpu.png` (HUD legible, reads "HUD cost p95 1.80 ms").

| | HUD on | HUD off | Delta |
| --- | --- | --- | --- |
| Frame interval avg | 25.32 ms | 25.58 ms | -0.26 ms (window spread 0.2 to 1.0 ms: **not distinguishable from 0**) |
| Frame interval p50 / p95 | 25.15 / 28.80 | 25.33 / 28.58 | -0.18 / +0.23 ms |
| Debug module step avg (`mc:debug:update` spans) | 0.196 ms | 0.068 ms | **+0.13 ms per frame** |
| Debug module step p95 | 1.33 ms | 0.15 ms | +1.18 ms (the 4 Hz text rebuild frames) |

The HUD costs about 0.13 ms of main-thread time per frame on average and 1.1 to 1.5 ms on the frames that rebuild the text;
it does not move the frame interval on this GPU-bound device. Medium / High and webgl2 NOT RUN.

## 4. VT-M0-03 / 05 / 13 / 14 (driver `sky.mjs`, data `checks/sky/*.json`)

**VT-M0-03 cascades match preset — PARTIAL.** Read from the live CSM lights in S05 (`sky-cascades+*.json`):

| Preset | Cascades | Map | Cascade-0 split | Far | Texels c0 / c1 / c2 | Preset table |
| --- | --- | --- | --- | --- | --- | --- |
| Medium webgpu | 3 | 1024 x 1024 | 10 m | 120 m | 2.3 / 9.7 / 27.6 cm | 3 / 1024 / 10 m / 120 m: match |
| High webgpu | 3 | 2048 x 2048 | 8 m | 200 m | 0.9 / 6.4 / 23.0 cm | 3 / 2048 / 8 m / 200 m: match |

Seam on lit flat ground in the normal view: none (item 1a acne windows span all three cascades, at most 1 code of difference).
**Cascade debug view: added and run.** `?debug=cascades` tints the sunlight per cascade (0 red, 1 green, 2 blue, 3 yellow, past
the last white): `checks/look/debug-cascades-{s05-wide,typical-wide}-medium-webgpu.png`, 0 console errors. Looked at: three bands, red
nearest the camera, then green, then blue, in the order of the sidecar's 10 / 42 / 120 m ends (band distances not measured). The tint switches hard at the split; the real cascades
cross-fade there, so the view shows where a split is, not the blend width. Seam inside a shadow that crosses a split:
NOT MEASURED. Low and webgl2 NOT RUN.

**VT-M0-05 HDR + AgX — measured on Medium webgpu, S01 dawn view a** (`s01-dawn-a-medium-webgpu.png`, 200 % crop
`vt05-sun-halo-2x-medium-webgpu.png`):
- Sun disk core 255 / 255 / 255; bloom ring 4 to 14 px neutral within 2.2 codes (247 / 246.5 / 246, 235.5 / 234.4 / 233.3):
  **the disk blooms white, no hue shift**.
- Beyond 14 px the halo is warm (176.9 / 170.4 / 168.4 at 14 to 24 px, 141 / 128 / 126 at 24 to 40 px): that is the sky dome's
  warm lift toward the sun (T03b), not the bloom.
- Banding: on a sky column 600 px right of the sun every adjacent step is 1 code (the 8-bit minimum), longest flat run 42 px
  (blue), 4 runs of 16 px or more in green and in blue; through the halo to the right the blue channel has a 46 px flat run. No
  dither is applied. **By looking at the 200 % crop I could not see bands**; on a dark-room monitor the 40 px plateaus in the
  navy gradient are the place to check. Earth-limb gradient: looked at (`vt14-earth-*-3x-*.png`), smooth, not measured.
- Look note: the dawn glow around the sun reads as a large dull mauve-brown haze rather than a clean warm lift.
- High, webgl2 and ACES NOT RUN.

**VT-M0-14 Earth size — measured** (largest connected lit region, maximum Feret diameter; Medium webgpu):

| Case | Diameter px | Degrees | VT bar |
| --- | --- | --- | --- |
| Shipped look (4.2 deg), Earth on the optical axis | 69.7 | 4.27 | 2.4 +- 0.1 deg: **not met by design** (T03b chose 4.2; diagnostic in reference mode) |
| `earthDiameterDeg = 2.4`, on axis | 40.3 | 2.47 | 39 +- 2 px: met, the size control is accurate |
| Shipped look where S01 view a puts it (280, 192 px, near the corner) | 94.7 x 80.5 | n/a | **disk is visibly egg-shaped** (ratio 1.18) |

Defect to flag: near the frame corner the Earth is stretched by the rectilinear projection into an ellipse
(`vt14-earth-corner-shipped-4.2deg-3x-medium-webgpu.png`); compose it nearer the centre or draw it as a screen-aligned disk.

**VT-M0-13 stars stable — measured, short pan** (S06, yaw 2 deg/s in 1/60 s steps = 0.54 px per frame, 90 frames = 1.5 s, not the
VT's 10 s; 39 stars tracked, none saturated; peak luma above the local background per frame):

| Preset | Per-star peak variation: median / worst | Stars within 10 % | Size (second-moment sigma) | Roundness |
| --- | --- | --- | --- | --- |
| Medium (SMAA) | 8.8 % / 13.0 % | 72 % | 1.14 px (FWHM about 2.7 px) | 1.00 |
| High (TRAA), frames 12 to 90 of the pan | 12.9 % / 20.7 % | 28 % | 1.11 px | 0.81 |

(variation = (max - min) / max of the per-frame peak; the first 12 frames after the camera starts are left out of both rows.)

- **Medium: marginal fail** of "per-star peak varies <= 10 %" (28 % of stars exceed it, worst 13 %). Stars are round soft disks,
  never squares (`vt13-star-6x-medium-webgpu.png`); sigma 1.14 px is just under the 1.2 px asked if "radius" means sigma.
  Moving stars are as bright as still ones (ratio 0.997).
- **High: fail, two effects.** (a) When the camera starts to pan, stars drop to **72 %** of their still peak (median) and stretch
  (roundness 0.81). (b) While panning they flicker more than on Medium (median 12.9 %, worst 20.7 %). Including the first
  frames the variation is 33.8 % median / 46.2 % worst. Cause as T03 predicted: stars are drawn in the scene pass and go
  through the temporal resolve. Fix direction (not done, it needs the post plumbing): draw stars after the resolve.

## Notes for others

- **Vite reloads pages when another worker edits a watched file** (`src/app/launch-policy.ts` was edited mid-capture and
  killed a run). Captures now use `checks/driver/vite.capture.config.ts` (watcher and HMR off, port 5193).
- `FrameLoop` binds each module's `update` at construction and the debug module (last in the order) applies `__mcCameraPath`
  AFTER the visuals update, so with a scripted path the sun cascades, sky and camera-velocity buffer see the previous frame's
  camera. Not measured; relevant to tools/perf captures on TRAA presets.

## Other look defects seen (not fixed, for visual-qa / lead)

1. Stand-in ground (`lookdev/ground-material.ts`) at 4 and 1 degrees: hard-edged black patches over much of the lit ground
   (`checks/vt04b/sheet-flat-medium-webgpu.png`, rows 3 and 4). Not bright or readable. The real regolith material was not
   checked at grazing sun.
2. Stair-stepped shadow edges on Medium at 60 degrees with the `tent4` kernel (same sheet, top row).
3. S05 at 4 degrees: the sun-facing ivory wall clips to flat white with a bloom halo
   (`checks/vt04b/final/view-wide-sun4-final-medium-webgpu.png`).
4. Dawn sun glow reads as a dull mauve-brown haze (`checks/sky/s01-dawn-a-medium-webgpu.png`).
5. Earth is egg-shaped near the frame corner; stars dim and flicker under TRAA (item 4).

## NOT RUN (with reason)

- After the fix: High (any item), webgl2 (1a, 1b), slope and VT-M0-15 on the FINAL rule, Medium frame cost, a 10 s continuous
  sun sweep: stopped by the coordinator's narrowed brief ("do not start new measurement campaigns").
- High "acne" control, VT-M0-13 at the VT's full 10 s, VT-M0-05 on High / webgl2 / ACES, TRAA smear on webgl2, HUD cost on
  Medium / High / webgl2, Low preset anything: not reached.
- Tier A / B: no such hardware. `pnpm verify`: lead's integration step.

## Files

Edited (`apps/client/src/visuals`): `lighting/shadow-bias.ts` (new rule, old depth-bias functions removed),
`lighting/sun-rig.ts` (flat normal offset, half-texel `shadow.bias`, per-pixel bias node removed, `?debug=cascades` tint in
`MoonShadowNode`, `update` ignores its elevation argument), `look-knobs.ts` (`debug=cascades` -> `debugCascades`),
`module.ts` and `lookdev/s02-lookdev-kit.ts` (call sites), `visuals-pure.test.ts`, `look-knobs.test.ts`.
Nothing edited under `render/**` or `app/**`.

New: `docs/visual-reviews/M0/checks/driver/{lib,vt04b,vt15,traa,hud,sky,lookcheck}.mjs`, `chain-*.sh`,
`vite.capture.config.ts`; captures and json under `docs/visual-reviews/M0/checks/{vt04b,vt15,traa,hud,sky,look}/`; logs
`checks/*.log`. `checks/dbt-ab.log` is an invalid run (the driver's runtime patch threw); `dbt-ab2.log` replaces it.

Next: visual-qa review of the fix and the defect list; owner of rendering-pipeline section 5.2 amends the bias row; re-run
`vt04b.mjs` / `vt15.mjs` on High and webgl2 when the machine is quiet; star layer after the temporal resolve.

Commit suggestion: `fix(client): sun-shadow bias no longer drops shadows at grazing sun; add ?debug=cascades view (M0 visual checks)`

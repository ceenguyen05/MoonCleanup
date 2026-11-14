# M0 look-polish round 2, part B (items 2, 3, 5, 6, 7)

Task M0-look-polish-r2b / status: **in-review** / 2026-11-13 / technical-artist, Fable 5.2, high effort. One Intel UHD 620
laptop (floor device), headed Chrome, real app through the capture Vite config (own port 5195), 1920x1080 DPR 1.
**All numbers provisional: floor device, no Tier A/B claim.** No installs, no git. Writer of
`apps/client/src/visuals/{lighting,lookdev,materials}/**` only. Evidence root: `docs/visual-reviews/M0/checks/r2b/`
(drivers `checks/driver/r2b-shadow.mjs`, `r2b-ground.mjs`).

## Status per item (updated after each item)

| # | Item | State | Before | After | Evidence |
| --- | --- | --- | --- | --- | --- |
| 7 | S01 / S05 / S06 on the real regolith | **done, measured** (VT re-record: see section) | S01 Low webgpu **3.6 fps**, frame p95 349.5 ms (device script, scale 1.0) | S01 Low webgpu **20.7 fps**, frame p95 66.6 ms (same script); 0 console errors on 9 scene / view captures | `r2b/device/{before,after}/*.md`, `r2b/scenes/*.png` |
| 3 | Black patches at grazing sun | **fixed, measured** (term = detail normal; both grounds) | black-patch share of the frame, sun 1 deg: stand-in 24.5 %, real regolith 15.9 %; sun 4 deg: 4.8 % / 3.8 % | sun 1 deg: 0.8 % / 0.5 %; sun 4 deg: 0.5 % / 0.1 % | `r2b/graze/*.png`, `r2b-ground-graze-medium-webgpu.json` |
| 2 | Medium shadow-edge stair steps | **fixed, measured** | `tent4` radius 1.5: doubled edge, flat step 0.98 cm inside the ramp | `pcf3` on every cascade (Low / Medium): one ramp, flat step 0; frame p50 **+0.6 ms on Medium and on Low** (A/A control -0.2 / 0.0) | `r2b/shadow/crop-post-{before,new}.png`, `teeth-{new,pcf3all}.png`, `cost-{medium,low}-pcf3all.log` |
| 5 | Boulder contact gap | **fixed, measured** (real gap, not a measurement artefact) | 3.5 cm @4, 5.2 cm @1 (10 / 14.9 px at 3 m) | **0.0 cm @4, 0.2 cm @1** (0 / 0.6 px at 3 m; macro view 0.5 cm) | `r2b/vt04b/vt04b-r2b-medium-webgpu.json`, `contact-boulder-sun{4,1}-r2b-*.png` |
| 6 | VT-M0-15 edge-width ratio | **re-measured; the earlier figure does not hold** | 1.08 / 1.33 in metres (intermediate rule) | shipped code, horizon edges beyond 120 m / cascade edges inside: **2.86 at t = 0.25 (over the 2.0 bar), 0.58 at t = 0.75** in metres; 1.44 / 0.30 in pixels; t = 0.5 not measurable (2 edges) | `r2b/vt15/vt15-medium-webgpu.json`, `r2b/vt15-{oldkernel,biasonly}/` |

## State found on disk at the start (10:18; edits of 10:15 to 10:17 by the first round-2 worker, none captured or tested)

- `lighting/shadow-filter.ts`: kernels `pcf3` (exact tent from 4 bilinear comparisons, taps and weights from the sub-texel
  position), `pcf5` (9 comparisons) and the pure mirror `tentTaps1d`; `tent4` kept. `lighting/sun-rig.ts`: `pcf3` default on
  SMAA presets, `?shadowfilter0=`, key direction written to a shared uniform (`lighting/key-direction.ts`).
- `materials/regolith-material.ts` + `regolith-constants.ts`: grazing-sun detail fade and optional `macroVariation`.
- `lookdev/props.ts`: rocks have a flat base at `ROCK_BASE_Y`, buried by `ROCK_SINK` (`rockRestY`).
- No stray edit in the three folders after 10:17:30; no `M0-look-polish-r2c.md`.

## Item 2: shadow edges (Medium / Low)

- **Cause confirmed.** Low / Medium ran `tent4` at radius 1.5 (preset `pcfWidthTexels`, not 2 as the diagnosis said): the four
  1-texel boxes sit 1.5 texels apart, so the kernel has a half-texel hole. S05 `post` view, Medium webgpu, sun 60 / az 250,
  cascade-0 texel 2.3 cm: the edge profile has a **flat step of 0.98 cm** (0.43 texel) inside the ramp and the crop shows a
  doubled outline (`crop-post-before.png`).
- **Shipped: `pcf3` on every cascade of the SMAA presets** (TRAA presets keep three's rotated disk). Cascade 0, post shadow:
  one smooth ramp, flat step 0, 10-90 % width on screen 4.13 cm against 4.33 cm before (`crop-post-new.png`).
- **Tried and rejected: `tent4` at radius 1** (its boxes tile, no hole, same shader as before so no cost). On cascade 0 it
  removes the double edge but keeps texel-sized steps along a diagonal edge (`crop-post-tent4r1.png`, 5.8 px per texel); on
  cascade 1 (9.7 cm texels) it draws a **texel-period comb** on the canopy shadow edge that crosses the S05 ramp
  (`teeth-new.png`, captured while the far cascades still ran it); `pcf3` there leaves a faint ripple (`teeth-pcf3all.png`).
  `tent4` is now capped at radius 1 when a knob selects it. Knobs: `?shadowfilter=<id>` all cascades, `?shadowfilter0=<id>`
  cascade 0 alone, `?shadowfilter=tent4&pcf=1.5` = the state before.
- **Frame cost of the shipped kernel** (`typical` scene, `play` view, webgpu, no vsync, scale at the preset ceiling, 3 pages
  per variant in rotated order, 8 s each; `tent4r1` runs the SAME shader as `before` and is the noise control):

  | Preset | before p50 (3 pages) | pcf3 all cascades p50 (3 pages) | tent4r1 p50 (control) | pcf3 - before, median | control - before |
  | --- | --- | --- | --- | --- | --- |
  | Medium 0.85 | 28.5 / 28.9 / 29.6 | 30.0 / 29.0 / 29.5 | 28.7 / 28.9 / 28.5 | **+0.6 ms** | -0.2 ms |
  | Low 0.75 | 26.2 / 25.5 / 25.4 | 26.1 / 28.9 / 25.4 | 25.5 / 26.6 / 25.5 | **+0.6 ms** | 0.0 ms |

  Within +1 ms on both presets (`cost-{medium,low}-pcf3all.log`). Two noisier runs exist and agree within their scatter:
  `pcf3` on cascade 0 only +0.4 (Medium) / +0.7 (Low) with a control at +0.5 / +0.2 and one hitched page (avg 62.9 ms)
  (`cost-{medium,low}.log`); an A, B, A, B run without rotation +1.05 / +1.65 (`r2b-shadow-cost-webgpu.json`, order-biased:
  the old kernel always ran first). Identical pages differ by up to 5 ms on this machine when it is busy.
- **Spec note for the owner of rendering-pipeline 5.2:** the row asks for a filter 10-90 % width of about 1.5 texels. Computed
  (`shadow-filter.test.ts`): `tent4` radius 1 = 1.6 texels, `pcf3` = 2.2 texels, the old `tent4` radius 1.5 = 2.6 texels.
- The far-cascade crop of the driver (`crop-wall-*`) is INVALID: the wall hides its own shadow from that camera. Far-cascade
  edges were only looked at in the full frame (`s05-wide-new.png`: clean straight canopy edges).

## Item 3: black patches at grazing sun

- **Term: the detail normal** (not AO, not the horizon term, not the bias). S05 Medium webgpu, runtime toggles on one page,
  share of frame pixels darker than half the median luma, minus the same share with the relief switched off (state B, which
  leaves sky and cast shadows only):

  | Ground | Sun | A: fade off (before) | B: relief off | C: shipped | Patches before (A - B) | after (C - B) |
  | --- | --- | --- | --- | --- | --- | --- |
  | stand-in | 4 deg | 14.25 % | 9.45 % | 9.99 % | 4.8 % | 0.5 % |
  | stand-in | 1 deg | 26.17 % | 1.68 % | 2.44 % | 24.5 % | 0.8 % |
  | real regolith | 4 deg | 13.19 % | 9.36 % | 9.48 % | 3.8 % | 0.1 % |
  | real regolith | 1 deg | 17.02 % | 1.08 % | 1.58 % | 15.9 % | 0.5 % |

  (`empty` pose: open lit ground, camera 1.5 m up.) The real regolith material had the same defect (it had not been checked
  at a grazing sun before): every bump of the detail relief that faces away from a 1 to 4 degree sun has N.L <= 0.
- **Fix (both materials):** detail slopes are scaled by clamp(N_geometry . L / sin 20 deg, 0.08, 1), so the relief keeps its
  relative shading contrast instead of clipping to black; noon is untouched (gain 1 from 20 degrees up). Runtime handles for
  A/B: `material.userData.mcGrazeFade` and `mcBump` (uniforms).
- Looked at `graze-regolith-sun1-post-A-fadeoff.png` (black blobs over the whole lit ground) against `...-C-shipped.png`
  (even grey ground, craters read as soft shading, long post and canopy shadows intact) and `graze-regolith-sun4-empty-C-shipped.png`.
- Still visible in C: small dark crescents inside the nearest craters at 1 degree (0.5 % of the frame), and the ivory post and
  canopy clip to flat white with a bloom halo at 1 and 4 degrees (M0-visual-checks defect 3, not in this brief).

- **The flat dark band on the left ground of S01 dawn view `a`** (`checks/r2/sky/s01-dawn-a-medium-webgpu.png`) **is a cast
  shadow, not this defect**: same page, band rectangle (100, 640, 600 x 120 px) mean luma 56.1 with everything casting and
  158.3 with nothing casting (`r2b/scenes/s01-dawn-a-{real,unshadowed}-medium-webgpu.png`). It is the merged 4 degree shadow
  of the hab, annex and solar array. The black blobs on the right ground of that capture are the defect; they are gone in
  `r2b/scenes/s01-a-dawn-medium-webgpu.png`.

## Item 7: S01 / S05 / S06 on the real regolith

- `lookdev/look-ground.ts` (new): the scenes' ground is the real regolith material (9 fetches, 2 sampled textures; with 3
  cascades and S06's lamp shadow at most 6 of the 12 allowed) on a stamped 2048^2 mask: Lane Broom rows (1.6 m passes, 1.5 m
  pitch) that fill the cleaned disk with stepped lane ends and real berms. S01: 22 m disk (was 27 m + noise wobble), three
  passes in progress, Desk Duster scribbles and one lane leaving, all in the dust in front of views `a` / `b`; macro tone / hue
  variation on. S06: 38 m disk, macro on. S05: all clean, macro off (calibration scene). `&ground=standin` keeps the old
  stand-in for A/B. S01's clean probe moved from (-6, -16) to (-4, -8) (the old point is dust now).
- **"Baked terrain path that typical uses":** `typical` uses no baked terrain (procedural cap + real material; the only baked
  input is the sky dome, which every scene already had). The baked-terrain path is S01's `&terrain=` (LOLA cap + horizon map,
  VT-M0-15); it runs the real material too (item 6 run).
- **Frame rate, UHD 620, webgpu Low:**

  | Scene | Ground | Device script (scale 1.0) | Free-running at the Low ceiling 0.75: fps, frame p50 / p95 |
  | --- | --- | --- | --- |
  | S01 | stand-in (before) | **3.6 fps**, p95 349.5 ms | 6.6 fps, 140.4 / 207.8 ms |
  | S01 | real regolith | **20.7 fps**, p95 66.6 ms | **35.0 fps**, 28.0 / 35.4 ms |
  | S05 | stand-in (before) | not run | 5.4 fps, 167.8 / 247.1 ms |
  | S05 | real regolith | not run | **34.3 fps**, 28.0 / 47.2 ms |
  | S06 | stand-in (before) | not run | p50 235.7 ms (about 4 fps; 17 frames in 8 s, one 10 s stall) |
  | S06 | real regolith | not run | **21.9 fps**, 42.0 / 85.1 ms |

  Device script: `pnpm --filter @moon-cleanup/perf device-report --only s01:webgpu:low` (it pins scale 1.0, above the Low
  ceiling; its floor row still FAILS: 20.7 of 30 fps). Free-running: `r2b-ground.mjs --part fps --preset low`, one 8 s page per
  cell. S01 and S05 are at 30 fps or above at the Low ceiling; **S06 is not** (21.9 fps: three extra lights, one with its own
  shadow map; not profiled further).
- Captures, Medium webgpu, scale 1, **0 console errors on all**: `r2b/scenes/s01-{a-noon,a-dawn,b-noon,wide-morning,close-noon}`,
  `s05-{wide-sun15,slope-sun60}`, `s06-{pool,wide}`, and `s01-a-noon-standin` (first composition) for comparison.
  Looked at: `s01-a-noon` (stepped lanes, bright patch against grey dust, berm lines), `s01-wide-morning` (the whole patch:
  rows with stepped ends, passes in progress, scribbles), `s01-a-dawn` (no black patches; long shadows), `s06-pool` (lamp
  pool, earthlit ground, soft shadows), `s05-slope-sun60`.
- **VT numbers re-recorded on the final code** (`lookcheck.mjs --tag r2b`, Medium webgpu, 0 console errors,
  `r2b/look/lookcheck-r2b-medium-webgpu.json`; "before" = `checks/look/lookcheck-final-medium-webgpu.json`):

  | Number | Target | Before | After |
  | --- | --- | --- | --- |
  | S02 chart 0.10 / 0.33 / 0.80 | 126 / 181 / 213 +-8 | 130.1 / 180.3 / 212.4 | 130.1 / 180.3 / 212.4 |
  | S02 grime / clean chip, ratio | ratio >= 1.5 | 119.8 / 181.9, 1.52 | 119.8 / 181.9, **1.52** |
  | S05 flat lit / flat shadow (fill) | 183.5 / 85.0 (VT-M0-16: 81 to 97) | 183.6 / 85.0 | **182.4 / 86.0** |
  | S05 slope lit / slope shadow | | 181.1 / 88.5 | 180.9 / 87.2 |
  | S05 shadow b* minus lit b* (flat; slope) | not below -3 (VT-M1-09) | +1.92; -3.17 | **-2.51; -2.48** |

  S02 is untouched (it never used the stand-in). The S05 fill moved by 1.2 / 1.0 codes because the ground changed from the
  stand-in to the real material; both stay inside their bars. **The b* margin is thin (0.5):** the real clean ground is
  neutral-cool, so its shadow reads 2.5 b* bluer than the lit ground (stand-in flat: shadow warmer than lit). Inside the
  "never blue" rule, but one tint change away from failing it; owner of the fill tint (`sun-rig.ts` `FILL_TINT`, cool lean
  1.045 on blue) should know.
- **Look differences against the stand-in, for visual-qa:** (1) dust reads as a neutral mid grey (S01 `a` noon: clean probe
  184.9, dust 144.2 through the look grade), not the warmer tan of the stand-in; (2) the Lane Broom tonal stripes inside the
  patch are gone (the real material has no lane-stripe term yet: M1 direction texture); (3) at dawn, up-sun, dust and clean
  ground both wash out to near white on the lit side (the stand-in did the same); (4) no normal-only craters in the albedo:
  the relief is the detail tile's.

## Item 5: boulder contact gap

- **It was real, and it was the rock, not the shadow rule.** Same driver, same pose and same bias rule as the "before" run
  (`vt04b.mjs`, S05, Medium webgpu, az 250, side view 3 m from the contact; bar: <= 3 px at 3 m):

  | Sun | Boulder before (`checks/vt04b/final`) | Boulder after, 3 m | after, macro view | Post / boot after, 3 m |
  | --- | --- | --- | --- | --- |
  | 60 deg | 0.0 cm | no shadow on the scan line (it ends under the rock's own outline) | 1.3 cm | 0.1 / 0.0 cm |
  | 15 deg | 0.0 cm | 0.1 cm (0.3 px) | 0.4 cm | 0.0 / 0.0 cm |
  | 4 deg | **3.5 cm (10 px)** | **0.0 cm** | 0.5 cm | 0.0 / 0.0 cm |
  | 1 deg | **5.2 cm (14.9 px)** | **0.2 cm (0.6 px)** | 0.5 cm | 0.0 / 0.4 cm |

- **Explanation.** Post and boots, which stand ON the ground, already had gaps of 0 to 0.5 cm under the same bias rule; only
  the boulder was detached, and only at a grazing sun. The fix that closed it is purely geometric (`lookdev/props.ts`, found
  on disk): the rock's underside is a flat base at `ROCK_BASE_Y`, buried `ROCK_SINK` (3 % of the rock's size, 1.5 cm for the
  0.5 m rock) so the ground cuts its side faces all the way round. Unit-tested in `lookdev/look-ground.test.ts` (every base
  vertex below the ground plane; the plane crosses side faces in all twelve 30 degree sectors). **Not verified:** the first
  worker's reading that the OLD underside was up to 6 cm above the ground. The old geometry is not on disk (the folder is
  untracked), so I could not ray-cast it; the before / after gap is the evidence.
- The rock is 4 cm lower than before (0.38 m against 0.42 m). Shadow length stays right: 5.30 m of 5.44 m expected at 4
  degrees, 21.76 of 21.79 m at 1 degree.
- The remaining 0.5 cm in the macro view is the half-texel PCF sliver the bias rule already documents (cascade-0 texel
  2.3 cm); it is visible as a thin lighter line at the rock's foot only in the x4 macro crop (`macro-boulder-sun1-*.png`).
- **Same run, regression check of the new kernel:** open-ground acne 0 px over 4 codes in all 20 windows (max 0.9 codes);
  1 m post shadow at 4 degrees 10.84 m (was 10.94; 14.35 expected, the known Medium cascade-1 limit); 0 console errors.
- Seen, not fixed: the clean ground's glint grains stay visible as light dots INSIDE cast shadows (same captures).

## Item 6: VT-M0-15 edge-width ratio on the final bias rule

Run: `vt15.mjs --preset medium --backend webgpu --ts 0.5,0.25,0.75` (S01 `&terrain=`, baked LOLA cap + horizon map, sun 4
degrees, CSM far 120 m, 0 console errors). Median 10-90 % widths of shadow edges on lateral cuts: cascade edges inside 120 m
with the horizon term off, horizon-term edges beyond 120 m with it on.

| Condition (all on the final bias rule) | t = 0.25: cascade inside / horizon beyond, ratio m (px) | t = 0.75: same |
| --- | --- | --- |
| **Shipped** (real ground, `pcf3`) | 0.35 m (n 16) / 1.00 m (n 54), **2.86** (1.44) | 1.20 m (n 36) / 0.70 m (n 16), **0.58** (0.30) |
| Old kernel (`tent4` 1.5), real ground | 0.30 m (18) / 1.00 m (54), 3.33 (1.75) | 1.30 m (32) / 0.70 m (16), 0.54 (0.24) |
| Old kernel and stand-in ground (only the bias differs from the earlier run) | 0.40 m (18) / 1.00 m (52), 2.50 (1.32) | 1.30 m (30) / 0.85 m (16), 0.65 (0.29) |
| Earlier run, intermediate bias rule (M0-visual-checks) | 0.60 m (12) / 0.80 m (53), 1.33 (0.73) | 0.60 m (42) / 0.65 m (22), 1.08 (0.70) |

- **True number, shipped code: 2.86 (t = 0.25) and 0.58 (t = 0.75) in metres; 1.44 and 0.30 in screen pixels.** t = 0.5 has 2
  cascade edges and gives no number. In metres the "<= 2x" clause is **not met at t = 0.25** (horizon edges are 2.9 times wider
  than cascade edges) and is inverted at t = 0.75; in pixels both positions are inside 2x. visual-target does not say which
  unit: **owner of VT-M0-15 decides**; I am not calling it a pass.
- The earlier "1.08 / 1.33" came from the intermediate rule and does not survive: on the final rule the same ground and
  kernel give 2.50 / 0.65. The kernel and the ground change move it less than the bias did (rows 1 to 3).
- **The statistic is weak in this scene.** The cascade sample mixes cascade 1 (9.7 cm texels) and cascade 2 (27.6 cm texels)
  edges, 16 to 36 of them, quartiles 0.2 to 0.6 m at t = 0.25 and 0.3 to 3.25 m at t = 0.75; the horizon edges (0.55 to 2.25 m)
  are set by the 0.55 degree smoothstep of the horizon term times the distance to the occluder, not by the seam.
- Continuation still holds: shadowed share at 140 to 240 m is 11.8 % / 12.9 % with the horizon term and 0 % without
  (t = 0.5 / 0.25). Step of the shadow darkening at the cascade end, horizon off: 0.14 / 0.72 / 6.42 codes (bar 8).
- Looked at `r2b/vt15/fly-0.25-medium-webgpu-horizonOn.png`: the outpost now casts long dawn shadows from the flyover (the
  "outpost casts no shadow" defect of M0-visual-checks is gone); those far-cascade shadows are streaky along the sun
  direction; unlit terrain slopes are still near black with hard polygonal edges (both pre-existing, not in this brief).

## Checks (final file state, 11:19 last source edit)

`tsc -p apps/client --noEmit` clean; `vitest run` in `apps/client` **275 tests pass** (visuals: 10 files / 78 tests; new:
`lighting/shadow-filter.test.ts`, `lighting/sun-rig.test.ts`, `lookdev/look-ground.test.ts`); `eslint .` clean;
`prettier --check src/visuals` clean. `pnpm verify` not run (lead's integration step).
WebGL2: `r2b/scenes/*-medium-webgl2.png` and `backend-webgl2-*.png` (S01 noon + dawn, S05, S06): backend confirmed `webgl2`,
filter `pcf3`, 0 console errors, probe lumas equal to webgpu within 0.7 codes. Every server and browser I started is stopped.

## NOT RUN

- High / Ultra (TRAA presets) for any item: their kernel is unchanged (`vogel5`); the new ground was not captured there.
- WebGL2: frame cost of `pcf3`, contact gaps, VT-M0-15, S02 chart (webgpu only this round).
- S05 / S06 through the device script (only S01, as briefed); S06 below 30 fps on Low was not profiled.
- VT-M0-15 on High; a quiet-machine repeat of the frame-cost A/B. Tier A / B: no such hardware.

## Requests / hook-ups (not my paths)

1. **Owner of VT-M0-15 (lead / visual-qa):** decide the unit of the edge-width ratio; in metres it fails at one position.
2. **Owner of rendering-pipeline 5.2:** the Filtering row asks for a filter width of about 1.5 texels; shipped `pcf3` is 2.2
   (old `tent4` at 1.5 was 2.6). "Known look defects" row: black patches, stair steps and the boulder gap are fixed.
3. **visuals root (`perf-pass.test.ts`, other worker / lead):** the test title "SMAA presets use the fixed 4-tap tent" is
   stale (it already asserts `pcf3`); `look-knobs.ts` comment for `shadowfilter` could say `tent4` is capped at radius 1.
4. **visual-qa:** review the S01 / S06 look on the real ground (neutral grey dust, no lane stripes, thin b* margin of the
   S05 shadow, glint dots inside shadows). `&ground=standin` gives the old look for comparison.
5. No hook-up needed in `render/**` or `app/**`: scene ids and URL parameters are unchanged (`&ground=standin` is new).

## Files

Edited: `lighting/{sun-rig,shadow-filter}.ts`, `materials/{regolith-material,stroke-mask}.ts`,
`lookdev/{scene-base,ground-material,s01-approach,s05-shadow-lab,s06-night}.ts`, `lookdev/props.ts` (formatting only; its
rock change was found on disk).
New: `lighting/{shadow-filter,sun-rig}.test.ts`, `lookdev/look-ground.ts`, `lookdev/look-ground.test.ts`,
`docs/visual-reviews/M0/checks/driver/{r2b-shadow,r2b-ground,r2b-teeth,r2b-backend}.mjs`, `vt15.mjs` (`--extra` added),
`docs/visual-reviews/M0/checks/r2b/**`.
Found on disk from the first round-2 worker and kept: `lighting/key-direction.ts`, kernels in `shadow-filter.ts`, grazing
fade in `regolith-material.ts` / `regolith-constants.ts`, flat rock base in `props.ts`.

Next: lead decides the VT-M0-15 unit; visual-qa reviews `r2b/scenes`; profile S06 on Low; repeat items on High and webgl2.

Commit suggestion: `fix(client): real regolith on S01/S05/S06, exact-tent shadow filter on Low/Medium, grazing-sun detail fade (M0 look-polish r2b)`

---

# Round 3: far-shadow comb, S06 / S05 / S01 frame time on Low

2026-11-13 afternoon / technical-artist, Fable 5.2. Same machine and rules as above; writer of `apps/client/src/visuals/**`
this round (nothing edited under `render/**`, `app/boot.ts` or `debug/module.ts`). Evidence: `docs/visual-reviews/M0/checks/r3/`
(drivers `checks/driver/r3-perf.mjs`, `r3-look.mjs`). Low now runs FXAA (changed by another worker at 11:36), so every
"before" below is a fresh capture of this afternoon, not the round-2 number.

Capture method for every frame-time number: `r3-perf.mjs`, real app, headed Chrome without vsync, webgpu, Low, scale pinned
to the 0.75 ceiling, one page per variant per round in rotated order, 6 s warm-up + 8 s. Quoted: median over the pages of the
frame interval p50 and p95. Identical pages differ by up to 2 ms p50 on this machine (one accidental A/A pair: 36.1 / 34.25).

## Round 3 status (updated after each step)

| Step | State | Before | After | Evidence |
| --- | --- | --- | --- | --- |
| 1 Far-shadow comb on Low | **fixed, measured** (`pcf5` on the cascades beyond cascade 0, Low and Medium) | comb of horizontal teeth on both diagonal canopy edges | smooth edges; frame p50 **+0.2 ms Low, +0.5 ms Medium** (A/A control -0.7 / -0.4) | `r3/comb-final-{low,medium}-{before,after}-crop.png`, `r3/kernel-{low,medium}.log` |
| 2a S06 profile | **done** | 36.1 ms p50 (27 fps) | see table | `r3/s06-profile.log`, `s06-cull.log` |
| 2b S06 fix | **done, inside the budget** | 33.7 / 36.2 ms p50 / p95, 29.8 fps | **29.2 / 31.6 ms, 34.3 fps** (p95 of the 3 pages: 31.6 / 31.7 / 31.2) | `r3/s06-final.log` |
| 2c S05, S01 | **measured inside the budget; no dominant cost found to fix** | same run: S01 20.0 / 21.7, S05 20.1 / 21.8 | S01 **19.3 / 21.4** (51.8 fps), S05 **19.5 / 21.4** (50.9 fps); device script S01: 45.9 fps, p95 32.0 ms, PASS | `r3/s01s05-final.log`, `r3/device/1e7deac4b61d.md` |

## Baseline this afternoon (Low 0.75, FXAA, 3 pages each)

| Scene | fps | frame p50 (pages) | frame p95 (pages) |
| --- | --- | --- | --- |
| S01 | 44.2 | 20.6 (20.6 / 19.5 / 21.5) | 39.5 (39.5 / 79.4 / 29.9) |
| S05 | 43.4 | 22.4 (22.4 / 22.8 / 22.1) | 34.0 (34.0 / 36.1 / 25.9) |
| S06 | 26.6 | 37.0 (37.0 / 36.7 / 38.2) | 46.9 (45.5 / 46.9 / 49.8) |

S01 and S05 medians are well inside 33.3 ms; their p95 is not stable (25.9 to 79.4 between identical pages).

## S06 profile (one switch per page, 2 pages each; delta of the p50 median against the base page)

| Switch | p50 | Delta |
| --- | --- | --- |
| base (plain three lights, lamp map 1024) | 36.1 | |
| accidental A/A repeat of the base | 34.25 | -1.85 (noise floor) |
| no local lights at all | 27.5 | **-8.6** |
| no Crown Lamp | 31.65 | -4.45 |
| no flood | 34.2 | -1.9 |
| no door glow | 34.0 | -2.1 |
| lamp casts no shadow | 36.3 | +0.2 (pages 40.0 / 32.6: not usable) |
| `cascades=0` (no earthshine CSM) | 31.65 | -4.45 |
| `bloom=off` | 33.1 | -3.0 |
| `skyoff=stars` | 34.9 | -1.2 |

**Dominant cost: the three local lights, 8.6 ms of 36.1.** three r187 has no light culling: every lit fragment pays every
light.

## Step 1: far-shadow comb

- **Cause.** A shadow map is a point-sampled, binary image of the caster: an edge at a shallow angle to the texel grid is a
  staircase, and a PCF kernel only removes the staircase periods its frequency response cancels. The canopy edges are 20
  degrees off the light's texel grid (a 2.75-texel staircase): the 4-texel tent of `pcf3` leaves 14 to 22 % of it, the
  6-texel kernel of `pcf5` under 4 % (unit test in `lighting/shadow-filter.test.ts`). On a far cascade one texel is wide
  across the view and short along it (Low cascade 1: 18.4 cm, about 10 x 2 px at 17 m), so the residue shows as horizontal
  teeth on every shadow edge that runs away from the camera.
- **Fix.** `defaultFarShadowFilter` (`lighting/sun-rig.ts`): SMAA / FXAA presets run `pcf5` (9 comparisons) on the cascades
  beyond cascade 0; cascade 0 keeps `pcf3`; TRAA presets unchanged. Knobs unchanged (`?shadowfilter=pcf3` = round 2).
- **Look** (S05 `slope`, sun 60, scale 1, 0 console errors): `comb-final-low-before-crop.png` (teeth on both diagonal edges)
  against `comb-final-low-after-crop.png` (smooth); same pair for Medium. Whole frame, after against before: mean 0.04
  codes, 0.18 % of pixels over 8 codes (Low). The far penumbra is wider: about 2.9 texels 10-90 % (53 cm on Low cascade 1,
  28 cm on Medium cascade 1) against 2.2. Not captured: the hab's dawn shadow edge in S01 that the visual check also named.
- **Frame cost** (`typical` scene, `play` view, 3 pages per variant; `control` runs the same shader as `pcf3`):

  | Preset | pcf3 on every cascade, p50 (pages) | pcf5 on far cascades | control | pcf5 - pcf3 | control - pcf3 |
  | --- | --- | --- | --- | --- | --- |
  | Low 0.75 | 19.7 (19.7 / 19.9 / 18.7) | 19.9 (19.2 / 19.9 / 20.1) | 19.0 | **+0.2 ms** | -0.7 ms |
  | Medium 0.85 | 27.3 (27.8 / 27.1 / 27.3) | 27.8 (27.8 / 26.0 / 27.9) | 26.9 | **+0.5 ms** | -0.4 ms |

  Both inside the +0.6 ms bar, and both inside the A/A scatter of this machine, so "+0.5" is an upper reading, not a
  resolved cost.

## Step 2: S06, then S05 and S01

**Changes** (all under `apps/client/src/visuals`):

1. **Range-culled local lights** (`lighting/local-lights.ts`, new): `LocalSpotLight` / `LocalPointLight` are three's lights
   with light nodes that run shadow lookup + BRDF inside `If(unshadowed radiance > 0)`, i.e. only for fragments inside the
   light's range and cone. Registered through r187's `Light.registerNode()`; nothing changes on the renderer. S06's lamp,
   flood and door glow use them. **Image identical to three's own nodes: 0.000 codes mean, 0 max** (`s06-lights-low-*`).
2. **Ground cap 160 x 256** (82 k triangles, what `typical` runs) instead of 200 x 320 (128 k) in S01 / S05 / S06
   (`lookdev/scene-base.ts` `capResolution`; `&cap=dense` = old). The cap is drawn once per shadow pass as well.
3. S06 lamp shadow map takes the preset's size (Low 512; it was 1024 on every preset), the lamp's shadow pass leaves the
   ground out (`LAMP_CASTER_LAYER`) and uses the preset's kernel. **These three measured nothing:** 512 against 1024
   -0.8 ms inside noise, layer + kernel 29.2 against 29.2 ms. Kept because the preset table asks for the size and the terrain
   never lands in a lamp's back-face shadow map anyway; say so if you would rather not carry the layer convention.

**S06 after culling, what is left** (3 pages each, `s06-profile2.log`; before the cap change):

| Switch | p50 / p95 | Delta p50 |
| --- | --- | --- |
| range-culled lights (base) | 31.3 / 33.4 | |
| lamp casts no shadow | 30.3 / 33.1 | -1.0 |
| no Crown Lamp | 28.9 / 31.9 | -2.4 |
| no flood, no glow | 28.9 / 32.1 | -2.4 |
| no local lights | 26.6 / 28.8 | -4.7 |

So culling took the lights from 8.6 to 4.7 ms; the rest is real shading inside their pools (in the `pool` view each light
covers a large part of the frame). Measured alone, culling was -1.6 ms p50 (`s06-cull.log`: 33.2 -> 31.6).

## Before / after per scene (Low, webgpu, scale 0.75, same method, 3 pages each in rotated order)

"Before" = this round's switches set back in the same build (`lights=plain&lampres=1024&lampshadow=plain&cap=dense&shadowfilter=pcf3`
for S06, `cap=dense&shadowfilter=pcf3` for S01 / S05), so both sides ran minutes apart on the same machine state.

| Scene | Before: fps, frame p50 / p95 (p95 of the pages) | After: fps, frame p50 / p95 (p95 of the pages) | Budget 33.3 ms p95 |
| --- | --- | --- | --- |
| S06 `pool` | 29.8 fps, 33.7 / 36.2 (36.4 / 35.4 / 36.2) | **34.3 fps, 29.2 / 31.6** (31.6 / 31.7 / 31.2) | was over, **now inside by 1.7 ms** |
| S01 `a` | 50.0 fps, 20.0 / 21.7 (22.9 / 21.7 / 21.4) | **51.8 fps, 19.3 / 21.4** (21.8 / 21.0 / 21.4) | inside both times |
| S05 `wide` | 49.7 fps, 20.1 / 21.8 (22.1 / 21.8 / 21.8) | **50.9 fps, 19.5 / 21.4** (21.0 / 21.9 / 21.4) | inside both times |

- **S06: 21.9 fps in round 2 -> 34.3 fps.** Of that, FXAA on Low (not mine) took 42.0 -> about 37 ms p50, this round
  33.7 -> 29.2 in the paired run. Margin is thin (1.7 ms p95) and it is the `pool` view only; `wide` was not measured.
- **S05 and S01 were not over budget once measured on a quiet machine.** Round 2's p95 of 47.2 and 35.4 ms were single
  SMAA-era pages. This afternoon's first baseline, with other workers active, gave p95 25.9 to 79.4 ms between identical
  pages at an unchanged p50 (`baseline-low.log`); the paired run above gave 21 to 23 ms on all 12 pages. The tail is
  machine load, not these scenes: **I found no scene cost to fix for the p95**; the cap change is worth 0.6 to 0.7 ms p50.
- **Device script** (it pins the Low ceiling 0.75 now): S01 webgpu Low **45.9 fps, frame p95 32.0 ms, PASS** with a 1.3 ms
  margin, 188 draws, 0.39 M triangles (`r3/device/1e7deac4b61d.md`). No same-day "before" through the script (round 2's
  20.7 fps was at scale 1.0). Its p95 is 10 ms above my free-running pages (4 s warm-up); not investigated.

## Look checks this round

- Lamp shadow still cast after the caster-layer change: switching it off changes 0.068 % of the frame by more than 8 codes;
  the new lamp path against the old one 0.013 % (`r3/r3-look-s06-lampshadow-low.json`).
- S06 before / after whole frame: mean 0.05 codes, 0.037 % of pixels over 8 codes (`s06-lamp-low-{before,after}.png`,
  both viewed: same lamp pool, flood and shadows).
- WebGL2 against WebGPU, Low, final code, 0 console errors: S06 mean 0.005 codes (0.005 % of pixels over 8), S05 mean 0.001
  (`r3/r3-look-{s06,s05}-backend-low.json`). Backend confirmed in-page.

## Checks (final file state, last source edit 16:05)

`tsc -p apps/client --noEmit` clean; `vitest run src/visuals src/render` 23 files / 250 tests pass (new:
`lighting/local-lights.test.ts`, staircase tests in `lighting/shadow-filter.test.ts`); `eslint src/visuals` clean;
`prettier --check src/visuals` clean. `pnpm verify` not run. Every server and browser I started is stopped.

## Not done, with the next step

1. **S06 `wide` view, Medium, webgl2 frame times:** not measured. Next: `r3-perf.mjs --base "scene=s06&view=wide&preset=low&backend=webgpu&scale=ceil" --variants "after=" --rounds 3`, then `backend=webgl2`.
2. **S06 headroom.** 4.7 ms of local-light shading and 4.5 ms of earthshine cascades remain. The planned answer is
   clustered lighting (rendering-pipeline 5.4, owner rendering-engineer); nothing cheaper was found. The game's own lamps
   should be created as `LocalSpotLight` / `LocalPointLight` until then.
3. **p95 / p99 tails under load** (perf verdict point 4): not explained here beyond "they move with machine load". Next: the
   production-build capture R4 of the verdict on an otherwise idle machine. The rAF hitch counter I added to `r3-perf.mjs`
   (`raf` field) is NOT usable: it reads rAF timestamps, which disagree with the app's own frame intervals on S01 / S05
   (11 % of intervals over 33 ms against an app p99 of 26 ms). Ignore that field or switch it to `performance.now()`.
4. **Far-cascade look on High / Ultra** and the S01 dawn hab-shadow stair step: not captured.
5. **Stale docs outside my paths:** `look-knobs.ts` and `perf-pass.test.ts` describe the default kernel as `pcf3` /
   "4-tap tent" on every cascade (far cascades are `pcf5` now); rendering-pipeline 5.2 Filtering row (far kernel width is
   2.9 texels). `look-knobs.ts` is in `visuals/**`, which I own this round, but I left it: comment-only, say if you want it.

## Files (round 3)

New: `visuals/lighting/local-lights.ts`, `visuals/lighting/local-lights.test.ts`,
`docs/visual-reviews/M0/checks/driver/{r3-perf,r3-look}.mjs`, `docs/visual-reviews/M0/checks/r3/**`.
Edited: `visuals/lighting/{sun-rig,sun-rig.test,shadow-filter.test}.ts`, `visuals/lookdev/{scene-base,s01-approach,s05-shadow-lab,s06-night}.ts`,
`visuals/module.ts` (passes the quality settings to look scenes, forwards preset changes). Nothing under `render/**`, `app/**`, `debug/**`.
New URL switches (A/B only): `&lights=plain`, `&lampshadow=plain`, `&lampres=<px>`, `&off=lampshadow,lamp,flood,glow` (S06), `&cap=dense` (S01 / S05 / S06).

Commit suggestion: `perf(client): range-culled local lights, pcf5 on far shadow cascades, lighter look-scene ground cap (M0 look-polish round 3)`

---

# Round 4: far shadows at a grazing sun on Low (VT-M0-04b)

**Outcome: rock-sized shadows are fixed on Low (6.5 -> 20.4 m of 21.8 m); the 10 cm post is not (6.6 m, unchanged) and
cannot be inside the Low preset. A measured way out exists and needs an owner decision (Next, item 1).**

2026-11-13 night / technical-artist, Fable 5.2. Writer of `apps/client/src/visuals/**` (nothing under `ui/**`, `render/**`).
Evidence: `docs/visual-reviews/M0/checks/r4/` (driver `vt04b.mjs` with two new run-time switches, `r3-perf.mjs`, `r3-look.mjs`).

## Diagnosis (measured, Low webgpu, S05, az 250, `r4/tip/`)

Three separate causes, each isolated with a run-time switch on one build:

| Variant | Rock 0.38 m at 1 deg (expected 21.8 m) | Rock at 4 deg (5.44 m) | 1 m post at 4 / 1 deg (14.4 / 57 m) |
| --- | --- | --- | --- |
| round-3 code (square kernel, normal offset on every receiver) | **6.54 m** | 5.30 m | 6.62 / 6.64 m |
| kernel shrinks on grazed receivers, offset kept | 10.3 m | 5.38 m | 6.62 / 6.64 m |
| kernel shrinks, no normal offset on the ground | **21.8 m** (22.7 with the kernel shrinking on both axes) | 5.76 m | 6.62 / 6.64 m |

1. **Kernel footprint on a grazed receiver.** The PCF kernel is square in shadow-map texels. At a 1 degree sun one texel of
   the map's vertical axis is 10.5 m of ground along the light (Low cascade 1, 18.4 cm), so a kernel 6 texels tall averages
   over tens of metres; the rock is 2 texels tall in the map and never gets darker than 58 % there. Cascade 0 (2.3 cm) hides
   it, hence the hard line at the split.
2. **Normal offset on the ground.** The 1.1-texel offset lifts the lookup 20 cm in Low cascade 1; at 1 degree that reads the
   shadow 11.6 m further down-light: (0.38 - 0.20) / tan 1 = 10.3 m, exactly the measured end.
3. **The 10 cm post is narrower than a Low cascade-1 texel** (0.13 m across the light, 0.7 texel): it is not rasterised into
   that map at all in this pose, so no filter or bias brings it back (`tip-post-sun1-both-nb0-low-webgpu.png`: the legs and
   brush of the custodian, wider, now run dark to the horizon next to it). A resolution limit of the preset (Low: 2
   cascades, 1024, 80 m), like Medium's 10.9 of 14.4 m in round 1.

Removing the offset everywhere is not an option: the post's falsely darkened lit pixels go from 3 % to 8-11 %.

## Fix

- `lighting/shadow-filter.ts`: tap offsets of `pcf3` / `pcf5` scale by clamp(3 x N.L, 0, 1) on the key light's cascades
  (full kernel from 19.5 degrees up, so the comb fix at a high sun is untouched; one bilinear comparison at a grazing sun).
- `lighting/cascade-shadow-node.ts` (new): the normal offset is applied per receiver; materials flagged as terrain
  (`userData.mcShadowFlatReceiver`, set by the regolith material and the stand-in) take none.
- `?shadowkernel=square` restores the round-3 rule for A/B.
- Kernel shrink on both map axes, not only the vertical one: with the vertical axis alone the legs and brush of the
  custodian (under one Low cascade-1 texel wide) still turned into faint wide smears at the split
  (`r4/tip/tip-post-sun1-vonly-nb0-low-webgpu.png` against `...-both-nb0-...`).

## VT-M0-04b re-measured on the final rule (`r4/vt04b/vt04b-r4-*.json`, S05, az 250, flat ground, 0 console errors)

Shadow length = last point on the scan where the darkening is at least half of the shadow's full darkening.

| Cell | Rock 0.38 m, 4 deg (5.44 m) | Rock, 1 deg (21.8 m) | 1 m post, 4 deg (14.35 m) | 1 m post, 1 deg (57.3 m, scan to 40 m) |
| --- | --- | --- | --- | --- |
| Low webgpu, round 3 (`shadowkernel=square`, same build) | 5.30 m | **6.54 m** | 6.62 m | 6.64 m |
| **Low webgpu, round 4** | 5.38 m | **20.36 m** | 6.62 m | 6.64 m |
| **Low webgl2, round 4** | 5.38 m | **20.36 m** | 6.62 m | 6.64 m |
| Medium webgpu, round 3 (r2b / final re-run) | 5.30 m | 21.76 m | 10.84 m | 20.2 m |
| **Medium webgpu, round 4** | 5.38 m | 22.72 m | **12.38 m** | **21.98 m** |

| Cell, round 4 | Contact gap post / rock / boot, worst of 60 / 15 / 4 / 1 deg | Open-ground acne, 20 windows | Lit pixels of the post falsely darkened, 4 / 1 deg |
| --- | --- | --- | --- |
| Low webgpu | 0.3 cm (rock at 1 deg, 0.9 px) | 0 px over 4 codes, max 0 | 1.7 % / 3.3 % (round 3: 3.1 % / 5.1 %) |
| Low webgl2 | 0.3 cm | 0 px, max 0 | 1.7 % / 3.7 % |
| Medium webgpu | 0.3 cm (boot at 1 deg) | 0 px, max 0.9 code | 0.4 % / 3.2 % |

- **Rock on Low: 6.5 m -> 20.4 m of 21.8 m (93 %)**, identical on webgl2. The faint streak is now a dark shadow to its end.
- **The post on Low is NOT fixed: 6.6 m of 14.4 / 57 m, unchanged.** Cause 3 above: the post is narrower than a Low
  cascade-1 texel and is not in that map. Nothing in `visuals/lighting` can change that inside the Low preset (2 cascades
  x 1024, 80 m, canonical table of rendering-pipeline 14). On Medium (9.7 cm) it improved to 12.4 m and 22.0 m.
- **Still visible on Low at 1 degree** (`r4/vt04b/tip-boulder-sun1-r4-low-webgpu.png`): at the split the rock's shadow
  narrows abruptly from the rock's width to a thin dark band. The rock is 2 texel rows tall in cascade 1, so only its upper,
  narrower part is resolved there. Not a darkness seam any more, but a width seam: say if it has to go (see Next).
- **New artefact at 4 degrees on Low** (`r4/vt04b/tip-post-sun4-r4-low-webgpu.png`, top right): the far edge of the canopy
  shadow, which runs across the light, shows streaky teeth along the light (one texel row of the map = 2.6 m of ground at
  4 degrees). The square kernel hid them by blurring 16 m along the light, which is what erased small shadows. The factor
  K = 3 trades the two; it is one constant (`RECEIVER_KERNEL_K`, run-time uniform for A/B).
- Looked at: `r4/s01-dawn-low-round{3,4}.png`: the mast's shadow is now attached at the mast foot and stays crisp; nothing
  broken. Whole-frame change at S01 dawn on Low: 2.4 % of pixels over 8 codes (the shadows themselves).
- Comb fix kept: S05 `slope` sun 60, round 4 against round 3: 0.001 % of pixels over 8 codes on Low and on Medium;
  `r4/comb-{low,medium}-round4-crop.png` viewed (Low), smooth edges. S06 pool: 0.003 % of pixels over 8 codes.
- 20 degree ramp on Low webgpu, final rule (`vt04b-r4slope-low-webgpu.json`): contact gap 0.0 cm for post, rock and boot at
  all four suns; ramp-face acne 0 px over 4 codes at 60 and 15 degrees, 3 px (max 9 codes) at 4 and 2 px at 1 degree
  (0.002 % of the window, isolated, as in the final re-run).

## Frame cost (same method as round 3: `r3-perf.mjs`, Low / Medium at the preset ceiling, 3 pages per variant, rotated)

"round 3" = `shadowkernel=square` in the same build.

| Scene, preset | round 3: p50 / p95 | round 4: p50 / p95 | Delta p50 |
| --- | --- | --- | --- |
| typical, Low 0.75 | 20.1 / 21.9 | 20.3 / 22.0 | **+0.2 ms** |
| typical, Medium 0.85 | 27.4 / 31.1 | 27.4 / 32.0 | **0.0 ms** |
| S06 pool, Low 0.75 | 30.2 / 33.7 (33.0 fps) | 30.2 / 33.8 (32.7 fps) | **0.0 ms** |

- Inside the +0.6 ms bar. **S06 is unchanged by this round, but tonight both variants read 30.2 / 33.7 ms** against
  29.2 / 31.6 this afternoon: p95 is 0.4 to 0.5 ms OVER the 33.3 bar in tonight's session (pages 33.3 to 33.8, one noisy
  page at 41 to 47). Same build A/B, so it is the machine's state, not this change; the round-3 margin of 1.7 ms does not
  hold on every run.

## Checks (final file state)

`tsc -p apps/client --noEmit` clean; `vitest run src/visuals src/render` 24 files / 257 tests pass (new:
`lighting/cascade-shadow-node.test.ts`, knob test in `look-knobs.test.ts`); `eslint src/visuals` clean;
`prettier --check src/visuals` clean. `pnpm verify` not run. Every server and browser I started is stopped.

## Next (exact)

1. **Post on Low: owner decision on the Low shadow-map size.** Measured with the existing knob `&shadowres=2048` (both Low
   cascades at 2048, texels 1.15 / 9.2 cm): post **13.08 m of 14.35** at 4 degrees and 21.5 m at 1 degree (scan to 40 m),
   rock 22.7 m; frame p50 on `typical` **+0.4 ms** over round 4 (20.3 -> 20.7, 3 pages), about +24 MB of depth maps (+12 MB
   if only cascade 1 grows). It changes `shadows.cascadeSizePx` of the Low preset (rendering-pipeline 14,
   `packages/shared`), which is not mine to change. It would also soften the width seam of the rock at 1 degree.
2. Width seam of small rocks at the split at 1 degree, and the streaky far canopy edge at 4 degrees on Low: both are the
   18.4 cm row of Low cascade 1. Besides item 1, the structural fix is to fit each cascade's vertical extent to the terrain
   band instead of the whole view-frustum slice (about 4 to 6 times more rows at 4 degrees and below); not attempted:
   it moves the cascade bounds every frame inside three's CSM and needs its own stability check (shadow tip under a
   moving sun, camera rotation).
3. NOT RUN this round: High / Ultra (kernel unchanged there, but the per-receiver normal offset applies on every preset);
   VT-M0-15 and the sweep (0.1 degree steps) on the final rule; S06 `wide`; webgl2 frame cost.
4. Stale text outside this round's edits: rendering-pipeline 5.2 "Grazing sun" row (normal offset is now per receiver,
   none on terrain) and "Filtering" row.

## Files (round 4)

New: `visuals/lighting/cascade-shadow-node.ts`, `visuals/lighting/cascade-shadow-node.test.ts`,
`docs/visual-reviews/M0/checks/r4/**`.
Edited: `visuals/lighting/{shadow-filter,sun-rig}.ts`, `visuals/materials/regolith-material.ts`,
`visuals/lookdev/ground-material.ts` (terrain flag), `visuals/look-knobs.ts` + test (`shadowkernel=square`),
`checks/driver/vt04b.mjs` (`--kernelk`; `--nbias` now adds three's own offset on top).
Game code that adds terrain materials must set `userData.mcShadowFlatReceiver = true` (the regolith material does).

Commit suggestion: `fix(client): far sun shadows keep their darkness at a grazing sun (receiver-aware PCF size, no normal offset on terrain) (M0 look-polish round 4)`

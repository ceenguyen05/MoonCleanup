# M0 /visual-check: final VT-M0 matrix

Task M0-visual-check-final / status: **in-review (final re-run appended at the end)** / 2026-11-13 / visual-qa-reviewer, Opus 5.5. Machine: one Intel UHD 620 laptop
(floor device; **no Tier A/B hardware, so every Tier A/B cell is BLOCKED**). Code state: client source last edited 11:39 (small hooks:
FXAA on Low, 11:36). Final shadow filter (`pcf3` on all Low/Medium cascades) is in `sun-rig.ts` at 11:19:57.

## Fresh captures (this review)

r2b `scenes/*-medium-webgpu.png` (11:02 to 11:06) predate the final filter, so they were re-captured.
Driver `checks/driver/r2b-ground.mjs --part scenes` (unchanged), own capture Vite (watch/HMR off) on port 5197, headed Chrome,
1920x1080 DPR 1, `scale=1`, `capture=1`, 30 settle frames. Out: `docs/visual-reviews/M0/checks/final/` (27 PNG + 3 json + `crops/`).
Cells: Medium webgpu, Low webgpu, Low webgl2 (the Tier C pass). Views: S01 a-noon, a-dawn, b-noon, wide-morning, close-noon;
S05 wide-sun15, slope-sun60; S06 pool, wide. **0 console errors in all 27.** Verified in-page (`__mcLook.info`, `__mcInfo`):

| Cell | backend / tier label | post chain | cascades (end, texel c0) | filter |
| --- | --- | --- | --- | --- |
| Low webgpu | webgpu / B | scene, grade, bloom, **fxaa** | 2 (10 m / 80 m, 2.3 cm) | pcf3 |
| Medium webgpu | webgpu / B | scene, grade, bloom, smaa | 3 (10 / 42.2 / 120 m, 2.3 cm) | pcf3 |
| Low webgl2 | **webgl2 / C** | scene, grade, bloom, fxaa | 2 (10 / 80 m) | pcf3 |

PNG dimensions 1920x1080. Whole-frame luma diff: Low vs Medium mean 0.11 to 0.77 codes (0.4 to 2.4 % of pixels over 8 codes; largest
at S01 dawn). **Low webgl2 vs Low webgpu: 0.00 to 0.01 codes mean, at most 0.01 % of pixels over 8 codes, on all 9 views.**
Viewed at native resolution: all 9 Medium webgpu frames, 7 of 9 Low webgpu frames, and webgl2 `s01-a-dawn`. The other webgl2 frames,
plus Low `s01-b-noon` and `s05`, are numerically identical to a viewed frame (diff above), not viewed individually. Crops (nearest,
x3/x4): `final/crops/*-{medium-webgpu,low-webgpu,low-webgl2}.png`. All servers and browsers I started are stopped.

## VT-M0 matrix (UHD 620; RF/REFERENCE_TARGET mapping in the last column)

| VT | Verdict | Evidence | Notes / RF mapping |
| --- | --- | --- | --- |
| 01 Sky black | **FAIL as written, waived as a diagnostic** | `final/s01-a-noon-*.png`: sky 16 px block medians 7.0 / 15.3 / 43.3 (min / p50 / max, star-rejecting), the same on all 3 cells | REFERENCE_TARGET makes 01 diagnostic. Reads as deep navy space: no fog or nebula, stars visible. Not blocking (RF-01) |
| 02 One sun, one shadow | **PASS** (Low and Medium webgpu, Low webgl2) | `final/s05-wide-sun15-*.png`, `s05-slope-sun60-*.png`: wall, canopies, custodian, rock and ramp all cast one shadow, all in the same direction | Tier A/B BLOCKED |
| 03 Cascades match preset | **PASS Medium** / Low: count, split and far PASS; map size + debug view NOT RUN | Live CSM above vs rendering-pipeline §14 (Low 2 cascades / 80 m / 10 m split; Medium 3 / 120 / 10); Medium map 1024 + `?debug=cascades` in `checks/look/debug-cascades-*`. No seam on lit flat ground in the fresh S05 frames | Seam inside a shadow that crosses a split: NOT MEASURED |
| 04 Shadow edge (1 m post, 60 deg) | **PASS Medium webgpu** / Low NOT RUN (numbers) | `r2b/shadow/r2b-shadow-look-medium-webgpu.json` post:new edge 4.13 cm, flat run 0; at the VT's 3.2 mm/px footprint that is about 12.9 px, under the 15 px bar. `r2b/shadow/crop-post-new.png` viewed: one smooth ramp, no stair step. Cascade-0 kernel identical to final (pcf3 on c0 since 10:34) | Not the measure tool's 5-profile method. Low: cascade 0 is the same, `crops/s05-slope-sun60-boots-x4-low-webgpu.png` is smooth by eye, not measured |
| 04b Grazing sun | **PASS on Medium webgpu, flat ground** for contact / acne / attachment; **NOT RUN**: 20 deg slope on the final rule, continuous 0.1 deg/s sweep, Low, webgl2 (Tier C required), High | `r2b/vt04b/vt04b-r2b-medium-webgpu.json` (run 11:26 to 11:28, after the final filter): boulder 0.0 / 0.2 cm at 4 / 1 deg, post and boot at most 0.4 cm, open-ground acne 0 px over 4 codes | Post shadow 76 % of the geometric length at 4 deg (Medium cascade-1 resolution limit). Short, but attached |
| 05 HDR + AgX | **PASS Medium webgpu** (earlier measurement; post code unchanged since) | `M0-visual-checks` section 4 (disk core 255, ring neutral within 2.2 codes). Fresh `final/s01-a-dawn-*.png` viewed: white disk, no hue shift | 200 % banding crop not repeated; High / ACES NOT RUN. Look note: the dawn glow is a dull mauve-brown haze |
| 06 Albedo chart | **PASS Medium webgpu, final code** | `r2b/look/lookcheck-r2b-medium-webgpu.json` (11:25): 130.1 / 180.3 / 212.4 (bars 126 / 181 / 213, +-8) | Low and Tier C on final code NOT RUN |
| 07 Dust-mask spike edge | **NOT RUN on final code** (last measured PASS at T03b: 1.4 cm, berm pair 61.8) | `M0-W3-T03b-look-polish.md`. Fresh `final/crops/s01-a-noon-patchedge-x3-*.png`: crisp edge with a berm line | Re-run the lookcheck edge and berm-pair measurement |
| 08 Grime vs clean | **PASS Medium webgpu, final code** | Same json: grime 119.8, clean 181.9, ratio 1.52, difference 62.1 | In the scene (not the VT patch), S01 `a` noon probes: clean 184.9 / dust 144.2 (ratio 1.28). Clean paths still read clearly (`final/s01-a-noon-*`, `s01-wide-morning-*`): RF-01 OK |
| 09 WebGL2 parity | **PASS for S05 (+ S01, S06) at Low** / S02 on final code NOT RUN | Low webgl2 vs webgpu diffs above (0.01 codes mean); backend verified as webgl2 / Tier C; no black or missing materials (`final/*-low-webgl2.png`) | S02 webgl2 last checked at T04 (identical chart) |
| 10 HUD crispness | **NOT RUN** (V1: blocks the M0 gate until run) | Only T05 sandbox shots (no longer on disk); no real-renderer capture at DPR 1 / 1.5 / 2, zoom 150 % or scale 0.5; glass panel GPU cost not measured | Next: `?scene=hud-test&preset=low&scale=floor` at DPR 1, 1.5, 2 with 400 % crops |
| 11 Frame-time overlay | **BLOCKED** (Tier A High / Tier B Medium hardware) | Overlay captured: `integration/S01-perf-hud-*.png`, `checks/hud/hud-on-low-webgpu.png`. Floor information (r2b): S01 / S05 Low at the ceiling 35.0 / 34.3 fps, p95 35.4 / 47.2 ms; **S06 21.9 fps** | Solo-first risk: S06 on the floor device is below 30 fps |
| 12 Harness output | **NOT RUN** as the full §6.5 matrix | `integration/index.md`: 2 harness captures with sidecars and measure columns, VT/verdict columns empty. This review used the drivers, not the harness naming | Measure-tool self-tests not re-checked here |
| 13 Stars stable | **PASS for what was run** (1.5 s pan, Medium + High) / 10 s P3 NOT RUN | `M0-look-polish-r2.md`: 100 % of stars within 10 % (worst 9.0 % Medium, 6.0 % High), round, sigma 1.16 to 1.17 px | "Radius >= 1.2 px": sigma is 1.17, FWHM/2 about 1.38. Unit undecided |
| 14 Earth size | **FAIL as written, by design** (V3; diagnostic per REFERENCE_TARGET) | Shipped 4.27 deg; the size control is accurate (41.0 px at 2.4 deg, r2). Fresh S01 `a` frames: disk round near the corner | Not blocking |
| 15 Horizon-map spike | **PASS Medium webgpu, in screen pixels** (owner unit) / High NOT RUN | `r2b/vt15/vt15-medium-webgpu.json` (log 11:30, after the final filter): ratio 1.44 (t = 0.25), 0.30 (t = 0.75), bar 2; step at the cascade end 0.14 / 0.72 / 6.42 codes, bar 8; beyond 120 m 11.8 to 12.9 % shadowed with the horizon term, 0 % without | Metres 2.86 / 0.58 informational. Weak statistic (16 to 54 edges); t = 0.5 gives no number |
| 16 Fill | **PASS Medium webgpu, final code** | Lookcheck json: flat shadow 86.0 (81 to 97), slope-away shadow 87.2, wall-view wall 144 > flat shadow 86, b* shadow minus lit -2.51 / -2.48 (bar: not below -3) | b* margin only 0.5. Low / webgl2 NOT RUN |

**Gate reading:** V1 items still NOT RUN or BLOCKED on the floor device: 04b (slope, sweep, Tier C), 07 (final code), 10 (HUD),
11 (hardware), 12 (matrix), plus Low/Tier C for 06 and 16. So the E10 bar "every V1 item passes" is **not yet met**. Nothing measured
on the final code FAILS except the two by-design diagnostics (01, 14).

## Defects seen in the fresh frames (not VT failures)

1. **Far-cascade shadow comb on Low (V2).** The S05 canopy shadow has texel-period teeth along its diagonal edge and where it crosses the
   ramp: `final/crops/s05-slope-sun60-canopy-x3-low-webgpu.png`, also visible at 100 % in `final/s05-slope-sun60-low-webgpu.png`
   (x 690 to 1020, y 525 to 590). Medium is milder (`...-medium-webgpu.png`). Cause: Low cascade-1 texel is 18.4 cm. A stair step
   also shows at x3 on the hab's dawn shadow edge, on Low and Medium alike (`crops/s01-a-dawn-mast-x3-*`).
2. **Ivory wall clips to flat white with a bloom halo** at sun 15 deg (`final/s05-wide-sun15-*.png`, x 415 to 715, y 465 to 585): no shading.
3. **Glint grains show as white dots inside cast shadows** (`r2b/shadow/crop-post-new.png`; the dark left ground of
   `final/s01-a-dawn-medium-webgpu.png`). FXAA on Low hides most of them.
4. **Stretched texture on the S05 ramp's vertical side face** (vertical streaks, `final/s05-slope-sun60-*.png`, x 1250 to 1900, y 760 to 1000).
5. **S01 noon reads flat:** props cast almost no visible shadow under a high sun, the dust is a neutral grey with no lane stripes
   (M1 direction texture), and the bottom-left foreground lane is soft. Clean vs dust still reads clearly.
6. S01 dawn, up-sun: lit ground washes out to near white around x 1000 to 1600 (known; tone-map clip at the sun azimuth).

No regressions against r2b Medium: the fresh probe lumas equal r2b's (S01 clean 184.9 / dust 144.2, S06 pool 144.7).

## RF mapping

RF-01 (task, equipment scale, clean-path contrast, worksite mood) is **PARTIAL**. Our frames read as a bright, readable lunar worksite
with an obvious clean path, but no side-by-side with the official media was done: the reference is viewed only by Cee, in a browser.
RF-03 (motion) is **NOT RUN**: stills only. VT-M0-01/06/14/16 are read in reference style, as REFERENCE_TARGET requires.

## Next

1. Run VT-M0-10 (HUD at DPR 1 / 1.5 / 2, zoom 150 %, scale 0.5).
2. Run 04b on the 20 deg slope, the 10 s sweep, and Low webgl2.
3. Re-run lookcheck for 07, and for 06/16 at Low and on webgl2.
4. Run the harness matrix (12) and fill `index.md` verdicts.
5. Owner (lighting): far-cascade comb on Low, ivory clipping.
6. Tier A/B: run the device script on other hardware.

Files: `docs/agent-reports/M0-visual-check-final.md`, `docs/visual-reviews/M0/checks/final/**` (new evidence). No source edited.

## Final re-run (round-3 code) - status: DONE, gate NOT met

2026-11-13, 16:24 to 16:52, visual-qa-reviewer. Code: round 3 (last visuals source edit 16:05, last client edit 16:21, a test).
Exclusive GPU, UHD 620, headed Chrome 157, own capture Vite (watch/HMR off) on port 5197, same drivers as above
(`lib.mjs` stepped captures, `capture=1`). Logs: `checks/final-rerun/chain.log`, `harness.log`. **0 console errors on every
page.** Evidence under `docs/visual-reviews/M0/checks/final-rerun/` (`hud/`, `vt07/`, `scenes/`, `vt04b/`) and the harness
set `docs/visual-reviews/M0/final/` (14 PNG + 14 json + `index.md`). New drivers (mine): `checks/driver/hud10.mjs`,
`rerun-diff.mjs`, `chain-rerun.sh`, `chain-harness.sh`. All servers and browsers I started are stopped (the lead stopped
the Vite on 5197 after the last capture). Tier A/B: BLOCKED everywhere (no hardware).

### Verdicts

| VT | Verdict | Evidence (paths under `checks/final-rerun/` unless `final/`) |
| --- | --- | --- |
| 07 Dust-mask edge + berm | **PASS** Medium webgpu, Low webgpu, Low webgl2 (S02 noon) | `vt07/{medium,low}/s02-*.json`: edge 10-90 % **6 px = 1.36 cm** (bar <= 2 cm / 6 px, +1 px on SMAA) on all 3 cells; berm pair **61.6 / 61.6 / 60.7** (bar >= 12), lit crest 3 px wide (>= 2). Dawn: edge 2 px, pair 98.4. Viewed `vt07/low/s02-webgl2-noon.png`: crisp bright stroke, raised berm with lit lip and shaded side. Caveat: captured at the preset ceiling (0.85 / 0.75), not the floor of §6.1 |
| 06 / 08 on Low and Tier C (side result) | **PASS** | Same S02 frames: chart 130.1 / 180.3 / 212.4, grime 119.8, clean 181.9 (ratio 1.52, diff 62.1) on Low webgpu and Low webgl2, identical to Medium |
| 10 HUD crispness | **FAIL (V1) at DPR 1 and DPR 2**; PASS at DPR 1.5 (= 150 % zoom) | `hud/hud10.json`, crops `hud/crop-*-x4.png`, frames `hud/S12-hudtest-low-webgpu-*.png`. Canvas at scale 0.5 confirmed (`__mcInfo.renderScale` 0.5 at all 3 DPRs) with the DOM at full DPR. **Hairlines:** two of the three "1 device px" lines sit at y 352.5 / 366.5 device px and render as **2 grey rows (luma 96 vs 247 for the crisp one)** at DPR 1 (`crop-hairlines-dpr1-x4.png`); DPR 2 the same (2 rows of 174, `crop-hairlines-dpr2-x4.png`); the outline box below them is soft grey too. DPR 1.5: all three single white rows. **Panels not on whole device px at rest:** bench panel top 129.333 px, wallet 414.281 x 85.333 px (DPR 1); 7 panel rects off-pixel at DPR 1 and 2, 2 at DPR 1.5. No `transform` at rest (0). Text 14/16/18/22 px and SVG icons are crisp at all three DPRs (`crop-sample14-*`, `crop-icons-*`). **Glass cost** (4 panels, free-running, 4+4 alternating 6 s windows, DPR 1): blur p50 8.92 / mean 9.36 / p95 13.45 ms vs solid 8.82 / 8.98 / 11.18 ms: about +0.1 ms p50, +0.4 ms mean, inside noise; page probe 8.55 vs 8.56 ms. These are frame intervals: `backdrop-filter` is compositor work that the app's GPU timestamp queries cannot see. Zoom 150 % = DPR 1.5 at 1280x720 CSS (what Chrome zoom gives on a 1920x1080 window); the zoom UI action itself was not driven |
| 12 Harness output | **PARTIAL (FAIL as written)** | `final/` + `index.md`. PASS: §6.6 names (14 files), PNG size = CSS x DPR (2560x1600@2; 1920x1080@1.5 from 1280x720 CSS; checked in code and file), one sidecar per PNG, `index.md` generated, measure self-tests **15/15 pass** (`harness.log`). FAIL: (a) measure numbers are **whole-frame only** (rect 0,0,1920,1080: mean luma, Sobel, b*, an "edge 10-90" of 208-487 px that is meaningless, star count); no VT luma patches or edge profiles; (b) sidecars lack the §14 knobs, camera pose / vFOV, sun elevation / azimuth, EV100, adaptation, Earth phase; (c) **`tod` is not honoured by the client**: `S01-dawn-...` equals `S01-noon-...` in every metric; (d) the HUD page is named `hud-test-...`, not `S12-...`; (e) dev server, not `vite build`; commit = HEAD 60faef9 with a dirty tree. P4 (motion path): NOT RUN, the harness has no camera paths. Verdict column of `index.md` left N/A (generated file) |
| 04b slope 20 deg | **PASS** Medium webgpu and Low webgl2 | `vt04b/vt04b-slope-{medium-webgpu,low-webgl2}.json`: post, rock and boot on the ramp hinge, sun 60 / 15 / 4 / 1: contact gap **0.0 cm** everywhere (rock at 60 deg: its shadow is under the rock, no ground shadow on the scan, not a gap); ramp-face acne **0 px over 4 codes** at 60 and 15 deg, 1-2 isolated px (0.001 %) at 4 and 1 deg, not periodic |
| 04b sweep 0.1 deg x 10 | **PASS** Medium webgpu and Low webgl2 | `vt04b/vt04b-sweep-*.json`: post contact gap 0 cm in all 11 steps from 4.0 and from 1.0 deg on both cells. Stepped (0.1 deg per captured frame), not wall-clock 0.1 deg/s |
| 04b WebGL2 (Tier C), flat | **PASS for contact / acne / peter-panning; FAIL for far shadow length (next row)** | `vt04b/vt04b-flat-low-webgl2.json`: gaps <= 0.2 cm (rock at 1 deg, 0.6 px); open-ground acne 0 px over 4 codes in all 5 windows at all 4 suns |
| 04b shadow length at grazing sun, **Low** | **FAIL (new finding)** | Low webgpu = Low webgl2 (backend-independent). Darkening falls below half beyond the Low cascade-0 end: post shadow ends at **6.6 m** of 14.4 m (4 deg) and of 57 m (1 deg); rock at 1 deg **6.5 m** of 21.8 m. Medium (r2b): 10.8 m and 21.8 m. Viewed `vt04b/tip-boulder-sun1-tip-low-webgpu.png`: the rock shadow is a dark slab that **stops at a hard line** (y about 585), then continues as a faint grey streak; the thin post shadows vanish past the line. A/B `&shadowfilter=pcf3` (round-2 far kernel): rock 10.3 m, post unchanged 6.6 m, so round 3 `pcf5` makes it worse, but the cause is the Low cascade-1 texel (18.4 cm) at grazing sun. This also answers VT-03 "seam inside a shadow that crosses a split": **visible on Low at sun <= 4 deg**. Tool note: the `attachedRunEndM` field is unusable (0.12 for every post); judged on `lastShadowedM` plus the image |
| Comb on far cascades | **Gone, Low and Medium** | `scenes/crops/s05-canopy-x3-{low,medium}-webgpu-{before,after}.png` (before = `final/` of this morning): Low before shows horizontal teeth along both diagonal canopy edges, after is a smooth penumbra; Medium after smooth. Remaining: a small saw edge on the near berm shadow at S01 dawn, `scenes/crops/s01-dawn-shadowedge-x3-low-webgpu.png` (V3) |
| S06 pool vs pre-light-culling | **Unchanged** | `scenes/s06-pool-*.png` vs `final/s06-pool-*.png` (this morning, before culling): Low webgpu mean 0.051 codes, 0.037 % of px over 8, max 26; Medium 0.039 / 0.078 %; webgl2 = webgpu. Pool probe 144.6 vs 144.7. Viewed `scenes/s06-pool-low-webgpu.png`: lamp pool, earthshine shadows and custodian shadow intact |

Regression scan, all 27 scene frames vs this morning's `final/` (`rerun-diff.mjs`): mean 0.02 to 0.30 codes; largest S01 dawn
(1.2 % of px over 8 on Low: the far penumbra widened by `pcf5` and the lighter ground cap); viewed, nothing broken.
The harness's S05 Tier C floor frame (`final/S05-noon-tierC-low-webgl2-...png`) is soft at scale 0.5, as expected at the floor.

### Other defects seen (not VT rows)

1. HUD bench readout prints the DPR unformatted (`1.0000000298023224`, wraps) and "Canvas 1.00 x" reports the canvas
   backing, not the render scale (the scene renders at 0.5). Misleading for QA; ui-engineer.
2. The dev text overlay ("Clean The Moon! dev (local) / backend ... / server asleep") overlaps the Lumens panel caption at
   DPR 1 (`hud/S12-hudtest-low-webgpu-1920x1080@1-floor.png`, top left). Confirm it is absent in production builds.
3. Environment: the harness `--out /c/...` path from Git Bash with `MSYS_NO_PATHCONV=1` resolved to `C:\c\...`; I moved my
   output into `docs/visual-reviews/M0/final/` and removed only the folders I created. **`C:\c\` already existed with other
   agents' strays, including `C:\c\Users\caseyn\.claude-team\.credentials.json` and `tools/perf/results/M0/t08/**`
   copies.** Not touched; the lead / Cee should look at it.

### Gate reading after the re-run

V1 still open on the floor device: **10 (FAIL at DPR 1 and 2)**, **12 (PARTIAL)**, **04b on Low (far shadow length / split
seam at <= 4 deg)**, 11 (BLOCKED, hardware), 16 on Low / webgl2 (NOT RUN). Closed this run: 07, 04b slope / sweep / Tier C
contact and acne, 06 / 08 on Low and Tier C, comb, S06 unchanged. The E10 bar "every V1 item passes" is **not met**.

### Next steps (exact)

1. **VT-10 fix** (ui-engineer): round panel geometry and hairline offsets to whole device px at rest (bench top 129.333,
   wallet 414.281 x 85.333 at DPR 1). Re-run: start the capture Vite on 5197, then
   `MC_BASE=http://localhost:5197/ node docs/visual-reviews/M0/checks/driver/hud10.mjs --out docs/visual-reviews/M0/checks/final-rerun/hud2`;
   pass = `hairProfiles[].rowsOverHalfPeak` 1 for all lines and `panelsOffDevicePx` empty at DPR 1, 1.5 and 2.
2. **VT-04b Low far shadows** (rendering-engineer / lighting): cascade-1 shadow at grazing sun on Low (texel 18.4 cm,
   normal-offset bias at low elevation, `pcf5`). Re-run:
   `node vt04b.mjs --out <dir> --backend webgpu --preset low --az 250 --tag tip --suns 4,1 --targets none --acne none --tip 1 --views none`
   and compare `lastShadowedM` with the expected length, then view `tip-boulder-sun1-*.png`.
3. **VT-12** (qa-test-engineer): client honours `tod`; sidecar from `__mcLook.info()` + `__mcInfo()` (knobs, pose, sun,
   EV100); per-scene measure definitions (S02 chips + edge lines from `__mcLookdev.probes()`, S05 probes) in
   `tools/screenshots/src/scenes`; map `hud-test` to `S12`; run on `vite build` + `vite preview`; then
   `pnpm --filter @moon-cleanup/screenshots screenshots -- S01,S02,S03,S05,S06 --lane gpu --url <preview> --out docs/visual-reviews/M0/final --step 30 --tier B --preset medium --scale floor`
   (use a Windows path for `--out`).
4. VT-16 on Low and webgl2: `node lookcheck.mjs --out <dir> --preset low --backend webgl2` (and `--backend webgpu`).
5. VT-07 at the render-scale floor: `s02-run.mjs ... --extra "&scale=floor"`.
6. VT-11 and every Tier A/B cell: BLOCKED until Tier A/B hardware exists.

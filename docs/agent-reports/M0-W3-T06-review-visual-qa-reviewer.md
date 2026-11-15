# M0-W3-T06 review: /visual-check M0 (final close-out candidate)

Task M0-W3-T06 visual review / status: **APPROVED WITH CONDITIONS on the floor device** (updated after the VT-10 re-check, see
the last section). No measured V1 item fails now, except the Low 04b far-shadow length that the lead accepted. **The E10 bar "every V1 passes" is
still not fully met:** VT-11 is BLOCKED (hardware) and VT-12 is PARTIAL (harness gaps). Both are logged below / 2026-11-14 15:25-15:40,
VT-10 re-check about 16:00 / visual-qa-reviewer, Opus 5.5. No source edited, no git.

**Hardware:** one Intel UHD 620 laptop (below Tier B). Files carry the *requested* tier label (`tierB` for webgpu, `tierC` for
webgl2). **No Tier A claim; every Tier A/B verdict is BLOCKED.** Every PASS below means "passes on the floor device".

## Capture run

- Harness `tools/screenshots` (`src/capture.ts`, gpu lane, headed Chrome 157.0.8103.79, `--preview --port-offset 11` = `vite preview`
  on 127.0.0.1:5184). The production `apps/client/dist` was built at 11:22 today, after the close-out render hooks (11:13) and
  the 22:51 UI edits. Only audio files changed after that build. Not rebuilt, so another worker's in-progress audio edits stay out.
  Commit 5a7cec4 with a dirty tree (recorded in each sidecar). Stepped 30 frames (High 64), `scale=floor`, 1920x1080.
- Set: 16 PNG + 16 sidecars in `docs/visual-reviews/M0/final/`, plus a generated `index.md`. The old 13-Nov harness set (dawn == noon bug,
  no camera) moved to `docs/visual-reviews/M0/checks/final-r3-harness-20261113/`.
- Re-captured cells: S01 (noon Medium/Low/webgl2, dawn Medium), S05 noon, S06 night-near (Medium, Low, webgl2, **High: star
  layer**), `typical` noon (Medium/Low), S12 at DPR 1 / 1.5 (= 150 % zoom, 1280x720 CSS) / 2. **Reused unchanged:** S02/S03 evidence
  (`checks/final-rerun/vt07`, `r2b/look`) and the r2/r2b measurements cited per item.
- Extras in `docs/visual-reviews/M0/checks/final-t06/`: `hud/` (driver `hud10.mjs` on the same production build), `recap/`, `wrap/`,
  `extra.log`. `measure` was re-run over `final/`. **0 console errors. Port 5184 is closed, and no browser or server I started is still running.**
- Verified per sidecar: `serve.mode` production, tod verified (sun 60 / 4 / -24 deg), and camera pose + vFOV 60 are present (e.g. S01
  pos [-3, 2.03, -23]). Post chains: **Low = scene>grade>bloom>fxaa** (webgpu and webgl2), Medium = ...>smaa, High =
  scene>prepass>gtao>traa>**stars**>grade>bloom. Render scale floor: Low 0.5, Medium 0.6, High 0.75.

## VT-M0 verdicts (RF mapping per REFERENCE_TARGET)

| VT | Verdict | Evidence (`final/` unless noted) |
| --- | --- | --- |
| 01 Sky black | FAIL as written; diagnostic per REFERENCE_TARGET (not blocking) | `S01-noon-*`: deep navy sky with a gradient. Pixel-identical to 13 Nov (diff mean 0.00). Reads as space, with stars and no fog. RF-01 style |
| 02 One sun, one shadow | **PASS** Medium/Low webgpu, Low webgl2 | `S05-noon-tierB-medium-webgpu-...png`: canopies and custodian each cast one shadow, all the same way. Also `S06-*` (Earth key) |
| 03 Cascades | **PASS Medium**; Low count/split/far PASS; map size NOT RUN | Sidecar `knobs.csm`: Medium 3 cascades (10 / 42.2 / 120 m, c0 2.3 cm), Low 2 (10 / 80 m, c1 18.4 cm), matching rendering-pipeline §14. No seam on lit flat ground in S01/S05. Map size is not in the sidecar. Low split seam inside a shadow at sun <= 4 deg is a known, lead-accepted limit (STATUS) |
| 04 Shadow edge | **PASS Medium** (reused); Low NOT RUN (5-profile tool) | `checks/r2b/shadow/r2b-shadow-look-medium-webgpu.json`: 4.13 cm, about 12.9 px (bar 15) |
| 04b Grazing sun | **PARTIAL (lead-accepted)** | Medium, slope, sweep and webgl2 contact/acne PASS (`checks/final-rerun/vt04b/*`). Low far-shadow length FAIL (post 6.6 of 14.4 m), kept by lead decision in STATUS, which logs it |
| 05 HDR + AgX | **PASS** Medium (V2) | `S01-dawn-tierB-medium-webgpu-...png`: white sun disk, no hue shift, no banding seen in the glow at 100 %. 200 % crop not re-taken. Up-sun ground near clip (clean probe 231.8) |
| 06 Albedo chart | **PASS** (reused, all 3 cells) | `checks/final-rerun/vt07/{medium,low}/s02-*.json`: 130.1 / 180.3 / 212.4 |
| 07 Dust-mask edge | **PASS** (reused; ceiling scale, floor NOT RUN) | Same json: 6 px = 1.36 cm, berm pair 61.6 / 61.6 / 60.7 |
| 08 Grime vs clean | **PASS** (reused chart) | Chart 119.8 / 181.9, ratio 1.52. In-scene `S01-noon-*` probes: clean 185.0 / grime 144.0 on all 3 cells, `typical-*` clean 182.8. The clean path reads clearly (RF-01) |
| 09 WebGL2 parity | **PASS** S01/S05/S06 (S02 reused) | Low webgl2 vs Low webgpu: mean 0.00 to 0.01 codes, 0.009 to 0.025 % of px over 8. No black or missing materials (`*-tierC-low-webgl2-*`) |
| 10 HUD crispness | **PASS after the fix** (emulated DPR 1 / 1.5 / 2; see the re-check section). First run: FAIL on hairlines at DPR 1 and DPR 2, details kept here | `checks/final-t06/hud/hud10.json`. PASS: panels on whole device px (0 off) and 0 transforms at all 3 DPRs; text 14-22 px and SVG icons crisp (`S12-noon-*@1`, `@1.5`, `2560x1600@2`, crops `crop-sample14-*`, `crop-icons-*`); canvas 0.50 under a full-DPR DOM; readouts fixed ("1", "0.50 x"). **FAIL:** each horizontal 1 device-px hairline has a second grey row: DPR 1 rows 247 / **96**, DPR 2 rows 247 / **101** (DPR 1.5: 247 / 30, clean). Visible at x4 in `crop-hairlines-dpr1-x4.png`. The vertical lines and the outline box are crisp. Glass cost not re-run (13 Nov: +0.1 ms p50) |
| 11 Frame-time overlay | **BLOCKED** (no Tier A/B hardware) | Floor-device perf lives in M0-perf-verdict / STATUS |
| 12 Harness output | **PARTIAL** | PASS: §6.6 names, PNG = CSS x DPR (2560x1600@2, 1920x1080@1.5), one sidecar per PNG, generated `index.md`, production preview, tod verified, **camera pose / vFOV now present**, knobs, sun, EV100, Earth. Gaps (qa-test-engineer): sidecar `aa` is null (real AA is only in `postPasses`); shadow map size, `dustRingTexelCm`, `particlePool`, `adaptationMultiplier` are null; `typical` is not a spec scene id; S05 ROI probes do not land in shadow (`slopeShadow` 170 = lit), so VT-16 cannot come from the harness; whole-frame `Edge 10-90` is meaningless; P4 frames (`harness-gaps/`) exist but no verdict was given. Measure self-tests not re-run by me (qa: 33/33 today) |
| 13 Stars stable | **PASS for what was run** (V2) | High chain has the post-TRAA star layer (sidecar). Stars are round Gaussian dots in `S06-night-near-tierB-{high,medium,low}-*`. Stability numbers reused from `M0-look-polish-r2.md` (1.5 s pan, 100 % within 10 %). 10 s P3 NOT RUN |
| 14 Earth size | FAIL as written, by design (V3, diagnostic) | 4.27 deg shipped. Round disk (`S01-*`, `typical-*`) |
| 15 Horizon-map spike | **PASS Medium** in screen px (reused r2b 1.44 / 0.30, bar 2); High NOT RUN | `checks/r2b/vt15/vt15-medium-webgpu.json` |
| 16 Fill | **PASS Medium** (reused lookcheck: flat shadow 86.0, b* -2.5); Low/webgl2 NOT RUN | See 12: the harness probes miss the shadows |

**RF-01 PARTIAL:** bright, readable lunar worksite with clear clean lanes and readable custodian/tool silhouettes (`typical-*`, `S06-*`);
the side-by-side Part 2 is Cee's. **RF-03 NOT RUN** (stills only).

## Findings (blocking first)

1. **RESOLVED (re-check below).** VT-10 hairline second row at DPR 1 and 2 (V1) → ui-engineer. Horizontal hairlines render at 247 + 96/101 luma;
   likely a fractional y offset or a shadow under the 1 px border. Re-run: `MC_BASE=<preview> node docs/visual-reviews/M0/checks/driver/hud10.mjs`.
   Pass = the row after the peak is at background level (about 22-30), as at DPR 1.5.
2. **Intermittent wrapped frame** (seen once in 17 captures) → **rendering-engineer** (cause), **qa-test-engineer** (guard).
   The first capture of the run (`checks/final-t06/wrap/S01-noon-tierB-medium-webgpu-...png`) has rows 878-1079 repeating rows 0-201
   exactly (error 0.00). A recapture is clean (`recap/`, now in `final/`). Possibly a canvas or render-target resize race at
   startup that a player could also see for a frame. Add a wrap/band check to the harness.
3. Harness gaps listed under 12 (qa-test-engineer). Non-blocking for the art, blocking for "VT-12 PASS".
4. Non-blocking look notes: the dev overlay ("dev (local) / server asleep") shows in the **production** preview build
   (`S12-*`; ui-engineer: confirm it is hidden on the deployed build). Low at scale 0.5 shows stepped silhouettes on the hab dome
   and canopies (`S01-noon-tierB-low-*`, `S05-noon-tierB-low-*`), expected at the floor. S05 noon reads flat (high sun behind the camera).

Regressions vs 13 Nov (same names): none (S01/S05/S06 Medium and webgl2: mean 0.00 codes).

## Next

1. Done: finding 1 fixed and re-checked (below).
2. rendering-engineer + qa: finding 2; qa: the VT-12 gaps; the harness S05 shadow probes so 16 runs on Low/webgl2.
3. Tier A/B and VT-11: device script on other hardware (BLOCKED).

Files: `docs/visual-reviews/M0/final/**`, `docs/visual-reviews/M0/checks/final-t06/**`, moved `checks/final-r3-harness-20261113/`.
Stray note: hud10's `--out /c/...` under `MSYS_NO_PATHCONV=1` wrote to `C:\c\...`. I moved my output back and removed only
the empty folders I had created. `C:\c\Users\caseyn\Downloads` was already there and was left alone.

## VT-M0-10 re-check after the hairline fix (2026-11-14, about 16:00)

- Fix: `M0-closeout-vt10.md` (`.hairH` / `.divider` paint a gradient hard stop). The current client source was built with `vite build` into
  my scratch folder. I did not overwrite `apps/client/dist`, so other workers' in-progress sim-host/audio edits are not pushed into the shared
  dist. It was served by `vite preview --outDir <scratch>` on 127.0.0.1:5184 (offset 11). `hud10.mjs` was run at DPR 1 (1920x1080 CSS), 1.5 (1280x720 = 150 % zoom)
  and 2 (1280x800). The 3 harness S12 frames in `final/` were re-captured on the same server, and `index.md` was regenerated (the measure
  runs inside the capture) with the verdict table re-appended. The server was killed afterwards, port 5184 is closed, and the harness and driver closed their browsers.
- Result (`docs/visual-reviews/M0/checks/final-t06/hud-vt10/hud10.json`): device-row luma across each hairline is
  **247 then background** at every DPR (DPR 1: 22 / 22 / 23; DPR 1.5: 30; DPR 2: 29 / 30 / 30). Before: 247 / 96 and 247 / 101.
  Panels off device px 0, transforms at rest 0, readouts "1" / "1.5" / "2" and "0.50 x", 0 console errors.
  Viewed `crop-hairlines-dpr1-x4.png` and `crop-hairlines-dpr2-x4.png`: single crisp white rows; the vertical lines and the outline box stay crisp.
- **VT-M0-10: PASS** on emulated DPR 1 / 1.5 / 2 (floor device). **NOT RUN:** real DPR 2 / 3 hardware, DPR 3, zoom 200 %,
  glass cost re-measure (13-Nov value +0.1 ms p50 stands).

### Overall M0 visual result (updated)

**APPROVED WITH CONDITIONS on the floor device.**
- **PASS:** 02, 05, 06, 07, 08, 09, 10; 03 / 04 / 15 / 16 on Medium.
- **PARTIAL:** 04b (Low gap accepted by the lead), 12 (harness gaps, qa-test-engineer), 13 (V2, 10 s pan not run).
- **FAIL by design (diagnostic):** 01 and 14.
- **BLOCKED:** VT-11 and every Tier A/B cell.
- **Still open:** the intermittent wrapped-frame capture (rendering-engineer / qa-test-engineer); Low / webgl2 numbers for 04 and 16.

# M0 VT-M0-10 (HUD crispness) re-check

visual-qa-reviewer, 2026-11-14. Verdict: **VT-M0-10 crispness bar: PASS at DPR 1, 1.5 and 2** (Tier B Low webgpu, UHD 620,
`?scene=hud-test&preset=low&scale=floor`, canvas at scale 0.50 with DOM at full DPR). Two non-blocking findings below.
Code: current tree (commit base 5a7cec4, dirty). Own capture Vite (watch/HMR off) on port 5180 (offset 7); stopped after capture.
Not covered: glass-cost number (unchanged from the earlier run, +0.1 ms p50) and the browser-zoom UI action (DPR 1.5 at 1280x720 CSS stands in for 150 %).

## Evidence

Real-DOM driver (`docs/visual-reviews/M0/checks/driver/hud10.mjs`), output `docs/visual-reviews/M0/checks/vt10-recheck/` (3 full frames, 27 crops x4, `hud10.json`). 0 console errors at all 3 DPRs.

| Metric (hud10.json) | DPR 1 | DPR 1.5 | DPR 2 | Bar / previous FAIL |
|---|---|---|---|---|
| `panelsOffDevicePx` (panel rects off whole device px) | **0** | **0** | **0** | was 7 / 2 / 7 |
| transforms at rest | 0 | 0 | 0 | 0 |
| hairline `rowsOverHalfPeak`, 3 lines | **1, 1, 1** | 1, 1, 1 | **1, 1, 1** | must be 1 (was 2 rows, luma 96, at DPR 1 and 2) |
| hairline peak vs neighbour row | 246.8 vs 22 to 23 | 246.8 vs 30.2 | 246.8 vs 29 to 30 | single crisp row |
| readout | "1", "1 device px", "0.50 x" | "1.5", ... | "2", ... | DPR now formatted (was 1.0000000298) |

PNGs viewed at native size (Read): `docs/visual-reviews/M0/checks/vt10-recheck/crop-hairlines-dpr1-x4.png`, `-dpr1.5-x4.png`, `-dpr2-x4.png` (all three lines are single white 1 device-px rows; the outline box top and bottom edges are single rows; only the rounded corner is anti-aliased, as expected), `crop-sample14-dpr1-x4.png` (14 px text sharp), `crop-icons-dpr1-x4.png` (SVG icons clean strokes), `crop-wallet-dpr1-x4.png` (panel border, sun disc, big numerals crisp). Full frames from the harness: `docs/visual-reviews/M0/vt10-recheck/S12-noon-tierB-low-webgpu-1920x1080@1-hud-floor.png`, `...-1920x1080@1.5-hud-floor.png`, `...-2560x1600@2-hud-floor.png` (+ sidecars and `index.md`; measure step run: sidecars carry whole-frame and 6 ROI numbers, no HUD-specific numbers, so the pass numbers above come from hud10.json). Panel text, compass, toast, hotbar and icon buttons are crisp at all three sizes; no blur from the 0.5 canvas scale reaches the DOM.

## Findings (not VT-10 blockers)

1. **Harness readout mismatch (qa-test-engineer / ui-engineer to explain).** In all 3 harness frames (`?dpr=N&capture=1`, `S12`) the on-screen readout reads "Device pixel ratio 1.5" (DPR 1 and DPR 2 frames included), while the layout, PNG size and sidecar `dpr` are right. A direct probe with the same params (scratchpad `probe.mjs`) gave `devicePixelRatio` 1 / 2, `--mc-dpr` 1 / 2 and readout "1" / "2", so the real page is right and the harness path (stepped capture) is where a frame shows 1.5. Likely cause is something in the harness stepped-capture path; not investigated further.
2. The harness sidecar still has no HUD measure (VT-12 gap already recorded). Dev text overlay ("Clean The Moon! dev (local)...") still overlaps the top-left of the Lumens panel at DPR 1 and 1.5; confirm absent in production builds.

## Next

Lead: mark VT-M0-10 PASS (floor device); owner of finding 1 is qa-test-engineer. Source not edited.

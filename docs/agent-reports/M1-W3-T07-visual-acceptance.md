# M1-W3-T07 Visual acceptance (technical-artist, capture pass)

Date 2026-11-17. Headless Chrome, real GPU (Intel UHD 620), 1280x720 native, DPR1, Medium. Node 26 via fnm, own Vite on port 5311. Timings provisional (shared machine). No source edited except the lab runner (see Lab fix). Evidence: `docs/agent-reports/M1-W3-T07-visual-acceptance-evidence/`.

## Item status
| Item | Status |
|---|---|
| 3. Lab capture 404 | DONE: gone |
| 1. WebGL2 strips (lope, sweep, sweep-walk, jump) vs WebGPU | DONE: equivalent |
| 2. Real Solo scrub captured (third person, Medium, WebGPU) | CAPTURED; visual inspection of head glue/lag/phase see below |
| 2. Head lag against 60 Hz feet (reviewer finding 2) | see "Solo" section |

## Task 3: capture 404 (DONE, not reproduced)
Runner logs `http >= 400` URLs. Across four lab runs (WebGL2 and WebGPU, 3 to 4 acts each) the logs contain zero `http` lines. The earlier 404 does not occur on the lab pages. Remaining console noise: `toNonIndexed(): already non-indexed` (three warning), Chrome `powerPreference ignored on Windows`, `[render] 23-27 pipeline(s) created after warm-up` (first frames). In the real game the only warnings were the font `preload not used` ones and powerPreference; no http errors, no pageerrors.

## Task 1: WebGL2 vs WebGPU strips (DONE)
- Lab fix (`verify/run-lab.mjs:231`): added `freeze=1` to the anim URL. Before it, the first real-time frames advanced `jump.t`, the walk angle and `toolPhase` by wall-clock dt, so runs were non-deterministic even on the same backend (jump/lope/sweepwalk differed 9 to 11 mean|d| between two WebGPU runs; WebGPU vs WebGL2 looked like mismatched jump timing, one backend airborne at the same step). With `freeze=1` runs are step-deterministic.
- Deterministic rerun, az120, 12 frames per strip, `compare-backends.mjs` (px differing by >12 in any channel, out of 921600):
  - sweep `det2-*`: mean 228 px, mean|d| 0.017/255
  - lope `det2-*`: mean 189 px, 0.013
  - sweepwalk `det-*`: mean 194 px, 0.013
  - jump `det-*`: mean 173 px, 0.018
- Differences are single-pixel edge/AA/dither noise only; no pose, material, shadow or colour difference between backends. Viewed sweep (kneeling, bristle on ground, shadow) on both and jump (airborne tuck vs grounded was the non-determinism artefact only). WebGL2 render path equivalent. Folders `det-{webgpu,webgl2}` (sweepwalk, jump) and `det2-{webgpu,webgl2}` (sweep, lope).
- Flake: first lope attempts in `det-*` timed out on screenshot (30 s) 4x on WebGL2, 1x WebGPU (cold shader compile on a loaded machine; ~25 pipelines created at frame ~155). It succeeded in `det2-*`. Treat as machine load.
- Observation: sweepwalk frame from behind (`det-webgpu/anim-sweepwalk-az120-04.png`) shows the custodian fairly upright while walking with the tool down; the reach/bend is not readable from that back view (tool hidden by the body). Check from az200/270 if the walking scrub matters.

## Task 2: real Solo scrub
Default launch (no `?scene`), `?preset=medium&dynres=off`, WebGPU, UHD 620, frame ~21 ms avg (p95 33 ms, headless, provisional). Script `capture-solo.mjs`: click for pointer lock, V to third person (default camera is first person, avatar hidden), hold Mouse0 (stationary 10 shots, ~150 ms apart), release (6 shots), hold W+Mouse0 (10 shots), release (4). Output `solo-2/{idle,scrub,scrub-end,walkscrub,walkscrub-end}-NN.png` plus `solo.json` (per-shot `__mcGameplay` snapshot). Strokes registered and the Cell filled (toolInputs, dust grams grew); the player walked ~23 m during the walking scrub.
Inspection results below.

### Solo findings (inspected: idle-00, scrub-06, scrub-10, walkscrub-22)
- **The telemetry-driven work pose is NOT visible in the real Solo game (FAIL for the acceptance goal, cause unconfirmed).** Stationary hold of Mouse0 for ~2 s with strokes registering (toolInputs 0 to 167, Cell filled 0 to 5 percent, small dust puff at the feet in `scrub-10`): the custodian stays upright with the same head height as `idle-00`. The lab's hands-and-knees scrub (kneel 1.0) never appears. Walking scrub (`walkscrub-22`) is also plain upright walking, no bend/reach. So the broom head glue, lag/step against 60 Hz feet, and detailing-end phase could NOT be judged: NOT RUN in the sense that the head target / stroke point is not exercised (and the broom is hidden behind the body in this behind-camera view anyway).
- Likely cause (hypothesis, not verified by a runtime probe): the work gate in `apps/client/src/app/solo-avatar.ts:89-92` requires `tele.toolCode === this.toolCode`; `toolCode` is set only by `setTool` from `onShiftState` (`:243-246`) or `resetFrom` seeding from `host.shiftState` (`:166-171`), starting at -1 (`:137`). If no shift-state message arrives after the bind, and `host.shiftState` was not yet populated at bind, the codes never match and `stopWork` runs every frame. Probe next: log `host.toolAnim.{valid,sweeping,toolCode}` vs `feed.toolCode` during a hold (one `page.evaluate` once a debug hook exists), or seed `toolCode` from the equipped tool in `__mcGameplay`/telemetry (the telemetry already carries `toolCode`; the gate could adopt it when `toolCode === -1`, mapping through `toolIds`).
- Reviewer finding 2 (20 Hz head target not extrapolated, `solo-avatar.ts:119-124`): code-level only; not observable until the pose engages. Keep the proposed fix (add predicted-feet delta since the telemetry tick to `headTarget`). Finding 1 (detailing phase wrap) is already handled at `:113-115` (phase 1 clamped), consistent with the reviewer's fix.
- Other observations: default camera is first person (V switches to third); in third person the custodian is at the very bottom edge of the frame (`idle-00`: legs cropped, the DOT hint card overlays it), pitch -0.35; presumably camera-rig tuning, not a custodian issue. Induction panel/toasts cover the left half, as Codex noted. Frame ~21 ms avg, p95 33 ms (provisional, headless, medium, dynres off).

## Cleanup
Vite on 5311 stopped (listen check empty); all Playwright browsers closed in `finally`; no headless Chrome or capture node process remains. No git writes. Source edit: `verify/run-lab.mjs:231` (`freeze=1`) only.

## Next
1. Diagnose why the work gate stays closed in the real game (above), fix, recapture `capture-solo.mjs` with a lower/closer camera (or a kneeling check via `__mcLab`-style debug readout) and review head glue/lag/detailing end.
2. Optional: sweepwalk from az200/270 on both backends.

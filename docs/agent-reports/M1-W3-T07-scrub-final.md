# M1-W3-T07 Solo scrub — final pass (premium slot), 2026-11-18

Status: **done (light gate)**. The head target reaches the poser, and the bristle tips glue to the sim head (the dust contact). Focused tests, client tsc, ESLint and the sim goldens pass. One unobstructed real-GPU look-check was run on the UHD 620 at Medium, and the lab recapture with `freeze=1` was run. `pnpm verify` was not run (light gates).

## Root cause of `headValid=false` at the poser

1. `AvatarAnimator` received `input.headTarget/headValid` but never put them on `AvatarPose`. `CustodianAvatarView` never set `BlockoutPoser.headLocal/headValid`, so the poser always saw false.
2. `SoloAvatarFeed` mapped the sim head into **render space** through the RenderMapper. `input.pos`, `pose.root` and anim-event positions are **moon-centred metres**, so the frames did not match. The feed now passes moon-centred values.

## Changes

- `apps/client/src/animation/avatar-animator.ts`: adds `AvatarAnimInput.headCentre` (stroke middle) and `AvatarPose.headTarget/headCentre/headValid`, copied in `stepTool`.
- `apps/client/src/animation/index.ts`: exports `TOOL` and `strokeCurveIO`.
- `apps/client/src/visuals/characters/blockout/avatar-view.ts`: maps the pose head and centre through the mapper into each custodian's object frame (`toObjectFrame`, scratch `h`) and writes `poser.headLocal/centreLocal/headValid` while the head is valid. No allocation.
- `apps/client/src/visuals/characters/blockout/rig-adapter.ts`:
  - A smoothed `glue` weight (`glueRate` 14/s) blends the right bristle-tip IK target from the procedural stroke to the sim head. Lift and palm wobble stay on top. The target height follows the head (terrain).
  - While kneeling and glued, the body **crawls** laterally and forward so the right hand works over the stroke centre: `crawlX = centre.x + handX` (±0.5 m), `crawlZ = centre.z − glueWorkZ 0.45` (−0.15…+0.6 m), rate 6/s. The knees come along.
  - The body **rocks** fore and aft with the stroke reach at the clip phase (`rockM` 0.14). It uses the clip phase rather than the anticipated `bodyReach`, which pulls back before the push ends.
  - This fixes the earlier 7 cm far-end reach shortfall: the reach error is now ≤0.8 cm. Existing behaviour without a head target is unchanged.
- `apps/client/src/app/solo-avatar.ts`: the feed no longer takes a mapper (the module still uses it for the view). The head is moon-centred and continuous at render rate: the tick head, plus facing × L·(curve(render phase) − curve(tick phase)), plus velocity × time since the tick. The feed also sends the stroke centre and the sim `toolContactFrac`. Detailing holds still. `setToolStrokes()` takes `pushM/contactMs/periodMs` from `createSimConfig(loadGameData()).tools`. That config loads lazily and only once in `SoloAvatarModule.init` (the sim and data chunks are already loaded for prediction). Until it loads, the head steps at 20 Hz.
- Tests:
  - `rig-adapter.test.ts` adds the suite "tool-head glue (sim head -> animator pose -> view -> poser)", covering aim 0.9 and 1.2 and an off-axis case at 0.12 m. The poser cost test now has an explicit 60 s timeout; its assertions are unchanged. The temporary `[glue]`/`GLUE_DEBUG` logging has been removed.
  - `solo-avatar.test.ts` now expects the head in moon-centred metres and adds a stroke-curve continuity test.
- Capture script: `docs/agent-reports/M1-W3-T07-scrub-final-evidence/capture-unobstructed.mjs`. It hides `#mc-ui` and `#mc-overlay` with injected CSS, marks the Induction done in localStorage (so no DOT subtitle covers the avatar), switches to third person (V), pitches the look down, and records scrub, sweep-walk (W) and strafe-scrub (D) bursts. `--dpr/--clip` gives a zoomed look. There is no `?onboarding=0` flag in the app, so the script seeds localStorage instead.

## Commands and results (Node 26.13.1, `PATH=$APPDATA/fnm/aliases/default:$PATH`)

- Failing first, on the old wiring: `node node_modules/vitest/vitest.mjs run apps/client/src/visuals/characters/blockout/rig-adapter.test.ts -t glue` failed with `expected false to be true` (poser `headValid`). The old `solo-avatar.test.ts` expectation was the render-mapped `[1010,1,2]`; it now expects moon-centred `[2010,1,2]`, and `setToolStrokes` did not exist before.
- Glue numbers (bar: tip-to-head ≤ 5 cm through the push, tip height ≤ 5 cm, reach error ≤ 2 cm):
  - Aim 0.9 and aim 1.2: worst 3.8 cm (mostly the 3 cm palm wobble), tip height ≤ 1.9 cm, reach error 0.8 cm.
  - Off-axis 0.12 m: the first run gave 5.9 cm because the lateral crawl was clamped at 0.35 m. After widening the clamp to 0.5 m, it passes.
- `node node_modules/vitest/vitest.mjs run rig-adapter solo-avatar animator blend low-g-ik`: 77 tests run; 76 passed. The one failure was a vitest 5 s timeout on the poser cost test under machine load; its numbers passed (6,000 frames × 16 poses: 4.5 KB heap, bar 32 KB; p95 0.21–0.28 ms, bar 1 ms). With the explicit timeout, `run rig-adapter solo-avatar` passed 25/25.
- `node node_modules/typescript/bin/tsc -p apps/client/tsconfig.json --noEmit`: exit 0.
- `node node_modules/eslint/bin/eslint.js` on the 7 touched source and test files: clean.
- `node node_modules/vitest/vitest.mjs run golden`: 2 files, 7/7 passed (goldens unchanged; no sim code touched).
- Real GPU, under `gpu.lock`, Vite at `apps/client` via `node node_modules/vite/bin/vite.js --port 5311 --strictPort`:
  - `node docs/agent-reports/M1-W3-T07-scrub-final-evidence/capture-unobstructed.mjs --out .../run1 --port 5311`
  - `... --out .../run2-zoom --dpr 2 --clip 480,360,320,260`
  - Both ran WebGPU on "Intel UHD Graphics 620 (D3D11)" with pointer lock true and no page errors. Warnings: `powerPreference` ignored, font preload, "6 pipeline(s) created after warm-up". Frame time avg 17–45 ms, p95 33 ms (run2 DPR2 end p95 99.8 ms). This is a loaded machine, so these are not perf evidence. In run1, strokes registered (153 chains acked) with prediction correction ≤0.1 mm.

- Lab recapture: `node apps/client/src/visuals/characters/blockout/verify/run-lab.mjs --out docs/agent-reports/M1-W3-T07-scrub-final-evidence/lab --port 5311 --parts anim,stroke,turntable` (headless, WebGPU, Medium; still parts use `freeze=1`).
  - Output: 178 files plus `lab-webgpu.json`, no page errors. Warnings were `toNonIndexed` and "23/29 pipeline(s) created after warm-up".
  - Stroke: 14/14 grains tracked, visible, and above the 15% contrast threshold.
  - Anim frames (idle, walk, lope, sweep and sweep-walk at two azimuths, jump) show the hands-and-knees scrub cleanly from the side (`lab/anim-sweep-az120-04.png`).
  - The lab page feeds no head target, so these frames show the procedural stroke and the glue is not visible there.
  - A second determinism run, to diff two `freeze=1` passes, was not repeated.

## Look-check review (run1 full frames, run2-zoom crops)

- **Scrub** (`run2-zoom/scrub-006.png`, `scrub-017.png`): the custodian is on hands and knees, torso horizontal, helmet forward. The cleaned patch grows at the right-hand side under the shoulder line with grains in the air, and is not detached from the body. The bristle tip itself is occluded by the torso from the chase camera, so pixel-level glue cannot be seen in-game. Glue is verified numerically by the test above.
- **Scrub end** (`run1/scrub-end-023.png`): he stands back up holding the duster.
- **Sweep-walk** (`run2-zoom/walkscrub-030.png`): an upright walk with a slight forward bend, the right arm reaching forward and down, and the clean trail behind. No lope-in-place.
- **Strafe-scrub** (`run2-zoom/strafescrub-042.png`): the legs cross for a sidestep, and the trail lies on the trailing side.
- **Head lag**: still frames cannot approve motion (RF-03). No visible lag or offset between the trail and the body appears across the bursts.
- No defects were found that needed a code change after the capture.

## Not run / open

- Glue from a side or low camera in-game: the chase camera hides the hand. Lab frames use the procedural stroke, because `verify/page.ts` does not feed a head target.
- Motion clip or video evidence for RF-03, `pnpm verify`, and perf on a quiet machine.
- Cleanup: Vite 5311 was stopped (port free) and every browser closed when its script ended. I took `gpu.lock` with `mkdir` before run1. When I went to release it after the lab run, it was already gone, so something else removed it during my capture window.

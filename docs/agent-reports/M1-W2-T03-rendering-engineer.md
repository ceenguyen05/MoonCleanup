# M1-W2-T03 Render infra: dynamic res, presets, culling/LOD, warm-up, memory ledger

Status: **in-review (partial: the infra works; the 60 fps goal and zero runtime pipelines are not met on the floor device yet)** / 2026-11-15 / rendering-engineer, Opus 5.5 High (premium slot). No git. Only `apps/client/src/render/**` and this report plus its evidence folder were edited.

## What exists (stopped agent's work, now verified, plus this pass)

Already in the tree (the 2026-11-15 checkpoint commit has it): `culling.ts` (horizon culler, side-plane frustum, `cullSpheres`, distance per class times preset multiplier, screen-size `selectLod` with 10 % hysteresis), `draw-budget.ts` (per frame against `quality.budgets` 350/600), `frame-target.ts` (60 fps on every preset, `?fps=contract`), `memory-ledger.ts` (section 13 categories and budgets), `warmup.ts` (warm-up runs as normal frames, ends when the pipeline count stops changing, then counts every later pipeline), the dynres pace guard, module wiring (`drawBudget`, `memory`, `rendererInfo`, `pipelineWarmup`, `addWarmupSource`, `requestWarmup`, `whenPipelinesReady`, a preset drop after every 2nd device loss), `__mcRender()`, `verify/run-infra.mjs`.

I reviewed the math: the horizon cone/plane test is conservative, the frustum rows match three, and the LOD hysteresis is correct. Fixes and additions this pass:
1. **Defect fixed** (`dynres.ts`): `clearWindow` did not clear the pace-interval window. After a stall or step, old intervals got into the partial-window sort, which skewed the refresh estimate and the reported pace p90. A new test fails without the fix.
2. **Warm-up holds** (`warmup.ts`, `module.ts` `holdWarmup()`): content that loads asynchronously keeps the warm-up open. Added because WebGL2 `?scene=moon` ended its boot warm-up at 0.7 s and then built 8 pipelines when the terrain arrived. 3 tests added.
3. README: added the hold API and noted that warm-up counts shader programs (`info.memory.programs`), so a new pipeline that reuses existing stages is not counted.

## Evidence (i7-8650U + UHD 620, headed Chrome, 1280x720, DPR 1, Medium; machine shared with other agents, and Vite reloaded the page from their `packages/shared` edits)

- `vitest run src/render`: 14 files, **217/217**. `tsc` clean, `eslint src/render` clean, `prettier --check src/render` clean (Node 26).
- Browser runs (`docs/agent-reports/M1-W2-T03-evidence/verify/`: `verify-run.log`, `rerun-webgpu.log`, JSON):

| Check | WebGPU | WebGL2 |
| --- | --- | --- |
| Draws (S06 / moon), budget 350 | 294 / 30, 0 over-budget frames | 294 / 30, 0 over |
| `pipelinesReadyMs` (budget B 8 s) | 6.1-7.2 s / 5.2-5.4 s | 2.0 s / 0.67 s |
| Pipelines after warm-up (budget 0) | 0 / 0 | 0 / **8 (FAIL; fix = hold, not wired yet)** |
| Steady fps, scale | S06 40 fps, moon 50 fps, **at the 0.6 floor**, GPU p90 15-21 ms vs 14, `floorHint` true on S06 | S06 58 fps (0.6-0.65), moon 59.8 fps (0.65-0.7) |
| Dynres timing | no change closer than 2 s, scale stays in range; 3 s reaction and pace guard covered by unit tests | 2-3 steps in 30 s, gaps 4 s or more |

## NOT RUN / BLOCKED

- 60 fps on WebGPU Medium on the UHD 620: **not met**. Content GPU cost is over budget even at the scale floor. That is a content issue (terrain + look), not the controller.
- VT-M1-28 scale-step pulse: NOT RUN. The r187 `TRAANode` resets its history to the current frame when the size changes; the section 9 resample + 50/50 blend is not built.
- Tier A, Low preset, device loss on real hardware, heap with this pass's code: NOT RUN. `pipelines.manifest.ts` CI check: not built.

## Hand-off

- **terrain-dust-engineer (W2-T01):** in `TerrainScene`/terrain init call `renderer.holdWarmup()` before the baked-cube load and release it once the chunks are in the scene. Show every LOD/caster variant through `addWarmupSource`. Record the height cube, horizon map and dust atlas/ring in `renderer.memory` (`terrainDust`).
- **technical-artist (W2-T02/T04):** shadow maps go in `shadowMaps`, post targets in `renderTargets`, textures in `textures`. Use `addWarmupSource` for both lamp states. TRAA history resample on a dynres step (section 9) belongs to the post owner.
- **Integrator/UI:** gate Clock In and "Applying settings" on `whenPipelinesReady()`; show the "Lower preset?" toast from `dynamicResolution.floorHint`.
- **Lead/contracts:** S06 on WebGPU sits at the floor at 40 fps. Decide between a lower Medium `scaleMin`, the section 14.2 Tier B ladder, or content cuts. Proposed contract change: Low/Medium `targetFps` 60 / `gpuBudgetMs` 14 (`frame-target.ts` already overrides).

Files: `apps/client/src/render/{dynres.ts,dynres-pace.test.ts,warmup.ts,module.ts,module.test.ts,infra.test.ts,README.md}`.
Commit suggestion: `fix(render): clear pace window on reset; warm-up holds for async content (M1-W2-T03)`

## Review fixes (2026-11-15, after M1-W2-T03-review-code-reviewer.md)

Blocking 1 (leaked hold, `warmup.ts`, `module.ts`): a warm-up that ends on `maxHeldMs` with holds out now sets `holds = 0` and bumps a hold generation (`holdGeneration`). `release(nowMs, generation)` ignores handles from an older generation; `RenderModule.holdWarmup()` captures the generation when the hold is taken. Later warm-ups settle on the stable count again.

Blocking 2 (dynres stuck at floor below 60 Hz, `dynres.ts`): the refresh estimate is now computed for both signals and also floors the target of the interval signal. It is believed only between 240 Hz and 29 Hz (slower intervals are load), drops immediately, is cleared by `reset()`, and on the gpu signal rises after `refreshHorizonS` = 30 s with no faster window. Known limits: on the interval signal the estimate only drops until the next reset, because a frame rate locked at 2x by load looks like a 30 Hz display and the acceptance test needs that load to step down. A rate locked at 2x from a reset onward is read as the display rate.

Non-blocking fixed: 4, the partial-window percentile never reads the single largest sample (`rank <= count - 2`). 5, `onFatal` resolves the `whenPipelinesReady` waiters, and later calls resolve immediately. Not fixed: 3, the device-loss warm-up clock restart (Next).

Regression tests: `infra.test.ts` (dropped hold, stale release); `module.test.ts` (holdWarmup after time-out, fatal resolves waiters); `dynres-pace.test.ts` (interval at 50 and 30 Hz, gpu display 60 to 30 Hz rise, reset forgets, single hitch).

Evidence (Node 26.13.1): `vitest run src/render` 14 files, 224/224. `tsc --noEmit` (client) clean. eslint and prettier clean on the 6 touched files.

## Review fixes 2 (2026-11-15)

Fixed (review item 3, device-loss warm-up clock): `PipelineWarmup.restart(nowMs)` (`render/warmup.ts`, after `begin`) restarts a running warm-up's clock, time cap, frame count and stable run, and forgets the lost renderer's pipeline count; holds stay out. `RenderModule.handleRecreated` calls it before `bindRenderer` (`render/module.ts` ~931). Before, `begin` kept the old start time, so a warm-up running at the loss timed out on the first frame of the new renderer (recovery time counted against the 8 s cap).

Regression tests: `infra.test.ts` "restart (renderer recreated)" (clock/cap restart, hold survives and times out from the restart, no phantom runtime creations when ready); `module.test.ts` "device loss mid-warm-up restarts the warm-up clock" (9 s recovery, first new frame stays `warming`, ends `ready`, `timedOut=false`).

Terrain report "WebGL2 ?scene=moon `holds: 1` after 10 s": NOT a render defect, no hold leak or double count found in `warmup.ts` / `RenderModule.holdWarmup` (single `hold()` per call, release is idempotent per handle, generation check only differs after the 60 s held cap). Reproduced on the dev server (Chromium SwiftShader, `?scene=moon&backend=webgl2`, polling `__mcTerrain.info()`): `warmupHeld` true at 3 to 15 s, false at 18 s; console `pipelines ready: reason=boot ms=22412 frames=10 pipelines=32 timedOut=false`. Cause: on software GL each early frame costs about 3 s (synchronous pipeline compile), and `TerrainScene.update` (`terrain/terrain-scene.ts:435`) releases the hold only after 6 frames with the terrain shown (`selectMs.n` was 0..5 at 3..15 s). So `holds: 1` is just "fewer than 6 frames done yet". Warm-up then completes normally with 0 pipelines created afterwards. On a real GPU the 6 frames take about 0.1 s. Optional for the terrain owner: release after 2 to 3 shown frames (render's own `stableFrames` check already guarantees the count stands still after the release) or by elapsed time.

Evidence (Node 26.13.1): `vitest run src/render` 14 files, 226/226; client `tsc --noEmit` clean; eslint and prettier clean on the 4 touched files.
Files: `apps/client/src/render/{warmup.ts,module.ts,infra.test.ts,module.test.ts}`.

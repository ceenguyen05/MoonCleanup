M1-W3-T05 terrain acceptance / in-review (default stays flat) / 2026-11-17 / terrain-dust-engineer / Opus 5.5 High

## Done
- Review fixes (M1-review-codex-session.md findings 1-2):
  - Terrain saves get their own IndexedDB: `TERRAIN_GAME_DB_NAME = "moon-cleanup-solo-terrain"` set by `terrainHostOptions` (`app/terrain-game.ts`), next to the prefixed identity (`mc.terrainGame.` keys, own contractId, own Web Lock name). `local-room-host.ts` not edited (it already takes `dbName`). Checkpoint sync and online stay off for the terrain game, so nothing experimental is uploaded.
  - Boot fallback: `loadTerrainGameAsset` catches a failed asset load, reports it through the error boundary and resolves null; `boot.ts` computes `terrainGame = terrainAsset !== null`, so a 404 / bad manifest falls back to the flat worksite (terrain branch of boot.ts only).
- Tests: `terrain-game.test.ts` (identity rows untouched, Contract and DB differ from flat; fallback reports and resolves null), `terrain-dust.test.ts` (new: float32 twin of the shader projection `camToSite + local` vs the double projection, worst < 1 mm; the existing CPU twin test covers poles, cube seams and heights), `boot-wiring.test.ts` (fallback wiring).
- Real-GPU capture (step 2/3): flat vs terrain game, WebGPU Medium, real UHD 620. Terrain dust registers on the curved CDLOD ground (see Evidence).

## Evidence
- Node 26 vitest terrain-game, terrain-dust, boot-wiring, launch-policy: 4 files 35/35. Client tsc exit 0.
- Capture setup: own Vite :5493 (Node 26.13.1), installed Chrome 157.0.8103.79 headed off-screen (`--window-position=-32000,-32000`, no popup), WebGPU, Intel UHD 620 adapter with timestamp-query, 1920x1080 DPR1, `preset=medium&scale=0.75` (Medium floor pinned, dynres off), `--disable-frame-rate-limit`. Lanes alternated flat, terrain, flat, terrain; per lane 10 s warm-up, then 10 s idle, 12 s scrub-walk (tool held + W), 20 s long scrub-walk (exercises the lookup re-centre). Script and raw JSON: `M1-W3-T05-terrain-acceptance-evidence/` (`terrain-accept.cjs`, `results.json`).
- **Machine load: CPU 62% at start, 94% at the end** (user's Chrome, VS Code, Epic Games Launcher + EOS overlay running). All numbers are provisional, not quiet-machine.

| Run | Lane | Phase | Frame p50 / p95 / p99 ms | GPU render p50 / p95 ms (median of 1 s windows) | Draws |
| --- | --- | --- | --- | --- | --- |
| 0 | flat | idle | 30.8 / 70.3 / 216.7 | 27.7 / 29.4 | 26 |
| 0 | flat | scrub-walk | 27.4 / 89.2 / 139.4 | 30.6 / 31.3 | 27 |
| 0 | flat | long walk | 21.8 / 97.8 / 158.2 | 24.6 / 31.4 | 27 |
| 1 | terrain (no pointer lock: walk only, no strokes) | idle | 28.5 / 46.1 / 59.4 | 23.4 / 24.6 | 30 |
| 1 | terrain (no lock) | walk | 29.5 / 46.8 / 61.7 | 24.1 / 28.7 | 30 |
| 1 | terrain (no lock) | long walk | 24.4 / 92.2 / 127.0 | 24.3 / 25.7 | 30 |
| 2 | flat | idle | 29.1 / 47.9 / 62.9 | 24.8 / 25.3 | 26 |
| 2 | flat | scrub-walk | 22.9 / 107.6 / 200.8 (one 8.4 s stall) | 24.6 / 24.9 | 27 |
| 2 | flat | long walk | 29.0 / 88.2 / 109.5 | 31.9 / 32.6 | 27 |
| 3 | terrain | idle | 35.1 / 52.9 / 67.1 | 27.6 / 27.6 | 30 |
| 3 | terrain | scrub-walk | 30.0 / 94.8 / 135.3 | 29.8 / 32.5 | 32 |
| 3 | terrain | long walk | 28.8 / 95.0 / 138.2 | 27.0 / 28.2 | 32 |

- CPU per module (long walk, p50 / p95 ms): visuals flat 0.1 / 0.3-0.4, terrain 0.6-0.7 / 1.3-1.4 (dust pump + lookup sync + follow on the moon scene; inside the Tier B terrain/dust 1.5 ms + visuals 0.7 ms lines). Gameplay 0.1-0.2, animation 0.1. Render submit p50 9-13 ms, p95 26-37 ms on both (machine load). JS heap flat 134-166 MB, terrain 179-200 MB (+~35 MB: decoded height cube + CDLOD).
- Ready time (navigation to `__mcReady` + pose): flat 24 s and 98 s, terrain 142 s and 123 s (load-confounded; terrain adds the ~7 MB cube fetch/decode and terrain pipelines).
- Function on terrain (run 3): 282 stroke chains acked and applied, 0 decode errors, Dust Cell full (4000 g), 2 lookup re-centres, 0 page/console errors in all four runs. Prediction max correction 0.37 m (flat 0.40-0.57 m) during stalls.
- Visual: `3-terrain-trail.png` (looking back along the scrub path on the CDLOD terrain): the clean trail and strafe patch sit on the curved, rolling ground with relief shading, same look as the flat worksite trail (`0-flat-trail.png`, `2-flat-trail.png`); no swimming or offset seen. `1-terrain-idle.png`: terrain at Medium.

- Third-person contact on terrain (V toggles the camera; script `terrain-visual.cjs`, 1600x900, Medium, dynres on, scale settled at 0.75): `v1-terrain-third-scrubwalk.png`, `v-terrain-third-scrubstrafe.png`, `v-terrain-third-trail.png`, `v-terrain-third-trail2.png`. The custodian's feet sit on the sloped CDLOD ground, the shadow starts at the feet, and nothing floats or sinks at this zoom. The clean marks (forward trail toward the crater, strafe patches) lie on the relief and stay registered as the camera swings round. Run: 116 chains acked and applied, Dust Cell 1296 g, 0 errors. GPU render p50 12.8-20 ms, p95 23 ms in that window. No scrub animation is shown: the W3-T07 tool telemetry is open, not a terrain defect.

## Decision: default stays FLAT (`GAME_GROUND_DEFAULT = "flat"`, unchanged)
- **Budget not met by either ground on this UHD 620 at Medium 1080p.** Tier B ceiling is frame p95 33.3 ms and GPU 28 ms. Measured:
  - Frame p95 was 46-108 ms on both grounds.
  - GPU render p50 was 23-32 ms on both grounds.
- **Terrain vs flat delta is within noise.**
  - GPU p50 medians across phases: terrain 23.4-29.8 ms, flat 24.6-31.9 ms, so roughly 0 ms delta (terrain was not slower).
  - Draws: +3 to +5 (30-32 vs 26-27), well under 350.
  - Main-thread visuals CPU: about +0.5 ms p50 and +1 ms p95.
  - JS heap: about +35 MB.
  - Ready time: about +25-120 s, but load-confounded.
- **The machine was heavily loaded**: CPU 62% at the start, then 94-100% (another agent's two `tsc` runs, Epic Games Launcher, VS Code, the user's Chrome). So this is not a quiet-machine verdict.
- **Flipping would also regress non-perf features**, which block the flip whatever the perf:
  - The terrain game refuses Play online (the online host is flat).
  - Cloud checkpoint sync is off for terrain.
  - A cold boot also loads about 7 MB more terrain.
- **To flip later, all of these must hold:**
  - a quiet-machine Medium and Low pair within budget;
  - an online host on the cube, or online flat-only from a terrain launch;
  - checkpoint sync for terrain saves (bake-hash stamped; the owner accepts archiving);
  - then drop `TERRAIN_GAME_STORAGE_PREFIX` / `TERRAIN_GAME_DB_NAME`.

## Limits / open
- **Pointer lock was intermittent.** The first click did not lock in 2 of 4 terrain page loads (runs 1 and vis1), but did in 2 of 2 flat loads. With a diagnostic listener (vis2), lock worked on the first click: `mousedown` hit the CANVAS with focus, and there was no `pointerlockerror`. Probably load or focus timing in the off-screen window. It is not root-caused (owner: gameplay/input). In run 1 no strokes were made, so its terrain row is walk-only.
- The distant trail reads slightly dashed at grazing angles. The atlas is level-0 only, with no mips; the deferred "detail ring and mipmaps" item covers this on both grounds.
- **NOT RUN:** quiet-machine repeat, Low preset pair, WebGL2 terrain on the real GPU, full Induction on terrain, `pnpm verify`.
- **Processes:** Vite :5493 stopped (0 listeners). Every Playwright Chrome closed in `finally`. No leftover script, Vite or Playwright processes (checked by command line). The node on :5297 is not mine.

# M1-W2-T01 CDLOD sphere terrain: round 4 (review F1-F6, warm-up hold, GPU cost)

Task / status: **in-review, partial (hold verified in browser; 9-tap normal no gain; GPU budget not met; motion checks open)** / 2026-11-16 (round 5) / terrain-dust-engineer / Opus 5.5 High
Machine: i7-8650U + UHD 620, headed Chrome, 1280 x 720, DPR 1, Medium. The machine was shared with other agents, so the numbers are noisy. No git. Dev server and drivers stopped.

## Done (code)

- **F1** `cdlod-terrain.ts`: the main view uses a 2 m frustum exemption while the per-cascade casters cast. It uses 60 m only while the main mesh casts (no casters, or a camera cut). `&exempt=` now sets the 2 m value.
- **F2**: caster capacity raised from 256 to 384. Per-cascade overflow is reported by `cascadeOverflow(k)` and by `info().casterOverflow`. Measured 0,0,0,0 in ground, rim and high (worst cascade 79 instances).
- **F3**: the far normal blends two mip levels over the middle half of each level step. The mips now have a 1-texel gutter filled from the neighbouring faces (new `height/height-mips.ts`, `pad: 1` in the twin). No rings or cube-edge capture was taken.
- **F4**: casters are pushed along the light direction by `CASTER_DROP_M * max(dot(L, up), 0)`. That gives the same light depth as the old 0.3 m vertical drop, without moving shadows sideways. Not viewed at 5 or 30 degrees.
- **F5**: the receiver reach is computed from the main camera's fov, aspect and zoom each frame. **F6**: `invalidate()` makes the main mesh cast for 2 frames. A camera jump over 2 m in one frame calls it, and so does `setView`. **F8**: the height texture and the mips each track their own ownership. **F9**: the scene shares one set of mips across preset rebuilds. **F10**: `percascade` is cached.
- p95 breakdown: `info()` now reports `casterSelectMs`. CPU p95 is about 0.5-0.9 ms for the casters and 0.4-0.6 ms for the main selection. So the p95 misses come from the GPU, not the CPU.
- **Warm-up hold**: `TerrainScene` takes `renderer.holdWarmup()` in its constructor. It releases the hold once: after 3 frames drawn post-build or after 1.5 s, whichever comes first, or on a load error, build error, or dispose (see round 4b). The hold is passed in through a one-line change in `visuals/module.ts:160` (`render: renderer`).

## Evidence (`docs/agent-reports/M1-W2-T01-evidence/r4/`)

| Check | Before | After |
| --- | --- | --- |
| Ground, main-view triangles / nodes | 355k / 87 | 279k / 54 |
| Rim / high, triangles | 282k / 227k | 224k / 203k |
| Same-session A/B, ground, scale 0.85 (`&exempt=2` vs 60) | GPU 14.4-17.8 ms | 11.9-14.9 ms (about -2.5 ms) |
| Ground GPU p50, scale 0.85 (separate runs) | 12.3 / 14.5 ms | 13.4 ms (noise is larger than the change) |
| Terrain main pass (`&terrain=0` A/B) | about 6-7 ms at both 0.85 and 0.5 scale, so it is **vertex-bound** | not re-measured |
| Pipelines after warm-up, WebGPU moon | 0 | 0 (ready 7.1 s) |
| Pipelines after warm-up, WebGL2 moon | 8 (W2-T03) | 0. The hold was released, and the warm-up completed with `timedOut: false`; the earlier "stuck" reading was slow first frames, see round 4b |

- Tests (final state): `vitest src/terrain` 15/15. New tests: 2 for the mips, plus the band and neighbour tests at leaf range 16 m. eslint, prettier and tsc are clean for terrain and `visuals/module.ts`.
- Earlier: `vitest src/terrain src/visuals/dust` 21/21. `vitest src/terrain src/visuals` 153/154: a `dust-replay` 5 s timeout under load, which passed on rerun.
- eslint and prettier are clean on `src/terrain` and `visuals/module.ts`. tsc is clean for terrain. The remaining tsc errors are in other agents' live files (`app/remote-room-host.ts`, `ui/hud/plot-label-parity.test.ts`).

## Round 4b: warm-up hold and vertex cost

**The hold was not a leak.** The terrain scene is the only `holdWarmup()` caller. The hold is released exactly once, on any of these: the shown-frame rule, a load error, a build error (new try/catch), or dispose. The release handle is idempotent. The cause was timing: early WebGL2 frames take seconds each while ANGLE compiles shaders, and the release waited for 6 shown frames. In the earlier 10 s check, Vite reloads triggered by other agents' edits also restarted the page. Probe result: `warmupHeld` turned false at frame 6, and the warm-up then completed with `timedOut: false` and 0 pipelines after warm-up. The release now happens after 3 frames or 1.5 s, whichever comes first (`terrain-scene.ts`, in `update`). `render/**` was read only; no defect found there.

**Vertex-cost A/B** (same session, ground view, scale 0.85, dynres off, 2 interleaved runs, GPU p50; `r4/ab/perf-knobs.json`):

| Variant | GPU p50 ms |
| --- | --- |
| Current (after F1) | 12.1 / 13.1 |
| No terrain main pass (`&terrain=0`) | 7.8 / 8.4, so the terrain pass costs about 4.5 ms |
| Procedural detail off (`&detail=0`) | 10.5 / 10.7 (detail costs about 2 ms) |
| 17-vertex patch (`&pverts=17`) | 9.6 / 10.3 (saves about 2.5 ms) |
| Leaf range 14 m (`&leafrange=14`) | 11.1 (about -1.5 ms; nodes 54 -> 36) |

Shipped change: leaf-level range 16 m instead of 20 m for leaf-8 presets (`cdlod/lod-tuning.ts`). The detail fades scale with it, so each detail term still ends at the same grid spacing. The selection tests now also cover band membership and neighbours at most `MORPH_STAGES` levels apart at 16 m with multipliers 0.75, 1 and 1.25 (pass). A/B 16 m vs 20 m (`r4/ab/perf-leaf16.json` with screenshots; 2 interleaved runs; the machine was CPU-loaded by other agents, frames about 30 fps):

| View | Triangles 16 m / 20 m | GPU p50, 16 m | GPU p50, 20 m |
| --- | --- | --- | --- |
| Ground | 247k / 279k | 10.9, 13.4 | 11.4 (second run stalled) |
| Rim | 195k / 224k | 10.3, 10.7 | 10.5, 10.6 |
| High | 168k / 203k | 11.0, 11.0 | 11.3, 11.1 |

Triangles drop 11-17 % and GPU about 0.2-0.5 ms, which is inside the noise. The change is small and is one constant to revert if the visual check rejects the closer LOD transition. Caster overflow was 0 in every run.

## Not done / open

1. GPU budget still not met. **Lead decision proposed:** a Medium patch of 17 vertices (`cdlodPatchVerts`, preset contract in `packages/shared`) is the largest single cut measured (about -2.5 ms). Next in-path cut: build the base normal from a 3x3 texel neighbourhood (9 taps instead of 20).
2. The 3-frame / 1.5 s release has not been re-probed in a browser (unit-level reasoning only). Next step: `node <scratch>/hold.mjs webgl2`, or `run-infra.mjs --parts infra` on `scene=moon` with both backends, and expect `holds: 0` and `pipelinesAfterWarmup: 0`.
3. Not run: visual checks for F3/F4 and the 16 m leaf range (orbit motion, cube edge, 5 and 30 degree sun), a P4 motion re-run, memory-ledger entries (`terrainDust`), High. `pnpm verify` is left to the lead.

## Round 5 (2026-11-16, Opus 5.5): hold re-probe, 9-tap base normal, visual checks

Same machine, headed Chrome, 1280 x 720. Other agents were editing at the same time, which caused one Vite reload. The dev server on port 5193 has been stopped. Evidence is in `docs/agent-reports/M1-W2-T01-evidence/r5/`.

- **Warm-up hold, re-probed in the browser (`?scene=moon`).**
  - WebGPU: terrain ready at 9.0 s. The hold was released 4.5 s later, after 3 frames (early frames take about 1.5 s each). Warm-up became `ready` at 14.1 s with `timedOut: false`, 0 pipelines after warm-up and `holds: 0`.
  - WebGL2: terrain ready at 39.5 s. The hold was released 28 s later, after 3 frames; ANGLE compile makes each frame take about 9 s, and the 1.5 s timer can only fire on a frame. Warm-up became `ready` at 77.9 s with **`timedOut: true`**, 0 pipelines after warm-up and `holds: 0`.
  - The release rule works as specified. The slow WebGL2 boot on UHD 620 is a render/warm-up cost and is outside the terrain path.
- **9-tap base normal (shipped as the default).**
  - New `twin.baseSlope()` returns vec3(H, dH/da, dH/db) from one 3x3 texel window. The main pass uses it; shadow passes still call `base` (4 taps). `&normtaps=20` restores the old path for A/B.
  - GPU parity readback (`verify/index.html?slope=1`, 10,000 points): largest difference 0.11 mm on WebGPU and 0.10 mm on WebGL2, from float rounding only.
  - Same-session A/B, scale 0.85, dynres off, 3 interleaved runs (`r5/ab/perf-normtaps.json`), GPU p50 in ms:

    | View | 9 taps | 20 taps |
    | --- | --- | --- |
    | Ground | 12.8, 11.7, 12.3 | 12.2, 11.7, 12.1 |
    | Rim | 11.9, 11.4, 12.0 | 11.8, 10.8, 11.7 |

  - **No measurable gain.** The vertex cost is ALU work (detail loops and morph), not texel reads. The change is kept because it shows exact parity and costs nothing. Revert it if the lead prefers the simpler code.
  - Captures at native DPR 1.5 (`r5/vis/ground-9` vs `ground-20`, `rim-9` vs `rim-20`) look identical, with no shading seams.
- **Visual checks (stills only, `r5/vis/*.png` and `shots.json`).**
  - Sun at 5 and 30 degrees, at ground and rim: no shadow offset or detachment (F4).
  - Cube edge (`arc=1364552&brg=0`, high and rim): no crack or seam. Blocky base relief of about 3 m texels shows near the camera.
  - Orbit and high views: no rings visible in stills. F3 still needs a motion check.
  - The rim view at a 5 degree sun shows faint planar streaks inside the shadow. These need follow-up; I could not tell from stills whether they are cascade or terrain artifacts.
  - Leaf range: main-view triangles are 173k at 16 m vs 201k at 20 m (ground) and 90k vs 106k (rim). No crack in stills, so **the 16 m leaf range is kept**. A pop can only be judged in motion, and that check was not run.
- Checks: `vitest src/terrain` 15/15; client `tsc` clean; eslint and prettier clean on `src/terrain`.

### Lead decision

17-vertex Medium patch (`cdlodPatchVerts` preset in `packages/shared`): measured about -2.5 ms GPU p50 at ground (12.1/13.1 -> 9.6/10.3 ms, round 4b). This is the only measured cut that is large enough to matter. I did not make the change.

### Open

- Motion checks: P4 path and orbit pan, for F3 rings and a 16 m pop.
- The streaks in the rim view at a 5 degree sun.
- WebGL2 warm-up `timedOut: true` (render owner).
- `sky-dome.ts:112` `atan is not defined`, a TSL error from the technical-artist's live file. It was seen in the console.
- Memory-ledger entries.

Files round 5: `terrain/height/height-twin.ts` (`baseSlope`), `terrain/cdlod/terrain-surface.ts`, `terrain/cdlod/cdlod-terrain.ts`, `terrain/terrain-scene.ts` (`&normtaps`), `terrain/verify/page.ts` (`&slope=1`).

Files: `apps/client/src/terrain/{cdlod/lod-tuning.ts (new),cdlod/cdlod-terrain.ts,cdlod/terrain-surface.ts,height/height-twin.ts,height/height-mips.ts (new),terrain-scene.ts,terrain.test.ts,verify/run-perf.mjs (new)}` and `apps/client/src/visuals/module.ts` (one line).

## Round 7 (2026-11-16, Opus 5.5): 17-vertex Medium patch, budget check

- **State on disk:** the 17-vertex Medium patch is already in place. `packages/shared/src/render/quality.ts` has Medium `cdlodPatchVerts: 17`; that file is owned by contracts and was not edited here. The `TerrainScene` fallback is 17. The caster patch is the half grid: 8 quads, which is a multiple of 2^`MORPH_STAGES`. `&pverts=33` restores the old patch for A/B. This round changed only comments in `cdlod/terrain-surface.ts`, recording the patch size per preset and the doubled grid spacing.
- **Checks:** `vitest src/terrain` 15/15. The patch-grid test covers both 16 and 32 quads. Prettier and eslint are clean on `src/terrain`.
- **Budget (perf-budgets section 3, Tier B, terrain + opaque at most 10 ms; the WDS section 9 terrain line is 7 ms):**
  - The best valid measurement is still round 4b, same session: ground total GPU p50 was 9.6 / 10.3 ms with 17 vertices vs 12.1 / 13.1 ms with 33. The terrain main pass costs about 4.5 ms of that at 33 vertices, so it is about 2 ms at 17. The terrain line is met on that data. The total frame is under the 28 ms Tier B total.
  - This round's re-run (`r7/`) is **invalid**. The CPU was at 100 % and another agent's Playwright regolith shot run shared the GPU. Frames took about 1 s, and the 33-vertex cells timed out. The numbers are not recorded as evidence. **Re-measure on an idle machine:** `run-perf.mjs --cells "ground17|...;ground33|...&pverts=33;noterrain|...&terrain=0" --repeat 3`.
- **Visual cost (r6 stills `ground17` vs `ground33`):** relief in the 20-80 m mid-field is visibly softer at 17 vertices, and small crater rims are lost. The 4 m crater band and the noise are under-sampled at the doubled spacing. This needs technical-artist / lead acceptance. If it is rejected, there are two fixes to A/B. One is to scale the `DETAIL_FADES_M` crater-0 and noise fades by `patchQuads / 32`, which removes the aliasing and also saves cost. The other is to keep 33 vertices and use the 14 m leaf range instead.
- **Processes:** no orphaned 5193 server or wait shells were found at start. I stopped my own 5193 server and perf drivers. Port 5281 (vite), port 5311 (QA vite) and the Playwright `shot.mjs` run belong to other agents and were left running.

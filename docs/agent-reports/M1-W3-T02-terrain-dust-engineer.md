# M1-W3-T02 Client GPU stroke replay into the tile atlas (terrain-dust-engineer)

Task / status: **in-review; replay and in-game sampling work in `?scene=dust`; the game's own stroke feed is not connected** / 2026-11-14, revision 2 (after the lead's rulings) / terrain-dust-engineer / Fable 5.2
Node 26.13.1 (fnm PATH prefix), i7-8650U + Intel UHD Graphics 620, Windows 11, Chrome 157 through Playwright (headed, `channel: chrome`). No git used. Dev server on port 5188 stopped; no browser of mine left running.

## Rulings applied

| Ruling | Result |
| --- | --- |
| 1. A within 1, RGB exact, reference bytes unchanged | Tolerance is explicit in the page (`withinTolerance`: RGB exact, A <= 1 per texel) and in the runner's verdict. Counts below. The CPU reference still equals the W1-T06 recordings in all 1,081,344 bytes |
| 2. Main pass only if clean, else separate pass only when strokes exist | Kept the separate pass. The atlas is a render target the ground samples in the same frame, so it cannot be drawn inside the main pass. No pass and no clock read in a frame without strokes. About 4 KB per render call recorded as a residual for the render owner |
| 3. Wire into the visuals module, shader samples the atlas, GPU timestamps | Done for `?scene=dust` (captures below). GPU timestamps measured on both backends |
| 4. No `packages/world`, sim-host, server | Untouched. `fromPlotLocal` write-up below |
| 5. Tail latency | The 6.5 and 9.0 ms maxima did not recur in 16 rAF cells. What the smaller overruns are, and are not, is below |

## Byte comparison (final file state, 2,400 frames, 960 strokes, 61 rebuilds, 22 tiles)

Each real-GPU cell was run three times (flat-out, rAF, rAF with timestamps). RGB bytes differing: **0 in all 13 cells**. A texels over 1: **0 in all 13 cells**.

| Cell | Ran on | A texels differing by 1 (three runs) | of bytes |
| --- | --- | --- | --- |
| WebGPU Medium | UHD 620, intel gen-9 | 0 / 0 / 0 (exact) | 16,777,216 |
| WebGPU High | UHD 620 | 4 / 4 / 4 | 33,554,432 |
| WebGL2 Medium | UHD 620, ANGLE D3D11 | 2 / 1 / 1 | 16,777,216 |
| WebGL2 High | UHD 620, ANGLE D3D11 | 6 / 5 / 5 | 33,554,432 |
| WebGL2 Medium, 300 frames | SwiftShader, headless | 0 (exact) | 16,777,216 |

The count moves by one between runs because the rebuild slicing follows the real clock, so the draw stream is not the same twice. 360,448 (Medium) and 1,441,792 (High) of the bytes belong to resident tiles.

## Timing (main thread, 5 us clock, machine load 8 to 27 %)

`frame()` is the atlas bookkeeping, flush is three's render calls. ms as p50 / p99 / max.

| Cell, rAF paced | `frame()` | flush, stroke frames | flush, rebuild-finish frames | frames with work, total | mean over all frames |
| --- | --- | --- | --- | --- | --- |
| WebGPU Medium | 0.025 / 0.260 / 0.465 | 0.300 / 0.545 / 0.635 | 0.490 / 0.910 / 0.910 | 0.365 / 1.070 / 1.195 | 0.089 |
| WebGPU High | 0.040 / 0.260 / 0.590 | 0.325 / 0.565 / 1.035 | 0.495 / 1.105 / 1.105 | 0.420 / 1.140 / 1.695 | 0.110 |
| WebGL2 Medium | 0.025 / 0.215 / 0.630 | 0.205 / 0.440 / 0.605 | 0.375 / 1.065 / 1.065 | 0.270 / 0.805 / 1.355 | 0.075 |
| WebGL2 High | 0.030 / 0.220 / 0.550 | 0.180 / 0.390 / 0.455 | 0.360 / 0.625 / 0.625 | 0.235 / 0.745 / 0.905 | 0.073 |

- Against 1.0 ms per frame: met at p50 everywhere; p99 is 0.75 to 1.14 ms and the max 0.91 to 2.03 ms over the 8 rAF cells (the four timestamp cells included). **Not met at the max.**
- Flat-out cells: frames with work p50 0.21 to 0.30, p99 0.95 to 1.19, max 1.29 to 2.39 ms.

**GPU time of the replay passes** (three's timestamp queries, resolved after every frame with work, rAF):

| Cell | stroke frames (1 pass) | rebuild-finish frames (3 passes) |
| --- | --- | --- |
| WebGPU Medium | 0.027 / 0.073 / 0.099 | 0.088 / 0.175 / 0.175 |
| WebGPU High | 0.028 / 0.146 / 0.186 | 0.064 / 0.289 / 0.289 |
| WebGL2 Medium | 0.033 / 0.085 / 0.103 | 0.104 / 0.204 / 0.204 |
| WebGL2 High | 0.035 / 0.144 / 0.160 | 0.092 / 0.301 / 0.301 |

Worst 0.30 ms against the 1.0 ms Tier B dust bar. This is the replay only: what the atlas lookup adds to the ground shader is **not measured**.

## Tail latency

- The 6.5 and 9.0 ms render-call maxima of revision 1 **did not recur**: 16 rAF cells (two full runs, 38,208 frames) have a largest render call of 1.52 ms. Their cause stays unknown; revision 1 ran at 26 to 31 % load and had no control measurement.
- The page now times a fixed piece of CPU work next to every flush and watches the heap. In the final 12 real-GPU cells the render call alone exceeded 1 ms in **10 frames** (largest 1.98 ms). **None** came with a heap drop (a collection) and **none** with a slow control (a stalled main thread). Seven of the ten are rebuild-finish frames, which issue three render calls; six of those sit at frames 1,792 to 1,794, where the scenario finishes a rebuild together with a large stroke batch. The other three are plain stroke frames (1.04 to 1.23 ms).
- So what is left is the render calls themselves in the heaviest frames, about 0.2 to 0.5 ms each through three. It is not this module's bookkeeping (`frame()` max 0.42 to 0.63 ms, rAF).
- One unexplained outlier: a single `frame()` of 8.63 ms in the first cell of an intermediate run. Not seen in the final run (max 0.42 to 1.19 ms over 13 cells).

## Allocation

- Atlas, Node, 8 windows of 600 frames (about 14 rebuilds each): 115 to 168 B per frame with the atlas, 115 B settled with the atlas off. On the floor of the scenario and ledger.
- Render call (known residual, ruling 2): **3,966 to 3,980 B per pass on WebGPU, 3,658 to 3,679 B on WebGL2**; the same loop without the call 0 B. About 40 KB per second while cleaning.
- An update range for the used part of the instance arrays costs another 108 B per pass (three empties the range list after each upload), so the whole 4 x 32 KB goes up instead.

## In game

`?scene=dust` in the visuals module: real plot grid, real `WorldDustLedger` with stroke logs, `DustTileAtlas`, GPU replay before the main render, the regolith shader sampling the atlas. Captures on the UHD 620, Medium, 60 fps at render scale 0.75:

- `dust-scene-webgpu-medium-play.png`, `dust-scene-webgl2-medium-play.png`: the same picture on both backends. Cleaned lanes, scattered strokes, a block of vehicle lanes across several plots with no seam.
- `dust-scene-webgpu-medium-top-remaining.png`: remaining dust from above (debug view 1).
- `dust-scene-webgpu-medium-live.png`: strokes arriving live; more ground is clean than in the frozen capture.
- Visuals module CPU with live strokes: avg 0.25, p95 0.9, max 1.7 ms. That includes the stand-in scenario and its ledger on the main thread. Frozen: 0.08 ms.

What it looks like today: edges are soft and blocky (0.4 m texels on Medium) and a 15 cm stroke is a faint line. That is the detail ring, still deferred.

How it is wired:
- `DustLayer` (`dust-layer.ts`): `bind(renderer)` creates the pipelines at renderer bind and queues every tile after a renderer replacement; `update()` is `atlas.frame()` then `flush()`.
- `VisualsModule`: constructs the scene, calls `bindRenderer` where the sky is bound, calls `preRender` in `update()` before the main render.
- Regolith material: new optional `maskSource` (five taps supplied by a source). Without it the material is unchanged.
- `DustFlatLookup` (`flat-lookup.ts`): world point to tile texel for a flat patch. 8 fetches for the mask part instead of 5 (12 per fragment with the detail taps, 4 textures). CPU twin `locate()`; worst error 0.016 texel over 4,000 points.

**Limits of "in game":**
- **The strokes come from the seeded scenario, not from play.** The game's strokes live in the sim Worker and reach the main thread only as FRAME bytes. Someone has to keep a main-thread ledger view fed from those frames and call `atlas.onStroke`. That is sim-host / gameplay work and a decision for the lead.
- The lookup is for a flat patch. The curved terrain needs its own point-to-plot lookup; atlas, slot table and channel mapping carry over.
- `?scene=dust` still shows the hello-world mesh and starts the solo host unless `&solo=0`, because `app/launch-policy.ts` does not know the scene. I did not edit `app/`.

## Bug found on the way

three r187 `renderer.compileAsync()` holds renderer state (MRT, render context, call depth) across its awaits. Called while the frame loop runs, it left the game rendering black for good, with no error. `prepare()` is now synchronous: it issues each pass once with zero-area quads. Anyone warming pipelines with `compileAsync` during play has the same exposure.

## Scope and ownership

- New: `apps/client/src/visuals/dust/**`.
- Edited outside it, under ruling 3: `visuals/module.ts` (one import, one field, four small blocks), `visuals/materials/regolith-material.ts` (the optional `maskSource`), `visuals/materials/index.ts` (two type exports). The visuals owner should look at these.
- Not edited: `app/launch-policy.ts`, the exported `LOOKDEV_SCENE_IDS` (pinned by `perf-pass.test.ts`), `packages/world`, sim-host, server.
- Task row in M1-mvp.md still names `apps/client/src/terrain/dust/**` and a compute twin.

## Follow-up: `fromPlotLocal` / `toPlotLocal` allocation (`packages/world`, not changed)

Both write doubles into fields of a plain out object, which costs about 16 B per store. Through the atlas that was about 58 KB per tile rebuild (1,024 cells) until the atlas projected from the grid's typed tables itself; the scenario, which calls them four times per stroke, sits at 115 B per frame. Proposal for the next world task: variants that write into a `Float64Array(3)` and an `Int32Array(2)`. I measured this only through this module and the scenario, not in `MoonRoomSim`.

## Not done / NOT RUN

- Game stroke feed (above). Detail ring, mipmaps, stroke-direction R8, B channel: deferred by ruling.
- Device loss: `bind()` on a replaced renderer and `rebuildAll()` are coded; no real device-loss run.
- Full-atlas eviction: coded, not exercised (22 tiles of 512 to 1,024 slots).
- In game on the Low preset, GPU cost of the lookup in the ground shader, Tier A / B, Firefox, Safari, VT-M1 checks, root `pnpm verify`: NOT RUN.
- Limits kept from the prototype: identical stroke records collapse in a rebuild; a ledger-zero cell is cleared as an axis-aligned block; a rebuild with no spare slot is done in place.

## Evidence

- `apps/client`: `tsc` clean, `eslint src/visuals src/app/launch-policy.ts` clean, prettier clean, `vitest run src/visuals src/app` **157 / 157** (dust 7 / 7).
- `docs/agent-reports/M1-W3-T02-evidence/`: 13 result files and 6 captures, all from the final file state, plus `dust-scene-captures.json`.
- Rerun: `pnpm --filter @moon-cleanup/client exec vite --port 5188 --strictPort`, then `node apps/client/src/visuals/dust/verify/run-verify.mjs --lane gpu --backends webgpu,webgl2 --presets medium,high --out <dir> [--pace raf] [--gpu 1]`. In game: `/?scene=dust&solo=0&warm=900`.
- Housekeeping: I deleted two black captures of my own from a broken first attempt (`dust-scene-webgpu-low-play.png`, `dust-scene-webgpu-medium-top.png`). An earlier `rm` with a shell variable was blocked and not retried.

## Next

1. Lead: who keeps the main-thread ledger view and feeds `atlas.onStroke` from host frames.
2. App owner: add `dust` to `VISUALS_SCENE_IDS` and `LOOKDEV_SCENE_IDS` (with the test), or drop the scene once the real ground exists.
3. Render owner: the 4 KB and 0.2 to 0.5 ms per render call; the `compileAsync` finding.
4. Then the detail ring, the curved-terrain lookup, and the GPU cost of the lookup.

Files: `apps/client/src/visuals/dust/{index,replay-batch,tile-atlas,replay-pass,dust-layer,flat-lookup,dust-worksite}.ts`, `apps/client/src/visuals/dust/dust-replay.test.ts`, `apps/client/src/visuals/dust/verify/{scenario.ts,page.ts,index.html,run-verify.mjs}`, `apps/client/src/visuals/module.ts`, `apps/client/src/visuals/materials/{regolith-material,index}.ts`, `docs/agent-reports/M1-W3-T02-evidence/`, this report.

Commit suggestion: `feat(client): TSL stroke replay into the dust tile atlas, sampled by the regolith shader in a dust scene`

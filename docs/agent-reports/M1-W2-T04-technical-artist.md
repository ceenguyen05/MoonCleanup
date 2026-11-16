# M1-W2-T04 Production regolith (surface look) — checkpoint 2

Task / status: **in-progress: H1 adopted, cost cut 2.66 -> 1.95 ms (ground) / 3.34 -> 1.07 ms (rim), sun-60 streaks reduced, WebGL2 sun 60 done; still above "marginal" (<0.5 ms) on UHD 620** / 2026-11-16 / technical-artist / Opus 5.5 High (premium). Checkpoint 2 section below supersedes checkpoint 1 where they differ.
Machine: i7-8650U + UHD 620, Windows 11, headed Chrome (Playwright `channel: chrome`), 1280 x 720, DPR 1, Medium. Other agents were editing the tree; Vite reloads (`src/ui/**`) restarted pages and cost cells. No git. `terrain/**` read only.
Scope of this brief: regolith surface look (close/mid/far albedo + normal detail, micro-detail blending, footprint-ready layer hooks). Rock/crater scatter and the KTX2 pipeline (card rows 2-3) were not started.

## Done (code)

- `visuals/materials/terrain-regolith.ts` (new): TSL graph on `MeshLambertNodeMaterial` (diffuse only, as the terrain chose). One packed detail tile (the M0 procedural tile, no new asset, no licence row) at five scales:
  - close: fine 1.28 m + coarse 4.27 m, 2 stochastic taps each (periodic selector = anti-repeat), packed-gradient normals, albedo breakup, cavity; fade 10-28 / 22-70 m;
  - mid: 9.5 m undulation (normal + albedo), fade 60-280 m; broad: 37 m mottling (+ faint normal), fade 180-1400 m;
  - far: 585 m macro tone + warm umber / cool slate hue drift of the dust at constant luma, no fade.
  - 7 taps, 1 texture binding, 0 vertex work. Grazing-view stretch fade and grazing-sun relief fade (M0 rules) kept; mean albedo stays `ALBEDO_GRIME` x `GRIME_TINT` (exposure / calibration unchanged).
- **Precision fix**: world origin = moon centre, so world xz is only ~0.125 m precise. The coordinate is `positionLocal` + mesh position wrapped to 4096 m in doubles (`onObjectUpdate`); every tile and selector cell divides the period, so the wrap never shows. Projection on the dominant world axis of the fragment's direction (Boreal face = x/z).
- **Layer hooks** (`RegolithLayer`, for M1-W5-T05 footprints and the dust mask): a layer gets `{coord (precise, periodic), local, world, toCamera, normal, toWorldGradient}` and returns `slope` / `albedo` / `thickness` (1 grime .. 0 clean ground, mixes to `ALBEDO_CLEAN` x `CLEAN_TINT`) and its `fetches` / `textures`.
- `createTerrainRegolithMaterial(surface, applyTerrainSurface)`: factory with the CDLOD factory's shape, for the terrain hook (H1).
- Interim adoption (`terrain-regolith-adopter.ts`, wired in `visuals/module.ts`): before each render it upgrades any `mc:terrain-plain` material under the `mc:moon` group in place (once per instance, so preset rebuilds are caught before their first draw). Knobs: `&regolith=0` (A/B), `&rgdebug=1..4`, `&rgsingle=1` (one close tap per scale), `&rganiso=<n>`.

## Evidence (`docs/agent-reports/M1-W2-T04-evidence/`; b = `&regolith=0` plain, a = regolith; ground view, Medium, DPR 1)

| Check | Result |
| --- | --- |
| Sun 30, WebGPU (`r4/b30x-d`, `r4/a30x-d`, `r2/g30a2-a`) | plain = smooth flat tone; regolith = pebbles / small pits close, undulation + mottling mid, macro tone far. No repeat grid, no seams, no swimming in stills |
| Sun 5, WebGPU (`r4/b5-d`, `r4/a5-d`) | lit patches gain pebble / pit detail; no black bump terminators (grazing-sun fade works). The shadow comb is the T02 known limit, unchanged |
| Sun 60, WebGPU (`r2/g60a-a`; `r4/b60-d` plain) | reads as dusty regolith; mid-range shows faint along-view streaks (mid / broad normals at grazing view) — tune next |
| WebGL2 sun 30 / 5 (`r4/a30-d-webgl2`, `r4/a5-d-webgl2`) | same look as WebGPU (backend parity); compiles, no console errors. WebGL2 sun 60 lost (page.goto timeout under load) |
| GPU p50 ms, same session (UHD 620; many cells lost to Vite reloads from other agents and 1 Hz throttling of the headed window, n=1 cells discarded) | sun 5: 10.02 -> 12.04 (aniso 2). Sun 30: 9.51 / 9.08 plain vs 11.90 / 11.85 (aniso 8), 10.92 (1 tap + aniso 2). **Cost about +1.4 to +2.0 ms: not "marginal"** |
| vitest `src/visuals/materials` | 18/18 (new `terrain-regolith.test.ts`: 9). Full `src/visuals` 155/156: the 1 failure is `dust-replay` 5 s timeout under machine load (no import of these files; known flake, T01 report) |
| eslint, prettier on changed files; tsc (no errors in `src/visuals`, earlier run) | clean |

Default anisotropy of the terrain tile set to 2 (`TERRAIN_DETAIL_ANISOTROPY`) after the A/B.

## Not done / next (exact)

1. **Cost cut to marginal (<0.5 ms)**: wrap the close block (fine + coarse, 4 taps + selector noise) in a TSL `Fn` returning `vec4(closeSlope.xy, closeTone, relief)` with `If(toCamera < 70)` inside, derivatives `.toVar()` before the `If`; then default `singleTap` on Low. Re-measure with the off-screen args now in `shot.mjs` (A/B `&regolith=0`, 3 interleaved runs per cell, sun 5/30/60).
2. Mid-range streaks at sun 60: lower `mid`/`broad` `amplitudeM` (0.05 / 0.12) or add them to the graze fade; re-shoot.
3. WebGL2 sun 60 shot; S05 / rim views; motion check (walk) for swimming at the 4096 m wrap and LOD bands.
4. Card rows not started: instanced rock + crater-rim scatter; glTF-Transform/KTX2 pipeline + budgets check.
5. Hooks H1 / H2 below (terrain owner).

## Checkpoint 2 (2026-11-16)

Code (vitest `src/visuals` 171/171 + `terrain-material-hook` 3/3; tsc clean; eslint + prettier clean on changed files):
- **H1 adopted**: `visuals/module.ts` builds `TerrainRegolithProvider` (`materials/terrain-regolith-provider.ts`: shared detail tile, one regolith per terrain build, Low preset = one close tap) and passes `terrainMaterial` to `TerrainScene`; `&regolith=0` passes no factory (plain material). Adopter file, `upgradePlainTerrainMaterial` and the per-frame scan deleted.
- **Cost cuts**: (1) close block in TSL `Fn` + `If`: coarse only < 70 m and graze fade > 0, fine only < 28 m; derivatives before the branch, branch taps use explicit gradients; (2) stochastic selector = macro texel (a / r) + golden-ratio offsets, replacing 8 hashes + 4 `sin`; (3) camera vector from `positionView` (no `positionLocal` varying); (4) analytic grazing stretch (1/cos incidence); (5) mid / broad / macro use plain samples. Knobs `&rgcost=noclose|nofar|nobranch|gradfar|oldsel|localvary`; `__mcRegolith.swap(name)` swaps the terrain material in-page for paired A/B.
- **Sun-60 streaks**: isolated with `noclose` / `nofar` shots: mid-range bands came from the broad mottling + broad share of the hue drift and from coarse relief at grazing view. Fix: close graze fade `[9,26] -> [6,18]`; mid tone/normal fade and broad tone/hue/normal down to 0.25 over stretch `[5,16]` (`GRAZE_STRETCH_FAR`, `GRAZE_TONE_FLOOR`). Remaining bands = terrain geometry + macro patches (present with `&regolith=0`).

GPU p50, in-page paired swaps (`swap.mjs`: 8 alternating cycles x 1.5 s, same thermal state; off-screen headed Chrome, WebGPU, Medium, sun 30; median delta vs plain; cross-page runs proved too noisy, +-1 ms):

| View | plain | checkpoint-1 graph (`oldsel,nobranch,gradfar`) | now default | Low (`single`) | no taps (`noclose,nofar`) |
| --- | --- | --- | --- | --- | --- |
| ground (eye 1.7 m) | 9.5-10.2 ms | +2.66 (session start build) | **+1.95** | +1.47 | +0.47 |
| rim (eye 30 m) | 10.33 | +3.34 | **+1.07** (`nobranch` +1.83) | — | — |

Aniso 1 vs 2: no difference. Ground breakdown: fixed ALU ~0.5, far 3 taps ~0.5, close ~1.0. Below 0.5 ms on UHD 620 needs fewer taps (e.g. Low path on Medium) — owner/lead call.

Evidence `docs/agent-reports/M1-W2-T04-evidence/r5/`: sun 60 before/after `a60-st` -> `a60-st5`, splits `nc60-st3` / `nf60-st3` / `b60-st3`; sun 30 / 5 `a30-st4`, `a5-st4`; WebGL2 sun 60 `a60-gl-webgl2` (matches WebGPU, no errors) + plain `b60-gl-webgl2`; walking steps WebGL2 `w0/w1/w2-gl-webgl2` (arc +0.4 m steps: pattern stays locked to the ground, no seams or pops). Not done: continuous-motion swim capture (pixel diff of a moving camera); rock / crater scatter; KTX2 pipeline.

## Hook requests (terrain owner)

- **H1**: `TerrainScene` ctx option `terrainMaterial?: (surface: TerrainSurface) => NodeMaterial` used at `terrain-scene.ts:314` instead of `createPlainTerrainMaterial` (unless `&spec=1`), passed from `visuals/module.ts`. Then the adopter is deleted and the regolith gets `surface.normalWorld` directly (saves the `cameraWorldMatrix` round trip).
- **H2 (optional)**: none needed from terrain; a seam-free projection at cube-face edges (blend two faces in a narrow band) is visuals-side work, not needed near Boreal.

## Files

New: `apps/client/src/visuals/materials/{terrain-regolith.ts,terrain-regolith-constants.ts,terrain-regolith-provider.ts,terrain-regolith.test.ts}` (checkpoint 2: `terrain-regolith-adopter.ts` deleted). Changed: `apps/client/src/visuals/module.ts` (provider + H1 factory + `__mcRegolith` hook). Drivers `ab.mjs` / `swap.mjs` (port 5283, off-screen args). Evidence + `shot.mjs` (off-screen Chrome args) in `docs/agent-reports/M1-W2-T04-evidence/`. Dev server (5281) and drivers stopped. No git.

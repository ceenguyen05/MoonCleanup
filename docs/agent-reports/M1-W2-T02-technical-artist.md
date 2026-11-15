# M1-W2-T02 Production light + sky (interim 1)

Task / status: **in-progress: partly built, acceptance not met** / 2026-11-15 / technical-artist / Fable 5.2
Machine: i7-8650U + Intel UHD 620, Windows 11, headed Chrome (Playwright, `channel: chrome`), 1280 x 720, DPR 1, preset Medium. No git. Sim, `packages/**`, `apps/client/src/terrain/**` and goldens untouched. Dev server (port 5262) stopped. The fast low-sun look of W2-T01 is unchanged.

## Done

1. **Day clock** (`lighting/day-clock.ts`): contract time drives the sun on the D1 path (30 lit / 30 dark minutes, +40 / -20 degrees). The azimuth turns once a day around the Earth's azimuth, so the Earth's phase comes from geometry. Off by default; on with `?tod=<s>` (`&todrate=`), or when the composition root passes `dayTime` / `dayCycle` to `VisualsModule`.
2. **Terminator handover**: the sun fades over +0.5 to -0.5 degrees; in that band the exposure opens as fast as the disk sinks and the night light is carried as an ambient, so the key swap has no exposure step.
3. **Exposure ramp** on the scripted EV while the clock runs (3 EV/s brighter, 8 s sunset). Stars follow it. Frozen clock = exactly the script (captures).
4. **Low-sun fill**: below 4 degrees the bounce fill stays at the dawn-key level. Before it, the ground at Clock In (sun 0 degrees) was black.
5. **Crown Lamp hooks** (`lighting/crown-lamp.ts`): L1 Clip Light, L2 Spot Ring; level change and on / off write light properties only. S06 now uses the Spot Ring hook.
6. `__mcLook.info().dayClock`, `?earthfull=<0..1>`, and a check driver (`lookdev/verify/run-light-sky.mjs`).

Items 2 and 4 are my look choices beyond the spec; they need visual review.

## Evidence

Folder: `docs/agent-reports/M1-W2-T02-evidence/` (`webgpu/`, `webgl2/`, `final-run.log`).

| Check | Result |
| --- | --- |
| `?scene=moon` ground, WebGPU, default (dynres scale 0.65), 18 cells over the day | frame p50 16.5 to 17.7 ms, p95 19.0 to 21.2; GPU p50 11.5 to 13.3, p95 14.0 to 18.1 |
| Same, clock off (control, 3 runs) | frame p50 16.6 to 17.7; GPU p50 11.7 to 13.3. No cost of the clock above run-to-run noise |
| Same, WebGL2, default | frame p50 16.6 to 16.7, p95 17.8 to 18.2. **GPU ms not measured** (the timer source reports `measured=false`) |
| Uncapped, scale fixed 0.65 | WebGPU frame p50 13.6 to 14.5, GPU p50 10.6 to 11.3; WebGL2 frame p50 9.2 to 10.0, p95 13.5 to 16.6 |
| S06 night, WebGPU | **misses 60 fps**: frame p50 17.8 to 19.9, p95 24 to 27; GPU p50 13.5 to 16.4. With every local light off still 18.6, so not the lamp |
| S06 night, WebGL2 | frame p50 16.5 to 16.7, p95 18.8 to 20.2 |
| VT-M1-11 Earth phase, S01, `earthfull=0`, 5 times of day | expected / measured lit fraction 0.44 / 0.47, 0.04 / 0.10, 0.44 / 0.46, 0.86 / 0.91, 1.00 / 1.00; lit side within 4 to 12 degrees of the sun (`webgpu/phase-*.png`) |
| VT-M1-12 stars (rows 80 to 300) | noon 4, dawn 13, sun at 0 degrees 30, midnight 123 to 129; m_lim 2.77 / 4.10 / 4.67 / 6.00. Expected-count harness not built: +-15 % NOT RUN |
| P5 sunset at x60 | exposure 11.5 to 7.3 in 8 s; stars 11 to 129, largest step 22 between samples 0.6 s apart; ground luma 0 to 3 for about 3 s after sunset |
| Terminator at x2, final code, WebGPU | ground luma 18 until the band, dips to 4, then **steps to 16 at the key swap** |
| Key swap on S05 regolith ground, frozen | 45.8 before, 52.3 after |
| Clock In (t = 0), final code | ground luma 69.7 (`moon`), 67.7 (S01); before the fill fix 6.0 |
| VT-M1-29 bloom, noon, bloom on vs off | S05 and `moon`: difference 0.0 on every pixel. Dawn not run; no bloom-only debug view exists |
| VT-M1-10 S06 pool probe | 137.9 (WebGPU), 139.4 (WebGL2); 89.4 without the lamp, 78.3 without local lights. Ground class at the probe not checked: not judged |
| vitest `src/visuals src/terrain src/app` | 230 / 230 (21 new) |
| tsc, eslint, prettier (changed files) | clean |

Measured before the last edit (fill knee 2 to 4 degrees, which changes only a sun below 4): phase, P5, S06, bloom, and every default WebGL2 run. Not run: Tier A / B hardware, Low / High, heap per frame, VT-M1-08, 09, 10b, `pnpm verify`. No Tier B budget verdict: this laptop is below Tier B.

## Open

1. **Horizon map is not on the CDLOD terrain** (acceptance line 1 not met). The term must be published by the terrain material; not built.
2. **Clock not wired to the sim**: needs `dayTime` / `dayCycle` from the composition root.
3. **Sun and Earth angles are in world axes.** In the `moon` ground view the Earth sits about 24 degrees up, not the 16 set (read from pixels, 60 degree FOV assumed; not confirmed in code). The rig needs the site's local frame.
4. Key-swap step on `moon` (4 to 16). View-dependent (3.8 to 8.2 from high, 3.3 to 16.2 at eye level): likely the placeholder terrain material's specular plus item 3. Not isolated.
5. GPU exposure metering (-0.5 to +1 EV) is not built; `adaptationMultiplier` stays 0.
6. Earth default `earthfull` 0.5 (M0 look) does not show the physical phase. Decision needed.
7. Earth shadows are absent inside the band (the carry is shadowless). Comb teeth in shadows at sun 0 degrees (`webgpu/cell-webgpu-clockin-t0.png`).
8. Clip Light not captured on screen. Cones differ between art-direction 2.2 and rendering-pipeline 5.3; I used 2.2.

## Files

New: `visuals/lighting/day-clock.ts`, `day-clock.test.ts`, `crown-lamp.ts`, `crown-lamp.test.ts`, `visuals/lookdev/verify/run-light-sky.mjs`.
Changed: `visuals/lighting/key-light.ts`, `sun-rig.ts`, `visuals/module.ts`, `visuals/index.ts`, `visuals/lookdev/hooks.ts`, `scene-base.ts`, `s06-night.ts` (all under `apps/client/src/`).

Run: `pnpm --filter @moon-cleanup/client exec vite --port 5262 --strictPort`, then
`node apps/client/src/visuals/lookdev/verify/run-light-sky.mjs --out <dir> --backends webgpu,webgl2`.

## Next

1. Terrain owner: publish the horizon term and the site frame (`LookScene`), then I build the sphere horizon node and re-run the terminator check.
2. Integrator: pass the sim clock to `VisualsModule`.
3. Visual review of dawn, terminator and night captures; find the S06 WebGPU cost.

## Blockers / requests

- terrain-dust-engineer: horizon hook and site frame (Open 1, 3).
- integrator: `dayTime` / `dayCycle` (Open 2).
- lead / Cee: Earth phase default (Open 6).

Commit suggestion: `feat(visuals): day clock on the D1 sun path, terminator handover, exposure ramp, Crown Lamp hooks (M1-W2-T02, partial)`

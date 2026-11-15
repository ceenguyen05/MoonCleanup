# M1-W2-T01 CDLOD sphere terrain + Pilot Fence (interim 3)

Task / status: **in-review candidate, not signed off** / 2026-11-15 / terrain-dust-engineer / Fable 5.2
Machine: i7-8650U + Intel UHD 620, Windows 11, headed Chrome (Playwright, `channel: chrome`), 1280 x 720 window. No git. Sim, `packages/**` and goldens untouched. Dev server stopped.

## Round 3: what changed

1. **Foreground stripes removed, fast low-sun look kept** (owner decision). Terrain shadows still cost about 1 ms on Medium.
2. **P4 motion step at 10.22 s found and fixed.**
3. **`?scene=moon` on WebGL2 Medium run**, with a short P4 pass.
4. **Per-fragment far-field normals built**; no measurable cost in the ground view. The orbit view now shows craters.

Left as told: the beginQuery warning stays open (no URL), the dust-scene mirror is untouched.

## Evidence

| Check | Result |
| --- | --- |
| Stripes, 14 degree sun, ground view | gone on Medium and Low (`r3/stripes-fixed.png`); before / no caster detail / lowered casters in `r3/stripes-abc.png` |
| P4 window 9.9 to 10.6 s, changed pixels per step | before 0.162 % at 10.22 s (4.2 x the median); after the fix max 0.070 %, no isolated step; old all-cascade casting 0.083 % |
| Motion P2 and P4, Medium WebGPU, final code, 176 steps each | no isolated step in any of 8 windows (P4 max 0.067 %) |
| `?scene=moon`, WebGL2 Medium: ground, rim, orbit | frame p50 16.5 to 16.7 ms, no console errors; captures viewed |
| P4 pass, WebGL2 Medium, 88 steps | no isolated step (max 0.066 %), no errors |
| Height twin, 10,000 points, final code | WebGPU max 0.28 mm, WebGL2 max 0.32 mm, 0 over 2 cm |
| Medium ground view, default settings | frame p50 16.6 to 16.9 ms over four runs, p95 20 to 21 ms; GPU p50 11.3 ms, p95 17.5 |
| Low ground view, default settings | frame p50 16.6 ms; GPU p50 5.9 ms |
| Far normals on / off, Medium, scale fixed 0.85, uncapped | ground 11.6 / 12.3 ms GPU, rim 10.6 / 11.0 ms: no cost above run-to-run noise. Orbit 6.8 ms |
| vitest `src/terrain src/visuals src/app src/gameplay` | 243 / 243 (one new test for the caster selection) |
| tsc, eslint, prettier (terrain and the four visuals files) | clean |

Evidence: `docs/agent-reports/M1-W2-T01-evidence/r3/`. The measurements predate a final formatting pass and the added test; no logic changed after them.

## Causes and fixes

- **Stripes.** The casters are coarser than the lit surface and leave out the small craters and the noise. Near the terminator their back faces poked through lit ground and drew the comb. Removing all caster detail did not help; drawing the casters 0.3 m lower did (`CASTER_DROP_M`). Side effect: terrain shadows start 0.3 m lower, so at a 14 degree sun a contact shadow is about 1.2 m shorter.
- **P4 step.** The half-resolution caster patch is the grid one level coarser, but its morph still ran on the finer level's ranges, so the cast surface jumped when a node split. The shadow passes now use half the morph range. Two smaller corrections went in with it: every cascade keeps the 12 m and 40 m crater bands (a crater's shadow no longer changes between cascades), and the caster cut-off behind the receivers allows for frustum corners.
- **Far normals.** Beyond 200 to 320 m (times the preset range multiplier) the normal comes per fragment from the slope of the height cube, at the mip level whose texel is about one pixel. Three mip textures (512 / 256 / 128, 4.1 MB) are built at load as separate textures. Near ground keeps the vertex normal. This is the reverse of the WDS 3.6 wording (per fragment near, per vertex far): near the camera the grid is finer than the height texels, far away it is coarser.

## Open

1. Medium p95 is 20 to 21 ms: some frames miss the display interval. Not broken down. High was not re-measured this round (37.7 ms last round).
2. Far normals pick one mip level per fragment with no blend between levels; no step showed in the P4 motion check, and no orbit motion was run. The 40 m crater band loses its shading beyond 320 m. Cube-face edges were not checked.
3. A few light specks sit inside one shadow in the rim view on both backends (`r3/rim-farn.png`); not diagnosed.
4. Caster boxes are one frame old (with a margin): a teleport may show one frame without terrain shadows. Not captured.
5. Beyond the fade distances the drawn ground lacks craters the JS ground still has (up to 0.24 m). The local player is always inside them.
6. The low-sun look was checked at 14 degrees only; a 30 degree capture exists (`r3/ground-sun30.png`) but I did not view it. Shadow edges are still toothed.
7. Not run: Tier A hardware, heap per frame, cube-edge capture, `pnpm verify`. The motion check is a pixel metric, not a 0.25x review by a person.
8. beginQuery GPU timer warning: open, not reproduced, no URL.

Recorded limit: the height cube is an RG8 array texture without array mips (three r187 has no `r16uint` mapping and uploads no mips for data array textures); the far normals use separate mip textures instead. Height textures total 16.7 MB.

## Files

`apps/client/src/terrain/**`: this round `cdlod/terrain-surface.ts` (caster drop and range scale, far normal), `cdlod/cdlod-terrain.ts` (caster rules, mips), `height/height-twin.ts` (mip textures, face coordinates, far slope), `terrain-scene.ts`, `terrain.test.ts`, `verify/run-verify.mjs` (`--windows`).
Outside my owned paths, unchanged since round 2: `visuals/lighting/sun-rig.ts`, `visuals/lookdev/scene-base.ts`, `visuals/module.ts`, `visuals/perf-pass.test.ts`.

Run: `pnpm --filter @moon-cleanup/client exec vite --port 5193 --strictPort`, then
`node apps/client/src/terrain/verify/run-verify.mjs --out <dir> --twin 1 --shots 1 --preset medium --motion p2,p4`.
A/B switches on `?scene=moon`: `&farn=0`, `&sdrop=<m>`, `&sdf=<m>`, `&percascade=0`, `&cast=0`, `&terrain=0`, `&skirt=0`.

## Next

1. Visual review of the terrain (low and high sun, orbit) by visual-qa-reviewer.
2. Break down the Medium p95 frames.
3. Blend between mip levels in the far normal if a reviewer sees rings; cube-edge capture.

## Blockers / requests

- None blocking. W2-T04 (technical-artist): the regolith material maps by `positionWorld.xz` and assumes +Y up; on the sphere it needs the terrain hooks (`applyTerrainSurface`, `surface.normalWorld`).

Commit suggestion: `feat(terrain): CDLOD sphere terrain with per-cascade casters, far-field normals, TSL height twin on both backends, Pilot Fence (M1-W2-T01)`

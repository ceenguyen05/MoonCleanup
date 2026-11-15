# M1 lookdev: `__mcLook.info()` hooks and the S05 `slopeShadow` / `rampShadow` probes

Task: M1 Fable queue, lookdev / status: in-review / 2026-11-15 / technical-artist / Fable 5.2

## Done

**Diagnosis: the ramp shadow is real; the probe and the scene geometry were wrong (both in `visuals/lookdev`).**
The S05 ramp is half buried (it tilts about its centre line). The ramp canopy hung over local x = -3, so at sun 60 / az 200 its
shadow fell on the flat ground beside the ramp. `slopeShadow` returned the hit on the ramp *plane*: (-19.51, **-0.91**, 3.31),
0.8 m under the ground. In the grazing `wide` view that point projects 30 px below the shadow strip, so it read lit:
luma 170.4 on Low, 168.7 on Medium (not a Low or shadow-map defect). `slopeLit` was under the ground too.
Consequence: the M0 VT-M0-16 "slope facing away, shadow 86" number was measured on flat ground.

**Fix.** Canopy placed per tilt so the shadow centre at 60 / 200 lies 4 m up the visible half of the ramp
(`&rampcanopy=m0` restores the M0 placement for A/B). New probe `rampShadow` = centre of the canopy shadow on the first
visible surface (ramp face, else ground); `slopeShadow` = the same point, reported only while it is on the ramp face.
A probe may now return `null` and is then left out of `probes()`. `wallShadow` / `wallLit` are reported only to a camera in
front of that face (in `wide`, `wallShadow` had been reading the lit face, 170.3).

**`info()` additions:** `shadowMapSize` (allocated cascade depth target), `adaptationMultiplier` (0: exposure is scripted,
nothing adapts), `dustAtlas` (`?scene=dust`: size, slots, texelCm, resident tiles, backlog, counters, CPU ms),
`notBuilt: ["dustRing", "particles"]`. `preset` was already there. No per-frame code added.
`dustRingTexelCm`, `particlePool`, `particlesLive` are deliberately **not** reported: the ring and particles do not exist,
and echoing the preset table would give a false match.

Low shadow maps unchanged (1024, asserted in a test).

## Evidence

Machine: UHD 620, Chrome 157 headed, 1920x1080 @1, `scale=floor`, **Vite dev server** (not a production build).
Folder: `docs/agent-reports/M1-lookdev-info-probe-evidence/` (PNGs native; `*-marked.png` have the 48 px probe boxes; `cap.mjs` is the driver).

| Check | Low webgpu | Medium webgpu | Low webgl2 |
| --- | --- | --- | --- |
| Before, `wide`, old `slopeShadow` (48 px) | 170.4 lit | 168.7 lit | not run |
| After, `shadeSlope`, `slopeShadow` (16 px) | 89.0 | 88.9 | 89.0 |
| After, `slope`, `slopeShadow` (16 px) | 88.0 | 88.1 | not run |
| After, `slopeLit` on the ramp face | 170.6 | 170.6 | 170.6 |
| M0 canopy + new `rampShadow`, `wide` (16 px) | 86.0 | 86.0 | not run |
| `info().shadowMapSize` | 1024 | 1024 | 1024 |

- Viewed from this folder: `before-s05-wide-low-webgpu-marked.png`, `before-s05-shadeSlope-low-webgpu-marked.png`, `after-s05-shadeSlope-low-webgpu-marked.png`, `after-s05-slope-medium-webgpu.png`. Viewed from the run just before the wall-probe change (same ramp code, identical probe numbers, files not kept): shadeSlope Medium, slope Low, wide Low, M0-canopy wide Low. The other PNGs in the folder were not opened.
- Harness (`screenshots -- S05 --lane gpu --url ... --preset low|medium`): sidecars carry `shadowMapSize 1024`, `adaptationMultiplier 0`, `notReported ["dustRingTexelCm","particlePool"]`; no wrong `probe:slopeShadow` ROI.
- `slope=toward`: `slopeShadow` 88.9. Sun 15: `slopeShadow` absent, `rampShadow` on the ground. Dust scene: `dustAtlas` Low 2048x1024 / 512 slots / 40 cm, Medium 2048x2048 / 1024 slots.
- Client: `vitest run src/visuals` 16 files / 124 tests pass; `tsc -p tsconfig.json` 0; eslint 0 and prettier clean on the changed files.
- `tools/screenshots` (not edited): vitest 7 files / 46 tests, tsc 0, eslint 0.

## Not run / open

- Root `pnpm verify`, production-build captures, High / Ultra, Tier A/B devices.
- VT-M0-16 not re-run with the reviewer's `lookcheck.mjs`; the slope numbers above are from my driver. The M0 slope value needs re-recording.
- **Open defect:** in the `wall` view `flatLit` is behind the wall and reads the wall (144). Only the wall's own faces are guarded; no general occlusion test.
- In `wide` the ramp shadow is now mostly out of frame, so the default harness S05 capture has no slope ROI. VT-16 patches need `view=shade|shadeSlope|wall` (harness has no S05 view variants; qa-test-engineer).
- S05 composition differs from the M0 captures at the ramp (canopy moved). Below about 25 degrees the canopy is nearly edge-on to the sun and its shadow is a sliver.
- `tools/screenshots/README.md` line 61 still lists `shadowMapSize` and `adaptationMultiplier` as unreported (QA owns it).
- Lamp shadow map sizes (S06) are not in `info()`.

## Files

`apps/client/src/visuals/lookdev/{s05-geometry.ts, s05-geometry.test.ts, s05-shadow-lab.ts, scene-base.ts, hooks.ts, hooks.test.ts}`,
`apps/client/src/visuals/lighting/{sun-rig.ts, sun-rig.test.ts, key-light.ts}`,
`apps/client/src/visuals/dust/{atlas-info.ts, atlas-info.test.ts}`, `apps/client/src/visuals/{module.ts, index.ts}`.

## Next

1. visual-qa-reviewer: re-run VT-M0-16 (`lookcheck.mjs`, Low webgpu + webgl2, Medium) on a production build and accept or reject the new canopy placement.
2. qa-test-engineer: S05 view variants in the harness registry; README line 61.
3. Technical-artist: extend the wall occlusion rule to every S05 probe (`flatLit` in the `wall` view).

Blockers: none.

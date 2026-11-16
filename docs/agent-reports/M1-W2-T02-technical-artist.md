# M1-W2-T02 Production light + sky (interim 3 + close-out)

## Close-out verdict (2026-11-16, `docs/agent-reports/M1-W2-T02-evidence/r4/`)

**Far kernel floor along the light: set to 1** (`FAR_KERNEL_FLOOR_Y = 1`; X stays 0.4; near pcf3 Y 1 / X 0.4; handover stays off by default).
- Same-session A/B, Medium, WebGPU, ground view. Y 0.4 / 0.7 / 1 (`crop-g5-y4-y7-y10.png`): at 1 the far ridge comb is visibly smoother at 5 degrees. 0.7 is between the two. At 10 degrees the trend is the same (`g10y*`).
- GPU p50: sun 5, 9.07 / 9.52 / 8.89 ms; sun 10, 8.57 / 8.89 ms (the Y 1 cell lost its GPU sample). No cost above noise.
- **S05, Low, sun 1** (`crop-s05low-y0-y4-y10.png`; floor Y 0 / 0.4 / 1): the long post shadow and the custodian shadow show no visible darkness loss. This is visual only. The rock is not in this crop, and I did not measure the ROI luma, so the VT-M0-04b number is not re-measured.
- **Ground, sun 30** (`crop-g30-before-after-webgl2.png`): before, after, and WebGL2 after are identical. The floors only act below about 19.5 degrees.
- **WebGL2 ground, sun 5**, final defaults (`crop-g5-webgpu-webgl2.png`): same look as WebGPU (backend parity).
- Final defaults, GPU p50: ground 5 8.37 ms, ground 30 8.62 ms (before 10.23), S05 Low 9.61 ms.

**Remaining limitations (exact):**
1. At sun 10 degrees or below, a faint residual stripe pattern stays on cascade 0 edges, and the mid-distance comb patch in the ground view (about x 650-860, y 380-440 of `g5a`) is softened but still visible. Both are texel staircases of terrain casters at a grazing sun. A further fix needs a different shadow technique for terrain-on-terrain shadows: a finer horizon map so the opt-in `?handover=1` holds mid-scale ridges, or shadow cameras aligned to the light on the site frame. That is not a filter value.
2. VT-M0-04b rock darkness on Low has not been re-measured numerically with Y 1 (step: `scene=s05&sun=1&preset=low`, rock ROI luma, with `kernelfloory=0` vs default).
3. Carried: sim clock wiring (integrator), GPU exposure metering, Earth phase default (Cee), shadowless earthshine in the terminator band, Clip Light capture, S06 WebGPU cost.

Checks: vitest `src/visuals` 147/147, prettier and eslint clean on the 8 changed files. Dev server stopped.

---


Task / status: **in-progress: partly built; teeth reduced near the player, not gone at range** / 2026-11-16 / technical-artist / Opus 5.5 High (premium)
Machine: i7-8650U + UHD 620, Windows 11, headed Chrome (Playwright, `channel: chrome`), 1280 x 720, DPR 1, Medium. Other agents were editing the tree at the same time; Vite reloads cost some cells (marked below). No git. `terrain/**`, `render/**` and `packages/**` were read only. Dev server (5271) and drivers stopped.
Interim 1 (day clock, terminator handover, exposure ramp, low-sun fill, Crown Lamp hooks) is unchanged.

## Done

1. **Sky seam fixed, confirmed on both backends.** The baked dome used to read its texture through the sphere's vertex uv. That uv is linear per flat facet, so the elevation bent every 5.6 degrees, and the steep horizon band showed faint lines. The lookup is now per pixel from the view direction (`sky/sky-dome.ts` `bakeCoordNode`, CPU twin `skyBakeCoordOfDirection`). S01 P4 flyover f14 (`scene=s01&time=dawn&view=fly:0.933`): smooth gradient with no line, and WebGPU and WebGL2 are identical (`r3/fly-g-webgpu.png`, `r3/fly-g-webgl2.png`).
2. **Sky follows the site frame.** `SkyDome.orient(up)` and `SkyFrame.siteUp`; `module.ts` passes `site?.up`. The sun glow is computed in the dome's frame.
3. **Cause of the comb found.** It is in **cascade 0**, on the **map Y axis (along the light)**. In the ground view at a 5 degree sun it sits 3 to 10 m from the camera. The receiver-aware rule shrank the kernel to a single comparison (scale 3 sin 5° ≈ 0.26), and one 2 cm texel row covers about 20 cm of ground along the light.
   - Ruled out: far kernel floors on X (`r3/crop-f00-f10.png`, no change) and patch density (`pverts=65`, the same teeth, `r3/crop-def-p65-sdf0.png`).
   - Fix: per-axis kernel floors (`lighting/shadow-filter.ts`).
     - Near (`pcf3`): **Y 1, X 0.4**. Y keeps the full tent along the light; a 0.38 m rock is about 19 texels there, so nothing thin is diluted. X keeps posts crisp.
     - Far (`pcf5`): X 0.4, Y 0.4.
   - A/B knobs: `?kernelfloor[0][x|y]=`.
4. **Low-sun handover tried, left off by default** (`?handover=1`; `MoonShadowNode.lowSun`, `lowSunHandover`). Past cascade 0, it hands terrain-on-terrain shadows to the horizon map below 6 to 10 degrees of sun. It removes the far teeth, but it also removes real mid-scale ridge shadows that the horizon map does not hold (`r3/crop-g5-before-after.png` in `ho`). That breaks "working shadows", so it stays opt-in.
5. Horizon-map term and site frame from the terrain owner: on in every run.

## Evidence (`docs/agent-reports/M1-W2-T02-evidence/r3/`; before = `kernelfloor=0&kernelfloor0=0`, same session)

| Check | Before | After |
| --- | --- | --- |
| Ground, sun 5 (`crop-g5.png`) | near comb of hard teeth | near comb softened to faint ramps. **Mid / far teeth remain** (cascade 1+, right and top of the crop) |
| Ground, sun 10 (`crop-g10.png`), sun 30 (`g30b`; the after shot timed out) | | sun 10 slightly softer; sun 30 has no comb in either |
| Rim, sun 5 (`crop-r5.png`) | | no visible difference; no comb in this view |
| S05 posts / custodian / canopy, sun 4 (`crop-s05.png`) | | post and custodian shadows unchanged (no regression). The far canopy edge comb is the same as before |
| GPU p50, WebGPU, scale 0.85, ground 5 / ground 10 / rim 5 / S05 | 8.62 / 9.41 / 8.83 / 10.04 ms | 8.80 / 8.53 / 8.75 / 10.08 ms: no cost above noise (same tap count) |
| WebGL2 | | rim 5 and the flyover render, with the same look as WebGPU (`r5a-g-webgl2.png`, `fly-g-webgl2.png`). The ground-5 cell was lost to a reload. GPU ms not available on WebGL2 |
| vitest `src/visuals` | | 19 files, **147/147** (new: `sky-dome.test.ts` 4, floor tests 2, handover 1) |
| prettier, eslint (8 changed files), `tsc --noEmit` (no errors in `src/visuals`) | | clean |

## Open

1. **Mid and far comb (cascade 1+) at sun ≤ 10 degrees: not fixed.** The far Y floor is still 0.4. Raising it to 1 is the same fix that worked on cascade 0, but it brings back the VT-M0-04b rock dilution on Low (58 %). Next: A/B `kernelfloory=0.7` and `=1` on `scene=moon` ground at sun 5, and `scene=s05&sun=1&preset=low` (rock shadow darkness), then pick.
2. Handover (`?handover=1`) would only be acceptable with a horizon map that holds mid-scale ridges (finer bake or more azimuths). That is the terrain owner's call.
3. Carried from interim 1: sim clock not wired to `VisualsModule` (integrator), GPU exposure metering, Earth phase default (Cee), shadowless earthshine inside the terminator band, Clip Light capture, S06 WebGPU cost.

## Files

Changed: `apps/client/src/visuals/sky/{sky-dome.ts,sky-rig.ts}`, `visuals/lighting/{shadow-filter.ts,shadow-filter.test.ts,sun-rig.ts,sun-rig.test.ts}`, `visuals/module.ts`. New: `visuals/sky/sky-dome.test.ts`. The capture scripts are in the evidence folder (`shot.mjs`, `shot2.mjs` for any `?scene=`, `crop.mjs`).
Commit suggestion: `fix(visuals): per-pixel sky lookup on the site frame; along-light kernel floor for cascade 0 (M1-W2-T02, partial)`

# M0 look-polish round 2 (part A: sky and post, items 1 and 4)

Task M0-look-polish-r2 / status: **in-review** (items 1 and 4 implemented and measured; items 2, 3, 5, 6, 7 handed to
part B, `M0-look-polish-r2b.md`) / 2026-11-13 / technical-artist, Fable 5.2, high effort. One Intel UHD 620 laptop (floor
device), headed Chrome, real app through the capture Vite config (my port 5196, stopped), 1920x1080 DPR 1, `scale=1`,
`?capture=1` stepped frames. **All numbers provisional: floor device, no Tier A/B claim.** No installs, no git.
`pnpm verify` NOT RUN (lead's integration step).

Scope after the coordinator's narrowing (10:18): `apps/client/src/visuals/sky/**` and `visuals/post/**` only.

## Results

| # | Item | Before (M0-visual-checks) | After | Verdict |
| --- | --- | --- | --- | --- |
| 1 | VT-M0-13 stars, **High / TRAA**, 2 deg/s pan, 90 frames | moving / still peak **0.72**; per-star peak variation 12.9 % median, 20.7 % worst; 28 % of stars within 10 %; roundness 0.81 | moving / still **0.999**; variation **3.9 % median, 6.0 % worst; 100 % within 10 %**; roundness 1.00; sigma 1.16 px; camera at rest for 12 frames: 0 % variation (the jitter is cancelled) | **PASS for what was run** (bar: >= 90 % retention, variation <= 10 %) |
| 1 | VT-M0-13 stars, **Medium / SMAA**, same pan | moving / still 0.997; variation 8.8 % median, 13.0 % worst; 72 % within 10 % | moving / still 0.999; variation **4.5 % median, 9.0 % worst; 100 % within 10 %**; sigma 1.17 px; roundness 1.00 | **PASS for what was run** |
| 4 | Earth shape near the frame corner (S01 dawn view a, Earth at 280, 192 px), Medium | lit region 94.7 x 80.5 px, visibly an egg (1.18 : 1); on axis 69.7 px | corner **70.6 x 52 px**, on axis **70.5 x 52 px**: the same shape and size in both places (52 is the width of the lit phase, not of the disk) | **FIXED** (round by looking; corner = centre by measurement) |
| 4 | VT-M0-14 size control (`earthDiameterDeg = 2.4`, on axis) | 40.3 px, 2.47 deg | 41.0 px, 2.51 deg (bar 39 +- 2 px: at its upper edge; the measure includes the bright limb) | size control still accurate; shipped 4.2 deg stays "not met by design" |

0 console errors in all three pages. The pan is the 1.5 s run of M0-visual-checks, not the VT's 10 s.

## What was built

**Item 1, stars** (`sky/star-field.ts`, `post/look-stages.ts`, `sky/sky-rig.ts`):

- Cause: the stars were drawn in the scene pass and went through the temporal resolve. The opaque prepass does not contain
  the back-face sky dome or the transparent stars, so sky pixels carry velocity 0; while panning, the resolve read star
  history at the wrong place and variance-clipped it.
- **Star layer on TRAA chains.** The chain renders the star field's own scene in a separate output-resolution pass AFTER
  the resolve and adds it where the prepass depth is the far plane (chain now `scene > prepass > gtao > traa > stars >
  grade > bloom`). The resolve jitters the camera for every pass of the frame; the star vertex stage cancels that from
  `camera.view` at draw time (unit-tested against three's `setViewOffset`). SMAA / FXAA chains (Low, Medium: the floor
  device) keep the stars in the scene pass: no extra pass, no extra cost there.
- **Clip-space star quads**: built from the camera matrices in the vertex stage (no CPU billboard axes, no per-frame
  allocation), so a star is the same round disk anywhere in the frame and follows the camera of the render call that draws it.
- **Sub-pixel peak compensation**: half of the peak a Gaussian loses when its centre falls between pixels is given back
  per star in the vertex stage; sigma is 0.66 x radius (0.79 to 1.32 px; was 0.55 x). This is what moved Medium from 72 %
  to 100 % of stars within 10 %.
- The stars hide behind the Earth's disk analytically (needed in layer mode, where the Earth quad cannot cover them).
- Knob `?stars=layer|scene` for A/B.

**Item 4, Earth** (`sky/earth.ts`): the sphere mesh is replaced by a quad expanded in clip space around the projected
centre: a circle with the pixel radius the angular diameter has on the optical axis, anywhere in the frame. The sphere
normal is rebuilt per pixel in a world-fixed frame, so continents and the phase do not slide when the camera turns. The
limb is an analytic one-pixel coverage ramp; the halo uses the same expansion and takes its sun side from the view matrix
in the shader. Sampled textures: 0 added (stars, Earth and halo sample none; the layer composite reads 2 pass textures).

## Evidence

- Item 1 High: `docs/visual-reviews/M0/checks/r2/stars/r2-stars-layer-high-webgpu.json`,
  `r2-s06-pan-{first,last}-layer-high-webgpu.png`, `r2-star-{,moving-}6x-layer-high-webgpu.png`. Driver
  `checks/driver/r2-stars.mjs` (the star block of `sky.mjs` plus a still phase and `--extra`). Looked at: round stars, none
  drawn over the hab, mast or Earth.
- Item 1 Medium and item 4: `checks/r2/sky/sky-earth+stars-medium-webgpu.json`, `s01-dawn-a-medium-webgpu.png`,
  `vt14-earth-{corner,centre}-shipped-4.2deg-3x-medium-webgpu.png` (compare with the egg in
  `checks/sky/vt14-earth-corner-shipped-4.2deg-3x-medium-webgpu.png`), `vt13-*-medium-webgpu.png`. Driver `sky.mjs`
  unchanged.
- File state: sky / post as on disk at 10:36; the Earth run was taken after a server restart on the final files.
  **Both captures also contain the 10:14 to 10:17 edits listed below and whatever part B had on disk at that moment**
  (shadow kernel, seated rocks); they do not affect the star or Earth numbers.
- Checks (10:42): `tsc -p apps/client --noEmit` clean; `eslint src/visuals src/render` clean;
  `vitest run src/visuals src/render src/app` 238 tests pass (new: `sky/star-field.test.ts` 6, `sky/earth.test.ts` 5,
  `post/look-stages.test.ts` 4); `prettier --check` clean on sky, post, `look-knobs.ts`, `module.ts`.

## Edits outside sky / post (made 10:14 to 10:17, before the scope was narrowed; not touched since)

| File | Change | Needed by |
| --- | --- | --- |
| `visuals/module.ts` | 5 lines in `applyQuality`: passes `sky.stars.layerScene` to `createLookStages`, calls `sky.setStarsLayer` | **item 1** |
| `visuals/look-knobs.ts` | `stars=layer|scene`; also `shadowfilter=pcf3|pcf5`, `shadowfilter0=` | **item 1** (first knob), item 2 |
| `lighting/shadow-filter.ts`, `sun-rig.ts`, `key-direction.ts`, `materials/regolith-*.ts`, `lookdev/props.ts`, `perf-pass.test.ts` | first versions of items 2, 3 and 5 | part B, which found them and owns them now (`M0-look-polish-r2b.md`) |

`lookdev/props.ts` fails `prettier --check` (one long line from my 10:16 edit). Not fixed by me: part B's file.

## Blockers / requests

- **rendering-engineer (`render/bench/look-visuals.ts`, optional):** the bench still calls `createLookStages` with four
  arguments, so its stars stay in the scene pass under TRAA (old behaviour, still correct). To get the layer there: pass
  `{ stars: this.sky.stars.layerScene }` as the fifth argument and call `this.sky.setStarsLayer(this.stages.starsLayer)`.
- **rendering-pipeline section 5.2 "Known look defects" row (owner of that doc):** the egg-shaped Earth and the TRAA star
  dimming entries can be dropped once this is reviewed.
- No blocker.

## NOT RUN

- VT-M0-13 at the VT's full 10 s; webgl2; Ultra; Low with a render scale below 1 (stars are sized in render pixels there).
- Frame cost of the star layer on High (one more output-resolution pass and two fetches in the composite): not timed.
- `stars=scene` on a TRAA chain with the new shader (the "before" row is the recorded M0-visual-checks number).
- Star occlusion exactly at a terrain silhouette under jitter (the mask is the jittered prepass depth): looked at only.
- Earth near the corner on High / TRAA and on webgl2; whole-disk roundness as a number (the driver measures the lit region).
- Device loss / renderer recreation with the star layer. `pnpm verify`.

## Diagnosis notes kept for part B (items 2, 3, 5; from source reading and offline maths, no captures)

- **Stair steps:** `tent4` puts 4 one-texel boxes at +-0.5 x radius; at the Medium radius of 2 they are 2 texels apart, a
  1-texel hole in the kernel: ramp / flat 50 % plateau / ramp.
- **Black patches:** the terminator of the stand-in ground's own detail normal (slopes of 10 to 20 degrees against a 4 or
  1 degree sun: N.L <= 0, only the fill is left). Not AO, not the horizon term.
- **Boulder gap:** ray casting the S05 rock (seed 7, radius 0.5, no renderer): its underside vertices sit -0.4 to +5.8 cm
  above the ground; on the driver's scan line the ground past the silhouette is truly sunlit for 31.7 cm at 1 degree and
  0 cm at 4, 15, 60. An idealised shadow-map emulation gives 40 to 46 % shadow strength at the silhouette for the floating
  rock against 76 % once seated, but does NOT reproduce the measured 3.5 cm (0.4 cm emulated): a mechanism with supporting
  numbers, not a closed proof. Scripts were in the session scratchpad only.

## Files

Edited: `apps/client/src/visuals/sky/{star-field.ts, earth.ts, sky-rig.ts}`, `visuals/post/look-stages.ts`.
New: `visuals/sky/{star-field.test.ts, earth.test.ts}`, `visuals/post/look-stages.test.ts`,
`docs/visual-reviews/M0/checks/driver/r2-stars.mjs`, `docs/visual-reviews/M0/checks/r2/{stars,sky}/**`.
Outside the narrowed scope (see table): `visuals/module.ts`, `visuals/look-knobs.ts` and the part B files.

Next: visual-qa review of the two items; High frame cost of the star layer and the 10 s pan on better hardware.

Commit suggestion: `fix(client): stars survive TRAA as a post-resolve layer; Earth is a round screen-space disk (M0 look-polish r2)`

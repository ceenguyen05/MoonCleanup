# M0 client small-hooks batch

Task M0-small-hooks-client / status: **in-review** / 2026-11-13 / rendering-engineer, Sonnet 5.5. Floor device (UHD 620), headed
Chrome, capture Vite config on port 5196. No git, no installs.

## Done

1. **Low default AA = FXAA.** `visuals/look-knobs.ts` `effectiveAa`: explicit `?aa=` / `?traa=` wins; otherwise `preset === "low"`
   with table value `smaa` gives `fxaa`. The `shared` preset table is unchanged (its schema has no `fxaa`; contracts file not
   mine). Medium SMAA, High / Ultra TRAA unchanged. Test added in `look-knobs.test.ts` (all four presets, overrides,
   `applyLookKnobs` keeps the preset id).
2. **Bench star layer.** `render/bench/look-visuals.ts`: `createLookStages(..., { stars: this.sky.stars.layerScene })`, then
   `this.sky.setStarsLayer(this.stages.starsLayer)`; the ignored elevation arg of the `rig.update(...)` call (SunRig) is dropped.
3. **GPU frame time to dynres.** `debug/module.ts`: after each timestamp resolve it calls
   `renderer.reportGpuFrameMs(render.timestamp + compute.timestamp)` (only when the render timestamp is > 0). Test added in
   `debug/module.test.ts` (reports 13.5 for 11.5 + 2). WebGPU timestamp-query only; WebGL2 still reports none; the debug module is
   dev / `?perf=1` only, so production still steers on the frame interval (see Next).
4. **Stale test title** in `visuals/perf-pass.test.ts` fixed.
5. **Docs.** `rendering-pipeline.md`: section 5.2 Filtering row (pcf3 on every Low / Medium cascade, 2.2 texels, tent4 capped at
   radius 1, +0.6 ms p50), "Known look defects" row rewritten (fixed: black patches, stair steps, boulder gap, round Earth disk,
   TRAA star dimming; open: VT-M0-14 by design, VT-M0-15 in pixels, 0.5 b* margin, glints in shadows, ivory clipping, near-black
   unlit slopes, S06 21.9 fps on Low; not run: High / Ultra for pcf3 and contact, WebGL2 cost, Tier A / B), star post-AA layer
   (section 6 row), Earth disk (geometry row), FXAA on Low (pass table, section 8.1 step 9, section 14 AA row), PCF width row of
   section 14. `visual-target.md` VT-M0-15: ratio judged in screen pixels (owner decision), metres 2.86 / 0.58 recorded as
   informational. `render/README.md`: GPU signal now wired, FXAA / bench star layer noted.

## Evidence

- `tsc -p apps/client --noEmit` clean; `vitest run` in `apps/client`: **277 tests pass** (275 + 2 new); `eslint` clean on
  `src/render`, `src/debug`, edited visuals files; `prettier --check` clean on every edited `.ts` file. Markdown is excluded by
  `.prettierignore` (`**/*.md`), so the doc edits were not formatted.
- Bench smoke (`?scene=bench&capture=1`, 1280x720, 8 + 2 stepped frames, 0 console errors in all four):
  low webgpu passes `scene, grade, bloom, fxaa` (350 draws); medium `... smaa` (414); high `scene, prepass, gtao, traa, stars,
  grade, bloom` (546; the star layer is now in the bench chain); low webgl2 `... fxaa` (195). Captures and driver:
  `docs/visual-reviews/M0/checks/small-hooks/bench-r2-{low,medium,high,low-webgl2}.png`, `bench-smoke-r2.mjs`. Looked at Low and
  High: round stars, Earth disk, no artefacts.
- **Not measured:** the FXAA frame-cost win and edge quality against SMAA on Low (no A/B run; only the pass list and a visual
  check), the live dynres reaction to GPU reports, the star layer on the bench under motion.

## Next / requests

- Lead: GPU reports reach dynres only where the debug module is registered; if the game should steer on GPU time in
  production (Cee's deployed build), the composition root must register it (or a slim GPU-timing reporter). Not changed.
- If the `shared` table should say `fxaa` for Low, contracts-architect must extend the `post.aa` enum; today the client derives it.

Files: `apps/client/src/visuals/{look-knobs,look-knobs.test,perf-pass.test}.ts`, `apps/client/src/render/{README.md,bench/look-visuals.ts}`,
`apps/client/src/debug/{module,module.test}.ts`, `docs/architecture/rendering-pipeline.md`, `docs/design/visual-target.md`.

Commit suggestion: `feat(client): FXAA default on Low, bench star layer, GPU frame time to dynres, doc amendments (M0 small hooks)`

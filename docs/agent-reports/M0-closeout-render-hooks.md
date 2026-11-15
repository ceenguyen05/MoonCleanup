# M0 close-out: render / visuals small hooks (STATUS list B1-B5 + VT-M0-12 camera)

Task: M0 close-out list B (1)-(5) and the `camera` hook for VT-M0-12 / status: in-review / 2026-11-14 /
rendering-engineer (Fable 5.2). Paths this task: `apps/client/src/render/**`, `visuals/**`, `debug/**`. No git.

## Done

Five of the six items were **already on disk** when this run started (an earlier worker did them). I checked each
against the code, added the missing tests, and wrote only item 6 plus one leftover cleanup.

| # | Item | State found | This run |
|---|------|-------------|----------|
| 1 | Low defaults to FXAA; Medium SMAA; High/Ultra TRAA; `?aa=` wins | Already done: `effectiveAa` in `visuals/look-knobs.ts`, used by `createLookStages` (game `VisualsModule` and bench `VisualsLook`) | Tests that the built display stage is `fxaa` on Low, `smaa` on Medium, none on High/Ultra, and that `?aa=` overrides |
| 2 | Bench star-layer hookup | Already done: `look-visuals.ts:86-94` | Test: star mesh leaves the sky group on High/Ultra, returns on Medium/Low; `?stars=scene` |
| 3 | Stale elevation arg | Call site already fixed | Removed the dead `elevationDeg?` parameter from `SunRig.update` (its comment asked for this) |
| 4 | `reportGpuFrameMs` from `debug/module.ts` | Already done through the shared `GpuTimingPump` (`debug/module.ts:232-236`); test exists | No change |
| 5 | `?debug=cascades` kept | Present (`look-knobs.ts:156`, `sun-rig.ts:252`), was untested past the parser | Tests on the rig for all presets, `cascades=2`, `cascades=0` |
| 6 | Read-only `camera` in `__mcLook.info()` | Missing | Added `LookInfo.camera` |

`info().camera` shape (`LookCameraInfo`, exported from the visuals barrel): `position [x,y,z]` (world, m),
`quaternion [x,y,z,w]`, `forward [x,y,z]` (unit view direction), `vfovDeg` (zoom applied), `aspect`, `nearM`, `farM`.
It is a copy of plain numbers built per call; writing into it does not move the camera.

Frame cost: no per-frame code was added. `info()` runs only when a tool calls it; item 3 removed a no-op statement.
This is from reading the diff, **not a measurement**.

## Files

- `apps/client/src/visuals/lookdev/hooks.ts` (camera snapshot), `hooks.test.ts` (new)
- `apps/client/src/visuals/index.ts` (type export)
- `apps/client/src/visuals/lighting/sun-rig.ts` (dead parameter removed), `sun-rig.test.ts`
- `apps/client/src/visuals/post/look-stages.test.ts`, `apps/client/src/render/bench/bench-look.test.ts`

## Evidence (Node v26.13.1, working tree of 2026-11-14)

- `pnpm exec tsc -p tsconfig.json --noEmit` in `apps/client`: exit 0.
- `pnpm exec vitest run` in `apps/client`: 38 files, 376 tests passed, exit 0.
- `eslint` and `prettier --check` on the 7 changed files: clean.

## NOT RUN

- No browser, GPU, screenshot or perf-HUD run. Low = FXAA is proven at graph-construction level only (pass names),
  not by a captured frame or a frame-time number on the UHD 620.
- `pnpm verify`, whole-repo lint, Playwright.
- The harness sidecar was not updated: `tools/screenshots/src/sidecar.ts` still writes `camera.pose: null`. That path
  is outside this task.

## Next / notes for the lead

1. Harness owner: fill `sidecarExtras` from `look.camera` and drop the "not exposed" note (`sidecar.ts:56-61`).
2. Same file: `parseAa` reads `aa=` from the knob string, which is `default` on Low, so the sidecar's `aa` is null
   there. The real AA is in `postPasses` (`fxaa`).
3. `?look=v0` (old bench chain, `render/bench/post-stages.ts`) still runs SMAA on Low. Left as is: it is the baseline
   older numbers were recorded with. Say so if it should follow.
4. FXAA on Low is derived in the client; `QUALITY_PRESETS.low.post.aa` in `shared` is still `smaa` (schema has no
   `fxaa`). `app/launch-policy.ts` has no AA logic and needs none. The rendering-pipeline doc amendment (list E) is open.
5. Existing knob wrinkle, not changed: the shadow kernel choice in `sun-rig.ts` reads `settings.post.aa`, not
   `effectiveAa`, so `?aa=fxaa|none` on High keeps the dithered Vogel disk with no temporal resolve. A/B knob path only.

Blockers: none.

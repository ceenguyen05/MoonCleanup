# M0 screenshot harness gaps (VT-M0-12), qa-test-engineer, 2026-11-13

Scope: `tools/screenshots/**` only. No client file edited (see camera pose below). No git.

## Done

| Gap | Fix | Evidence |
| --- | --- | --- |
| 1 whole-frame measures | `src/measure/rois.ts`: patch ROIs (luma, b*, Sobel, stars) and line ROIs (profile + steepest-edge 10-90 px). Every capture gets 6 frame regions plus the scene's own probes: S02 chips and edge lines (`__mcLookdev.probes()`), S01/S05/S06 world probes (`__mcLook.probes()`). Whole-frame edge 10-90 is now null (it was meaningless). `index.md` shows line edges, sun, EV100, serve mode | S02 noon sidecar: chips 130.1/180.3/212.4, grime 119.8, clean 181.9, edgeLeft 6.5 px, edgeRight 4.4 px (matches the reviewer's numbers) |
| 2 sidecar fields | knobs (renderScale, canvasDpr, aa, csm, shadowFilter, post passes), sun el/az, EV100 + keyMode, Earth lit fraction/el/az/diameter, url, serve, treeDirty | `docs/visual-reviews/M0/harness-gaps/*.json` |
| 3 `tod` | Client still ignores `?tod=`, so the harness maps it to each scene's own knobs (S01 `time`, S02 `variant`, S05 `sun`) and checks `__mcLook.info().state.sunElevationDeg` after load. Unsupported scene/tod throws before any page opens | S01 dawn sun 4 deg, EV100 11.5; S01 noon sun 60 deg, EV100 14.3. `S12 dawn` threw `UnsupportedSceneError` as intended |
| 4 HUD name | `S12` resolves to `?scene=hud-test`; `S01a`/`S01b` resolve to `s01` view a/b | `S12-noon-tierB-low-webgpu-1920x1080@1-nohud-floor.png` |
| 5 production build | `--preview [--build]` runs `vite build` + `vite preview` on port 5173+N; `serve.mode` is auto-detected (`/@vite/client`) and recorded | all sidecars `serve.mode = production`, `how = preview-started` |
| P4 | `--path P4 --frames N`: stepped flyover through `__mcLook.setView("fly:<t>")`, one PNG + sidecar per position and `P4-dawn-B-low.pathreport.json` (frame-to-frame ground diff, spike ratio) | 8 keyframes, Low webgpu, production; spike ratio 1.80 (no spike). A proxy only: frames not viewed, no verdict |
| Git Bash `C:\c\` | `src/paths.ts` `normalizeOutPath`: `/c/...`, `/mnt/c/...`, `/cygdrive/x/...` become drive paths; relative paths use `INIT_CWD` | output written under the right folder with a Windows `--out`; unit-tested |

Checks (tools/screenshots): `tsc` 0 errors, `eslint` 0, `vitest` 4 files / 32 tests pass (new `vt12.test.ts`, extended `harness.test.ts` and `capture.test.ts` with a fake client exposing the look hooks), `prettier --write` applied. Servers: the harness stopped its `vite preview` (5182) and browsers; netstat showed no listener after the runs.

## NOT done / unverified

- **Camera pose and vFOV**: no client hook exposes the camera (`LookInfo` has no camera). Sidecar records `camera.pose: null` plus a note. Next step (visuals owner): add a read-only `camera` (position, target, vFOV) to `__mcLook.info()`, then fill `sidecarExtras` in `src/sidecar.ts`. I did not touch `apps/client/src/visuals` (lighting worker owns it).
- **Adaptation multiplier, particles live, dustRingTexelCm, particlePool**: not reported by the client; recorded as null.
- **S01 dusk**: the client's `time=dusk` equals dawn geometry (4 deg, same azimuth). Elevation is checked, E vs W is not.
- **P4 verdict**: stepped keyframes only, not a 30 s real-time run; needs the frames viewed (LOD pop, CSM to horizon handoff).
- **Full matrix** (S01, S02, S03, S05, S06 on Medium/Low, webgl2): not run this session (GPU kept free). Command in the README. Only a Low webgpu sample was captured (S01/S02 dawn+noon, S12, P4).
- ROI definitions for S05/S06 use the scenes' generic world probes only; per-scene VT luma-patch bars (e.g. VT-M0-06 chart limits) are not encoded as pass/fail, the numbers are recorded for the reviewer.
- Build prints "use client" bundler warnings from framer-motion (not mine).
- `C:\c\` strays (including a credentials file under `C:\c\Users\caseyn\.claude-team\`) from the earlier quirk are still there; not touched. Cee or lead should review.

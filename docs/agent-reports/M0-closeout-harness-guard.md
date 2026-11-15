# M0 close-out: screenshot harness guard and VT-12 gaps

qa-test-engineer, 2026-11-14. Scope: `tools/screenshots/**` only. No client, render, STATUS or git edits.

## Status: DONE for the harness; wrap cause NOT reproduced (rendering-engineer item stays open)

## (1) Wrap guard
- `tools/screenshots/src/wrap-guard.ts`: exact row-hash compare, largest k in [16, 34 % of height] where top k rows == bottom k rows and the band has >= 8 distinct rows and >= 25 % distinct (flat sky or blank page cannot trigger).
- Wired into `captureCurrent`: screenshot, then retry the screenshot, then (single-scene captures) reload + re-step, then throw `WrappedFrameError`. Sidecar gets `wrapGuard {result: clean|recovered|failed, attempts[{how, wrapped, bandRows, dpr, readbackMs}], note}`.
- Validated on real files: the reviewer's `checks/final-t06/wrap/S01-noon-...png` is detected (band = 202 rows, exactly the reported 878-1079 vs 0-201); the 16 PNGs in `final/` all pass (no false positive).
- Tests `src/wrap-guard.test.ts` (7): clean frame, reviewer case, flat/flat-sky no trigger, retry then `recovered`, all-wrapped throws, aa derivation. Package: tsc clean, eslint clean, vitest 39/39 (Node 26.13.1).
- Not guarded: `captureSequence` (raw frames, no sidecar) and `capturePath` has no reload retry (re-screenshot only; a reload would lose the view).

## (2) Reproduction attempts (port offset 13, scratch dist, S01 noon tierB medium webgpu, scale floor, step 30, headed Chrome, UHD 620)
| Run | Condition | Result | screenshot readback |
| --- | --- | --- | --- |
| cold 1,2,4,5 | fresh browser per run, first capture, DPR 1, 1920x1080 | clean x4 | 1.0 / 4.4 / 4.3 / 6.8 s |
| cold 3 | same | harness TimeoutError (not a wrap; no PNG; cause not captured, likely ready or screenshot timeout on the busy GPU) | n/a |
| dpr2 | 1280x800 @2 | clean | 7.1 s |
| load | 4 busy-loop node procs during capture | clean | 7.4 s |

0 wraps in 7 completed captures (plus the reviewer's 17 with 1 hit). Not reproduced; conditions known for the one hit: first capture of a run, DPR 1, Medium floor, build 11:22. Observation for rendering-engineer: `page.screenshot` readback takes 1-7 s on this device with a 30-frame stepped scene (variable, grows after the first runs), so the compositor frame can be read mid-update; a wrap is plausible when the readback overlaps a canvas/render-target resize at startup (the viewport resize happens before `goto`, and the canvas resizes again on first layout). Suggest rendering-engineer check that `__mcReady` is not set before the last resize/RT reallocation. With the guard, the next occurrence is auto-detected and its sidecar will say which retry cleared it.

## (3) VT-12 gaps in tools/screenshots
- `aa` null: FIXED, derived from `postPasses` (`smaa`/`fxaa`/`traa`).
- `shadowMapSize`, `dustRingTexelCm`, `particlePool`, `adaptationMultiplier`: the client hooks do not report them, so they cannot be filled by the harness. Now explicit in the sidecar (`knobs.notReported`) instead of silent nulls. Needs `__mcLook.info()` fields from rendering-engineer/lead.
- `typical` not a spec id: it comes from the reviewer's ad-hoc runs (not in the registry); the harness rejects unknown scenes unless `--allow-unverified-tod`. Needs a decision from visual-qa-reviewer (add as spec id or rename file); not changed.
- S05 shadow ROI probes miss the shadows (`slopeShadow` lit): probe positions come from the client `__mcLook.probes()`, not from the harness; needs a client change (VT-16 on Low/webgl2 depends on it).
- Whole-frame `Edge 10-90` meaningless and P4 verdict: reviewer-owned judgement; no harness change.
- Also added `--client-out` so builds go to a scratch dist.

## Cleanup
Port 5186 has no listener (only TIME_WAIT); every harness browser and preview closed; busy-loop helpers self-expired at 90 s. No other Chrome touched. Scratch evidence: `C:\Users\caseyn\AppData\Local\Temp\claude\430d3d07c3d5e4f4\662a92b8-25f6-41a0-b81e-bd8243d1afb8\scratchpad\rep\` and `...\scratchpad\dist`.

Files: `tools/screenshots/src/{wrap-guard.ts,wrap-guard.test.ts,capture.ts,sidecar.ts,serve.ts}`, `tools/screenshots/README.md`.

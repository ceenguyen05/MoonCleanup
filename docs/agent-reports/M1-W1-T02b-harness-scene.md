# M1-W1-T02b Harness shared capture scene + edge metric (qa-test-engineer)

Status: done, in-review. Date 2026-11-14. Node 26.13.1.

## Done
- `prototypes/dust-sim/harness/src/capture-scene.ts`: renderer-neutral spec (1080p DPR1, vFOV 60, reference-sphere ground height 0, Lambert sun/ambient/exposure/albedos, frame schedule 60 fps + 30 settle frames, 9 bookmark poses with sun vectors, reference sweep paths, seed). `captureSceneSpec()` is JSON.
- `src/image-compare.ts`: edge width (10-90 % of opacity/luma profile, sub-pixel), px<->cm, coverage, mean abs diff, Pearson, sweep rasteriser, sweep-vs-dissolve correlation.
- `src/capture-scene.test.ts`: 10 tests on synthetic images; harness total 19/19. tsc and prettier clean. README updated. No edits outside harness/** (+ this report).

## Lead decisions needed
1. Edge bar conflict: WDS section 10 S1 says <= 2 px at 2 m (4.3 mm at 1080p); visual-target section 2.2 says 10-90 % <= 2 cm world (9.3 px at 2 m). The harness gates on WDS 2 px and also reports cm vs 2 cm. T03 model: P1 ring opacity ramp is 20.6 px at 2 m (fails both), presence mask 2.1 px (marginal). Pick the bar, and whether it is measured on opacity (harness default) or mask.
2. Correlation bar for sweep-vs-dissolve is not in the docs; proposed >= 0.9, currently INFO only.
3. Pixel width at 2 m assumes 1080p vFOV 60 (WDS gives none); confirm.

## Next
P1/P2/P3 `capture()` renders the spec; `measureEdgeWidthPx` uses `edgeWidthPx` on the B01-B03 crop around `edgeAnchor`. PNG decode to GrayImage is left to the adapter (no decoder dependency added). GPU captures not run.

---
description: Capture native-resolution screenshots of the milestone scene list and have visual-qa-reviewer compare them against docs/design/visual-target.md.
argument-hint: "[milestone, e.g. M1]"
allowed-tools: Read, Write, Glob, Grep, Agent, SendMessage
---

# /visual-check

Visual gate for milestone `$ARGUMENTS` (default: the current milestone in `docs/STATUS.md`). You are the lead. Never run git.

## Inputs

- `docs/design/visual-target.md` (numbered checklist), `docs/design/art-direction.md`
- The scene list and camera paths in `tools/screenshots/**` (scene list owned by visual-qa-reviewer, harness by qa-test-engineer)
- The milestone file and wave brief "Visual acceptance" lists; tier definitions in `docs/architecture/performance-budgets.md`; naming, storage and review procedure: `docs/design/visual-target.md` §6.6–§6.7 (the single rule); canonical presets: `docs/architecture/rendering-pipeline.md` §14

## Procedure

1. **Check the harness.** If `tools/screenshots` cannot run (missing scenes, broken harness), launch `qa-test-engineer` first with a brief to fix it (owned files: `tools/screenshots/**`, `tests/e2e/**`), unique port offset, then wait.
2. **Launch `visual-qa-reviewer`** (`subagent_type: visual-qa-reviewer`, no isolation) with a brief that names: the milestone, the VT-IDs in scope, the scenes, quality presets and hardware tiers (for example Tier A High, Tier B Medium, Tier C Low on `webgl2`; each at the render-scale floor and ceiling where §6.1 asks for it), a unique port offset N, and the outputs below. It captures PNGs at native resolution (no downscaling, no lossy compression) with the frame-stepped deterministic mode, views every image, and judges each VT item.
3. **UI crispness is mandatory:** capture the UI at devicePixelRatio 1, 1.5 and 2 (and 150% zoom). Blurry or soft UI text/icons at any DPR is a FAIL, including when dynamic resolution has lowered the render scale.
4. **Measure step.** Run `tools/screenshots/measure` over the capture set (luma patches, 10-90 % edge widths, Sobel sharpness, b*, disk size, star count, temporal variance). It writes the numbers with pixel coordinates into each sidecar JSON and into the generated `index.md`; the reviewer checks them against the VT bars and spot-checks three measurements by opening the PNG.
5. **Comparator (CMP items).** Part 1 is scored by the reviewer from the measurements on our frame only. **Part 2 is scored by Cee**, who views each linked reference in a browser next to our PNG and records better / equal / worse. **Never download, store, cache or screenshot reference images**, in the repo, the archive or a scratch folder: links only. CMP captures are internal, never committed (visual-target §6.6).
6. **Regression compare** against the previous milestone's PNGs with the same scene names.
7. Wait for the notification; read the review file; confirm every image cited exists.

## Output

- Folder: `docs/visual-reviews/<milestone>/<wave|final>/`.
- PNG name (visual-target §6.6): `<scene>[a|b]-<tod>-tier<A|B|C>-<low|medium|high|ultra>-<webgpu|webgpu-compat|webgl2>-<W>x<H>@<dpr>-<hud|nohud|dbg>[-floor|-ceil][-<variant>].png`, for example `S02-noon-tierA-high-webgpu-1920x1080@1-nohud-floor.png`, each with a sidecar `<same-name>.json`.
- Index: the **generated** `docs/visual-reviews/<milestone>/<wave|final>/index.md` (VT ID, verdict, files, measurements, issue links; replaces the old `REVIEW.md`); verdict file: `docs/agent-reports/<taskID or M#-W#>-review-visual-qa-reviewer.md`.

## Pass / fail criteria

- PASS: every VT item the milestone requires is PASS (or PARTIAL with a lead-accepted, logged OPEN_QUESTION), each backed by a PNG path; UI crisp at all tested DPRs; no regression against the previous milestone.
- FAIL: any required item FAIL, missing evidence, banding/popping/seams/aliasing noted as blocking, unreadable plot-state colors (Grimy umber / Opened cyan / Polished ivory), or blurry UI. Return findings to the owning roles (render, visuals, terrain, animation, ui) via the normal fix cycle.

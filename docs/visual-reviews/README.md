# docs/visual-reviews

**Owner role:** `visual-qa-reviewer`

## Purpose

Milestone screenshot reviews for the visual bar ("heaviest weight" quality target). Each milestone gets a subfolder with the
captured PNGs and a short review document that compares them against `docs/design/visual-target.md`.

## Layout

```
docs/visual-reviews/
  <milestone>/                  e.g. m0, m1
    <scene>-<tier>-<n>.png      native resolution, no scaling or compression artifacts (PNG)
    REVIEW.md                   scene list, quality tier and hardware used, findings, verdict
```

## Rules

- PNG at **native resolution**; do not downscale. Keep the set small (approved milestone shots only); scratch output stays in the
  git-ignored `tools/screenshots/output/` and `diff/`.
- Record machine, GPU, browser, quality preset and `VITE_BUILD_VERSION` in each `REVIEW.md`: rendering varies across hardware,
  so images are evidence for a human reviewer, not cross-machine baselines.
- Captures come from `tools/screenshots`. Reviews use the `visual_quality` issue template for follow-ups.

Placeholder: empty until the first milestone review.

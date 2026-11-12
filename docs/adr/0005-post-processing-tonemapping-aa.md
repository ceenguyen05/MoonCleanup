# ADR-0005: Post-processing, tone mapping, anti-aliasing and dynamic resolution

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, technical-artist (owner of `visuals/`)
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Post / look row)

## Context

The moon is a high-contrast scene: a hard sun, almost no atmosphere, deep shadows, bright regolith and a helmet lamp. Tone mapping decides whether shadow detail and highlights survive. Temporal AA suppresses shimmer on dust and fine terrain normals but is costly on integrated GPUs and ghosts on fast vehicles. Integrated graphics have ~0.30-0.41x the throughput of the discrete reference laptop, so resolution must adapt.

## Options considered

1. **AgX default, ACES selectable (Neutral also available).** Pro: AgX handles bright highlights without hue skew; ACES gives the familiar contrasty look. Con: two looks to grade and test.
2. **ACES only.** Pro: one look. Con: saturated hue shifts on lamp/sun highlights.
3. **TRAA on High/Ultra, SMAA on Low/Medium.** Pro: best stability where GPU headroom exists; SMAA is cheap and ghost-free. Con: two AA paths to tune.
4. **MSAA only.** Pro: simple. Con: does not fix shader/specular aliasing, memory heavy at HDR.
5. **Fixed resolution.** Pro: predictable. Con: misses 30/60 FPS targets on Tier B.

## Decision

- Three node post pipeline (`RenderPipeline`), HDR half-float buffers, then bloom, GTAO, tone map, AA, grading.
- **Tone mapping: AgX by default**, ACES selectable in settings and for A/B screenshots; Neutral kept for UI-adjacent captures.
- **AA by preset:** TRAA on High and Ultra, SMAA on Low and Medium. TRAA and other temporal effects are disabled in screenshot/capture mode.
- **Dynamic resolution** via per-pass `setResolutionScale`, driven by a frame-time governor in `render/`. Ranges (from the feasibility budgets): Tier B 0.5-0.75 with DPR capped at 1.0, Tier A 0.75-1.0 with DPR capped at 1.5, Ultra 0.67-1.0. UI stays at native resolution.
- GTAO runs at half resolution on Low/Medium; bloom threshold tuned for the sun disk and lamp only.
- The ban-list forbids `EffectComposer` and the old `PostProcessing` class (ADR-0003).

## Consequences

**Positive**
- A defined look per tier; the governor protects frame time without per-scene hand tuning.

**Negative / risks**
- TRAA ghosting on fast vehicles and jetpack motion needs velocity-buffer care; fallback is to SMAA.
- Look-affecting defaults change between three releases (GTAO darkness r185/r186, PMREM r181/r187), so screenshots must be re-baselined at every upgrade.
- Resolution scaling can make dust-edge crispness vary; the detail ring (ADR-0009) is rendered at fixed texel density, not scaled resolution.

## Revisit trigger

- TRAA ghosting is rated unacceptable in two consecutive visual reviews: ship SMAA everywhere.
- AgX is judged too flat in visual-QA against the target frames: make ACES the default.
- Tier B misses 30 FPS at scale 0.5.

## Evidence

- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (executive summary: AgX/ACES/Neutral, TRAA/SMAA, `setResolutionScale`, TAAU/FSR1 examples; breaking-change log)
- [browser-feasibility.md](../research/browser-feasibility.md) (section 3.2 tiers, recommended budgets, capture-mode notes)
- [visual-analysis.md](../research/visual-analysis.md)

# ADR-0027: 3D art production path

- **Status:** Accepted (2026-11-12) as the default path (decision D5). The owner decisions inside it (Q15, Q23) stay open and can only widen the path, not remove the default.
- **Deciders:** lead/orchestrator, technical-artist (after the technical-art-director planning review, finding F4)
- **Canonical source:** [art-direction.md §13](../design/art-direction.md) (asset production plan); [OPEN_QUESTIONS Q23](../OPEN_QUESTIONS.md); [ADR-0013](0013-asset-pipeline-gltf-ktx2.md) (delivery format)

## Context

The look depends on the custodian, hand tools, vehicles, robots and outpost hardware more than on any shader, and no agent role has a DCC tool by default (technical-artist works through scripts). Primitive-assembled capsules and boxes are the likeliest route to a cheap-looking browser game, so the plan needs a named producer, bar and schedule for every asset class before M1-S9 (M1-W3-T07). Licence hygiene is fixed by [ADR-0017](0017-asset-storage-no-lfs.md) and [asset-and-data-licensing.md](../research/asset-and-data-licensing.md): original, CC0 or CC-BY with a ledger row only.

## Options considered

1. **Original work by agents, scripted and reproducible (Blender headless if installed, otherwise a Node path in `tools/asset-pipeline`), plus a shared kitbash library.** Pro: no cost, licence-clean, deterministic rebuilds, fits the agent workflow. Con: needs real craft in scripts; hero organic shapes are harder than hard-surface; headless Blender is an install.
2. **CC0 kits and libraries (Poly Haven, ambientCG, Kenney).** Pro: free, fast, good materials and greebles. Con: never distinctive enough for a hero silhouette; Kenney is placeholder quality; manual download and ledger row per file.
3. **Commissioned art (custodian base mesh and helmet first, Behemoth second).** Pro: highest hero quality. Con: costs money; owner funding and work-for-hire or exclusive commercial licence required.
4. **AI-generated assets.** Pro: speed. Con: undisclosed AI art is punished by players (reception research); commercial-rights terms vary; allowed only per [OPEN_QUESTIONS Q15](../OPEN_QUESTIONS.md).

## Decision

- **Default path = option 1**, with option 2 for base materials, texture inputs and kitbash greebles (never unmodified for a hero silhouette). Per-class producer, budget, milestone and the measurable "final" bar are in [art-direction §13.2-§13.3](../design/art-direction.md); placeholder policy in §13.4 (final proportions, pivots, material slots and shader even for blockouts; tagged `placeholder: true`; none in a `v1.0.0` build or a comparator shot).
- **Headless Blender is an owner decision ([Q23](../OPEN_QUESTIONS.md)):** Cee installs it or not. Without it the Node path (bevelled primitives, swept tubes, baked AO, glTF-Transform, KTX2) is the production path and the proportions bar still applies. M0 proves the pipeline on one rock and one outpost module (art-direction §13.5).
- **Commission (option 3)** only if Cee funds it; the plan does not depend on it. Terms logged in `docs/ASSET_LICENSES.md`.
- **AI-generated (option 4):** nothing in the current plan; permitted only after Q15 closes with commercial-rights terms, lead approval per asset, disclosure in Credits and the ledger.
- Mixamo, Quaternius and CMU mocap stay prototype-only in private storage.
- Delivery format and budgets stay as ADR-0013 and art-direction §9.

## Consequences

**Positive**
- Every asset class has an owner and a bar before the first production task; no spend or install is required to start.
- Scripted builds make LOD, trim-sheet and colour-slot changes reproducible.

**Negative / risks**
- Hero quality depends on the technical-artist scripts; turntable review (VT-M1-35) may force a commission or a CC0 base mesh later.
- Without Blender, rigging and skinning for the custodian is the hardest step; animation-engineer owns the fallback.

## Revisit trigger

The M1-W3-T07 blockout or M1-W4-T07 production custodian fails the art-direction §13.3 bar on turntable review (VT-M1-35), or Cee decides Q23 (Blender install, commission) or Q15 (AI assets).

## Evidence

- [art-direction.md §13](../design/art-direction.md), [visual-target.md](../design/visual-target.md) (VT-M1-18, VT-M1-35)
- [planning-fix-art.md](../agent-reports/planning-fix-art.md) (F4), [planning-fix-handoff.md](../agent-reports/planning-fix-handoff.md) (D5)
- [asset-and-data-licensing.md](../research/asset-and-data-licensing.md)

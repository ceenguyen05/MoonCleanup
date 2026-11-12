# ADR-0006: Shadows - cascaded shadow maps (CSMShadowNode)

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, technical-artist
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Shadows row)

## Context

The lunar sun is a single, hard directional light with no atmospheric fill. Shadows carry most of the scene's depth: terrain relief, characters, vehicles and robots must ground convincingly from 1.7 m eye height out to hundreds of meters. A single shadow map cannot cover that range. Shadow cost is a major GPU line item on integrated graphics (budget: 4 ms for 2 cascades on Tier B, 2.5 ms for 3-4 cascades on Tier A).

## Options considered

1. **`CSMShadowNode`, 3 cascades (Low 2, Ultra 4), filtered PCF.** Pro: first-party in three with WebGPURenderer; cascade count scales per preset. Con: cascade seams and shimmer need tuning; PCF only.
2. **Single large shadow map.** Pro: trivial. Con: either blurry nearby or no far coverage.
3. **Contact-hardening (PCSS-style) shadows as default.** Pro: more realistic penumbra. Con: moon has a near-point sun, so little penumbra; expensive.
4. **Baked/static shadows only.** Pro: free at runtime. Con: characters, vehicles and moving sun cannot be baked.
5. **Ray-traced / SSGI shadowing.** Pro: quality. Con: not viable in the Tier B budget.

## Decision

- Use three's **`CSMShadowNode`** with **3 cascades** by default; **Low 2, Ultra 4**.
- **Filtered PCF** only. `PCFSoftShadowMap` was removed in r186, so the filtered mode of r187 is what we pin to.
- **Contact-hardening stays off by default** (selectable on Ultra only).
- Map sizes per preset (from the feasibility budget): Tier B 2 x 1024-2048, Tier A 4 x 2048 at most, Ultra up to 4 x 4096.
- Cascade splits are tuned for ground-level play and re-fitted for vehicle and orbit camera modes; shadow bias is a visuals-owned constant per preset.
- Shadows are not cast by dust tiles or particles; terrain self-shadowing comes from the same cascades.

## Consequences

**Positive**
- Clear quality ladder through cascade count and map size; one mechanism for everything.

**Negative / risks**
- Cascade shimmer when the sun or camera moves; mitigate with texel snapping.
- Shadow bias and filtering changed between recent three releases; re-tune at every upgrade.
- Shadow pass is likely the first thing to cut on Tier B (fall back to 2 cascades / 1024).

## Revisit trigger

- Shadow pass exceeds its budget (4 ms Tier B / 2.5 ms Tier A) after tuning.
- A three release changes or removes `CSMShadowNode`.
- Visual review finds the near-field too soft with PCF: evaluate contact-hardening on High.

## Evidence

- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (SunLight, CSMShadowNode; r186 `PCFSoftShadowMap` removal)
- [browser-feasibility.md](../research/browser-feasibility.md) (recommended budgets: shadow maps and GPU ms)
- [visual-analysis.md](../research/visual-analysis.md)

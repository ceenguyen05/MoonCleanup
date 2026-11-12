# Architecture Decision Records (ADRs)

ADRs record the decisions behind [`docs/architecture/tech-stack.md`](../architecture/tech-stack.md), which is canonical: every ADR here matches it. Where research evidence disagrees, the ADR states the disagreement under **Consequences**. ADRs are **append-only**: to change a decision, add a new ADR that supersedes the old one and update the old ADR's status line. A major bump of an engine-level package or a new core architecture/toolchain choice needs an ADR; routine project-local dependencies do not ([ADR-0028](0028-dependency-policy.md)).

Evidence lives in [`docs/research/`](../research/) (see each ADR's Evidence section). Module ownership is in [`docs/architecture/module-boundaries.md`](../architecture/module-boundaries.md).

## Index

| # | Title | Status | Date |
| --- | --- | --- | --- |
| [0001](0001-typescript-monorepo-tooling.md) | TypeScript monorepo and tooling baseline | Accepted | 2026-11-12 |
| [0002](0002-hosting-topology-free-tier.md) | Free-tier hosting topology ($0 forever) | Accepted (amended 2026-11-12; branch/staging topology superseded by 0029) | 2026-11-12 |
| [0003](0003-rendering-engine-threejs-webgpu.md) | Rendering engine: Three.js WebGPURenderer + TSL | Accepted (follow-up note: Tier B ladder, spike ADR) | 2026-11-12 |
| [0004](0004-webgpu-first-webgl2-fallback.md) | WebGPU-first with a real WebGL2 fallback (feature tiers) | Accepted | 2026-11-12 |
| [0005](0005-post-processing-tonemapping-aa.md) | Post-processing, tone mapping, anti-aliasing and dynamic resolution | Accepted | 2026-11-12 |
| [0006](0006-shadows-csm.md) | Shadows: cascaded shadow maps (CSMShadowNode) | Accepted | 2026-11-12 |
| [0007](0007-world-grid-icosahedral-plots.md) | World grid: icosahedral hex plots (Goldberg GP(m,0)) | Accepted | 2026-11-12 |
| [0008](0008-terrain-cdlod-lola.md) | Terrain: CDLOD on a spherified cube with LOLA height cube map | Accepted | 2026-11-12 |
| [0009](0009-dust-simulation-and-sync.md) | Dust simulation and sync: strokes, tile atlas, coarse ledger | Accepted (amended 2026-11-12) | 2026-11-12 |
| [0010](0010-movement-kinematic-sim-no-server-physics.md) | Movement and physics: shared kinematic sim, no server physics | Accepted | 2026-11-12 |
| [0011](0011-animation-pipeline.md) | Animation pipeline | Accepted | 2026-11-12 |
| [0012](0012-ui-layer-react-motion-dom.md) | UI layer: React 19 + Motion over a DOM overlay | Accepted | 2026-11-12 |
| [0013](0013-asset-pipeline-gltf-ktx2.md) | Asset pipeline: glTF 2.0, meshopt and KTX2 | Accepted | 2026-11-12 |
| [0014](0014-netcode-framework-colyseus.md) | Netcode framework: Colyseus 0.18 on uWebSockets.js | Accepted | 2026-11-12 |
| [0015](0015-netcode-model-authority-rates.md) | Netcode model: authority, tick rates, prediction, interest management | Superseded by 0025 | 2026-11-12 |
| [0016](0016-data-layer-drizzle-postgres.md) | Data layer: Drizzle ORM on Aiven PostgreSQL Free | Accepted (amended 2026-11-12) | 2026-11-12 |
| [0017](0017-asset-storage-no-lfs.md) | Asset storage: no Git LFS by default | Accepted | 2026-11-12 |
| [0018](0018-auth-guest-first.md) | Authentication: guest-first, opaque refresh token + short JWT | Accepted (amended 2026-11-12) | 2026-11-12 |
| [0019](0019-testing-strategy.md) | Testing strategy | Accepted | 2026-11-12 |
| [0020](0020-observability-free-tier.md) | Observability on free tiers | Accepted | 2026-11-12 |
| [0021](0021-platform-scope-desktop-first.md) | Platform scope: desktop first, mobile post-launch | Accepted | 2026-11-12 |
| [0022](0022-sim-architecture-event-bus.md) | Simulation architecture: plain TypeScript, typed stores, event bus | Accepted | 2026-11-12 |
| [0023](0023-protocol-encoding.md) | Protocol encoding: Schema for entities, bit-packed codec for bulk data | Accepted | 2026-11-12 |
| [0024](0024-validation-zod.md) | Validation and config schemas: zod 4 | Accepted | 2026-11-12 |
| [0025](0025-netcode-model-revision.md) | Netcode model revision: bytes frames, horizon-aware interest, one room per Contract | Accepted (supersedes 0015) | 2026-11-12 |
| [0026](0026-dust-ledger-absolute-removal.md) | Dust ledger: absolute coverage-weighted removal, server-sequenced ops | Accepted (amends 0009) | 2026-11-12 |
| [0027](0027-3d-art-production-path.md) | 3D art production path | Accepted (default path; Q23 resolved: Blender installed; Q15 open) | 2026-11-12 |
| [0028](0028-dependency-policy.md) | Dependency policy | Accepted | 2026-11-12 |
| [0029](0029-single-deploy-branch-main.md) | Single deploy branch (`main` only) and one Render service | Accepted (supersedes the branch/staging topology of 0002) | 2026-11-12 |
| [0030](0030-reference-first-design.md) | Reference-first recreation and flexible display naming | Accepted | 2026-11-12 |

## Template

Copy this into `docs/adr/NNNN-short-title.md` (next free number, kebab-case). Keep it to about 40-80 lines.

```markdown
# ADR-NNNN: Title

- **Status:** Proposed | Accepted | Superseded by ADR-XXXX (YYYY-MM-DD)
- **Deciders:** who decided
- **Canonical source:** link to the tech-stack.md section this must match

## Context
Forces, constraints and facts that make a decision necessary (link numbers to evidence).

## Options considered
1. **Option A.** Pro: ... Con: ...
2. **Option B.** Pro: ... Con: ...

## Decision
What we will do, stated precisely enough to implement and to lint/test.

## Consequences
**Positive**
- ...

**Negative / risks**
- ... (include any place where research evidence disagrees with this decision)

## Revisit trigger
The measurable condition that reopens this decision.

## Evidence
- [report.md](../research/...) (section or finding)
```

## Current product-direction amendment

[0030 — Reference-first recreation and flexible display naming](0030-reference-first-design.md) is accepted by owner instruction.
It supersedes older design naming/style/custom-gate rules, not technical architecture or model assignments.

## Process

1. Draft the ADR from the template; link evidence; set status `Proposed`.
2. The lead reviews it against `tech-stack.md` and accepts it when the affected architecture change is needed.
3. Update `tech-stack.md`, `module-boundaries.md` and this index in the same change.
4. Never edit an accepted decision in place: supersede it with a new ADR.

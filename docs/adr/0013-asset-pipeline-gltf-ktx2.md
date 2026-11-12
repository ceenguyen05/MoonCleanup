# ADR-0013: Asset pipeline - glTF 2.0, meshopt and KTX2

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, technical-artist
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Assets row)

## Context

Load size and GPU memory are hard budgets: <= 20 MB to first playable/lobby, <= 40-50 MB to a full first session on Low/Medium, <= 80-120 MB High, with GPU allocations capped near 1-1.5 GB (Tier B) and 3 GB (Tier A). GPU texture formats differ: BC covers ~87% of adapters while ETC2/ASTC covers ~46%, so a universal transcodable format is required. Assets must be generated reproducibly and built outside Vercel/Render to avoid slow builds.

## Options considered

1. **glTF 2.0 + meshopt compression + KTX2 (UASTC for normals/hero, ETC1S for bulk), processed by glTF-Transform.** Pro: one transcodable texture format for all GPUs; small downloads; scriptable. Con: KTX2 encoding needs native KTX-Software binaries.
2. **Draco-compressed glTF.** Pro: strong mesh compression. Con: slower decode, worse for animated/skinned meshes.
3. **PNG/JPG/WebP textures.** Pro: universal tooling. Con: no GPU-compressed upload; high VRAM.
4. **Raw Basis Universal (.basis).** Pro: transcodes widely. Con: KTX2 is the standard container.
5. **FBX/OBJ.** Pro: artist familiarity. Con: no PBR, no compression, heavier loaders.

## Decision

Option 1. `tools/asset-pipeline` (technical-artist) runs glTF-Transform (4.5.1) with meshoptimizer/gltfpack (1.3.0) and KTX-Software (v4.4.2): dedup, prune, quantize, meshopt, KTX2 with mips (**UASTC** for normals and hero textures, **ETC1S** for bulk). Output lands in `apps/client/public/assets/` and is committed only as compressed game-ready derivatives (ADR-0017). A single `AssetLoader` (KTX2, meshopt, audio decode) with a budget-aware cache owned by `render` loads everything; a budget-check script fails CI when per-asset or per-tier byte budgets are exceeded. **Audio:** Opus in WebM with an AAC fallback. Moon/Earth/star textures: 2k-8k KTX2, 16-bit height/normal tiles. Hashed filenames with immutable caching on Vercel.

## Consequences

**Positive**
- One asset format that transcodes to whatever the GPU supports; predictable budgets; CI-checkable.

**Negative / risks**
- KTX-Software is slow-moving (last stable 13 months ago) and a native dependency in the pipeline container.
- UASTC textures are larger than ETC1S; need discipline about which maps use which.
- KTX2 transcoding has a CPU cost at load; handled by streaming and a Worker.

## Revisit trigger

- A texture or mesh budget is missed after optimization.
- KTX-Software or glTF-Transform becomes unmaintained or incompatible with a three upgrade.

## Evidence

- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (glTF-Transform, KTX-Software, gltfpack rows)
- [browser-feasibility.md](../research/browser-feasibility.md) (size and memory budgets, BC vs ETC2/ASTC coverage, portal guidance)
- [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) (asset source licensing and credits)

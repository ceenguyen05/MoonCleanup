# ADR-0011: Animation pipeline

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, animation-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Animation row)

## Context

Up to 16 avatars plus robots and vehicles must animate convincingly in low gravity: locomotion with exaggerated bounce, a tool-use upper body, jetpack poses and vehicle suspension visuals. Animation must be driven by sim state (position, velocity, tool action), not own the movement. Source clips must be legally redistributable from a possibly public repo; Mixamo files may not be redistributed to non-team members.

## Options considered

1. **glTF skinned characters + three `AnimationMixer` blend layers + procedural foot IK and low-g bounce.** Pro: built in, WebGPU skinning and instancing examples, additive blending; modular. Con: no visual state-machine tooling; we write blend logic.
2. **Third-party animation graph library.** Pro: ready state machines. Con: extra dependency per ADR rule; unproven with WebGPURenderer.
3. **Fully procedural animation (no clips).** Pro: no assets, perfect responsiveness. Con: art quality, effort.
4. **Mixamo clips committed to the repo.** Pro: fast. Con: raw files must not be distributed; license-risky in a public repo.
5. **Vertex-animation textures for crowds.** Pro: cheap many-instance playback. Con: limits blending; overkill at 16 players.

## Decision

Option 1. Characters are glTF 2.0 skinned meshes (meshopt, ADR-0013). `apps/client/src/animation/` runs `AnimationMixer` layers: a **locomotion 1D/2D blend** (speed/direction), an **additive upper-body tool layer**, plus **procedural foot IK** and a **low-g bounce** curve fed by sim velocity. Vehicle suspension visuals and robot/machine motion are procedural from sim state. Animation listens to typed events (ADR-0022) and never mutates sim state. Remote avatars animate from interpolated state and events. Clip sources are **original/commissioned or CC0 only**; Mixamo may be used for private prototyping outside git and **is never committed**; every clip gets an `ASSET_LICENSES.md` row.

## Consequences

**Positive**
- Few moving parts; costs are predictable; no new runtime dependency.

**Negative / risks**
- Convincing low-g bounce and IK need iteration; initial placeholder clips will be replaced.
- Bone-count limits (UBO limit addressed in r186) constrain rig complexity; instanced skinning needs testing on WebGL2.
- Retargeting between character rigs must be validated per release.

## Revisit trigger

- Blend-tree complexity exceeds what manual layer code can maintain (more than ~6 blend states per character).
- Animation CPU exceeds the budget (1.5 ms Tier A, 2 ms Tier B) with 16 avatars.

## Evidence

- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (skeletal animation, blending, retargeting; scoring row)
- [asset-and-data-licensing.md](../research/asset-and-data-licensing.md) (Mixamo terms, CC0 sources)
- [browser-feasibility.md](../research/browser-feasibility.md) (CPU frame budget)

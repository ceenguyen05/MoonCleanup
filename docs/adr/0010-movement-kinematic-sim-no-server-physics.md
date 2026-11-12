# ADR-0010: Movement and physics - shared kinematic sim, no server physics

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, gameplay-systems-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Movement / physics row), section 5

## Context

Low-gravity movement (bouncy walking, jetpack), vehicles and tools must feel good and be validated by an authoritative server that has **0.1 CPU**. A physics engine on the server is out of budget. The surface is a sphere: "up" is the normalized position and the ground is an analytic height function (ADR-0008). Clients need identical movement code for prediction and reconciliation (ADR-0015), and the sim must run in a Web Worker or Node (module rule 3).

## Options considered

1. **Shared deterministic-ish kinematic sim in `packages/sim`: analytic height function, capsule/OBB primitives, raycast-suspension vehicles.** Pro: cheap, replayable, identical on client and server. Con: we hand-write vehicle and collision behavior.
2. **Rapier (WASM) on server and client.** Pro: general physics. Con: CPU on 0.1 core; determinism across platforms; radial gravity needs workarounds.
3. **Client-authoritative movement with sanity checks.** Pro: zero server cost. Con: speed/teleport cheating; rejected for a persistent co-op economy.
4. **Rapier on clients only for everything.** Pro: easiest feel. Con: server cannot validate; no reconciliation.
5. **Jolt / Havok.** Pro: robust. Con: heavier, same server-cost issue.

## Decision

Option 1. `packages/sim` implements movement (low-g kinematics, jetpack), vehicles (raycast suspension), tools and cargo as fixed-step, input-driven functions over typed component stores, using the shared analytic ground (cube-map height + procedural detail, slope from finite differences). Server-side validation uses the same functions plus plausibility checks (speed caps, not under ground). **No physics engine runs on the server.** **Rapier 0.21 is client-only, optional (v1.0)** for cosmetic props and debris, with world gravity zeroed and a per-body radial force; colliders stream in a ring of tangent-plane chunks. Sim code uses fixed-step math discipline (no unseeded randomness, no wall-clock reads) so replay and reconciliation converge; it is "deterministic-ish": bit-exact across machines is not required because the server state wins.

## Consequences

**Positive**
- Server cost per player is a handful of arithmetic operations per tick; the same code predicts on the client and runs in a Worker for offline solo later.

**Negative / risks**
- **Research nuance:** [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) section 3 describes movement as "client-authoritative with sanity checks". tech-stack.md and ADR-0015 instead make the server sim authoritative over validated inputs; this ADR follows tech-stack.
- Vehicle handling and collisions are custom and need extensive tuning; no free collision with arbitrary props on the server (props are cosmetic only).
- Floating-point differences can cause small prediction errors, absorbed by smoothed reconciliation.

## Revisit trigger

- Vehicle/collision gameplay needs real rigid-body interaction on the server: evaluate Rapier deterministic build on a paid instance.
- Reconciliation snaps are visible in more than ~1% of ticks at 150 ms RTT in bot tests.

## Evidence

- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (section 3, Executive summary 6)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (Rapier 0.21.0 variants, Jolt, Havok)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (prediction/reconciliation module)

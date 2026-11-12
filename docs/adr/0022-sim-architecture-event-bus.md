# ADR-0022: Simulation architecture - plain TypeScript, typed stores, event bus (no ECS library)

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, contracts-architect, gameplay-systems-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Architecture style row); [module-boundaries.md](../architecture/module-boundaries.md) sections 1, 4, 5

## Context

Many agents work in parallel on gameplay, rendering, UI, audio and netcode. Cross-module coupling is the main parallelism risk. The room sim must be environment-agnostic (browser, Web Worker, Node), run on the 0.1-CPU server, and be reproducible for prediction and reconciliation. Presentation modules (UI, audio, visuals, animation) need to react to gameplay without mutating it.

## Options considered

1. **Plain TS sim with typed component stores + typed event bus (event catalog in `packages/shared`).** Pro: no dependency; contracts are types; easy for agents to read. Con: we design store layout and iteration by hand.
2. **bitecs (MPL-2.0, 0.4.0).** Pro: fast struct-of-arrays. Con: pre-1.0; file-level copyleft; adds a mental model across all agents.
3. **koota (0.6.6) / miniplex (dormant).** Pro: ergonomic ECS. Con: pre-1.0 or dormant.
4. **Engine ECS (PlayCanvas / Babylon).** Pro: built in. Con: tied to rejected engines.
5. **Direct cross-module calls.** Pro: simplest. Con: tight coupling; violates boundary rules.

## Decision

Option 1:
- `packages/sim` implements `RoomSim` (`step(dt)`, `applyInput`, `snapshot()`, `onEvent`) as pure TypeScript over **typed component stores** (Transform, Avatar, Vehicle, Robot, Tool, Cargo, Building; shapes in `shared/sim/components.ts`).
- State changes emit events from the **event catalog** (`dust.collected`, `cargo.sold`, `plot.polished`, `purchase.completed`, `unlock.granted`, `vehicle.entered`, ...). UI, audio, visuals and animation **listen only**; consumers never mutate sim state.
- Inside an app, modules communicate only through the **typed event bus** or the **service registry** (`ClientModule { id; init; update; resize?; dispose }`), registered in the fixed order render, visuals, terrain, animation, gameplay, net, audio, ui, debug.
- The sim has no DOM, Node API, three.js or Colyseus imports (ESLint-enforced).
- The frame order is fixed: input, net ingest, sim predict (fixed step), gameplay, animation, terrain/dust, visuals/VFX, render, audio, UI flush.
- Stores may later be swapped for a data-oriented layout behind the same interfaces if profiling requires it.

## Consequences

**Positive**
- Few dependencies; boundaries are explicit and lint-checkable; the same sim runs in client, server and Worker.

**Negative / risks**
- Event-bus overuse can hide data flow; the catalog is a contract changed only between waves.
- Hand-rolled stores may need performance work for robots and many entities.
- No off-the-shelf ECS tooling or inspectors.

## Revisit trigger

- Sim step on the server exceeds its CPU share (ADR-0015) due to store layout: evaluate a data-oriented/ECS implementation behind `RoomSim`.
- Event volume per tick causes GC pressure above budget.

## Evidence

- [module-boundaries.md](../architecture/module-boundaries.md) (rules, contracts, runtime interfaces)
- [tooling-and-libraries.md](../research/tech/tooling-and-libraries.md) (bitecs, miniplex, koota rows)
- [rendering-case-threejs.md](../research/tech/rendering-case-threejs.md) (thin in-house entity layer; modular boundaries)

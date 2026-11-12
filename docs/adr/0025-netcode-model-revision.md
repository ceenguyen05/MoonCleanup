# ADR-0025: Netcode model revision - entities in bytes frames, horizon-aware interest, one room per Contract

- **Status:** Accepted (2026-11-12). **Supersedes ADR-0015.** Release-order bullet superseded by [ADR-0029](0029-single-deploy-branch-main.md) (no deploy gate; newer-client flow is a tested path)
- **Deciders:** lead/orchestrator, netcode-engineer (after the principal-engineer planning review, findings B1, M4, M5, M8, M10, M11, m2, m3)
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 3; details in [netcode.md](../architecture/netcode.md); dust semantics in [world-and-dust-simulation.md](../architecture/world-and-dust-simulation.md)

## Context

ADR-0015 was accepted before the netcode and dust specs were written. Review found it stale: it sends entities as "10 Hz Schema snapshots" (netcode.md moved them to a bytes `FRAME`), its egress trigger (> 900 KB per player-hour) is already exceeded about 25 times by the planned ~6 KB/s per client, its "5-6 full 16-player hours" contradicts the computed ≈ 15 room-hours, and its CPU response (drop to 15 Hz) differs from tech-stack.md (replace the Colyseus edge). Review also found that `joinOrCreate` + `filterBy` can create two rooms for one Contract, that the input-starvation rule could apply inputs twice, that interest ignored the 82.5 m horizon of a 2 km moon, and that `MAX_ROOMS` was defined four ways.

## Options considered

1. **Amend ADR-0015 in place.** Con: ADRs are append-only.
2. **New ADR that restates the full model with the corrections (chosen).** Pro: one place to read; ADR-0015 stays as history.

## Decision

- **Authority and rates:** server-authoritative `RoomSim` at `SIM_TICK_HZ=20`, frames at `SNAPSHOT_HZ=10`; the paid-instance alternative is **30 / 15** (snapshot rate must divide the tick rate). Nothing hard-codes a tick count.
- **Encoding:** low-rate shared state in Schema (encode-once, patched from the fixed-step driver with automatic patching off); entities and all per-frame dust records in one per-client bytes `FRAME`; bulk dust messages separate and sliced (ADR-0023, ADR-0026).
- **Inputs:** sequence-numbered; one seq consumed per tick; a substituted input consumes its seq and the late original is dropped, so no input is ever applied twice; `FRAME` carries `inputBufferDepth` and the client time-dilates ±2-5 % to keep 1-2 inputs buffered. Sweep phase derives from `inputSeq`.
- **Prediction/reconciliation:** the reconciler lives in `packages/sim`; `packages/protocol` only encodes/decodes; `apps/client/src/net` wires them.
- **Interest:** one `InterestService` computes entity and dust sets; entity interest is horizon-aware (√(2R·h₁) + √(2R·h₂) + 40 m, capped at 400 m); hidden tabs receive 1 Hz Self-only frames.
- **Rooms:** one room name `shift` with `shiftType` in state; clients join only via `POST /v1/contracts/:id/join`; in-process `contractId → roomId` registry; DB lease by compare-and-set on the database clock, keyed by room id.
- **Capacity:** admission by measured tick budget (`TICK_BUDGET_MS` 3.5 ms) with `MAX_ROOMS` = 3 as a hard ceiling; the free tier hosts only a few live Contracts at once and Open Shifts share rooms.
- **Lifecycle:** checkpoints ≤ 30 s when dirty, on room empty and on SIGTERM (ADR-0016 amendment); save decode and room creation sliced ≤ 1.5 ms per tick; grid tables precomputed and shared per process.
- **Release order:** the production client deploys only after the server reports the commit's protocol version (release gate in environments.md §4.3).

## Consequences

**Positive**
- Bandwidth ≈ 5.8 KB/s per client busy (≈ 15 room-hours or ≈ 240 player-hours per 5 GB); no double-applied inputs; no split-brain rooms; one source for capacity numbers.

**Negative / risks**
- Few concurrent Contracts on the free tier (by design; the v1.0 Worker-based Solo is the relief valve).
- Colyseus details (`exposedMethods`, `reserveSeatFor`, manual `broadcastPatch`, write coalescing) must be verified in the M0 spike.
- Major GC stalls under the 0.1-CPU quota are gated separately (≤ 50 ms traced).

## Revisit trigger

- M0-W2 spike: one 16-bot room > 50 % of the 0.1-CPU budget at 20 Hz → replace the Colyseus edge with the custom uWS adapter (tech-stack §3).
- Egress per 16-player room-hour > 400 MB in bot tests (the ≈ 337 MB budget plus margin).
- A paid instance becomes available: raise rates to 30 / 15 and revisit `MAX_ROOMS`.

## Evidence

- [current authority; obsolete report removed](../REVIEW_LOG.md) (B1, M4, M5, M8, M10, M11, m2, m3, m5, m11)
- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md), [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md), [platform-limits.md](../research/tech/platform-limits.md)

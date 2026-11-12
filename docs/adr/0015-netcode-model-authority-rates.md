# ADR-0015: Netcode model - authority, tick rates, prediction and interest management

- **Status:** Superseded by [ADR-0025](0025-netcode-model-revision.md) (2026-11-12)
- **Deciders:** lead/orchestrator, netcode-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 1 (Render rows), section 3

## Context

The server is a Render Free instance (0.1 CPU is ~100 ms CPU per wall-clock second; bursts beyond ~10 ms per 100 ms period may stall) with 5 GB/month egress (about 5-6 full 16-player hours; naive JSON would burn 5 GB in ~11 player-hours). WebSocket (TCP) only. Players expect responsive movement and a world that survives restarts. Browsers throttle hidden tabs, so the server must tolerate "away" clients.

## Options considered

1. **Server-authoritative, 20 Hz sim / 10 Hz snapshots, client prediction + reconciliation, interest management.** Pro: fits the CPU/bandwidth estimate (10-50% CPU, est.); responsive. Con: 150-250 ms interpolation delay for remote entities.
2. **30 Hz sim / 15-20 Hz snapshots.** Pro: snappier. Con: ~50% more CPU and bandwidth; unproven on 0.1 CPU.
3. **Client-authoritative with sanity checks.** Pro: cheapest. Con: cheating; consistency of dust/economy.
4. **Lockstep.** Pro: tiny bandwidth. Con: stalls with 16 players and variable latency; poor with restarts.

## Decision

Option 1:
- **Authority:** the server steps `RoomSim` (from `packages/sim`) at a fixed **20 Hz**, consuming validated, sequence-numbered inputs; it owns dust, economy and persistence. Rates are config values, so **30 Hz / 20 Hz returns if a paid instance is ever approved.**
- **Snapshots:** **10 Hz** entity snapshots (Schema, encode-once); dust deltas at 5 Hz near each player and ~0.5 Hz summaries elsewhere; robots replicate intent; conveyor items are simulated client-side from belt state.
- **Client:** inputs are applied locally immediately (**prediction**), acked by sequence; the server state **reconciles** with smoothed correction; remote entities **interpolate** with an adaptive 150-250 ms delay.
- **Interest management:** per-client regions around the player for entity and dust deltas (no StateView); far plots receive L0 summaries only (ADR-0009).
- **Lifecycle:** checkpoint to the DB <= every 30 s (only when dirty), on room empty, and on SIGTERM (ADR-0016); the client shows a "waking server" flow and retries with backoff after cold starts or shutdown code 4001.
- **Telemetry:** bytes out per room, tick time p50/p95/max, tick overruns (ADR-0020). Hidden tabs send keep-alive and are flagged "away".

## Consequences

**Positive**
- Cheap enough for a 0.1-CPU instance; responsive local feel; no bandwidth cap logic needed beyond measurement.

**Negative / risks**
- **Research nuance:** the Colyseus advocate sized for 30 Hz; the raw-WebSocket report recommended 20/10 as the free-tier profile. tech-stack.md adopts 20/10 (est. 10-50% of the 0.1 CPU) and the M0 spike must confirm it.
- Remote players feel 150-250 ms behind; TCP loss spikes freeze remote entities for 0.1-0.3 s.
- Reconciliation depends on sim code being bit-compatible enough (ADR-0010).
- Bandwidth suspension remains possible (ADR-0002).

## Revisit trigger

- M0-W2 spike: CPU > 50% for 16 bots at 20 Hz: drop to 15 Hz or reduce snapshot rate (ADR-0014 trigger).
- Egress per player-hour > ~900 KB in bot tests (would exhaust 5 GB in <6 hours).
- A paid instance becomes available: raise rates.

## Evidence

- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md) (Executive summary: free-tier profile, bandwidth, CPU)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (prediction, bandwidth estimate, deploy disconnects)
- [platform-limits.md](../research/tech/platform-limits.md) (B2, B7, E3)
- [browser-feasibility.md](../research/browser-feasibility.md) (background-tab throttling)

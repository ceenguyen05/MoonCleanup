# ADR-0014: Netcode framework - Colyseus 0.18 on uWebSockets.js

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, after three advocate reports
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 3 (matrix) and section 4 (Netcode row)

## Context

Up to 16 players per room need an authoritative server with rooms, lobby listing, private invite codes, reconnection with seat holding, graceful shutdown and test tooling. The host is Render Free: 0.1 CPU / 512 MB, **TCP only** (no UDP), restarts at any time. Effort matters: a custom layer costs 9-11 agent-days of plumbing alone. The 163,842-sector dust field cannot go through Schema at that size (about 6 bytes per changed cell; ~1 MB join snapshot).

## Options considered

1. **Colyseus 0.18 (+ uWS transport, raw-bytes hot path).** Pro: rooms, lobby, `joinById`, reconnect, SIGTERM hooks, loadtest bots, built-in prediction/reconciliation module. Con: 0.18 netcode and Schema 5 are ~3 months old; single maintainer; CPU on 0.1 core unproven.
2. **Custom on uWebSockets.js.** Pro: leanest CPU and bytes. Con: +9-11 agent-days of plumbing; all reliability work ours.
3. **WebRTC / WebTransport / geckos.io.** Pro: unreliable channels. Con: **infeasible on Render** (no UDP, no HTTP/3 to origin).
4. **Socket.IO 4.8.** Pro: works on Render, acks, reconnect. Con: weaker fit for binary hot path and prediction; higher CPU.

Weighted result (tech-stack.md): Colyseus **4.0**, custom uWS **3.75**, Socket.IO **3.1**, WebRTC/WebTransport not feasible.

## Decision

**Colyseus `0.18.x`** (`colyseus`, `@colyseus/core`, `@colyseus/schema` 5.x, `@colyseus/sdk` client) on the **uWebSockets.js transport**. Entity state uses Schema **without StateView** (encode once, broadcast the same buffer to everyone). Dust, strokes and compact snapshots use **`broadcastBytes`/`sendBytes` with our own codec** (ADR-0023). The room simulation lives in `packages/sim` and **does not import Colyseus**: the Colyseus `Room` in `apps/server/src/net` is a thin adapter, so the edge can be swapped for a custom uWS adapter and the sim can run in a Web Worker. A transport abstraction in `packages/protocol` keeps a future WebTransport door open. Per-message `permessage-deflate` is off.

## Consequences

**Positive**
- Rooms, lobby, reconnect and loadtest come free; the transport can be replaced without touching the sim.

**Negative / risks**
- TCP head-of-line blocking under loss; mitigated by interpolation delay (150-250 ms) and compact deltas.
- Every deploy/restart disconnects all players (close code 4001 does not auto-reconnect); our client implements rejoin/restore.
- Agents' built-in Colyseus knowledge is stale (API churn in 0.17/0.18); vendored docs snapshot recommended.
- Maintainer concentration; pin exact versions.

## Revisit trigger

M0-W2 netcode spike on a **real Render Free instance** shows one 16-bot room using **> 50% of the 0.1-CPU budget** at 20 Hz: replace the Colyseus edge with the custom uWS adapter (Option 2).

## Evidence

- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (Executive summary; sections 1, 5)
- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md) (effort split; hybrid path)
- [netcode-case-webrtc-webtransport.md](../research/tech/netcode-case-webrtc-webtransport.md) (feasibility on Render; Socket.IO)
- [platform-limits.md](../research/tech/platform-limits.md) (B1, B4)

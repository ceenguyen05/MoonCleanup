# ADR-0009: Dust simulation and sync - strokes, tile atlas, coarse ledger

- **Status:** Accepted (2026-11-12)
- **Deciders:** lead/orchestrator, terrain-dust-engineer
- **Canonical source:** [tech-stack.md](../architecture/tech-stack.md) section 4 (Dust row)

## Context

Cleaning dust is the core loop: it must look like dust visibly thins where you actually swept, stay consistent for 16 players, count exactly once for the economy, survive Render Free restarts and cost almost nothing on a 0.1-CPU server with a 5 GB/month egress cap. GPU readback (`mapAsync`) has variable latency and can never be authoritative. Sizes (computed): full snapshot at 1 byte/plot is 160 KiB; one plot update ~4 B; one stroke ~16 B; worst case 16 hand-cleaning players ~2.4 KB/s of strokes per client.

## Options considered

1. **P1 - scalar per plot + procedural visuals.** Pro: minimal state and bandwidth. Con: trails not persistent or consistent; scoring exploitable by re-scrubbing.
2. **P2 - strokes + per-plot tile atlas + coarse ledger (preferred).** Pro: authoritative exact-at-~1 m scoring; resolution-independent visuals; small persistence. Con: stroke-edge determinism differences between GPUs; stroke logs and late-join reconstruction need caps.
3. **P3 - client-painted tiles merged by per-texel minimum.** Pro: free tool shapes; order-independent merge. Con: client-authoritative scoring, large tile uploads, cheating, persistence size.
4. **RVT-style virtual texturing.** Pro: good when resident. Con: blurry after teleports; WebGPU has no sparse textures (emulated by atlas).

## Decision

Adopt the P2 layered design as the baseline and **keep P1 and P3 as competing prototypes** under the competing-approach rule:

| Layer | Location | Content |
| --- | --- | --- |
| L0 | Server + clients | One scalar (remaining fraction) and state (untouched/partial/complete) per plot |
| L1 | Server only, partial plots | 32 x 32 x 4-bit **coarse ledger** in the plot's tangent frame (512 B) |
| L2 | Client GPU atlas | Per-plot tile 64^2-128^2 (dust + berm height), drawn by **stroke replay** |
| L3 | Client GPU | Toroidal **detail ring** for footprints, ruts, crisp edges |
| L4 | Server (capped), clients | Last N validated strokes per active plot (for late join, N ~ 256) |

- Strokes only subtract (clamped at 0), so application order does not matter; when L1 shows <= 1% remaining the server marks the plot complete and clients fade the remainder.
- The economy is computed **on the server from the ledger**; clients run the same maths to predict counters. Orbit view colors the level-k icosphere from L0.
- Robots replicate intent (route + start time), not strokes; footprints are derived locally from replicated movement.
- Transport: the stroke/dust/snapshot bytes travel on the `broadcastBytes` channel (ADR-0014, ADR-0023), with interest filtering (ADR-0015). Per-message `permessage-deflate` is off; snapshots are compressed once and cached.
- Prototype benchmark: GPU time per tier (budget ~2 ms dust on iGPU, assumption), memory, bytes/s, server CPU at 0.1 core, visual edge quality, restore after spin-down.

## Consequences

**Positive**
- Exact, exploit-resistant scoring without GPU readback; persistence is ledgers plus capped logs.

**Negative / risks**
- Cross-GPU rounding means two clients can differ by a texel at stroke edges (scoring unaffected).
- WebGL2 has no compute: the stroke replay must also work as a fragment-pass path (ADR-0004).
- Numbers (server CPU, compression) are estimates until P2 is measured.

## Revisit trigger

- P2 server CPU > 30% of the 0.1-core budget with 16 bots, or stroke logs exceed memory caps: fall back to P1 plus visual-only trails.
- Tool variety (spray, particle cleaning) outgrows strokes: adopt P3 for those tools.

## Evidence

- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) (sections 4-8, Executive summary 7-12, Contradictions 11-12)
- [netcode-case-colyseus.md](../research/tech/netcode-case-colyseus.md) (dust field must not go through Schema)
- [netcode-case-raw-websocket.md](../research/tech/netcode-case-raw-websocket.md) (dust chunking)

## Amendment 2026-11-12

Added after the principal-engineer planning review (B1, B2, M1, M2). The Decision above is kept as history; where it conflicts, this amendment and the ADRs it names win.

- **Canonical spec:** [world-and-dust-simulation.md](../architecture/world-and-dust-simulation.md) is the single source for dust: 641 chunks (640 × 256 plots + the poles), "Plot {chunk}-{index}" ids, stroke records, ledger, robots, interest radii, echo/reconcile, drift check and the chunk payload. netcode.md only frames these records; data-model.md owns the save tables.
- **Ledger (L1):** the sentence "strokes only subtract (clamped at 0), so application order does not matter" was not true of the proportional rule. The ledger is now 32 × 32 × 8-bit with absolute, coverage-weighted removal and a minimum per pass ([ADR-0026](0026-dust-ledger-absolute-removal.md)); results are order-independent and Polished is reachable with every tool. The server still sequences ops per tick and broadcasts results for economy values.
- **Interest:** strokes, robot intents and ledgers go to each client within its tile residency radius + 20 m (100-240 m), never less than the residency radius.
- **Persistence:** header slots + per-chunk dust rows with two versions each, written in one transaction and loaded by the `save_seq` rule of data-model.md §3.7b (see ADR-0016 amendment).
- **L4 logs:** ≤ 256 strokes per plot in RAM (process-wide 16 MB LRU), ≤ 32 per plot in saves.

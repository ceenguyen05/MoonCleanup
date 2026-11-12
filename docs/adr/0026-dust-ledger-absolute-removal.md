# ADR-0026: Dust ledger - absolute coverage-weighted removal, server-sequenced ops

- **Status:** Accepted (2026-11-12). Amends ADR-0009 (ledger layer L1 and the "order does not matter" claim).
- **Deciders:** lead/orchestrator, terrain-dust-engineer (after the principal-engineer planning review, finding B2)
- **Canonical source:** [world-and-dust-simulation.md](../architecture/world-and-dust-simulation.md) §4.1-§4.5b

## Context

ADR-0009's ledger removed `floor(d·E/A)` of what was left in a 0.8 m texel and cleared it only at ≥ 90 % cover. A partially covered texel therefore stalled at 1-7 of 15 levels; T1-T3 hand tools (≤ 0.45 m wide) could never reach the 1 % Polished threshold, contradicting the design pacing (one Highland plot ≈ 21 min with the Desk Duster). The rule also depended on application order (d = 7 with E/A 0.3 then 0.6 gives 2; reversed gives 3), so client ledgers diverged by construction. The design's tool Depth, terrain passes, Detailing and Charge had no mapping onto the stroke.

## Options considered

1. **Per-texel 4 × 4 sub-cell masks or pass counters.** Pro: location-exact. Con: 2-4 KB per plot, larger saves and snapshots.
2. **Absolute, state-independent removal with a minimum per pass, in 1/16-level units (chosen).** Pro: saturating subtraction commutes, so results are order-independent; every touch makes progress; maps 1:1 to design Depth; 1 KiB per plot. Con: a coarse texel can empty before a thin line is visibly wide (handled by the client's ledger-zero clear).
3. **Keep proportional removal, add a 1 % auto-complete only.** Con: still order-dependent and still stalls above 1 % with thin tools.

## Decision

- Texel value u_t in 1/16-level units (u8, 32 × 32 = 1 KiB per plot); initial 16 × L_P with L_P = 5 / 8 / 13 by terrain class (progression-and-economy §1.1).
- Stroke field `depth16` = 16 × effective Depth (Scour, Master Stroke, night penalty); Charge and Detailing use 255.
- Coverage C_t from flat-ended segments on a fixed lattice; r_t = round(depth16 · C_t / A); r_t ≥ 1 when C_t ≥ A/64; u_t ← max(0, u_t − r_t). r_t never depends on u_t.
- Plots with ≤ 1 % remaining are Polished and auto-completed by the Inspector's Stamp.
- The server applies a tick's ops in a fixed order (players by slot, vehicles, robots) because Dust Cell caps and credit are order-dependent, and broadcasts the results (accepted strokes, Dust Cell grams, plot states, chunk hashes); clients replay accepted ops for ledgers and visuals only.
- Required test vectors (WDS §4.5b): golden ledger vectors on four JS engines, permutation property test, per-tool reachability within ±20 % of design times, over-collection bound, client two-view convergence.

## Consequences

**Positive**
- Polished is reachable with every tool; ledgers converge whatever the arrival order; Depth/passes match the design table exactly; drift is detectable with per-plot hashes.

**Negative / risks**
- Ledger doubles from 512 B to 1 KiB per Opened plot (RAM, saves, snapshots; sized in WDS §4.3/§5.4/§6 and data-model §4).
- Visual and economic state can differ inside one 0.8 m cell until the ledger-zero clear runs.

## Revisit trigger

- Reachability test V3 misses design times by more than ±20 % for any tool.
- Measured save size per Opened plot > 0.6 KB per version in P2.

## Evidence

- [planning-review-principal-engineer.md](../agent-reports/planning-review-principal-engineer.md) (B2)
- [progression-and-economy.md](../design/progression-and-economy.md) §1.1, §4
- [terrain-and-dust-techniques.md](../research/tech/terrain-and-dust-techniques.md) §4-§5

# M1-W3-T01c Balance review of V3 dust pacing (balance-reviewer)

Status: **finding partly confirmed; no blocking economy defect; one design decision needed** / 2026-11-14 / Sonnet 5.5. No git, game-data untouched.

## Commands

- Per-pair pass measurement (new, read-only): `cd tools/balance-sim && npx tsx src/dust-passes.ts` (drives the real `WorldDustLedger` with the lane pass of `dust-ledger.test.ts`: lanes 0.75 x width apart, +-50 mm jitter, 1 m strokes, 14 m frame; optional `DSCALE_T12=<f>` scales the T1/T2 depth to test tuning). Deterministic (no RNG, fixed jitter).
- Simulator: `pnpm --filter @moon-cleanup/balance-sim balance:assert` (default seed). MVP rows: first Stamp 5.50 min (5-8), first tool upgrade 6.13 (5-10), first Cell 8.87 (7-12), first vehicle 1.16 h (1-1.5), first Roost 1.54 h (1.5-2), 4p rows 2.17 min / 3.40 / 0.52 h / 0.65 h all PASS; v1.0 rows SKIPPED (need M2 simulator).
- `balance-sim` uses `passes() = max(1, ceil(level/depth))` (model.ts:92), so it assumes the design table, not the ledger. It cannot see this finding.

## Measured passes to Polished (lanes 0.75 w, one full-lane sweep = 0.85 "pass" because the frame overshoots the plot, so measured / 0.85 = passes)

| Class (level) | Tool (depth) | Design ceil(L/D) | Measured | Delta |
| --- | --- | --- | --- | --- |
| Highland (5) | T1..T6 | 1 | 1.00 | 0 |
| Mare (8) | T1 (5) | 2 | 2.07 | +4 % |
| Mare | T2 (6) | 2 | 1.80 | -10 % |
| Mare | T3..T6 | 1 | 1.01 to 1.02 | 0 |
| Crater (13) | T1 (5) | 3 | 2.18 | **-27 %** |
| Crater | T2 (6) | 3 | 2.14 | **-29 %** |
| Crater | T3 / T4 (8) | 2 | 2.08 / 2.11 | +4 to +6 % |
| Crater | T5 (13) | 1 | 1.01 | 0 |
| Crater | T6 (10) | 2 | 1.75 | -12 % |

With lanes exactly one width apart: T1 Highland 1.57 (+57 %) and T3/T4 Mare 1.88 to 1.96 (+90 %, the lattice residue of finding 3, T01 report). Hard requirement (every hand tool Polishes every class) holds in every row.

**Verdict.** Refuted for Mare/T2 on this normalisation (-10 %; the engineer's raw 1.26-1.54 vs 2 is un-normalised). **Confirmed for Crater Floor with T1 and T2 (-27 %, -29 %, outside +-20 %)**. Cause is the design, not the code: lanes at 0.75 w overlap, so each pass removes ~1.33 x Depth, giving a continuous need of 0.75 L/D (Crater T1 1.95, T2 1.63, floored by geometry), while the table rounds up with ceil(L/D) (2.6 to 3).

## Does it hurt pacing? No.

Mix-weighted passes, measured vs table: Moon mix T1 1.49 vs 1.55 (-4 %), T2 1.39 vs 1.55 (-10 %); outpost mix (90/8/2) T1 1.11 vs 1.12, T2 ~1.09 vs 1.12 (~-3 %). Outpost play, the whole first hour, moves by under 4 %; Apron (level 2) is a 1-pass plot for every tool, unchanged (first Stamp 5.50 min stays). Crater is 10 % of plots and T1/T2 players are only there early by choice. Economy integrity: kg paid is mass removed, unaffected; faster clean = more LM/h only on the Crater plots, no loop. Over-collection test V4 stands.

## Options (decision for game-designer / Cee; docs are absolute so I do not change data unilaterally)

**A (recommended): no game-data change.** Amend progression section 1.1/4 so the passes column is the continuous figure max(1, 0.75 L/D) (rounded display) and make the V3 bar mix-weighted (Moon mix and outpost mix within +-20 %, currently -4 to -10 %), then update `model.ts passes()` to the same formula. Smallest blast radius; pacing already inside the band.

**B (data-only, if the per-pair table must hold): `packages/game-data/data/tools.json`**
```
tool.desk_duster     "depthLevels": 5 -> 4
tool.crescent_squeegee "depthLevels": 6 -> 4
```
Measured with these depths (scale 0.8 / 0.667 runs): Highland 1.0 / 1.0, Mare 2.14 / 2.14 (vs 2), Crater 3.24 / 3.26 (vs 3): all pairs inside +-10 %; Moon mix +4.6 % slower than the table. `depthLevels` is an integer (`CountSchema`), so non-integer values (4.25, 4.5 fit better) would need a schema change and are not data-only. Side effects: T1 and T2 then share depth 4, deviating from section 4 (5 / 6) and from the "Depth" column; sim `tool.ts:101` derives depth16 from it, so the sim golden hash and the Apron/first-Stamp timing (level 2, 1 pass either way) need a re-run of the simulator after the change. Constants that would change: only those two `depthLevels` (no dust level, kg per level, price or width). Also keep hand-tool Detailing (255 depth) unchanged.

Not recommended: raising `terrain.crater_floor.dustLevel` (13) or `dustKgPerM2PerLevel` (0.062): changes kg and every sell/buy ratio.

## Notes

- Lattice residue (T3/T4 on Mare at exact-width lanes needing ~1.9 passes): real play spaces lanes below width, so not a pacing risk; fix in spec as the engineer suggests if exact-width lanes are expected.
- Added file: `tools/balance-sim/src/dust-passes.ts` (read-only diagnostic; uses relative imports into `packages/world` and `packages/shared`). Not wired into the CLI; delete if unwanted.

## Next

Lead to route the A/B choice to game-designer. If B: game-data owner edits two values, then re-run `balance:assert` and the sim golden re-record.

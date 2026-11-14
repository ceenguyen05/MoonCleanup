# M1-W2-T05 balance review (balance-reviewer)

Date 2026-11-14. Read-only; no game data edited. Verdict: **PASS with conditions** (no blocking items; one recommended lever, two non-blocking watch items).

## Commands (Node 26.13.1 via fnm)
- `pnpm --filter @moon-cleanup/balance-sim balance -- --runs 200 --seed 7` -> output matches the designer report exactly (determinism OK). Scratch what-if runs used `runMvp`/`monteCarlo` with a cloned bundle (same seed 7, 200 runs); scratch scripts deleted, data untouched.

## Time-to-unlock (nominal efficient, then Monte Carlo P10/P50/P90)
| Row | Band | Solo | 4p |
| --- | --- | --- | --- |
| First Stamp | 5-8 min (solo) | 5.50 PASS | 2.17 PASS |
| Squeegee | 5-10 / 2-6 | 6.13 PASS | 3.40 PASS |
| First Cell | 7-12 min | 8.87 PASS | 4.7 |
| Trundle | 1-1.5 h / 0.3-0.8 | 1.09 PASS (MC 1.06/1.14/1.28) | 0.49 PASS (0.47/0.52/0.62) |
| First Roost | 1.5-2 h / 0.4-1 | **1.47 PASS_EDGE** (MC 1.38/1.50/1.76) | 0.61 PASS (0.57/0.65/0.76) |
v1.0 rows are SKIPPED (correctly not claimed). No tier skipped or reachable by waiting: income needs sweeping until Roost #1.

## Findings, ranked
1. **(a) Roost edge: recommend ONE lever, Trundle 1,800 -> 2,000.** Non-blocking (inside 10 % tolerance), but cheap to close. Measured (solo nominal / 4p / 6p):
   | Variant | Trundle solo | Roost1 solo | MC solo Roost P10/P50/P90 | Trundle 4p | Roost1 4p | 6p Roost1 |
   | --- | --- | --- | --- | --- | --- | --- |
   | baseline | 1.09 | 1.471 | 1.38/1.50/1.76 | 0.49 | 0.61 | 0.59 |
   | Trundle 2,000 | 1.13 | **1.504** | 1.43/1.58/1.85 | 0.52 | 0.64 | 0.59 |
   | Trundle 2,100 | 1.16 | 1.542 | n/a | 0.52 | 0.65 | 0.60 |
   | Roost 4,800 | 1.09 | **1.471 (no change)** | 1.42/1.54/1.80 | 0.49 | 0.70 | 0.59 |
   Why Trundle: Trundle hauls pay in 1,000 LM lumps (200 kg x 5 LM/kg), so Roost purchase times are quantised. Roost 4,800 does nothing to the nominal solo row, jumps 4p by +0.09 h, and raises Roost #2/#3 as well (+345, +396 LM; solo all-items 4.84 -> 4.89 h). Trundle 2,000 moves Roost by +0.03 h, keeps Trundle in band (1.13 h) and 4p inside 0.4-1 h. Later rows shift about +0.03 h only. Caveat: 2,000 clears the floor by only 0.004 h nominal (1,900 is non-monotonic, 1.467, due to the same quantisation); 2,100 gives a safe 1.54 h. If the owner wants margin, take 2,100; accepting 1.47 as-is is also defensible (P50 1.50). Trundle price also lives in scope-tiers/economy doc text; update them if changed.
2. **(b) 4-6 player dry spell after the first Roost: real but content exhaustion, not pacing.** Roost income is player-independent, so shifts of 4-6 buy all three Roosts by 0.92 h (4p) / 0.82 h (6p). After that only board nodes remain (92,200 LM): 4p all MVP items at 3.01 h, 6p at 2.47 h, income flat 86k-108k LM/h, total earned 200k-209k vs about 124k spent, so money idles from about 2.5 h. Max purchase gap 48 min (4p) / 37 min (6p) is largely a model artifact: the late non-rate wallet rule (buy only at 3x cost) delays Densifier 2 (16,000) and Broad Strokes 3, although 86k LM/h earns 16k in about 11 min. Not blocking for an MVP demo slice; do not "fix" with MVP table values. Direction: M2 sinks (Skiff 12,000, Plover 10,000 upgrades, Albatross 200,000, Nest) must exist before 4-6p play past about 2.5 h; keep Roost cap 3 in MVP (raising it only adds trivial sinks: #4-#6 about 6.8k-9k). Also note 4p -> 6p barely speeds Roost #1 (0.61 -> 0.59 h): Repeat Requisition (x3.0 at 6) plus 5 % crowding cancels extra hands. Shared-wallet scaling 1 -> 6 is sensible (1.47 -> 0.61 -> 0.59 h), but the 4 -> 6 flat spot is worth a tuning look in M2.
3. **(c) Exploits: none found in tables or sim; several not yet testable.**
   - Selling loops: `refundRule` is `paidPrice`; materials 5/16/37.5 LM/kg price each tier above the previous; the MVP has no Relay Pad, build or sell-back, so no loop exists. `relayFeeLm` 50 / `recallFeeLm` 100 untested until v1.0.
   - Free resets: onboarding is 8 steps at 0 LM; the 6 Near Parcels are fixed one-shot 30 LM (180 LM total, under 2 min of income at the Roost stage), no repeat spawn in data.
   - Dust-level farming: `world.json` has no regrowth or re-dusting field, and the sim treats polished plots as terminal (Polished fraction 0.85 only pays one Stamp per m2), so no grind-one-plot optimum in v0. Cell leftover dust carried across tool switches is paid once (no double pay).
   - Not simulated (must be before claiming M1 exploit-clean): leave/rejoin Repeat Requisition chains, Reclaim -> rebuy of escalating Roosts, and Place/Reclaim Settle loops (doc 22.7). These need sim authority; list as open hunts, not passes.
4. **Modelling optimism to keep honest (non-blocking).** No Roost rail allowance (doc quotes Roost #1 4,700 incl. 200 LM allowance; MVP uses 4,500), which also supports the Roost lever idea (4,700 gave MC solo P50 1.54, but nominal quantised to 1.47). Roost robot rate (3 Roosts about 3.5 m2/s at 0.64 uptime) yields income about equal to one skilled player; solo income rises 4.6k -> 31.9k LM/h between 1 h and 2 h, a 7x step: fine for "mid-game steady" only because the Roost price curve is mild (1.15x). Casual archetype rows are not asserted (schema lacks archetype token).
5. **Data validity.** Tables validate (designer ran 55 + 17 tests); MVP ids in naming form; only pacing rows added. Not independently re-run by me.

## Recommendation
Change Trundle `priceLm` 1,800 -> 2,000 (2,100 for margin) and update the economy/scope docs; re-run `balance:assert` expecting Trundle 1.13 h, solo Roost about 1.50-1.54 h. Do not touch Roost base. Treat (b) as an M2 sink requirement, and open the three unsimulated exploit hunts for v1.0.

Path: `c:\Users\caseyn\Downloads\BroswerMoonSweeper\docs\agent-reports\M1-W2-T05-balance-review.md`

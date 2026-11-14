# M1 game-data tables (game-designer)

Task: baseline balance/content tables against config contract v1 / status: done (awaiting review) / 2026-11-12 / game-designer / Opus 5.5

**Done:** all 23 §21 tables in `packages/game-data/data/*.json` (reference mode: no Review/cleaned-%/On-Shift/Bulk Rate/Refit/gate fields), values from progression-and-economy.md §1–§15/§18 (candidate tuning). Loader `loadGameData()` parses the whole set with `GameDataBundleSchema` once and deep-freezes it; JSON is imported with `with { type: "json" }`, so there are no DOM/Node APIs. There is one display-label catalog (215 ids) and a `PENDING_CONTRACT_FIELDS` holder. Coverage vs §21 locked counts: 7 tools, 23 nodes (6 Cell roots), 5 gear lines/14 levels, 5 vehicles, 7 lines/16 levels, 98 pieces (7/10/2/4/75), 6 finishes, 150 Stray Cargo, 24 Survey Points, 8 Induction steps, 33 achievements, 17 pacing rows (all with players ≤ 6). Totals match the doc: board 583,860, suit gear 121,150, Behemoth max-out multiple 6.30× and Carryall 2.50×.
Opening (test-derived from the tables): free 0.15 m Desk Duster with a 4 kg Cell, two 23.6 s Apron trips, first Stamp at ≈5.9 min paying 88 LM, then the 75 LM Squeegee. Tool width grows 1.33–1.87× per tier.

**Estimated by me (not in the doc):** piece footprints and snap tokens, the Deck Plate (39) and Gantry (20) breakdowns and their prices, achievement stat ids, trigger tokens, `cleanupOrder` params, the "~" pacing bands and all tolerances. Seats: Behemoth 1 (the "+cab" is unclear).

**Contract requests (contracts-architect):**
1. Add `units[].upgradePriceLm` (Plover 10,000) and `albatross.rateM2ps` (11). Robot pacing needs both.
2. Add `economy.trickComboMult`, `assayCounter.pourS`, `fieldGate.baleChuteFaces`, Carryall `flatbed{}` and `movement.carryUnits`. Their values sit in `src/pending-fields.ts` until then.
3. Node prereqs need `anyOf`: Overflow Former's "any Cell line III" is approximated by Desk Duster Cell III (550 LM).
4. Effect semantics should be written into common.schema: a level replaces the lower level; `add` sums and `mul` multiplies.
5. Possible bundle rules: Cell-node costs = `dust-cells.costsLm`; Roost/Nest/Field Gate prices = build-pieces; Charge `finishStampMult` = `chargeFinishMult`. Today only game-data tests check these.
6. `baleAcceptors` can't name the Receiving Gate, because it is not a build piece. Its acceptance comes from `gate.baleChuteFaces`.
7. Pacing rows need a `milestone` field. Today the id encodes it.

**Open issues (balance-reviewer):** Reclaim refunds on the escalating Roost price; Repeat Requisition via leave/rejoin; idle-client robot accrual; trick-cap windows. Co-op pacing rows were left out because they relied on the parked On-Shift Bonus (Q27).

**Next:** tools/balance-sim reads `loadGameData()` and regenerates the ≥5 h rows. No balance-sim run yet: it is a stub.

**Files:** `packages/game-data/{data/*.json, src/index.ts, src/raw.ts, src/load.ts, src/pending-fields.ts, src/content/labels.ts, src/content/display-names.json, src/game-data.test.ts, README.md}`; removed `src/tables/.gitkeep` and `src/content/.gitkeep`.

**Evidence (packages/game-data, Node via fnm default, 2026-11-12):** `tsc -p tsconfig.json` exit 0; `vitest run` 1 file / 39 tests pass; `eslint .` exit 0; `prettier --check .` clean.

## v1.1 migration (2026-11-12, game-designer, Opus 5.5) / status: done (awaiting review)

**Done:** every `PENDING_CONTRACT_FIELDS` value now sits in its JSON table. Plover `upgradePriceLm` 10,000 (Sandpiper has none because a Roost starts with it); `albatross.rateM2ps` 11; `economy.trickComboMult` 1.5; Carryall `flatbed {40, 8, 2}` (only the Carryall has one); `assayCounter.pourS` 6; `fieldGate.baleChuteFaces` 1; `movement.carryUnits` 1. All values are unchanged, so pacing does not move. Overflow Former now needs Densifier II plus `{anyOf: [six node.dust_cell_* at III]}`. The cheapest path is still Desk Duster III (550 LM total), but players who built up another Cell line no longer have to back-fill the Desk Duster line. All 17 pacing rows have a `milestone`. There are 12 milestones: mvp rows share them with their efficient rows, and both purchase-gap rows use `purchase_gap`. `baleAcceptors` is unchanged: the Field Gate is listed, which the faces = 1 rule requires, and the Receiving Gate comes from `gate.baleChuteFaces` 1. `src/pending-fields.ts` and its barrel export are deleted, and nothing outside the package used them. Tests: the 3 duplicated-constant tests are dropped (the bundle schema now covers them; the Steep check is kept). New tests check each v1.1 value, the Overflow Former `anyOf`, that every row has a milestone, and that the bundle rejects a Field Gate dropped from `baleAcceptors`. The first-minutes check reads `pourS` from the table.

**Proposal for contracts-architect: make required:** `albatross.rateM2ps`, `economy.trickComboMult`, `assayCounter.pourS`, `fieldGate.baleChuteFaces`, `movement.carryUnits` and pacing `milestone`. All are present in the data and pass. Keep `units[].upgradePriceLm` and vehicle `flatbed` optional, because they are absent by design. With faces required, the Field Gate/`baleAcceptors` rule becomes unconditional. Afterwards, game-data's `pourS ?? 6` fallback in the test can go.

**Balance-sim:** no run. `tools/balance-sim` is still a stub (`balance` script = NOT IMPLEMENTED). Values did not change. The only gate change makes the Overflow Former prerequisite easier to reach, at the same minimum price.

**Open issues (balance-reviewer):** with `anyOf`, Overflow Former can be reached through the cheapest Cell line (Desk Duster, 550 LM), so the capstone gate does little. Consider requiring tier ≥ 3 lines if it unlocks too early.

**Evidence (packages/game-data, Node 26.13.1):** `tsc -p packages/game-data/tsconfig.json` exit 0; `vitest run --root packages/game-data` 1 file / 41 tests pass; `eslint packages/game-data` exit 0; `prettier --check` on data, src and README is clean.

**Files (v1.1):** `packages/game-data/data/{robots,economy,vehicles,logistics,movement,promotions-board,pacing-targets}.json`, `src/index.ts`, `src/game-data.test.ts` and `README.md`; deleted `src/pending-fields.ts`.

**Commit suggestion:** `feat(game-data): baseline reference-mode tables, validated loader and label catalog`

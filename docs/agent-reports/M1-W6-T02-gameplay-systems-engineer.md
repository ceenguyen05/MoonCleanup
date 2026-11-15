# M1-W6-T02 Economy: purchases, selling, Railshot, Roost (gameplay-systems-engineer, Opus 5.5)

Status: **in-review (partial W6-T02)** / 2026-11-15 / gameplay-systems-engineer / Opus 5.5. No git, no servers left running.

## Done
**Pass 1: purchases.** A `purchase` intent buys a tool, the next level of a Promotions Board node, or the next level of a suit-gear line.
- Prices, prerequisites (including `anyOf`) and effects come from game-data.
- New Cell and Densifier levels apply to every member at once.
- Events: `purchase.completed`, plus `unlock.granted` (kind `node`) for MVP nodes the purchase opens.
- Rebate pricing (0 in MVP, so no price changes).
- Race resolution: if a different member bought the same item in the last 0.5 s, the request is refused with `pending_other`.
- Replays: the same `(actor, requestId, itemId)` is charged once.
- What is on sale defaults to `MVP_SCOPE`: the 10 nodes, plus Holster Rig L1 and Crown Lamp L1.

**Pass 2: selling (`economy/selling.ts`, `room/moon-room-sim.ts`).**
- **Assay Counter, hold E to pour.** Conditions: within 2.5 m, carrying nothing, and a free pour slot (data `assayCounter.pourSlots`).
  - The equipped Cell drains first, then any other Cell.
  - A full Cell drains in `pourS` × `pourTimeMult` (Quick Pour), rounded up to whole grams per tick, so a pour can end up to 2 ticks early.
  - Lumens are credited each tick (finer than the 0.5 s increments the spec asks for), so the tick-up is live.
  - Events: `cargo.pour_started` (slot 1–4) when the pour starts, and one `cargo.sold` (`assay_counter`) when it ends: on release, when the player leaves reach, or when the Cells are empty.
- **Receiving Gate / Dump Plate.** A loose puck or stack within 2 m of a Gate is sold on arrival (`cargo.sold`, `receiving_gate`, seller = last handler). Despawn credit in `cargo.pendingGateGrams` is sold into the first Gate (actor `null`).
- **Price.** Material `lmPerKg` × (1 + board `payoutBonus`, Rate Review). The wallet stays whole: each seller keeps a micro-Lumen remainder, so a sale split over many ticks pays the same as one sale.
- **Railshot.** Every `railshotEveryKg` (2 t) sold at the outpost emits `railshot.fired`. It is an event only.
- **Roost purchase.** Item `robot.sandpiper`: purchasable from the start with money, price round(4,500 × 1.15^owned), `cap_reached` at `MVP_SCOPE.roostCap` (3). The count goes into `ShiftState.robotCounts` and is saved in the META key list. Placement and the robot itself belong to the robot task.
- **Hash.** Pour state, Railshot progress and the Roost count are hashed only when non-zero, so the hash of a shift that never sold is unchanged.

**Pass 3: exploration, achievements, roles.**
- **Near Parcels (`economy/parcels.ts`).** `MVP_SCOPE.nearParcelCount` = 6 parcels, 30 LM each (collectibles.json).
  - Placed 30–300 m around the Boreal pad. Placement is deterministic per Contract (FNV-1a of `contractId` seeds splitmix32) and uses the sim's table trig.
  - Walking within the cargo `pickupRadiusM` (1.5 m) pays the parcel once and emits `collectible.found` (`stray_cargo` / `near_parcel`).
  - The collected bitmask is saved (META key `strayCargo.near_parcel`) and hashed when non-zero.
  - For rendering: `nearParcelCount` and `nearParcel(k, out)`.
  - The task card says 12 parcels; scope-tiers §1 and `MVP_SCOPE` say 6. The code follows `MVP_SCOPE`.
- **Achievements (`economy/achievements.ts`).** Driven by game-data `stat` and `threshold` for `MVP_SCOPE.achievementIds`: First Light (`strokes`), Stamped (`plotsPolished` credited to the player), Shift Work (`shiftPlayers` ≥ 2).
  - `achievement.unlocked` is emitted once per slot. The announced mask per slot is saved (META `ach.<slot>`), so a restore never announces one twice.
  - Counts restart at 0 after a restore, which is fine for the MVP thresholds.
  - The hot path is allocation-free.
  - The card asks for 10 triggers; scope-tiers cut them to 3.
- **Role checks.** A `temp` buying a shared item (board node, suit gear, Roost) gets `role_blocked` unless `tempCanSpendShared` is set. Own tools are allowed. The new `setTempPermissions()` sets the flags (hosts apply them between ticks), and `ShiftState.permissions` reflects them.

**Pass 4: Holster gating, Loaner Kit, Stamped test, V3 printout.**
- **Holster gating (owner decision 2026-11-15, relayed by the lead).** Without a Holster Rig a player carries 1 tool. A newly bought tool replaces the one in hand and is equipped at once. The Rig adds slots (sizes from suit-gear `holsterSlots`; base 1 from progression §7).
  - Each player's holster is a bitmask of carried tool codes. It is saved in META (`hol.<slot>`), checked as untrusted on restore, and hashed when it holds more than the equipped tool.
  - Standard Issue tools go to other members as owned. They carry one only if a slot is free.
  - A `purchase` of a tool the player owns but does not carry is a free hand-over at the Desk (`purchase.completed`, price 0).
  - Holster keys and `select_tool` cycle only through the carried tools.
- **Loaner Kit.** A Temp's own tool purchases are refused with `cap_reached` above min(walletFrac × wallet, capLm) per windowS (game-data: 0.02, 25,000 LM, 600 s). Since config contract v1.1 landed (M1-contracts-loanerkit), the sim reads `data.moderation.loanerKit.*` directly, with `windowTicks = round(windowS × tickHz)`. The spec fallback is gone. Re-verified after that change: tsc and eslint clean, vitest 153/153, goldens at the new hashes.
- **Tests.** Stamped: a player-credited Stamp unlocks it once; a Flock Stamp unlocks nothing. Holster: replace, auto-equip, hand-over, Rig slot, checkpoint round trip. Loaner Kit cap: Temp refused, Staff allowed, enough wallet allowed.

## Not done / limits
- **Client golden constants need the new values:** `apps/client/src/sim-host/browser/sim-host.worker-lane.ts` (outside my paths; owner: sim-host).
- **Client prediction does not model Holster gating yet:** `apps/client/src/gameplay/avatar/solo-predictor.ts`. The tool switch arrives with the authoritative state.
- **Permissions are not saved.** Temp permissions are not part of the save; hosts re-apply them.
- **Stamped has no dedicated test.** It is a one-line hook on the existing Stamp credit.
- **Stand-in outpost layout.** No outpost layout exists, so the default sell points are the Assay Counter on the Boreal pole pad and four Gates 15 m out. Default spawns are about 56 m from the pad. Hosts can pass `sellPoints`. The world or visuals owner should provide the real layout.
- **Interaction geometry is hard-coded.** The 2.5 m reach and 2 m Dump Plate radius are feel-spec constants; no data table has them yet.
- **Transient state is not saved.** Railshot progress, the replay ring, the race window and the sub-Lumen sale remainders are lost on save; that is under 1 LM per seller. A pour in progress restarts from the held E after a restore.
- **No pour queue.** A fifth player at a full counter simply cannot pour (`UiAssayState.queuePos` stays 0).

## Evidence
All runs use Node 26 (fnm PATH). Except where noted, they ran on this file state.

**`packages/sim`**
- `tsc --noEmit`: clean.
- `eslint src` and the new tests: clean.
- Full `vitest run` (golden and alloc tests included): **144/144**. This ran before a type-only fix to `selling.test.ts`; after the fix, `tsc` is clean and selling plus golden pass 9/9.

**Pass 3, on the final file state:**
- `tsc`: clean. `eslint src`: clean.
- `vitest run`: **148/148**, including goldens, the alloc test, and the new `test/unit/exploration.test.ts` (4 tests).
- During development a NaN radius once made actors collect every parcel. That changed the golden hash to 1416460264, which caught the bug; after the fix the goldens match again.
- A checkpoint test also caught First Light being re-announced after a restore. Saving the announced masks fixed it.
- `apps/client` and `apps/server` were not re-typechecked. All API changes are additive.

**Pass 4, on the final file state:**
- `tsc`: clean. `eslint src test`: clean.
- `vitest run`: **153/153**, including goldens, alloc and checkpoint tests.
- `tools/balance-sim/src/v3-mix.ts` (new, prints the world suite's V3 numbers): **worst mix-weighted ratio 0.825** (Moon mix T2: measured 1.197 vs rule 1.450). The bar is 0.80–1.20, and no other ratio is below 0.846.

**Goldens: re-recorded for Holster gating (owner-approved).** Old values are kept in comments in `test/golden/cases.ts`. Cause: the Squeegee bought at tick 400 is now equipped on that tick instead of at the `select_tool` at 420, which is now a no-op.

| Golden | Field | Old | New |
| --- | --- | --- | --- |
| GOLDEN_REPLAY | stateHash | 3938942926 | **1076468633** |
| GOLDEN_REPLAY | strokeHash | 786224438 | **4164540033** |
| GOLDEN_REPLAY | strokes | 3959 | 4023 |
| GOLDEN_REPLAY | grams | 55661 | 55784 |
| World ledger | stateHash | 3774476554 | **1838396500** |
| World ledger | strokeHash | 786224438 | 4164540033 |
| World ledger | strokes | 3959 | 4023 |
| World ledger | grams | 66779 | 66455 |
| World ledger | dustHash | 2946260242 | **2469925789** |
| World ledger | ledgers | 25 | 24 |

Restore at 10 points reproduces the new hashes.

**Goldens before pass 4:** unchanged, nothing re-recorded.
- `GOLDEN_REPLAY`: stateHash 3938942926, strokeHash 786224438.
- World ledger: stateHash 3774476554, dustHash 2946260242.
- No golden script pours or sells, and new state is hashed only when non-zero.

**V3:**
- `packages/world` "V3 reachability and design depth": **9/9 pass** (mix-weighted ≥ 0.80 × rule asserted).
- `tools/balance-sim` `dust-passes.ts`: per-class ratios as before, e.g. Mare T2 0.89 and Crater T3/T4 0.91 at spacing 1.
- The mix-weighted ratio is not printed. No dust or tool data changed, so it stays **0.825**.

**Balance-sim:** `cli.ts --assert`: all 9 MVP pacing rows PASS. Examples: first Dust Cell 8.87 min, first Roost 1.54 h solo / 0.65 h with 4 players. Report: `tools/balance-sim/out/report.md`.

## Files
- `packages/sim/src/economy/{board,purchase,selling,index}.ts`
- `packages/sim/src/cargo/pucks.ts` (adds `isLooseUnit`, `takeLooseUnit`)
- `packages/sim/src/room/moon-room-sim.ts`
- `packages/sim/src/economy/{parcels,achievements}.ts`
- `packages/sim/test/unit/{economy,selling,exploration,plot-events,room-sim,checkpoint}.test.ts`
- `packages/sim/test/golden/{cases,replay}.ts`
- `tools/balance-sim/src/v3-mix.ts`

Commit suggestion: `feat(sim): board/gear/Roost purchases, Assay pour, Gate intake and Railshot with race and replay guards`

## Pass 5: HUD read-outs (2026-11-15, Opus 5.5)
Requested by the integrator (M1-integrator-round5, round3-hud-writers). Additive, pure reads on `MoonRoomSim`: nothing hashed, no state change, no checkpoint change, no game-data change, no allocation per call.

| HUD need | API (exported from `@moon-cleanup/sim`) |
|---|---|
| Repeat Requisition / real price | `copiesBoughtOf(toolCode)`; `quotePriceLm(actor, itemId)` = what the next purchase charges (Rebate, Repeat Requisition, Roost growth); 0 = owned tool handed back free; -1 = not buyable (unknown, off sale, top level, cap, prereqs, carried). Wallet/role/race not checked. |
| Hop gauge | `hopReadout(slot, out: HopReadout)` -> `bursts`, `max` (0 = no Hop Pack, hide), `recharge01` (UI `rechargePct` = x100) |
| Crown Lamp | `lampReadout(slot, out: LampReadout)` -> `level`, `switchedOn`, `lit` (UI `lampMode` = lit ? "lamp" : "off") |
| Compass outposts | `outpostCount`, `outpost(k, out: OutpostReadout)` -> `id` ("Boreal"), unit `x,y,z`, `home`, `visited`. Option `outposts?: SimOutpost[]`, default `BOREAL_STAND_IN_OUTPOSTS`. Home is always visited; no non-home visit tracking (MVP has one outpost; Relay Pads post-MVP). Near Parcels already: `nearParcelCount`, `nearParcel(k, out)`. |
| Plot Card pick | `plotIdAt(x, y, z)` (world point, e.g. camera ray hit) -> PlotId or -1; `pickPlot(slot, out: PlotCardData, aimM?)` = plot `aimM` m ahead of the avatar facing (default: tool reticle distance). `PlotCardData` gains `countsTowardShine`, `shinePctPerPlot` (100 / plot count). False on the stand-in ledger. |

Not changed: `ShiftState.visitedOutposts` stays 0 in snapshots (moving it would touch protocol tests; read `outpost()` instead).

**Evidence:** `packages/sim` tsc clean, eslint clean, vitest 12 files / 161 tests pass (new `test/unit/hud-readouts.test.ts`, 8 tests: quotes equal charged prices incl. Repeat Requisition, hash unchanged by reads). Goldens unchanged: `replay.golden.test.ts` 2/2 with GOLDEN_REPLAY 1076468633/4164540033 and world ledger 1838396500/dustHash 2469925789; nothing re-recorded.

**Files:** `packages/sim/src/room/moon-room-sim.ts`, `packages/sim/src/index.ts`, `packages/sim/test/unit/hud-readouts.test.ts`.

**Next (integrator):** wire into the HUD writers; replace `BOREAL_STAND_IN_OUTPOSTS` and the sell-point stand-ins when the outpost layout lands.

## Pass 6: steady-state allocation regression (2026-11-15, Opus 5.5)

**Cause:** `alloc.test.ts` (bound 64 B/tick) failed at ~105 B/tick in `stepActor` when that function was still running as Maglev code during the measured window (likely when the machine is busy, as in a full verify). The sampling profiler credits functions inlined into a caller to the caller. Two leaks were found:
1. `stepActor`: the stick axes (`let mx/my`, reassigned under `ml > 1`) and `speedMult` (picked by a ternary, then `*=` under the Steep rule) were double phis. Maglev boxes those into a new HeapNumber on each actor-tick.
2. `tools/tool.ts`: `smoothstep01(t)` took a double and returned a double. When V8 did not inline it, both were boxed. This cost about 43 B/tick on the real-ledger leg (`smoothstep01` 21.6 B plus `stepToolHead` 21.5 B), which is close to the 64 B bound.

**Fix (behavior unchanged; the arithmetic and operation order are identical):**
- `stepActor` now writes the axes and speed multiplier straight into the `MoveIntent` double fields, with no phis.
- `MoveIntent` now gives `moveX`/`moveY` double field representation in its constructor, the same trick already used for `speedMult`.
- In `headPhaseIO`, the phase is read from `io[1]` and the smoothstep is computed in place. The public `headPhase` signature is unchanged.

**Evidence:** Sweep leg, 3 isolated runs plus the full suite: 26-31 B/tick after the fix (the 3 isolated runs before it measured 18-30 B/tick and passed; the 105 B failure did not reproduce in isolation). Residual `stepActor` ~18 B. Lope leg: 0 B/tick. Real-ledger leg: 2.6-4.9 B/tick (was 45-48). `packages/sim`: vitest 12 files / 161 tests pass, including `replay.golden.test.ts` with the goldens unchanged (1076468633/4164540033, 1838396500/2469925789). tsc and eslint are clean. No exports changed, so the apps/client sim-host was not re-run. I could not reproduce the 105 B case in isolation, so the Maglev explanation comes from `--trace-deopt`/inlining traces, not from a direct A/B.

**Files:** `packages/sim/src/room/moon-room-sim.ts`, `packages/sim/src/tools/tool.ts`, `packages/sim/src/movement/avatar.ts`.

**Next:** about 18 B/tick is still attributed to `stepActor` on the approx-ledger sweep leg, well under the 64 B bound. The exact site is unknown: it is probably something inlined from `stepToolHead`/`placeHead`. A follow-up could pin it with a direct A/B.

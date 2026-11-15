# M1-W3-T01d Plot events, Inspector's Stamp, board-driven Premium, Shine milestones, room ledger in packages/sim (gameplay-systems-engineer)

Task / status: **in-review** / 2026-11-14 / gameplay-systems-engineer / Opus 5.5 (resumed a stopped Fable run; leftovers done after the lead's follow-up)
Node 26.13.1 (fnm PATH prefix), Windows 11, headless Chromium. No git used. No edits to `apps/server`, `packages/world`, shared contracts, design docs or game-data. No server or browser left running.

## Done

### Kept from the stopped run (checked)

- `packages/sim/src/dust/room-ledger.ts` (`createRoomDustLedger`, `bakeCheckOf` and the rest) replaces `apps/client/src/sim-host/dust-ledger.ts`, which is deleted.
- `economy/stamp.ts`: `stampPayoutLm` / `stampIsCharged`.
- `MoonRoomSim.drainPlotEvents`: after every stroke it emits `plot.opened`, then for each Polished plot it pays the Stamp into the wallet and emits `plot.polished`. It empties the Opened / Polished queues; queues filled before the sim took the ledger are discarded.
- `worker-core.ts` empties only the dirty-plot list.

### Leftover 1: Board-driven Stamp Premium

- New `packages/sim/src/economy/board.ts` (`PromotionsBoard`). It resolves effects from `promotions-board.json` using the shared effect semantics:
  - the highest owned level of a node replaces its lower levels;
  - across nodes a stat is `((set ?? base) + sum of add) * product of mul`;
  - a flag counts while an active level lists it.
- The sim reads stat `stampPremiumLevel` and flag `golden_handshake_credit`. No node ids or values are hard-coded.
- The sim holds the shift's board levels as one byte per node:
  - new option `sharedUpgrades` (node id to level; unknown ids are ignored, levels clamped to the node's top level);
  - `ShiftState.sharedUpgrades` now mirrors the board (it was `{}`);
  - the checkpoint saves them in META v1's existing key/level list. Node ids never collide with gear keys, so the format stays the same; an older build counts them as ignored keys. A restore splits them back out.
- State hash: owned board levels are hashed. An empty board adds nothing, so both goldens are unchanged.
- The Stamp now uses the derived Premium level and Golden Handshake flag (§6 / §14):
  - player plots pay ×1.5 or ×2;
  - Flock plots pay ×1, or the Premium multiplier with Golden Handshake.

### Leftover 2: `shine.milestone`

- Fires when a Stamp moves the Shine numerator across a threshold from `plot-bonus.json` `shineMilestonesFrac`, plus 100 % at the full plot count. That 100 % is "Contract Fulfilled" in §13 and the event contract.
- Thresholds are computed in integer parts per million: `ceil(ppm × plots / 1e6)`.
- Shine numerator = Polished + Empty (WDS §263).
- Payload: `{tick, pct, polishedCount (Polished only), totalPlots}`. It comes right after the `plot.polished` that caused it.
- Milestones already reached when the sim is built, or after a checkpoint restore, are not announced again.
- New SimConfig field `shineMilestonesFrac`.

### Leftover 3: `polishedCount` without Empty plots

- The port `DustLedgerPlotEvents` gained `polishedTotal`, which `WorldDustLedger` already had.
- `plot.polished.polishedCount` and `shine.milestone.polishedCount` now count Polished plots only.

## Goldens

| Golden | Result |
| --- | --- |
| `GOLDEN_REPLAY` | 4037918216, **unchanged** |
| `GOLDEN_REPLAY_WORLD_LEDGER` | 634894361 / 2027053455 / 3975 / 67192 / 4087304160, **unchanged** |

Both checked in Node and in Chromium.

## Evidence (this file state)

- `packages/sim`: `tsc` 0, `eslint .` 0, prettier clean. vitest **106 / 106**, of which `plot-events.test.ts` has 26: Stamp rules, board effects, Premium I / II, Golden Handshake, clamping, board levels across a checkpoint, hash, polishedCount with Empty plots, milestones (fires once, not re-announced, 100 %, restore against a control), contract pcts, and the real-ledger Stamp at base and at Premium II. Browser lane, Chromium: 2 / 2.
- `apps/client`: `tsc` 0, eslint 0 on `src/sim-host`. `vitest run src/sim-host src/app/solo-host.test.ts`: 34 / 34, including the worker vs reference parity of `plotsOpened` / `plotsPolished`.
- `apps/server`: `tsc --noEmit` 0. This was only a compatibility check; nothing there was edited.
- Hot path: no change to per-stroke work. Board, Shine and payload work runs only on Polished transitions. The `stateHash` board loop does not allocate.
- Earlier run of this task: the worker-lane Chromium suite was 5 / 5 on two of three runs; the failure was one realtime latency assertion under load. It was not rerun after these changes.

## Questions for the lead (docs silent or contradictory; nothing invented)

1. **Who buys board levels?** Prices, prerequisites and race resolution of board purchases belong to M1-W6-T02 ("10 Promotions nodes"). Until then the levels come only from `sharedUpgrades` or a restored checkpoint, and the purchase intent still sells tools only. Should T01d also sell board nodes? If so, the sim must also apply the effects of nodes it does not implement yet (Cadence, Broad Strokes, Rebate and others), or the player pays for nothing.
2. **What does Shine count?** The naming bible says "% of plots Polished"; WDS §263 and data-model say "(Polished + Empty) / plot count". I followed WDS for the milestones. The `PlotPolishedEvent.polishedCount` comment in the shared contract ("Shine numerator") should be reworded by contracts-architect. `ShiftState.shinePolished` still carries Polished + Empty (netcode: Shine = ratio), while data-model calls the mirror the "Polished plot count".
3. **Dust Cell levels are stored twice.** Board nodes `node.dust_cell_*` and the sim's suit-gear keys `cellLevel.<toolId>` (the stat name) both exist. They were not merged here, to avoid changing restore behaviour; W6-T02 should choose one source.

## Not run

Root `pnpm verify`, Firefox, WebKit, the deployed build.

## Files

New: `packages/sim/src/economy/board.ts`, `packages/sim/test/unit/plot-events.test.ts`.
Changed in this task: `packages/sim/src/{economy/index.ts,config/sim-config.ts,dust/ledger-port.ts,room/moon-room-sim.ts}`, `apps/client/src/sim-host/sim-host.test.ts`, this report.
Verified from the earlier run: `packages/sim/src/{dust/room-ledger.ts,economy/stamp.ts,index.ts}`, `apps/client/src/sim-host/{worker-core.ts,messages.ts,test-support.ts}`, and the deletion of `apps/client/src/sim-host/dust-ledger.ts`.

Blockers: none for the code; questions 1 to 3 need a lead or owner decision.

# M1-W4-T03 Server ShiftRoom uses the shared room dust ledger (netcode-engineer)

Task / status: **in-review** / 2026-11-14 / netcode-engineer / Sonnet 5.5
Node via fnm PATH prefix, Windows 11. No git. Edits only in `apps/server/src/net/shift/`. No contract, packages/sim, packages/world or apps/client changes.

## Done

- New `shift-ledger.ts`: `createShiftLedger(data, world, tickHz)` calls `createRoomDustLedger` from `@moon-cleanup/sim` with 1024 pre-allocated ledger slots (`SHIFT_LEDGER_HEADROOM_SLOTS`, same as the Solo host). It throws a `TypeError` if `world.grid` is not the packages/world `IcoPlotGrid`.
- `shift-core.ts`:
  - `ShiftCore` builds the ledger (or takes `options.ledger`, a test seam) and passes it to `MoonRoomSim`.
  - The sim drains the Opened / Polished queues itself, pays the Stamp and emits `plot.opened` / `plot.polished`. These go through the existing `onSimEvent` into the `sim_events` batch. The core only calls `ledger.clearDirtyPlots()` once per tick, as worker-core does.
  - New `ledger` field and `ledgerPoolGrowths` ops counter.
- `shift-room.ts`: the Schema `shinePolished` is now synced on frame ticks from `sim.shinePolished`. The field is in the contract and was fixed at 0 before.
- Protocol: `plot.opened` and `plot.polished` are both in `WIRE_SIM_EVENT_NAMES`. No new message is needed. Only `dust.collected` is excluded, as before.

## Evidence

- New `shift-ledger.test.ts` (5 tests):
  - It uses a real `WorldDustLedger` with an initial world hash identical to Solo's.
  - It rejects a foreign grid.
  - `plot.opened` is emitted once per plot, credited to the sweeper, and the queues and dirty list end empty.
  - It matches a bare `MoonRoomSim` on `createRoomDustLedger` fed the same inputs (opened count, dust hash, state hash).
  - It checks tick cost (below).
- `shift-room.test.ts`: over ws, all 6 clients receive `plot.opened` in `sim_events`, with 0 pool growths.
- `vitest run src/net`: 14 files, 151 tests passed. `tsc --noEmit` is 0, `eslint src` is clean, prettier is clean.
- Tick cost, 6 sweeping players, 1200 ticks, headless Node:

| Run | p50 | p95 | max | heap delta |
| --- | --- | --- | --- | --- |
| With ledger | 0.097 ms | 0.254 ms | 1.104 ms | 1285 KiB |
| Pre-existing ShiftCore benchmark | 0.096 ms | 0.251 ms | 0.971 ms | 1507 KiB |

  The budget is 3.5 ms. The ledger pool growths were 0. The heap delta is no higher than the benchmark's, so the ledger adds no steady per-tick allocation. That figure was already there before this change; the bare sim shows 199 KiB.

## Left for W4-T04 / T06

1. Polished / Stamp over the wire is not exercised at server level. 6 bots opened only 2 plots in 60 s, so `plot.polished` is covered by the packages/sim tests only. A server test that finishes a plot needs a scripted dust install, which belongs to the dust or gameplay owner.
2. Dust streaming is still a stub. `dust_request` is dropped, and `dust.plots` (dirty list) and chunk streaming to late joiners are not sent. The dirty list is emptied per tick, so nothing accumulates. A joiner after the first strokes starts with a pristine client moon.
3. Persistence of the server ledger (checkpoint and restore) is not wired. A room restart resets dust.
4. Stamp Premium and Golden Handshake stay at 0 / off in the sim until the economy task feeds them. The server needs nothing extra.
5. Memory: about 1.3 MB reserved per room, up to 6 rooms at 6 players. Fine for the free tier. The `stats` sink does not report `ledgerPoolGrowths` yet.
6. Not run: root `pnpm verify`, a deployed or netsim run.

Blockers: none.

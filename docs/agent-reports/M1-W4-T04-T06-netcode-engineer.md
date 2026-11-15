# M1-W4-T04 / W4-T06 netcode (netcode-engineer)

**Status: W4-T06 netcode items done. W4-T04 client side done, with two exceptions: worker inflate (deliberately deferred, see below) and app wiring (integrator).**

Done:
- `plot.polished` wire test
- dust streaming to late joiners
- ledger persistence in process memory (durable storage stays with W5-T01)
- review S1
- review S2

Date and owner: 2026-11-15, netcode-engineer, Opus 5.5. No git. The sim and goldens were not touched.

In `packages/protocol` I changed only `codec/dust-messages.ts` and its test (brief widened by the coordinator for S2).

## Done

1. **Review S1: a timed-out connect was counted twice.**
   - Fixed in the adapter, `apps/client/src/net/room-session.ts`; protocol was not touched.
   - The adapter records `launchedAt` when it starts a connect attempt.
   - A failure that arrives after the core's connect timeout (`DEFAULT_CONNECT_TIMEOUT_MS` 15 s, or `sessionConfig.connectTimeoutMs`) is not reported again. The core counts that attempt exactly once, either way.
   - New test: `room-session.test.ts` "review S1". I checked that it fails without the fix.

2. **Dust streaming to late joiners (the stub is replaced).** New file `apps/server/src/net/shift/shift-dust.ts`, wired into `shift-core.ts` and `shift-room.ts`.
   - **DUST_SNAPSHOT** is sent on join, reconnect and resync (`visibility {hidden:false}`). It holds:
     - all plot states;
     - the remaining byte of every Opened plot;
     - the ledgers within 60 m.

     It is raw-deflated at zlib level 6 and sliced to at most 4 KB. `snapshotVersion` is the server tick.
   - **Snapshot limit:** at most one snapshot per seat per 2 s, and none while the tab is hidden.
   - **Streamed DUST_LEDGER:** ledgers out to the dust radius plus a 20 m margin, with 20 m leave hysteresis, at up to 8 KB/s per client.
   - **`dust.plots` FRAME section:** moon-wide L0 deltas at 2 Hz, 64 per frame, with a deduplicated backlog.
   - **DUST_REQUEST:** a plots request is answered with DUST_LEDGER. A chunk request is answered with a DUST_CHECK detail. Requests have their own token bucket; a malformed or over-rate request counts as a violation.
   - **Ordering rule:** all dust bytes are sent right after the FRAMEs of a frame tick. A client that applies messages in arrival order therefore never applies a stroke twice and never misses one.

3. **Ledger persistence.** New file `shift-persistence.ts`:
   - a `ShiftDustStore` port;
   - `MemoryShiftDustStore` (stores deflated chunks);
   - `ShiftDustPersistence`.

   How the room uses it:
   - On create, the room restores the ledger before the sim exists. The restore runs `DustRestoreJob` in 2 ms slices with a `setImmediate` between slices. No Stamp or milestone is replayed.
   - It saves the dirty chunks every 30 s while dirty, and on dispose.
   - Wiring: `ShiftServerOptions.dustStore`. `app/server.ts` passes a memory store.

4. **Review S2: encoders could emit what the decoders reject.** In `packages/protocol/src/codec/dust-messages.ts` the encoders now validate their input and refuse it:
   - `writeLedgerRaw` returns 0 when:
     - a contribution actor slot is above 15 (new constant `LEDGER_WIRE_ACTOR_SLOT_MAX`, also used by the decoder);
     - `ownedTexels` is above 1,024;
     - `remainingUnits` is above `initialUnits`.
   - `writeLogEntry` returns 0 when an entry has more than `DUST_LOG_MAX_CONTINUATIONS` (4,096) continuations in total.
   - Through those two, `encodeDustLedger` returns 0, `encodeDustLog` returns 0 and `encodeSnapshotRaw` returns null for such input.
   - The server producer also drops the shift contribution bucket (slot 16) before encoding.

## Tests (Node 26.13.1)

**apps/server**
- Full suite `vitest run`: **26 files, 312/312 pass**. This includes the async `onCreate` / `onDispose` change; there was no fallout.
- `eslint src/net src/app`: clean. `tsc --noEmit`: clean. `prettier --write` run on every touched file.
- `shift-dust.test.ts`, 3 tests at ShiftCore level:
  - **Late joiner:** every server ledger inside the joiner's 220 m radius matches on the client mirror (hash and state). Polished states match across the whole moon. The early joiner's `worldHash` equals the server's. 0 deltas dropped, 0 pool growths.
  - DUST_REQUEST answers.
  - Snapshot interval and hidden-tab rules.
- `shift-room.test.ts`, 2 new ws tests (8/8 in the file):
  - **`plot.polished` over the wire.** A plot is prepared as Polished-ready and credited to the seat. The seat's sweep stroke drains it. The client then receives `plot.polished` in `sim_events` with `{credit:"player", creditedSlot, polishedCount:1, stampLm>0}`. A FRAME `dust.plots` delta carries the plot with state 2. Schema `shinePolished` equals `ledger.shinePlots`, and `walletLumens` equals the sim wallet.
  - **Snapshot over ws, then a room restart.** The late joiner's assembled DUST_SNAPSHOT carries the room's ledgers, and their hashes match the server. When everyone leaves, the room disposes and saves. The next join creates a new room that restores the same ledger count and `worldHash`, with 0 `plot.opened` or `plot.polished` replayed.
- Measured in the late-joiner test:
  - Snapshot: 46,248 B raw, 646 B deflated, 1 slice.
  - Streamed ledgers: 5, 502 B in total.
  - **Late joiner total: 758 B/s**, of which frames are 700 B/s.
  - Snapshot build: about 2 ms warm under tsx. Under vitest it is 70–120 ms, almost all in the protocol helper `countOpened`, because of vitest's module transform. Deflate takes 0.4–0.6 ms.

**packages/protocol**
- Full `vitest run`: **10 files, 120/120 pass**. The golden and wire vectors are unchanged.
- New tests:
  - A log with exactly 4,096 continuations round-trips; one more is refused.
  - A ledger with actor slot 15 round-trips. Slot 16, owned texels above 1,024 and remaining above initial are each refused by both the ledger encoder and the snapshot encoder.
  - A snapshot with an over-cap log is refused.
- eslint, tsc and prettier are clean on the touched files.

**apps/client**
- `vitest run src/net`: 22/22 pass.
- `tsc --noEmit`: clean. `eslint src/net`: clean.

**Not run:** `pnpm verify`, netsim (120 ± 30 ms, 1 % loss), browser or deployed runs.

## W4-T04 client side (2026-11-15, second continuation)

New files are all in `apps/client/src/net/`. They are online-only: the barrel exports them, and nothing on the solo path constructs them.

**1. `inflate-raw.ts`: synchronous raw-DEFLATE decoder (RFC 1951).** This is now the default `RoomSessionOptions.inflate`.
- Behaviour:
  - capped by `maxBytes`;
  - never throws;
  - every loop consumes input or output, so it always terminates.
- Tests in `inflate-raw.test.ts`:
  - byte-exact against Node zlib for 240 cases: levels 0/1/6/9, strategies default/fixed/huffman-only, random, ledger-like, state-like and repeat-heavy data;
  - the `maxBytes` boundary;
  - a 4 MiB inflate bomb is refused;
  - truncations, 2,000 bit flips and 2,000 random inputs never throw.
- Speed: **6.5 ms for a 250 KB raw snapshot** (35.9 KB deflated, laptop). A typical 46 KB snapshot takes about 1.2 ms.

**2. `remote-dust.ts` (`RemoteDust`): the client dust mirror.** It applies the server's dust stream in arrival order:
- the snapshot: reset, Polished plots, ledgers, and an L0 overlay for plots without a ledger;
- FRAME strokes, through the same integer `applyStroke` the server runs;
- `dust.plots` deltas;
- DUST_LEDGER messages;
- DUST_CHECK detail, where a hash mismatch queues the plot and `nextRequest()` encodes the DUST_REQUEST.

`applyFrame` allocates nothing. Tests in `remote-dust.test.ts`, against a real MoonRoomSim with frames through FrameWriter/FrameReader:
- A late joiner ends with **`worldHash` equal** to the server's, and with equal states for every non-Grimy plot.
- 1,800 frames show a heap delta of -178 KB, so there is no per-frame garbage.
- The repair cycle works: check mismatch → request → ledger installed with an exact hash.
- A corrupt ledger is refused and counted.
- Overlay updates and the Polished latch both apply.

**3. `predictor.ts` (`OwnAvatarPredictor`): prediction with reconciliation.**
- How it works:
  - It runs the same `stepAvatar` and the same MoveIntent derivation as `MoonRoomSim.stepActor`.
  - A 64-entry ring stores each input and the full predicted state after it.
  - `reconcile` restores the state recorded after the acked input, overwrites the fields Self carries, and replays up to 16 unacked inputs.
  - The correction becomes a render offset with an 80 ms half-life.
- Tests in `predictor.test.ts`: authoritative MoonRoomSim over a simulated link (RTT 120 ± 30 ms, 1 % loss each way). The server side models a jitter buffer and repeats the last input when one is missing; inputs are sent with one previous input for redundancy. Self is quantised through the real frame codec.
- Results over 3 seeds × 2,400 ticks (walk, turn, sweep, jump):

| Measure | Result | Gate |
| --- | --- | --- |
| Correction p50 / p95 / p99 | 0.03 / **0.06** / 0.07 cm | p95 ≤ 5 cm |
| Correction max | 0.5 cm | |
| Max inputs replayed | 7 (none capped) | ≤ 16 |
| Unknown acks | 9 | |
| Reconcile time p95 | **0.063 ms** | ≤ 0.5 ms on device A |

  The replay cap of 16 has its own test.
- Caveat: the server's input sequencer is modelled in the test, because the client cannot import server code. Tool swap timers and the holster are not predicted; the tool comes in through `setTool` from Schema.

**4. Interpolation.** It already existed: the protocol `InterpolationBuffer`, fed by `RoomSession` and stepped by `updateInterpolation()`. No change was needed.

**5. Not done: worker inflate.** This was a deliberate choice.
- The server's ordering rule requires the client to apply the snapshot before any later FRAME strokes and DUST_LEDGERs. An asynchronous worker inflate would mean holding back and queueing every later dust message until the snapshot lands.
- The synchronous cost is about 1.2 ms for a typical snapshot (6.5 ms worst case at 250 KB raw). It only happens in online rooms, during joining or a resync.
- Proposed if the owner still wants it: a hold-back queue in `RoomSession` plus a module worker running `inflateRaw`.

**Checks (Node 26.13.1, apps/client):**
- `vitest run src/net`: **5 files, 32/32 pass**.
- `tsc --noEmit`: clean. `eslint src/net`: clean. prettier written.
- Not run: browser runs, a real netsim run, `pnpm verify`.

**Hooks needed outside my paths (not edited):**
- **apps/client/src/app (integrator, W4-T06):**
  - Create the online pieces only when a remote room is opened, ideally with a dynamic `import()` of `RoomSession`, `RemoteDust` and `OwnAvatarPredictor`. `modules.ts` imports the `../net` barrel; the new classes have no top-level side effects, so production tree-shaking drops them from the solo bundle when they are unused.
  - Wire `onDustSnapshot` → `remoteDust.installSnapshot`, `onFrame` → `remoteDust.applyFrame` plus `predictor.reconcile(view.self, view.ackInputSeq)`, and `onBytes` → `remoteDust.applyBytes`.
  - Send `nextRequest()` at most once per 2 s.
  - Call `predictor.predict` with every INPUT sent, and `predictor.setTool` from Schema `equippedTool`.
  - Set `expectDustSnapshot: true`; the server now streams the snapshot.
- **sim-host / dust-view owner:** feed the mirror's `ledger` to the dust view. Pass `clearDirty: false` when the view drains the dirty list itself.

## Open items

1. **W4-T04 leftovers:**
   - worker inflate (deferred; reason above);
   - app wiring (integrator; hooks above);
   - a real netsim and browser run.
2. **Durable persistence: W5-T01.** It needs:
   - a room-checkpoint write in packages/db (today the commit refuses non-solo Contracts);
   - a DB-backed `ShiftDustStore`;
   - a lease;
   - encoding sliced to at most 1.5 ms per tick.

   Until then, dust survives a room restart but not a process restart (Render free sleeps when idle). The room does not persist the wallet or the Dust Cells.
3. **Not done in streaming:**
   - stroke logs (DUST_LOG);
   - the periodic DUST_CHECK;
   - nearest-first order for streamed ledgers.

   Also, a newly touched plot's ledger is re-sent once to each nearby seat (about 100 B each). This is redundant but harmless.
4. **Protocol speed-up (optional):** `countOpened` should read `PlotState.Opened` into a local constant; it is slow under vitest.
5. **Review N3 (a stale snapshot can satisfy a resync) is not addressed.** It is in `packages/protocol` session code, outside the S2 widening.

## Files

**New**
- `apps/server/src/net/shift/shift-dust.ts`
- `apps/server/src/net/shift/shift-dust.test.ts`
- `apps/server/src/net/shift/shift-persistence.ts`

**Edited**
- `apps/server/src/net/shift/shift-core.ts`
- `apps/server/src/net/shift/shift-room.ts`
- `apps/server/src/net/shift/shift-room.test.ts`
- `apps/server/src/net/shift/index.ts`
- `apps/server/src/net/game-server.ts`
- `apps/server/src/app/server.ts`
- `apps/client/src/net/room-session.ts`
- `apps/client/src/net/room-session.test.ts`
- `packages/protocol/src/codec/dust-messages.ts`
- `packages/protocol/src/codec/dust-messages.test.ts`

Blockers: none. Next: integrator wires the online room into the app using the hooks above; then a browser 2-client run and a real netsim run.

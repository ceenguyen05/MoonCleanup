# M1-W4-T02: Server ShiftRoom (netcode-engineer)

Task / status: M1-W4-T02 / implemented, ready for review (wiring into `app/server.ts` and some spec items are open, see Gaps) / 2026-11-14 / netcode-engineer / Opus 5.5

Scope: new `apps/server/src/net/shift/**`; edits to `apps/server/src/net/game-server.ts` (optional `shift` option) and `apps/server/src/net/index.ts` (barrel). I did not touch packages/sim, packages/protocol, apps/client, api, db, app or STATUS. No git commands.

## What exists
- **`shift/shift-core.ts`**: `ShiftCore` runs the room without any transport. It owns `MoonRoomSim` and, per seat (6), an input sequencer, a slot table, an INPUT token bucket, entity interest and the dust radius. Each tick follows netcode section 3:
  1. Drain inputs.
  2. Apply queued intents in arrival order.
  3. `sim.step(cfg.dt)`.
  4. Collect strokes, storing the author's position for dust interest.
  5. Recompute interest for a staggered subset of seats (each seat every 0.5 s).
  6. On frame ticks, write one FRAME per client.

  FRAME details:
  - One `FrameWriter` is reused for every client. Colyseus `raw()` copies on send, so the buffer can be reused immediately.
  - Body views are cached per length, so no view object is created per send.
  - Contents: Self (own avatar and cellGrams), SlotChanges and avatar entity records for other players in interest, staggered 5 s keyframes, and spill-to-FULL when a record does not fit.
  - DustStrokes carry the player's own echoes always, and other players' strokes within the dust radius + 20 m.
  - Hidden tabs get a Self-only frame at 1 Hz and a keyframe when they come back.

  `sim_events` batches every event except `dust.collected`, at most 32 per message; the rest spill to the next frame tick.
- **`shift/input-sequencer.ts`** (section 5.1):
  - Accepts seqs up to 16 ahead, with wrap at 2^16.
  - Late inputs and duplicates are dropped and counted.
  - A missing seq is substituted (repeat the last input) up to 3 times, and the substitution consumes the seq.
  - After that, neutral input is applied without consuming seqs.
  - A starved seat resyncs when input resumes far ahead.
  - No allocation.
- **`shift/shift-room.ts`**: `ShiftRoom` (`shift`) is a thin Colyseus adapter.
  - Fixed-step loop: drift-compensated, at most 3 catch-up steps, each tick inside `batchMessages`.
  - Schema: `ShiftState` patched only on frame ticks (`patchRate = null`, encode once, no StateView).
  - `onAuth`: requires the single-use join ticket for (playerId from the reserved options, roomId, sessionId). A bad ticket is refused with `ServerError(4101)`.
  - Join errors: protocol mismatch closes with 4100 plus the mismatch info; a duplicate playerId closes the older socket with 4106; a 7th distinct player closes with 4105.
  - Seat hold: `onDrop` calls `allowReconnection(SEAT_HOLD_S)` and freezes the avatar on neutral input; `onReconnect` sends a keyframe.
  - Limits (section 11):
    - INPUT bucket of 1.5×/2× tick rate.
    - PING 2/s; control 10/s burst 20; purchase 5/s; visibility 1/s.
    - Every control message is zod-validated at the edge; invalid ones get `error INVALID` and count as a violation.
    - More than 50 violations in 10 s closes with 4104; more than 8 KB/s inbound for 5 s closes with 4104.
    - Unknown messages are dropped and counted (`*` and `onUnhandledMessage`).
  - Idle and AFK: `IdleWatch` (handshake/silence, 4107); the AFK rule sets the roster flag at 10 min and closes with 4107 at 30 min.
  - Holder-only messages: `set_shift_type` (solo only when alone) and `kick` (4102 plus `kick_notice`).
  - `DUST_REQUEST` is dropped without a violation (no ledger streaming yet).
  - Late-input deltas go to `stats.recordLateInputs`.
- **`shift/shift-state.ts`**: Colyseus Schema classes for ShiftState, PlayerInfo, VehicleInfo, Beacon and Permissions. A test checks the top-level field order and types against `SHIFT_STATE_SCHEMA_FIELDS`.
- **`shift/join-ticket.ts`**: HMAC-SHA256 over playerId | roomId | sessionId | exp, with a 30 s TTL. The key is random per process. Tickets are single use, compared in constant time, and the replay set is capped (fails closed).
- **`shift/shift-join.ts`**: `POST /v1/contracts/:id/join`.
  1. Per-IP limiter.
  2. Bearer check through the injected `verifyToken` (the JWT never appears in a URL).
  3. Injected `membership(playerId, contractId)` returns role, displayName and shiftType, or null (403).
  4. Seat reserved through the existing `Admission`: MAX_ROOMS, MAX_CLIENTS, per-IP seat cap and room-creation rate.
  5. Response: reservation, `joinTicket` and `role`, matching the `JoinContractResponseSchema` shape.

  The room is defined with `filterBy(["contractId"])`, which gives one room per Contract. `maxClients` is 7 so a second tab of a seated player can reach the same room and take over its seat; the core still seats at most 6.
- **`game-server.ts`**: new optional `shift: { data, world, verifyToken, membership?, stats?, idle?, seatHoldS?, tickets? }`. The join route is mounted only when `membership` is given.

## Evidence (Node 26.13.1, fnm prefix, apps/server, final file state)
- `tsc --noEmit -p apps/server`: clean. `eslint src/net`: clean. `prettier --check src/net`: clean.
- `vitest run` for the whole apps/server package: **22 files, 240 tests passed**. `src/net` alone: 12 files, 111 passed. The new shift tests are 14 (9 core, 5 room).
- **6-player tests:**
  - Core: 6 seats; a 7th is refused; 60 ticks of sweeping inputs.
  - Every FRAME decodes with the protocol `FrameReader` (FRAME_OK, ≤ 1,000 B, 30 frames per client in 3 s, ack and serverTick correct, slot table holds the 5 others, stroke chains present).
  - Room over the real `ws` transport with the Colyseus SDK: 6 REST joins land in one room; FRAMEs decode with acks; the Schema roster has 6 entries; purchase and select_tool/set_shift_type replies come back.
  - Close codes checked: 4106 duplicate takeover (same room), 4105 for the 7th player, 4100 mismatch, 4104 on malformed spam. The REST route answers 401, 403, 404 and 400; a forged ticket is rejected at onAuth.
- **Tick time, measured** (ShiftCore, 6 sweeping players, after 400 warm-up ticks, 1,200 ticks, this laptop, three idle runs): p50 0.08–0.10 ms, **p95 0.12–0.27 ms**, max 0.6–2.1 ms. One run with all suites in parallel had max 26 ms. The gate is p95 ≤ 3.5 ms: **PASS**, with a wide margin. This covers input decode, sequencing, sim step, interest and FRAME encode; it does not include Colyseus socket writes.
- **Live room loop over ws** (about 51 ticks, cold JIT, 6 SDK clients): p50 0.56–0.79 ms, p95 1.5–15 ms depending on parallel test load, 0 overruns. This is logged and only p50 is asserted; it is not a gate measurement.
- **Allocation:** over 1,200 ticks, heapUsed rose about 2.8 MiB with the core versus about 1.5 MiB for the bare `MoonRoomSim` with a listener and the same inputs. So the core adds roughly 1.1 KiB per tick. I removed the per-send view and the splice array; the remaining source is **not yet isolated**. Candidates: sim helper calls per entity record (`headingBasis`/`atan2Det`) and retained event objects. The sim's own allocation comes from event payloads: `dust.collected` builds a `plotIds` array whenever any listener exists, even though the room drops that event.
- **NOT RUN:** netsim (120 ± 30 ms, 1% loss); bytes/s per player for the real room; a 10-minute GC stall trace; uWS transport for ShiftRoom (the tests pin `ws`); a reconnect inside the seat hold over a real socket (only the core hold/resume is unit-tested); Render 0.1-CPU numbers.

## Gaps and requests (not done here)
1. **Wiring (integrator / app owner):** `app/server.ts` must pass `shift: { data: loadGameData(), world, verifyToken: app.verifyToken, membership }` to `createGameServer`.
   - `membership` needs a repo query (member role, ban, displayName, shiftType) from the api/db owner.
   - `world` needs the server world API (`apps/server/src/world` is empty): grid plus a `GroundHeight` from the bake.
2. **Lease, registry and saves (netcode section 9.3):** not implemented. Missing pieces: the DB lease CAS, `CONTRACT_BUSY`, `shutdown_notice` drain, and checkpoint/save loading (rooms start at the default wallet and tick 0).
   - One room per Contract relies on `filterBy(contractId)`. In the rare window where a room already holds 7 Colyseus clients, a new reservation would create a second room for the same Contract.
3. **Contract notes for contracts-architect and the client (W4-T04):**
   - (a) **Bytes body convention:** the Colyseus bytes payload is the protocol message WITHOUT its type byte, as PING/PONG already do. The client sends `sendBytes(0x01, encoded.subarray(1))`. For FRAME (sent as type 0x20), the client must put the 0x20 back in front before calling `FrameReader.decode`, or the reader gains a body variant.
   - (b) **Join ticket transport:** the ticket travels as the Colyseus auth token, which ends up in the `_authToken` URL query. That contradicts security.md ("the URL carries only the reservation id"). A single-use 30 s ticket is low risk, but this needs a ruling or an SDK-side change.
   - (c) **Nested Schema layout:** PlayerInfo, VehicleInfo, Beacon and Permissions follow the zod field order. Add them to `shift-state-schema` v1.
   - (d) **`purchase_result` code:** `RATE_LIMITED` may not be in `PurchaseResultPayloadSchema`; check it.
4. **Sim API requests (gameplay-systems-engineer):**
   - The "backlog > 4 consumes two seqs" rule needs a per-actor sub-step API; today a backlog drains one seq per tick.
   - Skip building `dust.collected` payloads for listeners that ignore them.
   - Expose a frozen/"signal lost" avatar flag for seat hold.
   - Quantise predicted state at tick end (section 2 server rule). Not verified here.
5. **Interest:** uses a horizon test with a 1.5 m height floor (no low-pass ground from the bake). The limit is about 195 m (min(400, d_vis)) plus 20 m hysteresis. Dust interest uses the author's position, not the plot centre. `ROSTER_MARKERS`, `DUST_CHECK`, ledger streaming and `DUST_SNAPSHOT` are not implemented (they wait on the ledger, W3-T01).
6. **Solo cost:** zero. Nothing here is imported by apps/client or LocalRoom. The room is registered only when `shift` is passed.
7. **Process-wide driver (W4-T03):** ShiftRoom owns its loop, like LoadTestRoom. When `apps/server/src/sim` lands, `ShiftCore.step(sink)` is the entry point it should call.

## Files
`apps/server/src/net/shift/{index,shift-core,shift-room,shift-state,shift-join,input-sequencer,join-ticket,token-bucket}.ts`, tests `shift/shift-core.test.ts` and `shift/shift-room.test.ts`; edited `apps/server/src/net/game-server.ts` and `apps/server/src/net/index.ts`.

Note: another worker was editing `packages/sim/src/room/moon-room-sim.ts` during this task (`hopMaxChargesOf`). One run failed transiently mid-edit; the final runs pass against the current file.

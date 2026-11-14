# M1-W4-T01 — packages/protocol codecs (netcode-engineer)

Task / status: **protocol package COMPLETE (codecs, session, interpolation, golden vectors), in-review** / 2026-11-14 / netcode-engineer / Sonnet 5.5. Only `packages/protocol/**` edited. Transport adapters (apps/*/src/net), room, bots and netsim numbers are NOT done. No git. Node 26.13.1.

## Done (packages/protocol/src, all exported from `index.ts`)
- `codec/bits.ts` integer-only (no double intermediates); `view.ts`; `quantize.ts` (documented precision; smallest-three quaternion; Float64Array-reading variants).
- `codec/input.ts`: INPUT encode/decode, byte-based, allocation-free, reusable `InputBatch`.
- `codec/frame-state.ts` (pooled structs, `SlotTable`, `FrameView`, proposed `FrameSource`), `dust-wire.ts` (stroke chains, robot intents, plot deltas), `frame-writer.ts`, `frame-reader.ts` (strict, capped, no throw).
- **New this turn:** `codec/dust-messages.ts` + `vectors/dust-vectors.ts`: DUST_REQUEST, DUST_CHECK (chunks and detail), DUST_LOG, DUST_LEDGER, DUST_SNAPSHOT slice + `SnapshotAssembler` (any order, version restart, capped) + SNAPSHOT RAW / LEDGER RAW / LOG ENTRY serialisers and decoders. Compression is injected (`Deflate` / `Inflate`; server zlib, client fflate in a worker), so the package stays Node/DOM-free. Layouts are documented in the file header.
- Golden vectors (`vectors/dust-vectors.ts`): request plots/chunk, check chunks/detail, snapshot slice, log (contains a stroke chain). Each checked against hand arithmetic and an independent BigInt reference packer in the test.

## Done in the remainder pass (packages/protocol/src, exported from `index.ts`)
- **Session state machine** `session/session.ts` (`ClientSession`, pure, no timers; the adapter feeds events and a 250 ms `tick(now)`, and executes `SessionHost` commands). Phases: idle, waking (healthz probe every 3 s, progress `wakeFraction`, 150 s budget), connecting (backoff 1/2/4/8 s, back to waking after 2 failures), joining (hello + keyframe FRAME + DUST_SNAPSHOT in any order, then `ready` once), joined, resyncing (non-keyframe FRAMEs dropped until a keyframe; snapshot awaited when expected), reconnecting (60 s seat hold, backoff 0.5/1/2/4/8 s, or SDK-driven with `driveReconnect:false`), failed (reason, retryable, retryAfterMs), closed. `classifyClose` maps every code of netcode.md section 12. Frame handling: duplicates and older ticks dropped, decode error or 5 s stall or tab-visible starts a resync (requests rate limited to 1/s, repeat after 4 s, fail after 5), `signalLost` after 1 s, PING burst of 4 at 500 ms then every 2 s, hello protocol check. Uses the existing `FrameReader`, `SlotTable` and `SnapshotAssembler`; compression injected (`inflate`). `onFrame` is zero-allocation (clock via `io[IO_NOW]`).
- **Interpolation buffer** `interpolation/interpolation-buffer.ts` + `clock-sync.ts`: 32-sample ring per slot (typed arrays, power of two), linear + shortest-arc yaw (avatars, robots), cubic Hermite with finite-difference tangents + quaternion slerp (vehicles), extrapolation 250 ms then hold, signal lost after 1 s; render timeline slewed 0.97 to 1.03 (snaps only above 1 s error, counted); delay target clamp(1.5 x snapshot interval + 2 x p95 jitter over 64 frames, 150 to 250 ms), starting at 200 ms; out-of-order and duplicate samples rejected per slot. `ClockSync`: PONG offset EMA (alpha 0.2) with best-RTT filter, jump snap above 500 ms, wrap-safe u32 echo, provisional offset from the first FRAME. The buffer uses `offset - rtt/2` (server time of data arriving now) so `delay` is the real distance behind the newest data.
- **Golden bytes** `vectors/frame-section-vectors.ts`: FRAME with strokes + robot intent + dust plot deltas (91 B), verified by hand and by an independent BigInt LSB-first packer. **Version tie**: `vectors/vectors.test.ts` pins an FNV-1a hash of every golden vector per `PROTOCOL_VERSION` (entry 1 = 998653946) and asserts `FRAME_SECTION_VECTORS_VERSION === PROTOCOL_VERSION`, so a wire change fails CI until the version is bumped and a new hash is recorded. No in-message version byte (decision: strict handshake equality + this hash; a byte per message costs bandwidth and the shared layouts have none).

### Evidence (remainder pass, Node 26.13.1, packages/protocol only)
| Check | Result |
| --- | --- |
| `vitest run` | PASS, 9 files / 111 tests (was 51) |
| `tsc -p`, `eslint .`, `prettier --check src` | PASS |
| Session transitions (wake, connect backoff, join order, resync, stall, hidden tab, reconnect, close codes, restore) | PASS, 33 tests |
| Out-of-order, duplicate, lost frames; ring wrap (100 frames into 32); slew bounds; extrapolate/hold/lost | PASS |
| Fuzz: 12,000 garbage/truncated/mutated messages through `onBytes` + `tick` in three phases | PASS, never throws |
| Allocation: `ingest` + `update` + 96 `sample` per iteration, 10,000 iterations (budget 1.5 MB, one boxed double per call would be above 16 MB); steady `onFrame` 40,000 calls under the 1.2 MB budget | PASS |
| Hermite error on a constant-acceleration path | below 2 cm (6.25 mm quantisation plus interpolation) |

### Flags [R] for contracts-architect and the server/client adapter owners
1. **No "request keyframe" message exists.** The session calls `host.requestResync`; proposed mapping: send `visibility {hidden:false}` (idempotent, server answers keyframe FRAME + fresh DUST_SNAPSHOT). Rate: 1/s, inside the `visibility` limit.
2. **Keyframe contract:** after join, resync and seat-hold reconnect the client resets its SlotTable and decodes from empty, so the server keyframe must re-send every slot assignment plus FULL records, starting from an empty client table (server must also reset its own table for that client).
3. Messages given to the session are whole catalog messages including the id byte (FrameReader and SnapshotAssembler require it); if the Colyseus adapter strips the id, it must restore it (or the server sends it inside the body).
4. Reconnect after a seat hold: the session expects a snapshot only when away more than 10 s (netcode.md 9.2); a late DUST_SNAPSHOT is still applied.
5. Server tick is not unwrapped (u32 wraps after 6.8 years at 20 Hz).

## FRAME encode allocation: FIXED
Cause: doubles passed as arguments to non-inlined calls (`posOwnToSteps(s.px)` etc.) are boxed into a HeapNumber (16 B each); about five boxed per Self, ~80 B/frame. Fix: the writer copies its doubles into a module `Float64Array` scratch and calls `*StepsAt(F, i)` (integer arguments, multiply inside the callee, int32 `Math.round(v) | 0` result). Standalone probe, 300k iterations: 83 B/frame before, 4 B (noise level, varies 0-4 between runs) after. The test now asserts encode and decode under the same 1.2 MB / 40k-call budget (min of 3 runs; V8 allocation accounting has a 0.2-0.9 MB noise floor). No `{x,y,z}` literals, spreads or closures were in the writer.

## Evidence (Node 26.13.1)
| Check | Result |
| --- | --- |
| `vitest run` packages/protocol | PASS, 6 files / 51 tests |
| `tsc -p packages/protocol`, `eslint .`, `prettier --check src` | PASS |
| `tsc` apps/server, tools/bots | PASS (exit 0) |
| Shared golden vectors byte for byte (INPUT x2, FRAME header, Self 21 B and 49 B, FULL avatar 13 B, slot change 6 B) | PASS, none wrong |
| INPUT encode/decode, FRAME encode, FRAME decode (also via an offset view) zero allocation | PASS (budget above; probe 0-4 B/frame) |
| Fuzz: 20,000 corrupt + 5,000 garbage FRAMEs, every-truncation for FRAME and each dust message, hostile counts and hostile inflate output | PASS, never throws |
| FRAME decode <= 0.2 ms A, bytes/s/player, ms/tick, netsim 120 ms +-30 ms 1 % loss with bots | **NOT RUN** (no timing benchmark, no bot run; needs T02 room and tools/bots v1) |

## NOT done
1. ~~Client session state machine and interpolation buffer~~ done (see the remainder pass above).
2. Real deflate in tests (identity deflate/inflate only; byte format of the compressed stream is the injector's choice, zlib/deflate recommended per WDS 5.1).
3. FRAME decode timing benchmark; bandwidth/CPU numbers.
4. ~~Golden vectors for FRAME stroke/robot/plot sections~~ done; version tie by pinned hash (no in-message byte, see above).
5. NOT run: netsim 120 ms +-30 ms / 1 % loss with bots, bytes/s/player and ms/tick for 16 bots, FRAME decode timing, p95 own-avatar correction (all need the T02 room, the apps/client/src/net adapter and tools/bots v1). The buffer and session were only exercised with synthetic jitter (up to 60 ms) in unit tests.
6. Adapters not written: Colyseus wiring of `SessionHost` (probe via fetch /healthz with 3 s timeout, `connect`, `sendReady`, visibility), the 250 ms tick timer, and the prediction/reconciliation hookup to `view.self` and `ackInputSeq` (sim-side).

## Proposal: hot-path frame source (netcode 18 item 6; for lead and sim owner)
`FrameSource` in `frame-state.ts` (local type, not in shared): `readSelf(actor, out: SelfState): boolean` (own avatar and, while driving, vehicle, quantized at tick end) and `readEntity(entityId, out: EntityState): number` (kind code or -1). `InterestService` owns per-client sets and the `SlotTable`; encoder calls `FrameWriter.slotAssign` then `writeEntity`. Strokes go in via a pooled `StrokeChainBuffer`. Rooms never call `RoomSim.snapshot()` per frame. Implementers must not pass doubles to non-inlined calls on this path (see fix above).

## Decisions flagged [R] for contracts-architect
- FRAME: strokes section starts with a u8 chain count; robot intents and dust plots have no count (length/20, length/4); entities start with u8 count. Slot-change record 44 bits padded to 6 B; release writes zeros. Delta class 3 = absolute 20-bit steps. REMOVE does not release the slot. A failing frame may leave the slot table partly updated: request a keyframe.
- Dust messages: DUST_REQUEST/CHECK bit-packed as in the header of `dust-messages.ts`; DUST_LOG/LEDGER/SNAPSHOT use u24 plot ids (byte oriented, cold path). LOG ENTRY carries `refTick` u32; strokes older than 255 ticks (12.75 s) decode as exactly 255 ticks old because the chain header tickOffset is 8-bit (affects only tick-keyed replay of old log strokes; ledger bytes are order-independent). Ledger contribution actorSlot is limited to 0-15 on decode (shared schema). Caps: 255 check chunks, 256 detail plots, 256 chains per log, 64 snapshot slices (~256 KB), 1,024 ledgers and 256 logs per snapshot, 1 MB inflated.
- Limits worth confirming: `DUST_REQUEST` is at most 20 B (budget 34).

## Files
`packages/protocol/src/{index.ts,test-env.d.ts}`; `src/codec/{bits,view,quantize,input,frame-state,dust-wire,frame-writer,frame-reader,dust-messages}.ts`; tests `src/codec/{frame,input,dust-messages}.test.ts`; helper `src/codec/test-util.ts` (test-only Node import, eslint-disabled line); `src/vectors/dust-vectors.ts`.

Next (exact): apps/client/src/net adapter over `ClientSession` + `InterpolationBuffer` (resolve flags 1 to 3 first); decode benchmark and bytes/s numbers with 16 bots once T02 exists; add real zlib/fflate round trip in apps/server and apps/client tests.
Commit suggestion: feat(protocol): INPUT, FRAME and dust message codecs with golden vectors, caps and zero-allocation hot path

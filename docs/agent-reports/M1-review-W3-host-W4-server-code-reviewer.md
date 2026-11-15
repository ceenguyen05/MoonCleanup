# M1 review: W3-T08 sim host, W4-T03 server ledger/validation, W4-T01 protocol, W5-T07 checkpoint REST (code-reviewer)

Status: partial review (stopped at turn limit) / 2026-11-15 / code-reviewer / Opus 5.5. Read-only; no git; no source edits.
**Focused vitest suites were NOT run** (stopped before running). All findings below come from reading the code. Restore-slice code was read but not judged, and the known 2 ms overshoot is excluded as briefed.

## Verdicts

| Task | Verdict | Why |
| --- | --- | --- |
| M1-W3-T08 | **CHANGES REQUESTED** | B1 (pause/resume race leaves Solo stuck paused; no test) |
| M1-W4-T03 | ACCEPT (server-ledger scope) | Validation is by construction; no defects found |
| M1-W4-T01 | ACCEPT (codec + interpolation read) | No defects found in interpolation; the codec bodies were not re-read |
| M1-W5-T07 (partial) | ACCEPT as partial | Caps are correct; boundary-test gap N5 |

## Blocking

**B1. W3-T08: pause/suspend followed quickly by resume leaves the game paused.**
- Worker side, `apps/client/src/sim-host/worker-core.ts:224-236`: `pause`/`suspend` calls `stopLoop()` at once. The worker sets `paused`/`suspended` only after the async checkpoint finishes (capture, gzip, IndexedDB).
- Host side, `apps/client/src/sim-host/local-room-host.ts:285-287`: `resume()` is forwarded only when the host state is already `paused`/`suspended`.
- Failure scenario: `pause()`, then `resume()` arrives before the checkpoint resolves (tens of ms or more with dust chunks):
  1. The host is still `running`, so the resume is dropped. Even if it were forwarded, the worker is still `running`, so it would ignore it.
  2. The checkpoint resolves, and the worker sets `paused` with the loop stopped.
  3. The Solo game stays frozen until a second resume.
- No test covers pause, resume or suspend at all (grep of `sim-host.test.ts`).
- Fix: set the paused state (or a pending-pause flag) synchronously on the worker and the host, and let `resume` cancel it. Add a pause→resume-before-ack test with the manual clock.

## Non-blocking notes

**W3-T08**
- N1, multi-listener frame lifetime (`local-room-host.ts:132-140, 342-353`). One `release()` from any listener returns the buffer to the worker for everyone. A second listener that holds the frame past dispatch (e.g. until rAF) then reads an emptied view, or, after the PooledFrame is recycled, a newer frame's bytes (ABA problem). A stale late `release()` on a recycled PooledFrame releases the *new* frame early.
  - The shared contract says "a second call is harmless". That holds only within one frame's lifetime.
  - Suggest per-listener refcount, or a defined "read inside the listener only" rule plus auto-release, before the integrator wires several consumers.
- N2, per-frame allocation (`local-room-host.ts:345`). `returnFrame` allocates `new ArrayBuffer(0)` on every release. Use a module constant, as `EMPTY_BYTES` already does.
- N3, worker frame pool (`worker-core.ts:207`). It accepts any FRAME-sized buffer without a bound. After a crash reboot, held frames from the old worker are returned to the new one, so the pool grows past 3. This is harmless but unbounded in principle. Cap it at `FRAME_POOL_SIZE` (plus slack).
- N4, uncapped header inflate (`worker-core.ts:304`). The local header `gunzip` has no cap; dust chunks are capped at 421,959 B via `inflateCapped`. A corrupt or hostile local save can only hurt the player's own tab. Suggest a `SAVE_HEADER_MAX_BYTES` cap for symmetry.
- Tick failure path (`worker-core.ts:515-517`). It posts `state: failed` and then `fatal`, so host listeners briefly see `failed` → `booting` during the one reboot. This is cosmetic.
- `close()` (`local-room-host.ts:296`). It leaves a 3 s `setTimeout` running after a normal close. Minor.
- Checked OK:
  - INPUT/FRAME buffers are transferred and not touched afterwards. The worker returns INPUT buffers, and the host caps its pool at 32.
  - Dirty marks are cleared at capture and restored on a failed write. Checkpoints are serialized by `ckptChain`.
  - Envelope CRC, version and lengths are verified. Restore-failure fallback starts fresh and reports it.
  - Timer checkpoints fire every 10 s when dirty, and `hidden` checkpoints come from `create-local-room-host.ts:87`.
  - No netcode objects sit on the Solo path beyond `encodeInput`/`FrameWriter`, which are measured as allocation-free.

**W4-T03**
- Speed, reach and tool are authoritative by construction: the sim clamps every input field (`packages/sim/src/room/moon-room-sim.ts:310-324`), movement and aim come from the sim, and tool use is gated by owned tools.
- Rate is limited by a per-seat token bucket. The sequencer drops late and too-far-ahead inputs, repeats ×3 and then goes neutral (`input-sequencer.ts`). Intents are zod-parsed and token-limited in `shift-room.ts`.
- `ShiftCore` buckets mix clocks: `addSeat`/`resumeSeat` default to `performance.now()`, while `receiveInput` uses `Date.now()` (`shift-core.ts:214,252,316`; `shift-room.ts:256,312,417`). This is benign today (the first take refills to burst) but fragile. Pass one clock everywhere. This is W4-T02 code.
- `intent.data as never` (`shift-room.ts:482`) has no justification comment. W4-T02 scope.
- The report is honest about the gaps: polished/Stamp is not tested at server level, dust streaming and persistence are not wired, and `ledgerPoolGrowths` is not in stats.

**W4-T01**
- Interpolation buffer, all OK:
  - Brackets and central-difference Hermite tangents are correct.
  - Hemisphere-corrected slerp, shortest-arc yaw, the 250 ms extrapolate/hold cap and 1 s lost are correct.
  - Slew is 0.97–1.03 with a snap above 1 s. Stale and duplicate samples are rejected per slot. Tables are preallocated.
- No defects found. FRAME decode ≤ 0.2 ms and the netsim numbers remain NOT RUN, as the author reports.

**W5-T07**
- N5, test gap: no boundary test exists for the per-chunk cap at exactly 421,959 B (accept) and 421,960 B (reject `size_limit`). That is the v1.1 widening, and v1.0 chunks are unaffected. There is also no test that 32 MiB of declared raw bytes is accepted while 32 MiB + 1 is rejected. Only the over-budget 641-chunk case is tested. Recommend adding both before calling the task complete.
- Checked OK:
  - Body cap 1,052,674, split, then strict UTF-8, JSON and zod.
  - Package CRC, then the declared-raw budget of 32 MiB (`service.ts:243-245`), before any inflate.
  - Per-chunk inflate bounded by the declared size, with `rawSize ≤ DUST_CHUNK_PAYLOAD_MAX_BYTES` (421,959, `mcck.ts:101`). Exact size and CRC are checked after inflate.
  - Header gunzip is bounded to `SAVE_HEADER_MAX_BYTES`. Newer `saveFormatVersion` gives 409, and v1 is required.
  - Generation arithmetic, origin `solo`, and bake/grid match.
  - Process-wide inflate budget with handoff concurrency. Playtime credit is bounded cumulatively, per account and per interval.
- Download page index can mix generations if an upload commits between page requests. Each page carries `generation`, so the client (W5-T08) must check it.

## Not done
- Did not run the focused vitest suites: sim-host, `apps/server/src/net/shift`, `apps/server/src/api/checkpoints`, packages/protocol.
- Did not re-read the protocol codec bodies, `dust-messages.ts`, `session.ts`, `checkpoint-store.ts` (IndexedDB transaction), `sim-frame-encoder.ts`, `input-queue.ts`, `fixed-step.ts` or `create-local-room-host.ts` (locks, persist).
- Did not check the scope or modification times of the touched files.

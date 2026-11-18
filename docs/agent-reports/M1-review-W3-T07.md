# M1 review: W3-T07 Solo custodian telemetry (code-reviewer)

Verdict: NO BLOCKERS. 3 non-blocking correctness/test findings, 2 perf notes. Read-only; nothing edited.

Evidence run (Node 22 shell, vitest 5.1): `tool-telemetry.test.ts`, `sim-frame-encoder.test.ts`, `solo-avatar.test.ts` = 3 files / 17 tests pass; `sim-host.test.ts` = 32 pass. (No `local-room-host.test.ts` / `worker-core.test.ts` exist.)

## Checklist results
- Trailer layout: FRAME_TRAILER_BYTES 40 = 8 head + 32 telemetry (flags/code/phase/period/seq 8 B, 3 x f64 = 24 B). Offsets in tool-telemetry.ts:85-97 match messages.ts:41-51. OK.
- Bounds/back-compat: `readToolTelemetry` guards `u8.length < base+32` and PRESENT bit (tool-telemetry.ts:118), so a short/old buffer invalidates. In practice an old 8-byte-trailer buffer never reaches it: pool size check `byteLength !== FRAME_BUF_BYTES` (local-room-host.ts:384, 466; worker-core.ts:217) and SIM_HOST_PROTOCOL_VERSION=4 mismatch throws (worker-core.ts:300). The guard is defence in depth only. OK.
- Phase derivation: sweeping branch is identical to packages/sim tools/tool.ts:251-252 (`((seq - seqAtToolDown)&0xffff)*stepMs % period`); `wasActive` is post-step state so inactive/swap/non-cleaning tools report no work; contact/head flags gated on active. OK. `this.input.seq` (worker-core.ts:593) is the input consumed this tick (nextForTick at :533), same tick as step. OK.
- Allocation: worker write and main decode are allocation-free (reused scratch Float64/Uint8, one reused snapshot, `mapper.point` writes into `input.headTarget`, `head` is a preallocated Float64Array). Solo feed provider allocs nothing. OK.
- Stale handling: serial-stall timeout 0.25 s, lastSerial retained so same serial cannot restart (solo-avatar.ts:97-109); tested (solo-avatar.test.ts:207). Provider resets state when host not local/predictor not ready/driving. OK.
- Disposal: SoloAvatarModule.dispose unsubscribes host/shift, disposes view, cast, animation (:258-267). OK.

## Findings (severity ranked, all non-blocking)

1. MEDIUM, detailing phase wraps early. solo-avatar.ts:113-114. Detailing telemetry phase is `1 - cd/period`, which sits at exactly 1.0 while waiting for the next stroke tick or after cooldown ends (tool-telemetry.ts:75-76). The feed then adds `ahead/periodS` and wraps via `phase -= floor(phase)`, so the pose restarts at ~0 before the disc fires (visual strike/disc desync, flicker at 20 Hz). Fix: when `tele.detailing`, `phase = Math.min(1, tele.phase01 + ahead/periodS)` (no wrap); keep the wrap for sweeping. Add a test with `phase01 = 1`, detailing.

2. MEDIUM (feel risk), head target is 20 Hz and un-extrapolated while feet are 60 Hz predicted. solo-avatar.ts:119-124 maps the authoritative head (<= 50 ms + transport old) and uses it directly, but `input.pos` is the presented predicted feet. At running speed the head can trail the feet by roughly 0.3 m and step at 20 Hz (visible broom-head swim/jitter), contradicting the solo-first feel goal. Fix (cheap, still non-speculative on tool state): keep the feet position at the telemetry tick (or the delta predicted feet minus feet at serial arrival) and add that delta to `headTarget`, or smooth `headTarget` toward the new sample over one tick. Needs a visual lab check; no test covers head lag.

3. LOW (test gap), no end-to-end test that the real worker writes the trailer from a live sim and `LocalRoomHostImpl.toolAnim` decodes it. tool-telemetry.test.ts uses a fake source; sim-host.test.ts has no `toolAnim` assertion (grep: none). A wiring slip (e.g. wrong seq, SELF slot) would pass. Add one sim-host test: equip desk duster, hold tool input N ticks, assert `host.toolAnim.valid/sweeping`, `periodMs`, `phase01 === ((N*stepMs)%period)/period`, serial increments; and assert idle -> `sweeping=false`.

4. LOW, headX/Y/Z are written even when `headValid` is false (stale or zero) and decoded unconditionally; harmless because the feed gates on `headValid`, but the snapshot should zero them or document it (tool-telemetry.ts:95-97, 133-135).

5. LOW, `periodMs` is clamped to 0xffff for the wire (tool-telemetry.ts:90) while phase is computed against the unclamped period; consistent only while all periods < 65 s. Fine today; add an assertion/test over `config.tools` if tool data can grow. Float64 scratch assumes platform LE for both write and read (same machine, OK) though messages.ts says LE.

## Perf notes (pre-existing, not introduced by W3-T07)
- worker-core.ts:578 and local-room-host.ts:556 create `new Uint8Array(buf)` per frame (20 Hz, tiny). Could cache one view per pooled buffer (3 buffers) to make the frame path allocation-free, in keeping with "reuse hot-path buffers".
- Frames received with no listener still run `readToolTelemetry` (cheap, 32 B). No solo input-delay or frame-time risk found; no netcode on the solo path.

## Report honesty
Reports' claims (allocation-free trailer, authoritative-only tool work, stale handling) match the code. The claim "phase mirrors sim" is true for sweeping; detailing phase is an approximation derived from cooldown (finding 1).

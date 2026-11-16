# M1 dust hardening review (code-reviewer)

Verdict: APPROVED (no blockers). Three non-blocking findings, N1 recommended before the Nov 17 demo.

Scope: `apps/server/src/net/shift/shift-core.ts` (F1 egress budget, F2 chunk-request gate) and `apps/client/src/net/remote-dust.ts` (F4 want expiry). Read-only.

## Starvation analysis (the key risk)

- First join is never starved. `addSeat` sets `snapshotCredit = 96 KB` (shift-core.ts:383). The gate is `credit <= 0` (:686), so any single snapshot, including a 261 KB worst case, is sent in full. The debt model charges after the send (:699). Only the next resync is delayed.
- Typical snapshots are 15-25 KB (pacing test, 6 slices). A legit player has the burst for about 4 back-to-back resyncs, then one 25 KB resync per ~6 s. That is fine.
- Refill (:663-670) runs for every active seat before the hidden/held `continue`, so a hidden or held seat earns credit while away. It is tick-driven (`SNAPSHOT_EGRESS_BYTES_PER_S / snapshotHz` per frame tick), with no wall clock and no allocation. Float math is bounded by `Math.min(BURST, ...)`, and no NaN source exists (snapshotHz is a constant).
- Pending requests do not deadlock. `dustSnapshot` stays true, `continue` at :686 happens before `snapshotBuilt = true` (so it does not block other seats' builds that frame), and credit rises monotonically while the seat is active. A removed seat drops the request, and a new occupant gets a full budget.
- Deadlock-free interaction with DUST_CHECK/requests. While a snapshot is pending, the seat streams nothing and gets no 0x24 chunk checks (the existing `continue`). Client DUST_REQUESTs still enqueue (`sent[p]=2`) but are stale-safe: the snapshot build refills `sent`, and queue entries with `sent !== 2` are skipped (:714). The client `installSnapshot` clears `wanted`, `wantedTries` and `wantedChunks` (remote-dust.ts:151-155), so the F4 expiry cannot lose a want across a resync.

## Findings

N1 (non-blocking, recommended): the worst-case wait (~40 s) hits legit heavy cleaners on resync.
- A seat whose first snapshot is large (up to `DUST_SNAPSHOT_MAX_LEDGERS` 1024 / 64 slices = 261 KB) goes to about -163 KB credit. Any unhide (tab switch; the hidden path thins frames, so strokes are missed and the resync is needed) or in-hold reconnect (`resumeSeat`, :409-418, does NOT reset credit) then waits up to ~40 s.
- During that time a reconnected client has `ready=false`, so it applies no strokes and shows no ledger detail. Only the 2 Hz moon-wide L0 overlay shows. An unhidden tab keeps the stale ledger, and frames still carry strokes (cosmetic drift, sim stays authoritative). Not a deadlock, but a visible "dust looks wrong for 40 s" in the demo scenario (a player who cleans a lot and tabs away).
- The charge is also taken for a snapshot that is then dropped by a superseding resync or by hide (`:673`, `requestDustSnapshot` :617). A paced snapshot on a slow socket plus a tab switch is double-charged.
- Suggestions (pick one): (a) exempt the first snapshot after `resumeSeat` by resetting `snapshotCredit` to at least 0 there, since a reconnect is a new socket; (b) floor the debt, `credit = Math.max(credit - bytes, -BURST/3)` (:699), capping the wait at ~8 s while still bounding sustained egress at roughly 4 KB/s plus a bounded burst; (c) do not charge when the snapshot is dropped unsent. A test that asserts the ~40 s actually elapses would then be replaced by a bound.

N2 (non-blocking): leave and rejoin gives a full budget (:383), so the cap is bypassable by a hostile client that reconnects. Join/reconnect rate is a separate edge limit, so the real exposure is bounded. Cheap fix if wanted: keep credit per seat slot on `removeSeat` for a short period (not required).

N3 (non-blocking, test weakness): `shift-dust-pacing.test.ts:224-228` asserts only "1 snapshot after 60 ticks, 2 after 45 s". It does not pin the ~40 s wait nor that it is not earlier (an unlimited impl would fail only the first check). It is meaningful for F1 but loose. The F4 client test (3 requests then the chunk request) is a meaningful, deterministic test. One client nit: `nextRequest` increments tries only for the first 8 wanted, so plots 9+ cannot expire until promoted; this is fine since they will be requested in later calls.

## Other checklist items

- F2 (:738-739): `sent === null` skips the chunk detail, so "all plots" is not listed. Correct; the 0x24 repair path is unchanged for seats with a snapshot.
- Boundaries and solo: only server net and client online-only files touched; `remote-dust.ts` is online-only (header says solo never imports it); no imports changed. No hot-path allocation added (server: a field and arithmetic). The client `splice` is event-time and only runs on expiry.
- Contracts/shared/secrets: untouched.
- Report honesty: matches code. The "(about 40 s)" statement is accurate: (261 KB - 96 KB) / 4 KB/s ≈ 40 s.

## Verification (Node 22.20 was the tool-shell node; Node 26 was not on PATH)

- apps/server `vitest run src/net/shift`: 8 files, 63 tests passed.
- apps/client `vitest run src/net`: first run under load, 2 tests failed in session/transport files outside the change set (e.g. a `closeCode 4100` assertion near session.wake, timing-sensitive; same class as the author's note). `remote-dust.test.ts` rerun alone: 7/7 passed.

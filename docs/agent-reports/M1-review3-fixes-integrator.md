# M1-review3 fixes: integrator

Status: **PASS** for F1, F2, F3 (all three claims verified correct and fixed). Focused tests, tsc and eslint are clean. No full `pnpm verify` run (not requested).

## F1: stop() during Solo host boot (confirmed, fixed)
- Claim verified: `solo-host.ts` `stop()` returned `Promise.resolve()` when `host === null`, and the late host was closed with a hard-coded `clock_out` and not awaited.
- Fix, `apps/client/src/app/solo-host.ts`:
  - The boot task is now a `booted` promise.
  - `stop(reason)` records the reason, and when the host is still booting it returns `booted`.
  - `booted` closes the late host with that reason and awaits `close()`, so the Web Lock is released before `stop()` resolves.
  - Repeated `stop()` calls return the same promise.
  - Net effect: after `stop("conflict_resolved")`, the install port no longer proceeds with a live old host. The late host skips its checkpoint, so it cannot overwrite the installed copy and does not hold the lock.
- Test, `solo-host.test.ts`: "stop(reason) during boot waits for the late host…". The test:
  - calls `stop("conflict_resolved")` before `createLocalRoomHost` resolves;
  - asserts `stop` stays pending;
  - asserts the late host is closed once, with `conflict_resolved`;
  - asserts `stop` and a second `stop()` both resolve only after `close` finishes.
  - Old code would fail it, since `stop` resolved immediately.
- The existing "closes a host whose creation finished after stop" test still passes.

## F2: install through a memory store (confirmed, fixed)
- Claim verified: `boot.ts` `hostStore()` uses `openCheckpointStore("auto")`, which falls back to `MemoryCheckpointStore` (`kind: "memory"`), and the worker host reads only its own IndexedDB.
- Fix, no edit in `save-sync-wiring*` (netcode owns it):
  - New `apps/client/src/app/install-guard.ts` with `assertInstallableStore`.
  - `boot.ts` `stopHost` for the install port now calls it first. A memory store throws before the host is stopped.
  - The install port's `stopHost()` sits outside its `try`, so `startHost()` is skipped and the running host is untouched. The rejection reaches the sync controller as a failed restore with a clear message.
- Test, `install-guard.test.ts`: indexeddb is accepted, memory is rejected with the "unchanged" message, and an open failure is passed through.
- Not covered: the `boot.ts` wiring itself (one call). It is checked by the tsc and boot-wiring tests only.

## F3: dust snapshot cap (confirmed, fixed)
- Claim verified: per ledger 3 + 23 + 1024 = 1050 bytes, up to 1070. 1024 ledgers is at least 1,075,200 bytes, which is above `1 << 20` (1,048,576). The plot-state arrays add up to about 200 KB at 163,842 plots.
- The server (`shift-dust.ts` `buildSnapshotRaw`) allows 1024 ledgers.
- The client inflate cap is `DUST_SNAPSHOT_MAX_RAW_BYTES`.
- Fix, `packages/protocol/src/codec/dust-messages.ts`:
  - The cap is now `3 << 19` (1.5 MiB), above a full snapshot.
  - The comment is rewritten; it wrongly said 256 KB.
  - `encodeSnapshotRaw` returns null when the total exceeds the cap. The decoder would refuse such a snapshot anyway, and the server counts it as a snapshot failure.
- Test, `dust-messages.test.ts`:
  - A snapshot with 1024 full ledgers (4 contributions) at 163,842 plots exceeds 1 MiB.
  - It encodes, stays at or under the cap, and decodes with an inflate that enforces the cap.
  - The same ledgers plus 256 logs of 255 chains return null.

## Numbers
- `apps/client`: `solo-host.test.ts`, `install-guard.test.ts` and `boot-wiring.test.ts` pass, 17 tests. `solo-host.test.ts` after the final edit: 10 tests.
- `packages/protocol`: all 10 test files pass, 121 tests.
- Client `room-session`, `remote-dust` and `online-room` tests pass, 29 tests.
- tsc: `packages/protocol` is clean. `apps/client` was clean at the end.
  - It showed one error mid-run in `src/gameplay/tmp-alloc.test.ts` (an unterminated string, another agent's temp file). The file was gone on the re-run.
- eslint on all touched files: clean after one fix of an unused parameter in my new test.

## Files touched
- `apps/client/src/app/solo-host.ts`
- `apps/client/src/app/solo-host.test.ts`
- `apps/client/src/app/boot.ts`
- `apps/client/src/app/install-guard.ts` (new)
- `apps/client/src/app/install-guard.test.ts` (new)
- `packages/protocol/src/codec/dust-messages.ts`
- `packages/protocol/src/codec/dust-messages.test.ts`

## Open or for others
- The 1.5 MiB cap changes a protocol constant. If `docs/` states the 1 MiB value, contracts-architect should confirm it. I searched the code and found no other users of the constant.
- F4 to F10 were not in scope. F10 (`save-sync-wiring.ts:42`, `stopHost()` outside the `try`) is now partly relied on by F2: a rejected `stopHost` intentionally skips `startHost`. Netcode should keep that behaviour if it changes the install port.

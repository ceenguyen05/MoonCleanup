# M1 flaky tests and W5-T08 sign-in sync: netcode-engineer

**Status:** done; one wiring step for the lead (boot.ts, see section 4). Date: 2026-11-15. Model: Sonnet 5.5. No git run. `packages/sim` and goldens untouched; no visuals, terrain, dust or render files touched.

## 1. Flaky vitest failures (two causes, both fixed)

Reproduced with `vitest run --root apps/client src/app src/net src/sim-host src/sync`: run 1 failed and a 10-run loop failed once more.

| Test | Failure | Root cause | Fix |
|---|---|---|---|
| `sync/save-sync.test.ts` "restores a multi-page save" | `server.uploads` had 1 entry, expected 2 | `test-support.ts` `settle()` waited a fixed 8 x 4 ms of real time. Under parallel load, gzip streams for the 3 x 400 KB random chunks outlast that, so the second upload was not finished when the assertion ran. | `settle()` keeps the 8 ticks, then waits until `ui.state` is not `uploading` and no fetch is in flight (3 quiet ticks, 20 s cap). The device now counts requests in flight. |
| `app/online-room.test.ts` "snapshot fills the mirror..." | Timed out at 5000 ms | Each `OnlineRoom` builds the standard plot grid (163842 plots). That takes about 1.3 s alone, and a test takes 2 to 3 s alone (measured). Under load that exceeds 5 s. | `describe` timeout is 60 s (`ROOM_TEST_TIMEOUT_MS`), with a comment. Product code unchanged. Memoizing `createPlotGrid` in `online-room.ts` would cut the cost; I did not change it. |

The earlier T04b note ("1 of 49 failed") is very likely the same online-room timeout.

**Evidence:** after the fixes and the new tests, 12 consecutive runs of the same four directories passed: 20 files, 175 tests each. `tsc --noEmit -p apps/client` is clean, `eslint` on the touched paths is clean, and Prettier was applied.

## 2. W5-T08: does `notifyAuthChanged` retry and upload? It did not reliably; fixed

**Findings**
- `notifyAuthChanged()` itself works: it clears `nextAttemptAtMs`, then `kick` and `schedule` run the head check and the upload.
- **Bug:** in `sync/save-sync.ts`, an auth failure (`failure.auth`) sets no backoff, because `nextAttemptAtMs` stays 0. The boot order is `clockIn(maxWaitMs: 0)` plus `signIn()` running together, so the head check runs signed out. After that failure `schedule()` armed a zero-delay timer, the head check failed again without a network call, and the timer re-armed again. The result is a tight timer loop with a `save.upload_failed` event and a UI dispatch each time, for as long as the guest sign-in takes (up to about a minute on a cold Render instance). In the virtual-clock test the loop never ended.
- **Fix:** `Runtime.authHeld`, set when a failure is auth. `schedule()` arms nothing while it is set. It is cleared by `notifyAuthChanged`, a new `save.checkpointed`, or an explicit `flush`. A network or 5xx failure still goes through the normal 30 s to 5 min backoff.
- **Second gap:** `signIn()` returns false on a network failure, and boot never retried it. The queue stayed held until the next page load. I added `signInUntilReady` in `app/save-sync-wiring.ts`. It retries with a delay that doubles from 30 s to a 5 min cap, calls `notify` on success, and returns a stop function.

**Tests (all new)**
- `sync/save-sync-auth.test.ts` (3 tests):
  - Clock In signed out is held, with at most 3 token requests over 10 virtual minutes. After sign-in, `notifyAuthChanged` runs the head check and uploads generation 1, and the state is `synced`.
  - A token lost mid-session holds the queue with no further attempts, and the notify uploads generation 2.
  - A sleeping server after sign-in is retried with backoff.
  - With the fix disabled, 2 of 3 fail: the first hangs in the loop, the second makes 7 token requests where at most 4 are allowed.
- `app/save-sync-wiring.test.ts`: 3 tests for `signInUntilReady` (notify once on success; doubling delay then notify; thrown error reported, retry continues, and a stopped retry does not notify).

## 3. Follow-up: first upload of an unseen solo Contract (done)

**What the server needs** (read from `apps/server/src/api/contracts.ts` and `checkpoints/service.ts`):
- A Contract row must exist before the head check, an upload or a download. Otherwise those routes answer 404 `NOT_FOUND`.
- The row is created with `POST /v1/contracts` and the body `{ name, shiftType: "solo", clientContractId: <UUID>, seed: <decimal string, 0 to 2^64-1> }`. The `name` is 3 to 32 characters (letters, digits, space, `_.-`). The call is idempotent by `clientContractId` (201 on create, 200 if it already exists) and is limited to 3 owned Contracts.
- The upload then needs the caller to be the holder and the shift type to be `solo`. The save header must match the row's `gridM` and `plotCount`; the server does not check the header against the row's seed.

**Gap found:** the client sent no `registration` at Clock In. In `sync/meta-store.ts`, `emptyMeta(id, null)` sets `registered: true`, so the first sync would treat the Contract as already registered. It would never call `POST /v1/contracts`, and the real server would answer 404 to every request. FakeServer tests hid this because they create the Contract first. Any `setMeta` also persists `registered: true`, so one boot without a registration blocks registering later.

**Fix:** `soloRegistration(contractId, name = "My Moon")` in `app/save-sync-wiring.ts` returns `{ name, seed }`. The seed is the low 64 bits of the Contract id as a decimal string, so it is valid and the same on every device (the solo world is a fixed bake). Pass it to `clockIn`; it is safe on every boot.

**Tests** in `app/save-sync-wiring.test.ts`:
- The helper's body parses with the shared `CreateContractRequestSchema`, the seed is below 2^64, and it is stable.
- Against FakeServer with no Contract: Clock In registers first (`POST /v1/contracts` is the first request) and then uploads. A second device that passes the registration does not create a second row.
- Without a registration nothing uploads, which demonstrates the gap.

**Not done: a test against the real server API harness.** `createHarness` lives in `apps/server`, and the client must not import another app. The server-side rules above come from reading the code. A cross-check belongs in `apps/server/src` or `tests/`, owned by backend or qa. FakeServer's `register` uses the shared schema, so the request shape is checked.

**Residual risk:** `api.head` maps every 404 to "no save", so a Contract row missing for any other reason also looks like "no save yet". The registration flag is the only guard.

**Evidence:** `vitest run --root apps/client src/app/save-sync-wiring src/sync`: 4 files, 46 tests passed. `tsc --noEmit -p apps/client` is clean, `eslint` on the two app files is clean, and Prettier was applied.

## 4. Exact `boot.ts` edits for the lead to apply (`startCheckpointSync`)

1. Import: add `signInUntilReady,` and `soloRegistration,` to the `./save-sync-wiring` import list (it currently ends `saveEventForwarder, storeReader`).
2. Teardown: replace
```ts
    const offRequests = bindSaveSyncRequests(d.store, sync, d.onProblem);
    teardown = () => {
      offRequests();
```
with
```ts
    const offRequests = bindSaveSyncRequests(d.store, sync, d.onProblem);
    let stopSignIn: () => void = () => undefined;
    teardown = () => {
      stopSignIn();
      offRequests();
```
3. Clock In and sign-in: replace the block from `void sync` to `.catch((error: unknown) => d.onProblem("guest sign-in", error));` with
```ts
    void sync
      .clockIn(d.identity.contractId, { registration: soloRegistration(d.identity.contractId), maxWaitMs: 0 })
      .catch((error: unknown) => d.onProblem("save sync", error));
    stopSignIn = signInUntilReady({
      signIn: () => auth.signIn(),
      notify: () => {
        if (!disposed) sync.notifyAuthChanged();
      },
      onProblem: d.onProblem,
    });
```

## Files

- `apps/client/src/sync/save-sync.ts`: `authHeld`.
- `apps/client/src/sync/test-support.ts`: `settle()`.
- `apps/client/src/sync/save-sync-auth.test.ts`: new.
- `apps/client/src/app/save-sync-wiring.ts` and `save-sync-wiring.test.ts`: `signInUntilReady`, `soloRegistration` and tests.
- `apps/client/src/app/online-room.test.ts`: timeout.

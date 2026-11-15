# M1-W5-T07b - Security residuals R1, R2, R3 (backend-data-engineer)

Date 2026-11-14. Sonnet 5.5. No git run. Source: `M1-W4-T02-review-netcode-security-reviewer.md` (re-review residuals R1-R3).

## Status: PARTIAL. R1 and R3 are done and live in the code path. R2 is built and tested at the api level but NOT wired end to end: it needs a small patch in files outside my ownership (below). The same wiring is also needed for R1's env values to reach the service.

## What changed

### R1 - process-wide inflate budget (done)
- New `apps/server/src/api/checkpoints/inflate-budget.ts` (`createInflateBudget`). It replaces `exclusive.ts`, which I deleted.
  - **Concurrency:** at most `maxConcurrent` jobs inflate at once (default 1) and at most `maxQueued` wait (default 3). Ownership is handed straight to the next waiter, so the L1 fix is kept. Beyond that a job is shed.
  - **Rate:** a token bucket of `bytesPerMinute` inflated bytes, shared by every upload and download in the process. The job is charged its worst-case inflated size before it runs. If the bucket cannot cover it, the job is shed at once (never queued) with a `retry-after` computed from the refill, capped at 60 s. A job larger than the bucket is clamped to it, so it runs alone and never starves.
- `service.ts`: upload charges `declaredRaw` plus the header size claimed by the gzip trailer (the real inflate stays bounded at 1 MiB whatever the trailer says). Download charges the stored header `rawSize` per slot, since it only gunzips headers. A shed answers 503 `RETRY_LATER` with `retry-after`.
- The 32 MiB per-upload cap is unchanged and is still a code constant.
- **Defaults, sized for 512 MB / 0.1 CPU Render Free (NODE_OPTIONS max-old-space-size=384):**
  - 32 MiB per minute, i.e. one maximum upload's worth of inflate per minute for the whole process.
  - Concurrency 1, queue 3.
  - The basis is the reviewer's measurement of about 14 ms per MiB on a laptop core and roughly 10x that on the free instance, so a maximum upload is about 4 s of the 6 CPU-seconds a minute that 0.1 CPU gives.
  - A typical mid-game upload inflates about 3 MiB (data-model 5.1), so several solo players saving every 30 s still fit.
  - Memory is not what this guards. One chunk is inflated at a time (at most 256 KiB) plus the request body of at most 1 MiB, so even concurrency 4 stays far below the heap cap.
- **Env (ops/env.ts, `.env.example`, `render.yaml`, placeholders only, no secrets):**
  - `CHECKPOINT_INFLATE_MIB_PER_MIN` (1-1024, default 32).
  - `CHECKPOINT_INFLATE_CONCURRENCY` (1-4, default 1).
  - `CHECKPOINT_INFLATE_QUEUE` (0-16, default 3).
  - `ServerEnv` fields: `checkpointInflateMibPerMin`, `checkpointInflateConcurrency`, `checkpointInflateQueue`. They are also in `describeEnvForLog`.
- **Known tradeoff:** a few guest accounts can still use up the shared per-minute budget, and every account then gets 503 until it refills. This is an upload-availability trade for protecting the room tick. The per-player limits still apply, and guest creation is still limited per IP.

### R3 - account-wide playtime credit (done)
- New repository method `getPlaytimeLedger(playerId)` returns `{ accountCreatedAt, contractsPlaytimeS }`. The sum is `contracts.playtime_s` over every Contract the player owns, any status, so deleting a Contract does not give the time back. It uses the existing `contracts_owner_player_id_idx`. **No schema change and no migration.** Implemented in `packages/db` types, memory and Postgres repos, and covered by the shared suite (memory and PGlite).
- `service.ts` adds a third bound on top of the per-Contract age bound and the per-interval bound. Total claimed playtime across the account's Contracts cannot exceed `accountAge x 1.05 + 120 s`. The slack is spent once per account. An overshoot is flagged `solo_implausible` and credits nothing, as before.
- A per-player in-process lock now serializes the credit decision and the commit. Without it, three simultaneous uploads for three Contracts would each see the same total and each claim the full remaining room.
  - **Assumption:** this relies on the single-instance deployment (ADR-0029). A second instance would need a DB lock on the player row.
- **Side effect:** the mirror stores the claimed playtime, as before. One wildly inflated claim therefore uses up the account's room permanently and costs that player credit on all Contracts. It is only reachable by a cheater, who already earns nothing from it. I did not change the mirror semantics.

### R2 - slot-acquisition churn limit (built, not wired)
- `rate-limits.ts`: new rules `uploadSlotAccount` (12 per minute, 120 per hour) and `uploadSlotIp` (30 per minute). New `rateKeyForIp` groups IPv6 by /64 with the same normalisation as the net `ipSlotKey`.
- New `api/upload-admission.ts` (`createUploadAdmission`), exposed as `AccountApi.admitRawUpload(token, remoteAddress)`.
  - It verifies the token. A forged or expired token returns `null` (the transport answers 401) and consumes nothing.
  - Then it spends one point per account, then one per address /64.
  - It returns the playerId, or `{ rateLimited: true, retryAfterS }`, and audits `rate_limited`.
  - An unauthenticated client therefore cannot spend anyone's allowance.
- **NOT wired.** The transport takes the slot in `net/http-routes.ts` (`executeRoute`), and the composition root passes `rawBodyAuth` in `app/server.ts`. Both are outside my ownership. A guarded edit from me was refused by the auto-mode classifier, so I stopped there instead of working around it.

## Patch the lead needs applied (net + app, about 20 lines; I did not apply it)
1. `apps/server/src/net/http-routes.ts`:
   - Replace the `RawBodyAuth` type with
     `(token: string, remoteAddress: string) => Promise<string | RawBodyRefusal | null>`.
   - Add `export interface RawBodyRefusal { readonly rateLimited: true; readonly retryAfterS: number }`.
   - In `executeRoute`:
     - Call `verify(authorization.slice(7).trim(), remoteAddress)`.
     - After the `null` check, add `if (typeof verified === "object") { bodyRead?.discard(); return { status: 429, headers: { "retry-after": String(Math.max(1, Math.ceil(verified.retryAfterS))) }, body: errorBody("RATE_LIMITED", "too many upload attempts") }; }`.
     - Declare `let verified: string | RawBodyRefusal | null`.
   - Existing callers still type-check, because a one-argument verifier is assignable to the two-argument type.
2. `apps/server/src/app/server.ts`:
   - Change `rawBodyAuth` to `account.admitRawUpload`.
   - Pass this to `createAccountApi`: `checkpoints: { inflateBytesPerMinute: env.checkpointInflateMibPerMin * 1024 * 1024, inflateMaxConcurrent: env.checkpointInflateConcurrency, maxQueued: env.checkpointInflateQueue }`.
   - Until this lands, the budget runs on its code defaults, which equal the env defaults and the `render.yaml` values.
3. Suggested net test: a raw upload with an admission that refuses answers 429 + `retry-after`, takes no slot, and discards the held body.

## Tests added (all pass)
- `api/checkpoints/checkpoints.test.ts`:
  - The L1 exclusivity tests are rewritten against the budget (depths 0-7, shed beyond the queue, recovery, concurrency 2, slot released when a job throws).
  - Byte budget: shed with a computed `retry-after` and continuous refill; an over-sized job is clamped.
  - Cross-account sharing: the second guest is shed with 503 and nothing is stored; it succeeds after the refill.
  - A download is charged only its header size.
  - R3: three Contracts created together credit real time once; simultaneous uploads are serialized and credit once; sequential real play across Contracts is still credited in full.
- `api/upload-admission.test.ts` (new):
  - `rateKeyForIp` forms.
  - A forged token consumes nothing.
  - The per-account limit (12 per minute) with `retry-after` and an audit.
  - The per-/64 limit across six accounts; a different /64 has its own allowance.
  - `admitRawUpload` on the API object.
- `ops/env.test.ts`: defaults, overrides, blank = default, range refusals.
- `packages/db/src/repositories/save-suite.ts`: `getPlaytimeLedger` on memory and PGlite (age, sum across two Contracts, unknown player is null, no cross-player leak).

## Evidence (Node 26.13.1, same file state)
- `apps/server`: `tsc --noEmit` clean. `vitest run` (whole package) 24 files, 298 passed.
- `eslint` on `apps/server/src/api`, `apps/server/src/ops` and `packages/db/src`: clean. `prettier --write` applied to the touched paths.
- `packages/db`: `tsc --noEmit` clean. `vitest run` 6 files, 97 passed, 2 skipped (the pre-existing real-server suites).

## NOT run / not done
- R2 end to end over a real socket (needs the patch above). No net-level test was written, because net is not mine.
- Render 0.1 CPU timing. The 32 MiB per minute default comes from the reviewer's laptop measurement scaled by an assumed 10x, not from a Render run.
- Real Postgres with `postgres.js` and multi-session contention. The R3 lock is in-process only.
- Browser CORS, and `pnpm verify` (not requested).
- No migration was needed. `packages/shared` was not touched.

## Files
- New: `apps/server/src/api/checkpoints/inflate-budget.ts`, `apps/server/src/api/upload-admission.ts`, `apps/server/src/api/upload-admission.test.ts`.
- Deleted: `apps/server/src/api/checkpoints/exclusive.ts`.
- Changed:
  - `apps/server/src/api/checkpoints/{service.ts,checkpoints.test.ts}`
  - `apps/server/src/api/{rate-limits.ts,service.ts,index.ts}`
  - `apps/server/src/ops/{env.ts,env.test.ts}`
  - `apps/server/.env.example`
  - `render.yaml`
  - `packages/db/src/repositories/{types.ts,memory.ts,postgres.ts,save-suite.ts}`

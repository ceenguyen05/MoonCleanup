# M1 review - M1-W4-T05 (DB/auth/REST + wiring) and M1-W7-T05 (audio)

Task / status: review (read-only) / 2026-11-14 / code-reviewer / Opus 5.5
Scope reviewed: the three author reports; `apps/server/src/api/{crypto,tokens,accounts,contracts,http,rate-limits,service}.ts`; `packages/db/src/repositories/{types,rotation,postgres,memory,factory}.ts`; `packages/db/src/schema/{identity,contracts}.ts`; `packages/db/src/{connection,errors}.ts`; `apps/server/src/app/server.ts` (lines 60-180); `packages/shared/src/api/rest.ts` (header, 270-430); test names in auth/contracts tests and the shared repo suite; audio `module.ts` (update/dispose/env) and import edges of `apps/client/src/audio/**`. No source edited, no tests re-run (I re-used the authors' gate evidence), no git.

## Verdicts
- **M1-W4-T05: CHANGES REQUESTED.** One blocking item: it no longer matches the contract. Auth and token security is sound.
- **M1-W4-T05 server wiring: ACCEPT**, with non-blocking notes.
- **M1-W7-T05: PARTIAL REVIEW, nothing blocking found in what I reached.** It cannot be called `done` until the acceptance items the author marks NOT RUN are run (CPU ≤ 0.3 ms in a browser, listening and loudness). See "Not reached".

## Blocking

**B1 - The API does not follow REST contract v0.3.0, which landed after this code.** `rest.ts` was bumped at 07:25. The api files were last written at 06:20.
- `apps/server/src/api/accounts.ts:233-236`: a stale `PATCH /v1/me` still answers `409 {error:"BAD_REQUEST"}`. The contract (`rest.ts:5-10, 181-182, 341`) now requires `VERSION_CONFLICT`.
  - Failure: the client retry loop named in the contract (refetch `/v1/me`, reapply, resend) keys on `VERSION_CONFLICT`. It will treat the conflict as a permanent 400-class error, so a profile edit is lost whenever an in-room flush bumps `version`.
  - Fix: `fail("VERSION_CONFLICT", "stale version")`, plus a test assertion in `auth.test.ts` at "PATCH enforces optimistic concurrency".
- `apps/server/src/api/contracts.ts:123-128`: `GET /v1/contracts/:id` returns a bare `toSummary`. `GetContractResponseSchema` (`rest.ts:370-377`) now carries `inviteCode` for the Holder of a Private Shift.
  - Failure: after a reload, a Holder has no way to see the current invite code. The only option is to rotate it, which invalidates links already shared.
  - Fix: add `inviteCode: c.role === "holder" && c.shiftType === "private" ? c.inviteCode : null`, plus a test that Staff never receive it.

This is a consumer update the contracts bump asked for, not an original author defect. The row should still not move to `done` until it is applied.

## Non-blocking (W4-T05)

1. **Grace window and stolen tokens** (`packages/db/src/repositories/rotation.ts:38-46`). A thief who presents the predecessor within 60 s of a legitimate rotation gets a reissue. The legitimate successor is revoked as `superseded`, and the victim's later use of it is plain `invalid` (rule 1). That revokes no family and raises no audit, so the thief keeps the session. security.md section 3 accepts this trade-off.
   - Suggestion: when a revoked token with `revoke_reason = 'superseded'` is presented, treat it as reuse (revoke the family and audit it). The revoke reason is already stored.
2. **Ancestors inside the window get `superseded`.** With chain g→a→b, presenting g within 60 s returns `superseded` (`rotation.ts:50`). The spec says tokens older than the immediate predecessor count as theft. The suite's "older ancestor" test (`contract-suite.ts:221-239`) only checks after the window (t+70 s). The harm is small because 409 issues no token, but the test name overstates what it covers.
3. **The purge never runs on Render free** (`apps/server/src/app/server.ts:133-144`). The 24 h `setInterval` is in-process, and the free service sleeps after about 15 min idle and restarts on wake, so it almost never reaches 24 h uptime. Refresh-token rows will grow without bound.
   - Suggestion: run the purge opportunistically, for example at most once per day on the first authenticated request after the DB is up, or from the existing daily job.
4. **Purge removes the evidence for reuse detection.** `REFRESH_RETENTION_DAYS = 7` (`types.ts:229`) deletes replaced rows, so a token stolen more than 7 days after rotation is `invalid` rather than `reuse_detected`. This matches the spec; recorded so the trade-off is visible.
5. **`purge failed` logs the raw error object** (`server.ts:140`, `{ err }`). `errors.ts:2-3` says driver messages can contain host names, and `http.ts:103` logs only `errorCodeForLog`. Use the same pattern here, unless the pino redaction in `ops/redact.ts` is confirmed to scrub `err.message`.
6. **Banned members still take seats.** `postgres.ts:530-534` and `memory.ts:431` count all member rows, banned ones included, against `maxPlayers`. A Private Shift with banned players fills early. Consider filtering on `status = 'active'` (a spec decision).
7. **Idempotent replays use up the daily create budget.** `contracts.ts:83` consumes `contractCreate` before the repository reports `existing`, so client retries of one `clientContractId` count against the 10/day limit. `createContract` also returns `existing` for a soft-deleted Contract (`postgres.ts:364-368`).
8. **Switching private→solo leaves Staff as active members** (`postgres.ts:492-496`). Staff keep seeing a Solo Contract in their list with `maxPlayers` 1. Confirm against data-model section 3.6.
9. **Two size checks can disagree** (`accounts.ts:216` vs `identity.ts:122`). The API checks JSON bytes (≤ 1024) but the database checks `pg_column_size(jsonb)` (≤ 1024), and these can differ, so a borderline payload could trip the CHECK and return a bare 500. Unreachable today: guests own no cosmetics, so any equip fails the ownership check.
10. **Join codes are not Crockford-normalised** (`contracts.ts:168`). Only `toUpperCase()` is applied. `InviteCodeSchema` already rejects I/L/O/U, so typos are 400s rather than wrong joins. Cosmetic.
11. **Migration 0001 was edited by hand** (author decision 1). The acceptance criterion says "generated migrations". The edits (search_path FKs, `SET STORAGE EXTERNAL`) are justified, but a future `drizzle-kit generate` diff check could flag drift. Keep the note in the migration header.
12. **Memory and Postgres purge differ at the boundary.** Memory uses `expiresAt <= now` (`memory.ts:303`), Postgres uses `lt` (`postgres.ts:350`). Only an exact-millisecond tie differs.

Checked and fine:
- HS256 is pinned, with `iss`/`aud`/`exp`/`jti` required. The previous secret is accepted for verification only, and every failure gives a uniform 401 (`tokens.ts:42-77`).
- Random values come from a CSPRNG with no modulo bias (`crypto.ts:10-16`). Refresh tokens and recovery codes are peppered HMACs; raw values only ever appear in the creating response.
- Unique indexes on token hash and on (provider, subject). Row locks on rotation, recovery, quota, join and rotate. Database clock.
- Unknown logout is still 204. Join failures (unknown code, deleted Contract, banned caller) all return 404.
- The 503 mapping logs only the error code.
- Boundaries: `packages/db` has no DOM or three.js, and the server API pulls nothing from the client.

The test suites cover every acceptance criterion: tables and migrations, guest/refresh/JWT/`verifyToken`, contracts and profile, rate limits, and PGlite against schema `_a5`. The authors' NOT RUN list (real postgres.js, multi-session contention, Neon TLS) is reported honestly and remains open.

## Wiring (W4-T05 integrator)
- Accept. The memory/postgres selection is correct, and env validation requires `DATABASE_URL` for postgres (`ops/env.ts:194-195`). `factory.ts:15` calls `connection.db()` eagerly, but postgres.js is lazy, so no connection opens at boot.
- Open, not a defect: there is no room `onAuth` consumer of `verifyToken` yet. M1-W4-T06 and W8 must wire it, together with the join ticket from security.md section 3.

## M1-W7-T05 (audio)
Reached:
- **Boundaries clean.** The audio files import only `@moon-cleanup/shared` and siblings (tests also use `../app/event-bus`). No net, three.js or db imports. DOM access sits behind the `browserEnv(window)` seam (`module.ts:335-353`), which is allowed in the client.
- **Frame cost.** `update()` (`module.ts:133-144`) is throttled by `TICK_S` and allocates nothing itself. I did not read the inner `router.tick` / `music.tick` / `ducker.apply` / `CuePlayer.play` paths for allocations.
- **Disposal.** `dispose()` (`module.ts:146-165`) releases subscriptions, gesture and visibility listeners, voices, graph, store and the context.

Non-blocking risks:
- **A1 - Main-thread hitch when a cue renders synchronously.** This is author-reported: up to about 118 ms for `stinger_fulfilled`, and the first play of any cue that has not been prewarmed renders synchronously. That breaks the solo-first "never lag" rule during play. Prewarm every cue before Clock In, or move synthesis to a Worker or `OfflineAudioContext`, before VT/perf sign-off.
- **A2 - Acceptance items not met or not run.** "Opus/WebM + AAC fallback" is marked N/A because the audio is procedural. That is a scope interpretation the lead or Cee should confirm; it is not a PASS. "≤ 0.3 ms CPU" was not measured in a browser.
- **A3 - Six contract requests** (the `audio.cue`, footstep and vehicle-motion events, among others) are correctly left as proposals. Until they land, footsteps are silent, other players' sounds are not spatialised, and the vehicle loop has a fixed pitch.

## Not reached (time limit)
- `apps/server/src/api/test-harness.ts`, the body of each test (I read names only), the migrations SQL and journal, `packages/db/src/ids.ts`, `client-ip.ts` (the source of `remoteAddress`, which every per-IP limit depends on).
- Audio: `player.ts`, `voice-manager.ts`, `event-router.ts`, `graph.ts`, `music.ts`, `buffer-store.ts`, `dsp.ts`/`recipes.ts` (per-tick allocations, voice-steal correctness, node-budget enforcement), and the audio tests. A focused audio pass or the `performance-reviewer` should cover these hot paths before W7-T06.

## Next
1. The backend author (or the lead) applies B1 (`VERSION_CONFLICT` and the Holder `inviteCode` on GET) with tests, then re-runs the api vitest.
2. The lead decides on non-blocking items 1, 3 and 6 (security and ops trade-offs).
3. Audio: finish the hot-path review, measure CPU and hitches in a browser, and get a ruling on A2.

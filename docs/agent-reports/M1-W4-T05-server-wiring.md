# M1-W4-T05 - account API server wiring (integrator)

Task / status: done (wiring) / 2026-11-14 / integrator / Sonnet 5.5
Scope: `apps/server/src/app/**` only. No edits to `packages/db`, `apps/server/src/api/**`, or `apps/server/.env` (md5 identical before/after). No git mutations; no dev server started.

## Wiring changes
- `apps/server/src/app/server.ts`
  - `createMoonRepository(PERSISTENCE_DRIVER=memory ? {driver:"memory"} : {driver:"postgres", connection: db})`.
  - `createAccountApi({ repo, envName, jwtSecret, jwtSecretPrevious, refreshTokenPepper, logger, storage: () => "ok" })`; `routes = [...healthRoutes, ...account.routes]` passed to `createGameServer`.
  - `ServerApp` now exposes `repo` and `verifyToken` (`account.verifyToken`).
  - Daily refresh-token purge: no scheduler existed, so a small `setInterval` (default 24 h, `unref`'d, errors logged not thrown, cleared in `shutdown()`); `StartServerOptions.purgeIntervalMs` (0 disables, tests shorten it). Deliberately no purge at boot, so a sleeping Neon DB is not woken.
- `apps/server/src/app/server.test.ts`: +2 tests.
  1. Real HTTP: `GET /v1/me` without token = 401; `POST /v1/auth/guest` = 201 (schema-validated `GuestCreateResponse`); `GET /v1/me` with the access token = 200 (`ProfileSchema`, `isGuest: true`, matching `playerId`); `app.verifyToken` accepts the token and returns `null` for garbage.
  2. Purge timer fires on the interval and stops after `shutdown()`.

## Not wired (needs an owner)
- Room `onAuth`: no room currently authenticates (`HelloRoom` / `hello-join-route` have no `onAuth`; `createGameServer` has no auth option). `verifyToken` is exposed on `ServerApp` so the shift room (W5, net owner) can take it. Not patched here (`apps/server/src/net/**` is not mine).
- Optional deps `online(contractId)` and `blockedNames` left at defaults (0 / empty); `storage` stays `"ok"` as in the health route.

## Gates (Node 26.13.1, apps/server, this file state)
- `tsc --noEmit`: clean (exit 0, no output).
- `eslint src/app`: clean (no output).
- `prettier --check src/app`: "All matched files use Prettier code style!".
- `vitest run`: 17 files, 188 passed (186 previous + 2 new), 0 failed, 33.6 s.
- NOT RUN: full `pnpm verify`, postgres driver against a real server (needs DATABASE_URL); only the memory driver is exercised through the composition root.

## Recommendation
Accept the wiring. Follow-ups: net owner adds `onAuth` using `ServerApp.verifyToken` when the authenticated room lands; devops/lead may want a scheduler abstraction if more periodic jobs appear.

## Fixes (review B1, 2026-11-14, backend-data-engineer)

Files: `apps/server/src/api/{accounts,contracts,http,service}.ts`, tests `auth.test.ts`, `contracts.test.ts`, new `housekeeping.test.ts`. `packages/db` unchanged. `apps/server/src/net/**` and `app/server.ts` untouched.

- **B1a** `accounts.ts`: a stale `PATCH /v1/me` now answers `409 {error:"VERSION_CONFLICT"}` through `fail()` (status from `API_ERROR_STATUS`). Test: `auth.test.ts` "PATCH enforces optimistic concurrency" asserts the code via `ApiErrorBodySchema`.
- **B1b** `contracts.ts`: new `toDetail()` builds `GetContractResponse` (summary plus `inviteCode`). The code is non-null only when `role === "holder"` and `shiftType === "private"`, otherwise `null`. Used by `GET /v1/contracts/:id` and, as the contract allows, by `PATCH /v1/contracts/:id` (so a switch to Private hands the Holder the fresh code). The list and join-code responses are unchanged (no code). Tests: Holder sees the code, it follows rotation, Staff get `null` and the serialised body contains neither the old nor the new code, Solo is `null`, the list never mentions `inviteCode`; PATCH to Private returns the code, back to Solo returns `null`.
- **Other v0.3.0 drift**: re-read the contract header and schemas. Create, rotate, join-code, members and the other error codes already match. No further drift in the api handlers.
- **Non-blocking 3 (purge on Render free)**: `createLazyPurge` (`service.ts`) purges refresh tokens on the first API request that answers below 500 after boot, then at most once per 24 h (`purgeIntervalMs`, 0 disables). Triggered from `safe()` via the optional `ApiContext.housekeeping` hook, fire-and-forget, never overlapping. A failed purge is logged by `errorCodeForLog` only and retried after 10 min, so a powered-off database is not hammered. The 24 h timer in `app/server.ts` is left in place (harmless duplicate). Tests in `housekeeping.test.ts`: first call, interval throttle, disable, failure log redaction and retry gap, no overlap.
- **Not done / for others**: `server.ts:140` still logs the raw `{ err }` (non-blocking 5); it is outside my paths, suggest switching to `errorCodeForLog`. Non-blocking 1, 2, 4, 6-12 untouched (spec decisions or no-op).

Evidence (Node 26.13.1 via fnm prefix): `tsc --noEmit` clean in `apps/server` and `packages/db`. `packages/db` vitest: 6 files, 78 passed, 2 skipped. `apps/server` vitest: 17 of 18 files pass, 192 passed, 2 failed, both in `src/net/admission.test.ts` ("N2 unknown bucket", net owner's in-flight work, unrelated to the api; no api test fails). Not run: `pnpm verify`.

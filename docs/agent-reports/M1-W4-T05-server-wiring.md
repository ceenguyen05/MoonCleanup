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

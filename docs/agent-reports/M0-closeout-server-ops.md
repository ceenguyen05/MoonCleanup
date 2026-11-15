# M0 close-out: server ops (STATUS list B items 6, 8, 9)

Result: all four items were already implemented on disk; I verified them and made no source edits.

| Item | Evidence on disk |
|---|---|
| (6) late-input drops and RSS/heap | `ops/room-stats.ts` `recordLateInputs` feeds a rate-limited `LateInputLog` and the `lateInputs` field. `ops/stats-reporter.ts` adds `rssMb`, `heapUsedMb` and `heapTotalMb` to every room-stats line via `process.memoryUsage`. `net/spike/load-test-room.ts` forwards `engine.counters.inputsLate` to `stats.recordLateInputs`. Tests: `ops/stats.test.ts` (burst of 50 gives one warn line and `lateInputs: 50`; the real probe returns sane memory). The real ShiftRoom does not exist yet: M1 must call `stats.recordLateInputs` on it. |
| (8) `at_capacity:rooms` live test | `net/admission-ws-rooms.test.ts`: real Node http socket on the ws fallback, MAX_ROOMS=2. It fills both rooms, then checks 503, the body `{error:"AT_CAPACITY", message:"at_capacity:rooms"}`, the `retry-after` header and that no room was created. The uWS twin is in `admission.test.ts`. |
| (9) N10 DB CA cert | Reconciled as: TLS is mandatory and verified (`rejectUnauthorized: true`) off local, and `DATABASE_CA_CERT` is optional. `ops/env.ts` and `packages/db/src/config.ts` (migrate) both require `sslmode=require` unless ENV_NAME=local. An unset ENV_NAME is not local, so migrate fails closed. `connection.ts` uses the custom CA if given, otherwise the system CA store (Neon). Documented in `.env.example`, `render.yaml` and the db README. Tests: `packages/db` `config.test.ts` and `migrate.test.ts`, and `env.test.ts`. |
| (9) N11 placeholder secrets | `ops/env.ts` `PLACEHOLDER_SECRET_RE` is checked against JWT_SECRET, JWT_SECRET_PREVIOUS and REFRESH_TOKEN_PEPPER when ENV_NAME=production. `env.test.ts` has the .env.example values refused in production and allowed outside it. |

## Results (Node v22.20.0; the Node 26 fnm prefix was not found in this shell)
- `apps/server`: `tsc --noEmit` exit 0. `vitest run`: 17 files, 188 tests, all passed.
- `packages/db`: `vitest run`: 6 files, 78 passed, 2 skipped (the skips are the real-postgres tests, see below).

## NOT RUN
- Node 26.13.1 run.
- Full `pnpm verify`.
- `runMigrations` against a real postgres.js/TLS server (blocked: it needs the first Render deploy).
- A live uWS-transport rooms test on the uWS binary. `admission.test.ts` covers it at unit level.

No git, STATUS or task-row edits were made.

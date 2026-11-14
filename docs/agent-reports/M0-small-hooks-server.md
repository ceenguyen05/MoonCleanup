# M0-small-hooks-server: server/bots/db hooks batch

Status: done for all six items (item 6 live on the ws transport; uWS twin already existed). Date 2026-11-13. Agent: netcode-engineer (Sonnet 5.5). No git, no installs, `apps/client/**` untouched.

## Done

1. **Late-input drops and RSS/heap.**
   - `ops/room-stats.ts`: `RoomStats.recordLateInputs(n)`, `lateInputs` in each room-stats snapshot (per window, reset), optional `RoomStatsHooks`; `ProcessProbe.memoryBytes?()`.
   - `ops/late-input-log.ts` (new): `LateInputLog`, at most one `warn` (`kind:"late-inputs"`, `dropped`, `sinceLastLogS`) per room per 10 s; throttled drops are summed into the next line.
   - `ops/stats-reporter.ts`: wires the hook per room; every room-stats line now carries `rssMb`, `heapUsedMb`, `heapTotalMb` (real probe uses `process.memoryUsage()`).
   - `net/spike/load-test-room.ts` forwards the engine's `inputsLate` delta (receive-time and drain-time drops) after `receiveInput` and each step. The only room that consumes inputs today is the spike room; the real game room must call `stats.recordLateInputs` the same way.
2. **TRANSPORT in ServerEnv.** `ops/env.ts`: `TRANSPORT` (blank = auto, trim, case-insensitive, `auto|uws|ws`, error text identical to `net/transport`: `TRANSPORT: expected one of auto, uws, ws`), `ServerEnv.transport`, in `describeEnvForLog`. `app/index.ts` no longer parses it separately; `startServer` uses `options.transport ?? env.transport`. `net/transport.ts` parse helpers are kept (still tested). Docs already consistent (`.env.example`, environments.md row, HOSTING_GUIDE, render.yaml); no doc edits needed.
3. **N10 (migrate TLS).** Verified: with the Neon change, a missing `DATABASE_CA_CERT` is correct (system-CA verify, `rejectUnauthorized: true` in `buildClientOptions`). Remaining gap found and fixed: `planMigrationFromEnv` only enforced TLS when `ENV_NAME` was set, so an unset `ENV_NAME` skipped it. It now fails closed (`packages/db/src/config.ts`): TLS (`sslmode=require|verify-*`) is required unless `ENV_NAME=local`. Render sets `ENV_NAME` in render.yaml so the hosted build is unaffected. Existing tests that relied on unset `ENV_NAME` now pass `ENV_NAME: "local"`; new test covers unset/blank/non-local x CA/no CA.
4. **N11 (placeholder secrets).** `ops/env.ts`: when `ENV_NAME=production`, `JWT_SECRET`, `JWT_SECRET_PREVIOUS` and `REFRESH_TOKEN_PEPPER` matching `replace-me | change-me | placeholder | your-secret/pepper/key | <...>` fail validation with `KEY: looks like a template placeholder...` (value never echoed). Tests: both `.env.example` values, each key alone, the previous-key slot, alternate spellings, no echo, still accepted on local, real-looking secrets accepted in production.
5. **Bots reconnect cap.** `tools/bots/src/clients/retry.ts`: `SESSION_RECONNECT` (7 retries, 100 ms base, 2 s ceiling = 9 s of waiting; SDK default is 15 retries, about 56 s), `capSessionReconnection`, `sessionReconnectBudgetMs`; applied in `Bot.attach` to `room.reconnection`. After the SDK gives up the room finishes, `Bot.dropped` turns true and the scenario's existing join backoff (or abandon) takes over.
6. **at_capacity:rooms.** New `apps/server/src/net/admission-ws-rooms.test.ts`: real Node http socket, `ws` fallback transport, MAX_ROOMS=2 with generous client ceiling; 12 reservations fill two rooms, the 13th gets 503, `retry-after: 30`, JSON `{error:"AT_CAPACITY",message:"at_capacity:rooms"}`, no new room, `refused.rooms===1`. The uWS twin already existed (`admission.test.ts`, 4th room at MAX_ROOMS=3). Both are live HTTP-level refusals; neither opens a WebSocket for the refused client.

## Evidence (Node 26.13.1 via fnm PATH prefix, this file state)

- tsc: `apps/server`, `packages/db`, `tools/bots` clean.
- eslint (`apps/server/src`, `packages/db/src`, `tools/bots/src`): clean.
- vitest: apps/server 15 files / 150 passed (was 139 + 11 new); packages/db 4 files / 30 passed + 2 skipped (real-server suite needs `DATABASE_URL`); tools/bots 3 files / 17 passed.
- prettier --check on all 17 edited files: pass (prettier re-wrote `env.test.ts` and `retry.ts`; `apps/server/src/ops` (52) and tools/bots (17) vitest were re-run after formatting and pass).

## Not done / labelled

- **Bot reconnect cap is verified by schedule arithmetic only** (real SDK `createReconnection()` defaults vs capped: 56.2 s vs 9.0 s), not by a wall-clock run that kills a live server under a bot. Next: `pnpm --filter @moon-cleanup/bots bots spike-16 ...` against a NET_SPIKE server, kill the server, and confirm `bot N dropped by server` appears about 9-10 s later.
- Late-input log has no live-server proof beyond the integration test that sends a duplicate seq and sees the stats counter; the 10 s throttle is unit-tested with a fake clock.
- N10 note not yet in docs: db README / HOSTING_GUIDE do not mention that an unset `ENV_NAME` now fails the migrate step (Render has it set). Add one line if wanted.

Files: `apps/server/src/ops/{env,env.test,late-input-log,room-stats,stats-reporter,stats.test,index}.ts`, `apps/server/src/app/{index,server}.ts`, `apps/server/src/net/spike/{load-test-room,load-test-room.test}.ts`, `apps/server/src/net/admission-ws-rooms.test.ts`, `packages/db/src/{config,config.test}.ts`, `tools/bots/src/clients/{retry,retry.test,bot}.ts`.
